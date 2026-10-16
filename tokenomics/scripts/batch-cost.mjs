#!/usr/bin/env node
// batch-cost.mjs — one cost.json per batch, joining the tokenomics ledger to
// the pipeline's own receipt (.agents/automation/<slug>/report.json).
//
//   node batch-cost.mjs [repo] [--batch <slug>] [--stdout] [--json]
//
// Runs standalone AND from the capture hook after every ledger append. Always
// a FULL recompute from (all ledger lines) x (the receipt) — never an append:
// a batch spans sessions (interruptions, re-gates) and a session can touch
// several batches, so cost.json is a pure derivation, idempotent, latest-wins.
//
// ATTRIBUTION MODEL (deliberately the same discipline as manual-qa, which
// never splits dollars per TC either):
//   * per-case rows carry DIRECT work only — the case's own analyst /
//     implement / review / fix / merge dispatches, matched by the RECEIPT's
//     own case ids against each dispatch's label (receipt-driven: works for
//     any id shape any source system uses — Jira keys, TC-101, file slugs).
//   * a dispatch naming several ids (a cluster, any size) splits its numbers
//     EVENLY across the matched ids — deterministic, and close to truth since
//     clusters are similar-by-construction.
//   * batch-level work — the lead's own thread, triage, the hardening gate,
//     the report writer — is OVERHEAD, shown once at batch level, never
//     smeared into per-case rows. Stage classification comes FIRST, because
//     triage enumerates every case id and the gate names the batch's specs:
//     matching ids alone would misattribute them as direct.
//   * dollars are only ever written where they were measured: per-dispatch
//     costUsd exists on Claude (per-file ccusage metering at capture);
//     Copilot bills one figure per session, so its per-case rows carry
//     tokens/time and dollars appear at batch level from billed credits.
//   * stats (avg/median/min/max) run over measured values only.
//
// STDLIB ONLY. Read-only except the cost.json writes.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSettings, telemetryDir, receiptsRoot, groupReportsDir, TA_DEFAULTS, words } from '../engine/config.mjs';
import { hook, loadExtension } from '../engine/extension.mjs';
import { migrationOn } from '../engine/migrations.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { engineRootOf, entryPointsOn, gateCli } from '../engine/activation.mjs';
import { stampRevision, receiptDelivery } from '../engine/manifest.mjs';
import { loadLines, dedupLines, dedupConflicts, countMeasured, sumOrNull, measuredIn, emptyUnmeasured } from './team-report.mjs';
import { listScopes } from './work-scope.mjs';

const COST_VERSION = 1;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round2 = (v) => Math.round(v * 100) / 100;
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// --- receipts ----------------------------------------------------------------
export function loadReceipts(repo, { batch } = {}, settings = loadSettings(repo)) {
  const root = receiptsRoot(repo, settings);
  if (!existsSync(root)) return [];
  // Walk the WHOLE tree: campaigns nest wave receipts at
  // <batch>/<wave>/report.json (the campaign workflow's own reportDir), so a
  // one-level scan silently skips them — same fix efficiency-audit's
  // run-reports.mjs carries. slug = the receipt dir's automation-root-relative
  // path ('approved-next50/wave-01-…'), so `--batch` selects a whole campaign
  // by its top slug or one wave by full path.
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // Non-batch residents of automation/: underscore-prefixed working dirs
      // (_returns, _gates) hold no receipts; 'telemetry' is defense for repos
      // whose telemetry folder predates the move to .agents/telemetry.
      if (entry.name === 'telemetry' || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === settings.receipts.file) {
        const receipt = safeParse(readFileSync(p, 'utf8'));
        if (!receipt || !Array.isArray(receipt.cases)) continue;
        out.push({ slug: relative(root, dir).split(sep).join('/'), dir, receipt });
      }
    }
  };
  walk(root);
  return batch ? out.filter(({ slug }) => slug === batch || slug.startsWith(`${batch}/`)) : out;
}

// --- live (running sessions) -------------------------------------------------
/**
 * Rebuild a PROVISIONAL session line for each still-running session from its
 * live dispatch log (`.agents/telemetry/automation/live/<session>.jsonl` — one small line
 * per finished dispatch, written by the SubagentStop hook).
 *
 * This is what makes the batch report current DURING a run without the ledger
 * growing: the deltas are stored, the snapshot is rebuilt on demand. A live
 * line is used ONLY while its session has no ledger line at all (see the
 * caller) — the real line always wins.
 *
 * `costUsd` here is the sum of the dispatches measured so far, so it is a
 * FLOOR, not the session total — the lead's own thread is not in it until the
 * session is captured. The line is marked `live: true` so consumers can say so.
 */
export function loadLiveLines(repo, settings = loadSettings(repo)) {
  const dir = join(telemetryDir(repo, settings), 'live');
  if (!existsSync(dir)) return [];
  const out = [];
  let names;
  try { names = readdirSync(dir).sort(); } catch { return out; }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const byId = new Map();
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const r = line.trim() && safeParse(line);
      if (r?.agentId) byId.set(r.agentId, r);      // latest record per dispatch
    }
    const recs = [...byId.values()];
    if (!recs.length) continue;
    // null-unobservable: a counter the record does not carry stays null (O1 counts it as unmeasured)
    const cnt = (v) => (v == null && migrationOn('null-unobservable') ? null : num(v));
    const priced = recs.filter((r) => typeof r.costUsd === 'number');
    // active-minutes: the running session's own minutes are not measured yet, and its dispatch minutes overlap
    // (spec 5.4), so they never sum into session time. With null-unobservable the lead thread is null (counted
    // unmeasured); otherwise it keeps the reference 0.
    const liveParentNull = migrationOn('null-unobservable');
    const liveMin = migrationOn('active-minutes') && migrationOn('null-unobservable') ? null : 0;
    out.push({
      v: COST_VERSION, host: recs.find((r) => r.host)?.host ?? 'claude', live: true, id: name.replace(/\.jsonl$/, ''),
      user: 'live', repo: '', branch: '', role: null,
      startedAt: null, endedAt: recs.map((r) => r.endedAt).filter(Boolean).sort().pop() ?? null,
      // parent not measured yet: with null-unobservable its quantities are null (counted unmeasured, B2-07), never an invented zero
      tokens: liveParentNull ? null : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      activeMin: liveMin, turns: liveParentNull ? null : 0,
      toolCalls: liveParentNull ? null : 0, toolErrors: liveParentNull ? null : 0,
      ...(priced.length ? { costUsd: priced.reduce((n, r) => n + r.costUsd, 0), costSource: 'ccusage-metered' } : {}),
      cases: [...new Set(recs.flatMap((r) => r.cases ?? []))].sort(),
      subagents: recs.map((r) => ({
        id: r.agentId, role: r.role, label: r.label, n: 1,
        tokens: r.tokens, tokensByModel: r.tokensByModel ?? {},
        ...(r.tokensAttributed === false ? { tokensAttributed: false } : {}),
        activeMin: cnt(r.activeMin),
        toolCalls: cnt(r.toolCalls), toolErrors: cnt(r.toolErrors),
        ...(r.cases?.length ? { cases: r.cases } : {}),
        ...(typeof r.costUsd === 'number' ? { costUsd: r.costUsd } : {}),
      })),
      skills: [], dispatches: recs.length,
    });
  }
  return out;
}

