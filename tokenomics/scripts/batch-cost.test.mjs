import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildBatchCost as buildBatchCost0, classify as classify0, matchIds, namesToken, lineMatchesBatch, sharedDispatchCounts, updateBatchCosts as updateBatchCosts0, loadReceipts } from './batch-cost.mjs';
import * as ta from '../extensions/test-automation.mjs';
import { renderBatchMarkdown, renderBatchHtml, renderBatchTokenomicsMarkdown, renderBatchTokenomicsHtml } from './team-report.mjs';
import { TA_DEFAULTS, loadSettings } from '../engine/config.mjs';

// B2: the pre-existing tests below pin the reference (substring) behaviour, so this file runs under
// TOKENOMICS_MIGRATIONS=none unless a test says otherwise through `under`.
process.env.TOKENOMICS_MIGRATIONS = 'none';
const under = (mig, fn) => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = mig;
  try { return fn(); } finally { process.env.TOKENOMICS_MIGRATIONS = was; }
};

// B1 Task 10: the TA behaviour these reference tests assert lives in the TA extension now —
// every engine entry point here runs with it, as the TA configuration's entry points do.
const buildBatchCost = (slug, receipt, lines, opts = {}) => buildBatchCost0(slug, receipt, lines, { ext: ta, ...opts });
const classify = (label, ids, declared = []) => classify0(label, ids, declared, ta);
const updateBatchCosts = (repo, opts) => updateBatchCosts0(repo, opts, undefined, ta);
// The gate-record readers (loadGateRuns / declaredOutcomesFor / crossCheck) run inside the TA
// enrichGroup 'records' phase: these tests feed it the same inputs through files + scopes.
const records = (receipt, { dir = null, repo = null, slug = receipt.batch, scopes = [] } = {}) =>
  ta.enrichGroup(receipt, { phase: 'records', repo, settings: TA_DEFAULTS, slug, dir, scopes }).records;
const gateDir = (runs) => {
  const dir = mkdtempSync(join(tmpdir(), 'bc-gate-'));
  writeFileSync(join(dir, 'gate-runs.jsonl'), runs.map((r) => `${JSON.stringify(r)}\n`).join(''));
  return dir;
};
// foldGateRuns is the TA onClose hook's fold (no phase); it returns the folded line count.
const foldGateRuns = (repo, slug, dir) => ta.onClose({ batch: slug }, { repo, settings: TA_DEFAULTS, dir });
// The export's domain fields are the TA extension's exportRow phases: run the exporter with it.
const taExport = async () => {
  const x = await import('./build-tokenomics-export.mjs');
  return {
    ...x,
    buildSegment: (profile, cost) => x.buildSegment(profile, cost, ta),
    buildRunRow: (cost, profile) => x.buildRunRow(cost, profile, ta),
    checklist: (segment, row) => x.checklist(segment, row, ta),
    appendRun: (repo, cost, profile) => x.appendRun(repo, cost, profile, undefined, ta),
    anonymizeDoc: (doc) => x.anonymizeDoc(doc, ta),
    renderCompare: (a, b) => x.renderCompare(a, b, undefined, ta),
  };
};
const declaring = (batch, declared) => [{ session: 's', batch, cases: [], updatedAt: 'x', outcomes: declared }];

const sub = (label, tokens, { costUsd, activeMin = 1, role = 'test-automation-engineer' } = {}) => ({
  role, label, n: 1,
  tokens: { input: 0, output: 0, cacheRead: tokens, cacheWrite: 0 },
  activeMin, toolCalls: 1, toolErrors: 0,
  ...(costUsd != null ? { costUsd } : {}),
});
const line = (id, subs, { costUsd = null, cases = [], branch = 'main', host = 'claude' } = {}) => ({
  v: 1, host, id, user: 'u1', repo: 'r', branch, role: 'test-automation-lead',
  endedAt: '2026-08-10T10:00:00Z', capturedAt: '2026-08-10T10:01:00Z',
  activeMin: 10 + subs.reduce((n, s) => n + s.activeMin, 0),
  tokens: { input: 5, output: 100, cacheRead: 1000, cacheWrite: 50 },
  costUsd, costSource: costUsd != null ? 'ccusage-metered' : 'none',
  cases, subagents: subs, skills: [], dispatches: subs.length, turns: 5, toolCalls: 9, toolErrors: 0,
});
const RECEIPT = {
  batch: 'b1', integration_branch: 'tests/batch-b1',
  gate: { verdict: 'green', runs: 3 },
  cases: [
    { id: 'TC-101', outcome: 'automated', findings: [{}, {}], branch: 'tests/101-x' },
    { id: 'TC-102', outcome: 'automated', findings: [], branch: 'tests/102-y' },
    { id: 'CASE_9', outcome: 'blocked', findings: [{}], branch: null },
  ],
};

// Receipt-driven matching must work for ANY id shape the source system uses —
// never a hardcoded Jira regex.
test('matchIds: id-shape-agnostic, case-insensitive substring against the label', () => {
  assert.deepEqual(matchIds('analyst:tc-101+CASE_9 live pass', ['TC-101', 'TC-102', 'CASE_9']), ['TC-101', 'CASE_9']);
  assert.deepEqual(matchIds('', ['TC-101']), []);
});

// Triage enumerates EVERY case id and the gate names the batch — id matching
// alone would smear batch work across all cases as "direct". Stage wins first.
test('classify: stage classification precedes id matching', () => {
  assert.equal(classify('Triage the batch: TC-101, TC-102, CASE_9', ['TC-101', 'TC-102', 'CASE_9']).kind, 'overhead');
  assert.equal(classify('Hardening gate for batch b1 — TC-101 TC-102', ['TC-101']).kind, 'overhead');
  assert.equal(classify('report:b1 write the report', ['TC-101']).kind, 'overhead');
  // merge is PER-UNIT work in this pipeline — direct when it names its ids
  assert.deepEqual(classify('merge:TC-101 back into the trunk', ['TC-101']), { kind: 'direct', ids: ['TC-101'] });
  assert.deepEqual(classify('implement:TC-102', ['TC-101', 'TC-102']), { kind: 'direct', ids: ['TC-102'] });
  assert.equal(classify('sync base branches', ['TC-101']).kind, 'overhead'); // unmatched, not a stage
});

// FIELD BUG: every reviewer prompt says "(do not execute the spec; the
// hardening gate does that)", so matching stage words anywhere in the label
// booked all six reviewers of a real batch as GATE overhead — $4.31 moved off
// the cases. A dispatch's own stage is always at the FRONT of its label
// (deriveLabel slices from it); the rest merely mentions other stages.
test('classify: a stage MENTIONED later in the label is not the dispatch stage', () => {
  const ids = ['TC-004'];
  const reviewer = "Reviewer slot — STATIC review of TC-004 per the test-automation-workflow skill's references/reviewer-contract.md (do not execute the spec; the hardening gate do";
  assert.deepEqual(classify(reviewer, ids), { kind: 'direct', ids: ['TC-004'] }, 'reviewer work belongs to its case');
  // the real gate still reads as overhead
  assert.equal(classify('Hardening gate for batch smoke-remaining. You did not write this code', ids).kind, 'overhead');
  assert.equal(classify('Triage slot — a READ-ONLY routing decision: no git, no browser', ids).kind, 'overhead');
  assert.equal(classify('report writer — the single disk write of this run.', ids).kind, 'overhead');
  // an implementer that merely mentions the gate stays with its case
  assert.deepEqual(classify('Implementer slot — implement TC-004; the hardening gate proves it later', ids).ids, ['TC-004']);
});

test('buildBatchCost: direct per case, cluster split, overhead separated, stats over measured values', () => {
  const lines = [
    line('s1', [
      sub('Triage the batch: TC-101 TC-102 CASE_9', 10_000, { costUsd: 0.10 }),
      sub('analyst:TC-101+TC-102 cluster', 100_000, { costUsd: 1.00, activeMin: 10, role: 'qa-engineer' }),   // splits 50/50
      sub('implement:TC-101', 200_000, { costUsd: 2.00, activeMin: 20 }),
      sub('review:TC-101', 50_000, { costUsd: 0.50, activeMin: 5, role: 'qa-engineer' }),
      sub('fix:TC-101:1 round', 30_000, { costUsd: 0.30, activeMin: 3 }),
      sub('implement:TC-102', 150_000, { costUsd: 1.50, activeMin: 15 }),
      sub('Hardening gate for batch b1', 80_000, { costUsd: 0.80, activeMin: 8 }),
    ], { costUsd: 8.20 }), // parent share = 8.20 − 6.20 = 2.00
  ];
  const c = buildBatchCost('b1', RECEIPT, lines);

  const tc101 = c.cases.find((x) => x.id === 'TC-101');
  assert.equal(tc101.direct.costUsd, 3.30);            // 0.50 analyst-half + 2.00 + 0.50 + 0.30
  assert.equal(tc101.direct.fixRounds, 1);
  assert.equal(tc101.findings, 2);
  const tc102 = c.cases.find((x) => x.id === 'TC-102');
  assert.equal(tc102.direct.costUsd, 2.00);            // 0.50 analyst-half + 1.50
  assert.deepEqual(c.coverage.casesUnattributed, ['CASE_9']);

  // Overhead: lead remainder 2.00 + triage 0.10 + gate 0.80 — visible once.
  assert.equal(c.overhead.lead.costUsd, 2.00);
  assert.equal(c.overhead.stages.costUsd, 0.90);
  assert.equal(c.overhead.costUsd, 2.90);
  assert.equal(c.totals.costUsd, 8.20);

  // Fully loaded = direct + even overhead share (2.90 / 3 cases ≈ 0.97 each) —
  // an allocation, labelled; the unattributed case carries only its share.
  assert.equal(tc101.loaded.costUsd, 4.27);                    // 3.30 + 0.9667
  assert.equal(c.cases.find((x) => x.id === 'CASE_9').loaded.costUsd, 0.97);
  assert.equal(c.stats.loadedCostUsd.n, 3, 'loaded stats run over ALL cases, not just attributed');

  // delivered = automated only here (no sanctioned-red): 2
  assert.equal(c.delivered, 2);
  assert.equal(c.averages.totalPerDelivered.costUsd, 4.10);
  assert.equal(c.averages.directPerCase.costUsd, 2.65);        // (3.30 + 2.00) / 2
  assert.deepEqual(
    { min: c.stats.directCostUsd.min, max: c.stats.directCostUsd.max, median: c.stats.directCostUsd.median },
    { min: 2.00, max: 3.30, median: 2.65 },
  );
  assert.equal(c.gate.verdict, 'green');
});

// Copilot: no per-dispatch dollars exist — per-case rows carry tokens/time,
// dollars appear ONLY at batch level from the billed figure.
test('buildBatchCost: Copilot lines — per-case dollars null, batch dollars from billed credits', () => {
  const lines = [
    line('cp1', [
      sub('analyst:TC-101', 40_000, { activeMin: 4 }),
      sub('implement:TC-101', 90_000, { activeMin: 9 }),
    ], { costUsd: 3.00, host: 'copilot' }),
  ];
  const c = buildBatchCost('b1', RECEIPT, lines);
  const tc101 = c.cases.find((x) => x.id === 'TC-101');
  assert.equal(tc101.direct.costUsd, null);
  assert.equal(tc101.direct.tokens, 130_000);
  assert.equal(c.totals.costUsd, 3.00);
  assert.equal(c.stats.directCostUsd, null, 'no per-dispatch dollars → no dollar stats');
  assert.ok(c.stats.directTokens, 'token stats still computed');
  assert.equal(c.averages.totalPerDelivered.costUsd, 1.50);
  assert.equal(c.averages.directPerCase, null);
});

// A batch spans sessions and a session can touch several batches — membership
// is by slug/id/branch appearing in the line's naming surfaces.
test('lineMatchesBatch: matches by slug, receipt id, or branch — and rejects unrelated lines', () => {
  const scope = { slug: 'b1', ids: ['TC-101'], branches: ['tests/batch-b1'] };
  assert.ok(lineMatchesBatch(line('a', [sub('implement:TC-101', 1)]), scope));
  assert.ok(lineMatchesBatch(line('b', [], { branch: 'tests/batch-b1' }), scope));
  assert.ok(lineMatchesBatch(line('c', [], { cases: ['TC-101'] }), scope));
  assert.ok(!lineMatchesBatch(line('d', [sub('implement:OTHER-9', 1)], { branch: 'main' }), scope));
});

// A workflow dispatch's prompt opens with boilerplate; when the case id sits
// past the label's 160-char window, the capture's transcript-mined ids (the
// entry's `cases`) are the fallback — measured at 11.6% of real dispatches.
test('classify: transcript-mined ids rescue a dispatch whose label missed the id', () => {
  const ids = ['TC-101', 'TC-102'];
  // label carries no id; the transcript did
  assert.deepEqual(classify('stabilize workflow. If your role memory / project briefing …', ids, ['TC-101']),
    { kind: 'direct', ids: ['TC-101'] });
  // named overhead stage stays overhead even when its transcript names ids
  assert.equal(classify('Hardening gate for batch b1', ids, ['TC-101', 'TC-102']).kind, 'overhead');
  // mined ids outside the receipt never attribute — still receipt-driven
  assert.equal(classify('stabilize workflow round', ids, ['OTHER-9']).kind, 'overhead');
  // label match wins over the fallback (no double counting, label is primary)
  assert.deepEqual(classify('implement:TC-102', ids, ['TC-101']).ids, ['TC-102']);
});

