#!/usr/bin/env node
// telemetry-capture.mjs — durable per-session usage capture for team telemetry.
//
// WHY THIS EXISTS. The efficiency-audit skill answers "what did this cost" by
// reading live transcripts — but transcripts expire (~30 days) and live on each
// engineer's machine. This hook captures each session's grounded numbers AT THE
// MOMENT THEY EXIST into a git-committed ledger (.agents/telemetry/automation/*.jsonl), so
// the team's usage survives transcript cleanup and accumulates through git.
//
// Invocation modes:
//   (stdin JSON)             Claude Code SessionEnd hook — captures the ending
//                            session, then runs a bounded sweep.
//   --sweep [--all]          Harvest every unharvested completed session for
//                            this repo (Claude + Copilot). Wired as Copilot's
//                            sessionStart hook; also fine manually / from CI.
//   --transcript <p> --session <id> [--cwd <repo>]
//                            Direct capture of one Claude transcript (tests,
//                            manual backfill).
//
// Parsing rules are lifted from the efficiency-audit skill's usage-rollup.mjs /
// copilot-usage.mjs (max-per-message-id token dedup, last-shutdown-wins model
// metrics, nanoAIU → USD) — trimmed to the single-session grain. Dollars on the
// Claude path come from ccusage metering at capture time (never a price table);
// on Copilot from the session's own billed `totalNanoAiu`. When neither is
// available the line carries tokens with costUsd null — never an estimate.
//
// STDLIB ONLY (+ the user's own ccusage shelled via npx, best-effort).
// A hook must never break the host session: main() catches everything and
// exits 0 with a one-line stderr note.
import {
  readFileSync, readdirSync, existsSync, statSync, appendFileSync, mkdirSync,
  openSync, readSync, closeSync, linkSync, copyFileSync, rmSync, mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, basename, dirname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { loadSettings, telemetryDir, liveReportPath, TA_DEFAULTS, idPatterns } from '../engine/config.mjs';
import { hook, loadExtension } from '../engine/extension.mjs';
import { migrationOn } from '../engine/migrations.mjs';
import { byName } from '../engine/order.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { engineRootOf, entryPointsOn, gateOrExplain } from '../engine/activation.mjs';
import { PROBE_PROMPT_RE, probing, readStdinBounded, recordFired } from '../engine/probe.mjs';
import { resolveScope, scopeForLine } from '../engine/scopes.mjs';
import { stampRevision } from '../engine/manifest.mjs';
import { writerId } from '../engine/version.mjs';
import { canonical } from '../kit/canonical.mjs';

const ENGINE_ROOT = engineRootOf(import.meta.url);
const LEDGER_VERSION = 1;
const IDLE_GAP_MS = 30 * 60 * 1000;   // same active-time rule as efficiency-audit
const PROMPT_MAX_CHARS = 200;
const PROMPT_MAX_COUNT = 100;
const LIVE_GRACE_MS = 2 * 60 * 1000;  // a transcript touched this recently is likely still running
const RECAPTURE_MARGIN_MS = 5 * 60 * 1000; // source-file growth beyond the recorded end that means "the session continued"
export const USD_PER_CREDIT = 0.01;   // GitHub's published AI-credit conversion

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export function readRecords(jsonlPath) {
  const out = [];
  for (const line of readFileSync(jsonlPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = safeParse(line);
    if (rec) out.push(rec);
  }
  return out;
}

// --- Config / ledger ---------------------------------------------------------
export function loadConfig(repo, settings = loadSettings(repo)) {
  const defaults = {
    capturePrompts: false, priceAtCapture: true, maxSweep: 10,
    vscodeUserDataDirs: [], // extra VS Code user-data or workspaceStorage dirs (portable mode, --user-data-dir)
    otel: null,             // { enabled: true, endpoint: 'http://localhost:4318' } — see install-hooks --otel
  };
  const p = join(telemetryDir(repo, settings), 'config.json');
  if (!existsSync(p)) return defaults;
  const cfg = safeParse(readFileSync(p, 'utf8'));
  return cfg && typeof cfg === 'object' ? { ...defaults, ...cfg } : defaults;
}

/** Who is spending — git identity first (team-meaningful), OS user as fallback. */
export function whoAmI(repo) {
  const git = (key) => {
    try {
      return execFileSync('git', ['-C', repo, 'config', key], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null;
    } catch { return null; }
  };
  const email = git('user.email');
  const name = git('user.name') || userInfo().username;
  // Ledger identity prefers the USERNAME (git user.name, else the OS account)
  // — human-readable in file names and team reports. The email local-part is
  // the last resort only: an address like bermudas.alexander@gmail.com used
  // to mint `usage-bermudas-alexander.jsonl`, which reads as an account, not
  // a person (user feedback 2026-08-18). A renamed identity is safe: readers
  // glob usage-*.jsonl and dedup by session id, so the old file keeps
  // counting and new lines start a new one — nothing lost, nothing doubled.
  const base = name || (email ? email.split('@')[0] : null);
  const slug = String(base ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return { name, email, slug };
}

/** Per-user ledger file — one appender per file means git merges never conflict. */
export function ledgerPath(repo, slug, settings = loadSettings(repo)) {
  return join(telemetryDir(repo, settings), `usage-${slug}.jsonl`);
}

/**
 * Every `${host}:${id}` → the LATEST ledger line for that session in any user's ledger (by capturedAt, then endedAt).
 * item 17: a VS Code session with no timestamps has no end to advance, so a re-capture is judged by whether its
 * measurement state differs from this line (B2-08: counts alone missed a later billing patch).
 */
export function knownGrowth(repo, settings = loadSettings(repo)) {
  const dir = telemetryDir(repo, settings);
  const out = new Map();
  let files;
  try { files = readdirSync(dir).filter((f) => /^usage-.*\.jsonl$/.test(f) || f === 'usage.jsonl'); } catch { return out; }
  for (const f of files) {
    for (const rec of readRecords(join(dir, f))) {
      if (rec?.host && rec?.id) noteGrowth(out, `${rec.host}:${rec.id}`, rec);
    }
  }
  return out;
}
const msOf = (v) => { const t = v ? Date.parse(v) : NaN; return Number.isNaN(t) ? 0 : t; };
function noteGrowth(map, key, line) {
  const prev = map.get(key);
  if (!prev || msOf(line.capturedAt) > msOf(prev.capturedAt)
    || (msOf(line.capturedAt) === msOf(prev.capturedAt) && msOf(line.endedAt) >= msOf(prev.endedAt))) map.set(key, line);
}
// Fields that identify the writer or the observer, not the measurement. Everything else is measurement state, so a
// field added to the line later is compared without touching this list.
// `restampedBy` is restamp provenance (map O7): a restamped line re-compared against an unchanged file is no change.
const NOT_MEASUREMENT = new Set(['v', 'capturedAt', 'writer', 'manifestRevision', 'restampedBy', 'user', 'repo', 'branch', 'scope', 'prompts']);
// The kit's canonical JSON, with an in-memory `undefined` read as null (a stored line has no undefined).
const nullish = (v) => (v === undefined ? null : Array.isArray(v) ? v.map(nullish)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nullish(x)])) : v);
const measurementState = (line) => canonical(nullish(Object.fromEntries(Object.entries(line).filter(([k]) => !NOT_MEASUREMENT.has(k)))));

/** Every `${host}:${id}` → latest endedAt already in ANY user's ledger file. */
export function knownSessions(repo, settings = loadSettings(repo)) {
  const dir = telemetryDir(repo, settings);
  const known = new Map();
  let files;
  try { files = readdirSync(dir).filter((f) => /^usage-.*\.jsonl$/.test(f) || f === 'usage.jsonl'); }
  catch { return known; }
  for (const f of files) {
    for (const rec of readRecords(join(dir, f))) {
      if (!rec?.host || !rec?.id) continue;
      const key = `${rec.host}:${rec.id}`;
      const end = rec.endedAt ? Date.parse(rec.endedAt) : 0;
      if (!known.has(key) || end > known.get(key)) known.set(key, end);
    }
  }
  return known;
}

/**
 * Append one ledger line. `writer` (B2 item 11; map D4): a measurement append (capture, fold and sweep paths — every
 * call without `restamp`) is stamped with `writer: tokenomics-engine@<version>` and the current manifest's
 * `manifestRevision` (module.json's; 1 for the implied TA manifest when it is absent; null when it is present but unusable), right after `v` (§3.2 order). A restamp append
 * (`{ restamp: true }`, work-scope restamp) is not a measurement: it is written exactly as the caller built it, with the
 * winner's original provenance (map O7). Provenance a caller supplies is never overwritten.
 */
export function appendLine(repo, slug, line, settings = loadSettings(repo), { restamp = false } = {}) {
  const dir = telemetryDir(repo, settings);
  mkdirSync(dir, { recursive: true });
  const out = !restamp && migrationOn('writer') ? stampWriter(line, dir) : line;
  appendFileSync(ledgerPath(repo, slug, settings), `${JSON.stringify(out)}\n`);
}

/** `{v, writer, manifestRevision, ...line}`: the current writer and revision; an unusable module.json stamps null (unknown), never dropped. */
function stampWriter(line, dir) {
  return { v: line.v, writer: writerId(), manifestRevision: stampRevision(dir), ...line };
}

// --- Claude transcript parsing (single-session grain) ------------------------
/**
 * Token totals the way ccusage counts them: group by message.id, MAX per id
 * (streaming rewrites the same id with a growing output count — a naive sum
 * measured ~46% off; rule pinned in efficiency-audit's tests).
 */
export function dedupUsage(records) {
  const byId = new Map();
  let anon = 0;
  for (const rec of records) {
    const u = rec.message?.usage;
    if (!u) continue;
    const id = rec.message?.id || `__anon_${anon++}`;
    const cur = {
      input: num(u.input_tokens), output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens),
      model: rec.message?.model || null,
    };
    const prev = byId.get(id);
    if (!prev) byId.set(id, cur);
    else {
      prev.input = Math.max(prev.input, cur.input);
      prev.output = Math.max(prev.output, cur.output);
      prev.cacheRead = Math.max(prev.cacheRead, cur.cacheRead);
      prev.cacheWrite = Math.max(prev.cacheWrite, cur.cacheWrite);
      if (!prev.model && cur.model) prev.model = cur.model;
    }
  }
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Set();
  // Per-model quads ride along: the hyperfactory dataset REQUIRES
  // tokens_by_model whenever models_used has >1 entry (a blended total can't
  // be re-priced across tiers) — and our runs always mix tiers (haiku triage
  // + sonnet workers). Each usage record carries message.model, so the split
  // costs nothing to keep.
  const tokensByModel = {};
  for (const v of byId.values()) {
    tokens.input += v.input; tokens.output += v.output;
    tokens.cacheRead += v.cacheRead; tokens.cacheWrite += v.cacheWrite;
    if (v.model) {
      models.add(v.model);
      const m = (tokensByModel[v.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      m.input += v.input; m.output += v.output; m.cacheRead += v.cacheRead; m.cacheWrite += v.cacheWrite;
    }
  }
  // usageSeen distinguishes MEASURED-EMPTY from UNMEASURED: on a non-Anthropic
  // gateway the transcript can carry zero usage records for a dispatch that
  // demonstrably worked — publishing those zeros as a measurement is how a
  // $146 run reports as $20 (manual-qa field case, PR #63; mirrored here).
  return { tokens, models, tokensByModel, usageSeen: byId.size };
}

/** Active minutes = gap-capped sum; wall = last − first. Same rule both hosts. */
function timeStats(stampsMs) {
  const s = [...stampsMs].sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < s.length; i++) {
    const dt = s[i] - s[i - 1];
    if (dt > 0 && dt <= IDLE_GAP_MS) active += dt;
  }
  return {
    startTs: s.length ? s[0] : null,
    endTs: s.length ? s[s.length - 1] : null,
    activeMin: Math.round(active / 60000),
    wallMin: s.length > 1 ? Math.round((s[s.length - 1] - s[0]) / 60000) : 0,
  };
}

// Case ids (Jira-style keys) mined from dispatch descriptions, branches,
// titles and prompts — ONLY the ids are stored, never the surrounding text, so
// this runs ungated. They make spend-per-case attribution precise: a workflow
// dispatch labelled "analyse TC-101+TC-102" names exactly what it worked on.
// `SCRUM-T101` (letter-prefixed numbers) is a real TMS shape — hence `[A-Z]?`.
// The stoplist drops the common tech tokens the loose pattern would otherwise
// swallow (ISO-8601, SHA-256, …); imperfect by design, ids are a hint not a claim.
// The negative lookahead rejects FRAGMENTS of longer dash-number chains:
// "RUN-2026-08-17-001" (a manual-qa run report id, named in every
// manual-qa-verified dispatch prompt) would otherwise yield a phantom case
// "RUN-2026" that silently siphons half a combined slot's cost attribution
// (field case 2026-08-18). A real case id is never immediately followed by
// another dash-digit segment. Under TA settings that pattern is ids.patterns[0] (engine/config.mjs).
const idMiners = new WeakMap(); // settings.ids → { res: compiled patterns, stop: Set(stoplist) }
/** Mine candidate ids from free text with the configured `ids` patterns (spec §14.4). */
export function mineIds(settings, texts) {
  if (!idMiners.has(settings.ids)) idMiners.set(settings.ids, { res: idPatterns(settings), stop: new Set(settings.ids.stoplist) });
  const { res, stop } = idMiners.get(settings.ids);
  const out = new Set();
  for (const t of texts) {
    if (typeof t !== 'string' || !t) continue;
    for (const re of res) {
      for (const m of t.match(re) ?? []) {
        if (stop.has(m.split('-')[0])) continue;
        out.add(m);
        if (out.size >= settings.ids.max) return [...out].sort();
      }
    }
  }
  return [...out].sort();
}
/** The reference miner's signature, under TA settings. */
export function extractCaseIds(...texts) { return mineIds(TA_DEFAULTS, texts); }

/** Raw user-authored text of a record, or null (injected wrappers excluded).
 * `sidechain: true` when reading a SUB-AGENT's own transcript — there every
 * record is marked isSidechain, including the dispatch prompt we need. */
function userText(rec, { sidechain = false } = {}) {
  if (rec.type !== 'user' || (rec.isSidechain && !sidechain)) return null;
  const c = rec.message?.content;
  let text = null;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    const t = c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ');
    if (t) text = t;
  }
  if (!text) return null;
  text = text.trim();
  if (!text || text.startsWith('<')) return null; // system-reminder / command wrappers
  return text;
}