// --- classification ----------------------------------------------------------
// Which dispatches are group-level stage work (overhead) is the extension's
// classifyDispatch (TA: triage / gate / report stages, matched on the label
// head); everything else that names a receipt id is that item's own work.
/** True iff `token` occurs in `text` as a whole token: case-sensitive, with no [A-Za-z0-9_-] character
 * immediately before or after the occurrence (B2 exact-ids, owner Q4). Any later occurrence may qualify. */
export function namesToken(text, token) {
  const t = String(text ?? ''); const k = String(token ?? '');
  if (!t || !k) return false;
  const idChar = /[A-Za-z0-9_-]/;
  for (let i = t.indexOf(k); i !== -1; i = t.indexOf(k, i + 1)) {
    if (!idChar.test(t[i - 1] ?? '') && !idChar.test(t[i + k.length] ?? '')) return true;
  }
  return false;
}

/** Which of `ids` a dispatch label names. Reference: case-insensitive, id-shape-agnostic substring;
 * under exact-ids: a whole, case-sensitive token (`namesToken`). */
export function matchIds(label, ids) {
  if (migrationOn('exact-ids')) return ids.filter((id) => id && namesToken(label, String(id)));
  const l = String(label || '').toLowerCase();
  if (!l) return [];
  return ids.filter((id) => id && l.includes(String(id).toLowerCase()));
}

export function classify(label, ids, declared = [], ext = null, ctx = {}) {
  if ((hook(ext, 'classifyDispatch', label, ctx) ?? 'direct') !== 'direct') return { kind: 'overhead', ids: [] };
  const matched = matchIds(label, ids);
  if (matched.length) return { kind: 'direct', ids: matched };
  // Fallback: ids the capture mined from the dispatch's own transcript (the
  // ledger entry's `cases`). Rescues dispatches whose case id sits past the
  // label's 160-char window — measured at 11.6% of 2,493 real workflow
  // dispatches (the "stabilize workflow…" prompt shape). Still receipt-driven:
  // only ids the receipt names count, and named overhead stages never get here.
  const exact = migrationOn('exact-ids');
  const fromDeclared = declared.filter((d) => d && ids.some((id) => (exact ? String(id) === String(d) : String(id).toLowerCase() === String(d).toLowerCase())));
  if (fromDeclared.length) return { kind: 'direct', ids: fromDeclared };
  return { kind: 'overhead', ids: [] };
}

// --- the join ----------------------------------------------------------------
/** Does this ledger line belong to this batch at all? `slug` may be a string
 * or a list (a nested wave passes its path slug + the receipt's batch name).
 * A DECLARED scope (work-scope.mjs, stamped by capture) is the strongest
 * surface — its batch and cases join the same match, no guessing needed. */
export function lineMatchesBatch(line, { slug, ids, branches }) {
  if (migrationOn('exact-ids')) {
    // Structured entries (cases, scope.batch/cases, dispatch cases) compare by ===; free text (branch,
    // dispatch labels) names a key only as a whole token (spec 5.1, 10.2).
    const structured = [...(line.cases || []), line.scope?.batch || '', ...(line.scope?.cases || []),
      ...(line.subagents || []).flatMap((s) => s.cases || [])].map(String);
    const free = [line.branch || '', ...(line.subagents || []).map((s) => s.label || '')];
    const names = (k) => structured.includes(k) || free.some((t) => namesToken(t, k));
    return [].concat(slug || [], ids, branches).some((k) => k && names(String(k)));
  }
  const texts = [line.branch || '', ...(line.cases || []),
    line.scope?.batch || '', ...(line.scope?.cases || []),
    ...(line.subagents || []).map((s) => s.label || ''),
    ...(line.subagents || []).flatMap((s) => s.cases || [])]
    .join('\n').toLowerCase();
  for (const s of [].concat(slug || [])) if (s && texts.includes(String(s).toLowerCase())) return true;
  for (const id of ids) if (id && texts.includes(String(id).toLowerCase())) return true;
  for (const b of branches) if (b && texts.includes(String(b).toLowerCase())) return true;
  return false;
}

/** Does a free-text label name one of a group's keys (its slug / batch name, already key-cased)? Reference:
 * substring; under exact-ids: a whole token (`namesToken`). */
function mentionsKey(label, keys) {
  if (migrationOn('exact-ids')) return keys.some((k) => k && namesToken(label, k));
  const l = String(label || '').toLowerCase();
  for (const k of keys) if (k && l.includes(k)) return true;
  return false;
}
const keyCase = (s) => (migrationOn('exact-ids') ? String(s) : String(s).toLowerCase());
const groupIds = (receipt) => receipt.cases.map((c) => c.id).filter(Boolean);
const groupKeys = (slug, receipt) => [slug, receipt.batch].filter(Boolean).map(keyCase);
/** A dispatch is "mine" in a group when its label names one of the group's ids or keys, or its mined `cases`
 * hold one of the group's ids (§10.3). */
