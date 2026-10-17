#!/usr/bin/env node
// delivery-report.mjs — cost per ticket and per merged PR (Plan 7 layer 2), with the work-item tracker's status read
// through the §5.6 receipt command (layer 3).
//
//   node delivery-report.mjs [repo] [--since D] [--until D] [--prs auto|gh|az|none] [--receipts] [--json] [--out F]
//
// The ledger goes through team-report's read pipeline (load, spec 3.5 dedup with conflicts excluded, the [since,
// until) window on endedAt); merged work is read from the local git history (engine/delivery.mjs) and windowed on its
// merge time. The tracker command runs only with --receipts.
//
// PRIVACY (D-PRIVACY): no titles, descriptions, people, comments or branch names in any output. Branches join lines
// to merges and are never printed; every printed field comes from an explicit projection below.
//
// STDLIB ONLY. Read-only except --out.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSettings } from '../engine/config.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { engineRootOf, entryPointsOn, gateCli } from '../engine/activation.mjs';
import { defaultBranch, mergedWork, joinDelivery, isPriced } from '../engine/delivery.mjs';
import { runReceiptCommand } from '../kit/receipts.mjs';
import { loadLines, dedupConflicts, reportWindow, receiptWinners, parseInstant } from './team-report.mjs';

const ENGINE_ROOT = engineRootOf(import.meta.url);
const PRS_MODES = ['auto', 'gh', 'az', 'none'];
const METRIC_LABEL = 'membership metric (split shares), not the §5.5 ratio';
const PARTIAL = '(partial: adapter reported complete:false)';
const NOT_CONFIGURED = 'not configured (setup --tracker …)';
const NOTES = [
  'a reverted PR still counts as merged',
  'a squash commit with `(#N)` that was not a PR is counted',
  'a git-only rebase merge is invisible (PR enrichment with gh or az finds it)',
  "a session is joined by its single recorded branch (Claude's last gitBranch, Copilot's start context)",
  'a line naming k tickets gives each 1/k of its cost and minutes; a line matched to n PRs by id gives each 1/n',
  'tokens-only sessions carry no dollars; they are counted, never estimated',
  'ids are matched exactly: a ledger id written before ids.rules (`PAY-12`) and `jira:PAY-12` are different tickets',
  'the window is [since, until) on a session\'s endedAt and on a merge\'s time; tracker status is the current state, unwindowed',
];

// --- receipts (D-RECEIPTS) ---------------------------------------------------------------------------------------
const shortStr = (v) => (typeof v === 'string' && v ? v.slice(0, 64) : null);
const finiteNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sprintOf = (v) => shortStr(v && typeof v === 'object' && !Array.isArray(v) ? v.name : v);
const msOrNull = (s) => { const t = parseInstant(s); return Number.isFinite(t) ? t : null; };

/** Envelope receipts → spec 5.2 rows, each an explicit projection (a sprint object reduces to its string name). */
function receiptRows(receipts) {
  const rows = [];
  for (const r of receipts) {
    for (const c of r?.cases ?? []) {
      if (typeof c?.id !== 'string' || !c.id) continue;
      rows.push({
        id: c.id, outcome: shortStr(c.outcome) ?? 'not-started', at: msOrNull(c.at), revision: msOrNull(r.revision),
        group: String(r.group), source: shortStr(r.source) ?? 'command',
        type: shortStr(c.type), points: finiteNum(c.points), sprint: sprintOf(c.sprint),
      });
    }
  }
  return rows;
}

