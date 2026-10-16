#!/usr/bin/env node
// team-report.mjs — assemble the team usage report from tokenomics ledgers.
//
//   node team-report.mjs [roots...] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//                        [--receipts <path>] [--json] [--out <file>]
//
// Each root may be a repo root (reads .agents/telemetry/automation/*.jsonl and joins
// .agents/automation/*/report.json receipts), a telemetry dir, or a single
// ledger file (a telemetry dir or ledger-file root has no settings of its own, so
// it reads as TA defaults — mixing one with a foreign repo root exits 2; see
// rootsConflict). Several roots = several repos rolled into one report — that is
// the whole point: every engineer's committed ledger lines merge through git,
// and this script turns them into "what did the team spend, and what did it
// deliver".
//
// DOLLAR HONESTY (same doctrine as efficiency-audit): only real figures are
// summed — ccusage-metered lines and Copilot's own billed credits. Sessions
// without a real figure are counted and labelled tokens-only, never estimated.
// Case counts come from the pipeline's own report.json receipts (`cases[]`
// with an `id` and an `outcome`), never from guessing at chat history.
//
// STDLIB ONLY. Read-only except --out.
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, basename, resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSettings, telemetryDir, receiptsRoot, TA_DEFAULTS, b1RatioIntents, words } from '../engine/config.mjs';
import { hook, loadExtension, extensionPath } from '../engine/extension.mjs';
import { migrationOn } from '../engine/migrations.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { engineRootOf, entryPointsOn, gateCli } from '../engine/activation.mjs';
import { manifestFor, receiptDelivery, stampRevision } from '../engine/manifest.mjs';
import { canonical, accountingPayload } from '../kit/canonical.mjs';
import { updateBatchCosts, groupDeliveredOutcomes } from './batch-cost.mjs';

// Outcomes that mean "a spec was produced" — settings.receipts.deliveredOutcomes (TA: v2 'delivered',
// 'defect-found' = held on a ticketed product defect, still a delivered spec; 'automated' /
// 'merged-sanctioned-red' are the pre-v2 names kept for old receipts).

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// --- Loading -----------------------------------------------------------------
function ledgerFilesOf(root, settings = loadSettings(root)) {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return root.endsWith('.jsonl') ? [root] : [];
  for (const dir of [telemetryDir(root, settings), root]) {
    if (!existsSync(dir)) continue;
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    const files = names.filter((f) => /^usage.*\.jsonl$/.test(f)).map((f) => join(dir, f));
    if (files.length) return files;
  }
  return [];
}

// The telemetry directory each loaded line was read from: D1 binds a line through `<dir>/manifests/<N>.json`.
const LINE_DIR = new WeakMap();
/** The telemetry directory `line` was loaded from (null for a line built in memory). */
export const lineTelemetryDir = (line) => LINE_DIR.get(line) ?? null;

/** `settings` (one repo's) applies to every root; omitted, each root reads its own. */
export function loadLines(roots, settings) {
  const lines = [];
  for (const root of roots) {
    for (const f of ledgerFilesOf(root, settings)) {
      for (const raw of readFileSync(f, 'utf8').split('\n')) {
        if (!raw.trim()) continue;
        const rec = safeParse(raw);
        if (rec && rec.host && rec.id && typeof rec.v === 'number') { LINE_DIR.set(rec, dirname(f)); lines.push(rec); }
      }
    }
  }
  return lines;
}