// Campaigns nest wave receipts at <batch>/<wave>/report.json — a one-level
// scan silently skipped them (the same under-count efficiency-audit's
// run-reports.mjs was field-flagged for, twice, before its own fix).
test('loadReceipts: discovers nested wave receipts; --batch selects a campaign by top slug', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc3-'));
  const auto = join(repo, '.agents', 'automation');
  const mk = (rel, receipt) => {
    const d = join(auto, ...rel.split('/'));
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'report.json'), JSON.stringify(receipt));
  };
  mk('top10', { batch: 'top10', cases: [{ id: 'TC-1', outcome: 'automated' }] });
  mk('camp/heads', { batch: 'camp', cases: [{ id: 'TC-2', outcome: 'blocked' }] });
  mk('camp/wave-01', { batch: 'camp', cases: [{ id: 'TC-3', outcome: 'automated' }] });
  // non-receipt JSON in the tree is ignored (e.g. _returns receipts)
  mkdirSync(join(auto, '_returns', 'wf_x'), { recursive: true });
  writeFileSync(join(auto, '_returns', 'wf_x', 'a1.json'), '{"result":{}}');

  const all = loadReceipts(repo);
  assert.deepEqual(all.map((r) => r.slug), ['camp/heads', 'camp/wave-01', 'top10']);
  assert.deepEqual(loadReceipts(repo, { batch: 'camp' }).map((r) => r.slug), ['camp/heads', 'camp/wave-01']);
  assert.deepEqual(loadReceipts(repo, { batch: 'camp/wave-01' }).map((r) => r.slug), ['camp/wave-01']);
  assert.deepEqual(loadReceipts(repo, { batch: 'top10' }).map((r) => r.slug), ['top10']);
});

// A nested wave's path slug never appears in a branch name — the receipt's own
// `batch` field must also anchor session membership.
test('lineMatchesBatch: accepts a slug list (nested wave path + receipt batch name)', () => {
  const l = line('s1', [sub('implement:something', 1)], { branch: 'tests/batch-camp-w1' });
  assert.ok(!lineMatchesBatch(l, { slug: ['camp/wave-01'], ids: [], branches: [] }));
  assert.ok(lineMatchesBatch(l, { slug: ['camp/wave-01', 'camp'], ids: [], branches: [] }));
  // and a line whose only naming surface is a sub-agent's mined cases
  const l2 = line('s2', [{ ...sub('stabilize workflow …', 1), cases: ['TC-101'] }]);
  assert.ok(lineMatchesBatch(l2, { slug: 'b1', ids: ['TC-101'], branches: [] }));
});

// End-to-end: the fallback attributes dollars to the case the label missed.
test('buildBatchCost: sub-agent `cases` fallback attributes work the label window lost', () => {
  const stabilize = { ...sub('stabilize workflow. If your role memory …', 40_000, { costUsd: 0.40, activeMin: 4 }), cases: ['TC-101'] };
  const c = buildBatchCost('b1', RECEIPT, [line('s1', [stabilize], { costUsd: 1.00 })]);
  assert.equal(c.cases.find((x) => x.id === 'TC-101').direct.costUsd, 0.40);
  assert.ok(!c.coverage.casesUnattributed.includes('TC-101'));
});

// A lead session serving SEVERAL batches (a campaign running waves in one
// session) must not be double-counted: each batch excludes the other's
// dispatches and takes an even share of the session-level figures. Without
// `others` every batch used to claim the WHOLE session.
test('multi-batch session: foreign dispatches excluded, session-level figures split', () => {
  const receiptA = { batch: 'wA', integration_branch: 'tests/batch-wA', cases: [{ id: 'A-1', outcome: 'automated', branch: 'tests/A-1-x' }] };
  const receiptB = { batch: 'wB', integration_branch: 'tests/batch-wB', cases: [{ id: 'B-1', outcome: 'automated', branch: 'tests/B-1-y' }] };
  const sharedLine = line('s-camp', [
    sub('implement:A-1', 100_000, { costUsd: 2.00, activeMin: 20 }),
    sub('implement:B-1', 100_000, { costUsd: 3.00, activeMin: 30 }),
    sub('Hardening gate for batch wA', 50_000, { costUsd: 0.50, activeMin: 5 }),
    sub('Hardening gate for batch wB', 50_000, { costUsd: 0.70, activeMin: 7 }),
    sub('sync base branches', 10_000, { costUsd: 0.20, activeMin: 2 }), // neutral — split evenly
  ], { costUsd: 8.40, branch: 'tests/batch-wA' }); // parent remainder = 8.40 − 6.40 = 2.00
  const idOf = (r, slug) => ({ keys: [slug, r.batch], ids: r.cases.map((c) => c.id), branches: [r.integration_branch, ...r.cases.map((c) => c.branch)].filter(Boolean) });

  const a = buildBatchCost('wA', receiptA, [sharedLine], { others: [idOf(receiptB, 'wB')] });
  const b = buildBatchCost('wB', receiptB, [sharedLine], { others: [idOf(receiptA, 'wA')] });

  // A: its implement 2.00 + its gate 0.50 + neutral/2 0.10 + parent/2 1.00 = 3.60
  assert.equal(a.totals.costUsd, 3.60);
  // B: 3.00 + 0.70 + 0.10 + 1.00 = 4.80
  assert.equal(b.totals.costUsd, 4.80);
  // together they cover the session exactly once — no double count
  assert.equal(round2(a.totals.costUsd + b.totals.costUsd), 8.40);
  // the other batch's work never lands in my overhead
  assert.equal(a.sources.foreignDispatchesExcluded, 2, 'B implement + B gate excluded from A');
  assert.equal(a.sources.sharedSessions, 1);
  assert.equal(a.cases[0].direct.costUsd, 2.00, 'per-case direct unchanged');
  assert.equal(b.cases[0].direct.costUsd, 3.00);
  // and without `others` the old inflation is visible (documents the fix)
  const naive = buildBatchCost('wA', receiptA, [sharedLine]);
  assert.equal(naive.totals.costUsd, 8.40, 'no others info → whole session counted (single-batch behavior)');
});
const round2 = (v) => Math.round(v * 100) / 100;

// Telemetry rides every layer now: totals, roles, per-case, stage split, rework.
test('telemetry + stage split + rework land in cost.json', () => {
  const lines = [line('s1', [
    sub('Triage the batch: TC-101 TC-102', 10_000, { costUsd: 0.10, activeMin: 2 }),
    sub('implement:TC-101', 200_000, { costUsd: 2.00, activeMin: 20 }),
    sub('fix:TC-101:1 round', 30_000, { costUsd: 0.30, activeMin: 16 }),
    sub('Hardening gate for batch b1', 80_000, { costUsd: 0.80, activeMin: 8 }),
    sub('report:b1 write the report', 5_000, { costUsd: 0.05, activeMin: 1 }),
  ], { costUsd: 4.25 })];
  const c = buildBatchCost('b1', RECEIPT, lines);
  assert.ok(c.totals.toolCalls > 0);
  assert.equal(c.totals.turns, 5, 'parent turns counted');
  assert.deepEqual(Object.keys(c.overhead.byStage).sort(), ['gate', 'report', 'triage']);
  assert.equal(c.overhead.byStage.gate.costUsd, 0.80);
  assert.equal(c.rework.costUsd, 0.30, 'fix-round spend surfaced as its own lever');
  assert.equal(c.rework.dispatches, 1);
  const tc101 = c.cases.find((x) => x.id === 'TC-101');
  assert.ok(tc101.direct.toolCalls > 0, 'per-case tool calls');
  assert.ok(c.byRole['test-automation-engineer'].toolCalls > 0, 'role tool calls');
});

// Live batch view without ledger bloat: the per-dispatch deltas are stored,
// the session snapshot is REBUILT from them on demand — so cost.json is
// current mid-run while the ledger still gets exactly one line per session.
test('loadLiveLines: rebuilds a provisional session line from the dispatch deltas', async () => {
  const { loadLiveLines } = await import('./batch-cost.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'bc-live-'));
  const dir = join(repo, '.agents', 'telemetry', 'automation', 'live');
  mkdirSync(dir, { recursive: true });
  const rec = (agentId, costUsd, cases, bytes) => JSON.stringify({
    v: 1, session: 'run-1', agentId, role: 'qa-engineer', label: `analyse ${cases[0]}`,
    cases, tokens: { input: 0, output: 0, cacheRead: 1000, cacheWrite: 0 },
    activeMin: 5, toolCalls: 7, toolErrors: 0, costUsd, endedAt: '2026-08-14T10:00:00Z', bytes,
  });
  writeFileSync(join(dir, 'run-1.jsonl'), [
    rec('a1', 1.5, ['TC-101'], 10),
    rec('a2', 2.5, ['TC-102'], 10),
    rec('a1', 1.75, ['TC-101'], 20),        // a1 grew — superseding delta
  ].join('\n') + '\n');

  const [line] = loadLiveLines(repo);
  assert.equal(line.live, true);
  assert.equal(line.id, 'run-1');
  assert.equal(line.subagents.length, 2, 'latest delta per dispatch, not one row per append');
  assert.equal(line.costUsd, 4.25, 'sum of the CURRENT dispatch dollars (1.75 + 2.50)');
  assert.deepEqual(line.cases, ['TC-101', 'TC-102']);
  assert.deepEqual(line.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 'the lead thread is NOT claimed — it has not been measured');
});

test('updateBatchCosts: a running session shows up as provisional, and the real line always wins', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-live2-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const live = join(repo, '.agents', 'telemetry', 'automation', 'live');
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, 'run-1.jsonl'),
    `${JSON.stringify({ v: 1, session: 'run-1', agentId: 'a1', role: 'test-automation-engineer', label: 'implement:TC-101', cases: ['TC-101'], tokens: { input: 0, output: 0, cacheRead: 9000, cacheWrite: 0 }, activeMin: 4, toolCalls: 6, toolErrors: 0, costUsd: 1.25, bytes: 9 })}\n`);

  const [mid] = updateBatchCosts(repo, { write: false });
  assert.equal(mid.sources.liveSessions, 1);
  assert.match(mid.sources.liveNote, /PROVISIONAL/);
  assert.equal(mid.cases.find((c) => c.id === 'TC-101').direct.costUsd, 1.25, 'mid-run per-case cost is real');

  // the session ends: its ledger line (with the lead thread) must win outright
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  writeFileSync(join(tele, 'usage-u1.jsonl'),
    `${JSON.stringify(line('run-1', [sub('implement:TC-101', 9000, { costUsd: 1.25 })], { costUsd: 3.0 }))}\n`);
  const [after] = updateBatchCosts(repo, { write: false });
  assert.ok(!after.sources.liveSessions, 'no longer provisional');
  assert.equal(after.totals.costUsd, 3.0, 'the full session total, incl. the lead thread');
});

// A period rollup's totals come straight from the ledger, so its batch/case
// tables must not mix in provisional rows — one document, one basis.
test('updateBatchCosts: live:false excludes running sessions (the period-rollup basis)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-live3-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const live = join(repo, '.agents', 'telemetry', 'automation', 'live');
  mkdirSync(live, { recursive: true });
  writeFileSync(join(live, 'run-9.jsonl'),
    `${JSON.stringify({ v: 1, session: 'run-9', agentId: 'a1', role: 'qa-engineer', label: 'implement:TC-101', cases: ['TC-101'], tokens: { input: 0, output: 0, cacheRead: 500, cacheWrite: 0 }, activeMin: 2, toolCalls: 3, toolErrors: 0, costUsd: 0.9, bytes: 5 })}\n`);
  assert.equal(updateBatchCosts(repo, { write: false })[0].sources.liveSessions, 1, 'batch view: live');
  const rollup = updateBatchCosts(repo, { write: false, live: false })[0];
  assert.ok(!rollup.sources.liveSessions, 'period rollup: ledger-only');
  assert.equal(rollup.totals.costUsd, null, 'nothing measured yet from the ledger alone');
});

// The records layer: script-authored gate verdicts + declared outcomes are
// cross-checked against the receipt. Drift is the write-back failure class
// made visible (measured: 38/69 delivered cases scored unproven because a
// recovered gate's verdict never reached report.json).
test('crossCheck: gate drift and outcome drift vs the receipt; records never overwrite', () => {
  const receipt = {
    batch: 'b1', gate: { verdict: 'not-run' },
    cases: [{ id: 'TC-101', outcome: 'merged-ungated' }, { id: 'TC-102', outcome: 'automated' }],
  };
  const gateRuns = [
    { at: '2026-08-12T10:00:00Z', verdict: 'red', consecutiveGreen: 1 },
    { at: '2026-08-12T11:00:00Z', verdict: 'green', consecutiveGreen: 3 },
  ];
  const declared = { 'TC-101': 'automated', 'TC-102': 'automated' };
  const { gateDrift, outcomeDrift } = records(receipt, { dir: gateDir(gateRuns), scopes: declaring('b1', declared) });
  assert.deepEqual(gateDrift, { receipt: 'not-run', recorded: 'green', at: '2026-08-12T11:00:00Z' }, 'latest record wins');
  assert.deepEqual(outcomeDrift, [{ id: 'TC-101', receipt: 'merged-ungated', declared: 'automated' }], 'agreeing cases are not drift');
  // receipt and records agreeing → silence (no drift keys in cost.records)
  const clean = records({ batch: 'b1', gate: { verdict: 'green' }, cases: [{ id: 'TC-102', outcome: 'automated' }] },
    { dir: gateDir([gateRuns[1]]), scopes: declaring('b1', { 'TC-102': 'automated' }) });
  assert.equal(clean.gateDrift, undefined);
  assert.equal(clean.outcomeDrift, undefined);
});

test('declaredOutcomesFor: matches scopes by batch name or case overlap, latest updatedAt wins', () => {
  const receipt = { batch: 'b1', cases: [{ id: 'TC-101' }, { id: 'TC-102' }] };
  const scopes = [
    { session: 's1', batch: 'b1', cases: ['TC-101'], updatedAt: '2026-08-12T10:00:00Z', outcomes: { 'TC-101': { outcome: 'blocked' } } },
    { session: 's2', cases: ['TC-101'], updatedAt: '2026-08-12T12:00:00Z', outcomes: { 'TC-101': { outcome: 'automated' } } }, // matched by case overlap
    { session: 's3', batch: 'other', cases: ['ZZZ-9'], updatedAt: '2026-08-12T13:00:00Z', outcomes: { 'TC-102': { outcome: 'blocked' } } }, // unrelated scope — no match surface
  ];
  const out = records(receipt, { slug: 'b1', scopes }).declaredOutcomes;
  assert.deepEqual(out, { 'TC-101': 'automated' }, 'later declaration wins; unrelated scope ignored');
  // nested wave slug matches by its last segment
  assert.deepEqual(records({ batch: 'camp', cases: [{ id: 'TC-9' }] }, { slug: 'camp/wave-01',
    scopes: [{ session: 'w', batch: 'wave-01', cases: [], updatedAt: 'x', outcomes: { 'TC-9': { outcome: 'automated' } } }] }).declaredOutcomes,
    { 'TC-9': 'automated' });
});