/** The tracker view over the joined tickets: per ticket status, by type, by sprint, and the membership metric. */
function trackerView(run, join, deliveredOutcomes) {
  if (!run) return null;
  const base = { status: run.available ? 'available' : run.reason === 'not configured' ? 'not configured' : 'unavailable', reason: run.reason, complete: run.complete };
  if (!run.available) return base;
  const { win, conflicts } = receiptWinners(receiptRows(run.receipts));
  const conflicted = new Set(conflicts.map((c) => c.id));
  const tickets = {};
  const byType = new Map();
  const bySprint = new Map();
  let delivered = 0;
  let deliveredCost = 0;
  const add = (m, k, cost) => { const b = m.get(k) ?? { delivered: 0, costUsd: 0 }; b.delivered++; b.costUsd += cost; m.set(k, b); };
  for (const id of Object.keys(join.tickets).sort()) {
    const w = win.get(id);
    const isDelivered = !!w && deliveredOutcomes.includes(w.outcome);
    tickets[id] = {
      status: conflicted.has(id) ? 'conflict' : !w ? 'unknown' : isDelivered ? 'delivered' : w.outcome,
      outcome: w?.outcome ?? null, type: w?.type ?? null, points: w?.points ?? null, sprint: w?.sprint ?? null,
    };
    if (!isDelivered) continue;
    const cost = join.tickets[id].costUsd;
    delivered++;
    deliveredCost += cost;
    add(byType, w.type, cost);
    add(bySprint, w.sprint, cost);
  }
  const rows = (m, key) => [...m].map(([k, b]) => ({ [key]: k, delivered: b.delivered, costUsd: b.costUsd }))
    .sort((a, z) => z.costUsd - a.costUsd || String(a[key] ?? '').localeCompare(String(z[key] ?? '')));
  return {
    ...base, conflicts: conflicted.size, delivered, deliveredCostUsd: deliveredCost,
    costPerDelivered: delivered ? deliveredCost / delivered : null, metric: METRIC_LABEL,
    tickets, byType: rows(byType, 'type'), bySprint: rows(bySprint, 'sprint'),
  };
}

// --- projections (every printed field is listed; nothing is spread) ----------------------------------------------
const bucketOut = (b) => ({ sessions: b.sessions, shared: b.shared, costUsd: b.costUsd, priced: b.priced, tokensOnly: b.tokensOnly, activeMin: b.activeMin, tokens: b.tokens });
const ticketOut = (t) => ({ ...bucketOut(t), firstAt: t.firstAt, lastAt: t.lastAt, prs: [...t.prs], mergedAt: t.mergedAt });
const prOut = (p) => ({ pr: p.pr, mergedAt: p.mergedAt, ids: [...p.ids], ...bucketOut(p) });
const mapOut = (o, f) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, f(o[k])]));
const trackerOut = (v) => (v === null ? null : {
  status: v.status, reason: v.reason, complete: v.complete,
  ...(v.status === 'available' ? {
    conflicts: v.conflicts, delivered: v.delivered, deliveredCostUsd: v.deliveredCostUsd, costPerDelivered: v.costPerDelivered, metric: v.metric,
    tickets: mapOut(v.tickets, (t) => ({ status: t.status, outcome: t.outcome, type: t.type, points: t.points, sprint: t.sprint })),
    byType: v.byType.map((r) => ({ type: r.type, delivered: r.delivered, costUsd: r.costUsd })),
    bySprint: v.bySprint.map((r) => ({ sprint: r.sprint, delivered: r.delivered, costUsd: r.costUsd })),
  } : {}),
});

function toJson(m) {
  return {
    window: { since: m.window.since == null ? null : new Date(m.window.since).toISOString(), until: new Date(m.window.until).toISOString() }, base: { ref: m.base.ref, shallow: m.base.shallow },
    prsSource: m.work.prs, prsReason: m.work.reason ?? null, coverage: m.work.coverage,
    conflicts: m.conflicts.count, undated: m.undated.sessions,
    tickets: mapOut(m.join.tickets, ticketOut), prs: mapOut(m.join.prs, prOut),
    unattributed: { tickets: bucketOut(m.join.unattributed.tickets), prs: bucketOut(m.join.unattributed.prs) },
    unmerged: bucketOut(m.join.unmerged),
    totals: { sessions: m.join.totals.sessions, costUsd: m.join.totals.costUsd, priced: m.join.totals.priced, tokensOnly: m.join.totals.tokensOnly,
      activeMin: m.join.totals.activeMin, mergedPrs: m.join.totals.mergedPrs, ticketsWithSpend: m.join.totals.ticketsWithSpend },
    trace: { tickets: m.join.trace.tickets, prs: m.join.trace.prs, totals: m.join.trace.totals, conserved: m.join.trace.conserved },
    receipts: m.tracker === null ? { status: m.configured ? 'not run' : 'not configured' } : trackerOut(m.tracker),
  };
}

