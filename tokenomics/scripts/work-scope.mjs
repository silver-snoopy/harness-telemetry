#!/usr/bin/env node
// work-scope.mjs — a session's own declaration of WHAT it is working on,
// written at the moment the work begins, not reconstructed after the fact.
//
//   node work-scope.mjs open    --session <id> [--intent automation] [--batch <slug>]
//                               [--cases ID,ID,…] [--source tms|manual-qa|…] [--repo <root>]
//   node work-scope.mjs outcome --session <id> ID=outcome [ID=outcome …]
//   node work-scope.mjs close   --session <id>   # also renders the batch report
//   node work-scope.mjs status  --session <id>   #   (<batch dir>/batch-report.md)
//   node work-scope.mjs show    --session <id>   #   and prints any receipt drift
//   node work-scope.mjs list    [--open]
//
// `status` is the LIVE read: what this still-running session has spent and
// which dispatches have finished. Nothing is written — the ledger stays
// session-grain and lands at session end (`--fast` skips metering).
//
// One JSON file per session at .agents/telemetry/automation/scopes/<session>.json —
// committed like the ledger, so scope survives transcript expiry and travels
// with the repo. The capture hook joins it to the session's ledger line, which
// replaces regex-guessing for declared sessions and lets reports split
// automation spend from everything else.
//
// DELIBERATELY GENERIC — nothing here is automation-specific:
//   * `intent` is an open string ('automation', 'manual-testing', 'other', …),
//     so the manual-qa factory can adopt the identical record.
//   * case ids are opaque ('ELITEA-2312', 'TC-101' — any shape).
//   * `outcomes` vocabulary is open ('automated'/'blocked' here,
//     'PASS'/'FAIL' for a manual run) — consumers filter by intent.
//
// The session id comes from the SessionStart announce hook (scope-hook.mjs
// prints it into context) or CLAUDE_SESSION_ID. A host where neither exists
// (Copilot) may pass --session auto: the file is created as pending-<stamp>
// and the capture sweep claims it for the real session by time window.
//
// B2 item 9 (scope-resolution, spec §14.11): records are host-qualified,
// scopes/<host>/<session>.json (a legacy flat scopes/<session>.json is still
// read and updated in place). `--host <claude|copilot|copilot-vscode>` names
// the host (default below), and `open` without one (and without --session auto)
// is a usage error.
// `open --session auto` prints {"handle":"pending-…"} on stdout; `outcome` and
// `close` accept that handle before and after the capture claims the record;
// `auto` is valid only on `open`; with a known host the pending record lives in
// that host's directory and only that host's sessions claim it. The host
// default: COPILOT_CLI=1 → copilot, then CLAUDE_* → claude. `open --role <name>` stores the declaring
// orchestrator's role. `restamp --host <h> --session <id>` re-appends the winning
// ledger line with the session's corrected scope, keeping its original `writer`
// and `manifestRevision` and setting `restampedBy` (B2 item 11, map O7).
//
// STDLIB ONLY. Idempotent: re-open merges, outcomes overwrite per id.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSettings, telemetryDir, receiptsRoot, groupReportsDir, TA_DEFAULTS, words } from '../engine/config.mjs';
import { hook, loadExtension } from '../engine/extension.mjs';
import { migrationOn } from '../engine/migrations.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { engineRootOf, entryPointsOn, gateOrExplain } from '../engine/activation.mjs';
import { canonical, accountingPayload } from '../kit/canonical.mjs';
import { SCOPE_HOSTS, hostFromEnv, locateScope, claimedScopePath, pendingScopePath, scopeForLine } from '../engine/scopes.mjs';

const ENGINE_ROOT = engineRootOf(import.meta.url);
const WRITING = new Set(['open', 'outcome', 'close', 'restamp']); // activation-gated (D-ACT); status/show/list only read

export const SCOPE_VERSION = 1;

export function scopesDir(repo, settings = loadSettings(repo)) { return join(telemetryDir(repo, settings), 'scopes'); }
/** The flat path (reference; a pending record), or `scopes/<host>/<session>.json` with a host (scope-resolution). */
export function scopePath(repo, session, settings = loadSettings(repo), host = null) {
  return host ? join(scopesDir(repo, settings), host, `${session}.json`) : join(scopesDir(repo, settings), `${session}.json`);
}