test('updateBatchCosts: gate-runs + scopes land in cost.json as records with drift flags', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc4-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    ...RECEIPT, gate: { verdict: 'not-run' },
    cases: RECEIPT.cases.map((c) => (c.id === 'TC-101' ? { ...c, outcome: 'merged-ungated' } : c)),
  }));
  writeFileSync(join(dir, 'gate-runs.jsonl'),
    `${JSON.stringify({ at: '2026-08-12T11:00:00Z', branch: 'tests/batch-b1', base: 'main', n: 3, verdict: 'green', consecutiveGreen: 3, seconds: [1, 1, 1] })}\n`);
  const scopesDir = join(repo, '.agents', 'telemetry', 'automation', 'scopes');
  mkdirSync(scopesDir, { recursive: true });
  writeFileSync(join(scopesDir, 'sess-1.json'), JSON.stringify({
    v: 1, session: 'sess-1', intent: 'automation', batch: 'b1', cases: ['TC-101'],
    declaredAt: 'x', updatedAt: 'y', outcomes: { 'TC-101': { outcome: 'automated', at: 'y' } },
  }));
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'telemetry', 'automation', 'usage-u1.jsonl'),
    `${JSON.stringify(line('s1', [sub('implement:TC-101', 9000, { costUsd: 1.0 })], { costUsd: 2.0 }))}\n`);

  const [c] = updateBatchCosts(repo);
  assert.equal(c.records.gateRuns.latest.verdict, 'green');
  assert.deepEqual(c.records.gateDrift, { receipt: 'not-run', recorded: 'green', at: '2026-08-12T11:00:00Z' });
  assert.deepEqual(c.records.outcomeDrift, [{ id: 'TC-101', receipt: 'merged-ungated', declared: 'automated' }]);
  assert.deepEqual(c.records.declaredOutcomes, { 'TC-101': 'automated' });
  const onDisk = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
  assert.ok(onDisk.records.gateDrift, 'drift persisted for the next reader');
  // loadGateRuns tolerates absence (no gate runs, nothing declared → no records)
  assert.equal(records({ batch: 'b1', cases: [] }, { dir: join(repo, 'nowhere') }), undefined);
});

// Mid-run verdicts land on the telemetry side (they must not dirty the main
// tree); close folds them into the batch dir. The reader sees ONE merged,
// deduplicated, chronological record wherever each line currently lives.
test('loadGateRuns reads both homes and dedups; foldGateRuns moves telemetry lines into the batch dir', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-fold-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  const telRuns = join(repo, '.agents', 'telemetry', 'automation', 'gate-runs');
  mkdirSync(dir, { recursive: true });
  mkdirSync(telRuns, { recursive: true });
  const r1 = JSON.stringify({ at: '2026-08-14T10:00:00Z', branch: 'tests/batch-b1', verdict: 'red' });
  const r2 = JSON.stringify({ at: '2026-08-14T11:00:00Z', branch: 'tests/batch-b1', verdict: 'green' });
  writeFileSync(join(dir, 'gate-runs.jsonl'), `${r1}\n`);
  writeFileSync(join(telRuns, 'b1.jsonl'), `${r1}\n${r2}\n`); // r1 duplicated on both sides
  const runs = records({ batch: 'b1', cases: [] }, { dir, repo, slug: 'b1' }).gateRuns;
  assert.equal(runs.count, 2, 'deduped across both homes');
  assert.deepEqual(runs.latest, { verdict: 'green', at: '2026-08-14T11:00:00Z', consecutiveGreen: 0 }, 'chronological: the latest record wins');
  assert.equal(foldGateRuns(repo, 'b1', dir), 1, 'only the missing line folds');
  assert.ok(!existsSync(join(telRuns, 'b1.jsonl')), 'telemetry side cleared after fold');
  const after = readFileSync(join(dir, 'gate-runs.jsonl'), 'utf8').trim().split('\n');
  assert.deepEqual(after, [r1, r2]);
  // idempotent: nothing left to fold
  assert.equal(foldGateRuns(repo, 'b1', dir), 0);
});

// The whole file is a pure derivation: same inputs → same output (modulo
// generatedAt), so the hook can recompute on every session end, latest-wins.
test('updateBatchCosts: writes cost.json next to the receipt, idempotent recompute', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(tele, { recursive: true });
  writeFileSync(join(tele, 'usage-u1.jsonl'), `${JSON.stringify(line('s1', [sub('implement:TC-101', 9000, { costUsd: 1.25 })], { costUsd: 2.0 }))}\n`);

  const [first] = updateBatchCosts(repo);
  const onDisk = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
  assert.equal(onDisk.cases.find((c) => c.id === 'TC-101').direct.costUsd, 1.25);
  const [second] = updateBatchCosts(repo);
  assert.deepEqual({ ...second, generatedAt: null }, { ...first, generatedAt: null });
});