// --- Markdown ----------------------------------------------------------------------------------------------------
const usd = (n) => `$${n.toFixed(2)}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const day = (iso) => { const t = parseInstant(iso); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '—'; };
const isoOf = (t) => (t == null ? '—' : new Date(t).toISOString());
const cell = (v) => (v === null || v === undefined || v === '' ? '—' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' '));
const sessionsCell = (b) => (b.shared > 0 ? `${b.sessions} (${b.shared} shared)` : String(b.sessions));
const costCell = (b) => (b.priced === 0 && b.tokensOnly > 0 ? '— (tokens-only)' : usd(b.costUsd));
const bucketText = (b) => `${usd(b.costUsd)} (${plural(b.sessions, 'session')}${b.tokensOnly ? `, ${b.tokensOnly} tokens-only` : ''})`;
const tableMd = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)];

function trackerLine(m) {
  const v = m.tracker;
  if (v === null) return m.configured ? 'tracker: configured, not run (pass --receipts)' : `tracker: ${NOT_CONFIGURED}`;
  if (v.status === 'not configured') return `tracker: ${NOT_CONFIGURED}`;
  if (v.status === 'unavailable') return `tracker: unavailable (${v.reason})`;
  return `tracker: available${v.complete ? '' : ` ${PARTIAL}`}`;
}

function toMarkdown(m) {
  const { join, work, base } = m;
  const v = m.tracker?.status === 'available' ? m.tracker : null;
  const out = ['# Delivery report', ''];
  out.push(base.ref ? `base: ${base.ref} (local, not fetched${base.shallow ? '; shallow history' : ''})` : 'base: none (no origin/HEAD, main or master)');
  out.push(`window: ${isoOf(m.window.since)} → ${isoOf(m.window.until)}`);
  out.push(`prs: ${work.prs}${work.reason ? ` (${work.reason})` : ''}`);
  out.push(`coverage: ${work.coverage}`);
  out.push(trackerLine(m));
  out.push(`conflicts: ${m.conflicts.count} (excluded from these totals: ${plural(m.conflicts.lines, 'line')}, ${m.conflicts.priced} priced; an exact rank tie with different payloads, spec 3.5)`);
  if (m.undated.sessions) out.push(`undated: ${plural(m.undated.sessions, 'session')} without endedAt (${m.undated.priced} priced) — outside every window`);

  const t = join.totals;
  out.push('', '## Totals', '',
    `- spend: ${usd(t.costUsd)} over ${plural(t.sessions, 'session')}`,
    `- priced / tokens-only: ${t.priced} / ${t.tokensOnly}`,
    `- merged PRs: ${t.mergedPrs}`,
    `- tickets with spend: ${t.ticketsWithSpend}`,
    `- unattributed (no ticket): ${bucketText(join.unattributed.tickets)}`,
    `- unattributed (no PR, on the base): ${bucketText(join.unattributed.prs)}`,
    `- in progress (unmerged): ${bucketText(join.unmerged)}`);
  if (v) {
    out.push(`- delivered tickets: ${v.delivered}`);
    out.push('', `cost per delivered ticket: ${v.costPerDelivered === null ? 'n/a (0 delivered)' : `${usd(v.costPerDelivered)} over ${v.delivered} delivered`} — ${METRIC_LABEL}${m.tracker.complete ? '' : ` ${PARTIAL}`}`);
  }

  const ids = Object.keys(join.tickets).sort((a, z) => join.tickets[z].costUsd - join.tickets[a].costUsd || (a < z ? -1 : a > z ? 1 : 0));
  const head = ['ticket', 'sessions', 'cost', 'active min', 'PRs', 'state', ...(v ? ['status', 'type', 'points', 'sprint'] : [])];
  out.push('', '## By ticket', '', ...tableMd(head, ids.map((id) => {
    const r = join.tickets[id];
    const s = v?.tickets[id];
    return [id, sessionsCell(r), costCell(r), Math.round(r.activeMin), r.prs.map((p) => `#${p}`).join(', '),
      r.mergedAt ? `merged ${day(r.mergedAt)}` : 'in progress', ...(v ? [s.status, s.type, s.points, s.sprint] : [])];
  })));

  const keys = Object.keys(join.prs).sort((a, z) => join.prs[z].costUsd - join.prs[a].costUsd || (parseInstant(join.prs[a].mergedAt) || 0) - (parseInstant(join.prs[z].mergedAt) || 0) || (a < z ? -1 : a > z ? 1 : 0));
  out.push('', '## By PR', '', ...tableMd(['PR', 'ids', 'cost', 'sessions', 'merged'], keys.map((k) => {
    const p = join.prs[k];
    return [p.pr === null ? '—' : `#${p.pr}`, p.ids.join(', '), costCell(p), sessionsCell(p), day(p.mergedAt)];
  })));

  if (v) {
    out.push('', '## By type', '', ...tableMd(['type', 'delivered', 'cost'], v.byType.map((r) => [r.type, r.delivered, usd(r.costUsd)])));
    out.push('', '## By sprint', '', ...tableMd(['sprint', 'delivered', 'cost'], v.bySprint.map((r) => [r.sprint, r.delivered, usd(r.costUsd)])));
  }
  out.push('', '## Notes', '', ...NOTES.map((n) => `- ${n}`));
  return out.join('\n');
}