/**
 * A probe session (final review I3, R17): its first user prompt is the probe's (`tokenomics hook probe <nonce>`).
 * Outside a probe (TOKENOMICS_PROBE unset) the capture never writes a line for it, so a later ordinary sweep of the
 * repo cannot carry `doctor --probe`'s session into the repo's ledger.
 */
const isProbeSession = (firstPrompt) => PROBE_PROMPT_RE.test(firstPrompt ?? '');
/** A probe's own capture (TOKENOMICS_PROBE set): the one run that does capture a probe session, into its state dir. */
const probeRun = (env) => !!env.TOKENOMICS_PROBE;

/** A Copilot user.message's text (`text` or `content`), or null. */
const copilotUserText = (d) => (typeof d?.text === 'string' ? d.text : (typeof d?.content === 'string' ? d.content : null));

/** The first user prompt of a host transcript (`claude`: a session .jsonl; `copilot`: an events.jsonl), else null. */
export function firstPromptOf(host, path) {
  try {
    if (!existsSync(path)) return null;
    for (const rec of readRecords(path)) {
      if (host === 'claude') { const t = userText(rec); if (t) return t; continue; }
      if (rec?.type !== 'user.message') continue;
      const t = copilotUserText(rec.data)?.trim();
      if (t && !t.startsWith('<')) return t;
    }
  } catch { /* unreadable → unknown */ }
  return null;
}

/** A user prompt worth keeping, capped for the ledger. */
function promptText(rec) {
  const t = userText(rec);
  return t ? t.slice(0, PROMPT_MAX_CHARS) : null;
}

export function parseClaudeTranscript(records, { capturePrompts = false, sidechain = false, settings = TA_DEFAULTS } = {}) {
  let role = null;
  let branch = null;
  let firstText = null; // raw first user message — a workflow sub-agent's only naming surface
  let turns = 0, toolCalls = 0, toolErrors = 0;
  const skills = new Set();
  const dispatched = [];
  const prompts = [];
  const caseTexts = [];
  const stamps = [];
  const turnIds = new Set(); const toolIds = new Set(); const errIds = new Set();
  let anon = 0;
  for (const rec of records) {
    if (rec.type === 'agent-setting' && rec.agentSetting) role = rec.agentSetting;
    if (rec.gitBranch) branch = rec.gitBranch;
    // attributionSkill is deliberately NOT folded in: sub-agents inherit the
    // parent's active skill, so it reports loads that never happened (the same
    // conflation efficiency-audit's rollup had to split). `skills` = real
    // Skill-tool invocations only.
    // 8000 chars: a workflow dispatch opens with a ~3.5k-char boilerplate
    // preamble BEFORE the stage text the label needs (measured live at offset
    // 3564) — and firstText never reaches the ledger, only the derived label.
    if (!firstText) { const raw = userText(rec, { sidechain }); if (raw) firstText = raw.slice(0, 8000); }
    if (rec.timestamp) {
      const t = Date.parse(rec.timestamp);
      if (!Number.isNaN(t)) stamps.push(t);
    }
    if (rec.type === 'assistant') {
      const k = rec.message?.id || `__t${anon++}`;
      if (!turnIds.has(k)) { turns++; turnIds.add(k); }
    }
    {
      const p = promptText(rec);
      if (p) {
        caseTexts.push(p); // ids only are kept from this — see extractCaseIds
        if (capturePrompts && prompts.length < PROMPT_MAX_COUNT) prompts.push({ t: rec.timestamp || null, text: p });
      }
    }
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        if (b.id && toolIds.has(b.id)) continue;
        if (b.id) toolIds.add(b.id);
        toolCalls++;
        if (b.name === 'Skill' && b.input?.skill) skills.add(b.input.skill);
        if (b.name === 'Agent') {
          const description = String(b.input?.description || '').slice(0, 120);
          if (description) caseTexts.push(description); // ids only survive ungated
          dispatched.push({
            type: b.input?.subagent_type || 'unknown',
            ...(capturePrompts ? { description } : {}),
          });
        }
      } else if (b.type === 'tool_result' && b.is_error) {
        if (b.tool_use_id && errIds.has(b.tool_use_id)) continue;
        if (b.tool_use_id) errIds.add(b.tool_use_id);
        toolErrors++;
      }
    }
  }
  const { tokens, models, tokensByModel, usageSeen } = dedupUsage(records);
  // firstText is included explicitly: on a SUB-AGENT transcript every record is
  // sidechain-marked, so promptText() skips them all and caseTexts never sees
  // the dispatch prompt — the one surface that names the unit's case ids when
  // the label window missed them. On a parent transcript it duplicates a
  // caseText; extractCaseIds dedupes.
  const caseIds = mineIds(settings, [branch, firstText, ...caseTexts]);
  return { role, branch, firstText, turns, toolCalls, toolErrors, skills, dispatched, prompts, caseIds, tokens, tokensByModel, usageSeen, models, ...timeStats(stamps) };
}

/** `{path, id, role}` per sub-agent transcript — keyed off the .meta.json sidecar. */
export function findSubagents(projectDir, sessionId, { fs = { readdirSync } } = {}) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // capture-robustness (item 14): sort the listing ourselves; its order is not documented by Node
    if (migrationOn('capture-robustness')) entries = [...entries].sort(byName);
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.meta.json') && full.includes(`${sep}subagents${sep}`)) {
        const id = e.name.replace(/\.meta\.json$/, '');
        const jsonl = join(dir, `${id}.jsonl`);
        if (!existsSync(jsonl)) continue;
        const meta = safeParse(readFileSync(full, 'utf8')) || {};
        out.push({ path: jsonl, id, role: meta.agentType || 'unknown', description: meta.description || '' });
      }
    }
  };
  walk(join(projectDir, sessionId));
  return out;
}

// --- parametric attribution: receipts first ---------------------------------
// The extension's receiptIds hook may return a dispatch's STRUCTURED ids (TA:
// the workflow's persisted return receipts); attribution reads them first and
// falls back to scope-gated prompt mining only where it returns null.
// --- live dispatch log (SubagentStop) ---------------------------------------
// Measurements update AS SUB-AGENTS FINISH, not only at session end: each stop
// meters THAT ONE transcript (1 file, ~1s, async) and appends ONE line per
// dispatch here. Deliberately NOT the ledger: appending a whole-session line
// per stop would put ~N near-identical rows for one session into the
// git-committed ledger, all but the last superseded. This file is per-session,
// one line per dispatch, and is deleted once the session's real ledger line
// lands — so the ledger keeps its honest one-line-per-session grain while
// `work-scope status`, and anything else that wants live numbers, reads
// already-priced dispatches without re-metering anything.
export function dispatchLogPath(repo, sessionId, settings = loadSettings(repo)) {
  return join(telemetryDir(repo, settings), 'live', `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '')}.jsonl`);
}

/** agentId → latest record (a grown dispatch appends a superseding line). */
export function readDispatchLog(path) {
  const out = new Map();
  if (!existsSync(path)) return out;                 // no dispatch has finished yet
  for (const r of readRecords(path)) if (r?.agentId) out.set(r.agentId, r);
  return out;
}

/**
 * Record every finished dispatch not yet in the log. `agentId` (from the stop
 * event) narrows it to the one that just finished; without it every unrecorded
 * transcript is swept, which also self-heals a stop we missed. A dispatch whose
 * transcript GREW since its record (a resumed agent) is re-recorded.
 */