// The team-report --batch path renders from the same recompute the hook runs —
// one source of truth, markdown for humans, cost.json for machines.
test('team-report --batch renders the cost view end-to-end', async () => {
  const { main: trMain } = await import('./team-report.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'bc2-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(tele, { recursive: true });
  writeFileSync(join(tele, 'usage-u1.jsonl'), `${JSON.stringify(line('s1', [
    sub('analyst:TC-101', 50_000, { costUsd: 0.60, activeMin: 6, role: 'qa-engineer' }),
    sub('implement:TC-101', 120_000, { costUsd: 1.40, activeMin: 12 }),
    sub('Hardening gate for batch b1', 60_000, { costUsd: 0.55, activeMin: 6 }),
  ], { costUsd: 4.00 }))}\n`);
  const outFile = join(repo, 'batch.md');
  assert.equal(await trMain(['--batch', 'b1', '--out', outFile, repo]), 0);
  const md = readFileSync(outFile, 'utf8');
  assert.match(md, /# Batch cost — b1/);
  assert.match(md, /delivered: 2/);
  assert.match(md, /Gate: green \(3 runs\)/);
  assert.match(md, /\| TC-101 \| automated \| \$2\.00 \|/);          // no sizing in this fixture -> no size column          // 0.60 + 1.40 direct
  assert.match(md, /Overhead .*: \$2\.00 \(50%\)/);                   // lead 1.45 + gate 0.55
  assert.match(md, /Per delivered case \(incl\. overhead\): \$2\.00/); // 4.00 / 2
  assert.match(md, /Unattributed .*: TC-102, CASE_9/);
  // and the machine artifact landed next to the receipt
  assert.ok(JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8')).v >= 1);
});

// Exporter v2 — schema 1.0 container {schema_version, segment, runs[]}: the
// segment header from the project-local profile, one ROW per work-item (our
// batch), measured figures only, §7 checklist instead of silent guessing.
test('export v2: segment+row per spec, checklist flags gaps, upsert never duplicates', async () => {
  const { buildSegment, buildRunRow, checklist, appendRun, anonymizeDoc, effortDaysToSize, costWeightedCacheShare, renderCompare } = await taExport();
  const c = buildBatchCost('b1', RECEIPT, [
    line('s1', [sub('implement:TC-101', 90_000, { costUsd: 1.40, activeMin: 12 })], { costUsd: 2.40 }),
  ]);
  const seg = buildSegment({ factory_id: 'proj-x-test-automation' }, c);
  assert.equal(seg.factory_id, 'proj-x-test-automation');
  assert.equal(seg.stop, 'testing');
  assert.equal(seg.work_item_level, 'feature');
  const row = buildRunRow(c, { factory_id: 'proj-x-test-automation' });
  assert.equal(row.work_item_ref, 'T-b1', 'telemetry cohort prefix when no tracker ref was threaded');
  assert.equal(row.scenarios_automated, 2);
  assert.equal(row.tokens.cache_read, 91_000); // 90k sub + 1k parent
  assert.ok(row.cache_read_share_pct > 0 && row.cache_read_share_pct <= 100, 'COST share, not the token share');
  const checks = checklist(seg, row);
  assert.ok(checks.missing.some((m) => m.includes('effort_days')), 'no sizing → flagged, never invented');
  assert.ok(checks.missing.some((m) => m.includes('env_setup')), 'seed-owned field flagged when absent');
  // effort→size bands per §3.1 spine
  assert.equal(effortDaysToSize(0.4), 'XS');
  assert.equal(effortDaysToSize(2.5), 'M');
  assert.equal(effortDaysToSize(30), 'XL');
  assert.equal(costWeightedCacheShare(null), null);
  // append: upsert by work_item_ref — a re-closed batch replaces its row
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const repo = mkdtempSync(join(tmpdir(), 'export-v2-'));
  const first = appendRun(repo, c, { factory_id: 'proj-x-test-automation' });
  assert.equal(first.replaced, false);
  const second = appendRun(repo, c, { factory_id: 'proj-x-test-automation' });
  assert.equal(second.replaced, true, 'latest close wins — never a duplicate row');
  const doc = JSON.parse(readFileSync(first.path, 'utf8'));
  assert.equal(doc.runs.length, 1);
  assert.equal(doc.schema_version, '1.0');
  // anonymisation: opaque refs + generic briefs (submission norm)
  const anon = anonymizeDoc(doc);
  assert.equal(anon.runs[0].work_item_ref, 'T-WI-001');
  assert.doesNotMatch(anon.runs[0].work_item_brief, /b1/);
  // compare renders both rows without throwing
  assert.match(renderCompare(c, c), /per delivered \(incl\. overhead\)/);
});

// The full token quad rides every bucket — the scalar sum hides that ~95% is
// cache-read at ~1/10 input price (a $16 batch read as "47.5M tokens"). The
// tokenomics view renders composition + hit rate from exactly these quads.
test('token quads ride byRole, overhead.lead and per-case direct buckets', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-tok-'));
  const dir = join(repo, '.agents', 'automation', 'b1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(RECEIPT));
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(tele, { recursive: true });
  const s1 = sub('implement:TC-101', 9000, { costUsd: 1.25 });
  s1.tokens = { input: 100, output: 400, cacheRead: 8000, cacheWrite: 500 };
  writeFileSync(join(tele, 'usage-u1.jsonl'), `${JSON.stringify(line('s1', [s1], { costUsd: 2.0 }))}\n`);
  const [c] = updateBatchCosts(repo);
  const role = c.byRole['test-automation-engineer'];
  assert.deepEqual(role.tok, { input: 100, output: 400, cacheRead: 8000, cacheWrite: 500 });
  const tc = c.cases.find((x) => x.id === 'TC-101');
  assert.equal(tc.direct.tok.output, 400, 'per-case direct carries the quad');
  assert.ok(c.overhead.lead.tok, 'lead bucket carries a quad too');
  assert.ok(c.totals.tokensSplit, 'batch-level split still present');
});

// Sizing join: pre-run predicted size (automation-scoping) vs the size class's
// cross-batch actuals. Flags are tokens/time ANALYSIS POINTERS — the scoping
// doctrine forbids per-case dollar verdicts (Spearman ~0.015 on 89 cases).
// B1 Task 10: loadSizings / sizeBaselines / applySizing run inside the TA enrichGroup 'sizing'
// phase — these tests give it the same inputs as files: the estimation scores under
// .agents/estimation and the size-class history as an earlier batch's cost.json.
const sizingRepo = (scores, history = []) => {
  const repo = mkdtempSync(join(tmpdir(), 'sizing-'));
  mkdirSync(join(repo, '.agents', 'estimation'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'estimation', 't.json'), JSON.stringify(scores));
  const hist = join(repo, '.agents', 'automation', 'hist');
  mkdirSync(hist, { recursive: true });
  writeFileSync(join(hist, 'cost.json'), JSON.stringify({ batch: 'hist', cases: history.map(([size, rw, min], i) => (
    { id: `H-${i}`, sizing: { size }, direct: { tok: { input: 0, output: rw, cacheRead: 0, cacheWrite: 0 }, activeMin: min } })) }));
  return repo;
};
const sizing = (repo, cases) => ta.enrichGroup(cases, { phase: 'sizing', repo, settings: TA_DEFAULTS, slug: 'b1' }).sizing;

test('applySizing: percentile flags against size-class history, batch-grain est-vs-actual', async () => {
  const mk = (id, rw, min) => ({ id, direct: { tok: { input: 0, output: rw, cacheRead: 0, cacheWrite: 0 }, activeMin: min, tokens: rw, dispatches: 1, fixRounds: 0 }, findings: 0 });
  const cases = [mk('TC-1', 60000, 20), mk('TC-2', 9000, 8), mk('TC-3', 10000, 9)];
  const repo = sizingRepo({ cases: [
    { id: 'TC-1', size: 'S', sp: 2, estimated_active_minutes: 10 },
    { id: 'TC-2', size: 'S', sp: 2, estimated_active_minutes: 10 },
    { id: 'TC-3', size: 'XL', sp: 13, estimated_active_minutes: 60 },
  ] }, [
    ['S', 8000, 7], ['S', 9000, 8], ['S', 10000, 9], ['S', 11000, 10], ['S', 12000, 11], ['S', 13000, 12],
    ['XL', 50000, 40], ['XL', 60000, 50],   // n<5 → no verdict
  ]);
  const roll = sizing(repo, cases);
  assert.equal(cases[0].sizing.flag, 'above-p90', 'S-case at 5x class median flags high');
  assert.equal(cases[1].sizing.flag, undefined, 'mid-class case carries no flag');
  assert.match(cases[2].sizing.note, /insufficient XL-class history/);
  assert.equal(roll.flagged.length, 1);
  assert.match(roll.flagged[0].detail, /review: estimate drift, execution smell, or a mis-sized case/);
  assert.equal(roll.estVsActualMin.est, 80);
  assert.equal(roll.estVsActualMin.actual, 37);
  assert.match(roll.note, /never per-case dollar verdicts/);
});

test('loadSizings: tolerant of score-cases --json shape and bare arrays', async () => {
  const mk = (id) => ({ id, direct: { tok: null, activeMin: 0 }, findings: 0 });
  const cases = [mk('TC-1'), mk('TC-2')];
  const roll = sizing(sizingRepo({ cases: [
    { id: 'TC-1', size: 'M', sp: 5, estimated_active_minutes: 25 },
    { id: 'TC-2', size: { size: 'L', sp: 8 }, estimated_active_minutes: 40 },
    { note: 'no id — skipped' },
  ] }), cases);
  assert.equal(cases[0].sizing.size, 'M');
  assert.equal(cases[1].sizing.size, 'L');
  assert.equal(cases[1].sizing.sp, 8);
  assert.equal(roll.sized, 2);
  // a bare array of score rows reads the same
  const bare = [mk('TC-3')];
  assert.equal(sizing(sizingRepo([{ id: 'TC-3', size: 'S' }]), bare).sized, 1);
  assert.equal(bare[0].sizing.size, 'S');
});

// Case ids repeat across batch GENERATIONS, and the catch-up capture heals
// pre-era sessions into the ledger — a bare id-match then resurrects them
// into the current batch (field 2026-08-18: +$17.89/+40% from a pre-reset
// session). A session that ended before the batch was first DECLARED is out,
// unless its own scope names the batch; undeclared batches keep id-match.
test('batch time window: sessions ended before the first declare are excluded', async () => {
  const receipt = { batch: 'b2', cases: [{ id: 'TC-1', outcome: 'automated' }], gate: null };
  const mkLine = (id, endedAt, extra = {}) => ({
    v: 1, host: 'claude', id, user: 'u', repo: 'r', branch: 'tests/batch-b2', role: 'test-automation-lead',
    startedAt: endedAt, endedAt, wallMin: 10, activeMin: 10, turns: 5, toolCalls: 5, toolErrors: 0,
    tokens: { input: 1, output: 100, cacheRead: 0, cacheWrite: 0 }, costUsd: 2, costSource: 'ccusage-metered',
    cases: ['TC-1'], subagents: [], skills: [], dispatches: 1, capturedAt: endedAt, ...extra,
  });
  const old = mkLine('old-era', '2026-08-17T10:00:00Z');                      // ended before declare
  const cur = mkLine('current', '2026-08-18T14:00:00Z');                      // inside the window
  const named = mkLine('named', '2026-08-17T09:00:00Z', { scope: { batch: 'b2' } }); // pre-window but scope-named
  const scopes = [{ session: 'current', batch: 'b2', declaredAt: '2026-08-18T12:00:00Z', cases: ['TC-1'] }];
  const c = buildBatchCost('b2', receipt, [old, cur, named], { scopes });
  assert.equal(c.totals.costUsd, 4, 'old-era session excluded; current + scope-named counted');
  // no scope record for the batch → old behavior, everything id-matched counts
  const c2 = buildBatchCost('b2', receipt, [old, cur], { scopes: [] });
  assert.equal(c2.totals.costUsd, 4);
});

// PR #63 mirror: on a non-Anthropic gateway a dispatch can run to completion
// with ZERO usage records — that is the harness failing to report, not a free
// run. Unmeasured units go null+flag at capture; here the batch verdict says
// FLOOR instead of posing as a complete bill.
test('token attribution: unattributed units flag the totals as a floor', async () => {
  const withFlag = line('s1', [
    sub('implement:TC-101', 90_000, { costUsd: 1.40, activeMin: 12 }),
    { ...sub('review:TC-101', 0, { activeMin: 5 }), tokens: null, tokensAttributed: false },
  ], { costUsd: 2.40 });
  const c = buildBatchCost('b1', RECEIPT, [withFlag]);
  assert.equal(c.totals.tokensAttribution, 'partial');
  assert.equal(c.totals.unattributedUnits, 1);
  // fully attributed batch carries NO flag — absence means complete
  const clean = buildBatchCost('b1', RECEIPT, [line('s1', [sub('implement:TC-101', 90_000, { costUsd: 1.4, activeMin: 12 })], { costUsd: 2.4 })]);
  assert.equal(clean.totals.tokensAttribution, undefined);
  // and the dataset row carries the floor into notes + checklist
  const { buildRunRow, checklist, buildSegment } = await taExport();
  const row = buildRunRow(c, { factory_id: 'x' });
  assert.match(row.notes, /TOKEN ATTRIBUTION PARTIAL/);
  const checks = checklist(buildSegment({ factory_id: 'x' }, c), row);
  assert.ok(checks.missing.some((m) => m.includes('FLOOR')));
});

// --- B2 item 1: exact-ids ------------------------------------------------------------------------
test('exact-ids: namesToken whole-token, case-sensitive', () => {
  assert.equal(namesToken('implement TC-1,', 'TC-1'), true);
  assert.equal(namesToken('TC-1:', 'TC-1'), true);
  for (const t of ['implement TC-10', 'review tc-1', 'xTC-1', 'TC-1-2', 'TC-1_a']) assert.equal(namesToken(t, 'TC-1'), false, t);
  assert.equal(namesToken('a TC-10 then TC-1.', 'TC-1'), true, 'a later whole occurrence counts');
  assert.equal(namesToken('', 'TC-1'), false);
  assert.equal(namesToken('anything', ''), false);
});

test('matchIds: whole-token, case-sensitive', () => {
  const label = 'implement TC-10 then review tc-1 and xTC-1';
  assert.deepEqual(under('exact-ids', () => matchIds(label, ['TC-1', 'TC-10'])), ['TC-10']);
  assert.deepEqual(under('exact-ids', () => matchIds('implement TC-1,', ['TC-1'])), ['TC-1']);
  assert.deepEqual(under('exact-ids', () => matchIds('', ['TC-1'])), []);
  assert.deepEqual(under('none', () => matchIds(label, ['TC-1', 'TC-10'])), ['TC-1', 'TC-10'], 'reference: case-insensitive substring');
});

test('lineMatchesBatch: structured ids exact', () => {
  const scope = { slug: 'b1', ids: ['TC-1'], branches: ['tests/x'] };
  const l = ({ scope, ...o }) => ({ ...line('s', [], o), ...(scope ? { scope } : {}) });
  assert.equal(under('exact-ids', () => lineMatchesBatch(l({ scope: { cases: ['tc-1'] } }), scope)), false);
  assert.equal(under('none', () => lineMatchesBatch(l({ scope: { cases: ['tc-1'] } }), scope)), true);
  assert.equal(under('exact-ids', () => lineMatchesBatch(l({ scope: { cases: ['TC-1'] } }), scope)), true);
  assert.equal(under('exact-ids', () => lineMatchesBatch(l({ cases: ['TC-10'] }), scope)), false, 'TC-10 is not TC-1');
  assert.equal(under('none', () => lineMatchesBatch(l({ cases: ['TC-10'] }), scope)), true);
  // free text: whole token only
  assert.equal(under('exact-ids', () => lineMatchesBatch(line('s', [sub('implement TC-10', 1)]), scope)), false);
  assert.equal(under('exact-ids', () => lineMatchesBatch(line('s', [sub('implement TC-1, now', 1)]), scope)), true);
  assert.equal(under('exact-ids', () => lineMatchesBatch(l({ branch: 'tests/x' }), scope)), true);
  assert.equal(under('exact-ids', () => lineMatchesBatch(l({ branch: 'tests/xy' }), scope)), false);
  assert.equal(under('exact-ids', () => lineMatchesBatch(l({ scope: { batch: 'B1' } }), scope)), false, 'scope.batch is case-sensitive');
  assert.equal(under('exact-ids', () => lineMatchesBatch(l({ scope: { batch: 'b1' } }), scope)), true);
  assert.equal(under('exact-ids', () => lineMatchesBatch(l({ cases: ['b1'] }), { slug: ['b1'], ids: [], branches: [] })), true, 'slug equals a structured entry');
});

test('classify: declared fallback exact', () => {
  assert.deepEqual(under('exact-ids', () => classify('sync things', ['TC-1'], ['tc-1'])), { kind: 'overhead', ids: [] });
  assert.deepEqual(under('none', () => classify('sync things', ['TC-1'], ['tc-1'])), { kind: 'direct', ids: ['tc-1'] });
  assert.deepEqual(under('exact-ids', () => classify('sync things', ['TC-1'], ['TC-1'])), { kind: 'direct', ids: ['TC-1'] });
  assert.deepEqual(under('exact-ids', () => classify('implement TC-10', ['TC-1'])), { kind: 'overhead', ids: [] });
});

test('buildBatchCost: exact-ids mine/foreign partition uses whole tokens', () => {
  const receipt = { batch: 'g1', cases: [{ id: 'TC-1', outcome: 'automated', findings: [], branch: null }] };
  const lines = [line('s1', [sub('implement TC-1', 1000), sub('work for g2 now', 2000), sub('work for g20 now', 4000)], { branch: 'tests/g1' })];
  const other = { keys: ['g2'], ids: ['TC-2'], branches: [] };
  const run = (m) => under(m, () => buildBatchCost('g1', receipt, lines, { others: [other] }));
  const ex = run('exact-ids'); const ref = run('none');
  const excluded = (c) => JSON.stringify(c).match(/"foreignDispatchesExcluded":(\d+)/)?.[1];
  assert.equal(excluded(ref), '2', 'reference: g20 contains g2 as a substring');
  assert.equal(excluded(ex), '1', 'exact-ids: only the g2 dispatch is foreign');
});

// --- B2 item 4: null-unobservable (reader half, obligation O1) ------------------------------------
test('null activeMin / toolCalls / toolErrors counted, not zeroed', () => {
  const NU = 'null-unobservable';
  const receipt = { batch: 'g', cases: [{ id: 'T-1', outcome: 'delivered' }, { id: 'T-2', outcome: 'delivered' }] };
  const q = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };
  const lines = [{
    v: 1, host: 'copilot', id: 's', user: 'u', role: null, startedAt: '2026-10-01T10:00:00Z', endedAt: '2026-10-01T11:00:00Z',
    capturedAt: '2026-10-01T11:00:01Z', wallMin: null, activeMin: null, turns: 4, toolCalls: 3, toolErrors: 0, tokens: q, costUsd: 1, costSource: 'copilot-nano-aiu',
    cases: ['T-1', 'T-2'], scope: { intent: 'automation', batch: 'g', cases: ['T-1', 'T-2'] },
    subagents: [
      { role: 'implementer', label: 'implement T-1', n: 1, tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }, activeMin: null, toolCalls: null, toolErrors: null },
      { role: 'implementer', label: 'implement T-2', n: 1, tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }, activeMin: 4, toolCalls: 7, toolErrors: null },
    ],
  }];
  const c = under(NU, () => buildBatchCost('g', receipt, lines));
  const t1 = c.cases.find((x) => x.id === 'T-1').direct;
  assert.equal(t1.activeMin, null, 'no measured minutes: not 0');
  assert.equal(t1.toolCalls, null);
  assert.equal(t1.toolErrors, null);
  assert.deepEqual(t1.unmeasured, { tokens: 0, activeMin: 1, wallMin: 0, turns: 0, toolCalls: 1, toolErrors: 1 });
  const t2 = c.cases.find((x) => x.id === 'T-2').direct;
  assert.deepEqual([t2.activeMin, t2.toolCalls, t2.toolErrors], [4, 7, null]);
  assert.deepEqual(t2.unmeasured, { tokens: 0, activeMin: 0, wallMin: 0, turns: 0, toolCalls: 0, toolErrors: 1 });
  // totals: the parent's null minutes and both dispatches' null errors are counted beside the measured sums.
  assert.equal(c.totals.activeMin, 4);
  assert.equal(c.totals.toolCalls, 10);
  assert.equal(c.totals.toolErrors, 0);
  assert.deepEqual(c.totals.unmeasured, { tokens: 0, activeMin: 2, wallMin: 0, turns: 0, toolCalls: 1, toolErrors: 2 });
  assert.equal(c.overhead.lead.activeMin, null, 'the lead thread of a minute-less session is unmeasured');
  assert.equal(c.overhead.lead.unmeasured.activeMin, 1);
  assert.deepEqual(c.byRole.implementer.unmeasured, { tokens: 0, activeMin: 1, wallMin: 0, turns: 0, toolCalls: 1, toolErrors: 2 });
  assert.equal(c.byRole.implementer.toolErrors, null);
  // A null-token unit is counted per quantity beside the existing unattributedUnits.
  const nt = under(NU, () => buildBatchCost('g', receipt, [{ ...lines[0], tokens: null, tokensAttribution: 'partial' }]));
  assert.equal(nt.totals.unmeasured.tokens, 1);
  assert.equal(nt.totals.unattributedUnits, 1);
  assert.equal(nt.overhead.lead.tokens, null);
  assert.equal(nt.overhead.lead.tok, null);
  // Reference (none): zeros, no counts.
  const off = under('none', () => buildBatchCost('g', receipt, lines));
  const o1 = off.cases.find((x) => x.id === 'T-1').direct;
  assert.deepEqual([o1.activeMin, o1.toolCalls, o1.toolErrors], [0, 0, 0]);
  assert.ok(!('unmeasured' in o1) && !('unmeasured' in off.totals));
});