/** One line per host:id — a resumed session gets re-captured; the latest wins. */
export function dedupLines(lines) {
  const byKey = new Map();
  const rank = (l) => [l.endedAt ? Date.parse(l.endedAt) : 0, l.capturedAt ? Date.parse(l.capturedAt) : 0];
  for (const l of lines) {
    const key = `${l.host}:${l.id}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, l); continue; }
    const [pe, pc] = rank(prev); const [ce, cc] = rank(l);
    if (ce > pe || (ce === pe && cc > pc)) byKey.set(key, l);
  }
  return [...byKey.values()];
}

// --- report-conflicts (B2 item 22, spec 3.5 + 3.3; map R20, O2; owner Q16) -------------------------------------
// The kit's dedup rule (kit/identity.mjs, the one `aggregate` uses): rank = (endedAt, capturedAt), null or unreadable
// ranks lowest. Among the lines of an exact rank tie, one representative per accounting payload (the lowest full
// canonical line): one payload is a duplicate, several are a conflict whose preview pick is the lowest canonical
// accounting payload. Canonical JSON and the accounting payload are the kit's (kit/canonical.mjs).
const rankMs = (s) => { const t = typeof s === 'string' ? Date.parse(s) : NaN; return Number.isNaN(t) ? -Infinity : t; };
const cmpNum = (a, z) => (a > z ? 1 : a < z ? -1 : 0);
const cmpRank = (a, z) => cmpNum(rankMs(a.endedAt), rankMs(z.endedAt)) || cmpNum(rankMs(a.capturedAt), rankMs(z.capturedAt));
/** Exact-rank-tie lines grouped per canonical form of `payloadOf`: one representative per form (the lowest
 * `canonical(line)`), the forms sorted. */
function tiePayloads(top, payloadOf) {
  const byPayload = new Map();
  for (const l of top) {
    const p = canonical(payloadOf(l)); const prev = byPayload.get(p);
    if (!prev || canonical(l) < canonical(prev)) byPayload.set(p, l);
  }
  return [...byPayload.keys()].sort().map((p) => byPayload.get(p));
}
/** Spec 3.5 dedup per host:id, independent of input order. `winners`: the verified line per key, sorted by key
 * (review round 1, I3: every bucket's key order and summation order follow it, so the report is byte-identical for
 * any read order); `duplicates`: lines dropped as identical-payload copies of an exact tie; `conflicts`: [{key, lines}] the
 * exact ties with different payloads (excluded from verified totals), in key order; `preview`: each conflict's pick, in key order. */
export function dedupConflicts(lines) {
  const groups = new Map();
  for (const l of lines) {
    const k = `${l.host}:${l.id}`;
    const g = groups.get(k);
    if (!g) { groups.set(k, [l]); continue; }
    const c = cmpRank(l, g[0]);
    if (c > 0) groups.set(k, [l]); else if (c === 0) g.push(l);
  }
  const winners = []; const conflicts = []; const preview = []; let duplicates = 0;
  for (const [key, top] of [...groups].sort(([a], [z]) => (a < z ? -1 : a > z ? 1 : 0))) {
    const reps = tiePayloads(top, accountingPayload);
    duplicates += top.length - reps.length;
    if (reps.length === 1) winners.push(reps[0]);
    else { conflicts.push({ key, lines: reps }); preview.push(reps[0]); }
  }
  return { winners, duplicates, conflicts, preview };
}

const localDate = (iso) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Keep sessions involving a role — as the session's own agent OR among its
 * dispatched sub-agents. A report-time filter on purpose: capture always keeps
 * everything (a session filtered at capture would be lost once its transcript
 * expires); slicing is free here.
 */
export function filterRole(lines, role) {
  if (!role) return lines;
  return lines.filter((l) => l.role === role || (l.subagents ?? []).some((s) => s.role === role));
}

export function filterWindow(lines, since, until) {
  if (migrationOn('report-windows')) return reportWindow(lines, since, until).lines;
  if (!since && !until) return lines;
  return lines.filter((l) => {
    const d = l.startedAt ? localDate(l.startedAt) : null;
    if (!d) return false;
    if (since && d < since) return false;
    if (until && d > until) return false;
    return true;
  });
}

// --- Report windows (B2 item 8 report-windows, spec 5.5; owner Q10b, Q10d) ----------------------------
// ISO-8601 only: a date, or a date-time with an optional offset. Date.parse alone would read an offset-less
// date-time in the machine's local zone and accept forms such as "Oct 1 2026" or "2026-10" (review M1).
const ISO = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/;
/** An ISO-8601 date or date-time as a UTC instant in ms, NaN for anything else. A date-only value is
 * `T00:00:00Z` (owner Q10d) and a date-time without an offset is read as UTC, never local time. Used for
 * `--since`/`--until`, ledger `endedAt` and receipt `revision` / `at`. */
export function parseInstant(arg) {
  const m = typeof arg === 'string' ? ISO.exec(arg) : null;
  if (!m) return NaN;
  const t = Date.parse(`${m[1]}T${m[2] ?? '00:00:00'}${m[3] ?? 'Z'}`);
  const day = Date.parse(`${m[1]}T00:00:00Z`);   // rejects an impossible date such as 2026-02-31 (no rollover)
  return Number.isFinite(t) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === m[1] ? t : NaN;
}
const instant = parseInstant;
/** The report's one window `[since, until)` on `endedAt` (spec 5.5): `since` defaults to the earliest `endedAt`
 * among `lines` (the telemetry cohort start, never "all time"), `until` to the report time. A line without a
 * readable `endedAt` lies in no window: it is returned in `undated`, which the report counts (O1, review I2). */
export function reportWindow(lines, since, until, now = Date.now()) {
  const ended = lines.map((l) => instant(l.endedAt)).filter(Number.isFinite);
  const s = since ? parseInstant(since) : (ended.length ? ended.reduce((a, b) => Math.min(a, b)) : null);
  const u = until ? parseInstant(until) : now;
  const inWindow = (t) => Number.isFinite(t) && (s == null || t >= s) && t < u;
  return { since: s, until: u, inWindow, lines: lines.filter((l) => inWindow(instant(l.endedAt))),
    undated: lines.filter((l) => !Number.isFinite(instant(l.endedAt))) };
}
const SEMANTICS = 'Current state, UTC: the per-delivered ratio counts items whose current (winning, spec 5.2) receipt state is delivered, '
  + 'dated by that state\'s at, inside [since, until); an item delivered, reopened and delivered again counts once, at its latest delivery, '
  + 'so historical ratios can change when items reopen. Limitation: a session\'s cumulative ledger line counts wholly in the window of its endedAt; '
  + 'no in-window deltas are claimed. Totals and breakdowns cover the sessions whose endedAt lies in the window; sessions '
  + 'without endedAt are outside every window and counted as undated.';

/** ISO week label (e.g. 2026-W31) of a line's start. */
export function isoWeek(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const d = new Date(t);
  const thu = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// --- Receipts (cases) --------------------------------------------------------
function findReports(target, settings = TA_DEFAULTS) {
  if (!target || !existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  // Walk the WHOLE tree under the target: campaigns nest wave receipts in
  // sub-folders (.agents/automation/<batch>/<wave>/report.json — the campaign
  // workflow's own reportDir), so a one-level scan silently under-counts any
  // campaign that uses them. Same fix efficiency-audit's run-reports.mjs
  // carries (field-flagged twice, 2026-08-04 and 2026-08-06, before landing
  // there). Dirent.isDirectory() does not follow symlinks, so no link cycles.
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // underscore working dirs are not batches; 'telemetry' = legacy-layout defense
      if (entry.name === 'telemetry' || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === settings.receipts.file) out.push(p);
    }
  };
  walk(target);
  return out;
}

// --- Receipt ordering (spec 5.2: one rule, everywhere) ------------------------------------------------
// A case row's rank is (revision, at, group, source): a later revision wins, a missing revision ranks below any
// present one; then the later `at`; then the lowest group, then the lowest source. Item 22 (report-conflicts)
// reuses this ordering for its exact ties.
const later = (a, z) => (a === z ? 0 : a == null ? -1 : z == null ? 1 : a > z ? 1 : -1);
const lower = (a, z) => (a === z ? 0 : a < z ? 1 : -1);
/** > 0 when receipt row `a` outranks `z`, < 0 when `z` does, 0 on an exact rank tie. */
export function compareReceiptRows(a, z) {
  return later(a.revision, z.revision) || later(a.at, z.at) || lower(a.group, z.group) || lower(a.source, z.source);
}
/** The winning row per id (`rows` in read order; on an exact tie the later row wins, as the reference's re-read did). */
export function currentReceiptRows(rows) {
  const win = new Map();
  for (const r of rows) { const p = win.get(r.id); if (!p || compareReceiptRows(r, p) >= 0) win.set(r.id, r); }
  return win;
}

/** report-conflicts: spec 3.5 over receipt rows (map: item 22 reuses the 5.2 ordering). An exact rank tie between
 * identical rows is a duplicate; with a different payload (outcome) it is a conflict: no winner, the id is excluded
 * from the counts, and its preview pick is the lowest canonical row. Independent of read order. */
export function receiptWinners(rows) {
  const top = new Map();
  for (const r of rows) {
    const g = top.get(r.id);
    const c = g ? compareReceiptRows(r, g[0]) : 1;
    if (c > 0) top.set(r.id, [r]); else if (c === 0) g.push(r);
  }
  const win = new Map(); const conflicts = []; const preview = new Map(); let duplicates = 0;
  for (const [id, tied] of top) {
    const reps = tiePayloads(tied, (r) => r);
    duplicates += tied.length - reps.length;
    if (reps.length === 1) win.set(id, reps[0]);
    else { conflicts.push({ id, rows: reps }); preview.set(id, reps[0]); }
  }
  return { win, duplicates, conflicts, preview };
}

/** report-windows: every files receipt row under `receiptDirs`, ranked by spec 5.2. A receipt stamped with a
 * `manifestRevision` reads its delivered outcomes from that revision (D1; a missing archive counts nothing as
 * delivered and adds its finding). A receipt without one (every spec 5.1 receipt) is reference-era (owner Q10c):
 * its delivered outcomes come from the receipt policy that discovered it, `settings.receipts` (controller ruling,
 * review I1: the same policy the group cost uses), and with no `revision` its mtime serves as revision. */
function receiptRows(receiptDirs, settings, telemetryDirs = []) {
  const rows = []; const findings = new Set(); let reports = 0;
  receiptDirs.forEach((d, i) => {
    for (const p of findReports(d, settings)) {
      reports++;
      const rep = safeParse(readFileSync(p, 'utf8'));
      const { deliveredOutcomes, stamped, finding } = receiptDelivery(telemetryDirs[i] ?? null, rep, settings);
      if (finding) findings.add(finding);
      const stated = instant(rep?.revision);
      const revision = Number.isFinite(stated) ? stated : rep?.revision === undefined && !stamped ? statSync(p).mtimeMs : null;
      const group = statSync(d).isFile() ? basename(dirname(p)) : relative(d, dirname(p)).split(sep).join('/');
      for (const row of rep?.cases ?? []) {
        if (!row?.id) continue;
        const outcome = typeof row.outcome === 'string' && row.outcome ? row.outcome : 'not-started';
        const at = instant(row.at);
        rows.push({ id: row.id, outcome, at: Number.isFinite(at) ? at : null, revision, group, source: 'files',
          delivered: deliveredOutcomes.includes(outcome) });
      }
    }
  });
  return { rows, findings: [...findings].sort(), reports };
}

/** Latest outcome per case id across every receipt (re-entry folds to one row). With report-windows (spec 5.5
 * steps 1-2): the current state per id by the 5.2 ordering; `delivered` = winners whose outcome is delivered and
 * whose `at` lies in `window` ({since, until} ms); delivered winners without `at` are counted as `unwindowed`. */
export function loadCases(receiptDirs, settings = TA_DEFAULTS, { window = null, telemetryDirs = [] } = {}) {
  if (migrationOn('report-windows')) {
    const { rows, findings, reports } = receiptRows(receiptDirs, settings, telemetryDirs);
    const inWindow = (t) => t != null && (window?.since == null || t >= window.since) && (window?.until == null || t < window.until);
    const outcomes = {}; let delivered = 0; let unwindowed = 0;
    const rc = migrationOn('report-conflicts') ? receiptWinners(rows) : null;
    const win = rc ? rc.win : currentReceiptRows(rows);
    for (const r of win.values()) {
      outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
      if (!r.delivered) continue;
      if (r.at == null) unwindowed++; else if (inWindow(r.at)) delivered++;
    }
    // report-conflicts: conflicted ids leave every count; the preview adds their picks (Q16)
    const picks = [...(rc?.preview.values() ?? [])].filter((r) => r.delivered);
    const conflicts = rc?.conflicts.length ? { conflicts: rc.conflicts.length, preview: {
      examined: win.size + rc.preview.size,
      delivered: delivered + picks.filter((r) => r.at != null && inWindow(r.at)).length,
      unwindowed: unwindowed + picks.filter((r) => r.at == null).length } } : {};
    return { examined: win.size, delivered, unwindowed, outcomes, reports, ...conflicts, ...(findings.length ? { findings } : {}) };
  }
  const reports = receiptDirs.flatMap((d) => findReports(d, settings))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  const latest = new Map();
  for (const { p } of reports) {
    const rep = safeParse(readFileSync(p, 'utf8'));
    for (const row of rep?.cases ?? []) {
      if (row?.id) latest.set(row.id, typeof row.outcome === 'string' && row.outcome ? row.outcome : 'not-started');
    }
  }
  const outcomes = {};
  for (const o of latest.values()) outcomes[o] = (outcomes[o] ?? 0) + 1;
  return { examined: latest.size, delivered: settings.receipts.deliveredOutcomes.reduce((n, o) => n + (outcomes[o] ?? 0), 0), outcomes, reports: reports.length };
}

// --- Aggregation -------------------------------------------------------------
const addTok = (a, b) => {
  a.input += num(b?.input); a.output += num(b?.output);
  a.cacheRead += num(b?.cacheRead); a.cacheWrite += num(b?.cacheWrite);
};
const emptyTok = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** A line's full token footprint — parent + its sub-agents. */
export function lineTokens(l) {
  const t = emptyTok();
  addTok(t, l.tokens);
  // An inclusive line's session total already contains its dispatches (§3.2.1): read by the line's own basis (O10)
  if (l.tokensBasis !== 'inclusive') for (const s of l.subagents ?? []) addTok(t, s.tokens);
  return t;
}

// --- Unmeasured quantities (B2 item 4 null-unobservable, obligation O1; spec 3.2.1) ----------------
// "Aggregates carry unknowns as counts, never as zero": every aggregate bucket carries
// `unmeasured: {tokens, activeMin, wallMin, turns, toolCalls, toolErrors}` (owner Q8d) beside its sums, and a
// sum no measured value reached is null instead of 0. A sum is numeric while it is being built; which keys
// have received a measured value is tracked per bucket here, so a measured 0 stays a measured 0.
export const UNMEASURED_KEYS = ['tokens', 'activeMin', 'wallMin', 'turns', 'toolCalls', 'toolErrors'];
export const emptyUnmeasured = () => Object.fromEntries(UNMEASURED_KEYS.map((k) => [k, 0]));
const MEASURED = new WeakMap();   // bucket → Set of keys that received a measured value
/** Record one contribution to `bucket[key]` as measured (true) or unmeasured (false); returns `bucket`. */
export function countMeasured(bucket, key, measured) {
  if (!MEASURED.has(bucket)) MEASURED.set(bucket, new Set());
  if (measured) MEASURED.get(bucket).add(key);
  else { bucket.unmeasured ??= emptyUnmeasured(); bucket.unmeasured[key]++; }
  return bucket;
}
/** True when `bucket[key]` received at least one measured contribution (identity-keyed, like `sumOrNull`). */
export const measuredIn = (bucket, key) => !!MEASURED.get(bucket)?.has(key);
/** `sum`, or null when the bucket counted unmeasured `key` contributions and no measured one. */
export function sumOrNull(bucket, key, sum) {
  return bucket.unmeasured?.[key] && !MEASURED.get(bucket)?.has(key) ? null : sum;
}
/** A null or absent value increments `bucket.unmeasured[key]`; otherwise it adds (times `share`) to the sum
 * (a token quad adds per category). The sum reads null while only unmeasured values have reached it. */
export function addMeasured(bucket, key, value, share = 1) {
  if (value == null) {
    countMeasured(bucket, key, false);
    bucket[key] = sumOrNull(bucket, key, bucket[key]);
    return bucket;
  }
  const first = !MEASURED.get(bucket)?.has(key);
  countMeasured(bucket, key, true);
  if (typeof value === 'object') {
    if (first && bucket[key] == null) bucket[key] = emptyTok();
    for (const k of Object.keys(bucket[key])) bucket[key][k] += num(value[k]) * share;
  } else {
    if (first && bucket[key] == null) bucket[key] = 0;
    bucket[key] += num(value) * share;
  }
  return bucket;
}
/** ` (n unmeasured)` beside a rendered sum, or '' (always '' with the migration off: no `unmeasured` field). */
export const unmeasuredNote = (b, key) => (b?.unmeasured?.[key] ? ` (${b.unmeasured[key]} unmeasured)` : '');

function bucket() {
  return { sessions: 0, costUsd: 0, priced: 0, tokens: emptyTok(), activeMin: 0, wallMin: 0, turns: 0, toolCalls: 0, toolErrors: 0,
    ...(migrationOn('null-unobservable') ? { unmeasured: emptyUnmeasured() } : {}) };
}
function addLine(b, l) {
  b.sessions++;
  if (typeof l.costUsd === 'number') { b.costUsd += l.costUsd; b.priced++; }
  if (migrationOn('null-unobservable')) {
    for (const u of [l, ...(l.tokensBasis === 'inclusive' ? [] : (l.subagents ?? []))]) addMeasured(b, 'tokens', u.tokens);
    for (const k of ['activeMin', 'wallMin', 'turns', 'toolCalls', 'toolErrors']) addMeasured(b, k, l[k]);
    return;
  }
  addTok(b.tokens, lineTokens(l));
  b.activeMin += num(l.activeMin); b.wallMin += num(l.wallMin);
  b.turns += num(l.turns); b.toolCalls += num(l.toolCalls); b.toolErrors += num(l.toolErrors);
}

/** `undated` (report-windows): the in-scope lines with no readable `endedAt`, outside every window; the report
 * counts them beside the ratio (`undated: {sessions, costUsd, priced}`, O1), never in a total.
 * `conflicts` (report-conflicts): the in-scope preview picks of spec 3.5 conflicts, outside every verified total;
 * counted as `conflicts: {sessions, costUsd, priced}` with `preview` = the totals plus the picks (O2, Q16). */
export function buildReport(lines, cases, settings = TA_DEFAULTS, { undated = [], conflicts = [] } = {}) {
  const totals = bucket();
  const byPerson = new Map(); const byWeek = new Map(); const byHost = new Map();
  const byRole = new Map(); // tokens/time grain — dollars are session-grain and stay in totals
  const sources = new Map();
  const nu = migrationOn('null-unobservable');
  // active-minutes (B2 item 7, spec 5.4, owner Q7): the parent role gets the session's full activeMin (no dispatch
  // minutes subtracted); dispatch minutes go to their own breakdown, byDispatchRole, never into byRole or a total.
  // A role only dispatches reach has activeMin null in byRole (not allocated at this grain, not unmeasured).
  const am = migrationOn('active-minutes');
  const byDispatchRole = new Map(); const parentRoles = new Set();
  const dispatchRoleBucket = (role) => {
    if (!byDispatchRole.has(role)) byDispatchRole.set(role, { units: 0, activeMin: 0, ...(nu ? { unmeasured: emptyUnmeasured() } : {}) });
    return byDispatchRole.get(role);
  };
  const roleBucket = (role) => {
    if (!byRole.has(role)) byRole.set(role, { units: 0, tokens: emptyTok(), activeMin: 0, toolCalls: 0, toolErrors: 0, ...(nu ? { unmeasured: emptyUnmeasured() } : {}) });
    return byRole.get(role);
  };
  for (const l of lines) {
    addLine(totals, l);
    for (const [map, key] of [[byPerson, l.user || 'unknown'], [byWeek, l.startedAt ? isoWeek(l.startedAt) : 'unknown'], [byHost, l.host]]) {
      if (!map.has(key)) map.set(key, bucket());
      addLine(map.get(key), l);
    }
    if (l.costSource && l.costSource !== 'none') sources.set(l.costSource, (sources.get(l.costSource) ?? 0) + 1);
    const parentRole = l.role || '(interactive session)';
    const pb = roleBucket(parentRole);
    if (am) parentRoles.add(parentRole);
    if (nu) {   // O1: unmeasured units are counted per quantity, never added as 0
      pb.units++; addMeasured(pb, 'tokens', l.tokens);
      addMeasured(pb, 'activeMin', l.activeMin == null || am ? l.activeMin : Math.max(0, l.activeMin - (l.subagents ?? []).reduce((n, s) => n + num(s.activeMin), 0)));
      addMeasured(pb, 'toolCalls', l.toolCalls); addMeasured(pb, 'toolErrors', l.toolErrors);
      for (const s of l.subagents ?? []) {
        const sb = roleBucket(s.role || 'unknown');
        sb.units += num(s.n) || 1;
        // an inclusive session's dispatch tokens are already in its parent total (B2-04): at dispatch grain they are
        // unmeasured, never summed and never a measured 0 — the batch-cost reader's rule (Plan 4 final review I1)
        addMeasured(sb, 'tokens', l.tokensBasis === 'inclusive' ? null : s.tokens);
        for (const k of [...(am ? [] : ['activeMin']), 'toolCalls', 'toolErrors']) addMeasured(sb, k, s[k]);
        if (am) { const db = dispatchRoleBucket(s.role || 'unknown'); db.units += num(s.n) || 1; addMeasured(db, 'activeMin', s.activeMin); }
      }
      continue;
    }
    pb.units++; addTok(pb.tokens, l.tokens);
    pb.activeMin += am ? num(l.activeMin) : Math.max(0, num(l.activeMin) - (l.subagents ?? []).reduce((n, s) => n + num(s.activeMin), 0));
    pb.toolCalls += num(l.toolCalls); pb.toolErrors += num(l.toolErrors);
    for (const s of l.subagents ?? []) {
      const sb = roleBucket(s.role || 'unknown');
      sb.units += num(s.n) || 1; if (l.tokensBasis !== 'inclusive') addTok(sb.tokens, s.tokens);
      if (am) { const db = dispatchRoleBucket(s.role || 'unknown'); db.units += num(s.n) || 1; db.activeMin += num(s.activeMin); } else sb.activeMin += num(s.activeMin);
      sb.toolCalls += num(s.toolCalls); sb.toolErrors += num(s.toolErrors);
    }
  }
  if (am) for (const [role, b] of byRole) if (!parentRoles.has(role)) b.activeMin = null;
  // Case ids mined from session names/branches/dispatch labels — which cases
  // each session TOUCHED (sessions per case, never dollars split per case: a
  // session covering five cases has one cost figure, not five).
  const byCase = new Map();
  for (const l of lines) {
    for (const c of l.cases ?? []) byCase.set(c, (byCase.get(c) ?? 0) + 1);
  }
  // Declared work scopes (work-scope.mjs) split spend by INTENT — the answer
  // to "how much of this window was automation work at all". Sessions without
  // a scope stay 'undeclared'; nothing is guessed.
  const byIntent = new Map();
  for (const l of lines) {
    const key = l.scope?.intent ?? 'undeclared';
    if (!byIntent.has(key)) byIntent.set(key, bucket());
    addLine(byIntent.get(key), l);
  }
  const ser = (m) => Object.fromEntries([...m.entries()]);
  // report-windows (spec 5.5 step 3, map D1): the numerator is the priced spend of sessions whose scope.intent is
  // a ratio intent of the manifest revision THEIR line was written under; a line naming a revision without an
  // archive is unverified (owner Q11b): reported beside the ratio, never in it.
  const rw = migrationOn('report-windows');
  const ratio = { eligible: 0, priced: 0, costUsd: 0 }; const unverified = { sessions: 0, costUsd: null, priced: 0 }; const findings = new Set(cases?.findings ?? []);
  if (rw) for (const l of lines) {
    const b = manifestFor(lineTelemetryDir(l), l);
    if (!b.verified) {
      unverified.sessions++; findings.add(b.finding);
      if (typeof l.costUsd === 'number') { unverified.costUsd = (unverified.costUsd ?? 0) + l.costUsd; unverified.priced++; }
      continue;
    }
    if (!b.ratioIntents.includes(l.scope?.intent)) continue;
    ratio.eligible++;
    if (typeof l.costUsd === 'number') { ratio.priced++; ratio.costUsd += l.costUsd; }
  }
  const countOut = (ls) => {
    const o = { sessions: ls.length, costUsd: null, priced: 0 };
    for (const l of ls) if (typeof l.costUsd === 'number') { o.costUsd = (o.costUsd ?? 0) + l.costUsd; o.priced++; }
    return o;
  };
  const undatedOut = countOut(undated);
  const conflictsOut = countOut(conflicts);
  const { findings: _receiptFindings, ...casesOut } = cases ?? {};   // merged into the report-level findings
  // The scoped-ratio spend: sessions that declared a ratio intent (settings.ratioIntents, B1 only).
  const ratioBuckets = rw ? [] : b1RatioIntents(settings).map((i) => byIntent.get(i)).filter(Boolean);
  const ratioPriced = ratioBuckets.reduce((n, b) => n + b.priced, 0);
  const ratioCostUsd = ratioBuckets.reduce((n, b) => n + b.costUsd, 0);
  return {
    ...(rw ? { semantics: SEMANTICS } : {}),
    sessions: lines.length,
    people: byPerson.size,
    totals,
    byCase: Object.fromEntries([...byCase.entries()].sort((a, z) => z[1] - a[1])),
    byIntent: ser(byIntent),
    costSources: ser(sources),
    tokensOnly: totals.sessions - totals.priced,
    byPerson: ser(byPerson), byRole: ser(byRole), ...(am ? { byDispatchRole: ser(byDispatchRole) } : {}), byWeek: ser(byWeek), byHost: ser(byHost),
    cases: rw && cases ? casesOut : cases,
    // Receipts aren't attributable to one role, so a role-filtered spend over
    // the full delivered count would be a wrong ratio — suppressed instead.
    // report-windows (spec 5.5 step 4): null when the denominator is 0 (perDelivered itself), when no eligible
    // session exists or none is priced; a measured $0 stays 0; partial pricing carries its priced/eligible coverage.
    perDelivered: rw ? (cases && cases.delivered > 0 && !cases.roleFiltered ? {
      costUsd: ratio.priced ? ratio.costUsd / cases.delivered : null,
      activeMin: totals.activeMin == null ? null : Math.round(totals.activeMin / cases.delivered),
      priced: ratio.priced, eligible: ratio.eligible,
      ...(ratio.priced && ratio.priced < ratio.eligible ? { partial: true } : {}),
    } : null) : cases && cases.delivered > 0 && !cases.roleFiltered ? {
      costUsd: totals.priced ? totals.costUsd / cases.delivered : null,
      activeMin: totals.activeMin == null ? null : Math.round(totals.activeMin / cases.delivered),
      // Scope records make the honest denominator possible: only sessions that
      // DECLARED automation intent, so docs/other work stops inflating $/case.
      ...(ratioPriced ? { automationOnlyCostUsd: ratioCostUsd / cases.delivered } : {}),
    } : null,
    ...(rw && unverified.sessions ? { unverified } : {}),
    ...(rw && undatedOut.sessions ? { undated: undatedOut } : {}),
    ...(conflictsOut.sessions ? { conflicts: conflictsOut, preview: { sessions: totals.sessions + conflictsOut.sessions,
      costUsd: totals.costUsd + (conflictsOut.costUsd ?? 0), priced: totals.priced + conflictsOut.priced } } : {}),
    ...(rw && findings.size ? { findings: [...findings].sort() } : {}),
    // The other denominator (efficiency-audit's pair): every case that entered
    // the pipeline consumed analysis, delivered or not — only this figure
    // admits what the non-delivered ones cost.
    perExamined: cases && cases.examined > 0 && !cases.roleFiltered ? {
      costUsd: totals.priced ? totals.costUsd / cases.examined : null,
    } : null,
    index: lines
      .map((l) => ({ host: l.host, id: l.id, user: l.user, role: l.role, startedAt: l.startedAt, costUsd: l.costUsd ?? null, cases: l.cases ?? [], ...(l.title ? { title: l.title } : {}) }))
      .sort((a, z) => String(a.startedAt).localeCompare(String(z.startedAt))),
  };
}

// --- Rendering ---------------------------------------------------------------
const usd = (n) => (typeof n === 'number' ? `$${n.toFixed(2)}` : 'n/a');
const hours = (min) => (min == null ? '—' : `${(min / 60).toFixed(1)}h`);   // null: no measured minutes (O1)
const cnt = (v) => (v == null ? '—' : v);
const loc = (v) => (v == null ? '—' : v.toLocaleString());
const U = unmeasuredNote;
// Dispatch minutes are short: shown in minutes, not hours ('—' beside the count when none was measured).
const dMins = (b) => `${b.activeMin == null ? '—' : `${Math.round(b.activeMin)}m`}${U(b, 'activeMin')}`;
// report-windows (review I2): sessions without endedAt, outside every window and every total, counted (O1).
const conflictsText = (rep) => `${rep.conflicts.sessions} session(s) in conflict (${usd(rep.conflicts.costUsd)}, ${rep.conflicts.priced} of ${rep.conflicts.sessions} priced): an exact (endedAt, capturedAt) tie with different payloads (spec 3.5) — not in these totals; preview total incl. the lowest-canonical-JSON pick: ${usd(rep.preview.costUsd)} over ${rep.preview.sessions} session(s)`;
// B2-05: a group whose receipt names a manifest revision without an archive (owner Q11b).
const unverifiedReceiptText = (c, w) => `Findings: ${c.findings.join('; ')} — this ${w.group}'s receipt is unverified: none of its ${w.items} counts as delivered`;
const receiptConflictsText = (cs, w) => `${cs.conflicts} ${w.item}(s) with conflicting receipts at an exact rank tie — excluded from these counts; preview: ${cs.preview.delivered} delivered of ${cs.preview.examined} examined${cs.preview.unwindowed ? `, ${cs.preview.unwindowed} unwindowed` : ''}`;
const batchConflictsText = (c) => `${c.sources.conflicts} session(s) in conflict: an exact (endedAt, capturedAt) tie with different payloads (spec 3.5) — not in these totals; preview total incl. the lowest-canonical-JSON pick: ${usd(c.preview?.costUsd)} over ${c.preview?.sessions} session(s)`;
// The unverified callout (ledger 146): today's words while every unverified line names a revision without an archive;
// a null-revision line (`manifest-revision-unknown`) has no revision to name, so the words cover both causes.
const unverifiedText = (rep) => `${rep.unverified.sessions} session(s) (${usd(rep.unverified.costUsd)}, ${rep.unverified.priced} of ${rep.unverified.sessions} priced) ${
  rep.findings?.includes('manifest-revision-unknown') ? 'have no verifiable manifest revision (archive missing or revision unknown)' : 'name a manifest revision without an archive'} — excluded from the per-delivered ratio`;
const undatedText = (u) => `${u.sessions} session(s) without endedAt (${usd(u.costUsd)}, ${u.priced} of ${u.sessions} priced) — outside every window, not in these totals`;
// role-dollars (B2 item 23, O3): the batch views read cost.json's byDispatchRole by its presence (O10).
const ROLE_DOLLARS_NOTE = "role cost = the parent session's role, inclusive of its dispatches; — (n unpriced) = n parent session(s) without dollars; — = not allocated at this grain: a dispatch-only role has no parent-session dollars (its dispatch dollars are the separate breakdown, never added to a role or the total)";
const DISPATCH_DOLLARS_NOTE = 'measured per-dispatch dollars by dispatch role — already inside the parent role and the total, so never added to them';
const dispatchUsd = (d) => (typeof d.costUsd === 'number' ? usd(d.costUsd) : `— (${Math.round((d.units - d.priced) * 100) / 100} unpriced)`);
// A byRole cost cell when the bucket carries role-dollars' {priced, unpriced} session counts (review round 1, I2):
// a dispatch-only role (0/0) is not allocated at this grain, an unpriced parent says how many; null = no counts.
const roleUsd = (b) => (typeof b.priced !== 'number' ? null
  : !b.priced && !b.unpriced ? '—'
    : typeof b.costUsd === 'number' ? `${usd(b.costUsd)}${b.unpriced ? ` (${b.unpriced} unpriced)` : ''}` : `— (${b.unpriced} unpriced)`);
const dispatchTableMd = (c) => {
  const dRoles = Object.entries(c.byDispatchRole ?? {});
  if (!dRoles.length) return [];
  return ['', '## Dispatch dollars by role', '', `_${DISPATCH_DOLLARS_NOTE}_`, '', '| role | cost | dispatches | priced |', '|---|---|---|---|',
    ...dRoles.map(([r, d]) => `| ${r} | ${dispatchUsd(d)} | ${d.units} | ${d.priced} of ${d.units} |`)];
};
const dispatchPanelHtml = (c) => (Object.keys(c.byDispatchRole ?? {}).length ? `
  <section class="panel"><h2>Dispatch dollars by role</h2><p class="panel-sub">${escHtml(DISPATCH_DOLLARS_NOTE)}</p>${Object.entries(c.byDispatchRole).map(([r, d]) => `
    <div class="row"><div class="lbl">${escHtml(r)}</div><div class="num">${escHtml(dispatchUsd(d))}<span class="sub"> · ${d.units} disp · ${d.priced} of ${d.units} priced</span></div></div>`).join('')}</section>` : '');
const NOT_ALLOCATED_NOTE = '— = not allocated at this grain: a dispatch-only role has no parent-session minutes (its dispatch minutes are in the next table).';
const DISPATCH_MIN_NOTE = 'Measured per dispatch. Dispatches overlap their parent session and each other, so these minutes are not part of any total; the by-role table gives each parent role its full session minutes (spec 5.4).';
const tokStr = (t) => (t == null ? '—' : `in ${t.input.toLocaleString()}, out ${t.output.toLocaleString()}, cache-read ${t.cacheRead.toLocaleString()}, cache-write ${t.cacheWrite.toLocaleString()}`);

/**
 * report-revision (spec 14.4, map O6): the provenance footer. Readers decide by the field, never by the migration
 * (O10): a report without `manifestRevision` renders no footer; `null` (an unusable module.json) reads "unknown", never
 * a number; `manifestRevisions` (a period report over directories that differ) lists every directory.
 */
export function revisionFooter({ manifestRevision, manifestRevisions } = {}) {
  if (Array.isArray(manifestRevisions)) return `manifest revisions: ${manifestRevisions.map((r) => `${r.dir}=${r.manifestRevision ?? 'unknown'}`).join('; ')}`;
  if (manifestRevision === undefined) return null;
  return `manifest revision ${Number.isInteger(manifestRevision) ? manifestRevision : 'unknown'}`;
}
const withMdFooter = (body, prov) => { const f = revisionFooter(prov); return f ? `${body}\n\n${f}` : body; };
const withHtmlFooter = (body, prov) => { const f = revisionFooter(prov); return f ? `${body}\n  <p class="meta">${escHtml(f)}</p>` : body; };

export function renderMarkdown(rep, opts = {}, settings = TA_DEFAULTS, ext = null) {
  return withMdFooter(renderMarkdownBody(rep, opts, settings, ext), opts);
}
function renderMarkdownBody(rep, { window, label } = {}, settings = TA_DEFAULTS, ext = null) {
  const w = words(settings);
  const t = rep.totals;
  const out = [`# Tokenomics — team usage report${label ? ` — ${label}` : ''}`, '',
    `Generated: ${new Date().toISOString()}${window ? `  ·  window: ${window}` : ''}`, ''];
  if (rep.semantics) out.push(`_${rep.semantics}_`, '');   // report-windows: stated in every report (spec 5.5)
  out.push('## Totals', '');
  out.push(`- Sessions: ${rep.sessions} (${Object.entries(rep.byHost).map(([h, b]) => `${h} ${b.sessions}`).join(', ')})  ·  people: ${rep.people}`);
  const src = Object.entries(rep.costSources).map(([s, n]) => `${s} ×${n}`).join(', ');
  out.push(`- Cost (real figures only): ${usd(t.priced ? t.costUsd : null)} from ${t.priced} priced session(s)${src ? ` (${src})` : ''}${rep.tokensOnly ? `  ·  ⚠️ ${rep.tokensOnly} session(s) tokens-only (no real dollar — never estimated)` : ''}`);
  out.push(`- Tokens (incl. sub-agents): total ${t.tokens == null ? '—' : quadTotal(t.tokens).toLocaleString()}${U(t, 'tokens')}  ·  ${tokStr(t.tokens)}`);
  out.push(`- Real work: ${t.tokens == null ? '—' : ((t.tokens.input + t.tokens.output)).toLocaleString()} tokens (in+out)  ·  cache hit rate: ${(() => { if (t.tokens == null) return 'n/a'; const d = t.tokens.cacheRead + t.tokens.cacheWrite + t.tokens.input; return d ? `${((t.tokens.cacheRead / d) * 100).toFixed(1)}%` : 'n/a'; })()}`);
  out.push(`- Time: ${hours(t.activeMin)}${U(t, 'activeMin')} active  ·  ${hours(t.wallMin)}${U(t, 'wallMin')} wall  ·  ${cnt(t.turns)}${U(t, 'turns')} turns  ·  ${cnt(t.toolCalls)}${U(t, 'toolCalls')} tool calls (${cnt(t.toolErrors)} err${U(t, 'toolErrors')})`);
  if (rep.unverified) out.push(`- ⚠️ Unverified: ${unverifiedText(rep)}, kept in these totals`);
  if (rep.undated) out.push(`- ⚠️ Undated: ${undatedText(rep.undated)}`);
  if (rep.conflicts) out.push(`- ⚠️ Conflicts: ${conflictsText(rep)}`);
  if (rep.cases?.conflicts) out.push(`- ⚠️ Receipt conflicts: ${receiptConflictsText(rep.cases, w)}`);
  if (rep.findings) out.push(`- Findings: ${rep.findings.join('; ')}`);
  const caseIds = Object.keys(rep.byCase ?? {});
  if (caseIds.length) {
    out.push(`- ${w.Item} ids named in sessions: ${caseIds.length} distinct (sessions-per-${w.item} in the --json \`byCase\`; top: ${caseIds.slice(0, 5).join(', ')})`);
  }
  const intents = Object.entries(rep.byIntent ?? {});
  if (intents.some(([k]) => k !== 'undeclared')) {
    out.push(`- By declared intent: ${intents.map(([k, b]) => `${k} ${usd(b.priced ? b.costUsd : null)} (${b.sessions})`).join('  ·  ')}`);
  }
  out.push('');
  if (rep.cases && rep.cases.reports) {
    out.push(`## ${w.Items} (from the pipeline's own receipts)`, '');
    const parts = Object.entries(rep.cases.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('  ·  ');
    if (rep.semantics) {   // report-windows: the spec 5.5 denominator and ratio
      out.push(`- Examined: ${rep.cases.examined} unique ${w.item}(s) across ${rep.cases.reports} report(s)  ·  **${settings.vocabulary.delivered} in the window: ${rep.cases.delivered}**${rep.cases.unwindowed ? `  ·  ${rep.cases.unwindowed} delivered without \`at\` (unwindowed, excluded)` : ''}`);
      if (parts) out.push(`- Outcomes (current state): ${parts}`);
      const pd = rep.perDelivered;
      if (pd) {
        out.push(`- Per delivered ${w.item}: **${usd(pd.costUsd)}**${pd.partial ? ` (partial: ${pd.priced} of ${pd.eligible} eligible session(s) priced)` : ''}  ·  ${pd.eligible} ratio-intent session(s), ${pd.priced} priced  ·  ${cnt(pd.activeMin)} active min (all sessions)${rep.perExamined ? `  ·  per ${w.item} examined: ${usd(rep.perExamined.costUsd)}` : ''}`);
        out.push(`  (ratio-intent spend of the sessions that ended in the window ÷ delivered ${w.items} dated in the window; each line's ratio intents come from the manifest revision it was written under)`);
      }
    } else {
      out.push(`- Examined: ${rep.cases.examined} unique ${w.item}(s) across ${rep.cases.reports} report(s)  ·  **${settings.vocabulary.delivered}: ${rep.cases.delivered}**`);
      if (parts) out.push(`- Outcomes: ${parts}`);
      if (rep.perDelivered) {
        out.push(`- Per delivered ${w.item}: ${usd(rep.perDelivered.costUsd)}  ·  ${cnt(rep.perDelivered.activeMin)} active min${rep.perDelivered.automationOnlyCostUsd != null ? `  ·  **${b1RatioIntents(settings).join('/')}-intent spend only: ${usd(rep.perDelivered.automationOnlyCostUsd)}**` : ''}${rep.perExamined ? `  ·  per ${w.item} examined: ${usd(rep.perExamined.costUsd)}` : ''}`);
        out.push(`  (spend in the window ÷ delivered ${w.items} in the receipts — align the window to the ${w.group} for a per-${w.group} figure)`);
      }
    }
    out.push('');
  }
  if (rep.byBatch?.length) {
    out.push(`## By ${w.group}`, '');
    const enr = (part, input) => hook(ext, 'enrichGroup', input, { settings, phase: 'render-md', part });
    const head = [w.group, w.items, 'delivered', 'total', 'per delivered', 'active', ...(enr('by-group-head', rep) ?? [])];
    out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---|').join('')}`);
    for (const b of rep.byBatch) {
      const cells = [b.batch, b.cases, b.delivered, usd(b.costUsd), usd(b.perDelivered), `${hours(b.activeMin)}${U(b, 'activeMin')}`, ...(enr('by-group-cells', b) ?? [])];
      out.push(`| ${cells.join(' | ')} |`);
    }
    out.push('');
  }
  if (rep.perCase?.length) {
    const s4 = (st, f) => (st ? `avg ${f(st.avg)} · median ${f(st.median)} · min ${f(st.min)} · max ${f(st.max)} (n=${st.n})` : 'n/a');
    out.push(`## Per ${w.item} — every ${w.group}'s cost.json rows (delivered first)`, '');
    if (rep.perCaseStats?.loadedCostUsd || rep.perCaseStats?.loadedActiveMin) {
      out.push(`- Delivered-${w.item} loaded cost: ${s4(rep.perCaseStats.loadedCostUsd, (x) => usd(x))}`);
      out.push(`- Delivered-${w.item} loaded time: ${s4(rep.perCaseStats.loadedActiveMin, (x) => `${Math.round(x)}m`)}`);
      out.push(`  (loaded = direct measured work + an even share of the ${w.group} overhead — an allocation, labelled as such)`, '');
    }
    out.push(`| ${w.item} | ${w.group} | outcome | direct | loaded | active (loaded) |`, '|---|---|---|---|---|---|');
    for (const r of rep.perCase) {
      out.push(`| ${r.id} | ${r.batch} | ${r.outcome ?? '—'} | ${usd(r.direct.costUsd)} | ${usd(r.loaded?.costUsd)} | ${loadedMins(r.loaded)} |`);
    }
    out.push('');
  }
  const table = (title, entries, unitHeader = 'sessions') => {
    out.push(`## ${title}`, '', `| ${title.toLowerCase().replace('by ', '')} | cost | ${unitHeader} | tokens (in/out) | active | tools (err) |`, '|---|---|---|---|---|---|');
    for (const [k, b] of entries) {
      const units = b.sessions ?? b.units;
      out.push(`| ${k} | ${b.priced ? usd(b.costUsd) : (b.sessions === undefined ? '(session-grain)' : 'n/a')} | ${units} | ${b.tokens == null ? '—' : `${b.tokens.input.toLocaleString()}/${b.tokens.output.toLocaleString()}`}${U(b, 'tokens')} | ${hours(b.activeMin)}${U(b, 'activeMin')} | ${cnt(b.toolCalls)}${U(b, 'toolCalls')} (${cnt(b.toolErrors)}${U(b, 'toolErrors')}) |`);
    }
    out.push('');
  };
  table('By person', Object.entries(rep.byPerson).sort((a, z) => (z[1].costUsd || 0) - (a[1].costUsd || 0)));
  table('By role', Object.entries(rep.byRole).sort((a, z) => num(z[1].tokens?.output) - num(a[1].tokens?.output)), 'units');
  if (rep.byDispatchRole) out.push(`_${NOT_ALLOCATED_NOTE}_`, '');
  const dRoles = Object.entries(rep.byDispatchRole ?? {});
  if (dRoles.length) {   // active-minutes (Q7): dispatch minutes as their own breakdown
    out.push('## Dispatch minutes by role', '', `_${DISPATCH_MIN_NOTE}_`, '', '| role | dispatches | active |', '|---|---|---|');
    for (const [k, b] of dRoles.sort(([a], [z]) => a.localeCompare(z))) out.push(`| ${k} | ${b.units} | ${dMins(b)} |`);
    out.push('');
  }
  table('By week', Object.entries(rep.byWeek).sort(([a], [z]) => a.localeCompare(z)));
  out.push('_Dollars are session-grain (one figure per session, real sources only), so the role table reports tokens/time — sub-agent roles included. Fork/resume caveat: a forked session replays its parent\'s records; its ledger line can double-count the replayed tokens._');
  return out.join('\n');
}

// --- CLI ---------------------------------------------------------------------
// --- Batch mode (--batch <slug> | --batches) ---------------------------------
// Renders the per-batch cost view: what the batch delivered, what it cost, per
// case (direct, measured) and at batch level (overhead, once). The numbers come
// from batch-cost.mjs — the same recompute the capture hook runs, built fresh
// here so the report never trails the ledger.
// --- Token-economics helpers -------------------------------------------------
// The scalar token sum buries the story: ~95% of it is cache-read at ~1/10
// input price (field: a $16 batch showing "47.5M tokens"). Real work =
// input+output. Cache hit rate = cacheRead / (input + cacheWrite + cacheRead):
// the share of ALL prompt tokens replayed from cache versus processed fresh —
// cache WRITE is fresh processing (at 1.25× input price), so it belongs in
// the denominator. The naive cacheRead/(cacheRead+input) degenerates to ~100%
// on Claude Code (uncached input per request is a few tokens; measured: 775
// input across 18 turns) and discriminates nothing.
export const realWork = (t) => (t ? num(t.input) + num(t.output) : null);
export const cacheHitRate = (t) => {
  const denom = num(t?.cacheRead) + num(t?.cacheWrite) + num(t?.input);
  return denom ? num(t.cacheRead) / denom : null;
};
// What the cache BOUGHT: prompt cost without it (every token at 1× input
// price) vs as billed (input 1× + write 1.25× + read 0.1×). Complements the
// hit rate — "how often" vs "how much money it saved".
export const cacheSavings = (t) => {
  const would = num(t?.input) + num(t?.cacheWrite) + num(t?.cacheRead);
  if (!would) return null;
  const paid = num(t?.input) + num(t?.cacheWrite) * 1.25 + num(t?.cacheRead) * 0.1;
  return 1 - paid / would;
};
// Cost-weighted cache-read share at public list ratios — the spec's
// cache_read_share_pct semantics (a COST share, not the token share).
export const costShareOfCacheRead = (t) => {
  if (!t) return null;
  const total = num(t.input) + num(t.output) * 5 + num(t.cacheWrite) * 1.25 + num(t.cacheRead) * 0.1;
  return total ? Math.round(((num(t.cacheRead) * 0.1) / total) * 1000) / 10 : null;
};
// zero-session-share (item 19): 0/0 is not a share; with the migration on it renders "—", never NaN%.
const pct = (x) => (x == null ? 'n/a' : (!Number.isFinite(x) && migrationOn('report-robustness')) ? '—' : `${(x * 100).toFixed(1)}%`);
const kTok = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(Math.round(n)));
// A cost.json bucket's minutes / tool counts with the O1 note: '—' when nothing was measured.
// active-minutes: a null with no count is "not allocated at this grain" and reads '—' too.
const minsOf = (b) => `${b?.activeMin === null || (b?.activeMin == null && b?.unmeasured) ? '—' : `${b?.activeMin}m`}${U(b, 'activeMin')}`;
const toolsOf = (b) => `${b.toolCalls ?? '—'}${U(b, 'toolCalls')} (${b.toolErrors ?? (b.unmeasured ? '—' : 0)}${U(b, 'toolErrors')})`;
// The loaded (direct + overhead share) minutes of a case row; with the migration the row carries counts.
const loadedMins = (l) => (l?.unmeasured || l?.activeMin === null ? minsOf(l) : `${l?.activeMin ?? '—'}m`);
// "(items Nm · lead Nm · stages Nm)": with the migration a sum nothing measured reads '—' beside its count (O1).
const minBreakdown = (c, w) => {
  // active-minutes: the minutes sit at session grain; there is no per-item / stage split to show.
  if (c.sources?.activeMinGrain === 'session') return `session grain — not split per ${w.item}, stage or dispatch`;
  if (!c.totals.unmeasured) return `${w.items} ${c.cases.reduce((n, x) => n + num(x.direct.activeMin), 0)}m · lead ${num(c.overhead?.lead?.activeMin)}m · stages ${num(c.overhead?.stages?.activeMin)}m`;
  const ds = c.cases.map((x) => x.direct);
  const items = { activeMin: ds.some((d) => d.activeMin != null) || !ds.some((d) => d.unmeasured?.activeMin) ? ds.reduce((n, d) => n + num(d.activeMin), 0) : null,
    unmeasured: { activeMin: ds.reduce((n, d) => n + num(d.unmeasured?.activeMin), 0) } };
  // num() as in the reference for a measured sum (a non-finite overflow still reads 0m); '—' only for an unknown
  const part = (b) => `${b?.activeMin == null && b?.unmeasured?.activeMin ? '—' : `${num(b?.activeMin)}m`}${U(b, 'activeMin')}`;
  return `${w.items} ${part(items)} · lead ${part(c.overhead?.lead)} · stages ${part(c.overhead?.stages)}`;
};
const okPctOf = (t) => (t.toolCalls && t.toolErrors != null ? `${Math.round((1 - t.toolErrors / t.toolCalls) * 100)}% ok` : '');
const rwCell = (tokQuad, scalarFallback) =>
  tokQuad == null && scalarFallback == null ? '—' :
  tokQuad && (tokQuad.input || tokQuad.output || tokQuad.cacheRead)
    ? `${realWork(tokQuad).toLocaleString()} (in ${kTok(tokQuad.input)} / out ${kTok(tokQuad.output)})`
    : `${(scalarFallback ?? 0).toLocaleString()} (incl. cache)`;

export function renderBatchMarkdown(c, settings = TA_DEFAULTS, ext = null) {
  return withMdFooter(renderBatchMarkdownBody(c, settings, ext), c);
}
function renderBatchMarkdownBody(c, settings = TA_DEFAULTS, ext = null) {
  const w = words(settings);
  const cls = (part, input = c) => hook(ext, 'classifyDispatch', input, { settings, phase: 'render-md', part, usd });
  const enr = (part, input = c) => hook(ext, 'enrichGroup', input, { settings, phase: 'render-md', part, cost: c });
  const out = [`# ${w.Group} cost — ${c.batch}`, '',
    `Generated: ${c.generatedAt}  ·  sessions: ${c.sources.sessions} (${c.sources.hosts.join(', ') || 'none'})  ·  sources: ${c.sources.costSources.join(', ') || 'tokens only'}  ·  models: ${c.sources.models.join(', ') || '—'}`, ''];
  if (c.sources.liveSessions) out.push(`> ⏳ **LIVE / PROVISIONAL** — ${c.sources.liveSessions} session(s) still running. Finished dispatches are counted; their lead thread is not measured yet, so these totals are a **floor**. Re-run after the session ends.`, '');
  if (c.sources.conflicts) out.push(`> ⚠️ ${batchConflictsText(c)}.`, '');
  if (c.findings) out.push(`> ⚠️ ${unverifiedReceiptText(c, w)}.`, '');
  if (c.sources.sharedSessions) out.push(`_${c.sources.sharedSessions} session(s) also served other ${w.groups} — their session-level figures are split evenly${c.sources.foreignDispatchesExcluded ? `; ${c.sources.foreignDispatchesExcluded} other-${w.group} dispatch(es) excluded` : ''}._`, '');
  const oc = Object.entries(c.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('  ·  ');
  out.push('## What happened', '');
  out.push(`- ${w.Items}: ${c.cases.length}  ·  **delivered: ${c.delivered}**${oc ? `  ·  ${oc}` : ''}`);
  out.push(...(enr('what-lines') ?? []));
  const what = [enr('what'), cls('what')].filter(Boolean);
  if (what.length) out.push(`- ${what.join('  ·  ')}`);
  out.push('');
  out.push('## What it cost', '');
  const ts = c.totals.tokensSplit;
  out.push(`- Total: ${usd(c.totals.costUsd)}  ·  ${hours(c.totals.activeMin)}${U(c.totals, 'activeMin')} active (${minBreakdown(c, w)})  ·  ${c.totals.dispatches} dispatches`);
  if (ts) {
    if (c.totals.tokensAttribution) out.push(`- ⚠️ **TOKEN TOTALS ARE A FLOOR** — attribution ${c.totals.tokensAttribution}: ${c.totals.unattributedUnits} unit(s) reported no usage (gateway pass-through gap); the real bill is higher.`);
    out.push(`- Tokens: total ${c.totals.tokens.toLocaleString()}  ·  **real work ${realWork(ts).toLocaleString()}** (in ${ts.input.toLocaleString()} / out ${ts.output.toLocaleString()})  ·  cache ${kTok(ts.cacheRead)} read / ${kTok(ts.cacheWrite)} write  ·  **cache hit rate ${pct(cacheHitRate(ts))}**  ·  see batch-tokenomics for the full breakdown`);
  } else if (c.totals.tokens == null && c.totals.unmeasured) {
    out.push(`- Tokens: —${U(c.totals, 'tokens')}`);
  } else {
    out.push(`- Tokens: ${c.totals.tokens.toLocaleString()} (incl. cache — re-run close for the split)`);
  }
  if (c.totals.toolCalls != null || c.totals.unmeasured) out.push(`- Activity: ${c.totals.turns ?? '—'}${U(c.totals, 'turns')} turns  ·  ${c.totals.toolCalls ?? '—'}${U(c.totals, 'toolCalls')} tool calls (${c.totals.toolErrors ?? '—'} err${U(c.totals, 'toolErrors')}${okPctOf(c.totals) ? `, ${okPctOf(c.totals)}` : ''})${c.totals.skills?.length ? `  ·  skills: ${c.totals.skills.join(', ')}` : ''}`);
  const stageNames = hook(ext, 'classifyDispatch', null, { settings, phase: 'stage-names' }) ?? [];
  out.push(`- Overhead (lead${stageNames.map((n) => ` + ${n}`).join('')}, shown once): ${usd(c.overhead.costUsd)}${c.overhead.sharePct != null ? ` (${c.overhead.sharePct}%)` : ''}`);
  out.push(...(cls('cost') ?? []));
  if (c.averages.totalPerDelivered) out.push(`- **Per delivered ${w.item} (incl. overhead): ${usd(c.averages.totalPerDelivered.costUsd)}**`);
  if (c.averages.directPerCase) out.push(`- Avg direct per ${w.item} (excl. overhead): ${usd(c.averages.directPerCase.costUsd)}`);
  const s = c.stats;
  const line4 = (st, f = (x) => x) => st ? `avg ${f(st.avg)} · median ${f(st.median)} · min ${f(st.min)} · max ${f(st.max)}` : null;
  if (s.directCostUsd) out.push(`- Direct cost spread: ${line4(s.directCostUsd, (x) => usd(x))}`);
  if (s.loadedCostUsd) out.push(`- Loaded cost spread (direct + even overhead share): ${line4(s.loadedCostUsd, (x) => usd(x))}`);
  if (s.directActiveMin) out.push(`- Active-time spread: ${line4(s.directActiveMin, (x) => `${x}m`)}${s.loadedActiveMin ? `  ·  loaded: ${line4(s.loadedActiveMin, (x) => `${x}m`)}` : ''}`);
  else if (s.loadedActiveMin && c.sources.activeMinGrain === 'session') out.push(`- Active-time spread: session grain, none per ${w.item}  ·  loaded: ${line4(s.loadedActiveMin, (x) => `${x}m`)} (${w.group} time ÷ ${w.items}, an allocation)`);
  if (!s.directCostUsd && s.directTokens) out.push(`- Direct token spread (no per-dispatch dollars on this host): ${line4(s.directTokens, (x) => x.toLocaleString())}`);
  out.push('', `## Per ${w.item} (direct = measured; loaded = direct + even overhead share, an allocation${c.sources.activeMinGrain === 'session' ? `; loaded minutes = ${w.group} time ÷ ${w.items}` : ''})`, '');
  const head = [w.item, ...(enr('case-lead') ?? []), 'outcome', 'direct cost', 'loaded', 'real-work tok', 'active', 'loaded act.', 'dispatches', 'tools (err)', ...(cls('case-head') ?? []), ...(enr('case-tail') ?? [])];
  out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---|').join('')}`);
  for (const x of c.cases) {
    const cells = [x.id, ...(enr('case-lead-cells', x) ?? []), x.outcome ?? '—', usd(x.direct.costUsd), usd(x.loaded?.costUsd), `${rwCell(x.direct.tok, x.direct.tokens)}${U(x.direct, 'tokens')}`, minsOf(x.direct), loadedMins(x.loaded), x.direct.dispatches, toolsOf(x.direct), ...(cls('case-cells', x) ?? []), ...(enr('case-tail-cells', x) ?? [])];
    out.push(`| ${cells.join(' | ')} |`);
  }
  out.push('', `_${w.Items} analysed/built as one cluster share its measured dispatches — their rows are an even split, not per-${w.item} measurement (fractional \`dispatches\` marks them)._`);
  out.push(...(enr('sections') ?? []));
  const roles = Object.entries(c.byRole ?? {});
  if (roles.length) {
    out.push('', '## By role', '');
    out.push('| role | cost | dispatches | real-work tok | cache hit | active | tools (err) |', '|---|---|---|---|---|---|---|');
    for (const [r, b] of roles.sort((a, z) => (z[1].costUsd ?? 0) - (a[1].costUsd ?? 0))) {
      out.push(`| ${r} | ${roleUsd(b) ?? usd(b.costUsd)} | ${b.dispatches} | ${rwCell(b.tok, b.tokens)}${U(b, 'tokens')} | ${b.tok ? pct(cacheHitRate(b.tok)) : '—'} | ${minsOf(b)} | ${toolsOf(b)} |`);
    }
    if (c.byDispatchRole) out.push('', `_${ROLE_DOLLARS_NOTE}_`);
  }
  out.push(...dispatchTableMd(c));
  if (c.coverage.casesUnattributed.length) {
    out.push('', `Unattributed (no dispatch named them in any captured session): ${c.coverage.casesUnattributed.join(', ')}`);
  }
  return out.join('\n');
}

// ---- shared page chrome — ported from manual-qa's tokenomics page ----------
// Same design system (kpi cards / panels / stacked bars / legends, the same
// light-dark palette) so the two factories' reports read as one family.
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const PAGE_CSS = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;--gridline:#e1e0d9;--border:rgba(11,11,11,0.10);--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--warn:#c53030;--ok:#2f855a}
html[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--text-primary:#fff;--text-secondary:#c3c2b7;--text-muted:#898781;--gridline:#2c2c2a;--border:rgba(255,255,255,0.10);--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--warn:#e06c6c;--ok:#48a06f}
*{box-sizing:border-box}
body{font:14px/1.5 -apple-system,"Segoe UI",sans-serif;color:var(--text-primary);background:var(--page);max-width:1120px;margin:0 auto;padding:1.8rem 1.2rem 3rem}
h1{font-size:1.35rem;margin:0 0 .2rem}
.meta{color:var(--text-muted);font-size:.85rem;margin:0 0 1.1rem}
section{margin-top:1.1rem}
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:.8rem}
.kpi-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;min-width:0}
.kpi-card h3{margin:0 0 .55rem;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
.kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem .7rem}
.stat{display:flex;flex-direction:column;min-width:0}
.stat-label{font-size:.74rem;color:var(--text-secondary)}
.stat-sub{color:var(--text-muted);font-weight:400}
.stat-value{font-size:1.02rem;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.3;overflow-wrap:anywhere}
.stat-value-sm{font-size:.84rem;font-weight:500}
.kpi-callout{margin-top:.65rem;padding:.45rem .6rem;background:var(--page);border:1px solid var(--gridline);border-radius:7px;font-size:.81rem;color:var(--text-secondary)}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;overflow-x:auto;min-width:0}
.panel h2{margin:0;font-size:1rem}
.panel-sub{margin:.15rem 0 .75rem;color:var(--text-muted);font-size:.84rem}
.stacked-bar{display:flex;height:18px;border-radius:5px;overflow:hidden;background:var(--gridline)}
.bar-seg{height:100%}
.s-in{background:var(--series-1)}.s-out{background:var(--series-2)}.s-cr{background:var(--series-3)}.s-cw{background:var(--series-4)}
.legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.35rem 1rem;margin-top:.6rem}
.legend-item{display:flex;align-items:center;gap:.4rem;font-size:.82rem;min-width:0;flex-wrap:wrap}
.legend-swatch{width:10px;height:10px;border-radius:3px;flex:none}
.legend-label{color:var(--text-secondary)}
.legend-value{margin-left:auto;font-variant-numeric:tabular-nums}
.legend-pct{color:var(--text-muted)}
.row{display:grid;grid-template-columns:minmax(130px,210px) minmax(140px,1fr) minmax(200px,240px);gap:.7rem;align-items:center;margin:.32rem 0}
.row .lbl{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .track{background:var(--gridline);border-radius:4px;height:15px}
.row .bar{background:var(--series-1);height:15px;border-radius:4px}
.row .stacked{display:flex;overflow:hidden;height:15px;border-radius:4px}
.row .num{font-size:.84rem;font-variant-numeric:tabular-nums}
.sub{color:var(--text-muted)}
.oc{font-size:.72rem;border:1px solid var(--gridline);border-radius:8px;padding:0 .4rem;margin-left:.35rem;color:var(--text-muted);display:inline-block}
.oc-automated{color:var(--ok);border-color:var(--ok)}.oc-blocked{color:var(--warn);border-color:var(--warn)}
.callout-warn{margin-top:.8rem;color:var(--warn);border:1px solid var(--warn);border-radius:7px;padding:.5rem .7rem;font-size:.86rem;background:var(--surface)}
.note{color:var(--text-muted);font-size:.84rem}
table{border-collapse:collapse;width:100%;font-size:.87rem;margin:.4rem 0}
th{text-align:left;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--gridline);padding:.3rem .5rem;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
td{border-bottom:1px solid var(--gridline);padding:.3rem .5rem;font-variant-numeric:tabular-nums}
.chip{font-size:.8rem;border:1px solid var(--gridline);border-radius:8px;padding:.1rem .5rem;margin-right:.4rem;color:var(--text-secondary);display:inline-block}
.share-cell{display:flex;align-items:center;gap:.45rem;min-width:140px}
.share-bar-track{flex:1;height:8px;border-radius:4px;background:var(--gridline);overflow:hidden}
.share-bar-fill{height:8px;border-radius:4px;background:var(--series-1)}
.share-bar-label{font-size:.8rem;color:var(--text-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
@media(max-width:640px){.row{grid-template-columns:110px 1fr}.row .num{grid-column:1/-1}}
`;
const statCell = (label, value, small) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value${small ? ' stat-value-sm' : ''}">${value}</span></div>`;
const kpiCard = (title, cells, callout) => `<div class="kpi-card"><h3>${title}</h3><div class="kpi-grid">${cells.join('')}</div>${callout ? `<div class="kpi-callout">${callout}</div>` : ''}</div>`;
// One quad, four segments + a count-and-share legend (the manual-qa pattern:
// a share bar you can read without hovering).
const QUAD_SERIES = [
  ['input', 's-in', 'input · 1×'],
  ['output', 's-out', 'output'],
  ['cacheWrite', 's-cw', 'cache write · 1.25×'],
  ['cacheRead', 's-cr', 'cache read · 0.1×'],
];
const quadTotal = (tok) => num(tok?.input) + num(tok?.output) + num(tok?.cacheRead) + num(tok?.cacheWrite);
const quadBar = (tok) => {
  const total = quadTotal(tok);
  if (!total) return '<div class="stacked-bar"></div>';
  return `<div class="stacked-bar">${QUAD_SERIES.map(([k, cls, label]) =>
    num(tok[k]) > 0 ? `<div class="bar-seg ${cls}" style="flex:${Math.max((num(tok[k]) / total) * 100, 0.4)} 0 0" title="${label}: ${fmtInt(tok[k])} (${pct(num(tok[k]) / total)})"></div>` : '').join('')}</div>`;
};
const quadLegend = (tok) => {
  const total = quadTotal(tok) || 1;
  return `<div class="legend">${QUAD_SERIES.map(([k, cls, label]) => `<div class="legend-item"><span class="legend-swatch ${cls}"></span><span class="legend-label">${label}</span><span class="legend-value">${fmtInt(tok?.[k])} <span class="legend-pct">(${pct(num(tok?.[k]) / total)})</span></span></div>`).join('')}</div>`;
};

// Self-contained batch DELIVERY page — no external assets, light/dark aware.
// KPI cards up top (delivery / cost / tokens / activity — every headline number
// incl. the raw token total), then per-case bars with overhead drawn once.
export function renderBatchHtml(c, settings = TA_DEFAULTS, ext = null) {
  return withHtmlFooter(renderBatchHtmlBody(c, settings, ext), c);
}
function renderBatchHtmlBody(c, settings = TA_DEFAULTS, ext = null) {
  const w = words(settings);
  const esc = escHtml;
  const cls = (part, input = c) => hook(ext, 'classifyDispatch', input, { settings, phase: 'render-html', part, usd, statCell, esc, fmtInt });
  const enr = (part, input = c) => hook(ext, 'enrichGroup', input, { settings, phase: 'render-html', part, cost: c, statCell, esc, fmtInt });
  const priced = !!c.stats.directCostUsd;
  const val = (x) => (priced ? (x.direct.costUsd ?? 0) : num(x.direct.tokens));
  const fmtV = (v, x) => (priced ? `$${v.toFixed(2)}` : (x?.direct.tokens == null && x?.direct.unmeasured ? `—${U(x.direct, 'tokens')}` : `${(v / 1000).toFixed(0)}k tok`));
  const max = Math.max(1, ...c.cases.map(val));
  const bars = c.cases.map((x) => { const fix = cls('case', x); return `
    <div class="row"><div class="lbl" title="${esc(x.outcome)}">${esc(x.id)}<span class="oc oc-${esc(x.outcome)}">${esc(x.outcome ?? '')}</span></div>
    <div class="track"><div class="bar" style="width:${Math.max(1, (val(x) / max) * 100)}%"></div></div>
    <div class="num">${fmtV(val(x), x)}<span class="sub"> · ${enr('case-pre', x) ?? ''}${x.loaded?.costUsd != null ? `loaded $${x.loaded.costUsd.toFixed(2)} · ` : ''}${minsOf(x.direct)}${x.loaded?.unmeasured ? ` (loaded ${minsOf(x.loaded)})` : (x.loaded?.activeMin != null ? ` (loaded ${x.loaded.activeMin}m)` : '')}${fix ? ` · ${fix}` : ''}${enr('case-post', x) ?? ''}</span></div></div>`; }).join('');
  const st = (s, f) => (s ? `avg ${f(s.avg)} · median ${f(s.median)} · min ${f(s.min)} · max ${f(s.max)}` : 'n/a');
  const oc = Object.entries(c.outcomes).map(([k, n]) => `<span class="oc oc-${esc(k)}">${esc(k)} ${n}</span>`).join(' ');
  const ts = c.totals.tokensSplit;
  const okPct = okPctOf(c.totals);
  const cards = [
    kpiCard('Delivery', [
      statCell(`Delivered / ${w.items}`, `${c.delivered}/${c.cases.length}`),
      ...(enr('delivery-lead') ?? []),
      ...(cls('delivery-cells') ?? []),
      ...(enr('delivery-tail') ?? []),
    ], oc),
    kpiCard('Cost', [
      statCell('Total <span class="stat-sub">measured</span>', usd(c.totals.costUsd)),
      statCell('Per delivered <span class="stat-sub">incl. overhead</span>', c.averages.totalPerDelivered ? usd(c.averages.totalPerDelivered.costUsd) : 'n/a'),
      statCell('Overhead <span class="stat-sub">lead+stages, once</span>', `${usd(c.overhead.costUsd)}${c.overhead.sharePct != null ? ` <span class="stat-sub">(${c.overhead.sharePct}%)</span>` : ''}`),
      cls('cost-cell') ?? statCell(`Avg direct / ${w.item}`, c.averages.directPerCase ? usd(c.averages.directPerCase.costUsd) : 'n/a'),
    ], cls('cost-callout') ?? null),
    kpiCard('Tokens', ts ? [
      statCell('Total <span class="stat-sub">incl. cache replay</span>', fmtInt(c.totals.tokens)),
      statCell('Real work <span class="stat-sub">in+out</span>', fmtInt(realWork(ts))),
      statCell('Cache read', fmtInt(ts.cacheRead)),
      statCell('Cache hit rate', pct(cacheHitRate(ts))),
    ] : [statCell('Total <span class="stat-sub">incl. cache</span>', `${fmtInt(c.totals.tokens)}${U(c.totals, 'tokens')}`)],
    ts ? `cache write ${fmtInt(ts.cacheWrite)} · ~${pct(cacheSavings(ts))} of prompt cost saved by cache — composition in <strong>batch-tokenomics.html</strong>` : 're-run close for the token split'),
    kpiCard('Activity', [
      statCell('Turns', `${fmtInt(c.totals.turns)}${U(c.totals, 'turns')}`),
      statCell('Tool calls', c.totals.toolCalls != null || c.totals.unmeasured ? `${fmtInt(c.totals.toolCalls)}${U(c.totals, 'toolCalls')} <span class="stat-sub">(${c.totals.toolErrors ?? '—'} err${U(c.totals, 'toolErrors')}${okPct ? `, ${okPct}` : ''})</span>` : '—'),
      statCell('Dispatches', fmtInt(c.totals.dispatches)),
      statCell(`Active time <span class="stat-sub">(${minBreakdown(c, w)})</span>`, `${hours(c.totals.activeMin)}${U(c.totals, 'activeMin')}`),
    ], c.totals.skills?.length ? `skills: ${esc(c.totals.skills.join(', '))}` : null),
  ].join('');
  return `<!doctype html><meta charset="utf-8"><title>${w.Group} cost — ${esc(c.batch)}</title><style>${PAGE_CSS}</style>
  <h1>${w.Group} cost — ${esc(c.batch)}</h1>
  <p class="meta">Delivery view · generated ${esc(c.generatedAt)} · ${c.sources.sessions} session(s) on ${esc(c.sources.hosts.join(', '))} · sources: ${esc(c.sources.costSources.join(', ') || 'tokens only')} · models: ${esc(c.sources.models.join(', ') || '—')}</p>
  <section class="kpi-row">${cards}</section>
  ${c.sources.liveSessions ? `<p class="callout-warn">⏳ LIVE / PROVISIONAL — ${c.sources.liveSessions} session(s) still running. Finished dispatches are counted; their lead thread is not measured yet, so these totals are a floor.</p>` : ''}
  ${c.sources.conflicts ? `<p class="callout-warn">⚠ ${esc(batchConflictsText(c))}.</p>\n  ` : ''}${c.findings ? `<p class="callout-warn">⚠ ${esc(unverifiedReceiptText(c, w))}.</p>\n  ` : ''}${c.sources.sharedSessions ? `<p class="note">${c.sources.sharedSessions} session(s) also served other ${w.groups} — session-level figures split evenly${c.sources.foreignDispatchesExcluded ? `; ${c.sources.foreignDispatchesExcluded} other-${w.group} dispatch(es) excluded` : ''}.</p>` : ''}
  ${enr('gate-drift') ?? ''}
  ${enr('outcome-drift') ?? ''}
  <section class="panel"><h2>Per ${w.item} — direct, measured${priced ? '' : ' (tokens: no per-dispatch dollars on this host)'}</h2>
  <p class="panel-sub">${w.Group} overhead is NOT in these bars — it is the labelled figure above, shown once instead of smeared. Clustered ${w.items} are an even split of their shared dispatches.${c.sources.activeMinGrain === 'session' ? ` Loaded minutes are ${w.group} time ÷ ${w.items} (session grain), an allocation.` : ''}</p>
  ${bars}</section>
  <section class="panel"><h2>Spread</h2>
  <p>${priced ? `Direct cost: ${st(c.stats.directCostUsd, (x) => `$${x.toFixed(2)}`)}<br>` : ''}${c.stats.loadedCostUsd ? `Loaded cost (direct + even overhead share — allocation, not measurement): ${st(c.stats.loadedCostUsd, (x) => `$${x.toFixed(2)}`)}<br>` : ''}Tokens: ${st(c.stats.directTokens, (x) => x.toLocaleString())}<br>Active time: ${c.sources.activeMinGrain === 'session' && !c.stats.directActiveMin ? `session grain, none per ${w.item}` : st(c.stats.directActiveMin, (x) => `${x}m`)}${c.stats.loadedActiveMin ? ` · loaded: ${st(c.stats.loadedActiveMin, (x) => `${x}m`)}` : ''}</p></section>
  ${Object.keys(c.byRole ?? {}).length ? `<section class="panel"><h2>By role</h2>${c.byDispatchRole ? `<p class="panel-sub">${esc(ROLE_DOLLARS_NOTE)}</p>` : ''}${(() => {
    const roles = Object.entries(c.byRole);
    const rmax = Math.max(1, ...roles.map(([, b]) => num(b.tokens)));
    return roles.map(([r, b]) => `
    <div class="row"><div class="lbl">${esc(r)}</div>
    <div class="track"><div class="bar" style="width:${Math.max(1, (num(b.tokens) / rmax) * 100)}%"></div></div>
    <div class="num">${roleUsd(b) ?? (b.costUsd != null ? `$${b.costUsd.toFixed(2)}` : (b.tokens == null && b.unmeasured ? `—${U(b, 'tokens')}` : `${(b.tokens / 1e6).toFixed(1)}M tok`))}<span class="sub"> · ${b.dispatches || '—'} disp · ${minsOf(b)}${b.toolCalls != null || b.unmeasured ? ` · ${b.toolCalls ?? '—'}${U(b, 'toolCalls')} tools (${b.toolErrors ?? '—'}${U(b, 'toolErrors')})` : ''}</span></div></div>`).join('');
  })()}</section>` : ''}${dispatchPanelHtml(c)}
  ${enr('sections') ?? ''}
  ${c.coverage.casesUnattributed.length ? `<p class="note">Unattributed (no captured dispatch named them): ${esc(c.coverage.casesUnattributed.join(', '))}</p>` : ''}`;
}

// --- The TOKENOMICS view — the other unfolding of the same cost.json --------
// The batch report answers "what did delivery cost"; this answers "where did
// the tokens go and how well did the cache work" (same rhythm as manual-qa's
// Orchestrator-composition section): composition per bucket — real work
// (input+output) vs cache write vs cache read — plus the hit rate, so a huge
// raw token number reads correctly instead of alarmingly.
export function renderBatchTokenomicsMarkdown(c, settings = TA_DEFAULTS, ext = null) {
  return withMdFooter(renderBatchTokenomicsMarkdownBody(c, settings, ext), c);
}
function renderBatchTokenomicsMarkdownBody(c, settings = TA_DEFAULTS, ext = null) {
  const w = words(settings);
  const ts = c.totals.tokensSplit;
  const out = [`# ${w.Group} tokenomics — ${c.batch}`, '',
    `Generated: ${c.generatedAt}  ·  sessions: ${c.sources.sessions}  ·  models: ${c.sources.models.join(', ') || '—'}  ·  companion of batch-report (delivery view)`, ''];
  if (c.sources.conflicts) out.push(`> ⚠️ ${batchConflictsText(c)}.`, '');
  if (!ts && c.totals.tokens == null && c.totals.unmeasured) { out.push(`_No measured tokens in this ${w.group}: ${c.totals.unmeasured.tokens} unmeasured unit(s), ${hours(c.totals.activeMin)} active${U(c.totals, 'activeMin')}._`); return out.join('\n'); }
  if (!ts) { out.push('_No token split in this cost.json — regenerate it (work-scope close / batch-cost.mjs) with the current skill version._'); return out.join('\n'); }
  const total = ts.input + ts.output + ts.cacheRead + ts.cacheWrite;
  out.push('## Composition — where the tokens went', '');
  out.push('| kind | tokens | share | what it is |', '|---|---|---|---|');
  out.push(`| real work: input | ${ts.input.toLocaleString()} | ${pct(ts.input / total)} | fresh prompt tokens, full price |`);
  out.push(`| real work: output | ${ts.output.toLocaleString()} | ${pct(ts.output / total)} | generated tokens — the most expensive kind |`);
  out.push(`| cache write | ${ts.cacheWrite.toLocaleString()} | ${pct(ts.cacheWrite / total)} | context stored for reuse (~1.25× input price) |`);
  out.push(`| cache read | ${ts.cacheRead.toLocaleString()} | ${pct(ts.cacheRead / total)} | context replayed from cache (~0.1× input price) |`);
  out.push(`| **total** | **${total.toLocaleString()}** | 100% | raw sum — dominated by the cheapest kind |`);
  out.push('', `**Cache hit rate: ${pct(cacheHitRate(ts))}** — share of all prompt tokens replayed from cache versus processed fresh (input + cache write are the fresh processing).`);
  out.push(`**Cache savings: ~${pct(cacheSavings(ts))} of prompt cost** — what the same prompt volume would have cost uncached (all tokens at 1× input price) versus as billed (write 1.25×, read 0.1×).`);
  {
    const share = costShareOfCacheRead(ts);
    if (share != null) out.push(`**Cache-read cost share: ~${share}% of spend** (public-list ratios: in 1× / out 5× / write 1.25× / read 0.1×) — the dollar-weighted view the cross-factory dataset reports.`);
  }
  const bm = c.totals.tokensByModel;
  if (bm && Object.keys(bm).length) {
    out.push('', '## By model', '', '| model | input | output | cache write | cache read | total |', '|---|---|---|---|---|---|');
    for (const [m, q0] of Object.entries(bm).sort((a, z) => num(z[1].output) - num(a[1].output))) {
      out.push(`| ${m} | ${num(q0.input).toLocaleString()} | ${num(q0.output).toLocaleString()} | ${kTok(q0.cacheWrite)} | ${kTok(q0.cacheRead)} | ${(num(q0.input) + num(q0.output) + num(q0.cacheRead) + num(q0.cacheWrite)).toLocaleString()} |`);
    }
  }
  out.push(`**Total: ${c.totals.tokens.toLocaleString()} tokens${U(c.totals, 'tokens')} · ${usd(c.totals.costUsd)} · ${hours(c.totals.activeMin)}${U(c.totals, 'activeMin')} active · ${c.totals.dispatches} dispatches** — judge by composition and hit rate, not by the big number.`, '');
  const rowFor = (name, b, cost = usd(b.costUsd)) => `| ${name} | ${cost} | ${realWork(b.tok)?.toLocaleString() ?? '—'}${U(b, 'tokens')} | ${kTok(b.tok?.cacheWrite)} | ${kTok(b.tok?.cacheRead)} | ${b.tok ? pct(cacheHitRate(b.tok)) : '—'} |`;
  // O1: a bucket whose tokens are all unmeasured (tok null) stays in the table, shown as '—' with its count
  const roles = Object.entries(c.byRole ?? {}).filter(([, b]) => b.tok || b.unmeasured?.tokens);
  if (roles.length) {
    out.push('## By role', '', '| role | cost | real work | cache write | cache read | hit rate |', '|---|---|---|---|---|---|');
    for (const [r, b] of roles.sort((a, z) => (z[1].costUsd ?? 0) - (a[1].costUsd ?? 0))) out.push(rowFor(r, b, roleUsd(b) ?? usd(b.costUsd)));
    if (c.byDispatchRole) out.push('', `_${ROLE_DOLLARS_NOTE}_`);
    out.push('');
  }
  { const dt = dispatchTableMd(c); if (dt.length) out.push(...dt.slice(1), ''); }
  // The lead's share, decomposed — the e5aa3ba lesson: a big orchestrator
  // number is usually cache traffic, not runaway thinking; show which.
  const lead = c.overhead?.lead;
  if (lead && !lead.tok && lead.unmeasured?.tokens) {
    out.push('## Orchestrator (lead thread) composition', '', `Lead: ${usd(lead.costUsd)} · real work —${U(lead, 'tokens')}`, '');
  }
  if (lead?.tok) {
    out.push('## Orchestrator (lead thread) composition', '');
    out.push(`Lead: ${usd(lead.costUsd)}${c.overhead.sharePct != null ? ` — overhead incl. stages is ${c.overhead.sharePct}% of the ${w.group}` : ''} · real work ${realWork(lead.tok).toLocaleString()} · cache ${kTok(lead.tok.cacheRead)} read / ${kTok(lead.tok.cacheWrite)} write · hit rate ${pct(cacheHitRate(lead.tok))}`);
    out.push('A high lead share with a high hit rate is orchestration overhead working as designed (context replayed per turn), not runaway spend.', '');
  }
  out.push(...(hook(ext, 'classifyDispatch', c, { settings, phase: 'render-tok-md', rowFor }) ?? []));
  out.push(...(hook(ext, 'enrichGroup', c, { settings, phase: 'render-tok-md' }) ?? []));
  const cased = (c.cases ?? []).filter((x) => x.direct.tok && (x.direct.tok.input || x.direct.tok.output || x.direct.tok.cacheRead));
  if (cased.length) {
    out.push(`## Per ${w.item} (direct; clustered ${w.items} are an even split)`, '', `| ${w.item} | cost | input | output | cache write | cache read | total | hit rate | share |`, '|---|---|---|---|---|---|---|---|---|');
    for (const x of cased) {
      const tk = x.direct.tok; const tot = tk.input + tk.output + tk.cacheRead + tk.cacheWrite;
      out.push(`| ${x.id} | ${usd(x.direct.costUsd)} | ${tk.input.toLocaleString()} | ${tk.output.toLocaleString()} | ${kTok(tk.cacheWrite)} | ${kTok(tk.cacheRead)} | ${tot.toLocaleString()} | ${pct(cacheHitRate(tk))} | ${pct(c.totals.tokens ? tot / c.totals.tokens : 0)} |`);
    }
  }
  return out.join('\n');
}

export function renderBatchTokenomicsHtml(c, settings = TA_DEFAULTS, ext = null) {
  return withHtmlFooter(renderBatchTokenomicsHtmlBody(c, settings, ext), c);
}
function renderBatchTokenomicsHtmlBody(c, settings = TA_DEFAULTS, ext = null) {
  const w = words(settings);
  const esc = escHtml;
  const ts = c.totals.tokensSplit;
  const row = (name, b, cost = b.costUsd != null ? usd(b.costUsd) : '—') => `
    <div class="row"><div class="lbl">${esc(name)}</div>${b.tok && quadTotal(b.tok) ? `<div class="stacked">${QUAD_SERIES.map(([k, cls, label]) =>
      num(b.tok[k]) > 0 ? `<div class="bar-seg ${cls}" style="flex:${Math.max((num(b.tok[k]) / quadTotal(b.tok)) * 100, 0.4)} 0 0" title="${label}: ${fmtInt(b.tok[k])}"></div>` : '').join('')}</div>` : '<div class="track"></div>'}
    <div class="num">${cost}<span class="sub"> · rw ${kTok(realWork(b.tok))}${U(b, 'tokens')} · hit ${b.tok ? pct(cacheHitRate(b.tok)) : '—'}</span></div></div>`;
  const roles = Object.entries(c.byRole ?? {}).filter(([, b]) => b.tok || b.unmeasured?.tokens).sort((a, z) => (z[1].costUsd ?? 0) - (a[1].costUsd ?? 0));
  const cased = (c.cases ?? []).filter((x) => x.direct.tok && (x.direct.tok.input || x.direct.tok.output || x.direct.tok.cacheRead));
  const lead = c.overhead?.lead;
  const okPct = okPctOf(c.totals);
  const cachedShare = ts ? num(ts.cacheRead) / (quadTotal(ts) || 1) : null;
  const cards = ts ? [
    kpiCard('Cache', [
      statCell('Cache hit rate', pct(cacheHitRate(ts))),
      statCell('Prompt cost saved', `~${pct(cacheSavings(ts))}`),
      statCell('Total cost <span class="stat-sub">measured</span>', usd(c.totals.costUsd)),
      statCell('Active time', `${hours(c.totals.activeMin)}${U(c.totals, 'activeMin')}`),
    ], `a cache write is a STORED MISS (processed fresh at ~1.25×, kept for reuse); a read replays at ~0.1× input price${costShareOfCacheRead(ts) != null ? ` — cache-read ≈ ${costShareOfCacheRead(ts)}% of SPEND at public ratios` : ''}`),
    kpiCard('Tokens', [
      statCell('Total <span class="stat-sub">incl. cache replay</span>', `${fmtInt(c.totals.tokens)}${U(c.totals, 'tokens')}`),
      statCell('Real work <span class="stat-sub">in+out</span>', fmtInt(realWork(ts))),
      statCell('Input', fmtInt(ts.input)),
      statCell('Output', fmtInt(ts.output)),
      statCell('Cache read', fmtInt(ts.cacheRead)),
      statCell('Cache write', fmtInt(ts.cacheWrite)),
    ], `<strong>${pct(cachedShare)}</strong> of all tokens served from cache`),
    kpiCard('Activity', [
      statCell('Turns', `${fmtInt(c.totals.turns)}${U(c.totals, 'turns')}`),
      statCell('Tool calls', c.totals.toolCalls != null || c.totals.unmeasured ? `${fmtInt(c.totals.toolCalls)}${U(c.totals, 'toolCalls')} <span class="stat-sub">(${c.totals.toolErrors ?? '—'} err${U(c.totals, 'toolErrors')}${okPct ? `, ${okPct}` : ''})</span>` : '—'),
      statCell('Dispatches', fmtInt(c.totals.dispatches)),
      statCell('Sessions', fmtInt(c.sources.sessions)),
    ], null),
  ].join('') : '';
  return `<!doctype html><meta charset="utf-8"><title>${w.Group} tokenomics — ${esc(c.batch)}</title><style>${PAGE_CSS}</style>
  <h1>${w.Group} tokenomics — ${esc(c.batch)}</h1>
  <p class="meta">The other unfolding of the same records as batch-report (delivery view) · generated ${esc(c.generatedAt)} · ${c.sources.sessions} session(s) · models: ${esc(c.sources.models.join(', ') || '—')}</p>
  ${c.sources.conflicts ? `<p class="callout-warn">⚠ ${esc(batchConflictsText(c))}.</p>\n  ` : ''}${!ts ? (c.totals.tokens == null && c.totals.unmeasured ? `<p class="note">No measured tokens in this ${w.group}: ${c.totals.unmeasured.tokens} unmeasured unit(s), ${hours(c.totals.activeMin)} active${U(c.totals, 'activeMin')}.</p>` : '<p class="note">No token split in this cost.json — regenerate with the current skill version.</p>') : `
  <section class="kpi-row">${cards}</section>
  ${c.totals.tokensAttribution ? `<p class="callout-warn">⚠ Token totals are a FLOOR — attribution ${esc(c.totals.tokensAttribution)}: ${c.totals.unattributedUnits} unit(s) reported no usage (gateway pass-through gap). The real bill is higher.</p>` : ''}
  <section class="panel"><h2>Token composition</h2>
  <p class="panel-sub">Share of ${fmtInt(c.totals.tokens)} total tokens by type — the raw sum is dominated by the cheapest kind, so judge by composition and cache hit rate, not the big number.</p>
  ${quadBar(ts)}${quadLegend(ts)}</section>
  ${lead && !lead.tok && lead.unmeasured?.tokens ? `<section class="panel"><h2>Orchestrator (lead thread) composition</h2>
  <p class="panel-sub">${usd(lead.costUsd)} · real work —${U(lead, 'tokens')}</p></section>` : ''}${lead?.tok ? `<section class="panel"><h2>Orchestrator (lead thread) composition</h2>
  <p class="panel-sub">${usd(lead.costUsd)} · real work ${kTok(realWork(lead.tok))} · cache hit ${pct(cacheHitRate(lead.tok))}${c.overhead.sharePct != null ? ` · overhead incl. stages: ${c.overhead.sharePct}% of the ${w.group}` : ''}</p>
  ${quadBar(lead.tok)}${quadLegend(lead.tok)}
  <div class="kpi-callout">A high lead share with a high cache hit rate is orchestration working as designed — context replayed per turn from cache, not runaway spend.</div></section>` : ''}
  ${roles.length ? `<section class="panel"><h2>By role</h2><p class="panel-sub">Per-role composition; rw = real work (in+out), hit = cache hit rate.${c.byDispatchRole ? ` ${esc(ROLE_DOLLARS_NOTE)}.` : ''}</p>${roles.map(([r, b]) => row(r, b, roleUsd(b) ?? undefined)).join('')}</section>` : ''}${dispatchPanelHtml(c)}
  ${hook(ext, 'classifyDispatch', c, { settings, phase: 'render-tok-html', row }) ?? ''}
  ${c.totals.tokensByModel && Object.keys(c.totals.tokensByModel).length ? `<section class="panel"><h2>By model</h2>
  <p class="panel-sub">Per-model token split — what lets a mixed-tier run be re-priced (the dataset's tokens_by_model).</p>
  <table><tr><th>model</th><th>input</th><th>output</th><th>cache write</th><th>cache read</th><th>total</th></tr>
  ${Object.entries(c.totals.tokensByModel).sort((a, z) => num(z[1].output) - num(a[1].output)).map(([m, q0]) => `<tr><td>${esc(m)}</td><td>${fmtInt(q0.input)}</td><td>${fmtInt(q0.output)}</td><td>${fmtInt(q0.cacheWrite)}</td><td>${fmtInt(q0.cacheRead)}</td><td>${fmtInt(num(q0.input) + num(q0.output) + num(q0.cacheRead) + num(q0.cacheWrite))}</td></tr>`).join('')}</table></section>` : ''}
  ${cased.length ? `<section class="panel"><h2>Per ${w.item}</h2><p class="panel-sub">Direct spend only; clustered ${w.items} are an even split of their shared dispatches. Share = of the ${w.group}'s ${fmtInt(c.totals.tokens)} total tokens.</p>
  <table><tr><th>${w.item}</th><th>cost</th><th>input</th><th>output</th><th>cache write</th><th>cache read</th><th>total</th><th>hit rate</th><th>share</th></tr>
  ${cased.map((x) => {
    const tk = x.direct.tok; const tot = quadTotal(tk); const share = c.totals.tokens ? tot / c.totals.tokens : 0;
    return `<tr><td>${esc(x.id)}</td><td>${usd(x.direct.costUsd)}</td><td>${fmtInt(tk.input)}</td><td>${fmtInt(tk.output)}</td><td>${fmtInt(tk.cacheWrite)}</td><td>${fmtInt(tk.cacheRead)}</td><td>${fmtInt(tot)}</td><td>${pct(cacheHitRate(tk))}</td><td><div class="share-cell"><div class="share-bar-track"><div class="share-bar-fill" style="width:${Math.max(share * 100, 0.5)}%"></div></div><span class="share-bar-label">${pct(share)}</span></div></td></tr>`;
  }).join('')}</table></section>` : ''}`}`;
}

// Self-contained TEAM page — the whole ledger's rollup, same visual language
// as the batch page (no external assets, light/dark aware). Real dollars only,
// tokens-only sessions flagged, never estimated — same discipline as markdown.
export function renderTeamHtml(rep, opts = {}, settings = TA_DEFAULTS, ext = null) {
  return withHtmlFooter(renderTeamHtmlBody(rep, opts, settings, ext), opts);
}
function renderTeamHtmlBody(rep, { window, label } = {}, settings = TA_DEFAULTS, ext = null) {
  const w = words(settings);
  const esc = escHtml;
  const enr = (part, input) => hook(ext, 'enrichGroup', input, { settings, phase: 'render-html', part, esc });
  const t = rep.totals;
  const teamTotal = quadTotal(t.tokens);
  const tbl = (entries, cols, row) => entries.length
    ? `<table><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${entries.map(row).join('')}</table>` : '';
  const bucketRow = ([k, b]) => `<tr><td>${esc(k)}</td><td>${b.priced ? usd(b.costUsd) : 'n/a'}</td><td>${b.sessions}</td><td>${loc(b.tokens?.output)}${U(b, 'tokens')}</td><td>${hours(b.activeMin)}${U(b, 'activeMin')}</td><td>${cnt(b.toolCalls)}${U(b, 'toolCalls')} (${cnt(b.toolErrors)}${U(b, 'toolErrors')})</td></tr>`;
  const intents = Object.entries(rep.byIntent ?? {});
  const cases = rep.cases;
  const okPct = t.toolCalls && t.toolErrors != null ? `${Math.round((1 - t.toolErrors / t.toolCalls) * 100)}% ok` : '';
  const cards = [
    kpiCard('Cost', [
      statCell('Real dollars <span class="stat-sub">never estimated</span>', usd(t.priced ? t.costUsd : null)),
      statCell('Priced sessions', `${t.priced}/${rep.sessions}`),
      rep.perDelivered ? statCell(`Per delivered ${w.item}`, usd(rep.perDelivered.automationOnlyCostUsd ?? rep.perDelivered.costUsd)) : statCell(`Per delivered ${w.item}`, 'n/a'),
      rep.perExamined ? statCell(`Per ${w.item} examined`, usd(rep.perExamined.costUsd)) : statCell('People', fmtInt(rep.people)),
    ], rep.semantics && rep.perDelivered ? `ratio-intent spend only (each line's manifest revision)${rep.perDelivered.partial ? `; partial: ${rep.perDelivered.priced} of ${rep.perDelivered.eligible} eligible priced` : ''}`
      : rep.perDelivered?.automationOnlyCostUsd != null ? `${esc(b1RatioIntents(settings).join('/'))}-intent spend only; all-spend ${usd(rep.perDelivered.costUsd)}` : (Object.keys(rep.costSources ?? {}).length ? `sources: ${esc(Object.entries(rep.costSources).map(([s, n]) => `${s} ×${n}`).join(', '))}` : null)),
    kpiCard('Tokens <span class="stat-sub">incl. sub-agents</span>', [
      statCell('Total <span class="stat-sub">incl. cache replay</span>', `${t.tokens == null ? '—' : fmtInt(teamTotal)}${U(t, 'tokens')}`),
      statCell('Real work <span class="stat-sub">in+out</span>', fmtInt(realWork(t.tokens))),
      statCell('Cache read', fmtInt(t.tokens?.cacheRead)),
      statCell('Cache hit rate', pct(cacheHitRate(t.tokens))),
    ], `in ${fmtInt(t.tokens?.input)} · out ${fmtInt(t.tokens?.output)} · cache write ${fmtInt(t.tokens?.cacheWrite)}`),
    ...(cases?.reports ? [kpiCard('Delivery <span class="stat-sub">receipts</span>', [
      statCell('delivered / examined', `${cases.delivered}/${cases.examined}`),
      statCell('Reports', fmtInt(cases.reports)),
      statCell(w.Groups, fmtInt(rep.byBatch?.length ?? 0)),
      statCell('Sessions · people', `${rep.sessions} · ${rep.people}`),
    ], Object.entries(cases.outcomes).sort((a, z) => z[1] - a[1]).map(([k, n]) => `<span class="chip">${esc(k)} ${n}</span>`).join('')
      + (cases.unwindowed ? `<span class="chip">unwindowed ${cases.unwindowed}</span>` : ''))] : []),
    kpiCard('Activity', [
      statCell('Active', `${hours(t.activeMin)}${U(t, 'activeMin')} <span class="stat-sub">(${hours(t.wallMin)} wall${U(t, 'wallMin')})</span>`),
      statCell('Turns', `${fmtInt(t.turns)}${U(t, 'turns')}`),
      statCell('Tool calls', `${fmtInt(t.toolCalls)}${U(t, 'toolCalls')} <span class="stat-sub">(${cnt(t.toolErrors)} err${U(t, 'toolErrors')}${okPct ? `, ${okPct}` : ''})</span>`),
      statCell('Hosts', esc(Object.entries(rep.byHost).map(([h, b]) => `${h} ${b.sessions}`).join(', ')) || '—'),
    ], null),
  ].join('');
  return `<!doctype html><meta charset="utf-8"><title>Tokenomics — team report${label ? ` — ${esc(label)}` : ''}</title><style>${PAGE_CSS}</style>
  <h1>Tokenomics — team usage report${label ? ` — ${esc(label)}` : ''}</h1>
  <p class="meta">Generated ${esc(new Date().toISOString())}${window ? ` · window: ${esc(window)}` : ''} · ${rep.sessions} session(s) · ${rep.people} person(s) · ${Object.entries(rep.byHost).map(([h, b]) => `${esc(h)} ${b.sessions}`).join(', ')}</p>
  ${rep.semantics ? `<p class="meta">${esc(rep.semantics)}</p>\n  ` : ''}<section class="kpi-row">${cards}</section>
  ${rep.unverified ? `<p class="callout-warn">⚠ ${esc(unverifiedText(rep))}, kept in the totals.</p>\n  ` : ''}${rep.undated ? `<p class="callout-warn">⚠ ${esc(undatedText(rep.undated))}.</p>\n  ` : ''}${rep.conflicts ? `<p class="callout-warn">⚠ ${esc(conflictsText(rep))}.</p>\n  ` : ''}${rep.cases?.conflicts ? `<p class="callout-warn">⚠ ${esc(receiptConflictsText(rep.cases, w))}.</p>\n  ` : ''}${rep.findings ? `<p class="callout-warn">Findings: ${esc(rep.findings.join('; '))}</p>\n  ` : ''}${rep.tokensOnly ? `<p class="callout-warn">⚠ ${rep.tokensOnly} session(s) tokens-only — no real dollar, never estimated.</p>` : ''}
  ${intents.some(([k]) => k !== 'undeclared') ? `<section class="panel"><h2>By declared intent</h2><p>${intents.map(([k, b]) => `<span class="chip">${esc(k)}: ${b.priced ? usd(b.costUsd) : 'n/a'} (${b.sessions})</span>`).join('')}</p></section>` : ''}
  ${rep.byBatch?.length ? `<section class="panel"><h2>By ${w.group}</h2>
  <table><tr>${[w.group, w.items, 'delivered', 'total', 'per delivered', 'active', ...(enr('by-group-head', rep) ?? [])].map((h) => `<th>${h}</th>`).join('')}</tr>
  ${rep.byBatch.map((b) => `<tr>${[esc(b.batch), b.cases, b.delivered, usd(b.costUsd), usd(b.perDelivered), `${hours(b.activeMin)}${U(b, 'activeMin')}`, ...(enr('by-group-cells', b) ?? [])].map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</table></section>` : ''}
  ${rep.perCase?.length ? `<section class="panel"><h2>Per ${w.item} — cost.json rows across ${w.groups} (delivered first)</h2>
  ${rep.perCaseStats?.loadedCostUsd ? `<p class="panel-sub">Delivered-${w.item} loaded cost: avg ${usd(rep.perCaseStats.loadedCostUsd.avg)} · median ${usd(rep.perCaseStats.loadedCostUsd.median)} · min ${usd(rep.perCaseStats.loadedCostUsd.min)} · max ${usd(rep.perCaseStats.loadedCostUsd.max)} (n=${rep.perCaseStats.loadedCostUsd.n}). Loaded = direct + even overhead share — allocation, not measurement.</p>` : ''}
  <table><tr><th>${w.item}</th><th>${w.group}</th><th>outcome</th><th>direct</th><th>loaded</th><th>active (loaded)</th></tr>
  ${rep.perCase.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.batch)}</td><td>${esc(r.outcome ?? '—')}</td><td>${usd(r.direct.costUsd)}</td><td>${usd(r.loaded?.costUsd)}</td><td>${loadedMins(r.loaded)}</td></tr>`).join('')}</table></section>` : ''}
  <section class="panel"><h2>By person</h2>${tbl(Object.entries(rep.byPerson).sort((a, z) => (z[1].costUsd || 0) - (a[1].costUsd || 0)), ['person', 'cost', 'sessions', 'out tokens', 'active', 'tools (err)'], bucketRow)}</section>
  <section class="panel"><h2>By role</h2><p class="panel-sub">Dollars are session-grain, so roles report tokens/time — sub-agent roles included.${rep.byDispatchRole ? ` ${NOT_ALLOCATED_NOTE}` : ''}</p>
  ${tbl(Object.entries(rep.byRole).sort((a, z) => num(z[1].tokens?.output) - num(a[1].tokens?.output)), ['role', 'units', 'out tokens', 'active', 'tools (err)'],
    ([k, b]) => `<tr><td>${esc(k)}</td><td>${b.units}</td><td>${loc(b.tokens?.output)}${U(b, 'tokens')}</td><td>${hours(b.activeMin)}${U(b, 'activeMin')}</td><td>${cnt(b.toolCalls)}${U(b, 'toolCalls')} (${cnt(b.toolErrors)}${U(b, 'toolErrors')})</td></tr>`)}</section>${Object.keys(rep.byDispatchRole ?? {}).length ? `
  <section class="panel"><h2>Dispatch minutes by role</h2><p class="panel-sub">${DISPATCH_MIN_NOTE}</p>
  ${tbl(Object.entries(rep.byDispatchRole).sort(([a], [z]) => a.localeCompare(z)), ['role', 'dispatches', 'active'], ([k, b]) => `<tr><td>${esc(k)}</td><td>${b.units}</td><td>${dMins(b)}</td></tr>`)}</section>` : ''}
  <section class="panel"><h2>By week</h2>${tbl(Object.entries(rep.byWeek).sort(([a], [z]) => a.localeCompare(z)), ['week', 'cost', 'sessions', 'out tokens', 'active', 'tools (err)'], bucketRow)}</section>`;
}

/** JSON with object keys sorted recursively (array order kept), so settings compare by content, not key order. */
const canonicalJson = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** Why `roots` cannot share one report (roots[0]'s settings and extension), or null when they can:
 * every root needs settings equal to roots[0]'s (canonical JSON) and the same extension module — the
 * same resolved path, or byte-identical files.
 * Known limitation (fail-closed, rc.2): settings are read from `<root>/.agents/tokenomics/settings.json`,
 * so a root given as a telemetry dir or a single ledger file always gets TA_DEFAULTS. Mixing such a
 * root with a foreign repo root (e.g. a foreign repo plus one of its own ledger files) is rejected
 * with exit 2 even though both belong to the same repo — pass the repo root instead. */
function rootsConflict(roots, rootSettings) {
  const extOf = (i) => { try { return { path: extensionPath(rootSettings[i], roots[i]) }; } catch (e) { return { error: e.message }; } };
  const first = extOf(0);
  for (let i = 1; i < roots.length; i++) {
    if (canonicalJson(rootSettings[i]) !== canonicalJson(rootSettings[0])) return `${roots[0]} and ${roots[i]} use different .agents/tokenomics/settings.json`;
    const other = extOf(i);
    for (const [r, x] of [[roots[0], first], [roots[i], other]]) if (x.error) return `cannot resolve ${r}'s extension (${x.error})`;
    if (first.path === other.path) continue;
    for (const [r, p] of [[roots[0], first.path], [roots[i], other.path]]) if (!existsSync(p)) return `${r}'s extension ${p} does not exist`;
    const read = (r, p) => { try { return { buf: readFileSync(p) }; } catch (e) { return { err: `cannot read ${r}'s extension ${p} (${e.code ?? e.message})` }; } };
    const a = read(roots[0], first.path); if (a.err) return a.err;
    const b = read(roots[i], other.path); if (b.err) return b.err;
    if (!a.buf.equals(b.buf)) return `${roots[0]} and ${roots[i]} load different extension modules (${first.path}, ${other.path})`;
  }
  return null;
}

/** `{manifestRevision}` of the primary directory, plus `manifestRevisions` [{dir, manifestRevision}] only when the distinct directories disagree. */
function periodProvenance(dirs) {
  const seen = [...new Set(dirs)].map((dir) => ({ dir, manifestRevision: stampRevision(dir) }));
  const out = { manifestRevision: seen[0].manifestRevision };
  if (seen.some((d) => d.manifestRevision !== seen[0].manifestRevision)) out.manifestRevisions = seen;
  return out;
}

const ENGINE_ROOT = engineRootOf(import.meta.url);

export async function main(argv = process.argv.slice(2)) {
  const flags = new Map();
  const roots = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.set('json', true);
    else if (a === '--html') flags.set('html', true);
    else if (a === '--tokenomics') flags.set('tokenomics', true);
    else if (a === '--batches') flags.set('batch', '*');
    else if (a === '--since' || a === '--until' || a === '--out' || a === '--receipts' || a === '--label' || a === '--role' || a === '--batch') flags.set(a.slice(2), argv[++i]);
    else roots.push(resolve(a));
  }
  if (!roots.length) roots.push(process.cwd());
  // activation (D-ACT, R19): --batch and --out write (cost.json, the output file); an inert or refused copy says why,
  // writes nothing and exits 1, before the settings load. A period report to stdout stays available when inert.
  if (!gateCli(ENGINE_ROOT, roots[0], { writes: !!(flags.get('batch') || flags.get('out')) })) return 1;
  const settings = loadSettings(roots[0]);
  // A period report renders every root with roots[0]'s settings and extension, so it refuses roots
  // that would not behave the same. Batch mode uses roots[0] alone and skips the check.
  const rootSettings = flags.get('batch') ? null : roots.map((r, i) => (i === 0 ? settings : loadSettings(r)));
  const conflict = rootSettings && rootsConflict(roots, rootSettings);
  if (conflict) { process.stderr.write(`team-report: ${conflict} — report them separately\n`); return 2; }
  const ext = await loadExtension(settings, roots[0]);
  const w = words(settings);
  if (flags.get('batch')) {
    // Batch mode is per-repo (receipts live in the repo) — first root wins.
    const batch = flags.get('batch') === '*' ? undefined : flags.get('batch');
    const results = updateBatchCosts(roots[0], { batch, write: true }, settings, ext);
    if (!results.length) { process.stderr.write(`team-report: no receipts${batch ? ` for ${w.group} '${batch}'` : ''} under ${receiptsRoot(roots[0], settings)}\n`); return 1; }
    const mdR = flags.get('tokenomics') ? renderBatchTokenomicsMarkdown : renderBatchMarkdown;
    const htmlR = flags.get('tokenomics') ? renderBatchTokenomicsHtml : renderBatchHtml;
    const output = flags.get('json')
      ? JSON.stringify(results.length === 1 ? results[0] : results, null, 2)
      : flags.get('html')
        ? results.map((r) => htmlR(r, settings, ext)).join('\n')
        : results.map((r) => mdR(r, settings, ext)).join('\n\n---\n\n');
    if (flags.get('out')) writeFileSync(flags.get('out'), `${output}\n`);
    else process.stdout.write(`${output}\n`);
    return 0;
  }
  // report-windows (spec 5.5): one [since, until) window on endedAt for the whole report (owner Q10b), the same
  // window for the receipts' `at`; an unreadable bound is refused instead of compared as text.
  const rw = migrationOn('report-windows');
  for (const k of rw ? ['since', 'until'] : []) {
    if (flags.get(k) && Number.isNaN(parseInstant(flags.get(k)))) { process.stderr.write(`team-report: --${k} '${flags.get(k)}' is not an ISO-8601 date (YYYY-MM-DD) or date-time; a date-time without an offset is read as UTC\n`); return 2; }
  }
  // report-conflicts (spec 3.5; review round 1, I1/I2): every tied line of a conflict goes through the same window and
  // role filter as the winners; a conflict is in scope when ANY of its lines is (in the window, or undated) and is then
  // counted in `conflicts` with its pick in `preview`, never in `undated`. Winners keep their usual scope.
  const rc = migrationOn('report-conflicts') ? dedupConflicts(loadLines(roots)) : null;
  const conflictOf = new Map(rc?.conflicts.flatMap((c, i) => c.lines.map((l) => [l, i])));
  const byKey = (a, z) => { const x = `${a.host}:${a.id}`; const y = `${z.host}:${z.id}`; return x < y ? -1 : x > y ? 1 : 0; };
  const deduped = rc ? [...rc.winners, ...conflictOf.keys()].sort(byKey) : dedupLines(loadLines(roots));
  const win = rw ? reportWindow(deduped, flags.get('since'), flags.get('until')) : null;
  const inScope = filterRole(
    rw ? win.lines : filterWindow(deduped, flags.get('since'), flags.get('until')),
    flags.get('role'),
  );
  const undatedScope = rw ? filterRole(win.undated, flags.get('role')) : [];
  const lines = inScope.filter((l) => !conflictOf.has(l));
  const scopedConflicts = new Set([...inScope, ...undatedScope].filter((l) => conflictOf.has(l)).map((l) => conflictOf.get(l)));
  const conflictPicks = rc ? rc.preview.filter((_, i) => scopedConflicts.has(i)) : [];
  const receiptDirs = flags.get('receipts')
    ? [resolve(flags.get('receipts'))]
    : roots.map((r, i) => receiptsRoot(r, rootSettings[i]));
  // D1: a receipt's manifestRevision resolves in its repo's telemetry dir (--receipts: the first root's)
  const telemetryDirs = flags.get('receipts') ? [telemetryDir(roots[0], settings)] : roots.map((r, i) => telemetryDir(r, rootSettings[i]));
  const cases = { ...loadCases(receiptDirs, settings, rw ? { window: win, telemetryDirs } : undefined), ...(flags.get('role') ? { roleFiltered: true } : {}) };
  const rep = buildReport(lines, cases, settings, {
    ...(rw ? { undated: undatedScope.filter((l) => !conflictOf.has(l)) } : {}),
    ...(rc ? { conflicts: conflictPicks } : {}),
  });
  // Cross-batch per-case rollup: every batch's cost.json rows (direct measured
  // + loaded allocation), delivered first — the "which cases, at what cost"
  // list. Pure recompute, never fails the report over a bad receipt.
  try {
    // Ledger-only: this is a period rollup and its totals above come straight
    // from the ledger, so the batch/case tables must not mix in provisional
    // numbers from sessions that are still running. `--batch` (the live view)
    // keeps them.
    const batchCosts = roots.flatMap((r, i) => updateBatchCosts(r, { write: false, live: false }, rootSettings[i], ext));
    if (batchCosts.length) {
      rep.byBatch = batchCosts.map((c) => ({
        batch: c.batch, cases: c.cases.length, delivered: c.delivered,
        costUsd: c.totals.costUsd, activeMin: c.totals.activeMin,
        perDelivered: c.averages.totalPerDelivered?.costUsd ?? null,
        ...(hook(ext, 'enrichGroup', c, { settings, phase: 'by-group' }) ?? {}),
        ...(c.totals.unmeasured ? { unmeasured: c.totals.unmeasured } : {}),   // null-unobservable (O1)
        ...(c.findings ? { findings: c.findings } : {}),   // B2-05: an unverified stamped receipt (Q11b)
      }));
    }
    // B2-05: a row is delivered by its own receipt's resolved vocabulary, the one its group's `delivered` used.
    const deliveredRows = new Set();
    const perCase = batchCosts.flatMap((c) => c.cases.map((x) => {
      const row = { batch: c.batch, id: x.id, outcome: x.outcome, direct: x.direct, loaded: x.loaded };
      if (groupDeliveredOutcomes(c).includes(x.outcome)) deliveredRows.add(row);
      return row;
    }));
    const isDelivered = (r) => deliveredRows.has(r);
    perCase.sort((a, z) => (isDelivered(z) - isDelivered(a)) || ((z.loaded?.costUsd ?? 0) - (a.loaded?.costUsd ?? 0)));
    if (perCase.length) {
      rep.perCase = perCase;
      const vals = (rows, f) => rows.map(f).filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
      const st = (v) => (v.length ? { avg: v.reduce((a, x) => a + x, 0) / v.length, median: v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2, min: v[0], max: v[v.length - 1], n: v.length } : null);
      const delivered = perCase.filter(isDelivered);
      rep.perCaseStats = {
        note: `over DELIVERED ${w.items}; loaded = direct + even ${w.group}-overhead share (allocation)`,
        loadedCostUsd: st(vals(delivered, (r) => r.loaded?.costUsd)),
        loadedActiveMin: st(vals(delivered, (r) => r.loaded?.activeMin)),
      };
    }
  } catch { /* receipts absent or malformed — the report stands without the case list */ }
  const iso = (t) => (t == null ? '—' : new Date(t).toISOString());
  const windowLabel = [
    rw ? `${iso(win.since)} → ${iso(win.until)}` : [flags.get('since'), flags.get('until')].filter(Boolean).join(' → ') || null,
    flags.get('role') ? `role: ${flags.get('role')}` : null,
  ].filter(Boolean).join('  ·  ') || null;
  // report-revision (spec 14.4, map O6): the writer's stamp rule over each root's telemetry directory. The primary
  // (first) root's revision is the report's; when the directories differ, `manifestRevisions` lists every one.
  const prov = migrationOn('report-revision') ? periodProvenance(roots.map((r, i) => telemetryDir(r, rootSettings[i]))) : {};
  const output = flags.get('json')
    ? JSON.stringify({ generated: new Date().toISOString(), ...prov, window: windowLabel, ...rep }, null, 2)
    : flags.get('html')
      ? renderTeamHtml(rep, { window: windowLabel, label: flags.get('label'), ...prov }, settings, ext)
      : renderMarkdown(rep, { window: windowLabel, label: flags.get('label'), ...prov }, settings, ext);
  if (flags.get('out')) writeFileSync(flags.get('out'), `${output}\n`);
  else process.stdout.write(`${output}\n`);
  return 0;
}

const entryOn = entryPointsOn(ENGINE_ROOT); // items 12/13: realpath main guard, exit after stdio drains
if (entryOn ? isMain(import.meta.url) : (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const code = await main();
  if (entryOn) await exitAfterDrain(code); else process.exit(code);
}