const isHandle = (sid) => sid.startsWith('pending-');
const HOST_HINT = `--host <${SCOPE_HOSTS.join('|')}> (no COPILOT_CLI=1 or CLAUDE_SESSION_ID/CLAUDE_PROJECT_DIR to default it from)`;
const HOST_REQUIRED = `a host is required — ${HOST_HINT}, or --session auto on a host without a session id`;
/**
 * scope-resolution: the record `open`/`outcome`/`close`/`show` act on (§14.11). A pending handle names its pending
 * record before the capture claims it, the claimed record (`claimedFrom` = handle) after; a session id names its own
 * record (`<host>/<id>.json`, or the legacy flat one when it is the only one). `path` is where a new record goes when
 * none exists (null without a host); `ambiguous` lists an id's records in more than one place.
 */
export function scopeRecordPath(repo, sid, host, settings = loadSettings(repo)) {
  if (isHandle(sid)) {
    const pending = pendingScopePath(telemetryDir(repo, settings), sid);
    if (pending) return { path: pending, exists: true, ambiguous: [] };
    const claimed = claimedScopePath(telemetryDir(repo, settings), sid);
    // a new pending record is stamped with its host when one is known (review round 1, M4), else host-less and flat
    return claimed ? { path: claimed, exists: true, ambiguous: [] } : { path: scopePath(repo, sid, settings, host), exists: false, ambiguous: [] };
  }
  const { path, ambiguous } = locateScope(telemetryDir(repo, settings), host, sid);
  if (path) return { path, exists: true, ambiguous };
  return { path: host ? scopePath(repo, sid, settings, host) : null, exists: false, ambiguous };
}
const ambiguousError = (sid, ambiguous) => new Error(`session ${sid} has records in more than one place (${ambiguous.join(', ')}) — pass --host`);

function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

/** Filename-safe session id — it becomes a path fragment. */
export function safeSession(id) { return String(id || '').replace(/[^A-Za-z0-9._-]/g, ''); }

export function openScope(repo, { session, intent, batch, cases = [], source, role, host = null, now = new Date().toISOString() } = {}, settings = loadSettings(repo)) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required — --session <id> (the SessionStart hook prints it), or --session auto on hosts without one');
  const sr = migrationOn('scope-resolution');
  let path = scopePath(repo, sid, settings);
  if (sr) {
    const at = scopeRecordPath(repo, sid, host, settings);
    if (!at.path) throw at.ambiguous.length ? ambiguousError(sid, at.ambiguous) : new Error(HOST_REQUIRED);
    path = at.path;
  }
  const prev = readJson(path) ?? {};
  const scope = {
    // scope-resolution: a claimed record keeps its own session id (the handle is its claimedFrom)
    v: SCOPE_VERSION, session: sr ? (prev.session ?? sid) : sid,
    intent: intent ?? prev.intent ?? settings.intents.default,
    ...((batch ?? prev.batch) ? { batch: batch ?? prev.batch } : {}),
    cases: [...new Set([...(prev.cases ?? []), ...cases.filter(Boolean)])].sort(),
    ...((source ?? prev.source) ? { source: source ?? prev.source } : {}),
    ...(sr && (role ?? prev.role) ? { role: role ?? prev.role } : {}),
    declaredAt: prev.declaredAt ?? now,
    updatedAt: now,
    ...(prev.outcomes ? { outcomes: prev.outcomes } : {}),
    ...(prev.closedAt ? { closedAt: prev.closedAt } : {}),
    ...(sr && prev.claimedFrom ? { claimedFrom: prev.claimedFrom } : {}),
  };
  writeJson(path, scope);
  return scope;
}