export function captureDispatches(repo, sessionId, { projectDir, config, env = process.env, agentId = null, settings = loadSettings(repo), ext = null } = {}) {
  const cfg = config ?? loadConfig(repo, settings);
  const proj = projectDir
    ?? claudeProjectDirs(repo, env).find((d) => existsSync(join(d, `${sessionId}.jsonl`)) || existsSync(join(d, sessionId)));
  if (!proj) return captureCopilotDispatches(repo, sessionId, { env, settings, ext });
  const want = agentId ? String(agentId).replace(/^agent-/, '') : null;
  const path = dispatchLogPath(repo, sessionId, settings);
  const known = readDispatchLog(path);
  // The session's declared scope is the authority on WHICH cases this work
  // belongs to. When mined ids overlap it, keep only the overlap — regex
  // mining is a fallback, and its false positives (a TMS-adjacent token in
  // the prompt) otherwise split a dispatch's cost with a phantom case. No
  // overlap → keep the mined ids untouched: a stale or partial scope must
  // not zero out real attribution.
  const declared = sessionScope(repo, sessionId, { host: 'claude', quiet: true }, settings)?.cases ?? [];
  const scoped = (mined) => {
    if (!declared.length || !mined?.length) return mined;
    const hit = mined.filter((c) => declared.includes(c));
    return hit.length ? hit : mined;
  };
  let n = 0;
  for (const meta of findSubagents(proj, sessionId)) {
    if (want && !meta.id.endsWith(want)) continue;
    let bytes = 0;
    try {
      const st = statSync(meta.path);
      // capture-robustness (item 15): a directory where the transcript should be skips that one dispatch
      if (st.isDirectory() && migrationOn('capture-robustness')) {
        try { process.stderr.write(`tokenomics: dispatch ${meta.id}: transcript path is a directory, skipped\n`); } catch { /* never break the host */ }
        continue;
      }
      bytes = st.size;
    } catch { continue; }
    const prev = known.get(meta.id);
    if (prev && num(prev.bytes) >= bytes) continue;          // nothing new since we recorded it
    const sp = parseClaudeTranscript(readRecords(meta.path), { sidechain: true, settings });
    if (!sp.turns && !sp.tokens.output) continue;            // nothing measurable yet
    const priced = cfg.priceAtCapture === false ? null : meterSession([meta.path], { env });
    // A dispatch that ran (turns/tool calls) with ZERO usage records is
    // UNMEASURED, not free: tokens go null + tokensAttributed:false so the
    // rollups can say 'floor' instead of billing it as zero (PR #63 mirror).
    const attributed = sp.usageSeen > 0;
    const rec = {
      v: LEDGER_VERSION, session: sessionId, agentId: meta.id, role: meta.role,
      label: deriveLabel(meta.description, sp.firstText, ext, { repo, settings }),
      cases: hook(ext, 'receiptIds', { id: meta.id }, { repo, settings }) ?? scoped(sp.caseIds),
      tokensByModel: attributed ? sp.tokensByModel : {},
      tokens: attributed ? sp.tokens : null,
      ...(attributed ? {} : { tokensAttributed: false }),
      activeMin: sp.activeMin, toolCalls: sp.toolCalls, toolErrors: sp.toolErrors,
      ...(priced?.totalUsd != null ? { costUsd: priced.totalUsd } : {}),
      endedAt: sp.endTs ? new Date(sp.endTs).toISOString() : null,
      bytes, at: new Date().toISOString(),
    };
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(rec)}\n`);
      n++;
    } catch { /* bookkeeping must never break the host */ }
  }
  return n;
}

/**
 * `tokensAttribution` over the parent and every dispatch (§3.2): undefined when every unit reported usage,
 * 'partial' when some did, 'none' when none did. A unit is unmeasured when its `tokens` is null or it says
 * `tokensAttributed: false`.
 */
export function attributionOf(line) {
  const measured = (u) => u?.tokens != null && u.tokensAttributed !== false;
  // An inclusive line carries the session total only: its dispatches' null split is implied by the basis (§3.2.1)
  const flags = [measured(line), ...(line.tokensBasis === 'inclusive' ? [] : (line.subagents ?? []).map(measured))];
  return flags.every(Boolean) ? undefined : (flags.some(Boolean) ? 'partial' : 'none');
}

/**
 * FOLD the live dispatch log into the session's line before it is appended.
 *
 * The session line is re-derived from the transcripts, so it normally already
 * contains every dispatch the live log recorded — this exists for the case
 * where it CANNOT: a sub-agent transcript deleted, expired or unreadable by
 * the time the session ends. Those dispatches were measured while they were
 * alive, and the fold is what keeps them (with their dollars) instead of
 * silently dropping them. Nothing is double-counted: only ids the line does
 * not already carry are added.
 */
export function foldDispatchLog(repo, line, settings = loadSettings(repo)) {
  const log = readDispatchLog(dispatchLogPath(repo, line.id, settings));
  if (!log.size) return line;
  const have = new Set((line.subagents ?? []).map((s) => s.id).filter(Boolean));
  const missing = [...log.values()].filter((r) => r.agentId && !have.has(r.agentId));
  if (!missing.length) return line;
  const fold = migrationOn('fold-flags');
  const nu = migrationOn('null-unobservable');
  // null-unobservable: a counter the record does not carry stays null (never 0-for-unknown)
  const cnt = (v) => (nu && v == null ? null : num(v));
  line.subagents = [...(line.subagents ?? []), ...missing.map((r) => ({
    id: r.agentId, role: r.role, label: r.label, n: 1,
    // fold-flags: the §3.2 dispatch shape of a captured entry (same key order); an unmeasured record is null + flagged
    tokens: fold ? (r.tokens ?? null) : r.tokens,
    ...(fold && (r.tokens == null || r.tokensAttributed === false) ? { tokensAttributed: false } : {}),
    ...(fold ? { tokensByModel: r.tokensByModel ?? {} } : {}),
    activeMin: cnt(r.activeMin),
    toolCalls: cnt(r.toolCalls), toolErrors: cnt(r.toolErrors),
    ...(r.cases?.length ? { cases: r.cases } : {}),
    ...(typeof r.costUsd === 'number' ? { costUsd: r.costUsd } : {}),
  }))];
  line.dispatches = Math.max(num(line.dispatches), line.subagents.length);
  // null-unobservable: a timestamp-less session's minutes stay unmeasured (Q8b)
  if (!(nu && line.activeMin == null)) line.activeMin = num(line.activeMin) + missing.reduce((n, r) => n + num(r.activeMin), 0);
  line.cases = [...new Set([...(line.cases ?? []), ...missing.flatMap((r) => r.cases ?? [])])].sort();
  if (typeof line.costUsd === 'number') {
    line.costUsd += missing.reduce((n, r) => n + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
  }
  line.foldedFromLive = missing.length;   // say it on the line, never silently
  if (fold) {   // §10.5: the session flags are recomputed after the fold
    const att = attributionOf(line);
    if (att) line.tokensAttribution = att; else delete line.tokensAttribution;
    line.models = [...new Set([...(line.models ?? []), ...line.subagents.flatMap((s) => Object.keys(s.tokensByModel ?? {}))])].sort();
  }
  return line;
}

/**
 * Copilot's sub-agents have no transcript files — they are events INSIDE the
 * session's own `events.jsonl`, so a finished dispatch is read from there
 * instead. Two honest differences from the Claude path, both structural:
 * there are **no per-dispatch dollars** on this host (Copilot bills one figure
 * per session, at shutdown), and its `input` field carries the sub-agent's
 * cache-inclusive TOTAL tokens (same convention the session capture uses).
 * Dedup is by the dispatch's own id — a completed sub-agent never changes.
 */
/**
 * A Copilot dispatch's counters from its `subagent.completed` data. The reference writes 0 for what the host
 * does not report; under null-unobservable (§10.5) `toolErrors` is always null (not exposed by the event), and
 * `activeMin` / `toolCalls` are null when `durationMs` / `totalToolCalls` are absent.
 */
/** A Copilot dispatch's `tokens`. The host gives one cache-inclusive total and no category split, so the
 * reference parks it in `input`; under copilot-inclusive (§3.2.1, owner Q6) it is dropped to null instead. */
function copilotDispatchTokens(d) {
  return migrationOn('copilot-inclusive') ? null : { input: num(d.totalTokens), output: 0, cacheRead: 0, cacheWrite: 0 };
}

function copilotDispatchCounters(d) {
  if (!migrationOn('null-unobservable')) {
    return { activeMin: d.durationMs ? Math.round(d.durationMs / 60000) : 0, toolCalls: num(d.totalToolCalls), toolErrors: 0 };
  }
  return {
    activeMin: d.durationMs == null ? null : (d.durationMs ? Math.round(d.durationMs / 60000) : 0),
    toolCalls: d.totalToolCalls == null ? null : num(d.totalToolCalls),
    toolErrors: null,
  };
}

export function captureCopilotDispatches(repo, sessionId, { env = process.env, settings = loadSettings(repo), ext = null } = {}) {
  for (const root of copilotRoots(repo, env)) {
    const eventsPath = join(root, sessionId, 'events.jsonl');
    if (!existsSync(eventsPath)) continue;
    const path = dispatchLogPath(repo, sessionId, settings);
    const known = readDispatchLog(path);
    const started = new Map(); const described = new Map();
    let n = 0;
    for (const ev of readRecords(eventsPath)) {
      const d = ev.data ?? {};
      if (ev.type === 'subagent.started') {
        started.set(d.toolCallId, d.agentName ?? 'unknown');
        if (typeof d.agentDescription === 'string') described.set(d.toolCallId, d.agentDescription);
      }
      if (ev.type !== 'subagent.completed') continue;
      const id = d.toolCallId;
      if (!id || known.has(id)) continue;
      const description = described.get(id) ?? '';
      const rec = {
        v: LEDGER_VERSION, session: sessionId, agentId: id,
        // capture-robustness (item 21): the live log names its own host, so a provisional live line is not 'claude'
        ...(migrationOn('capture-robustness') ? { host: 'copilot' } : {}),
        role: d.agentName ?? started.get(id) ?? 'unknown',
        label: deriveLabel(description, '', ext, { repo, settings }), cases: mineIds(settings, [description]),
        tokens: copilotDispatchTokens(d),
        ...copilotDispatchCounters(d),
        endedAt: ev.timestamp ?? null, at: new Date().toISOString(),
        // no costUsd: this host prices the session once, at shutdown
      };
      try {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, `${JSON.stringify(rec)}\n`);
        known.set(id, rec);
        n++;
      } catch { /* bookkeeping must never break the host */ }
    }
    return n;
  }
  return 0;
}

// --- ccusage metering at capture time (Claude dollars, best-effort) ----------
function linkOrCopy(src, dest) {
  try { linkSync(src, dest); } catch { copyFileSync(src, dest); }
}

/**
 * Meter a session's files with ccusage by staging them in a throwaway
 * CLAUDE_CONFIG_DIR — the same trick efficiency-audit uses. ccusage keys its
 * rows by the staged FOLDER name (verified: files sharing a folder fold into
 * one row; separate folders stay separate rows), so each file gets its own
 * `f<i>` folder and the rows come back as PER-FILE dollars — which is what
 * per-dispatch case attribution needs. Returns `{ totalUsd, perFileUsd }`
 * (aligned with `files`); totalUsd null = "unpriced", never $0.
 */
export function meterSession(files, { env = process.env } = {}) {
  const unpriced = { totalUsd: null, perFileUsd: files.map(() => null) };
  if (env.TOKENOMICS_NO_CCUSAGE === '1') return unpriced;
  let stage;
  try {
    stage = mkdtempSync(join(tmpdir(), 'tokenomics-'));
    for (const [i, f] of files.entries()) {
      const proj = join(stage, 'projects', `f${i}`);
      mkdirSync(proj, { recursive: true });
      linkOrCopy(f, join(proj, basename(f)));
    }
    // TOKENOMICS_CCUSAGE_BIN: an explicit binary (a ccusage on PATH, or a test
    // double). Default stays the npx fetch, so nothing needs installing.
    const bin = env.TOKENOMICS_CCUSAGE_BIN || 'npx';
    const args = bin === 'npx'
      ? ['--yes', 'ccusage@latest', 'claude', 'session', '--json', '--offline']
      : ['claude', 'session', '--json', '--offline'];
    const out = execFileSync(bin, args, {
      env: { ...env, CLAUDE_CONFIG_DIR: stage },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 45000, maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = safeParse(out);
    const list = parsed?.session || parsed?.sessions || parsed?.data || [];
    const perFileUsd = files.map(() => null);
    // ccusage keys each row by the FILE STEM (`agent-abc123`, `<session-id>`),
    // not by the staged folder — the per-folder staging only keeps the rows
    // SEPARATE (files sharing a folder fold into one row). Matching the folder
    // name matched nothing, so every per-dispatch dollar came back null and
    // per-case attribution silently degraded to tokens-only (found on a live
    // workflow session). efficiency-audit's meterFiles always joined by stem.
    const byStem = new Map(files.map((f, i) => [basename(f, '.jsonl'), i]));
    let total = 0, priced = 0;
    for (const s of list) {
      if (typeof s.totalCost !== 'number') continue;
      total += s.totalCost; priced++;
      const key = String(s.sessionId ?? s.period ?? s.session ?? '');
      let i = byStem.get(key);
      if (i === undefined) { const m = /^f(\d+)$/.exec(key); if (m) i = Number(m[1]); } // older/other shapes
      if (i !== undefined && i < perFileUsd.length) perFileUsd[i] = s.totalCost;
    }
    return priced ? { totalUsd: total, perFileUsd } : unpriced;
  } catch {
    return unpriced;
  } finally {
    if (stage) try { rmSync(stage, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// --- dispatch labels (what a sub-agent was FOR) ------------------------------
// The label is the attribution key: the batch-cost join matches the receipt's
// own case ids against it, so it must carry whatever identifies the dispatch.
// Task-tool dispatches have a real `description`; the extension's labelFrom
// may pick a better window (TA: from the first stage marker of a Workflow
// sub-agent's first message). Engine default: the first 160 chars of the
// description, else of the first message, whitespace-collapsed.
export function deriveLabel(description, firstText, ext = null, ctx = {}) {
  const label = hook(ext, 'labelFrom', { description, firstText }, ctx);
  if (label !== undefined) return label;
  const d = String(description || '').trim();
  return d ? d.slice(0, 160) : String(firstText || '').slice(0, 160).replace(/\s+/g, ' ').trim();
}

// --- work-scope join (scripts/work-scope.mjs records) ------------------------
/**
 * The session's declared scope, if any. Exact match first
 * (.agents/telemetry/automation/scopes/<sessionId>.json — Claude, where the announce hook
 * injects the id). Else claim a PENDING record (`open --session auto` — hosts
 * whose agent cannot know its session id, e.g. Copilot): the pending scope
 * whose declaredAt falls inside the session's window, closest to its start,
 * is renamed to the real id so the claim is permanent and single-use.
 * Under scope-resolution (B2 item 9) this is `resolveScope` for `host`: host-qualified records, §14.11
 * precedence, crash-recoverable claims, R9; an ambiguous id is reported on stderr unless `quiet`.
 */
export function sessionScope(repo, sessionId, { startTs = null, endTs = null, host = null, quiet = false } = {}, settings = loadSettings(repo)) {
  if (migrationOn('scope-resolution')) {
    const r = resolveScope(telemetryDir(repo, settings), host, sessionId, startTs, { endedAtMs: endTs });
    // owner Q12b: an ambiguous id is reported here (stderr) and by the kit (`ambiguous-scope`)
    if (r.ambiguous.length && !quiet) process.stderr.write(`tokenomics: scope for ${host ?? '?'}:${sessionId} is ambiguous — records at ${r.ambiguous.join(', ')} are never merged\n`);
    // O1 (review round 1, I1): a record filed under another host is reported, never a silent scope-less line
    if (r.misfiled?.length && !quiet) process.stderr.write(`tokenomics: scope for ${host}:${sessionId}: the only record is ${r.misfiled[0]} (another host's) — not stamped; re-declare with --host ${host} or move it to ${host}/${sessionId}.json\n`);
    return r.scope;
  }
  const dir = join(telemetryDir(repo, settings), 'scopes');
  const exact = join(dir, `${sessionId}.json`);
  if (existsSync(exact)) return safeParse(readFileSync(exact, 'utf8'));
  if (!startTs || !existsSync(dir)) return null;
  const lo = startTs - 5 * 60 * 1000;
  const hi = (endTs ?? Date.now()) + 5 * 60 * 1000;
  let best = null;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('pending-') || !name.endsWith('.json')) continue;
    const s = safeParse(readFileSync(join(dir, name), 'utf8'));
    const at = s?.declaredAt ? Date.parse(s.declaredAt) : NaN;
    if (Number.isNaN(at) || at < lo || at > hi) continue;
    if (!best || Math.abs(at - startTs) < Math.abs(best.at - startTs)) best = { name, s, at };
  }
  if (!best) return null;
  const claimed = { ...best.s, session: sessionId, claimedFrom: best.s.session };
  try {
    writeFileSync(exact, `${JSON.stringify(claimed, null, 2)}\n`);
    rmSync(join(dir, best.name));
  } catch { return null; } // raced with a concurrent capture — the winner keeps it
  return claimed;
}