// --- B2 item 3: copilot-inclusive (reader half) ---------------------------------------------------
const inclSub = (label, over = {}) => ({ role: 'qa-engineer', label, n: 1, tokens: null, activeMin: 2, toolCalls: 3, toolErrors: null, ...over });
const inclLine = (subs, over = {}) => ({
  ...line('cp1', subs, { host: 'copilot', cases: ['TC-101'] }),
  tokensBasis: 'inclusive', tokens: { input: 5000, output: 300, cacheRead: 100, cacheWrite: 10 }, ...over,
});

test('batch-cost allocates an inclusive line\'s tokens at session grain; sources.inclusiveSessions counted', () => {
  const lines = [inclLine([inclSub('analyse TC-101'), inclSub('implement TC-102')]), line('cl1', [sub('analyse TC-101', 500)], {})];
  for (const mig of ['copilot-inclusive,null-unobservable', 'exact-ids']) {
    const c = under(mig, () => buildBatchCost('b1', RECEIPT, lines));
    // The inclusive line's dispatches contribute no tokens; the session total is counted once (5410 + 5 + 100 + 1000 + 50 + 500 for the claude line).
    const claudeOnly = 5 + 100 + 1000 + 50 + 500;
    assert.equal(c.totals.tokens, 5410 + claudeOnly, mig);
    assert.equal(c.cases.find((x) => x.id === 'TC-101').direct.tokens, 500, `${mig}: only the claude dispatch carries per-case tokens`);
    assert.equal(c.sources.inclusiveSessions, 1, mig);
    assert.match(c.sources.inclusiveNote, /unallocated/, mig);
  }
  const plain = under('none', () => buildBatchCost('b1', RECEIPT, [line('cl1', [sub('analyse TC-101', 500)], {})]));
  assert.ok(!('inclusiveSessions' in plain.sources), 'reference-era ledgers carry no such note');
});

test('B2-04: an inclusive line\'s informative dispatch tokens never add to totals.tokensByModel (any migration set)', () => {
  const q = (n) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
  const l = inclLine([inclSub('analyse TC-101', { tokens: q(40), tokensByModel: { model: q(40) } })], { tokens: q(100), tokensByModel: { model: q(100) } });
  for (const mig of ['copilot-inclusive,null-unobservable', 'none', 'exact-ids']) {
    const c = under(mig, () => buildBatchCost('b1', RECEIPT, [l]));
    assert.equal(c.totals.tokensByModel.model.input, 100, mig);
    assert.equal(c.totals.tokensSplit.input, 100, mig);
  }
  // a reference-era line (no basis) keeps parent + dispatches
  const { tokensBasis: _b, ...ref } = l;
  assert.equal(under('none', () => buildBatchCost('b1', RECEIPT, [ref])).totals.tokensByModel.model.input, 140);
});

test('B2-05: batch-cost reads a stamped receipt by its archive, never by current settings; a missing archive is a finding (real CLI)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const repo = mkdtempSync(join(tmpdir(), 'bc-b205-'));
  const put = (rel, o) => { const f = join(repo, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, JSON.stringify(o)); };
  const man = { module: 'tokenomics', schema_version: '1.0', domain: 'test', manifestRevision: 2, ratioIntents: ['automation'],
    receipts: { source: 'files', root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['done'] } };
  put('.agents/tokenomics/settings.json', { extension: null, reports: { location: 'tree' } });
  put('.agents/telemetry/automation/module.json', man);
  put('.agents/telemetry/automation/manifests/2.json', man);
  writeFileSync(join(repo, '.agents/telemetry/automation/usage-u.jsonl'), `${JSON.stringify({ ...line('s1', [], { costUsd: 10, cases: ['TC-1'] }), manifestRevision: 2, scope: { intent: 'automation', batch: 'g', cases: ['TC-1'] } })}\n`);
  put('.agents/automation/g/report.json', { manifestRevision: 2, cases: [{ id: 'TC-1', outcome: 'done' }] });
  put('.agents/automation/h/report.json', { manifestRevision: 7, cases: [{ id: 'TC-2', outcome: 'delivered' }] });
  put('.agents/automation/k/report.json', { cases: [{ id: 'TC-3', outcome: 'delivered' }] });
  const env = { ...process.env, TOKENOMICS_NO_CCUSAGE: '1' };
  delete env.TOKENOMICS_MIGRATIONS;
  const run = () => { const r = spawnSync(process.execPath, [fileURLToPath(new URL('./batch-cost.mjs', import.meta.url)), repo], { encoding: 'utf8', env }); assert.equal(r.status, 0, r.stderr); };
  const cost = (g) => JSON.parse(readFileSync(join(repo, '.agents/automation', g, 'cost.json'), 'utf8'));
  run();
  assert.equal(cost('g').delivered, 1, "revision 2's archive: 'done' is delivered");
  assert.equal(cost('g').averages.totalPerDelivered.costUsd, 10);
  assert.equal(cost('g').findings, undefined);
  assert.equal(cost('h').delivered, 0, 'unverified: never the current settings');
  assert.deepEqual(cost('h').findings, ['manifest-archive-missing: revision 7']);
  assert.equal(cost('k').delivered, 1, 'revisionless: the settings policy');
  const md = renderBatchMarkdown(cost('h')); const html = renderBatchHtml(cost('h'));
  for (const doc of [md, html]) assert.match(doc, /Findings: manifest-archive-missing: revision 7 — this batch's receipt is unverified: none of its cases counts as delivered/);
  assert.doesNotMatch(renderBatchMarkdown(cost('g')), /Findings:/);
  // migrations off: the B1 extraction reads current settings for every receipt (diff-impl's path)
  env.TOKENOMICS_MIGRATIONS = 'none';
  run();
  assert.equal(cost('g').delivered, 0);
  assert.equal(cost('h').delivered, 1);
  assert.equal(cost('h').findings, undefined);
});

test('batch-cost: an inclusive line\'s null dispatch tokens flow as unmeasured per case, never as 0, and do not flag the totals', () => {
  const c = under('copilot-inclusive,null-unobservable', () => buildBatchCost('b1', RECEIPT, [inclLine([inclSub('analyse TC-101')])]));
  const d = c.cases.find((x) => x.id === 'TC-101').direct;
  assert.equal(d.tokens, null);
  assert.equal(d.unmeasured.tokens, 1);
  assert.equal(c.totals.tokens, 5410);
  assert.equal(c.totals.unmeasured.tokens, 0, 'the basis implies the split gap; the session total is complete');
  assert.ok(!('tokensAttribution' in c.totals));
});

test('I1 (Plan 4 final review) … batch-cost: an inclusive line\'s measured dispatch tokens read unmeasured in byRole, as team-report reads them (incl. null-unobservable alone)', () => {
  const q = (n) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
  const l = { ...inclLine([inclSub('implement TC-101', { role: 'worker', tokens: q(40), toolErrors: 0 }), inclSub('implement TC-101', { role: 'worker', toolErrors: 0 })]), role: 'lead', tokens: q(100) };
  for (const mig of ['', 'null-unobservable']) {
    const c = under(mig, () => buildBatchCost('b1', RECEIPT, [l]));
    assert.equal(c.byRole.worker.tok, null, mig || 'default');
    assert.equal(c.byRole.worker.tokens, null, mig || 'default');
    assert.equal(c.byRole.worker.unmeasured.tokens, 2, mig || 'default');
    assert.equal(c.byRole.lead.tok.input, 100, mig || 'default');
  }
});

// --- B2 item 2: shared-allocation (owner Q5: even 1/k split + sources.sharedDispatches) -------------
const SA = 'shared-allocation';
const grpReceipt = (batch, ids, extra = {}) => ({ batch, cases: ids.map((id) => ({ id, outcome: 'delivered' })), ...extra });
const grpIdentity = (slug, r) => ({ keys: [slug, r.batch].filter(Boolean), ids: r.cases.map((c) => c.id), branches: [] });
const Q410 = { input: 10, output: 60, cacheRead: 300, cacheWrite: 40 };
const sharedLine = (subs, extra = {}) => ({ ...line('sh', subs), tokens: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 }, ...extra });
const qSub = (id, label, over = {}) => ({ ...sub(label, 0, { costUsd: 0.4, activeMin: 4, role: 'implementer' }), id, tokens: { ...Q410 }, toolCalls: 2, ...over });
// Build every group the way updateBatchCosts does: k across all groups, `others` = every other group.
const buildGroups = (groups, lines) => {
  const shared = sharedDispatchCounts(groups, lines);
  return groups.map(({ slug, receipt }) => buildBatchCost(slug, receipt, lines, {
    others: groups.filter((g) => g.slug !== slug).map((g) => grpIdentity(g.slug, g.receipt)), shared,
  }));
};
const TWO = [{ slug: 'camp/a', receipt: grpReceipt('a', ['TC-1']) }, { slug: 'camp/b', receipt: grpReceipt('b', ['TC-2']) }];

test('shared-allocation: a dispatch mine in k groups gets 1/k in each', () => {
  const lines = [sharedLine([qSub('d1', 'implement TC-1 TC-2')])];
  assert.deepEqual([...sharedDispatchCounts(TWO, lines)], [['claude:sh:d1', 2]]);
  const [a, b] = under(SA, () => buildGroups(TWO, lines));
  for (const [g, id] of [[a, 'TC-1'], [b, 'TC-2']]) {
    const d = g.cases.find((c) => c.id === id).direct;
    assert.equal(d.tokens, 205, `${g.batch}: 410 / 2`);
    assert.deepEqual(d.tok, { input: 5, output: 30, cacheRead: 150, cacheWrite: 20 });
    assert.equal(d.dispatches, 0.5);
    assert.equal(d.costUsd, 0.2);
    assert.deepEqual([d.activeMin, d.toolCalls], [2, 1]);
    assert.equal(g.totals.tokens, 185 + 205, 'parent 370 / 2 + the dispatch half');
    assert.equal(g.totals.dispatches, 0.5);
    assert.equal(g.byRole.implementer.tokens, 205);
    assert.equal(g.byRole.implementer.dispatches, 0.5);
    assert.equal(g.cases[0].loaded.tokens, 390);
  }
  // Conservation (§5.4): the two groups together carry the dispatch exactly once.
  assert.equal(a.cases[0].direct.tokens + b.cases[0].direct.tokens, 410);
  assert.equal(round2(a.cases[0].direct.costUsd + b.cases[0].direct.costUsd), 0.4);
  // Reference (none): counted in full in both groups.
  const [ra, rb] = under('none', () => buildGroups(TWO, lines));
  assert.deepEqual([ra.cases[0].direct.tokens, rb.cases[0].direct.tokens, ra.cases[0].direct.dispatches], [410, 410, 1]);
  assert.ok(!('sharedDispatches' in ra.sources));
});

test('shared-allocation: k = 1 unchanged', () => {
  const lines = [sharedLine([qSub('d1', 'implement TC-1'), qSub('d2', 'implement TC-2', { costUsd: 0.1 })])];
  assert.deepEqual([...sharedDispatchCounts(TWO, lines)].sort(), [['claude:sh:d1', 1], ['claude:sh:d2', 1]]);
  const strip = (cs) => cs.map((c) => ({ ...c, generatedAt: null }));
  assert.deepEqual(strip(under(SA, () => buildGroups(TWO, lines))), strip(under('none', () => buildGroups(TWO, lines))));
  // Without the counts (a pure-ledger caller), k defaults to 1.
  const solo = under(SA, () => buildBatchCost('camp/a', TWO[0].receipt, lines));
  assert.equal(solo.cases[0].direct.tokens, 410);
});

test('shared-allocation: sources.sharedDispatches counts dispatches with k > 1', () => {
  const lines = [sharedLine([qSub('d1', 'implement TC-1 TC-2'), qSub('d2', 'review TC-1 and TC-2'), qSub('d3', 'implement TC-1')])];
  const [a, b] = under(SA, () => buildGroups(TWO, lines));
  assert.equal(a.sources.sharedDispatches, 2);
  assert.equal(b.sources.sharedDispatches, 2);
  assert.match(a.sources.sharedDispatchesNote, /split evenly \(1\/k\)/);
  assert.equal(a.cases[0].direct.tokens, 205 + 205 + 410, 'two halves and one whole');
  assert.equal(a.cases[0].direct.dispatches, 2);
  const solo = under(SA, () => buildGroups(TWO, [sharedLine([qSub('d3', 'implement TC-1')])]));
  assert.ok(!('sharedDispatches' in solo[0].sources) && !('sharedDispatchesNote' in solo[0].sources), 'k = 1 everywhere: no note');
});

// Rounding decision: the 1/k share is carried unrounded through every sum and each group's figure is rounded
// once at output (Math.round tokens, round2 dollars), as every existing even split (div, clusters) is. So a
// group is off by at most half a unit, and the k groups together by at most k/2 units. For k = 3 that stays
// within the kit's per-source tolerance (1 token, 0.01 USD, spec 5.4).
test('shared-allocation: an odd split (k = 3) rounds per group and conserves within the kit tolerance', () => {
  const THREE = [...TWO, { slug: 'camp/c', receipt: grpReceipt('c', ['TC-3']) }];
  const lines = [sharedLine([qSub('d1', 'implement TC-1 TC-2 TC-3', { costUsd: 0.3 })])];
  assert.equal(sharedDispatchCounts(THREE, lines).get('claude:sh:d1'), 3);
  const gs = under(SA, () => buildGroups(THREE, lines));
  const d = gs.map((g) => g.cases[0].direct);
  assert.deepEqual(d.map((x) => x.tokens), [137, 137, 137], '410 / 3 = 136.67, rounded per group');
  assert.deepEqual(d.map((x) => x.tok), Array(3).fill({ input: 3, output: 20, cacheRead: 100, cacheWrite: 13 }));
  assert.deepEqual(d.map((x) => x.costUsd), [0.1, 0.1, 0.1]);
  assert.deepEqual(d.map((x) => x.dispatches), [0.33, 0.33, 0.33]);
  const sum = (f) => d.reduce((n, x) => n + f(x), 0);
  assert.ok(Math.abs(sum((x) => x.tokens) - 410) <= 1, 'scalar tokens within 1 token');
  for (const k of Object.keys(Q410)) assert.ok(Math.abs(sum((x) => x.tok[k]) - Q410[k]) <= 1, `tokens.${k} within 1 token`);
  assert.ok(Math.abs(sum((x) => x.costUsd) - 0.3) <= 0.01 + 1e-9, 'dollars within 0.01');
});