/** outcomes: { id: 'automated' | 'blocked' | 'PASS' | … } — overwrite per id, latest wins. */
export function recordOutcomes(repo, { session, outcomes = {}, host = null, now = new Date().toISOString() } = {}, settings = loadSettings(repo)) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required');
  let path = scopePath(repo, sid, settings);
  if (migrationOn('scope-resolution')) {
    const at = scopeRecordPath(repo, sid, host, settings);
    if (!at.path) throw at.ambiguous.length ? ambiguousError(sid, at.ambiguous) : new Error(HOST_REQUIRED);
    path = at.path;
  }
  // Self-healing: an outcome on an undeclared session still lands — a record
  // with a gap beats a lost record.
  const scope = readJson(path) ?? { v: SCOPE_VERSION, session: sid, intent: settings.intents.default, cases: [], declaredAt: now };
  scope.outcomes = scope.outcomes ?? {};
  for (const [id, outcome] of Object.entries(outcomes)) {
    if (!id || !outcome) continue;
    scope.outcomes[id] = { outcome: String(outcome), at: now };
    if (!scope.cases.includes(id)) scope.cases.push(id);
  }
  scope.cases.sort();
  scope.updatedAt = now;
  writeJson(path, scope);
  return scope;
}

export function closeScope(repo, { session, host = null, now = new Date().toISOString() } = {}, settings = loadSettings(repo)) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required');
  let path = scopePath(repo, sid, settings);
  if (migrationOn('scope-resolution')) {
    const at = scopeRecordPath(repo, sid, host, settings);
    if (!at.exists && at.ambiguous.length) throw ambiguousError(sid, at.ambiguous);
    path = at.exists ? at.path : null;
  }
  const scope = path && readJson(path);
  if (!scope) throw new Error(`no scope declared for session ${sid} — nothing to close`);
  scope.closedAt = now;
  scope.updatedAt = now;
  writeJson(path, scope);
  return scope;
}

export function listScopes(repo, { openOnly = false } = {}, settings = loadSettings(repo)) {
  const dir = scopesDir(repo, settings);
  if (!existsSync(dir)) return [];
  const out = [];
  // scope-resolution: the flat records (legacy, pending), then each host's
  const dirs = [dir, ...(migrationOn('scope-resolution') ? SCOPE_HOSTS.map((h) => join(dir, h)).filter((d) => existsSync(d)) : [])];
  for (const d of dirs) {
    for (const name of readdirSync(d).sort()) {
      if (!name.endsWith('.json')) continue;
      const s = readJson(join(d, name));
      if (!s) continue;
      if (openOnly && s.closedAt) continue;
      out.push(s);
    }
  }
  return out;
}

/** The winning ledger line for `host:id` and its ledger file (§3.5 rank: greatest endedAt, then greatest capturedAt; null ranks lowest).
 * `ties`: every line of the winning rank (the winner included), so a caller can tell an exact-tie conflict. */
function winningEntry(repo, host, id, settings = loadSettings(repo)) {
  const dir = telemetryDir(repo, settings);
  let files;
  try { files = readdirSync(dir).filter((f) => /^usage-.*\.jsonl$/.test(f) || f === 'usage.jsonl').sort(); } catch { return null; }
  const rank = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : -Infinity; };
  let best = null;
  for (const f of files) {
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const raw of text.split('\n')) {
      let l;
      try { l = JSON.parse(raw); } catch { continue; }
      if (l?.host !== host || l?.id !== id) continue;
      if (!best || rank(l.endedAt) > rank(best.line.endedAt) || (rank(l.endedAt) === rank(best.line.endedAt) && rank(l.capturedAt) > rank(best.line.capturedAt))) best = { line: l, file: f, ties: [l] };
      else if (rank(l.endedAt) === rank(best.line.endedAt) && rank(l.capturedAt) === rank(best.line.capturedAt)) best.ties.push(l);
    }
  }
  return best;
}
/** The winning ledger line for `host:id` (§3.5 rank: greatest endedAt, then greatest capturedAt; null ranks lowest). */
export function winningLine(repo, host, id, settings = loadSettings(repo)) {
  return winningEntry(repo, host, id, settings)?.line ?? null;
}

/**
 * The restamped line (§14.11; map O7, owner Q15b): the winner verbatim — measured fields, `endedAt`, the original
 * `writer` and `manifestRevision` — with `restampedBy` right after the provenance, `capturedAt` = now and the corrected
 * `scope` (in place, or after `cases` when the winner had none). Key order is the winner's (§3.2). The top-level
 * `cases` re-derive from the correction (review round 1, M2): (winner.cases − winner.scope.cases) ∪ scope.cases,
 * sorted as the capture sorts them — a mis-declared id leaves, the corrected one joins, mined ids stay.
 */