// --- scope resolution (B2 item 9 `scope-resolution`; spec §14.11, owner Q12) ----------------------------------
// The store lives in engine/scopes.mjs (cycle-free: work-scope.mjs and scope-hook.mjs read it too); the capture's
// entry point is resolveScope, re-exported here.
export { resolveScope } from '../engine/scopes.mjs';

/** One ledger line for a Claude session (parent transcript + sub-agents). */
export function captureClaudeSession(repo, transcriptPath, sessionId, { config, user, price = true, env = process.env, settings = loadSettings(repo), ext = null, allowProbe = probeRun(env) } = {}) {
  const cfg = config ?? loadConfig(repo, settings);
  const records = readRecords(transcriptPath);
  const p = parseClaudeTranscript(records, { capturePrompts: cfg.capturePrompts, settings });
  if (!allowProbe && isProbeSession(p.firstText)) return null; // R17: a probe session is never captured outside a probe
  const subMeta = findSubagents(dirname(transcriptPath), sessionId);
  // Parse each sub-agent keeping its meta alongside, THEN filter — so the
  // transcript paths handed to the meter stay index-aligned with the records
  // that receive the per-file dollars back.
  const pairs = subMeta
    .map((meta) => {
      try {
        const sp = parseClaudeTranscript(readRecords(meta.path), { sidechain: true, settings });
        // The label is the attribution key downstream (batch-cost matches
        // receipt case ids against it). Task dispatches carry a description;
        // Workflow sub-agents don't, so derive from their first user message.
        return { meta, sub: { ...sp, id: meta.id, role: meta.role, label: deriveLabel(meta.description, sp.firstText, ext, { repo, settings }) } };
      } catch { return null; }
    })
    .filter(Boolean);
  const subs = pairs.map((x) => x.sub);
  if (!p.turns && !p.tokens.output && !subs.length) return null; // empty shell — not worth a line
  const models = new Set(p.models);
  for (const s of subs) for (const m of s.models) models.add(m);
  let costUsd = null;
  if (price && cfg.priceAtCapture) {
    // REUSE what the SubagentStop hook already priced. A dispatch whose live
    // record matches its transcript byte-for-byte cannot have changed, so
    // re-metering it would buy nothing — this turns a capture from "stage and
    // price N+1 transcripts" into "price the parent and whatever finished
    // unmeasured", which is what makes capturing mid-run (at close, or as
    // often as you like) cheap instead of quadratic.
    const log = readDispatchLog(dispatchLogPath(repo, sessionId, settings));
    const toMeter = [transcriptPath];
    const meterIdx = [];
    let reused = 0;
    pairs.forEach((x, i) => {
      let bytes = 0;
      try { bytes = statSync(x.meta.path).size; } catch { /* unreadable — meter it */ }
      const rec = log.get(x.meta.id);
      if (bytes && rec && typeof rec.costUsd === 'number' && num(rec.bytes) === bytes) {
        subs[i].costUsd = rec.costUsd;
        reused += rec.costUsd;
      } else {
        toMeter.push(x.meta.path);
        meterIdx.push(i);
      }
    });
    const metered = meterSession(toMeter, { env });
    if (metered.totalUsd != null) {
      // perFileUsd[0] is the parent; [1..] align with the files we metered.
      meterIdx.forEach((i, k) => { subs[i].costUsd = metered.perFileUsd[k + 1] ?? null; });
      costUsd = metered.totalUsd + reused;
    }
    // metering unavailable → costUsd stays null (never a partial total), while
    // any dispatch dollars already recorded remain on their entries.
  }
  // Case ids from every naming surface: branch, prompts/dispatch labels, the
  // sub-agents' .meta.json dispatch descriptions, and the sub-agents' own text.
  // The session's DECLARED scope (work-scope.mjs) joins here too: declared ids
  // are authoritative and ride the same field; the full scope is stamped below.
  const scope = sessionScope(repo, sessionId, { startTs: p.startTs, endTs: p.endTs, host: 'claude' }, settings);
  // Mined ids that overlap the declared scope are trimmed TO the overlap
  // (same rule as captureDispatches: mining is the fallback, the scope is the
  // authority, and a phantom id would ride into batch-cost attribution); with
  // no overlap the mined set stands, so a stale scope cannot erase real work.
  const mined = mineIds(settings, [
    ...p.caseIds, ...subMeta.map((s) => s.description),
    ...subs.flatMap((s) => s.caseIds ?? []),
  ]);
  const declaredCases = scope?.cases ?? [];
  const scopedIds = (ids) => {
    if (!declaredCases.length || !ids?.length) return ids;
    const hit = ids.filter((c) => declaredCases.includes(c));
    return hit.length ? hit : ids;
  };
  const cases = [...new Set([...scopedIds(mined), ...declaredCases])].sort();
  // foldDispatchLog: keeps any dispatch the live log measured but the
  // transcripts can no longer produce (deleted/expired sub-agent file).
  return foldDispatchLog(repo, {
    v: LEDGER_VERSION, host: 'claude', id: sessionId,
    user: user ?? whoAmI(repo).slug,
    capturedAt: new Date().toISOString(),
    repo: basename(repo), branch: p.branch, role: p.role,
    models: [...models].sort(),
    startedAt: p.startTs ? new Date(p.startTs).toISOString() : null,
    endedAt: p.endTs ? new Date(p.endTs).toISOString() : null,
    // null-unobservable: a timestamp-less session's minutes are unknown, not 0 (Q8b)
    ...(migrationOn('null-unobservable') && p.startTs === null
      ? { wallMin: null, activeMin: null }
      : { wallMin: p.wallMin, activeMin: p.activeMin + subs.reduce((n, s) => n + s.activeMin, 0) }),
    turns: p.turns, toolCalls: p.toolCalls, toolErrors: p.toolErrors,
    tokens: p.usageSeen > 0 ? p.tokens : null, // parent only — sub-agent tokens live in subagents[]; null = the transcript reported no usage (unmeasured, not free)
    ...(p.usageSeen > 0 ? {} : { tokensAttributed: false }),
    // complete | partial | none — whether every unit (parent + subs) actually
    // reported usage. Anything short of complete means the totals are a FLOOR
    // (PR #63 mirror: a confident number is unrecoverable, a null is not).
    ...((() => {
      const flags = [p.usageSeen > 0, ...subs.map((x) => (x.usageSeen ?? 1) > 0)];
      return flags.every(Boolean) ? {} : { tokensAttribution: flags.some(Boolean) ? 'partial' : 'none' };
    })()),
    // PARENT-ONLY per-model quads (mirrors `tokens`); every subagents[] entry
    // carries its own — so batch-cost can weight them exactly like the scalar
    // totals (shared sessions, foreign-dispatch exclusion). Together they are
    // the dataset's tokens_by_model source — required whenever a run mixes
    // tiers, which ours always do (haiku triage + sonnet workers).
    tokensByModel: p.tokensByModel ?? {},
    costUsd, costSource: costUsd != null ? 'ccusage-metered' : 'none',
    cases,
    ...(scope ? { scope: scopeForLine(scope) } : {}),
    // One record PER DISPATCH (n:1), not a role roll-up: the label + per-file
    // costUsd are what lets batch-cost attribute work to individual cases.
    // Aggregating consumers (team-report byRole) sum records the same either way.
    // `cases` = ids mined from the dispatch's OWN transcript — batch-cost's
    // fallback when the label's 160-char window missed the id (ids only, so
    // this is always on, same rule as the session-level cases[]).
    subagents: subs.map((s) => ({
      // `id` is the dispatch's transcript id — the join key to the live
      // dispatch log (SubagentStop records) and to _returns receipts.
      ...(s.id ? { id: s.id } : {}), role: s.role, label: s.label, n: 1,
      tokens: (s.usageSeen ?? 1) > 0 ? s.tokens : null,
      ...((s.usageSeen ?? 1) > 0 ? {} : { tokensAttributed: false }),
      tokensByModel: s.tokensByModel ?? {}, activeMin: s.activeMin,
      toolCalls: s.toolCalls, toolErrors: s.toolErrors,
      ...((() => { const ids = hook(ext, 'receiptIds', { id: s.id }, { repo, settings }) ?? scopedIds(s.caseIds); return ids?.length ? { cases: ids } : {}; })()),
      ...(s.costUsd != null ? { costUsd: s.costUsd } : {}),
    })),
    skills: [...p.skills].sort(),
    // Count the sub-agents actually found, not the Agent-tool calls: a Workflow
    // run spawns its agents through the workflow runtime, so `p.dispatched`
    // (Agent tool_use blocks) reads 0 for a whole batch. Verified on a live
    // workflow session: 3 sub-agent transcripts, 0 Agent-tool calls.
    dispatches: Math.max(p.dispatched.length, subs.length),
    ...(cfg.capturePrompts ? { prompts: p.prompts, dispatched: p.dispatched } : {}),
  }, settings);
}