test('shared-allocation: a rollup receipt is excluded from k and keeps the dispatch at full weight', () => {
  const groups = [...TWO, { slug: 'camp', receipt: grpReceipt('camp', ['TC-1', 'TC-2'], { rollup: true }) }];
  const lines = [sharedLine([qSub('d1', 'implement TC-1 TC-2')])];
  assert.equal(sharedDispatchCounts(groups, lines).get('claude:sh:d1'), 2, 'the rollup does not count');
  const [a, b, camp] = under(SA, () => buildGroups(groups, lines));
  assert.equal(a.cases[0].direct.tokens, 205);
  assert.equal(b.cases[0].direct.tokens, 205);
  assert.equal(camp.cases.reduce((n, c) => n + c.direct.tokens, 0), 410, 'the rollup aggregates the whole dispatch');
  assert.ok(!('sharedDispatches' in camp.sources));
});

test('shared-allocation: an inclusive line splits its dispatch counts and minutes 1/k; its tokens stay at session grain', () => {
  const lines = [{ ...sharedLine([qSub('d1', 'implement TC-1 TC-2', { tokens: null, costUsd: undefined })]), host: 'copilot', tokensBasis: 'inclusive' }];
  const [a, b] = under(`${SA},null-unobservable,copilot-inclusive`, () => buildGroups(TWO, lines));
  for (const g of [a, b]) {
    const d = g.cases[0].direct;
    assert.equal(d.dispatches, 0.5);
    assert.deepEqual([d.activeMin, d.toolCalls], [2, 1]);
    assert.equal(d.tokens, null, 'a 1/k share of an unmeasured quantity stays unmeasured, never 0');
    assert.equal(d.unmeasured.tokens, 1);
    assert.equal(g.totals.tokens, 185, 'the session total, split by the sessions it served (div), not by k');
    assert.equal(g.sources.sharedDispatches, 1);
  }
});

test('shared-allocation: updateBatchCosts counts k across every receipt, also for a --batch build', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-sa-'));
  for (const { slug, receipt } of TWO) {
    mkdirSync(join(repo, '.agents', 'automation', slug), { recursive: true });
    writeFileSync(join(repo, '.agents', 'automation', slug, 'report.json'), JSON.stringify(receipt));
  }
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(tele, { recursive: true });
  writeFileSync(join(tele, 'usage-u1.jsonl'), `${JSON.stringify(sharedLine([qSub('d1', 'implement TC-1 TC-2')]))}\n`);
  const all = under(SA, () => updateBatchCosts(repo, { write: false }));
  assert.deepEqual(all.map((c) => c.cases[0].direct.tokens), [205, 205]);
  const [one] = under(SA, () => updateBatchCosts(repo, { batch: 'camp/b', write: false }));
  assert.equal(one.cases[0].direct.tokens, 205);
  assert.equal(one.sources.sharedDispatches, 1);
});

// D5: the join fixture's hand-written trace must be the engine's allocation, not a separate story. Each group's
// dispatch-grain amounts equal its case's direct figures, and all its amounts together equal its totals.
test('shared-allocation: the shared-dispatch-split join fixture mirrors the engine allocation', () => {
  const dir = new URL('../fixtures/join/shared-dispatch-split/', import.meta.url);
  const lines = readFileSync(new URL('ledger.jsonl', dir), 'utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s));
  const trace = JSON.parse(readFileSync(new URL('trace.json', dir), 'utf8'));
  const gs = under(SA, () => buildGroups(TWO, lines));
  const cats = Object.keys(Q410);
  for (const g of gs) {
    const mine = trace.allocations.filter((a) => a.group === g.batch);
    const amt = (q, grain) => round2(mine.filter((a) => a.quantity === q && (!grain || (a.grain ?? 'session') === grain)).reduce((n, a) => n + a.amount, 0));
    const d = g.cases[0].direct;
    assert.equal(amt('costUsd', 'dispatch'), d.costUsd, `${g.batch} dispatch dollars`);
    for (const c of cats) assert.equal(amt(`tokens.${c}`, 'dispatch'), d.tok[c], `${g.batch} dispatch tokens.${c}`);
    assert.equal(amt('costUsd'), g.totals.costUsd, `${g.batch} total dollars`);
    for (const c of cats) assert.equal(amt(`tokens.${c}`), g.totals.tokensSplit[c], `${g.batch} total tokens.${c}`);
    assert.equal(amt('activeMin'), g.totals.activeMin, `${g.batch} minutes (session grain)`);
  }
});

// --- B2 item 7: active-minutes (spec 5.4; owner Q7) -----------------------------------------------
// A session's activeMin is allocated once, at session grain (activeMin / div per group). Fields whose value was a
// dispatch partition are null: "not allocated at this grain", which is not "unmeasured" (no count is added).
const AM = 'active-minutes';
const amLines = () => [line('s1', [
  sub('Triage the batch: TC-101 TC-102', 10_000, { costUsd: 0.10, activeMin: 2 }),
  sub('implement:TC-101', 200_000, { costUsd: 2.00, activeMin: 20 }),
  sub('fix:TC-101:1 round', 30_000, { costUsd: 0.30, activeMin: 16, role: 'fixer' }),
  sub('Hardening gate for batch b1', 80_000, { costUsd: 0.80, activeMin: 8, role: 'test-automation-lead' }),
  sub('report:b1 write the report', 5_000, { costUsd: 0.05, activeMin: 1 }),
], { costUsd: 4.25 })];   // line.activeMin = 10 + 47 = 57

test('activeMin allocated at session grain; dispatch-partition fields null', () => {
  for (const mig of [AM, `${AM},null-unobservable`]) {
    const c = under(mig, () => buildBatchCost('b1', RECEIPT, amLines()));
    assert.equal(c.totals.activeMin, 57, `${mig}: the session's minutes, once`);
    assert.equal(c.overhead.lead.activeMin, 57, `${mig}: group time sits on the lead thread, nothing subtracted`);
    for (const x of c.cases) assert.equal(x.direct.activeMin, null, `${mig}: ${x.id} direct minutes not allocated`);
    assert.equal(c.overhead.stages.activeMin, null, mig);
    for (const [k, b] of Object.entries(c.overhead.byStage)) assert.equal(b.activeMin, null, `${mig}: byStage.${k}`);
    assert.equal(c.rework.activeMin, null, mig);
    assert.equal(c.byRole['test-automation-engineer'].activeMin, null, `${mig}: a dispatch role`);
    assert.equal(c.byRole.fixer.activeMin, null, mig);
    assert.equal(c.byRole['test-automation-lead'].activeMin, 57, `${mig}: the parent role keeps the session minutes, the colliding dispatch adds none`);
    assert.equal(c.stats.directActiveMin, null, mig);
    assert.equal(c.sources.activeMinGrain, 'session', mig);
    assert.match(c.sources.activeMinNote, /session grain/, mig);
    // The other quantities are untouched: dispatch dollars and tokens still land per case.
    assert.equal(c.cases.find((x) => x.id === 'TC-101').direct.costUsd, 2.30, mig);
    assert.equal(c.cases.find((x) => x.id === 'TC-101').direct.dispatches, 2, mig);
  }
  // Allocation-grain null is not unmeasured: no count is added anywhere.
  const nu = under(`${AM},null-unobservable`, () => buildBatchCost('b1', RECEIPT, amLines()));
  for (const b of [...nu.cases.map((x) => x.direct), nu.overhead.stages, ...Object.values(nu.overhead.byStage), nu.rework, nu.byRole.fixer, nu.totals, nu.overhead.lead]) {
    assert.equal(b.unmeasured.activeMin, 0);
  }
  // Reference (none): partitioned — the lead keeps the remainder, cases carry their dispatches.
  const off = under('none', () => buildBatchCost('b1', RECEIPT, amLines()));
  assert.equal(off.overhead.lead.activeMin, 10);
  assert.equal(off.cases.find((x) => x.id === 'TC-101').direct.activeMin, 36);
  assert.ok(!('activeMinGrain' in off.sources));
});

test('loaded.activeMin = group time ÷ cases', () => {
  const c = under(AM, () => buildBatchCost('b1', RECEIPT, amLines()));
  assert.deepEqual(c.cases.map((x) => x.loaded.activeMin), [19, 19, 19], '57 / 3 cases');
  assert.deepEqual(c.stats.loadedActiveMin, { avg: 19, median: 19, min: 19, max: 19, n: 3 });
  // A minute-less session (Q8b) leaves group time unmeasured: loaded is null beside the parent's count.
  const nul = [{ ...amLines()[0], activeMin: null }];
  const n = under(`${AM},null-unobservable`, () => buildBatchCost('b1', RECEIPT, nul));
  assert.equal(n.totals.activeMin, null);
  assert.equal(n.totals.unmeasured.activeMin, 1, 'the session is unmeasured; its dispatches are not counted');
  for (const x of n.cases) {
    assert.equal(x.loaded.activeMin, null);
    assert.equal(x.loaded.unmeasured.activeMin, 1);
  }
  assert.equal(n.stats.loadedActiveMin, null);
});

test('active-minutes: the 1/k weight never reaches minutes; each group gets the session minutes ÷ the groups it served', () => {
  const lines = [sharedLine([qSub('d1', 'implement TC-1 TC-2')], { activeMin: 14 })];
  const [a, b] = under(`${SA},${AM}`, () => buildGroups(TWO, lines));
  for (const g of [a, b]) {
    assert.equal(g.totals.activeMin, 7, 'session grain: 14 / div 2 — not (14 − 4) / 2 + 4 / k');
    assert.equal(g.cases[0].direct.activeMin, null, 'the shared dispatch carries no minutes');
    assert.equal(g.cases[0].direct.dispatches, 0.5, 'its count, tokens and dollars still split 1/k');
    assert.equal(g.cases[0].direct.tokens, 205);
    assert.equal(g.cases[0].loaded.activeMin, 7);
  }
  // A dispatch mine in three groups (k = 3) on a line matched by all three: minutes still split by div alone.
  const THREE = [...TWO, { slug: 'camp/c', receipt: grpReceipt('c', ['TC-3']) }];
  const gs = under(`${SA},${AM}`, () => buildGroups(THREE, [sharedLine([qSub('d1', 'implement TC-1 TC-2 TC-3')], { activeMin: 30 })]));
  assert.deepEqual(gs.map((g) => g.totals.activeMin), [10, 10, 10]);
});

test('active-minutes: a foreign dispatch no longer moves minutes between groups', () => {
  const lines = [sharedLine([qSub('d1', 'implement TC-1', { activeMin: 4 }), qSub('d2', 'implement TC-2', { activeMin: 9 })], { activeMin: 23 })];
  const [a, b] = under(AM, () => buildGroups(TWO, lines));
  assert.deepEqual([a.totals.activeMin, b.totals.activeMin], [12, 12], '23 / 2, rounded once per group');
  const [ra, rb] = under('none', () => buildGroups(TWO, lines));
  assert.deepEqual([ra.totals.activeMin, rb.totals.activeMin], [9, 14], 'reference: (23 − 13) / 2 + the mine dispatch');
});

// D5: the activemin-session-grain join fixture's trace is the engine's allocation.
test('active-minutes: the activemin-session-grain join fixture mirrors the engine allocation', () => {
  const dir = new URL('../fixtures/join/activemin-session-grain/', import.meta.url);
  const lines = readFileSync(new URL('ledger.jsonl', dir), 'utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s));
  const trace = JSON.parse(readFileSync(new URL('trace.json', dir), 'utf8'));
  const gs = under(`${SA},${AM}`, () => buildGroups(TWO, lines));
  for (const g of gs) {
    const mine = trace.allocations.filter((a) => a.group === g.batch);
    const amt = (q, grain) => round2(mine.filter((a) => a.quantity === q && (!grain || (a.grain ?? 'session') === grain)).reduce((n, a) => n + a.amount, 0));
    const d = g.cases[0].direct;
    assert.equal(amt('costUsd', 'dispatch'), d.costUsd, `${g.batch} dispatch dollars`);
    for (const c of Object.keys(Q410)) assert.equal(amt(`tokens.${c}`, 'dispatch'), d.tok[c], `${g.batch} dispatch tokens.${c}`);
    assert.equal(amt('costUsd'), g.totals.costUsd, `${g.batch} total dollars`);
    for (const c of Object.keys(Q410)) assert.equal(amt(`tokens.${c}`), g.totals.tokensSplit[c], `${g.batch} total tokens.${c}`);
    assert.equal(amt('activeMin', 'dispatch'), 0, 'no minute at dispatch grain');
    assert.equal(amt('activeMin', 'session'), g.totals.activeMin, `${g.batch} minutes (session grain)`);
    assert.equal(d.activeMin, null);
  }
});

// Review round 1 (I1): a running session's lead thread is not measured yet. Its minutes are never the sum of the
// dispatch minutes (dispatches overlap, §5.4): null and counted unmeasured under null-unobservable, else the reference 0.
test('active-minutes: a live line never sums dispatch minutes; its lead minutes are unmeasured, never 0', async () => {
  const { loadLiveLines } = await import('./batch-cost.mjs');
  const liveRepo = (recs) => {
    const repo = mkdtempSync(join(tmpdir(), 'bc-am-live-'));
    const dir = join(repo, '.agents', 'telemetry', 'automation', 'live');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run-1.jsonl'), recs.map((r) => JSON.stringify({ v: 1, session: 'run-1', role: 'qa-engineer', label: 'analyse TC-101', cases: ['TC-101'],
      tokens: { input: 0, output: 0, cacheRead: 10, cacheWrite: 0 }, toolCalls: 1, toolErrors: 0, endedAt: '2026-08-14T10:00:00Z', ...r })).join('\n') + '\n');
    return repo;
  };
  // Two live records with no activeMin: the group time is unmeasured (1, the lead thread), never a measured 0.
  const noMin = liveRepo([{ agentId: 'a1' }, { agentId: 'a2' }]);
  const NUAM = `${AM},null-unobservable`;
  assert.equal(under(NUAM, () => loadLiveLines(noMin))[0].activeMin, null);
  const c = under(NUAM, () => buildBatchCost('b1', RECEIPT, loadLiveLines(noMin)));
  assert.equal(c.totals.activeMin, null);
  assert.equal(c.totals.unmeasured.activeMin, 1);
  assert.equal(c.overhead.lead.activeMin, null);
  assert.equal(c.overhead.lead.unmeasured.activeMin, 1);
  assert.equal(under(AM, () => loadLiveLines(noMin))[0].activeMin, 0, 'without null-unobservable: the reference 0');
  // Three parallel 30-minute dispatches: never 90.
  const par = liveRepo([{ agentId: 'p1', activeMin: 30 }, { agentId: 'p2', activeMin: 30 }, { agentId: 'p3', activeMin: 30 }]);
  for (const mig of [AM, NUAM, 'none', 'null-unobservable']) {
    const [l] = under(mig, () => loadLiveLines(par));
    assert.notEqual(l.activeMin, 90, mig);
    // (the reference partition still adds dispatch minutes into its buckets; only active-minutes stops that)
    if (mig.includes(AM)) assert.notEqual(under(mig, () => buildBatchCost('b1', RECEIPT, [l])).totals.activeMin, 90, mig);
  }
  assert.equal(under(NUAM, () => buildBatchCost('b1', RECEIPT, loadLiveLines(par))).totals.activeMin, null);
  assert.equal(under(AM, () => buildBatchCost('b1', RECEIPT, loadLiveLines(par))).totals.activeMin, 0);
});