export function restampedLine(winner, scope, { restampedBy, now }) {
  const out = {};
  const after = 'manifestRevision' in winner ? 'manifestRevision' : 'writer';
  const stale = new Set(Array.isArray(winner.scope?.cases) ? winner.scope.cases : []);
  const cases = (c) => (Array.isArray(c) ? [...new Set([...c.filter((x) => !stale.has(x)), ...(scope?.cases ?? [])])].sort() : c);
  for (const [k, v] of Object.entries(winner)) {
    if (k === 'restampedBy') continue;
    out[k] = k === 'capturedAt' ? now : k === 'scope' ? scope : k === 'cases' ? cases(v) : v;
    if (k === after) out.restampedBy = restampedBy;
    if (k === 'cases' && !('scope' in winner)) out.scope = scope;
  }
  if (!('scope' in out)) out.scope = scope;
  if (!('capturedAt' in out)) out.capturedAt = now;
  return out;
}

/**
 * `work-scope restamp` (§14.11): no prior line → error; a reference-era winner (no `writer`) → error naming
 * `capture --force`, its measurements cannot be certified by restamping. A `writer` winner (B2 item 11) is appended
 * again with the session's own current scope record (`<host>/<id>.json`, or the legacy flat one when it is the only
 * one) as its `scope`, its original `writer` and `manifestRevision`, `restampedBy` = the current
 * `tokenomics-engine@<version>`, `capturedAt` = now (map O7, owner Q15), to the winner's own ledger file. No own
 * record (none, ambiguous, or only another host's) → error: there is no corrected scope to stamp. `env` is the one
 * environment source for the migration gates, the scope stamp and `restampedBy` (review round 1, M3).
 */