const dispatchMine = (s, ids, myKeys) => matchIds(s.label, ids).length > 0 || (s.cases ?? []).some((c) => ids.includes(c)) || mentionsKey(s.label, myKeys);
/** The shared-allocation key of a dispatch: `${line.host}:${line.id}:${dispatch.id}` (its index when the
 * dispatch carries no id, so two id-less dispatches of one line never share a key). */
export const dispatchKey = (line, s, i) => `${line.host}:${line.id}:${s.id ?? `#${i}`}`;

/** The deduplicated ledger lines that belong to one group: inside its time window (see buildBatchCost) and
 * matched by its slug, ids or branches. `deduped` is dedupLines(allLines). */
function memberLines(slug, receipt, deduped, scopes) {
  const ids = groupIds(receipt);
  const branches = [receipt.integration_branch, ...receipt.cases.map((c) => c.branch)].filter(Boolean);
  // BATCH TIME WINDOW — the guard against resurrected history. Case ids
  // repeat across batch GENERATIONS (a re-run demo, a reset repo, a case
  // re-entering a later batch), and transcripts outlive trees: the catch-up
  // capture legitimately heals a pre-era session into the ledger, where a
  // bare id-match would then attribute it here (field case 2026-08-18: a
  // pre-reset session matched TC-001..004 and inflated a $27 batch to $45).
  // A session that ENDED before this batch was FIRST DECLARED cannot be its
  // work — unless its own scope names the batch outright. Batches with no
  // scope record keep the old id-match behavior unchanged.
  const declaredTs = scopes
    .filter((s) => s.batch === slug || s.batch === receipt.batch)
    .map((s) => Date.parse(s.declaredAt))
    .filter(Number.isFinite);
  const windowStart = declaredTs.length ? Math.min(...declaredTs) : null;
  const inWindow = (l) => {
    if (!windowStart) return true;
    if (l.scope?.batch === slug || l.scope?.batch === receipt.batch) return true;
    const ended = Date.parse(l.endedAt ?? '');
    return !Number.isFinite(ended) || ended >= windowStart;
  };
  return deduped.filter((l) => inWindow(l) && lineMatchesBatch(l, { slug: [slug, receipt.batch].filter(Boolean), ids, branches }));
}

/** shared-allocation (B2 item 2, owner Q5): for each dispatch, k = the number of groups in which it is "mine",
 * across every receipt except rollups (`rollup: true`, spec 5.1, which aggregate other groups and are excluded
 * from additive sums, 5.4). `groups`: [{ slug, receipt }]; `allLines`: every ledger (+ live) line; `scopes`:
 * the repo's scope records (the time window). Returns Map<dispatchKey, k>; a dispatch mine nowhere is absent. */
export function sharedDispatchCounts(groups, allLines = [], { scopes = [] } = {}) {
  const counts = new Map();
  // report-conflicts: k counts the groups that call a dispatch theirs, whatever the line's conflict state, so the
  // verified build and the preview build (which adds the conflict picks) share one k per dispatch.
  const rc = migrationOn('report-conflicts') ? dedupConflicts(allLines) : null;
  const deduped = rc ? [...rc.winners, ...rc.preview] : dedupLines(allLines);
  for (const { slug, receipt } of groups) {
    if (!receipt || receipt.rollup === true) continue;
    const ids = groupIds(receipt); const myKeys = groupKeys(slug, receipt);
    for (const line of memberLines(slug, receipt, deduped, scopes)) {
      (line.subagents || []).forEach((s, i) => {
        if (!dispatchMine(s, ids, myKeys)) return;
        const key = dispatchKey(line, s, i);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    }
  }
  return counts;
}

// `tok` rides every bucket as the FULL quad — the scalar `tokens` sum hides
// that ~95% of it is cache-read at ~1/10 input price, which made report token
// columns alarming and incomparable (field: a $16 batch showing "47.5M
// tokens"). The quad is what the tokenomics view (composition, cache hit
// rate) renders per role/stage/case.
const emptyQuad = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const scaleQuad = (t, f = 1) => ({ input: num(t?.input) * f, output: num(t?.output) * f, cacheRead: num(t?.cacheRead) * f, cacheWrite: num(t?.cacheWrite) * f });
const addQuad = (a, t, f = 1) => { for (const k of Object.keys(a)) a[k] += num(t?.[k]) * f; };
const roundQuad = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]));
const emptyBucket = () => ({ costUsd: null, tokens: 0, tok: emptyQuad(), activeMin: 0, dispatches: 0, toolCalls: 0, toolErrors: 0 });
// null-unobservable (O1): a contribution may carry `nul` — which of its quantities the unit did not measure.
// The sums stay numeric (measured values only); the counts ride the bucket, and bucketOut turns a sum no
// measured value reached into null beside `unmeasured`.
const NUL_KEYS = ['tokens', 'activeMin', 'toolCalls', 'toolErrors'];
// A `nul` key of null means "not applicable": the key counts as neither measured nor unmeasured (an inclusive line's dispatch split).
const countNul = (b, nul) => { if (nul) for (const k of NUL_KEYS) if (nul[k] !== null) countMeasured(b, k, !nul[k]); };
function addTo(b, { costUsd, tokens, tok, activeMin, toolCalls = 0, toolErrors = 0, nul }, share = 1) {
  countNul(b, nul);
  if (typeof costUsd === 'number') b.costUsd = num(b.costUsd) + costUsd * share;
  b.tokens += tokens * share;
  if (tok && b.tok) addQuad(b.tok, tok, share);
  b.activeMin += activeMin * share;
  b.dispatches += share;
  b.toolCalls += toolCalls * share;
  b.toolErrors += toolErrors * share;
}
const subTokens = (s) => num(s.tokens?.input) + num(s.tokens?.output) + num(s.tokens?.cacheRead) + num(s.tokens?.cacheWrite);

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return {
    avg: v.reduce((a, x) => a + x, 0) / v.length,
    median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    min: v[0], max: v[v.length - 1], n: v.length,
  };
}
const money = (s) => s && { avg: round2(s.avg), median: round2(s.median), min: round2(s.min), max: round2(s.max), n: s.n };
const rounded = (s) => s && { avg: Math.round(s.avg), median: Math.round(s.median), min: Math.round(s.min), max: Math.round(s.max), n: s.n };