// Review round 1 (I2): per-case actual minutes are not allocated, but the batch-grain estimate-vs-actual comparison
// stays, over the sized rows' loaded minutes (group time ÷ items, a labelled allocation).
test('active-minutes: TA sizing keeps the batch-grain estimate vs actual over loaded minutes; per-case minutes stay null', async () => {
  const repo = sizingRepo([{ id: 'TC-101', size: 'M', sp: 3, estimated_active_minutes: 30 }, { id: 'TC-102', size: 'M', sp: 3, estimated_active_minutes: 20 }],
    [['M', 10, 5], ['M', 11, 6], ['M', 12, 7], ['M', 13, 8], ['M', 14, 9], ['M', 15, 10]]);
  const row = (id, loaded, rw = 10) => ({ id, direct: { tok: { input: 0, output: rw, cacheRead: 0, cacheWrite: 0 }, activeMin: null }, loaded });
  const cases = [row('TC-101', { activeMin: 20 }, 5000), row('TC-102', { activeMin: 15 })];
  const s = sizing(repo, cases);
  assert.equal(s.bySize.M.actualMin, 35, 'Σ loaded minutes of the sized rows');
  assert.equal(s.bySize.M.actualMinBasis, 'allocated');
  assert.deepEqual(s.estVsActualMin, { est: 50, actual: 35, ratio: 0.7, basis: 'allocated' });
  assert.ok(!('minPercentile' in cases[0].sizing), 'no per-case minute percentile');
  assert.equal(cases[0].sizing.flag, 'above-p90', 'a token outlier still flags');
  assert.doesNotMatch(s.flagged[0].detail, /\d+m\b/, 'no minute median beside a case with no minutes (hiMin cannot fire)');
  // A loaded minute that is unmeasured stays unmeasured, never 0: no actual, no comparison, the count rides along.
  const unm = [row('TC-101', { activeMin: null, unmeasured: { activeMin: 1 } }), row('TC-102', { activeMin: 15 })];
  const u = sizing(repo, unm);
  assert.equal(u.bySize.M.actualMin, null);
  assert.equal(u.bySize.M.actualMinUnmeasured, 1);
  assert.ok(!('estVsActualMin' in u));
});

test('reports-location: updateBatchCosts writes cost.json under the telemetry reports dir when settings say telemetry', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bc-rl-'));
  mkdirSync(join(repo, '.agents', 'automation', 'g1'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'automation', 'g1', 'report.json'), JSON.stringify({ batch: 'g1', cases: [{ id: 'TC-1', outcome: 'automated' }] }));
  const tele = { ...TA_DEFAULTS, reports: { location: 'telemetry' } };
  updateBatchCosts0(repo, { write: true }, tele, ta);
  assert.ok(existsSync(join(repo, '.agents', 'telemetry', 'automation', 'reports', 'g1', 'cost.json')));
  assert.ok(!existsSync(join(repo, '.agents', 'automation', 'g1', 'cost.json')));
  updateBatchCosts0(repo, { write: true }, TA_DEFAULTS, ta);
  assert.ok(existsSync(join(repo, '.agents', 'automation', 'g1', 'cost.json')), 'tree keeps the receipt-dir cost.json');
});

// Review round 1 (I1): TA's size baselines read a group's cost.json from groupReportsDir first, then the receipt tree.
test('reports-location (I1): sizeBaselines sees a relocated cost.json and a tree-era one', () => {
  const repo = mkdtempSync(join(tmpdir(), 'sizing-rl-'));
  mkdirSync(join(repo, '.agents', 'estimation'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'estimation', 't.json'), JSON.stringify({ cases: [{ id: 'TC-1', size: 'S', sp: 2, estimated_active_minutes: 10 }] }));
  const hist = (n) => JSON.stringify({ batch: n, cases: [8000, 9000, 10000].map((rw, i) => ({ id: `H-${n}-${i}`, sizing: { size: 'S' }, direct: { tok: { input: 0, output: rw, cacheRead: 0, cacheWrite: 0 }, activeMin: 5 } })) });
  const settings = { ...TA_DEFAULTS, reports: { location: 'telemetry' } };
  const rel = join(repo, '.agents', 'telemetry', 'automation', 'reports', 'new');
  mkdirSync(rel, { recursive: true });
  writeFileSync(join(rel, 'cost.json'), hist('new'));
  mkdirSync(join(repo, '.agents', 'automation', 'old'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'automation', 'old', 'cost.json'), hist('old'));
  const cases = [{ id: 'TC-1', direct: { tok: { input: 0, output: 60000, cacheRead: 0, cacheWrite: 0 }, activeMin: 20, tokens: 60000, dispatches: 1, fixRounds: 0 }, findings: 0 }];
  const roll = ta.enrichGroup(cases, { phase: 'sizing', repo, settings, slug: 'b1' }).sizing;
  assert.ok(roll, 'a rollup was produced');
  // 6 history cases (3 relocated + 3 tree-era) reach the n>=5 floor, so a verdict exists; one home alone (3) would not
  assert.equal(cases[0].sizing.flag, 'above-p90');
});

test('reports-location (M1): a path merely ending in test-automation is not the TA extension', () => {
  assert.equal(loadSettingsFor('./extensions/my-test-automation.mjs'), 'telemetry');
  assert.equal(loadSettingsFor('./extensions/test-automation.mjs'), 'tree');
});

function loadSettingsFor(extension) {
  const repo = mkdtempSync(join(tmpdir(), 'rl-ext-'));
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ extension }));
  return loadSettings(repo, { TOKENOMICS_MIGRATIONS: 'reports-location' }).reports.location;
}

// --- B2 item 22: report-conflicts — the group cost uses the same spec 3.5 dedup (map R20, O2; owner Q16) ------------
const RCF = 'report-conflicts';
// one session `t`, an exact (endedAt, capturedAt) rank tie: costs 8 and 800 (Repro E)
const tieLines = () => [
  line('t', [sub('implement TC-101', 100, { costUsd: 1 })], { costUsd: 800 }),
  line('t', [sub('implement TC-101', 100, { costUsd: 1 })], { costUsd: 8 }),
  line('u', [sub('implement TC-102', 100, { costUsd: 0.5 })], { costUsd: 2 }),
];

test('report-conflicts (group cost): exact tie, identical payload → one duplicate', () => {
  const [a] = tieLines();
  const c = under(RCF, () => buildBatchCost('b1', RECEIPT, [a, { ...a, user: 'u2', branch: 'tests/101-x' }]));
  assert.equal(c.sources.sessions, 1);
  assert.equal(c.totals.costUsd, 800);
  assert.ok(!('conflicts' in c.sources));
  assert.ok(!('preview' in c));
});

test('report-conflicts (group cost): exact tie, different payload → conflict: excluded from verified totals; preview total picks the lowest canonical JSON; conflicts: 1', () => {
  const c = under(RCF, () => buildBatchCost('b1', RECEIPT, tieLines()));
  assert.equal(c.sources.sessions, 1, 'the conflicted session leaves the group totals');
  assert.equal(c.totals.costUsd, 2);
  assert.equal(c.sources.conflicts, 1);
  assert.match(c.sources.conflictsNote, /exact \(endedAt, capturedAt\) tie/);
  assert.deepEqual(c.preview, { sessions: 2, costUsd: 10, note: c.preview.note }, 'the pick is the $8 line (lowest canonical JSON)');
  assert.equal(c.cases.find((x) => x.id === 'TC-101').direct.costUsd, null, 'nor its dispatches');
  // rendered, never silently dropped (O1)
  for (const page of [renderBatchMarkdown(c), renderBatchHtml(c), renderBatchTokenomicsMarkdown(c), renderBatchTokenomicsHtml(c)]) assert.match(page, /1 session\(s\) in conflict.*preview total incl\. the lowest-canonical-JSON pick: \$10\.00 over 2 session\(s\)/);
  // the reference (none) keeps the first line of the tie
  assert.equal(under('none', () => buildBatchCost('b1', RECEIPT, tieLines())).totals.costUsd, 802);
});

test('report-conflicts (group cost): forward = reversed input order', () => {
  const strip = (c) => ({ ...c, generatedAt: null });
  const fwd = under(RCF, () => buildBatchCost('b1', RECEIPT, tieLines()));
  const rev = under(RCF, () => buildBatchCost('b1', RECEIPT, tieLines().reverse()));
  assert.equal(JSON.stringify(strip(fwd)), JSON.stringify(strip(rev)), 'byte-identical, key order included');
  // the reference depends on input order: 800 forward, 8 reversed
  assert.deepEqual([802, 10], [under('none', () => buildBatchCost('b1', RECEIPT, tieLines())).totals.costUsd, under('none', () => buildBatchCost('b1', RECEIPT, tieLines().reverse())).totals.costUsd]);
});

test('report-conflicts (review round 1, I1): a conflict is a member when any of its tied lines is; its pick is previewed', () => {
  const lines = [
    line('t', [], { costUsd: 800, cases: ['TC-102'] }),   // a member of b1 (by its mined case id)
    line('t', [], { costUsd: 8, cases: ['TC-000'] }),     // not a member; the pick (["TC-000"] sorts lowest)
    line('u', [sub('implement TC-102', 100, { costUsd: 0.5 })], { costUsd: 2 }),
  ];
  const c = under(RCF, () => buildBatchCost('b1', RECEIPT, lines));
  assert.deepEqual([c.sources.sessions, c.totals.costUsd, c.sources.conflicts], [1, 2, 1]);
  assert.deepEqual([c.preview.sessions, c.preview.costUsd], [2, 10]);
  // a group none of the tied lines belongs to sees no conflict
  const other = under(RCF, () => buildBatchCost('b9', { batch: 'b9', cases: [{ id: 'ZZ-9', outcome: 'delivered' }] }, lines));
  assert.ok(!('conflicts' in other.sources));
});

test('report-conflicts (review round 1, I3): group cost byte-identical for forward and reversed input (fractional costs)', () => {
  const ls = [line('a', [sub('implement TC-101', 100, { costUsd: 0.1 })], { costUsd: 0.3 }), line('b', [sub('implement TC-102', 100, { costUsd: 0.2 })], { costUsd: 0.7 }),
    line('c', [sub('implement TC-101', 100, { costUsd: 0.1 })], { costUsd: 0.1 }), ...tieLines()];
  const strip = (c) => JSON.stringify({ ...c, generatedAt: null });
  assert.equal(strip(under(RCF, () => buildBatchCost('b1', RECEIPT, ls))), strip(under(RCF, () => buildBatchCost('b1', RECEIPT, [...ls].reverse()))));
});

// --- B2 item 23: role-dollars — by-role dollars = the parent session's role, inclusive (spec 3.2.1, map O3, R21; Q1a) ---
const RD = 'role-dollars';
const rdLine = (subs, over = {}) => ({ ...line('rd', subs, { costUsd: 10 }), role: 'lead', ...over });
const rdSub = (label, costUsd, role = 'worker') => sub(label, 1000, { costUsd, role });
const sumRoles = (c) => round2(Object.values(c.byRole).reduce((n, b) => n + (b.costUsd ?? 0), 0));

test('byRole dollars: parent role = session-inclusive; dispatch-role dollars in a separate measured breakdown', () => {
  const lines = [rdLine([rdSub('implement TC-101', 4)])];
  for (const mig of [RD, `${RD},null-unobservable,active-minutes`]) {
    const c = under(mig, () => buildBatchCost('b1', RECEIPT, lines));
    assert.equal(c.byRole.lead.costUsd, 10, `${mig}: the parent role carries the whole session, its dispatch included`);
    assert.deepEqual(c.byDispatchRole, { worker: { units: 1, costUsd: 4, priced: 1 } }, mig);
    assert.equal(c.byRole.worker.costUsd, null, `${mig}: a dispatch-only role has no by-role dollars`);
    assert.equal(c.byRole.worker.tokens, 1000, `${mig}: its tokens still ride byRole`);
    assert.equal(c.totals.costUsd, 10, mig);
    assert.equal(sumRoles(c), c.totals.costUsd, `${mig}: Σ byRole.costUsd = totals.costUsd (dispatch dollars never summed in)`);
  }
  // Reference (none): parent-exclusive, the dispatch role's dollars mixed into the same map, no breakdown.
  const off = under('none', () => buildBatchCost('b1', RECEIPT, lines));
  assert.deepEqual([off.byRole.lead.costUsd, off.byRole.worker.costUsd], [6, 4]);
  assert.ok(!('byDispatchRole' in off));
});