export async function restamp(repo, { host, session, env = process.env } = {}, settings = loadSettings(repo)) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required');
  const found = winningEntry(repo, host, sid, settings);
  if (!found) throw new Error(`no ledger line for ${host}:${sid} — nothing to restamp`);
  const winner = found.line;
  if (!winner.writer) {
    throw new Error(`the winning line for ${host}:${sid} is reference-era (no writer) — a restamp cannot certify its measurements; run \`capture --force\` (a full re-capture from the sources, if still present) first`);
  }
  if (!migrationOn('writer', env)) throw new Error(`the winning line for ${host}:${sid} carries a writer — restamping it needs the writer migration (B2 item 11)`);
  // report-conflicts (review round 1, M4): an exact-tie conflict has no winner; restamping would pick one by read order.
  if (migrationOn('report-conflicts', env) && new Set(found.ties.map((l) => canonical(accountingPayload(l)))).size > 1) {
    throw new Error(`${host}:${sid} is a spec 3.5 conflict (${found.ties.length} lines tie on endedAt and capturedAt with different payloads) — a restamp cannot choose between them; run \`capture --force\` (a full re-capture from the sources, if still present) first`);
  }
  const at = locateScope(telemetryDir(repo, settings), host, sid);
  if (!at.path) {
    if (at.ambiguous.length) throw ambiguousError(sid, at.ambiguous);
    throw new Error(`no scope record for ${host}:${sid}${at.misfiled.length ? ` (the only record is ${at.misfiled[0]}, another host's)` : ''} — nothing to restamp`);
  }
  const record = readJson(at.path);
  if (!record) throw new Error(`the scope record ${at.path} is unreadable — nothing restamped`);
  const { appendLine, whoAmI } = await import('../hooks/telemetry-capture.mjs');
  const { writerId } = await import('../engine/version.mjs');
  const line = restampedLine(winner, scopeForLine(record, env), { restampedBy: writerId(env), now: new Date().toISOString() });
  const slug = /^usage-(.+)\.jsonl$/.exec(found.file)?.[1] ?? winner.user ?? whoAmI(repo).slug;
  appendLine(repo, slug, line, settings, { restamp: true });   // a restamp append reads no environment: written as built
  return { line, file: `usage-${slug}.jsonl` };
}

/**
 * LIVE read of a session that is still running — "what has this cost so far".
 *
 * The ledger is session-grain and written at SessionEnd (plus the start-time
 * sweep), and NO hook fires telemetry when a sub-agent finishes: a finished
 * dispatch is on disk in the transcript store, but nothing has appended a
 * ledger line yet. Appending one per dispatch would mean re-metering the whole
 * session on every stop and piling superseded rows into the ledger — so the
 * answer to "show me now" is to READ the live transcript instead of writing.
 * Nothing is appended here; the ledger still updates once, at session end.
 */
export async function sessionStatus(repo, session, { price = true } = {}, settings = loadSettings(repo), ext = null) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required');
  const cap = await import('../hooks/telemetry-capture.mjs');
  const cfg = cap.loadConfig(repo, settings);
  for (const dir of cap.claudeProjectDirs(repo)) {
    const path = join(dir, `${sid}.jsonl`);
    if (!existsSync(path)) continue;
    const scope = readJson(migrationOn('scope-resolution') ? scopeRecordPath(repo, sid, 'claude', settings).path ?? '' : scopePath(repo, sid, settings));
    // Fast path: the SubagentStop hook already metered each finished dispatch
    // into the live log, so only the PARENT transcript needs pricing here —
    // one ccusage call instead of one per transcript.
    const log = cap.readDispatchLog(cap.dispatchLogPath(repo, sid, settings));
    if (price && log.size) {
      const line = cap.captureClaudeSession(repo, path, sid, { config: cfg, user: 'live', price: false, settings, ext });
      if (!line) continue;
      let known = 0;
      for (const s of line.subagents) {
        const rec = s.id && log.get(s.id);
        if (rec && typeof rec.costUsd === 'number') { s.costUsd = rec.costUsd; known++; }
      }
      const parent = cap.meterSession([path]);
      if (parent.totalUsd != null) {
        const subs = line.subagents.reduce((n, s) => n + (typeof s.costUsd === 'number' ? s.costUsd : 0), 0);
        line.costUsd = Math.round((parent.totalUsd + subs) * 100) / 100;
      }
      return { line, scope, liveLog: { recorded: log.size, applied: known } };
    }
    const line = cap.captureClaudeSession(repo, path, sid, { config: cfg, user: 'live', price, settings, ext });
    if (line) return { line, scope };
  }
  return null;
}