// --- main --------------------------------------------------------------------------------------------------------
const USAGE = 'usage: delivery-report.mjs [repo] [--since D] [--until D] [--prs auto|gh|az|none] [--receipts] [--json] [--out F]';

export async function main(argv = process.argv.slice(2)) {
  const flags = new Map();
  const roots = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--receipts') flags.set(a.slice(2), true);
    else if (a === '--since' || a === '--until' || a === '--out' || a === '--prs') {
      if (i + 1 >= argv.length) { process.stderr.write(`delivery-report: ${a} needs a value\n${USAGE}\n`); return 2; }
      flags.set(a.slice(2), argv[++i]);
    } else if (a.startsWith('--')) { process.stderr.write(`delivery-report: unknown flag ${a}\n${USAGE}\n`); return 2; }
    else roots.push(resolve(a));
  }
  if (roots.length > 1) { process.stderr.write(`delivery-report: one repo at a time\n${USAGE}\n`); return 2; }
  const repo = roots[0] ?? process.cwd();
  // activation (D-ACT, R19): --out writes; an inert or refused copy says why and exits 1 before the settings load.
  if (!gateCli(ENGINE_ROOT, repo, { writes: flags.has('out') })) return 1;
  const settings = loadSettings(repo);
  const prs = flags.get('prs') ?? 'auto';
  if (!PRS_MODES.includes(prs)) { process.stderr.write(`delivery-report: --prs must be one of ${PRS_MODES.join(', ')}\n`); return 2; }
  for (const k of ['since', 'until']) {
    if (flags.has(k) && Number.isNaN(parseInstant(flags.get(k)))) { process.stderr.write(`delivery-report: --${k} '${flags.get(k)}' is not an ISO-8601 date (YYYY-MM-DD) or date-time; a date-time without an offset is read as UTC\n`); return 2; }
  }

  // team-report's read pipeline: every tied line of a conflict goes through the window like the winners; a conflict
  // in scope (any line in the window, or undated) is counted and excluded, never split into two priced sessions.
  const rc = dedupConflicts(loadLines([repo], settings));
  const conflictLines = new Set(rc.conflicts.flatMap((c) => c.lines));
  const win = reportWindow([...rc.winners, ...conflictLines], flags.get('since'), flags.get('until'));
  const lines = win.lines.filter((l) => !conflictLines.has(l));
  const scoped = rc.conflicts.filter((c) => c.lines.some((l) => win.inWindow(parseInstant(l.endedAt)) || !Number.isFinite(parseInstant(l.endedAt))));
  const undated = win.undated.filter((l) => !conflictLines.has(l));

  const base = defaultBranch(repo);
  const work = mergedWork(repo, { settings, prs });
  const items = work.items.filter((it) => win.inWindow(parseInstant(it.at)));
  const join = joinDelivery(lines, items, { base: base.name });
  const configured = Array.isArray(settings.receipts?.command) && settings.receipts.command.length > 0;
  const run = flags.get('receipts') ? runReceiptCommand(repo, settings, { env: process.env }) : null;

  const model = {
    window: { since: win.since, until: win.until },
    base, work, join, configured,
    conflicts: { count: scoped.length, lines: scoped.reduce((a, c) => a + c.lines.length, 0), priced: scoped.reduce((a, c) => a + c.lines.filter(isPriced).length, 0) },
    undated: { sessions: undated.length, priced: undated.filter(isPriced).length },
    tracker: trackerView(run, join, settings.receipts.deliveredOutcomes),
  };
  const output = flags.get('json') ? JSON.stringify(toJson(model), null, 2) : toMarkdown(model);
  if (flags.get('out')) writeFileSync(flags.get('out'), `${output}\n`);
  else process.stdout.write(`${output}\n`);
  return 0;
}

const entryOn = entryPointsOn(ENGINE_ROOT); // realpath main guard, exit after stdio drains
if (entryOn ? isMain(import.meta.url) : (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const code = await main();
  if (entryOn) await exitAfterDrain(code); else process.exit(code);
}