/**
 * Capture a session INTO THE LEDGER right now, without waiting for its end.
 *
 * The batch report is generated by the lead AT CLOSE — which happens INSIDE
 * the still-running session, so that session has no ledger line yet and the
 * report would omit the very work it describes (measured: a close from inside
 * the session reported $0 for a batch that cost real money). This is the same
 * append the SessionEnd hook performs, just earlier; the session's real end
 * appends a superseding line, and every reader dedupes latest-endedAt-wins, so
 * closing early costs nothing and double-counts nothing.
 */
export function captureSessionNow(repo, sessionId, { config, user, env = process.env, price = true, force = false, settings = loadSettings(repo), ext = null } = {}) {
  const cfg = config ?? loadConfig(repo, settings);
  const me = user ?? whoAmI(repo).slug;
  for (const dir of claudeProjectDirs(repo, env)) {
    const path = join(dir, `${sessionId}.jsonl`);
    if (!existsSync(path)) continue;
    const line = captureClaudeSession(repo, path, sessionId, { config: cfg, user: me, price, settings, ext, allowProbe: probeRun(env) });
    if (!line) return null;
    const prevEnd = knownSessions(repo, settings).get(`claude:${sessionId}`);
    const thisEnd = line.endedAt ? Date.parse(line.endedAt) : 0;
    // `force` re-appends even when the transcript hasn't grown — the guard
    // compares CONTENT freshness, but a capture-code upgrade (new fields like
    // tokensByModel) legitimately wants to re-emit the same transcript;
    // dedupLines keeps latest-by-capturedAt, so a forced line supersedes.
    if (force || prevEnd === undefined || thisEnd > prevEnd) appendLine(repo, me, line, settings);
    return line;
  }
  return null;
}

// --- Claude sweep (missed sessions — hard kills, other machines' pulls) ------
const PATH_SEPARATORS = /[/\\:._ ]/g;
export function encodeProjectPath(cwd) { return cwd.replace(PATH_SEPARATORS, '-'); }

export function claudeProjectDirs(repo, env = process.env) {
  if (env.TOKENOMICS_CLAUDE_ROOT) return [env.TOKENOMICS_CLAUDE_ROOT];
  const roots = [env.CLAUDE_CONFIG_DIR, join(homedir(), '.claude'), join(homedir(), '.config', 'claude')].filter(Boolean);
  const out = [];
  for (const r of roots) {
    const dir = join(r, 'projects', encodeProjectPath(repo));
    if (existsSync(dir)) out.push(dir);
  }
  return out;
}