const money = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : 'unpriced');
export function renderStatus({ line, scope, liveLog }, settings = TA_DEFAULTS) {
  const w = words(settings);
  const tok = (t) => Object.values(t ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
  // O1 (Plan 4 final review, ledger 86): a unit whose tokens are null is unmeasured — '—' per dispatch, and the
  // "so far" total sums only measured units and says how many are not (never a silent 0). Gated on
  // null-unobservable, as writeSubmission's dashes are: the reference already read a usage-less dispatch's null
  // tokens and printed 0, so the field alone cannot keep the migrations-off output byte-identical.
  const nuTok = (t) => t === null && migrationOn('null-unobservable');
  const units = [line, ...line.subagents];
  const unmeasuredTok = units.filter((u) => nuTok(u.tokens)).length;
  const sumTok = units.reduce((n, u) => n + tok(u.tokens), 0);
  const totalTok = unmeasuredTok === units.length ? `— (${unmeasuredTok} unmeasured) tokens`
    : `${sumTok.toLocaleString()} tokens${unmeasuredTok ? ` (${unmeasuredTok} unmeasured)` : ''}`;
  const out = [`work-scope: session ${line.id} — LIVE (nothing written; the ledger updates at session end)`];
  if (scope) {
    const oc = Object.entries(scope.outcomes ?? {}).map(([id, o]) => `${id}=${o?.outcome ?? o}`).join(', ');
    out.push(`  scope: ${scope.intent}${scope.batch ? ` / ${scope.batch}` : ''} — ${scope.cases.length} ${w.item}(s)${oc ? `  ·  outcomes: ${oc}` : '  ·  no outcomes recorded yet'}`);
  } else {
    out.push('  scope: NOT DECLARED — run `work-scope.mjs open …` (this session\'s spend will land unattributed)');
  }
  // null-unobservable: a counter the host does not expose is null on the line — print '— (1 unmeasured)'
  // (the engine's count format), never `null`, "—m" or 0
  const v = (x) => (x == null ? '— (1 unmeasured)' : x);
  const mins = line.activeMin == null ? '— active (1 unmeasured)' : `${line.activeMin}m active`;
  out.push(`  so far: ${money(line.costUsd)}  ·  ${totalTok}  ·  ${mins}  ·  ${v(line.turns)} turns  ·  ${v(line.toolCalls)} tool calls (${v(line.toolErrors)} err)`);
  out.push(`  ${w.items} seen: ${line.cases.length ? line.cases.join(', ') : '—'}`);
  out.push(`  dispatches (${line.subagents.length}):`);
  for (const s of line.subagents) {
    out.push(`    ${String(s.role).padEnd(26)} ${money(s.costUsd).padStart(8)}  ${(nuTok(s.tokens) ? '—' : tok(s.tokens).toLocaleString()).padStart(11)} tok  ${s.activeMin == null ? '   —' : `${String(s.activeMin).padStart(3)}m`}  ${String(s.toolCalls ?? '—').padStart(3)} tools  ${s.label.slice(0, 46)}`);
  }
  if (!line.subagents.length) out.push('    (none finished yet — a running dispatch has no transcript to read)');
  if (liveLog) out.push(`  (dispatch dollars read from the live log — ${liveLog.applied}/${liveLog.recorded} recorded by the SubagentStop hook; only the parent was metered here)`);
  return out.join('\n');
}

/**
 * Closing a batch scope also GENERATES the batch report — close is the batch's
 * human milestone and the last moment the lead can still fix the receipt, so
 * the session is captured, the cost recomputed and the report rendered here,
 * and any receipt-vs-records drift is printed while it is still actionable.
 * Best-effort by design: no receipt, no ledger, or a missing sibling script
 * must never fail the close itself.
 * Dynamic imports keep this module cycle-free (batch-cost imports listScopes).
 */
export async function generateBatchReports(repo, scope, settings = loadSettings(repo), ext = null) {
  if (!scope?.batch) return [];
  try {
    // FIRST capture this session into the ledger. Close runs INSIDE the
    // still-running session, so without this its own spend is missing from
    // the report it is generating. The session's real end appends a
    // superseding line; readers dedupe latest-wins.
    if (scope.session) {
      try {
        const cap = await import('../hooks/telemetry-capture.mjs');
        cap.captureSessionNow(repo, scope.session, { settings, ext });
      } catch { /* no transcript / metering unavailable — report what the ledger has */ }
    }
    const { updateBatchCosts } = await import('./batch-cost.mjs');
    const { renderBatchMarkdown, renderBatchHtml, renderBatchTokenomicsMarkdown, renderBatchTokenomicsHtml } = await import('./team-report.mjs');
    // The declared batch names a group directly, else every group the extension
    // matches to it (TA: a top slug, a nested wave's full path, or the bare wave name).
    let costs = updateBatchCosts(repo, { batch: scope.batch }, settings, ext);
    if (!costs.length) {
      const all = updateBatchCosts(repo, { write: false }, settings, ext);
      const matches = all.filter((c) => hook(ext, 'enrichGroup', c, { repo, settings, phase: 'match', scope }) ?? c.batch === scope.batch);
      costs = matches.flatMap((m) => updateBatchCosts(repo, { batch: m.batch }, settings, ext));
    }
    const out = [];
    for (const c of costs) {
      const dir = groupReportsDir(repo, settings, c.batch);
      // The extension's close-time side effects (TA: mid-run gate verdicts fold
      // home into the batch dir) — best-effort, a failure never fails the close.
      // The extension keeps the RECEIPT dir (TA's gate runs and verdicts live beside the receipt), whatever
      // reports.location says; only the engine's own reports and cost.json move (reports-location, review I1).
      try { hook(ext, 'onClose', c, { repo, settings, dir: join(receiptsRoot(repo, settings), ...c.batch.split('/')) }); } catch { /* the extension's record survives where it was */ }
      mkdirSync(dir, { recursive: true });   // a relocated reports directory (reports-location) may not exist yet
      const path = join(dir, 'batch-report.md');
      writeFileSync(path, `${renderBatchMarkdown(c, settings, ext)}\n`);
      // The shareable page, same rhythm as manual-qa's HTML tokenomics report.
      writeFileSync(join(dir, 'batch-report.html'), `${renderBatchHtml(c, settings, ext)}\n`);
      // The OTHER unfolding of the same cost.json: token composition + cache
      // hit rate per role/stage/case — where the delivery report shows only
      // the honest real-work figure.
      writeFileSync(join(dir, 'batch-tokenomics.md'), `${renderBatchTokenomicsMarkdown(c, settings, ext)}\n`);
      writeFileSync(join(dir, 'batch-tokenomics.html'), `${renderBatchTokenomicsHtml(c, settings, ext)}\n`);
      // Hyperfactory dataset row — compliance as a side effect of closing:
      // every close appends/replaces this batch's row in the accumulating
      // export (identity from factory-profile.json; missing profile just
      // means null identity + a §7 checklist warning, never a failed close).
      try {
        const { appendRun, loadProfile } = await import('./build-tokenomics-export.mjs');
        const { profile } = loadProfile(repo, undefined, settings);
        appendRun(repo, c, profile, settings, ext);
      } catch { /* export is best-effort; the close artifacts above are the deliverable */ }
      out.push({ path, cost: c });
    }
    return out;
  } catch { return []; }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const cmd = argv[0];
  const arg = (name) => {
    const i = argv.indexOf(name);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !String(v).startsWith('--') ? v : undefined;
  };
  const repo = arg('--repo') ?? env.CLAUDE_PROJECT_DIR ?? process.cwd();
  // activation (D-ACT): an inert or refused copy's writing commands read and write nothing, and exit 0
  if (WRITING.has(cmd) && !gateOrExplain(ENGINE_ROOT, repo, env)) return 0;
  // empty-repo-sizing (item 18): an empty --repo used to pass '' through ?? and silently skip sizing.
  if (migrationOn('report-robustness', env) && argv.includes('--repo') && !arg('--repo')) { process.stderr.write('work-scope: --repo needs a non-empty path\n'); return 1; }
  let session = arg('--session') ?? env.CLAUDE_SESSION_ID ?? null;
  const auto = session === 'auto';
  // scope-resolution (§14.11, owner Q12a): --host, defaulted from the environment; `auto` only on open
  const sr = migrationOn('scope-resolution');
  const host = sr ? (arg('--host') ?? hostFromEnv(env)) : null;
  if (sr && host && !SCOPE_HOSTS.includes(host)) { process.stderr.write(`work-scope: --host must be one of ${SCOPE_HOSTS.join(', ')}\n`); return 1; }
  if (sr && auto && cmd !== 'open') { process.stderr.write('work-scope: --session auto is valid only on open — pass the handle open printed ({"handle":"pending-…"})\n'); return 1; }
  if (auto) session = `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  try {
    const settings = loadSettings(repo);
    const ext = await loadExtension(settings, repo);
    const w = words(settings);
    if (cmd === 'open') {
      if (sr && session && !auto && !host) { process.stderr.write(`work-scope: open needs ${HOST_REQUIRED}\n`); return 1; }
      const scope = openScope(repo, {
        session,
        intent: arg('--intent'),
        batch: arg('--batch'),
        cases: (arg('--cases') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        source: arg('--source'),
        ...(sr ? { role: arg('--role'), host } : {}),
      }, settings);
      process.stderr.write(`work-scope: ${scope.session} — ${scope.intent}${scope.batch ? ` / ${scope.batch}` : ''}, ${scope.cases.length} ${w.item}(s)\n`);
      // scope-resolution: the machine-readable handle (§14.11) — outcome/close take it before and after the claim
      if (sr && auto) process.stdout.write(`${JSON.stringify({ handle: scope.session })}\n`);
      return 0;
    }
    if (cmd === 'outcome') {
      const pairs = argv.slice(1).filter((a) => !a.startsWith('--') && a.includes('='));
      const outcomes = Object.fromEntries(pairs.map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), p.slice(i + 1)];
      }));
      if (!Object.keys(outcomes).length) { process.stderr.write('work-scope: outcome needs ID=outcome pairs\n'); return 1; }
      const scope = recordOutcomes(repo, { session, outcomes, host }, settings);
      process.stderr.write(`work-scope: ${scope.session} — ${Object.keys(scope.outcomes).length} outcome(s) recorded\n`);
      return 0;
    }
    if (cmd === 'close') {
      const scope = closeScope(repo, { session, host }, settings);
      process.stderr.write(`work-scope: ${safeSession(session)} closed\n`);
      // Close generates the batch report — see generateBatchReports.
      const reports = await generateBatchReports(repo, scope, settings, ext);
      // The receipt is written by an AGENT (the workflow's report writer, or
      // the lead on a sequential run) — so it can simply be absent: an
      // interrupted run, a dead writer, a loop that never reached its end.
      // Say so loudly instead of rendering nothing: without it there is no
      // delivery record for any audit to divide by.
      if (scope.batch && !reports.length) {
        process.stderr.write(
          `work-scope: ⚠ NO RECEIPT for ${w.group} '${scope.batch}' — ${settings.receipts.root}/${scope.batch}/${settings.receipts.file} is missing, so no ${w.group} report was written.\n`
          + (hook(ext, 'onClose', scope, { repo, settings, phase: 'no-receipt' }) ?? '')
          + `  then re-run: work-scope.mjs close --session ${safeSession(session)} (the render is idempotent).\n`,
        );
      }
      for (const { path, cost } of reports) {
        process.stderr.write(`work-scope: ${w.group} report → ${path}\n`);
        hook(ext, 'onClose', cost, { repo, settings, phase: 'report' });
      }
      return 0;
    }
    if (cmd === 'status') {
      const st = await sessionStatus(repo, session, { price: !argv.includes('--fast') }, settings, ext);
      if (!st) { process.stderr.write(`work-scope: no live transcript found for session ${safeSession(session)} in ${repo}\n`); return 1; }
      process.stdout.write(`${renderStatus(st, settings)}\n`);
      return 0;
    }
    if (cmd === 'show') {
      let path = session && scopePath(repo, safeSession(session), settings);
      if (sr && session) {
        const at = scopeRecordPath(repo, safeSession(session), host, settings);
        if (!at.exists) throw at.ambiguous.length ? ambiguousError(safeSession(session), at.ambiguous) : new Error(`no scope declared for session ${safeSession(session)}`);
        path = at.path;
      }
      const s = path && readFileSync(path, 'utf8');
      process.stdout.write(s);
      return 0;
    }
    if (sr && cmd === 'restamp') {
      if (!host) { process.stderr.write(`work-scope: restamp needs ${HOST_HINT}\n`); return 1; }
      const r = await restamp(repo, { host, session, env }, settings);
      process.stderr.write(`work-scope: restamped ${host}:${safeSession(session)} → ${r.file} (writer ${r.line.writer}, restampedBy ${r.line.restampedBy})\n`);
      return 0;
    }
    if (cmd === 'list') {
      for (const s of listScopes(repo, { openOnly: argv.includes('--open') }, settings)) {
        process.stdout.write(`${s.session}  ${s.intent}${s.batch ? `  ${s.batch}` : ''}  ${s.cases.length} ${w.item}(s)${s.closedAt ? '  closed' : ''}\n`);
      }
      return 0;
    }
    process.stderr.write('usage: work-scope.mjs open|outcome|close|show|list … (see file header)\n');
    return 1;
  } catch (err) {
    process.stderr.write(`work-scope: ${err?.message ?? err}\n`);
    return 1;
  }
}

const entryOn = entryPointsOn(ENGINE_ROOT); // items 12/13: realpath main guard, exit after stdio drains (a refused copy never parses the variable)
const exit_ = entryOn ? exitAfterDrain : (c) => process.exit(c);
if (entryOn ? isMain(import.meta.url) : (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().then((code) => exit_(code), (err) => {
    process.stderr.write(`work-scope: ${err?.message ?? err}\n`);
    exit_(1);
  });
}