/** Build one batch's cost.json object from the receipt + ALL ledger lines.
 * `dir` / `scopes`: the batch dir + the repo's scope records, handed to the
 * extension's enrichGroup (TA: the gate-run records + declared outcomes).
 * `ext`: the loaded extension (null = none: engine defaults only).
 * `others`: the OTHER receipts' identities ({keys, ids, branches}) — a session
 * serving several batches must not be double-counted: its dispatches that name
 * another batch's ids/slug are EXCLUDED here, and its session-level figures
 * (lead thread, unnamed work) are split EVENLY across the batches it matched.
 * `shared`: sharedDispatchCounts over every group (shared-allocation: a dispatch
 * mine in k groups weighs 1/k here; absent = k 1).
 * All optional, so pure-ledger callers and old tests stay valid.
 * report-conflicts (spec 3.5, O2, Q16): the members are the verified winners; a spec 3.5 conflict is the group's when
 * ANY of its tied lines is a member (review round 1, I1): it leaves the group cost, is counted in `sources.conflicts`,
 * and `preview` totals the group with each such conflict's pick, member or not (`withConflictPicks`: the picks the
 * internal preview build adds). */
export function buildBatchCost(slug, receipt, allLines, opts = {}) {
  const { dir = null, scopes = [], others = [], repo = null, settings = TA_DEFAULTS, ext = null, shared = null, withConflictPicks = null } = opts;
  const ids = groupIds(receipt);
  const rc = migrationOn('report-conflicts') ? dedupConflicts(allLines) : null;
  const byKey = (a, z) => { const x = `${a.host}:${a.id}`; const y = `${z.host}:${z.id}`; return x < y ? -1 : x > y ? 1 : 0; };
  const lines = rc
    ? [...memberLines(slug, receipt, rc.winners, scopes), ...(withConflictPicks ?? [])].sort(byKey)
    : memberLines(slug, receipt, dedupLines(allLines), scopes);
  const mine = rc && !withConflictPicks ? rc.preview.filter((_, i) => memberLines(slug, receipt, rc.conflicts[i].lines, scopes).length) : [];
  const conflicted = mine.length;
  // the totals do not read the extension: the preview build runs without it (no hook runs twice)
  const preview = conflicted ? buildBatchCost(slug, receipt, allLines, { ...opts, ext: null, withConflictPicks: mine }).totals : null;

  const myKeys = groupKeys(slug, receipt);
  const foreignIds = new Set(others.flatMap((o) => o?.ids ?? []).filter((id) => !ids.includes(id)));
  const foreignKeys = new Set(others.flatMap((o) => o?.keys ?? []).map(keyCase).filter((k) => !myKeys.includes(k)));
  // shared-allocation: a dispatch mine in k groups weighs 1/k in each (Q5). A rollup group aggregates the others,
  // is outside the additive cohort, and keeps full weight; without counts (a pure-ledger caller) k = 1.
  const splitShared = migrationOn('shared-allocation') && shared instanceof Map && receipt.rollup !== true;

  // The extension's per-group classifier state rides `acc` (TA: byStage split + rework bill).
  const cls = { repo, settings, acc: {}, addTo, emptyBucket };
  const caseBucket = () => ({ ...emptyBucket(), ...(hook(ext, 'classifyDispatch', null, { ...cls, phase: 'case-init' }) ?? {}) });
  const perCase = new Map(ids.map((id) => [id, caseBucket()]));
  const overhead = { lead: emptyBucket(), stage: emptyBucket() };
  const totals = { ...emptyBucket(), sessions: lines.length, turns: 0 };
  const tokensSplit = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byRole = new Map(); // role → bucket — cost.json's byRole, read by the batch and tokenomics renders
  // role-dollars (B2 item 23, spec 3.2.1, map O3/R21, owner Q1a): by-role dollars = the parent session's role,
  // inclusive — a priced session's parent role is charged everything this group charges for the session (its lead
  // share plus the dispatch dollars the group carries, so over priced sessions Σ byRole.costUsd = totals.costUsd);
  // an unpriced session adds no by-role dollars and counts in the role's `unpriced` (O1; review round 1, I1). The
  // parent role's `priced`/`unpriced` session counts tell an unpriced role (null, unpriced > 0) from a dispatch-only
  // one (null, 0/0: not allocated at this grain; I2). A dispatch adds no by-role dollars: per-dispatch-role dollars
  // are the separate measured breakdown byDispatchRole ({units, costUsd, priced}, weighted like `dispatches`), never
  // summed into byRole or totals. An unpriced dispatch counts in units, not priced.
  const rd = migrationOn('role-dollars');
  const byDispatchRole = new Map();
  const hosts = new Set(); const users = new Set(); const costSources = new Set(); const models = new Set(); const skills = new Set();
  let pricedDirect = false; let sharedSessions = 0; let foreignExcluded = 0; let inclusiveSessions = 0; let sharedDispatches = 0;

  const addSplit = (t, f = 1) => { for (const k of Object.keys(tokensSplit)) tokensSplit[k] += num(t?.[k]) * f; };
  // Session-grain per-model quads, scaled by the SAME share factor as the
  // scalar totals — the dataset's tokens_by_model (required whenever a run
  // mixes tiers, which ours always do: haiku triage + sonnet workers).
  // Attribution audit (PR #63 mirror): a unit whose transcript reported no
  // usage sums as ZERO here — which silently under-bills. Count them so the
  // totals can say FLOOR instead of posing as complete.
  let unattributedUnits = 0;
  let attributedUnits = 0;
  const tokensByModel = {};
  const addByModel = (bm, f = 1) => {
    for (const [m, q] of Object.entries(bm ?? {})) {
      const t = (tokensByModel[m] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      for (const k of Object.keys(t)) t[k] += num(q?.[k]) * f;
    }
  };
  const roleAdd = (role, m, dispatches = 1) => {
    if (!byRole.has(role)) byRole.set(role, { tokens: 0, tok: emptyQuad(), costUsd: null, activeMin: 0, dispatches: 0, toolCalls: 0, toolErrors: 0, ...(rd ? { priced: 0, unpriced: 0 } : {}) });
    const b = byRole.get(role);
    countNul(b, m.nul);
    b.tokens += m.tokens; b.activeMin += m.activeMin; b.dispatches += dispatches;
    if (m.tok) addQuad(b.tok, m.tok);
    b.toolCalls += num(m.toolCalls); b.toolErrors += num(m.toolErrors);
    if (typeof m.costUsd === 'number') b.costUsd = num(b.costUsd) + m.costUsd;
  };

  const nu = migrationOn('null-unobservable');
  // active-minutes (B2 item 7, spec 5.4, owner Q7): a session's activeMin is allocated once, at session grain
  // (activeMin / div per group, on the lead thread and the parent's role). Dispatch minutes are neither subtracted
  // from the parent nor added to any bucket: a dispatch contributes activeMin null with its `nul` key null ("not
  // applicable"), so no bucket counts it as unmeasured. Buckets that only dispatches reach (per-item direct,
  // stages, the extension's byStage / rework, dispatch roles) output activeMin null: not allocated at this grain.
  const am = migrationOn('active-minutes');
  const sessionMin = new Set([overhead.lead]);   // buckets that carry session-grain minutes (identity, like sumOrNull)
  // Which quantities a unit (the parent thread, or a dispatch) did not measure; null with the migration off.
  const nulOf = (u, activeMin = u.activeMin) => (nu ? { tokens: u.tokens == null, activeMin: activeMin == null, toolCalls: u.toolCalls == null, toolErrors: u.toolErrors == null } : undefined);
  for (const line of lines) {
    hosts.add(line.host); users.add(line.user);
    for (const m of line.models || []) models.add(m);
    for (const s of line.skills || []) skills.add(s);
    if (line.costSource && line.costSource !== 'none') costSources.add(line.costSource);

    // How many batches did this session serve? Its session-level figures split
    // evenly across them; a single-batch session divides by 1 (unchanged).
    const div = 1 + others.filter((o) => o && lineMatchesBatch(line, { slug: o.keys ?? [], ids: o.ids ?? [], branches: o.branches ?? [] })).length;
    if (div > 1) sharedSessions++;

    // Partition dispatches: mine (named this batch's ids/slug) at full weight
    // (shared-allocation: 1/k when k groups call it mine), FOREIGN (named
    // another batch's, not mine) excluded entirely, neutral (named neither)
    // split evenly across the matched batches.
    let subCostAll = 0; let subMinAll = 0;
    const included = [];
    (line.subagents || []).forEach((s, i) => {
      if (typeof s.costUsd === 'number') subCostAll += s.costUsd;
      subMinAll += num(s.activeMin);
      const mine = dispatchMine(s, ids, myKeys);
      const foreign = !mine && (matchIds(s.label, [...foreignIds]).length > 0 || (s.cases ?? []).some((c) => foreignIds.has(c)) || mentionsKey(s.label, [...foreignKeys]));
      if (foreign) { foreignExcluded++; return; }
      const k = mine && splitShared ? Math.max(1, shared.get(dispatchKey(line, s, i)) ?? 1) : 1;
      if (k > 1) sharedDispatches++;
      included.push({ s, w: mine ? (k > 1 ? 1 / k : 1) : 1 / div });
    });

    // The lead's own thread = the session minus ALL its dispatches (foreign
    // ones included — they are not the parent's), then this batch's even share.
    // copilot-inclusive: read by the line's own basis (O10). The session total already contains its dispatches
    // and is allocated once, at session grain (§5.4); the dispatches add no tokens.
    const inclusive = line.tokensBasis === 'inclusive';
    if (inclusive) inclusiveSessions++;
    const parent = {
      costUsd: typeof line.costUsd === 'number' ? Math.max(0, line.costUsd - subCostAll) / div : null,
      tokens: subTokens({ tokens: line.tokens }) / div,
      tok: scaleQuad(line.tokens, 1 / div),
      activeMin: (am ? num(line.activeMin) : Math.max(0, num(line.activeMin) - subMinAll)) / div,
      toolCalls: num(line.toolCalls) / div,
      toolErrors: num(line.toolErrors) / div,
      ...(nu ? { nul: nulOf(line) } : {}),
    };
    if (nu) countMeasured(totals, 'turns', line.turns != null);
    totals.turns += num(line.turns) / div;
    addTo(totals, parent); totals.dispatches--; // phantom dispatch for the parent
    addSplit(line.tokens, 1 / div);
    addByModel(line.tokensByModel, 1 / div);
    if (line.tokens === null || line.tokensAttributed === false) unattributedUnits++; else attributedUnits++;
    addTo(overhead.lead, parent);
    overhead.lead.dispatches--; // ditto
    let roleCost = parent.costUsd;
    if (rd && typeof line.costUsd === 'number') for (const { s, w } of included) if (typeof s.costUsd === 'number') roleCost += s.costUsd * w;
    roleAdd(line.role || 'session', rd ? { ...parent, costUsd: roleCost } : parent, 0);
    if (rd) { const rb = byRole.get(line.role || 'session'); if (typeof line.costUsd === 'number') rb.priced++; else rb.unpriced++; }
    if (am) sessionMin.add(byRole.get(line.role || 'session'));

    for (const { s, w } of included) {
      const m = {
        costUsd: typeof s.costUsd === 'number' ? s.costUsd : null,
        tokens: inclusive ? 0 : subTokens(s), tok: scaleQuad(inclusive ? null : s.tokens), activeMin: am ? null : num(s.activeMin),
        toolCalls: num(s.toolCalls), toolErrors: num(s.toolErrors),
        ...(nu ? { nul: { ...nulOf(inclusive ? { ...s, tokens: null } : s), ...(am ? { activeMin: null } : {}) } } : {}),
      };
      // the session total (the parent) already covers an inclusive line's dispatches: its tokens are not a gap in the totals
      addTo(totals, inclusive && nu ? { ...m, nul: { ...m.nul, tokens: null } } : m, w);
      if (!inclusive) addSplit(s.tokens, w);
      if (!inclusive) addByModel(s.tokensByModel, w); // an inclusive session's model split is the parent's own (B2-04)
      if (inclusive) { /* split implied by the basis: neither attributed nor a gap */ } else if (s.tokens === null || s.tokensAttributed === false) unattributedUnits++; else attributedUnits++;
      if (rd) {
        if (!byDispatchRole.has(s.role || 'unknown')) byDispatchRole.set(s.role || 'unknown', { units: 0, costUsd: null, priced: 0 });
        const d = byDispatchRole.get(s.role || 'unknown');
        d.units += w;
        if (typeof m.costUsd === 'number') { d.costUsd = num(d.costUsd) + m.costUsd * w; d.priced += w; }
      }
      roleAdd(s.role || 'unknown', { ...m, costUsd: typeof m.costUsd === 'number' && !rd ? m.costUsd * w : null, tokens: m.tokens * w, tok: scaleQuad(m.tok, w), activeMin: m.activeMin * w, toolCalls: m.toolCalls * w, toolErrors: m.toolErrors * w }, w);
      const { kind, ids: matched } = classify(s.label, ids, s.cases || [], ext, { repo, settings });
      if (kind === 'direct') {
        if (typeof s.costUsd === 'number') pricedDirect = true;
        const share = w / matched.length; // even split across the cluster, any size
        for (const id of matched) addTo(perCase.get(id), m, share);
        hook(ext, 'classifyDispatch', s.label, { ...cls, phase: 'direct', m, w, share, rows: matched.map((id) => perCase.get(id)) });
      } else {
        addTo(overhead.stage, m, w);
        hook(ext, 'classifyDispatch', s.label, { ...cls, phase: 'overhead', m, w });
      }
    }
  }

  // O1 output: a sum no measured value reached reads null, beside the bucket's unmeasured counts (Q8d).
  const nz = (b, k, v) => (nu ? sumOrNull(b, k, v) : v);
  const unmOut = (b) => (nu ? { unmeasured: { ...emptyUnmeasured(), ...b.unmeasured } } : {});
  const cases = receipt.cases.map((c) => {
    const d = perCase.get(c.id) ?? caseBucket();
    return {
      id: c.id, outcome: c.outcome ?? null,
      ...(hook(ext, 'enrichGroup', c, { repo, settings, phase: 'case' }) ?? {}),
      direct: {
        costUsd: typeof d.costUsd === 'number' ? round2(d.costUsd) : null,
        tokens: nz(d, 'tokens', Math.round(d.tokens)), tok: nz(d, 'tokens', roundQuad(d.tok ?? emptyQuad())),
        activeMin: am ? null : nz(d, 'activeMin', Math.round(d.activeMin)),
        dispatches: Math.round(d.dispatches * 100) / 100, ...(hook(ext, 'classifyDispatch', d, { ...cls, phase: 'case-out' }) ?? {}),
        toolCalls: nz(d, 'toolCalls', Math.round(d.toolCalls)), toolErrors: nz(d, 'toolErrors', Math.round(d.toolErrors)),
        ...unmOut(d),
      },
    };
  });

  const attributed = cases.filter((c) => c.direct.dispatches > 0);
  const outcomes = {};
  for (const c of cases) if (c.outcome) outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
  // v2 vocabulary 'delivered'/'defect-found' + pre-v2 names for old receipts. The receipt's own resolved vocabulary
  // (B2-05, `receiptDelivery`): a stamped receipt reads its manifest archive, as the period denominator does.
  const delivery = receiptDelivery(repo ? telemetryDir(repo, settings) : null, receipt, settings);
  const delivered = delivery.deliveredOutcomes.reduce((n, o) => n + num(outcomes[o]), 0);
  const ohCost = num(overhead.lead.costUsd) + num(overhead.stage.costUsd);
  const ohPriced = typeof overhead.lead.costUsd === 'number' || typeof overhead.stage.costUsd === 'number';

  // The extension's records vs the receipt (TA: gate verdict, gate-run records + declared outcomes, drift).
  const records = hook(ext, 'enrichGroup', receipt, { repo, settings, phase: 'records', slug, dir, scopes }) ?? {};

  // FULLY LOADED per case: direct + an EVEN share of batch overhead. This is
  // an ALLOCATION, clearly labelled — the doctrine still shows overhead once
  // at batch level and never claims to have measured a per-case split — but
  // "what did this case really cost the batch" is the figure cross-batch
  // comparisons want. Even split across EVERY receipt case: overhead (triage,
  // gate, lead, report) served examined cases too, not only delivered ones.
  const ohMin = overhead.lead.activeMin + overhead.stage.activeMin;
  const ohTok = overhead.lead.tokens + overhead.stage.tokens;
  const nCases = cases.length || 1;
  // O1: the loaded figure sums the case's direct bucket and the lead + stage overhead. It is null when none of
  // them received a measured value and some received an unmeasured one; the parts' counts ride beside it.
  const loadedParts = (c) => [perCase.get(c.id), overhead.lead, overhead.stage].filter(Boolean);
  const loadedUnm = (c, k) => loadedParts(c).reduce((n, b) => n + (b.unmeasured?.[k] ?? 0), 0);
  const loadedSum = (c, k, v) => (nu && loadedUnm(c, k) && !loadedParts(c).some((b) => measuredIn(b, k)) ? null : v);
  const casesOut = cases.map((c) => ({
    ...c,
    loaded: {
      costUsd: ohPriced || typeof c.direct.costUsd === 'number'
        ? round2(num(c.direct.costUsd) + (ohPriced ? ohCost / nCases : 0))
        : null,
      tokens: loadedSum(c, 'tokens', Math.round(num(c.direct.tokens) + ohTok / nCases)),
      // active-minutes: group time ÷ items, a labelled allocation (§5.4); null while no group minute was measured.
      activeMin: am
        ? (nu && totals.unmeasured?.activeMin && !measuredIn(totals, 'activeMin') ? null : Math.round(totals.activeMin / nCases))
        : loadedSum(c, 'activeMin', Math.round(num(c.direct.activeMin) + ohMin / nCases)),
      ...(nu ? { unmeasured: { ...emptyUnmeasured(), tokens: loadedUnm(c, 'tokens'), activeMin: loadedUnm(c, 'activeMin') } } : {}),
    },
  }));

  // Extension enrichment of the case rows + group (TA: predicted size vs size-class history).
  const sizing = hook(ext, 'enrichGroup', casesOut, { repo, settings, phase: 'sizing', slug }) ?? {};

  const vocab = words(settings);
  const bucketOut = (b) => ({
    costUsd: typeof b.costUsd === 'number' ? round2(b.costUsd) : null,
    tokens: nz(b, 'tokens', Math.round(b.tokens)), tok: nz(b, 'tokens', roundQuad(b.tok ?? emptyQuad())),
    activeMin: am && !sessionMin.has(b) ? null : nz(b, 'activeMin', Math.round(b.activeMin)),
    dispatches: Math.round(b.dispatches * 100) / 100,
    toolCalls: nz(b, 'toolCalls', Math.round(b.toolCalls)), toolErrors: nz(b, 'toolErrors', Math.round(b.toolErrors)),
    ...unmOut(b),
  });
  const cost = {
    v: COST_VERSION,
    // report-revision (spec 14.4, map O6): the writer's stamp rule — module.json absent → 1, unusable → null (unknown).
    ...(migrationOn('report-revision') ? { manifestRevision: stampRevision(repo ? telemetryDir(repo, settings) : null) } : {}),
    batch: slug, generatedAt: new Date().toISOString(),
    sources: {
      sessions: lines.length, hosts: [...hosts].sort(), users: [...users].sort(), costSources: [...costSources].sort(), models: [...models].sort(),
      ...(lines.some((l) => l.live) ? {
        liveSessions: lines.filter((l) => l.live).length,
        liveNote: 'PROVISIONAL — a session is still running: its finished dispatches are counted, its own lead thread is not yet measured, so these totals are a floor. Re-run once it ends.',
      } : {}),
      ...(sharedSessions ? { sharedSessions, note: `session-level figures of shared sessions are split evenly across the ${vocab.groups} they served` } : {}),
      ...(sharedDispatches ? { sharedDispatches, sharedDispatchesNote: `a dispatch that is the work of k ${vocab.groups} is split evenly (1/k) across them, so it is counted once in total` } : {}),
      ...(foreignExcluded ? { foreignDispatchesExcluded: foreignExcluded } : {}),
      ...(am ? { activeMinGrain: 'session', activeMinNote: `active minutes are allocated once, at session grain (spec 5.4): per-${vocab.item}, stage and dispatch-role minutes are not allocated (null, which is not unmeasured); loaded minutes = ${vocab.group} time ÷ ${vocab.items}, an allocation` } : {}),
      ...(conflicted ? { conflicts: conflicted, conflictsNote: 'a session with an exact (endedAt, capturedAt) tie and different payloads is a conflict (spec 3.5): it is not in these totals; preview adds each conflict\'s lowest-canonical-JSON pick' } : {}),
      ...(inclusiveSessions ? { inclusiveSessions, inclusiveNote: 'Copilot reports one cache-inclusive total per session: its token split is unallocated at dispatch grain (the session total is counted once, in totals and the lead thread)' } : {}),
    },
    totals: {
      costUsd: typeof totals.costUsd === 'number' ? round2(totals.costUsd) : null,
      tokens: nz(totals, 'tokens', Math.round(totals.tokens)), tokensSplit: nz(totals, 'tokens', Object.fromEntries(Object.entries(tokensSplit).map(([k, v]) => [k, Math.round(v)]))),
      ...(Object.keys(tokensByModel).length ? { tokensByModel: Object.fromEntries(Object.entries(tokensByModel).map(([m, q]) => [m, roundQuad(q)])) } : {}),
      ...(unattributedUnits ? { tokensAttribution: attributedUnits ? 'partial' : 'none', unattributedUnits } : {}),
      activeMin: nz(totals, 'activeMin', Math.round(totals.activeMin)),
      dispatches: Math.round(totals.dispatches * 100) / 100, sessions: totals.sessions,
      turns: nz(totals, 'turns', Math.round(totals.turns)), toolCalls: nz(totals, 'toolCalls', Math.round(totals.toolCalls)), toolErrors: nz(totals, 'toolErrors', Math.round(totals.toolErrors)),
      skills: [...skills].sort(),
      ...unmOut(totals),
    },
    ...(preview ? { preview: { sessions: preview.sessions, costUsd: preview.costUsd, note: `the ${vocab.group} total with each conflict's preview pick (lowest canonical JSON): not verified` } } : {}),
    byRole: Object.fromEntries([...byRole.entries()].sort().map(([r, b]) => [r, rd ? { ...bucketOut(b), priced: b.priced, unpriced: b.unpriced } : bucketOut(b)])),
    ...(rd ? { byDispatchRole: Object.fromEntries([...byDispatchRole.entries()].sort(([a], [z]) => (a < z ? -1 : a > z ? 1 : 0)).map(([r, d]) => [r, {
      units: Math.round(d.units * 100) / 100, costUsd: typeof d.costUsd === 'number' ? round2(d.costUsd) : null, priced: Math.round(d.priced * 100) / 100,
    }])) } : {}),
    overhead: {
      note: `${vocab.group}-level work (lead thread${(hook(ext, 'classifyDispatch', null, { ...cls, phase: 'stage-names' }) ?? []).map((n) => `, ${n}`).join('')}) — shown once, never smeared into per-${vocab.item} rows`,
      costUsd: ohPriced ? round2(ohCost) : null,
      sharePct: ohPriced && totals.costUsd ? Math.round((ohCost / totals.costUsd) * 100) : null,
      lead: bucketOut(overhead.lead),
      stages: bucketOut(overhead.stage),
      ...(hook(ext, 'classifyDispatch', null, { ...cls, phase: 'overhead-out', bucketOut }) ?? {}),
    },
    ...(hook(ext, 'classifyDispatch', null, { ...cls, phase: 'group-out', bucketOut }) ?? {}),
    outcomes, delivered,
    ...(delivery.finding ? { findings: [delivery.finding] } : {}),   // unverified receipt: delivers nothing (Q11b)
    ...records,
    cases: casesOut,
    ...(receipt.work_item_ref ? { workItemRef: receipt.work_item_ref } : {}),
    ...sizing,
    stats: {
      note: `direct = per-${vocab.item} measured values only; loaded = direct + even overhead share (allocation, not measurement)`,
      directCostUsd: pricedDirect ? money(stats(attributed.map((c) => c.direct.costUsd))) : null,
      directTokens: rounded(stats(attributed.map((c) => c.direct.tokens))),
      directActiveMin: rounded(stats(attributed.map((c) => c.direct.activeMin))),
      loadedCostUsd: (ohPriced || pricedDirect) ? money(stats(casesOut.map((c) => c.loaded.costUsd))) : null,
      loadedActiveMin: rounded(stats(casesOut.map((c) => c.loaded.activeMin))),
    },
    averages: {
      totalPerDelivered: delivered > 0 && typeof totals.costUsd === 'number'
        ? { costUsd: round2(totals.costUsd / delivered), note: `whole ${vocab.group} incl. overhead ÷ delivered (${hook(ext, 'enrichGroup', { outcomes: delivery.deliveredOutcomes }, { settings, phase: 'delivered-note' }) ?? delivery.deliveredOutcomes.join('/')})` } : null,
      directPerCase: pricedDirect && attributed.length
        ? { costUsd: round2(attributed.reduce((a, c) => a + num(c.direct.costUsd), 0) / attributed.length), note: `avg direct spend of an attributed ${vocab.item} — excludes ${vocab.group} overhead` } : null,
    },
    coverage: {
      casesAttributed: attributed.length, casesUnattributed: cases.filter((c) => !c.direct.dispatches).map((c) => c.id),
      note: 'unattributed = no dispatch label named this id in any matched session (interrupted capture, or work not yet swept)',
    },
  };
  deliveredVocab.set(cost, delivery.deliveredOutcomes);
  return cost;
}

// B2-05: the delivered vocabulary each cost object's `delivered` was counted with — kept beside the object, not in
// cost.json, so the period report's per-case rows read delivery by the same resolution as the group's count.
const deliveredVocab = new WeakMap();
/** The receipt-resolved delivered outcomes `buildBatchCost` used for `cost` (`receiptDelivery`). */
export const groupDeliveredOutcomes = (cost) => deliveredVocab.get(cost) ?? [];

/** A receipt's identity for the cross-batch exclusion (see buildBatchCost). */
const receiptIdentity = ({ slug, receipt }) => ({
  keys: [slug, receipt.batch].filter(Boolean),
  ids: receipt.cases.map((c) => c.id).filter(Boolean),
  branches: [receipt.integration_branch, ...receipt.cases.map((c) => c.branch)].filter(Boolean),
});

/** Recompute cost.json for every batch (or one) this repo's ledger can see.
 * `live` (default on) also counts sessions that are STILL RUNNING, rebuilt
 * from their dispatch deltas — what makes a batch view current mid-run. Turn
 * it off for a period rollup, whose own totals are ledger-only: mixing the two
 * would show provisional batch rows beside final totals in one document. */
export function updateBatchCosts(repo, { batch, write = true, live = true } = {}, settings = loadSettings(repo), ext = null) {
  const receipts = loadReceipts(repo, { batch }, settings);
  if (!receipts.length) return [];
  // `others` must come from EVERY receipt in the repo, not the filtered set —
  // a --batch build still has to exclude the other batches' dispatches.
  const all = batch ? loadReceipts(repo, {}, settings) : receipts;
  // Ledger lines + provisional lines for sessions that have NO ledger line yet.
  // The real line always wins outright — not by timestamp: after a mid-run
  // close the ledger line is complete (it includes the lead's own thread)
  // while a fresh live file may hold only the dispatches that finished after
  // it, so ranking them by recency would swap a full line for a thinner one.
  const ledger = loadLines([repo], settings);
  const known = new Set(ledger.map((l) => `${l.host}:${l.id}`));
  const allLines = live
    ? [...ledger, ...loadLiveLines(repo, settings).filter((l) => !known.has(`${l.host}:${l.id}`))]
    : ledger;
  const scopes = listScopes(repo, {}, settings);
  // shared-allocation: k per dispatch across EVERY receipt (not the --batch filter), rollups excluded.
  const shared = migrationOn('shared-allocation') ? sharedDispatchCounts(all, allLines, { scopes }) : null;
  const out = [];
  for (const { slug, dir, receipt } of receipts) {
    const others = all.filter((r) => r.slug !== slug).map(receiptIdentity);
    const cost = buildBatchCost(slug, receipt, allLines, { dir, scopes, others, repo, settings, ext, shared });
    if (write) {
      // reports-location (Q13c): cost.json moves with the reports; under 'tree' it stays beside the receipt.
      const out_ = settings.reports?.location === 'telemetry' ? groupReportsDir(repo, settings, slug) : dir;
      mkdirSync(out_, { recursive: true });
      writeFileSync(join(out_, 'cost.json'), `${JSON.stringify(cost, null, 1)}\n`);
    }
    out.push(cost);
  }
  return out;
}

// --- CLI ---------------------------------------------------------------------
const ENGINE_ROOT = engineRootOf(import.meta.url);
const entryOn = entryPointsOn(ENGINE_ROOT); // items 12/13 (an installed copy run with the switch set never parses it here)
async function main(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const batchIdx = argv.indexOf('--batch');
  const batch = batchIdx !== -1 ? argv[batchIdx + 1] : undefined;
  const repo = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--batch') ?? process.cwd());
  // activation (D-ACT, R19): an inert or refused copy writes nothing, and says why; --stdout writes nothing, so inert may print
  if (!gateCli(ENGINE_ROOT, repo, { writes: !flags.has('--stdout') })) { if (entryOn) return exitAfterDrain(1); process.exit(1); }
  const settings = loadSettings(repo);
  const ext = await loadExtension(settings, repo);
  const results = updateBatchCosts(repo, { batch, write: !flags.has('--stdout') }, settings, ext);
  if (!results.length) { console.error(`batch-cost: no receipts under ${receiptsRoot(repo, settings)}`); if (entryOn) return exitAfterDrain(1); process.exit(1); }
  if (flags.has('--stdout') || flags.has('--json')) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 1));
  else for (const r of results) console.error(`batch-cost: ${r.batch} — ${r.sources.sessions} session(s), ${r.cases.length} ${words(settings).item}(s), total ${r.totals.costUsd != null ? `$${r.totals.costUsd}` : `${r.totals.tokens} tokens (unpriced)`} → cost.json`);
}

if (entryOn ? isMain(import.meta.url) : (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)) await main();