// --- Copilot session parsing --------------------------------------------------
export function copilotRoots(repo, env = process.env) {
  if (env.TOKENOMICS_COPILOT_ROOT) {
    return existsSync(env.TOKENOMICS_COPILOT_ROOT) ? [env.TOKENOMICS_COPILOT_ROOT] : [];
  }
  const seen = new Set(); const out = [];
  for (const p of [
    env.COPILOT_HOME && join(env.COPILOT_HOME, 'session-state'),
    join(repo, '.copilot', 'session-state'),
    join(homedir(), '.copilot', 'session-state'),
  ]) {
    if (p && !seen.has(p) && existsSync(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

const CWD_PROBE_BYTES = 64 * 1024;
export function firstCwdOfEvents(eventsPath) {
  let fd;
  try {
    fd = openSync(eventsPath, 'r');
    const buf = Buffer.alloc(CWD_PROBE_BYTES);
    const n = readSync(fd, buf, 0, CWD_PROBE_BYTES, 0);
    const lines = buf.subarray(0, n).toString('utf8').split('\n');
    if (n === CWD_PROBE_BYTES) lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const rec = safeParse(line);
      if (rec?.type === 'session.start') return rec.data?.context?.cwd ?? null;
    }
  } catch { /* unreadable → unknown */ }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
  return null;
}

export function sameCwdOrUnder(sessionCwd, cwd) {
  if (!cwd) return true;
  if (!sessionCwd) return false;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const a = norm(sessionCwd); const b = norm(cwd);
  return a === b || a.startsWith(`${b}/`);
}

/**
 * One ledger line for a completed Copilot session. Returns null while the
 * session has no `session.shutdown` yet (still running — a later sweep gets it).
 * Cost is Copilot's own billed `totalNanoAiu` (credits × $0.01); sessions
 * predating usage-based billing carry tokens with costUsd null.
 */
export function captureCopilotSession(repo, eventsPath, sessionId, { config, user, settings = loadSettings(repo), ext = null, allowProbe = probeRun(process.env) } = {}) {
  const cfg = config ?? loadConfig(repo, settings);
  const events = readRecords(eventsPath).filter((r) => r.type);
  if (!allowProbe) { // R17: a probe session is never captured outside a probe
    const first = events.find((ev) => { const t = ev.type === 'user.message' ? copilotUserText(ev.data)?.trim() : null; return t && !t.startsWith('<'); });
    if (first && isProbeSession(copilotUserText(first.data).trim())) return null;
  }
  let shutdown = false;
  let branch = null; let nanoAiu = null; let role = null;
  const skills = new Set();
  const byModel = new Map(); const stamps = [];
  let turns = 0, toolCalls = 0, toolErrors = 0;
  const dispatched = []; const prompts = []; const caseTexts = [];
  const subStarted = new Map(); const subDesc = new Map(); const subs = [];
  for (const ev of events) {
    const d = ev.data ?? {};
    if (ev.timestamp) {
      const t = Date.parse(ev.timestamp);
      if (!Number.isNaN(t)) stamps.push(t);
    }
    if (ev.type === 'session.start') branch = d.context?.branch ?? branch;
    // The parent session's `--agent` — present on CLI ≥1.0.63 (verified live);
    // older streams lack the event and the line stays role:null.
    if (ev.type === 'subagent.selected') role = d.agentName ?? role;
    if (ev.type === 'skill.invoked' && d.name) skills.add(d.name);
    if (ev.type === 'session.shutdown') {
      shutdown = true;
      if (typeof d.totalNanoAiu === 'number') nanoAiu = d.totalNanoAiu;
      for (const [m, mm] of Object.entries(d.modelMetrics ?? {})) byModel.set(m, mm); // last shutdown wins
    }
    if (ev.type === 'subagent.started') {
      dispatched.push(d.agentName ?? 'unknown');
      subStarted.set(d.toolCallId, d.agentName ?? 'unknown');
      if (typeof d.agentDescription === 'string') {
        caseTexts.push(d.agentDescription.slice(0, 400));
        subDesc.set(d.toolCallId, d.agentDescription);
      }
    }
    if (ev.type === 'subagent.completed') {
      subs.push({
        role: d.agentName ?? subStarted.get(d.toolCallId) ?? 'unknown',
        label: deriveLabel(subDesc.get(d.toolCallId), '', ext, { repo, settings }),
        n: 1,
        // Copilot reports ONE cache-inclusive total per sub-agent — parked in
        // `input`, same convention as efficiency-audit. Read it as total tokens.
        // No per-dispatch dollars exist on Copilot (billing is one nano-AIU
        // figure at shutdown) — costUsd stays absent, and batch-cost reports
        // per-case tokens/time here, dollars only at batch level.
        tokens: copilotDispatchTokens(d),
        ...copilotDispatchCounters(d),
      });
    }
    if (!ev.agentId) { // parent-only counters; sub-agent work is summarized above
      if (ev.type === 'user.message' || ev.type === 'assistant.message') turns++;
      if (ev.type === 'tool.execution_start') toolCalls++;
      if (ev.type === 'tool.execution_complete' && d.success === false) toolErrors++;
      if (ev.type === 'user.message') {
        const text = typeof d.text === 'string' ? d.text : (typeof d.content === 'string' ? d.content : null);
        if (text && text.trim() && !text.trim().startsWith('<')) {
          caseTexts.push(text.slice(0, 1000)); // ids only survive ungated
          if (cfg.capturePrompts && prompts.length < PROMPT_MAX_COUNT) {
            prompts.push({ t: ev.timestamp || null, text: text.trim().slice(0, PROMPT_MAX_CHARS) });
          }
        }
      }
    }
  }
  if (!shutdown) return null;
  const nu = migrationOn('null-unobservable');
  let tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Set();
  let usageSeen = false;
  for (const [m, mm] of byModel) {
    const u = mm.usage ?? {};
    if (['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].some((k) => typeof u[k] === 'number')) usageSeen = true;
    tokens.input += num(u.inputTokens); tokens.output += num(u.outputTokens);
    tokens.cacheRead += num(u.cacheReadTokens); tokens.cacheWrite += num(u.cacheWriteTokens);
    models.add(m);
  }
  // The session totals INCLUDE sub-agents — net the parent so line totals add
  // up as parent + Σ subagents, same convention as the Claude path.
  // copilot-inclusive: the host total is stored un-netted under tokensBasis "inclusive" (§3.2.1)
  const ci = migrationOn('copilot-inclusive');
  if (!ci) {
    const subTotal = subs.reduce((n, s) => n + s.tokens.input, 0);
    tokens.input = Math.max(0, tokens.input - subTotal);
  }
  // null-unobservable: a shutdown whose modelMetrics carry no usage is unmeasured, not free (§10.5)
  if (nu && !usageSeen) tokens = null;
  const t = timeStats(stamps);
  const noStamps = nu && t.startTs === null;   // Q8b: a timestamp-less session's minutes are unknown
  const usd = nanoAiu === null ? null : (nanoAiu / 1e9) * USD_PER_CREDIT;
  // Copilot's agent cannot know its session id, so its declared scopes arrive
  // as `open --session auto` pendings — claimed here by time window.
  const scope = sessionScope(repo, sessionId, { startTs: t.startTs, endTs: t.endTs, host: 'copilot' }, settings);
  return {
    v: LEDGER_VERSION, host: 'copilot', id: sessionId,
    user: user ?? whoAmI(repo).slug,
    capturedAt: new Date().toISOString(),
    repo: basename(repo), branch, role,
    models: [...models].sort(),
    startedAt: t.startTs ? new Date(t.startTs).toISOString() : null,
    endedAt: t.endTs ? new Date(t.endTs).toISOString() : null,
    wallMin: noStamps ? null : t.wallMin, activeMin: noStamps ? null : t.activeMin,
    turns, toolCalls, toolErrors,
    tokens,
    ...(ci ? { tokensBasis: 'inclusive' } : {}),
    ...((() => { const att = nu && tokens === null ? attributionOf({ tokens, subagents: subs, ...(ci ? { tokensBasis: 'inclusive' } : {}) }) : undefined; return att ? { tokensAttribution: att } : {}; })()),
    costUsd: usd, costSource: usd != null ? 'copilot-nano-aiu' : 'none',
    cases: [...new Set([...mineIds(settings, [branch, ...caseTexts]), ...(scope?.cases ?? [])])].sort(),
    ...(scope ? { scope: scopeForLine(scope) } : {}),
    subagents: subs, // per-dispatch (n:1) with label — same shape as the Claude path
    skills: [...skills].sort(), dispatches: dispatched.length,
    ...(cfg.capturePrompts ? { prompts } : {}),
  };
}

// --- VS Code Copilot sidebar (chatSessions op-log) ---------------------------
// The sidebar's sessions live in VS Code's own storage:
//   <userData>/User/workspaceStorage/<hash>/chatSessions/<id>.jsonl
// Files are an OP-LOG, not a document: `{v}` snapshot lines, `{k:"requests",v}`
// full-array rewrites, and `{k:"requests,<idx>,<field>",v}` path updates that
// REWRITE a field as the request streams (observed: copilotCredits written 25×
// for one request). Correct totals need last-write-wins replay per request —
// summing raw matches overcounts streaming rewrites ~3× (measured).

/** Every workspaceStorage root that exists — search, never assume one path. */
export function vscodeStorageRoots(repo, env = process.env, config = {}) {
  if (env.TOKENOMICS_VSCODE_ROOT) {
    return existsSync(env.TOKENOMICS_VSCODE_ROOT) ? [env.TOKENOMICS_VSCODE_ROOT] : [];
  }
  const home = homedir();
  const bases = [];
  if (process.platform === 'darwin') bases.push(join(home, 'Library', 'Application Support'));
  if (env.APPDATA) bases.push(env.APPDATA);              // Windows
  bases.push(join(home, '.config'));                     // Linux
  const out = new Set();
  for (const base of bases) {
    for (const product of ['Code', 'Code - Insiders', 'VSCodium']) {
      const d = join(base, product, 'User', 'workspaceStorage');
      if (existsSync(d)) out.add(d);
    }
  }
  const server = join(home, '.vscode-server', 'data', 'User', 'workspaceStorage'); // WSL / remote
  if (existsSync(server)) out.add(server);
  for (const extra of config.vscodeUserDataDirs ?? []) {
    const cands = basename(extra) === 'workspaceStorage'
      ? [extra]
      : [join(extra, 'User', 'workspaceStorage'), join(extra, 'workspaceStorage')];
    for (const d of cands) if (existsSync(d)) { out.add(d); break; }
  }
  return [...out];
}

function fileUriToPath(uri) {
  if (typeof uri !== 'string' || !uri) return null;
  if (!uri.startsWith('file://')) return uri;
  let p = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  if (/^\/[A-Za-z]:[/\\]/.test(p)) p = p.slice(1); // windows /C:/... -> C:/...
  return p;
}

/** The folder a workspaceStorage hash belongs to — ONLY via its workspace.json. */
export function workspaceFolderOf(hashDir) {
  try {
    const wj = safeParse(readFileSync(join(hashDir, 'workspace.json'), 'utf8'));
    return fileUriToPath(wj?.folder ?? wj?.workspace ?? null);
  } catch { return null; }
}

const VSCODE_REQ_FIELDS = ['promptTokens', 'completionTokens', 'copilotCredits', 'modelId', 'elapsedMs', 'timestamp'];

/**
 * Replay a chatSessions op-log into final per-request records. A custom agent
 * session names its agent via modeInfo.modeInstructions.uri — the basename of
 * `.github/agents/<role>.agent.md` (verified live) — builtin modes carry none.
 */
export function parseVsCodeChatSession(text, { capturePrompts = false, settings = TA_DEFAULTS } = {}) {
  const state = []; // the requests array, replayed — ops splice/set into it
  let title = null; // customTitle op — VS Code's own session name
  const toRec = (q) => {
    if (!q || typeof q !== 'object' || !q.requestId) return null;
    const rec = { requestId: q.requestId };
    for (const f of VSCODE_REQ_FIELDS) if (q[f] !== undefined) rec[f] = q[f];
    const mi = q.modeInfo;
    if (mi && mi.isBuiltin === false) {
      const uri = mi.modeInstructions?.uri?.external ?? mi.modeInstructions?.uri?.path ?? '';
      const base = String(uri).split('/').pop() ?? '';
      const role = base.replace(/\.(agent|chatmode|prompt)\.md$/, '').replace(/\.md$/, '');
      if (role) rec.role = role;
    }
    if (q.result?.errorDetails) rec.errored = true;
    const m = q.message;
    const t = typeof m === 'string' ? m : (typeof m?.text === 'string' ? m.text : null);
    if (t && t.trim()) {
      rec.messageText = t.trim().slice(0, 1000); // ids mined ungated; text stored only under capturePrompts
      if (capturePrompts) rec.prompt = t.trim().slice(0, PROMPT_MAX_CHARS);
    }
    return rec;
  };
  const replaceAll = (arr) => { state.length = 0; for (const q of arr) { const rec = toRec(q); if (rec) state.push(rec); } };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const r = safeParse(line);
    if (!r || typeof r !== 'object') continue;
    // Live format (measured): k is an ARRAY of path segments; a string k is
    // tolerated for older/other writers. kind 2 + i = insert at index.
    const key = Array.isArray(r.k) ? r.k : (typeof r.k === 'string' ? r.k.split(',') : null);
    if (key === null) { // snapshot line
      if (r.v && typeof r.v === 'object') {
        if (typeof r.v.customTitle === 'string') title = r.v.customTitle;
        if (Array.isArray(r.v.requests)) replaceAll(r.v.requests);
      }
      continue;
    }
    if (key.length === 1 && key[0] === 'customTitle' && typeof r.v === 'string') { title = r.v; continue; }
    if (key.length === 1 && key[0] === 'requests' && Array.isArray(r.v)) {
      const recs = r.v.map(toRec).filter(Boolean);
      if (r.kind === 2 || typeof r.i === 'number') state.splice(typeof r.i === 'number' ? r.i : state.length, 0, ...recs);
      else replaceAll(r.v);
      continue;
    }
    if (key.length === 3 && key[0] === 'requests' && VSCODE_REQ_FIELDS.includes(String(key[2]))) {
      const idx = Number(key[1]);
      if (Number.isInteger(idx) && idx >= 0) {
        state[idx] = state[idx] ?? {};
        state[idx][String(key[2])] = r.v;
      }
    }
  }
  // Pre-oplog format: the whole session as one JSON document.
  if (!state.length) {
    const whole = safeParse(text);
    if (whole && Array.isArray(whole.requests)) replaceAll(whole.requests);
  }
  // A re-sent array op can duplicate a request at a new index — merge by
  // requestId, later occurrence wins, so nothing is ever counted twice.
  const byReqId = new Map();
  for (const r of state) {
    // capture-robustness (item 16): an update two or more past the end leaves a hole; ignore it
    if (r === undefined && migrationOn('capture-robustness')) continue;
    if (!r.requestId) continue;
    byReqId.set(r.requestId, { ...byReqId.get(r.requestId), ...r });
  }
  const reqs = [...byReqId.values()];
  if (!reqs.length) return null;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Set(); const stamps = []; const prompts = [];
  let credits = 0; let creditSeen = false; let role = null; let activeMs = 0; let errs = 0; let usageSeen = false;
  for (const r of reqs) {
    if (typeof r.promptTokens === 'number' || typeof r.completionTokens === 'number') usageSeen = true;
    tokens.input += num(r.promptTokens);
    tokens.output += num(r.completionTokens);
    if (typeof r.copilotCredits === 'number') { credits += r.copilotCredits; creditSeen = true; }
    if (r.modelId) models.add(String(r.modelId).replace(/^copilot\//, ''));
    if (!role && r.role) role = r.role;
    activeMs += num(r.elapsedMs);
    if (typeof r.timestamp === 'number') {
      stamps.push(r.timestamp);
      if (num(r.elapsedMs)) stamps.push(r.timestamp + num(r.elapsedMs));
    }
    if (r.errored) errs++;
    if (r.prompt && prompts.length < PROMPT_MAX_COUNT) prompts.push({ t: typeof r.timestamp === 'number' ? new Date(r.timestamp).toISOString() : null, text: r.prompt });
  }
  return {
    requests: reqs.length, tokens, usageSeen, credits: creditSeen ? credits : null, role, models, prompts,
    title: title ? title.slice(0, 80) : null,
    cases: mineIds(settings, [title, ...reqs.map((r) => r.messageText)]),
    activeMin: Math.round(activeMs / 60000),
    startTs: stamps.length ? Math.min(...stamps) : null,
    endTs: stamps.length ? Math.max(...stamps) : null,
    toolErrors: errs,
  };
}

/**
 * One ledger line for a sidebar chat session. `copilotCredits` is the billed
 * figure (extension ≥0.57.0); older files carry tokens only — costUsd null,
 * never an estimate. NOTE the caveat from the field: locally recorded prompt
 * tokens can undercount server-side hidden context; credits are the anchor.
 */
export function captureVsCodeSession(repo, filePath, sessionId, { config, user, settings = loadSettings(repo) } = {}) {
  const cfg = config ?? loadConfig(repo, settings);
  const p = parseVsCodeChatSession(readFileSync(filePath, 'utf8'), { capturePrompts: cfg.capturePrompts, settings });
  if (!p) return null;
  const usd = p.credits === null ? null : p.credits * USD_PER_CREDIT;
  // The sidebar has no hooks, so a declared scope ALWAYS arrives as a pending
  // record (`open --session auto`) — the same time-window claim the other two
  // hosts use is the only join there is. Without it every sidebar session
  // reports as undeclared no matter what the user declared.
  const scope = sessionScope(repo, sessionId, { startTs: p.startTs, endTs: p.endTs, host: 'copilot-vscode' }, settings);
  // null-unobservable (§10.5, §7.2): tool calls and skills are not observable on this host, usage-less requests
  // are unmeasured, and a timestamp-less session's minutes are unknown (Q8b). A missing elapsedMs stays 0 (Q8c),
  // and the cache categories stay 0 (Q8a).
  const nu = migrationOn('null-unobservable');
  const noStamps = nu && p.startTs === null;
  const unmeasured = nu && !p.usageSeen;
  return {
    v: LEDGER_VERSION, host: 'copilot-vscode', id: sessionId,
    user: user ?? whoAmI(repo).slug,
    capturedAt: new Date().toISOString(),
    repo: basename(repo), branch: null, role: p.role,
    models: [...p.models].sort(),
    startedAt: p.startTs ? new Date(p.startTs).toISOString() : null,
    endedAt: p.endTs ? new Date(p.endTs).toISOString() : null,
    wallMin: noStamps ? null : (p.startTs && p.endTs ? Math.round((p.endTs - p.startTs) / 60000) : 0),
    activeMin: noStamps ? null : p.activeMin,
    turns: p.requests, toolCalls: nu ? null : 0, toolErrors: p.toolErrors,
    tokens: unmeasured ? null : p.tokens,
    ...(unmeasured ? { tokensAttribution: 'none' } : {}),
    costUsd: usd, costSource: usd != null ? 'copilot-credits' : 'none',
    title: p.title,
    cases: [...new Set([...p.cases, ...(scope?.cases ?? [])])].sort(),
    subagents: [],
    skills: nu ? null : [], dispatches: 0,
    ...(scope ? { scope: scopeForLine(scope) } : {}),
    ...(cfg.capturePrompts ? { prompts: p.prompts } : {}),
  };
}

// --- OTel sink bootstrap (fire-and-forget) -----------------------------------
/**
 * When the team opted into OTel with a LOCALHOST endpoint, make sure something
 * is listening: blindly spawn the bundled stdlib sink, detached — it exits
 * instantly (code 0) if the port is already taken, so no probe is needed and
 * the hook stays synchronous. A remote collector is never ours to run.
 */
export function ensureSink(otel, env = process.env, repo = undefined) {
  try {
    const url = new URL(otel?.endpoint || 'http://localhost:4318');
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) return false;
    const sink = join(dirname(fileURLToPath(import.meta.url)), 'otel-sink.mjs');
    const child = spawn(process.execPath, [sink, '--port', url.port || '4318'], {
      // the sink gates on this repo's activation (D-ACT): run it there
      detached: true, stdio: 'ignore', env: repo ? { ...env, CLAUDE_PROJECT_DIR: repo } : { ...env }, ...(repo ? { cwd: repo } : {}),
    });
    child.unref();
    return true;
  } catch { return false; }
}

// --- Sweep -------------------------------------------------------------------
/**
 * Harvest completed-but-uncaptured sessions for this repo, both hosts.
 * Bounded to `max` new captures per invocation unless `all` (a first run after
 * install can face a month of history; a hook must stay quick). Skips
 * transcripts modified in the last 2 minutes — likely still running.
 *
 * A session already in the ledger is NOT frozen at its first snapshot: when
 * its source file has grown past the recorded end (+margin) — a resumed /
 * continued session that spent more after capture — it is re-parsed, and a
 * superseding line is appended if the new `endedAt` actually advanced (the
 * same guard the direct-capture path uses, so a stale re-parse never appends
 * a duplicate). The report side keeps the latest line per `host:id`
 * (team-report `dedupLines`), so totals follow the session's real life.
 */
export function sweep(repo, { config, user, all = false, env = process.env, now = Date.now(), settings = loadSettings(repo), ext = null } = {}) {
  const cfg = config ?? loadConfig(repo, settings);
  const me = user ?? whoAmI(repo).slug;
  const known = knownSessions(repo, settings);
  const growth = migrationOn('capture-robustness') ? knownGrowth(repo, settings) : null;
  const max = all ? Infinity : cfg.maxSweep;
  let captured = 0, skipped = 0;
  const budgetLeft = () => captured < max;

  // Append only when the parsed line's end actually advanced past what the
  // ledger already has — a grown-but-stale re-parse (mtime bumped, no new
  // spend) must not write a duplicate row.
  const appendIfNewer = (key, line, mtime) => {
    const knownEnd = known.get(key);
    const thisEnd = line.endedAt ? Date.parse(line.endedAt) : 0;
    known.set(key, Math.max(mtime, thisEnd));
    if (knownEnd !== undefined && thisEnd <= knownEnd) return false;
    appendLine(repo, me, line, settings);
    captured++;
    return true;
  };

  // Claude: this repo's project dir(s) — top-level *.jsonl are the sessions.
  for (const projDir of claudeProjectDirs(repo, env)) {
    let files;
    try { files = readdirSync(projDir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files.sort()) {
      const id = basename(f, '.jsonl');
      const full = join(projDir, f);
      let mtime;
      try { mtime = statSync(full).mtimeMs; } catch { continue; }
      if (now - mtime < LIVE_GRACE_MS) continue; // likely live
      const knownEnd = known.get(`claude:${id}`);
      if (knownEnd !== undefined && mtime <= knownEnd + RECAPTURE_MARGIN_MS) continue; // captured, no growth since
      if (!budgetLeft()) { skipped++; continue; }
      try {
        const line = captureClaudeSession(repo, full, id, { config: cfg, user: me, settings, ext, allowProbe: probeRun(env) });
        if (line) appendIfNewer(`claude:${id}`, line, mtime);
      } catch { /* one bad transcript never stops the sweep */ }
    }
  }

  // Copilot: pooled store, cwd-filtered by a bounded head probe before parsing.
  // No live-grace here — captureCopilotSession returns null until the stream
  // carries a session.shutdown, and a resumed session writes a NEW shutdown
  // (last one wins), which is exactly what the growth re-capture picks up.
  for (const root of copilotRoots(repo, env)) {
    let ids;
    try { ids = readdirSync(root); } catch { continue; }
    for (const id of ids.sort()) {
      const eventsPath = join(root, id, 'events.jsonl');
      if (!existsSync(eventsPath)) continue;
      let mtime;
      try { mtime = statSync(eventsPath).mtimeMs; } catch { continue; }
      const knownEnd = known.get(`copilot:${id}`);
      if (knownEnd !== undefined && mtime <= knownEnd + RECAPTURE_MARGIN_MS) continue; // captured, no growth since
      if (!sameCwdOrUnder(firstCwdOfEvents(eventsPath), repo)) continue;
      if (!budgetLeft()) { skipped++; continue; }
      try {
        const line = captureCopilotSession(repo, eventsPath, id, { config: cfg, user: me, settings, ext, allowProbe: probeRun(env) });
        if (line) appendIfNewer(`copilot:${id}`, line, mtime);
      } catch { /* ditto */ }
    }
  }

  // VS Code sidebar: chatSessions op-logs, matched to this repo through each
  // hash's workspace.json (both directions — the workspace may be the repo, a
  // subfolder, or a parent monorepo folder). These files have no completion
  // marker, so a session captured mid-life is simply RE-captured once the file
  // grows (mtime newer than the recorded end) — same growth rule as above.
  for (const root of vscodeStorageRoots(repo, env, cfg)) {
    let hashes;
    try { hashes = readdirSync(root); } catch { continue; }
    for (const hash of hashes.sort()) {
      const hashDir = join(root, hash);
      const folder = workspaceFolderOf(hashDir);
      if (!folder || !(sameCwdOrUnder(folder, repo) || sameCwdOrUnder(repo, folder))) continue;
      const dir = join(hashDir, 'chatSessions');
      let files;
      try { files = readdirSync(dir).filter((f) => /\.jsonl?$/.test(f)); } catch { continue; }
      for (const f of files.sort()) {
        const id = f.replace(/\.jsonl?$/, '');
        const key = `copilot-vscode:${id}`;
        const full = join(dir, f);
        let mtime;
        try { mtime = statSync(full).mtimeMs; } catch { continue; }
        if (now - mtime < LIVE_GRACE_MS) continue; // likely mid-chat
        const knownEnd = known.get(key);
        if (knownEnd !== undefined && mtime <= knownEnd + RECAPTURE_MARGIN_MS) continue; // no growth
        if (!budgetLeft()) { skipped++; continue; }
        try {
          const line = captureVsCodeSession(repo, full, id, { config: cfg, user: me, settings });
          if (line) {
            // capture-robustness (item 17): append only when the end advanced or the session gained turns or
            // tokens; a timestamp-less session (endedAt null, read back as 0) otherwise re-appends on every sweep.
            // Readers keep the latest line per host:id (capturedAt breaks the endedAt tie), so a grown re-append
            // supersedes the earlier line and is not double-counted.
            if (growth && knownEnd !== undefined) {
              const prev = growth.get(key);
              const changed = !prev || measurementState(line) !== measurementState(prev);
              if ((line.endedAt ? Date.parse(line.endedAt) : 0) <= knownEnd && !changed) { known.set(key, Math.max(knownEnd, mtime)); continue; }
              // A superseding line must rank strictly after the one it replaces, or an equal-rank pair with a
              // different payload would read as a report-conflicts conflict.
              if (prev && msOf(line.capturedAt) <= msOf(prev.capturedAt)) line.capturedAt = new Date(msOf(prev.capturedAt) + 1).toISOString();
            }
            appendLine(repo, me, line, settings); known.set(key, mtime); captured++;
            if (growth) noteGrowth(growth, key, line);
          }
        } catch { /* one bad file never stops the sweep */ }
      }
    }
  }
  return { captured, skipped };
}

// --- CLI / hook entry ---------------------------------------------------------
// A probe run reads stdin up front (bounded) so its fired record can name the event and session (R21, R22); every
// later read in that run sees the same text. A plain run reads stdin only where it always did.
let stdinRead;
function readStdinJson() {
  if (stdinRead !== undefined) return stdinRead.trim() ? safeParse(stdinRead) : null;
  try {
    if (process.stdin.isTTY) return null;
    const txt = readFileSync(0, 'utf8');
    return txt.trim() ? safeParse(txt) : null;
  } catch { return null; }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  // D-PROBE: the fired record comes first, before the gate — an inert hook still proves it fired
  if (probing(env)) { stdinRead = await readStdinBounded(); recordFired('telemetry-capture', argv, env, readStdinJson()); }
  const repo = arg('--cwd') || env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!gateOrExplain(ENGINE_ROOT, repo, env)) return 0; // activation (D-ACT): inert or refused reads and writes nothing
  const settings = loadSettings(repo);
  const ext = await loadExtension(settings, repo);
  const cfg = loadConfig(repo, settings);
  const me = whoAmI(repo).slug;
  let captured = 0;

  // OTel opted in with a localhost endpoint → make sure the sink is up.
  if (cfg.otel?.enabled && env.TOKENOMICS_NO_SINK !== '1') ensureSink(cfg.otel, env, repo);

  // cost.json is deliberately NOT refreshed here. It is a committed record in
  // the MAIN tree, and rewriting a tracked file on every session end dirtied
  // the tree at arbitrary moments (gate refusals, checkout conflicts — field
  // incidents). It is a pure derivation with no data of its own: the live view
  // (work-scope status, team-report --batch) recomputes it on the fly, and the
  // on-disk record is written once, at close, in the same breath as the commit.

  // SubagentStop: measure the dispatch that just finished (one transcript,
  // one meter) and append it to the session's live dispatch log. Cheap by
  // construction — it never touches the other transcripts or the ledger.
  if (argv.includes('--dispatch')) {
    const payload = readStdinJson() ?? {};
    const sid = arg('--session') || payload.session_id || payload.sessionId;
    if (!sid) return 0;
    // SubagentStop's transcript_path names the PARENT transcript (field lesson
    // in workflow-return.mjs), so its dirname IS the Claude project dir.
    const tp = arg('--transcript') || payload.transcript_path || payload.transcriptPath;
    const n = captureDispatches(repo, sid, {
      projectDir: tp ? dirname(tp) : undefined,
      config: cfg, env,
      agentId: arg('--agent') || payload.agent_id || payload.agentId || null,
      settings, ext,
    });
    if (n) {
      process.stderr.write(`tokenomics: recorded ${n} finished dispatch(es) for ${sid}\n`);
      await renderLiveReport(repo, sid, env, settings, ext); // the live batch page tracks every landing
    }
    return 0;
  }

  if (argv.includes('--sweep')) {
    // --ended: the caller knows the sessions it sweeps for are over (the probe, after its child exited), so the live
    // grace that skips a freshly written transcript does not apply.
    const r = sweep(repo, { config: cfg, user: me, all: argv.includes('--all'), env, settings, ext, ...(argv.includes('--ended') ? { now: Infinity } : {}) });
    process.stderr.write(`tokenomics: swept ${r.captured} session(s)${r.skipped ? `, ${r.skipped} deferred (bounded — rerun or use --all)` : ''}\n`);
    if (r.captured) {
      // Copilot's sessionEnd runs THIS path (no transcript flags), so the
      // live page's final overwrite — now with the session's billed credits —
      // happens here; render before sync so the page rides the same commit.
      const payload = readStdinJson() ?? {};
      const sid = arg('--session') || payload.session_id || payload.sessionId;
      if (sid) await renderLiveReport(repo, sid, env, settings, ext);
      syncTelemetry(repo, env);
    }
    return 0;
  }

  // Direct capture: explicit flags (tests/manual) or Claude SessionEnd stdin.
  let transcript = arg('--transcript');
  let sessionId = arg('--session');
  if (!transcript) {
    const payload = readStdinJson();
    if (payload?.transcript_path) {
      transcript = payload.transcript_path;
      sessionId = payload.session_id || basename(payload.transcript_path, '.jsonl');
    }
  }
  if (transcript && existsSync(transcript)) {
    const id = sessionId || basename(transcript, '.jsonl');
    const known = knownSessions(repo, settings);
    const line = captureClaudeSession(repo, transcript, id, { config: cfg, user: me, settings, ext, allowProbe: probeRun(env) });
    if (line) {
      const prevEnd = known.get(`claude:${id}`);
      const thisEnd = line.endedAt ? Date.parse(line.endedAt) : 0;
      if (prevEnd === undefined || thisEnd > prevEnd) { appendLine(repo, me, line, settings); captured++; }
      // The real ledger line supersedes the live dispatch log — drop it so the
      // transient file never outlives the session it described.
      try { rmSync(dispatchLogPath(repo, id, settings), { force: true }); } catch { /* fine */ }
    }
  }
  // Every capture moment is also a harvest moment (Copilot sessions, hard-killed
  // Claude ones) — bounded, so the hook stays quick.
  const r = sweep(repo, { config: cfg, user: me, env, settings, ext });
  // Name the ledger directory actually written: the repo-relative `.agents/telemetry/<dir>`, or the absolute state dir during a probe.
  const tdir = telemetryDir(repo, settings, env);
  process.stderr.write(`tokenomics: captured ${captured + r.captured} session(s) → ${tdir.startsWith(repo + sep) ? tdir.slice(repo.length + 1) : tdir}/usage-${me}.jsonl\n`);
  if (sessionId) await renderLiveReport(repo, sessionId, env, settings, ext); // final overwrite from the completed ledger line
  if (captured + r.captured) syncTelemetry(repo, env);
  return 0;
}

/**
 * The LIVE batch page: telemetry/reports/<batch>.html (telemetry/reports-live/<batch>.html under reports-location), overwritten in place on
 * every finished dispatch and at session end. Same renderer as the close-time
 * report, fed by ledger + live-log lines (no metering here — the dispatch
 * capture already priced what it could), so mid-run it reads LIVE/PROVISIONAL
 * and converges to the close-time figures. Lives on the telemetry side: a
 * mid-run write into the batch dir would dirty the main tree.
 * TOKENOMICS_NO_BATCH_COST=1 disables (hermetic tests, cost-averse hooks).
 */
export async function renderLiveReport(repo, sessionId, env = process.env, settings = loadSettings(repo), ext = null) {
  if (env.TOKENOMICS_NO_BATCH_COST === '1') return null;
  try {
    // scope-resolution: the host is not known here — the session's only record, read without a claim
    const scope = sessionScope(repo, sessionId, { quiet: true }, settings);
    if (!scope?.batch) return null;
    const { updateBatchCosts } = await import('../scripts/batch-cost.mjs');
    const { renderBatchHtml } = await import('../scripts/team-report.mjs');
    // Same resolve as close: the declared batch, else every group the extension matches to it.
    let costs = updateBatchCosts(repo, { batch: scope.batch, write: false }, settings, ext);
    if (!costs.length) {
      costs = updateBatchCosts(repo, { write: false }, settings, ext)
        .filter((c) => hook(ext, 'enrichGroup', c, { repo, settings, phase: 'match', scope }) ?? c.batch === scope.batch);
    }
    if (!costs.length) return null;
    const out = [];
    for (const c of costs) {
      const p = liveReportPath(repo, settings, c.batch);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, `${renderBatchHtml(c, settings, ext)}\n`);
      out.push(p);
    }
    return out;
  } catch { return null; }
}

/**
 * Share what was just captured: commit + push INSIDE the telemetry submodule.
 * Its own branch — the main tree never moves. Best-effort by design: no
 * submodule (plain-dir fallback), no git, no network — silently skip; the
 * next capture moment catches up. TOKENOMICS_NO_SYNC=1 disables.
 */
export function syncTelemetry(repo, env = process.env) {
  if (env.TOKENOMICS_NO_SYNC === '1') return false;
  // The submodule ROOT — shared across factories; this factory's data lives in
  // its automation/ subfolder, but commit/push covers whatever anyone wrote.
  const dir = join(repo, '.agents', 'telemetry');
  if (!existsSync(join(dir, '.git'))) return false;   // not a submodule — nothing to sync
  const git = (args, timeout = 15000) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout });
  try {
    git(['add', '-A']);
    const dirty = git(['status', '--porcelain']).trim();
    if (dirty) git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'commit', '-m', 'telemetry: capture']);
    // A freshly-cloned submodule sits DETACHED at the recorded pointer — the
    // commit above would be stranded there. Pin the branch to wherever we
    // are NOW (always safe: the tree is clean right after the commit), then
    // converge with the remote below as usual.
    if (git(['branch', '--show-current']).trim() !== 'telemetry') git(['checkout', '-B', 'telemetry']);
    try { git(['push', 'origin', 'HEAD:telemetry'], 20000); } catch {
      // non-fast-forward (a teammate pushed) → converge and retry once.
      // Per-user/per-session files make the merge conflict-free by design.
      try {
        git(['fetch', 'origin', 'telemetry'], 20000);
        git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'merge', '--no-edit', 'FETCH_HEAD']);
        git(['push', 'origin', 'HEAD:telemetry'], 20000);
      } catch { /* offline or a real race — the next capture moment retries */ }
    }
    return true;
  } catch { return false; }
}

const entryOn = entryPointsOn(ENGINE_ROOT); // items 12/13: realpath main guard, exit after stdio drains (a refused copy never parses the variable)
if (entryOn ? isMain(import.meta.url) : (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  let code = 0;
  try { code = await main(); }
  catch (err) { process.stderr.write(`tokenomics: capture failed (session unaffected): ${err?.message || err}\n`); }
  if (entryOn) await exitAfterDrain(code); // flushes stdio, then exits
  process.exit(code); // never non-zero — a telemetry hook must not break the host session
}