test('role-dollars: a dispatch role named like the parent role stays apart', () => {
  const c = under(RD, () => buildBatchCost('b1', RECEIPT, [rdLine([rdSub('implement TC-101', 4, 'lead'), rdSub('implement TC-102', 1)])]));
  assert.equal(c.byRole.lead.costUsd, 10, 'not 10 + 4');
  assert.deepEqual(c.byDispatchRole, { lead: { units: 1, costUsd: 4, priced: 1 }, worker: { units: 1, costUsd: 1, priced: 1 } });
  assert.equal(sumRoles(c), c.totals.costUsd);
});

test('role-dollars: an unpriced dispatch is never $0 in the breakdown; an unpriced session leaves the parent role null', () => {
  const unpriced = { ...rdSub('implement TC-101', null) };
  const c = under(`${RD},null-unobservable`, () => buildBatchCost('b1', RECEIPT, [rdLine([unpriced, rdSub('implement TC-102', 2, 'fixer')])]));
  assert.deepEqual(c.byDispatchRole.worker, { units: 1, costUsd: null, priced: 0 });
  assert.deepEqual(c.byDispatchRole.fixer, { units: 1, costUsd: 2, priced: 1 });
  assert.equal(c.byRole.lead.costUsd, 10);
  // A session with no dollars (review round 1, I1): the parent role is null and counted unpriced, never the sum of its
  // dispatches; those stay in totals (the existing floor) and in byDispatchRole only. Σ byRole = totals over priced sessions.
  const s = under(RD, () => buildBatchCost('b1', RECEIPT, [rdLine([rdSub('implement TC-101', 4)], { costUsd: null, costSource: 'none' })]));
  assert.equal(s.totals.costUsd, 4);
  assert.equal(s.byRole.lead.costUsd, null, 'the session is unpriced: its inclusive cost is unknown');
  assert.deepEqual([s.byRole.lead.priced, s.byRole.lead.unpriced], [0, 1]);
  assert.deepEqual(s.byDispatchRole.worker, { units: 1, costUsd: 4, priced: 1 });
  // mixed: a priced and an unpriced session of the same role — the role carries the priced one, counts the other
  const m = under(RD, () => buildBatchCost('b1', RECEIPT, [rdLine([rdSub('implement TC-101', 4)], { id: 'p1' }), rdLine([rdSub('implement TC-102', 3)], { id: 'u1', costUsd: null, costSource: 'none' })]));
  assert.equal(m.byRole.lead.costUsd, 10);
  assert.deepEqual([m.byRole.lead.priced, m.byRole.lead.unpriced], [1, 1]);
  assert.equal(m.totals.costUsd, 13, 'totals keep the unpriced session\'s measured dispatch (its floor, unchanged)');
  assert.equal(sumRoles(m), 10, 'Σ byRole = totals over the priced sessions only');
  const z = under(RD, () => buildBatchCost('b1', RECEIPT, [rdLine([unpriced], { costUsd: null, costSource: 'none' })]));
  assert.equal(z.byRole.lead.costUsd, null);
  assert.equal(z.byDispatchRole.worker.costUsd, null);
});

test('role-dollars (review round 1, I2): byRole carries {priced, unpriced}; a dispatch-only role and an unpriced parent never render alike', () => {
  const lines = [rdLine([rdSub('implement TC-101', 4)], { costUsd: null, costSource: 'none' })];
  const c = under(`${RD},null-unobservable,active-minutes`, () => buildBatchCost('b1', RECEIPT, lines));
  assert.deepEqual([c.byRole.lead.costUsd, c.byRole.lead.priced, c.byRole.lead.unpriced], [null, 0, 1], 'unpriced parent');
  assert.deepEqual([c.byRole.worker.costUsd, c.byRole.worker.priced, c.byRole.worker.unpriced], [null, 0, 0], 'dispatch-only: not allocated');
  const md = renderBatchMarkdown(c);
  assert.match(md, /\| lead \| — \(1 unpriced\) \|/);
  assert.match(md, /\| worker \| — \|/);
  assert.match(md, /— = not allocated at this grain/);
  const tmd = renderBatchTokenomicsMarkdown(c);
  assert.match(tmd, /\| lead \| — \(1 unpriced\) \|/);
  assert.match(tmd, /\| worker \| — \|/);
  assert.match(tmd, /## Dispatch dollars by role/);
  assert.match(tmd, /\| worker \| \$4\.00 \| 1 \| 1 of 1 \|/);
  for (const html of [renderBatchHtml(c), renderBatchTokenomicsHtml(c)]) {
    assert.match(html, /lead<\/div>[\s\S]*?— \(1 unpriced\)/);
    assert.match(html, /worker<\/div>[\s\S]*?<div class="num">—<span/);
    assert.match(html, /Dispatch dollars by role/);
    assert.doesNotMatch(html, /\(n\/a\)/, 'the note and the cells use the same mark');
  }
  // a priced parent with an unpriced session beside it: the dollars plus the count, never silent
  const m = under(RD, () => buildBatchCost('b1', RECEIPT, [rdLine([], { id: 'p1', cases: ['TC-101'] }), rdLine([], { id: 'u1', cases: ['TC-101'], costUsd: null, costSource: 'none' })]));
  assert.match(renderBatchMarkdown(m), /\| lead \| \$10\.00 \(1 unpriced\) \|/);
});

test('role-dollars: shared and foreign dispatches keep Σ byRole = totals per group; the breakdown carries the 1/k weight', () => {
  const lines = [sharedLine([qSub('d1', 'implement TC-1 TC-2'), qSub('d2', 'implement TC-2', { costUsd: 0.3, role: 'fixer' })], { costUsd: 2 })];
  const [a, b] = under(`${SA},${RD}`, () => buildGroups(TWO, lines));
  for (const g of [a, b]) assert.equal(sumRoles(g), g.totals.costUsd, `${g.batch}: Σ byRole = totals`);
  assert.deepEqual(a.byDispatchRole, { implementer: { units: 0.5, costUsd: 0.2, priced: 0.5 } }, 'd2 is foreign to a');
  assert.deepEqual(b.byDispatchRole, { fixer: { units: 1, costUsd: 0.3, priced: 1 }, implementer: { units: 0.5, costUsd: 0.2, priced: 0.5 } });
  assert.equal(round2(a.totals.costUsd + b.totals.costUsd), 2, 'the session is charged once across the groups');
});

test('role-dollars: an inclusive (Copilot) line — the session dollars on the parent role, unpriced dispatches counted, never $0', () => {
  const c = under(`${RD},copilot-inclusive,null-unobservable`, () => buildBatchCost('b1', RECEIPT, [inclLine([inclSub('implement TC-101')], { costUsd: 3, costSource: 'copilot-credits' })]));
  assert.equal(c.byRole['test-automation-lead'].costUsd, 3);
  assert.equal(sumRoles(c), c.totals.costUsd);
  assert.deepEqual(c.byDispatchRole['qa-engineer'], { units: 1, costUsd: null, priced: 0 });
});

test('role-dollars: the batch views render the dispatch-dollar breakdown, never null/NaN/undefined/$null', () => {
  const c = under(`${RD},null-unobservable,active-minutes`, () => buildBatchCost('b1', RECEIPT, [rdLine([rdSub('implement TC-101', 4), rdSub('implement TC-102', null, 'fixer')])]));
  const md = renderBatchMarkdown(c);
  assert.match(md, /## Dispatch dollars by role/);
  assert.match(md, /\| worker \| \$4\.00 \| 1 \| 1 of 1 \|/);
  assert.match(md, /\| fixer \| — \(1 unpriced\) \| 1 \| 0 of 1 \|/);
  assert.match(md, /role cost = the parent session's role, inclusive of its dispatches/);
  const html = renderBatchHtml(c);
  assert.match(html, /Dispatch dollars by role/);
  assert.match(renderBatchTokenomicsMarkdown(c), /role cost = the parent session's role, inclusive of its dispatches/);
  for (const page of [md, html, renderBatchTokenomicsMarkdown(c), renderBatchTokenomicsHtml(c)]) {
    for (const bad of ['null', 'NaN', 'undefined', '$null']) assert.ok(!page.includes(bad), `no ${bad}`);
  }
  // Without the field (a reference-era cost.json) nothing new renders (O10: the reader decides by the field).
  const off = under('none', () => buildBatchCost('b1', RECEIPT, [rdLine([rdSub('implement TC-101', 4)])]));
  assert.doesNotMatch(renderBatchMarkdown(off), /Dispatch dollars by role/);
});

// --- B2 item 24: report-revision — every engine-written report records the current manifest's revision (spec 14.4, map O6, R22; Q14c) ---
const RR = 'report-revision';
const rrRepo = (module = undefined) => {
  const repo = mkdtempSync(join(tmpdir(), 'rr-'));
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(dir, { recursive: true });
  if (module !== undefined) writeFileSync(join(dir, 'module.json'), typeof module === 'string' ? module : JSON.stringify(module));
  return repo;
};
const rrCost = (repo, mig = RR) => under(mig, () => buildBatchCost('b1', RECEIPT, [line('rr', [], { costUsd: 3 })], { repo, settings: TA_DEFAULTS }));
const footers = (c) => ({
  md: renderBatchMarkdown(c), html: renderBatchHtml(c), tokMd: renderBatchTokenomicsMarkdown(c), tokHtml: renderBatchTokenomicsHtml(c),
});

test('report-revision: cost.json records manifestRevision right after v; implied manifest -> 1, module.json -> its revision', () => {
  const implied = rrCost(rrRepo());
  assert.deepEqual(Object.keys(implied).slice(0, 3), ['v', 'manifestRevision', 'batch']);
  assert.equal(implied.manifestRevision, 1, 'no module.json: the implied manifest, revision 1');
  assert.equal(rrCost(rrRepo({ manifestRevision: 4 })).manifestRevision, 4);
  assert.equal(rrCost(rrRepo({ manifestRevision: 4 })).v, implied.v);
  // a pure-ledger caller (no repo) still reports the implied manifest's revision
  assert.equal(under(RR, () => buildBatchCost('b1', RECEIPT, [line('rr', [], { costUsd: 3 })])).manifestRevision, 1);
});

test('report-revision: an unusable module.json -> manifestRevision null (the writer rule), never 1', () => {
  for (const bad of ['{not json', '[]', JSON.stringify({ manifestRevision: 0 }), JSON.stringify({ manifestRevision: '2' }), JSON.stringify({})]) {
    const c = rrCost(rrRepo(bad));
    assert.ok('manifestRevision' in c && c.manifestRevision === null, bad);
    assert.deepEqual(Object.keys(c).slice(0, 2), ['v', 'manifestRevision']);
  }
});

test('report-revision off: cost.json has no manifestRevision (reference shape)', () => {
  const c = rrCost(rrRepo({ manifestRevision: 4 }), 'none');
  assert.ok(!('manifestRevision' in c));
  const f = footers(c);
  for (const [k, v] of Object.entries(f)) assert.doesNotMatch(v, /manifest revision/, k);
});

test('report-revision: every batch render carries the footer line "manifest revision N"; null reads "manifest revision unknown"', () => {
  const f = footers(rrCost(rrRepo({ manifestRevision: 4 })));
  assert.match(f.md, /\nmanifest revision 4$/);
  assert.match(f.tokMd, /\nmanifest revision 4$/);
  assert.match(f.html, /<p class="meta">manifest revision 4<\/p>\s*$/);
  assert.match(f.tokHtml, /<p class="meta">manifest revision 4<\/p>\s*$/);
  const u = footers(rrCost(rrRepo('{not json')));
  for (const [k, v] of Object.entries(u)) {
    assert.match(v, /manifest revision unknown/, k);
    assert.doesNotMatch(v, /manifest revision (null|NaN|undefined|1)\b/, k);
  }
});

test('report-revision: updateBatchCosts writes cost.json with the field; a cost.json without it renders no footer (O10)', () => {
  const repo = rrRepo({ manifestRevision: 7 });
  mkdirSync(join(repo, '.agents', 'automation', 'b1'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'automation', 'b1', 'report.json'), JSON.stringify(RECEIPT));
  under(RR, () => updateBatchCosts0(repo, {}, undefined, ta));
  const written = JSON.parse(readFileSync(join(repo, '.agents', 'automation', 'b1', 'cost.json'), 'utf8'));
  assert.equal(written.manifestRevision, 7);
  const { manifestRevision, ...legacy } = written;
  assert.doesNotMatch(renderBatchMarkdown(legacy), /manifest revision/);
});

test('capture-robustness (21): a provisional live line takes its host from the live log, by field, whatever the switch set', async () => {
  const { loadLiveLines } = await import('./batch-cost.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'bc-live-host-'));
  const dir = join(repo, '.agents', 'telemetry', 'automation', 'live');
  mkdirSync(dir, { recursive: true });
  const rec = (extra) => JSON.stringify({ v: 1, session: 's', agentId: 'a1', role: 'qa', label: 'x', cases: ['TC-1'], tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, endedAt: '2026-08-14T10:00:00Z', bytes: 1, ...extra });
  writeFileSync(join(dir, 'cp.jsonl'), `${rec({ host: 'copilot' })}\n`);
  writeFileSync(join(dir, 'cl.jsonl'), `${rec({})}\n`);              // a reference-era record names no host
  for (const mig of ['capture-robustness', 'none']) {
    const byId = Object.fromEntries(under(mig, () => loadLiveLines(repo)).map((l) => [l.id, l.host]));
    assert.deepEqual(byId, { cl: 'claude', cp: 'copilot' }, mig);
  }
});
