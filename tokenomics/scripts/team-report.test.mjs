// Tests for team-report.mjs — ledger merge/dedup, receipts join, honest dollars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TA_DEFAULTS as TA_DEFAULTS_ } from '../engine/config.mjs';
import {
  loadLines, dedupLines, filterWindow, filterRole, isoWeek, lineTokens, buildReport,
  loadCases, renderMarkdown, renderTeamHtml, main,
} from './team-report.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenomics-report-'));
const jsonl = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';

const line = (over = {}) => ({
  v: 1, host: 'claude', id: 'a', user: 'alice', repo: 'r', branch: 'main',
  role: 'test-automation-lead', models: ['claude-sonnet-5'],
  startedAt: '2026-07-30T10:00:00Z', endedAt: '2026-07-30T11:00:00Z', capturedAt: '2026-07-30T11:00:01Z',
  wallMin: 60, activeMin: 40, turns: 10, toolCalls: 20, toolErrors: 1,
  tokens: { input: 100, output: 50, cacheRead: 1000, cacheWrite: 10 },
  costUsd: 2.5, costSource: 'ccusage-metered',
  subagents: [{ role: 'qa-engineer', n: 2, tokens: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0 }, activeMin: 15, toolCalls: 30, toolErrors: 2 }],
  skills: [], dispatches: 2,
  ...over,
});

function seedRepo() {
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'usage-alice.jsonl'), jsonl([
    line({ endedAt: '2026-07-30T10:30:00Z', capturedAt: '2026-07-30T10:30:01Z', costUsd: 1.0 }), // earlier capture of same session
    line(), // re-capture after resume — this one must win
  ]));
  writeFileSync(join(dir, 'usage-bob.jsonl'), jsonl([
    line({ id: 'b', host: 'copilot', user: 'bob', role: null, costUsd: 0.2, costSource: 'copilot-nano-aiu', startedAt: '2026-08-03T09:00:00Z', endedAt: '2026-08-03T09:30:00Z', subagents: [] }),
    line({ id: 'c', user: 'bob', costUsd: null, costSource: 'none', startedAt: '2026-08-03T10:00:00Z', subagents: [] }),
  ]));
  const auto = join(repo, '.agents', 'automation');
  mkdirSync(join(auto, 'batch1'), { recursive: true });
  mkdirSync(join(auto, 'batch2'), { recursive: true });
  writeFileSync(join(auto, 'batch1', 'report.json'), JSON.stringify({ cases: [{ id: 'C1', outcome: 'automated' }, { id: 'C2', outcome: 'blocked' }] }));
  writeFileSync(join(auto, 'batch2', 'report.json'), JSON.stringify({ cases: [{ id: 'C2', outcome: 'automated' }, { id: 'C3', outcome: 'not-started' }] }));
  const t1 = new Date('2026-07-30T12:00:00Z'); const t2 = new Date('2026-07-31T12:00:00Z');
  utimesSync(join(auto, 'batch1', 'report.json'), t1, t1);
  utimesSync(join(auto, 'batch2', 'report.json'), t2, t2);
  return repo;
}

test('dedupLines: latest endedAt wins per host:id', () => {
  const lines = loadLines([seedRepo()]);
  assert.equal(lines.length, 4);
  const deduped = dedupLines(lines);
  assert.equal(deduped.length, 3);
  const a = deduped.find((l) => l.id === 'a');
  assert.equal(a.costUsd, 2.5, 'the re-capture (later endedAt) replaced the earlier line');
});

test('lineTokens folds sub-agent tokens into the footprint', () => {
  assert.deepEqual(lineTokens(line()), { input: 600, output: 150, cacheRead: 1000, cacheWrite: 10 });
});

test('filterWindow uses the local start date (reference behaviour, migrations off)', () => underMig('none', () => {
  const lines = dedupLines(loadLines([seedRepo()]));
  assert.equal(filterWindow(lines, '2026-08-01', null).length, 2);
  assert.equal(filterWindow(lines, null, '2026-07-31').length, 1);
}));

test('filterRole: matches the session agent or any dispatched sub-agent role', () => {
  const lines = dedupLines(loadLines([seedRepo()]));
  const asLead = filterRole(lines, 'test-automation-lead');
  assert.equal(asLead.length, 2); // sessions a + c carry the lead role
  const viaSub = filterRole(lines, 'qa-engineer');
  assert.equal(viaSub.length, 1, 'session a matched through its qa-engineer sub-agents');
  assert.equal(filterRole(lines, 'nobody').length, 0);
  assert.equal(filterRole(lines, null).length, 3, 'no filter → untouched');
});

test('main: --role suppresses the per-delivered ratio (receipts are not role-attributable)', async () => {
  const repo = seedRepo();
  const out = join(tmp(), 'role-report.md');
  assert.equal(await main([repo, '--role', 'test-automation-lead', '--out', out]), 0);
  const md = readFileSync(out, 'utf8');
  assert.match(md, /role: test-automation-lead/);
  assert.doesNotMatch(md, /Per delivered case/);
});

test('isoWeek: stable labels', () => {
  assert.equal(isoWeek('2026-07-30T10:00:00Z'), '2026-W31');
  assert.equal(isoWeek('garbage'), 'unknown');
});

test('loadCases: latest receipt wins per case, delivered = automated (reference behaviour, migrations off)', () => underMig('none', () => {
  const repo = seedRepo();
  const cases = loadCases([join(repo, '.agents', 'automation')]);
  assert.equal(cases.examined, 3);
  assert.equal(cases.delivered, 2); // C1 + C2 (re-entered blocked → automated)
  assert.deepEqual(cases.outcomes, { automated: 2, 'not-started': 1 });
}));

// Campaign waves live at <batch>/<wave>/report.json — the receipt walk must
// find them, or every campaign silently under-counts (same fix run-reports.mjs
// already carries in efficiency-audit).
test('loadCases: discovers nested campaign-wave receipts', () => underMig('none', () => {
  const repo = tmp();
  const wave = join(repo, '.agents', 'automation', 'camp', 'wave-01');
  mkdirSync(wave, { recursive: true });
  writeFileSync(join(wave, 'report.json'), JSON.stringify({
    batch: 'camp', cases: [{ id: 'W-1', outcome: 'automated' }, { id: 'W-2', outcome: 'blocked' }],
  }));
  const cases = loadCases([join(repo, '.agents', 'automation')]);
  assert.equal(cases.examined, 2);
  assert.equal(cases.delivered, 1);
  assert.equal(cases.reports, 1);
}));

test('buildReport: totals, honest dollars, role grain includes sub-agent roles (migrations off)', () => underMig('none', () => {
  const repo = seedRepo();
  const lines = dedupLines(loadLines([repo]));
  const cases = loadCases([join(repo, '.agents', 'automation')]);
  const rep = buildReport(lines, cases);
  assert.equal(rep.sessions, 3);
  assert.equal(rep.people, 2);
  assert.equal(rep.totals.priced, 2);
  assert.ok(Math.abs(rep.totals.costUsd - 2.7) < 1e-9);
  assert.equal(rep.tokensOnly, 1);
  assert.deepEqual(rep.costSources, { 'ccusage-metered': 1, 'copilot-nano-aiu': 1 });
  assert.ok(rep.byRole['qa-engineer'], 'sub-agent role surfaces');
  assert.equal(rep.byRole['qa-engineer'].units, 2);
  assert.ok(rep.byRole['(interactive session)'], 'null-role Copilot session bucketed');
  assert.ok(Math.abs(rep.perDelivered.costUsd - 2.7 / 2) < 1e-9);
}));

test('renderMarkdown: leads with real-figures-only cost and flags tokens-only sessions (migrations off)', () => underMig('none', () => {
  const repo = seedRepo();
  const rep = buildReport(dedupLines(loadLines([repo])), loadCases([join(repo, '.agents', 'automation')]));
  const md = renderMarkdown(rep, { window: null });
  assert.match(md, /real figures only/);
  assert.match(md, /1 session\(s\) tokens-only/);
  assert.match(md, /delivered \(automated\): 2/);
  assert.match(md, /## By person/);
}));

test('main: end-to-end over a repo root with --out (migrations off)', async () => {
  const repo = seedRepo();
  const out = join(tmp(), 'report.md');
  assert.equal(await underMigA('none', () => main([repo, '--out', out])), 0);
  const md = readFileSync(out, 'utf8');
  assert.match(md, /Tokenomics — team usage report/);
  assert.match(md, /delivered \(automated\): 2/);
  // cross-batch per-case rollup: every batch's cost.json rows, loaded labelled
  assert.match(md, /## Per case — every batch's cost\.json rows/);
  assert.match(md, /loaded = direct measured work \+ an even share of the batch overhead/);
});

// The team page mirrors the markdown's discipline: real dollars only,
// tokens-only flagged, receipts join shown when present. Self-contained HTML —
// same rhythm as the manual-qa factory's tokenomics HTML report.
test('main: --html renders the self-contained team page', async () => {
  const repo = seedRepo();
  const out = join(tmp(), 'report.html');
  assert.equal(await main([repo, '--html', '--out', out]), 0);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /<title>Tokenomics — team report<\/title>/);
  assert.match(html, /delivered \/ examined/);
  assert.match(html, /By person/);
  assert.ok(!html.includes('http'), 'no external assets — self-contained page');
});

// Delivery report shows the HONEST token figure (real work) plus hit rate;
// the tokenomics render is the full unfolding of the same cost.json.
test('batch renders: real-work tokens + cache hit rate; tokenomics view unfolds composition', async () => {
  const { renderBatchMarkdown, renderBatchTokenomicsMarkdown, renderBatchTokenomicsHtml } = await import('./team-report.mjs');
  const quad = { input: 1000, output: 4000, cacheRead: 95000, cacheWrite: 2000 };
  const cost = {
    batch: 'b1', generatedAt: 'x',
    sources: { sessions: 1, hosts: ['claude'], costSources: ['ccusage-metered'], models: ['m'] },
    outcomes: { automated: 1 }, delivered: 1, gate: { verdict: 'green', runs: 3 },
    totals: { costUsd: 5, tokens: 102000, tokensSplit: quad, activeMin: 30, dispatches: 3, turns: 5, toolCalls: 40, toolErrors: 1, skills: [] },
    overhead: { costUsd: 1, sharePct: 20, lead: { costUsd: 1, tokens: 50000, tok: quad, activeMin: 5, dispatches: 0, toolCalls: 5, toolErrors: 0 }, stages: { costUsd: null, tokens: 0, activeMin: 0, dispatches: 0 }, byStage: {} },
    averages: { totalPerDelivered: { costUsd: 5 }, directPerCase: { costUsd: 4 } },
    stats: { directCostUsd: { avg: 4, median: 4, min: 4, max: 4, n: 1 }, directTokens: { avg: 1, median: 1, min: 1, max: 1, n: 1 }, directActiveMin: { avg: 1, median: 1, min: 1, max: 1, n: 1 } },
    cases: [{ id: 'TC-1', outcome: 'automated', findings: 0, direct: { costUsd: 4, tokens: 102000, tok: quad, activeMin: 25, dispatches: 1, fixRounds: 0, toolCalls: 35, toolErrors: 1 }, loaded: { costUsd: 5, tokens: 1, activeMin: 30 } }],
    byRole: { 'qa-engineer': { costUsd: 4, tokens: 102000, tok: quad, activeMin: 25, dispatches: 1, toolCalls: 35, toolErrors: 1 } },
    coverage: { casesUnattributed: [] },
  };
  const md = renderBatchMarkdown(cost);
  assert.match(md, /real work 5,000/);
  assert.match(md, /Tokens: total 102,000/);
  assert.match(md, /cache hit rate 96.9%/);
  assert.match(md, /real-work tok/);
  assert.doesNotMatch(md.split('\n').find((l) => l.startsWith('- Total:')), /102,000/, 'the raw cache-inclusive sum no longer leads');
  const tok = renderBatchTokenomicsMarkdown(cost);
  assert.match(tok, /Composition — where the tokens went/);
  assert.match(tok, /cache read \| 95,000/);
  assert.match(tok, /Cache hit rate: 96.9%/);
  assert.match(tok, /\*\*total\*\* \| \*\*102,000\*\*/);
  assert.match(tok, /Orchestrator \(lead thread\) composition/);
  const html = renderBatchTokenomicsHtml(cost);
  assert.match(html, /Batch tokenomics — b1/);
  assert.match(html, /cache hit rate/i);
  // manual-qa design parity: kpi cards + a composition panel with a legend,
  // and the raw TOTAL is a first-class stat (user ask 2026-08-18), never hidden
  assert.match(html, /kpi-card/);
  assert.match(html, /Token composition/);
  assert.match(html, /legend-item/);
  assert.match(html, /stat-value">102,000/);
  assert.match(html, /incl\. cache replay/);
  assert.ok(!html.includes('http'), 'self-contained page — no external assets');
  assert.ok(!html.includes('http'), 'self-contained');
  // a quad-less (old) cost.json degrades to an explicit note, never throws
  const old = { ...cost, totals: { ...cost.totals, tokensSplit: undefined } };
  assert.match(renderBatchTokenomicsMarkdown(old), /No token split/);
});

// hit rate = textbook hits/(hits+misses) at token grain: a cache WRITE is a
// miss that got stored, so it belongs in the denominator; savings is the
// $-complement (1× uncached vs 1×/1.25×/0.1× as billed).
test('cacheHitRate counts writes as misses; cacheSavings prices the counterfactual', async () => {
  const { cacheHitRate, cacheSavings } = await import('./team-report.mjs');
  const t = { input: 1000, output: 4000, cacheRead: 95000, cacheWrite: 2000 };
  assert.ok(Math.abs(cacheHitRate(t) - 95000 / 98000) < 1e-9);
  const paid = 1000 + 2000 * 1.25 + 95000 * 0.1;
  assert.ok(Math.abs(cacheSavings(t) - (1 - paid / 98000)) < 1e-9);
  assert.equal(cacheHitRate({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 }), null, 'no prompt tokens → n/a, never NaN');
});

// Plan 2 Task 10 (parked): the period report's By-group table carries the TA gate/drift columns only through the
// extension — with no extension its header row is the engine's own columns.
test('renderMarkdown by-group: no gate/drift columns without an extension; the TA extension adds them', async () => {
  const ta = await import('../extensions/test-automation.mjs');
  const repo = seedRepo();
  const rep = buildReport(dedupLines(loadLines([repo])), loadCases([join(repo, '.agents', 'automation')]));
  rep.byBatch = [{ batch: 'batch1', cases: 2, delivered: 1, costUsd: 2.7, activeMin: 40, perDelivered: 2.7, gate: 'pass', drift: false }];
  const header = (md) => md.split('\n')[md.split('\n').indexOf('## By batch') + 2];
  const bare = header(renderMarkdown(rep, { window: null }, undefined, null));
  assert.match(bare, /^\| batch \| cases \| delivered \|/);
  assert.doesNotMatch(bare, /gate|drift/);
  const withTa = header(renderMarkdown(rep, { window: null }, undefined, ta));
  assert.match(withTa, /\| gate \| drift \|$/);
});

// --- B2 item 4: null-unobservable (reader half, obligation O1) ------------------------------------
const NU = 'null-unobservable';
const underMig = (mig, fn) => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = mig;
  try { return fn(); } finally { if (was === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = was; }
};
const ZERO_QUAD = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const hasZeroQuad = (v) => (v && typeof v === 'object')
  && ((Object.keys(v).length === 4 && ['input', 'output', 'cacheRead', 'cacheWrite'].every((k) => v[k] === 0)) || Object.values(v).some(hasZeroQuad));
const unknownLine = (over = {}) => line({ id: 'u', tokens: null, tokensAttribution: 'none', activeMin: null, costUsd: null, costSource: 'none', subagents: [], dispatches: 0, ...over });

test('null tokens / activeMin / counters are counted as unmeasured per quantity, never added as 0', async () => {
  const { UNMEASURED_KEYS, addMeasured } = await import('./team-report.mjs');
  assert.deepEqual(UNMEASURED_KEYS, ['tokens', 'activeMin', 'wallMin', 'turns', 'toolCalls', 'toolErrors']);
  const rep = underMig(NU, () => buildReport([unknownLine()], null));
  const t = rep.totals;
  assert.deepEqual(t.unmeasured, { tokens: 1, activeMin: 1, wallMin: 0, turns: 0, toolCalls: 0, toolErrors: 0 });
  assert.equal(t.tokens, null, 'nothing measured: no sum, never a zero quad');
  assert.equal(t.activeMin, null);
  assert.equal(t.wallMin, 60);
  assert.ok(!hasZeroQuad(t), 'totals contain no zero quad');
  for (const b of [rep.byPerson.alice, Object.values(rep.byWeek)[0], rep.byHost.claude, rep.byIntent.undeclared, rep.byRole['test-automation-lead']]) {
    assert.equal(b.unmeasured.tokens, 1);
    assert.equal(b.unmeasured.activeMin, 1);
    assert.equal(b.tokens, null);
    assert.equal(b.activeMin, null);
  }
  // Beside a measured line the sum covers the measured values only.
  const mixed = underMig(NU, () => buildReport([unknownLine(), line({ id: 'm', subagents: [] })], null)).totals;
  assert.deepEqual(mixed.tokens, { input: 100, output: 50, cacheRead: 1000, cacheWrite: 10 });
  assert.equal(mixed.activeMin, 40);
  assert.deepEqual(mixed.unmeasured, { tokens: 1, activeMin: 1, wallMin: 0, turns: 0, toolCalls: 0, toolErrors: 0 });
  // Every additive counter, and a null dispatch, counts per quantity.
  const counters = underMig(NU, () => buildReport([line({ id: 'c', wallMin: null, turns: null, toolCalls: null, toolErrors: null,
    subagents: [{ role: 'reviewer', n: 1, tokens: null, tokensAttributed: false, activeMin: null, toolCalls: null, toolErrors: null }] })], null));
  assert.deepEqual(counters.totals.unmeasured, { tokens: 1, activeMin: 0, wallMin: 1, turns: 1, toolCalls: 1, toolErrors: 1 });
  assert.deepEqual(counters.totals.tokens, { input: 100, output: 50, cacheRead: 1000, cacheWrite: 10 });
  assert.equal(counters.totals.toolCalls, null);
  const rv = counters.byRole.reviewer;
  assert.equal(rv.tokens, null);
  assert.deepEqual(rv.unmeasured, { tokens: 1, activeMin: 1, wallMin: 0, turns: 0, toolCalls: 1, toolErrors: 1 });
  // addMeasured on its own.
  const b = { tokens: { ...ZERO_QUAD }, activeMin: 0 };
  addMeasured(b, 'activeMin', null);
  addMeasured(b, 'activeMin', undefined);
  assert.equal(b.activeMin, null);
  assert.equal(b.unmeasured.activeMin, 2);
  addMeasured(b, 'activeMin', 5);
  assert.equal(b.activeMin, 5);
  addMeasured(b, 'tokens', { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  addMeasured(b, 'tokens', null);
  assert.deepEqual(b.tokens, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  assert.equal(b.unmeasured.tokens, 1);
  const z = { activeMin: 0 };
  addMeasured(z, 'activeMin', 0);
  addMeasured(z, 'activeMin', null);
  assert.equal(z.activeMin, 0, 'a measured 0 stays a measured 0');
  // Reference (none): the zero quad and no count.
  const off = underMig('none', () => buildReport([unknownLine()], null)).totals;
  assert.deepEqual(off.tokens, ZERO_QUAD);
  assert.equal(off.activeMin, 0);
  assert.ok(!('unmeasured' in off));
});

test('renders with nulls contain no null, NaN, undefined, $null (Review Focus 4)', async () => {
  const tr = await import('./team-report.mjs');
  const { buildBatchCost } = await import('./batch-cost.mjs');
  const ta = await import('../extensions/test-automation.mjs');
  const { renderLiveReport } = await import('../hooks/telemetry-capture.mjs');
  const bad = /\bnull\b|NaN|undefined|\$null/;
  // Every minute and token in this fixture is unmeasured: a rendered zero minute / hour / token figure is a 0-for-unknown.
  // (`stages 0m` is exempt: the fixture has no stage dispatch, so that sum is empty, a true 0, not an unknown.)
  const zero = /(?<![\d.,$]|stages )0(?:\.0)?(?:m\b|h\b|k tok|M tok| active)/;
  const lines = [
    unknownLine({ id: 'u1', wallMin: null, turns: null, toolCalls: null, toolErrors: null, scope: { intent: 'automation', batch: 'g', cases: ['T-1'] }, cases: ['T-1'] }),
    unknownLine({ id: 'u2', host: 'copilot', role: null, scope: { intent: 'automation', batch: 'g', cases: ['T-1'] }, cases: ['T-1'],
      subagents: [{ role: 'implementer', label: 'implement T-1', n: 1, tokens: null, tokensAttributed: false, activeMin: null, toolCalls: null, toolErrors: null }], dispatches: 1 }),
  ];
  const receipt = { batch: 'g', cases: [{ id: 'T-1', outcome: 'delivered' }] };
  const outs = underMig(NU, () => {
    const rep = tr.buildReport(lines, { examined: 1, delivered: 1, outcomes: { delivered: 1 }, reports: 1 });
    const c = buildBatchCost('g', receipt, lines, { ext: ta });
    return {
      c,
      md: tr.renderMarkdown(rep, { label: 'x' }),
      html: tr.renderTeamHtml(rep, { label: 'x' }),
      bmd: tr.renderBatchMarkdown(c, TA_DEFAULTS_, ta), bhtml: tr.renderBatchHtml(c, TA_DEFAULTS_, ta),
      tmd: tr.renderBatchTokenomicsMarkdown(c, TA_DEFAULTS_, ta), thtml: tr.renderBatchTokenomicsHtml(c, TA_DEFAULTS_, ta),
      bmd0: tr.renderBatchMarkdown(c), bhtml0: tr.renderBatchHtml(c), tmd0: tr.renderBatchTokenomicsMarkdown(c), thtml0: tr.renderBatchTokenomicsHtml(c),
    };
  });
  assert.equal(outs.c.totals.activeMin, null, 'the fixture really reaches the renderers with nulls');
  // The loaded allocation and its spread are unknown too (O1): null beside a count, never 0.
  const t1 = outs.c.cases.find((x) => x.id === 'T-1');
  assert.equal(t1.loaded.activeMin, null);
  assert.equal(t1.loaded.tokens, null);
  assert.ok(t1.loaded.unmeasured.activeMin > 0 && t1.loaded.unmeasured.tokens > 0);
  assert.equal(outs.c.stats.loadedActiveMin, null);
  for (const [k, text] of Object.entries(outs)) {
    if (k === 'c') continue;
    assert.doesNotMatch(text, bad, `${k} renders a null`);
    assert.doesNotMatch(text, zero, `${k} renders an unmeasured value as zero`);
    assert.match(text, /\d+ unmeasured/, `${k} says what is unmeasured`);
  }
  // The live page (renderLiveReport → renderBatchHtml) over a repo whose ledger holds the same lines.
  const repo = tmp();
  const tdir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(join(tdir, 'scopes'), { recursive: true });
  writeFileSync(join(tdir, 'usage-alice.jsonl'), jsonl(lines));
  writeFileSync(join(tdir, 'scopes', 'live1.json'), JSON.stringify({ session: 'live1', intent: 'automation', batch: 'g', cases: ['T-1'], declaredAt: '2026-07-01T00:00:00Z' }));
  mkdirSync(join(repo, '.agents', 'automation', 'g'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'automation', 'g', 'report.json'), JSON.stringify(receipt));
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = NU;
  let pages;
  try { pages = await renderLiveReport(repo, 'live1', { ...process.env, TOKENOMICS_MIGRATIONS: NU }); } finally { if (was === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = was; }
  assert.ok(pages?.length, 'the live page was written');
  const live = readFileSync(pages[0], 'utf8');
  assert.doesNotMatch(live, bad, 'live page renders a null');
  assert.doesNotMatch(live, zero, 'live page renders an unmeasured value as zero');
  assert.match(live, /\d+ unmeasured/);
});

test('tokenomics renders keep a role, stage or lead whose tokens are all unmeasured', async () => {
  const tr = await import('./team-report.mjs');
  const { buildBatchCost } = await import('./batch-cost.mjs');
  const ta = await import('../extensions/test-automation.mjs');
  const lines = [line({ id: 'k', tokens: null, tokensAttribution: 'partial', scope: { intent: 'automation', batch: 'g', cases: ['T-1'] }, cases: ['T-1'],
    subagents: [
      { role: 'implementer', label: 'implement T-1', n: 1, tokens: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 }, activeMin: 1, toolCalls: 1, toolErrors: 0 },
      { role: 'reviewer', label: 'hardening gate for batch g', n: 1, tokens: null, tokensAttributed: false, activeMin: 1, toolCalls: 1, toolErrors: 0 },
    ] })];
  const c = underMig(NU, () => buildBatchCost('g', { batch: 'g', cases: [{ id: 'T-1', outcome: 'delivered' }] }, lines, { ext: ta }));
  assert.equal(c.byRole.reviewer.tok, null);
  assert.equal(c.overhead.lead.tok, null);
  const md = tr.renderBatchTokenomicsMarkdown(c, TA_DEFAULTS_, ta);
  assert.match(md, /\| reviewer \| n\/a \| — \(1 unmeasured\) \|/);
  assert.match(md, /\| gate \| n\/a \| — \(1 unmeasured\) \|/);
  assert.match(md, /Lead: \$2\.50 · real work — \(1 unmeasured\)/);
  const html = tr.renderBatchTokenomicsHtml(c, TA_DEFAULTS_, ta);
  assert.match(html, /lbl">reviewer<\/div>/);
  assert.match(html, /real work — \(1 unmeasured\)/);
  for (const t of [md, html]) assert.doesNotMatch(t, /\bnull\b|NaN|undefined|\$null/);
});

test('by-group rows render a null group total beside its unmeasured count (O1)', async () => {
  const tr = await import('./team-report.mjs');
  const rep = underMig(NU, () => tr.buildReport([line({ id: 'g' })], null));
  rep.byBatch = [{ batch: 'g', cases: 1, delivered: 1, costUsd: null, activeMin: null, perDelivered: null, unmeasured: { tokens: 0, activeMin: 2, wallMin: 0, turns: 0, toolCalls: 0, toolErrors: 0 } }];
  for (const out of [tr.renderMarkdown(rep, {}), tr.renderTeamHtml(rep, {})]) {
    assert.match(out, /— \(2 unmeasured\)/);
    assert.doesNotMatch(out, /\bnull\b|NaN|undefined/);
  }
});

// --- B2 item 3: copilot-inclusive (reader half; O10: readers decide by the line's own basis) ----------
const inclLine = (over = {}) => line({
  host: 'copilot', tokensBasis: 'inclusive', tokens: { input: 5000, output: 300, cacheRead: 100, cacheWrite: 10 },
  subagents: [{ role: 'qa-engineer', n: 1, tokens: null, activeMin: 2, toolCalls: 5, toolErrors: null }], ...over,
});

test('lineTokens ignores dispatch tokens of an inclusive line', () => {
  const stale = inclLine({ subagents: [{ role: 'qa-engineer', n: 1, tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }, activeMin: 2, toolCalls: 5, toolErrors: 0 }] });
  // Same answer with the migration on and off: the reader follows the line's own tokensBasis, never the switch.
  for (const mig of ['copilot-inclusive', 'exact-ids']) {
    underMig(mig, () => {
      assert.deepEqual(lineTokens(inclLine()), { input: 5000, output: 300, cacheRead: 100, cacheWrite: 10 }, mig);
      assert.deepEqual(lineTokens(stale), { input: 5000, output: 300, cacheRead: 100, cacheWrite: 10 }, mig);
      const rep = buildReport([inclLine()], null);
      assert.deepEqual(rep.totals.tokens, { input: 5000, output: 300, cacheRead: 100, cacheWrite: 10 }, mig);
    });
  }
  // A line without a basis (reference era) keeps today's reading: parent + dispatches.
  const { tokensBasis: _b, ...refEra } = stale;
  assert.deepEqual(underMig('exact-ids', () => lineTokens(refEra)), { input: 6000, output: 300, cacheRead: 100, cacheWrite: 10 });
});

test('B2-04: an inclusive line\'s informative dispatch tokens never add to a same-role byRole total (any migration set)', () => {
  const q = (n) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
  const l = inclLine({ role: 'lead', tokens: q(100), subagents: [{ role: 'lead', n: 1, tokens: q(40), activeMin: 2, toolCalls: 5, toolErrors: 0 }] });
  for (const mig of ['copilot-inclusive,null-unobservable', 'none', 'exact-ids']) {
    const rep = underMig(mig, () => buildReport([l], null));
    assert.equal(rep.totals.tokens.input, 100, mig);
    const lead = rep.byRole.lead.tokens;
    assert.equal(lead.input, 100, `${mig}: byRole.lead equals the session's own number`);
  }
  const { tokensBasis: _b, ...ref } = l;
  assert.equal(underMig('none', () => buildReport([ref], null)).byRole.lead.tokens.input, 140);
});

test('inclusive line under null-unobservable: totals take the session total; the dispatch role stays unmeasured, never 0', () => {
  const rep = underMig('null-unobservable', () => buildReport([inclLine()], null));
  assert.deepEqual(rep.totals.tokens, { input: 5000, output: 300, cacheRead: 100, cacheWrite: 10 });
  assert.equal(rep.totals.unmeasured.tokens, 0);
  assert.equal(rep.byRole['qa-engineer'].unmeasured.tokens, 1);
  assert.equal(rep.byRole['qa-engineer'].tokens, null, 'a dispatch role has no token figure');
});

test('I1 (Plan 4 final review): an inclusive line\'s measured informative dispatch tokens read unmeasured at dispatch grain, never a measured 0', () => {
  const q = (n) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
  // the same fixture batch-cost.test.mjs reads through buildBatchCost ("I1 … batch-cost")
  const l = inclLine({ role: 'lead', tokens: q(100), cases: ['TC-1'], subagents: [
    { role: 'worker', label: 'implement TC-1', n: 1, tokens: q(40), activeMin: 2, toolCalls: 5, toolErrors: 0 },
    { role: 'worker', label: 'implement TC-1', n: 1, tokens: null, activeMin: 1, toolCalls: 1, toolErrors: 0 },
  ] });
  for (const mig of ['', 'null-unobservable']) {
    const rep = underMig(mig, () => buildReport([l], null));
    assert.equal(rep.byRole.worker.tokens, null, `${mig || 'default'}: never a measured 0`);
    assert.equal(rep.byRole.worker.unmeasured.tokens, 2, `${mig || 'default'}: each inclusive dispatch counted unmeasured`);
    assert.equal(rep.byRole.lead.tokens.input, 100, mig || 'default');
  }
});

// Plan 4 final review (ledger 146): the unverified callout names why the lines are unverified.
test('unverified callout: a null-revision line reads "no verifiable manifest revision", an archive-less one keeps today\'s words', async () => {
  const { renderMarkdown, renderTeamHtml } = await import('./team-report.mjs');
  const unknown = underMig('', () => buildReport([line({ manifestRevision: null })], null));
  assert.deepEqual(unknown.findings, ['manifest-revision-unknown']);
  const md = renderMarkdown(unknown, {}); const html = renderTeamHtml(unknown, {});
  for (const doc of [md, html]) {
    assert.match(doc, /1 session\(s\) \(\$2\.50, 1 of 1 priced\) have no verifiable manifest revision \(archive missing or revision unknown\) — excluded from the per-delivered ratio/);
    assert.doesNotMatch(doc, /name a manifest revision without an archive/);
  }
  const missing = underMig('', () => buildReport([line({ manifestRevision: 7 })], null));
  assert.deepEqual(missing.findings, ['manifest-archive-missing: revision 7']);
  for (const doc of [renderMarkdown(missing, {}), renderTeamHtml(missing, {})]) assert.match(doc, /1 session\(s\) \(\$2\.50, 1 of 1 priced\) name a manifest revision without an archive — excluded/);
});

// --- B2 item 7: active-minutes (spec 5.4; owner Q7) -----------------------------------------------
const AM = 'active-minutes';
test('by-role parent minutes inclusive; dispatch roles a separate breakdown; parent/dispatch role-name collision kept apart', () => {
  const lines = [
    line({ id: 'p', activeMin: 40, subagents: [
      { role: 'qa-engineer', n: 2, tokens: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0 }, activeMin: 15, toolCalls: 30, toolErrors: 2 },
      { role: 'test-automation-lead', n: 1, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, activeMin: 6, toolCalls: 1, toolErrors: 0 },
    ] }),
  ];
  for (const mig of [AM, `${AM},null-unobservable`]) {
    const rep = underMig(mig, () => buildReport(lines, null));
    assert.equal(rep.byRole['test-automation-lead'].activeMin, 40, `${mig}: the parent role gets the full session minutes`);
    assert.equal(rep.byRole['qa-engineer'].activeMin, null, `${mig}: a dispatch-only role has no minutes in byRole`);
    assert.deepEqual(Object.fromEntries(Object.entries(rep.byDispatchRole).map(([k, b]) => [k, [b.units, b.activeMin]])),
      { 'qa-engineer': [2, 15], 'test-automation-lead': [1, 6] }, `${mig}: dispatch minutes kept apart, the colliding name too`);
    assert.equal(rep.totals.activeMin, 40, `${mig}: dispatch minutes are not summed into totals`);
    if (mig.includes('null-unobservable')) assert.equal(rep.byRole['qa-engineer'].unmeasured.activeMin, 0, 'not allocated is not unmeasured');
    // Tokens and counters keep their role grain.
    assert.equal(rep.byRole['qa-engineer'].units, 2);
    assert.equal(rep.byRole['qa-engineer'].toolCalls, 30);
  }
  // A null dispatch minute is counted unmeasured in the dispatch breakdown (O1), never 0.
  const nul = underMig(`${AM},null-unobservable`, () => buildReport([line({ subagents: [{ role: 'r', n: 1, tokens: null, activeMin: null, toolCalls: 1, toolErrors: 0 }] })], null));
  assert.equal(nul.byDispatchRole.r.activeMin, null);
  assert.equal(nul.byDispatchRole.r.unmeasured.activeMin, 1);
  // Reference (none): parent minus dispatches, one merged map.
  const off = underMig('none', () => buildReport(lines, null));
  assert.equal(off.byRole['test-automation-lead'].activeMin, 40 - 21 + 6);
  assert.equal(off.byRole['qa-engineer'].activeMin, 15);
  assert.ok(!('byDispatchRole' in off));
  // Renders: the dispatch breakdown is its own table, labelled as overlapping and outside the totals.
  const rep = underMig(AM, () => buildReport(lines, null));
  for (const out of [renderMarkdown(rep, {}), renderTeamHtml(rep, {})]) {
    assert.match(out, /Dispatch minutes by role/);
    assert.match(out, /not part of any total/);
    assert.doesNotMatch(out, /\bnull\b|NaN|undefined/);
  }
  assert.match(renderMarkdown(rep, {}), /\| qa-engineer \| 2 \| 15m \|/);
  assert.doesNotMatch(renderMarkdown(off, {}), /Dispatch minutes by role/);
});

test('renders with active-minutes nulls contain no null, 0m or —m (Review Focus 4)', async () => {
  const tr = await import('./team-report.mjs');
  const { buildBatchCost } = await import('./batch-cost.mjs');
  const ta = await import('../extensions/test-automation.mjs');
  const bad = /\bnull\b|NaN|undefined|\$null|—m\b/;
  const zeroMin = /(?<![\d.,$])0(?:\.0)?(?:m\b|h\b)/;
  const subs = [
    { role: 'qa-engineer', label: 'Triage the batch: T-1 T-2', n: 1, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, activeMin: 2, toolCalls: 1, toolErrors: 0 },
    { role: 'implementer', label: 'implement T-1', n: 1, tokens: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 }, activeMin: 9, toolCalls: 1, toolErrors: 0, costUsd: 0.5 },
    { role: 'implementer', label: 'fix:T-1:1 round', n: 1, tokens: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 }, activeMin: 4, toolCalls: 1, toolErrors: 0, costUsd: 0.2 },
    { role: 'reviewer', label: 'Hardening gate for batch g', n: 1, tokens: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 }, activeMin: 3, toolCalls: 1, toolErrors: 0, costUsd: 0.1 },
  ];
  const lines = [line({ id: 'am', activeMin: 48, scope: { intent: 'automation', batch: 'g', cases: ['T-1', 'T-2'] }, cases: ['T-1', 'T-2'], subagents: subs })];
  const receipt = { batch: 'g', cases: [{ id: 'T-1', outcome: 'delivered' }, { id: 'T-2', outcome: 'delivered' }] };
  for (const mig of [AM, `${AM},null-unobservable`, `${AM},null-unobservable,shared-allocation,copilot-inclusive,exact-ids`]) {
    const outs = underMig(mig, () => {
      const rep = tr.buildReport(lines, { examined: 2, delivered: 2, outcomes: { delivered: 2 }, reports: 1 });
      const c = buildBatchCost('g', receipt, lines, { ext: ta });
      rep.perCase = c.cases.map((x) => ({ batch: 'g', id: x.id, outcome: x.outcome, direct: x.direct, loaded: x.loaded }));
      return {
        c,
        md: tr.renderMarkdown(rep, { label: 'x' }), html: tr.renderTeamHtml(rep, { label: 'x' }),
        bmd: tr.renderBatchMarkdown(c, TA_DEFAULTS_, ta), bhtml: tr.renderBatchHtml(c, TA_DEFAULTS_, ta),
        tmd: tr.renderBatchTokenomicsMarkdown(c, TA_DEFAULTS_, ta), thtml: tr.renderBatchTokenomicsHtml(c, TA_DEFAULTS_, ta),
        bmd0: tr.renderBatchMarkdown(c), bhtml0: tr.renderBatchHtml(c),
      };
    });
    const c = outs.c;
    assert.ok(c.cases.every((x) => x.direct.activeMin === null) && c.overhead.stages.activeMin === null && c.rework.activeMin === null
      && Object.values(c.overhead.byStage).every((b) => b.activeMin === null) && c.byRole.implementer.activeMin === null, `${mig}: the fixture reaches the renderers with allocation nulls`);
    for (const [k, text] of Object.entries(outs)) {
      if (k === 'c') continue;
      assert.doesNotMatch(text, bad, `${mig} ${k} renders a null`);
      assert.doesNotMatch(text, zeroMin, `${mig} ${k} renders an unallocated minute as 0`);
    }
    assert.match(outs.bmd, /session grain/, `${mig}: the batch view says where the minutes went`);
    assert.match(outs.bmd, /loaded: avg 24m/, `${mig}: the loaded spread survives without a direct spread`);
    // Review round 1 (M2): the per-item heading gives the loaded-minutes formula at session grain, md and html.
    assert.match(outs.bmd, /## Per case \(direct = measured; loaded = direct \+ even overhead share, an allocation; loaded minutes = batch time ÷ cases\)/, mig);
    assert.match(outs.bhtml, /Loaded minutes are batch time ÷ cases/, mig);
    // (M4): the period by-role table says what a bare '—' in its active column means.
    for (const k of ['md', 'html']) assert.match(outs[k], /— = not allocated at this grain/, `${mig} ${k}`);
  }
});

// --- B2 item 8: report-windows (§5.5, §5.2; map D1, obligations O4/O8; owner Q10, Q11) -------------
const RW = 'report-windows';
const underMigA = async (mig, fn) => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = mig;
  try { return await fn(); } finally { if (was === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = was; }
};
const TA_OUT = ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red'];
const mdoc = (rev, intents, deliveredOutcomes = TA_OUT) => ({ module: 'tokenomics', schema_version: '1.0', domain: 'test-automation',
  manifestRevision: rev, receipts: { source: 'files', deliveredOutcomes }, ratioIntents: intents });
const rl = (id, endedAt, intent, costUsd, over = {}) => line({ id, startedAt: endedAt, endedAt, capturedAt: endedAt, costUsd,
  costSource: costUsd == null ? 'none' : 'ccusage-metered', scope: { intent, batch: null, cases: [] }, subagents: [], ...over });
const IN_WINDOW_AT = '2026-10-03T12:00:00Z';
/** A repo with one ledger, an optional current module.json and archives, and receipts `{group: {doc, mtime}}`. */
function rwRepo({ lines = [], current = null, archives = {}, receipts = { rr: { doc: { cases: [{ id: 'R-1', outcome: 'delivered', at: IN_WINDOW_AT }] } } } } = {}) {
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'usage-alice.jsonl'), jsonl(lines));
  if (current) writeFileSync(join(dir, 'module.json'), JSON.stringify(current));
  if (Object.keys(archives).length) mkdirSync(join(dir, 'manifests'), { recursive: true });
  for (const [n, m] of Object.entries(archives)) writeFileSync(join(dir, 'manifests', `${n}.json`), JSON.stringify(m));
  for (const [g, { doc, mtime }] of Object.entries(receipts)) {
    const d = join(repo, '.agents', 'automation', g);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'report.json'), JSON.stringify(doc));
    if (mtime) { const t = new Date(mtime); utimesSync(join(d, 'report.json'), t, t); }
  }
  return repo;
}
/** `team-report --json` over `repo` with `args`, under `mig`. */
async function reportJson(repo, args = ['--since', '2026-10-01', '--until', '2026-10-07'], mig = RW) {
  const out = join(tmp(), 'r.json');
  assert.equal(await underMigA(mig, () => main([repo, ...args, '--json', '--out', out])), 0);
  return JSON.parse(readFileSync(out, 'utf8'));
}

test('report-windows: window [since, until) UTC on endedAt', async () => {
  const lines = [
    rl('b1', '2026-10-01T01:00:00Z', 'automation', 4, { startedAt: '2026-09-30T23:00:00Z' }),   // starts before since, ends inside
    rl('e0', '2026-10-01T00:00:00Z', 'automation', 1),                                            // exactly since: inside
    rl('eU', '2026-10-07T00:00:00Z', 'automation', 2),                                            // exactly until: outside
    rl('eOld', '2026-09-30T23:59:59Z', 'automation', 8),
    rl('eNull', null, 'automation', 16),
  ];
  assert.deepEqual(underMig(RW, () => filterWindow(lines, '2026-10-01', '2026-10-07')).map((l) => l.id), ['b1', 'e0']);
  assert.deepEqual(underMig(RW, () => filterWindow(lines, '2026-10-01T00:30:00Z', '2026-10-07T00:00:01Z')).map((l) => l.id), ['b1', 'eU']);
  // one endedAt window for the whole report (owner Q10b): totals and every breakdown read the same sessions
  const rep = await reportJson(rwRepo({ lines }));
  assert.equal(rep.sessions, 2);
  assert.equal(rep.totals.costUsd, 5);
  assert.equal(rep.byPerson.alice.sessions, 2);
  assert.equal(rep.byIntent.automation.costUsd, 5);
  assert.deepEqual(rep.index.map((x) => x.id).sort(), ['b1', 'e0']);
});

test('report-windows: default since = earliest endedAt, until = report time', async () => {
  const { reportWindow } = await import('./team-report.mjs');
  const lines = [rl('a', '2026-10-05T00:00:00Z', 'automation', 1), rl('b', '2026-10-02T09:00:00Z', 'automation', 1),
    rl('late', '2026-10-09T00:00:00Z', 'automation', 1), rl('n', null, 'automation', 1)];
  const now = Date.parse('2026-10-08T00:00:00Z');
  const w = underMig(RW, () => reportWindow(lines, null, null, now));
  assert.equal(w.since, Date.parse('2026-10-02T09:00:00Z'));
  assert.equal(w.until, now);
  assert.deepEqual(w.lines.map((l) => l.id), ['a', 'b'], 'a line ending at or after report time, or without endedAt, is outside');
  // the default window labels the report (never "all time")
  const rep = await reportJson(rwRepo({ lines: [rl('a', '2026-10-05T00:00:00Z', 'automation', 1), rl('b', '2026-10-02T09:00:00Z', 'automation', 1)] }), []);
  assert.match(rep.window, /^2026-10-02T09:00:00\.000Z → \d{4}-\d{2}-\d{2}T/);
});

test('report-windows: date-only --since 2026-10-01 → 2026-10-01T00:00:00Z (owner Q10d)', async () => {
  const { parseInstant } = await import('./team-report.mjs');
  assert.equal(parseInstant('2026-10-01'), Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(parseInstant('2026-10-01T06:30:00Z'), Date.parse('2026-10-01T06:30:00Z'));
  assert.ok(Number.isNaN(parseInstant('last tuesday')));
  const rep = await reportJson(rwRepo({ lines: [rl('a', '2026-10-05T00:00:00Z', 'automation', 1)] }));
  assert.equal(rep.window, '2026-10-01T00:00:00.000Z → 2026-10-07T00:00:00.000Z');
  const out = join(tmp(), 'bad.json');
  assert.equal(await underMigA(RW, () => main([rwRepo(), '--since', 'last tuesday', '--json', '--out', out])), 2, 'an unreadable bound is refused, never compared as text');
});

test('report-windows: §5.2 ordering incl. reopened and conflicting revisions', () => {
  const repo = rwRepo({ receipts: {
    win: { doc: { cases: [{ id: 'WIN-1', outcome: 'delivered', at: '2026-10-05T12:00:00Z' }] }, mtime: '2026-10-05T12:00:00Z' },
    // reopened: a later revision with a non-delivered outcome is the current state
    'reopen-a': { doc: { revision: '2026-10-02T12:00:00Z', cases: [{ id: 'REO-1', outcome: 'delivered', at: '2026-10-02T12:00:00Z' }] }, mtime: '2026-10-02T12:00:00Z' },
    'reopen-b': { doc: { revision: '2026-10-04T12:00:00Z', cases: [{ id: 'REO-1', outcome: 'in-progress', at: '2026-10-04T12:00:00Z' }] }, mtime: '2026-10-04T12:00:00Z' },
    // conflicting revisions: the later revision wins although its file is older (mtime never overrides a revision)
    'conf-a': { doc: { revision: '2026-10-06T12:00:00Z', cases: [{ id: 'CON-1', outcome: 'delivered', at: '2026-10-03T12:00:00Z' }] }, mtime: '2026-10-03T12:00:00Z' },
    'conf-b': { doc: { revision: '2026-10-02T12:00:00Z', cases: [{ id: 'CON-1', outcome: 'blocked', at: '2026-10-02T12:00:00Z' }] }, mtime: '2026-10-05T12:00:00Z' },
    // a reference-era receipt (no revision, no manifestRevision): its mtime serves as its revision (Q10c)
    'mt-old': { doc: { cases: [{ id: 'MT-1', outcome: 'blocked', at: '2026-10-02T12:00:00Z' }] }, mtime: '2026-10-09T12:00:00Z' },
    'mt-rev': { doc: { revision: '2026-10-01T12:00:00Z', cases: [{ id: 'MT-1', outcome: 'delivered', at: '2026-10-02T12:00:00Z' }] }, mtime: '2026-10-01T12:00:00Z' },
    // a stamped receipt without revision never uses its mtime: a missing revision ranks below any present one
    'nr-a': { doc: { manifestRevision: 1, cases: [{ id: 'NR-1', outcome: 'blocked', at: '2026-10-06T12:00:00Z' }] }, mtime: '2026-10-10T12:00:00Z' },
    'nr-b': { doc: { revision: '2026-09-01T12:00:00Z', cases: [{ id: 'NR-1', outcome: 'delivered', at: '2026-10-02T12:00:00Z' }] }, mtime: '2026-09-01T12:00:00Z' },
    // equal revision → later at; equal revision and at → lowest group
    'tie-a': { doc: { revision: '2026-10-03T12:00:00Z', cases: [{ id: 'TI-1', outcome: 'blocked', at: '2026-10-02T12:00:00Z' }] }, mtime: '2026-10-03T12:00:00Z' },
    'tie-b': { doc: { revision: '2026-10-03T12:00:00Z', cases: [{ id: 'TI-1', outcome: 'delivered', at: '2026-10-03T12:00:00Z' }] }, mtime: '2026-10-03T12:00:00Z' },
    'grp-a': { doc: { revision: '2026-10-03T12:00:00Z', cases: [{ id: 'GR-1', outcome: 'delivered', at: '2026-10-03T12:00:00Z' }] }, mtime: '2026-10-03T12:00:00Z' },
    'grp-b': { doc: { revision: '2026-10-03T12:00:00Z', cases: [{ id: 'GR-1', outcome: 'blocked', at: '2026-10-03T12:00:00Z' }] }, mtime: '2026-10-03T12:00:00Z' },
  } });
  const window = { since: Date.parse('2026-10-01T00:00:00Z'), until: Date.parse('2026-10-07T00:00:00Z') };
  const cases = underMig(RW, () => loadCases([join(repo, '.agents', 'automation')], TA_DEFAULTS_, { window }));
  assert.equal(cases.examined, 7);
  assert.equal(cases.reports, 13);
  assert.deepEqual(cases.outcomes, { delivered: 5, 'in-progress': 1, blocked: 1 });
  assert.equal(cases.delivered, 5, 'WIN-1, CON-1, NR-1, TI-1, GR-1');
  // the reference ordering under none: the last-written file (mtime, then path order) wins every id, revisions ignored:
  // CON-1 (conf-b), MT-1 (mt-old), NR-1 (nr-a) and GR-1 (grp-b) end blocked, TI-1 delivered (tie-b), REO-1 in-progress
  const ref = underMig('none', () => loadCases([join(repo, '.agents', 'automation')]));
  assert.deepEqual(ref, { examined: 7, delivered: 2, outcomes: { delivered: 2, 'in-progress': 1, blocked: 4 }, reports: 13 });
});

test('report-windows: an exact §5.2 rank tie keeps the later-read row with report-conflicts off; with it, the tie is a conflict', async () => {
  const { currentReceiptRows, compareReceiptRows } = await import('./team-report.mjs');
  const row = (outcome) => ({ id: 'X-1', outcome, revision: 1, at: 2, group: 'g', source: 'files' });
  const [first, second] = [row('blocked'), row('delivered')];
  assert.equal(compareReceiptRows(first, second), 0);
  assert.equal(currentReceiptRows([first, second]).get('X-1'), second);
  assert.equal(currentReceiptRows([second, first]).get('X-1'), first);
  // the same through loadCases: one receipt naming X-1 twice
  const repo = rwRepo({ receipts: { g: { doc: { revision: IN_WINDOW_AT, cases: [{ id: 'X-1', outcome: 'blocked', at: IN_WINDOW_AT }, { id: 'X-1', outcome: 'delivered', at: IN_WINDOW_AT }] } } } });
  const cases = underMig(RW, () => loadCases([join(repo, '.agents', 'automation')]));
  assert.deepEqual([cases.examined, cases.outcomes], [1, { delivered: 1 }]);
  // report-conflicts (item 22): the same tie is a conflict, in either read order — no winner, counted, previewed
  const rc = underMig('report-windows,report-conflicts', () => loadCases([join(repo, '.agents', 'automation')]));
  assert.deepEqual([rc.examined, rc.outcomes, rc.conflicts, rc.preview], [0, {}, 1, { examined: 1, delivered: 0, unwindowed: 0 }]);
});

test('report-windows: unwindowed count — delivered winners without at are excluded and counted', () => {
  const repo = rwRepo({ receipts: {
    old: { doc: { cases: [{ id: 'OLD-1', outcome: 'delivered', at: '2026-08-02T12:00:00Z' }] } },
    win: { doc: { cases: [{ id: 'WIN-1', outcome: 'delivered', at: '2026-10-05T12:00:00Z' }] } },
    und: { doc: { cases: [{ id: 'UND-1', outcome: 'delivered' }, { id: 'UND-2', outcome: 'blocked' }] } },
  } });
  const window = { since: Date.parse('2026-10-01T00:00:00Z'), until: Date.parse('2026-10-07T00:00:00Z') };
  const cases = underMig(RW, () => loadCases([join(repo, '.agents', 'automation')], TA_DEFAULTS_, { window }));
  assert.equal(cases.delivered, 1, 'WIN-1 only: OLD-1 lies before the window');
  assert.equal(cases.unwindowed, 1, 'UND-1');
  assert.equal(cases.examined, 4);
});

test('report-windows: null vs $0 vs partial', () => {
  const cases = (delivered) => ({ examined: 3, delivered, unwindowed: 0, outcomes: { delivered }, reports: 1 });
  const at = '2026-10-03T00:00:00Z';
  const build = (lines, c = cases(2)) => underMig(RW, () => buildReport(lines, c));
  assert.equal(build([rl('a', at, 'automation', 3)], cases(0)).perDelivered, null, 'denominator 0 → null');
  const noElig = build([rl('s', at, 'story', 3)]).perDelivered;
  assert.equal(noElig.costUsd, null, 'no eligible session → null');
  assert.equal(noElig.eligible, 0);
  const unpriced = build([rl('a', at, 'automation', null)]).perDelivered;
  assert.equal(unpriced.costUsd, null, 'none priced → null');
  assert.deepEqual([unpriced.eligible, unpriced.priced], [1, 0]);
  const zero = build([rl('a', at, 'automation', 0)]).perDelivered;
  assert.equal(zero.costUsd, 0, 'a measured $0 is distinct from null');
  assert.equal(zero.partial, undefined);
  const part = build([rl('a', at, 'automation', 3), rl('b', at, 'automation', null), rl('s', at, 'story', 7)]).perDelivered;
  assert.equal(part.costUsd, 1.5, 'priced eligible spend ÷ delivered');
  assert.deepEqual([part.partial, part.priced, part.eligible], [true, 1, 2]);
  assert.equal(part.automationOnlyCostUsd, undefined, 'the ratio is the scoped figure itself');
  assert.equal(underMig(RW, () => buildReport([rl('a', at, 'automation', 3)], { ...cases(2), roleFiltered: true })).perDelivered, null, 'role-filtered → suppressed');
});

test('report-windows: the report states current-state semantics and the cumulative-line limitation', async () => {
  const repo = rwRepo({ lines: [rl('a', '2026-10-05T00:00:00Z', 'automation', 1)] });
  const rep = await reportJson(repo);
  assert.match(rep.semantics, /current/i);
  assert.match(rep.semantics, /reopen/);
  assert.match(rep.semantics, /cumulative/);
  assert.match(rep.semantics, /without endedAt are outside every window and counted as undated/);
  for (const flag of [[], ['--html']]) {
    const out = join(tmp(), 'r.txt');
    assert.equal(await underMigA(RW, () => main([repo, '--since', '2026-10-01', '--until', '2026-10-07', ...flag, '--out', out])), 0);
    const text = readFileSync(out, 'utf8');
    assert.ok(text.includes(rep.semantics.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))), `semantics stated in ${flag[0] ?? 'markdown'}`);
    for (const bad of ['null', 'NaN', 'undefined', '$null']) assert.ok(!text.includes(bad), `${flag[0] ?? 'markdown'} renders no ${bad}`);
    if (!flag.length) assert.match(text, /active min \(all sessions\)/, 'the minutes are labelled all-sessions, not ratio-intent (HTML does not render them)');
  }
  const off = await reportJson(repo, ['--since', '2026-10-01', '--until', '2026-10-07'], 'none');
  assert.equal(off.semantics, undefined);
});

// O4 (map D1 historical binding; Codex P3-06): five tests
test('O4: a current-manifest change leaves historical lines\' eligibility unchanged', async () => {
  const lines = [rl('rv1', IN_WINDOW_AT, 'automation', 1, { manifestRevision: 1 }), rl('rv0', IN_WINDOW_AT, 'automation', 4),
    rl('rv2', IN_WINDOW_AT, 'story', 2, { manifestRevision: 2 }), rl('rs', IN_WINDOW_AT, 'story', 16)];
  const repo = rwRepo({ lines, current: mdoc(2, ['story']), archives: { 1: mdoc(1, ['automation']), 2: mdoc(2, ['story']) } });
  const before = (await reportJson(repo)).perDelivered.costUsd;
  assert.equal(before, 7, 'rv1 + rv0 + rv2');
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  writeFileSync(join(dir, 'module.json'), JSON.stringify(mdoc(3, ['spike', 'story'])));   // advanced to revision 3
  writeFileSync(join(dir, 'manifests', '3.json'), JSON.stringify(mdoc(3, ['spike', 'story'])));
  assert.equal((await reportJson(repo)).perDelivered.costUsd, before);
});

test('O4: revisionless line → implied legacy manifest, never the current module.json', async () => {
  const lines = [rl('a', IN_WINDOW_AT, 'automation', 4), rl('s', IN_WINDOW_AT, 'story', 16)];
  const rep = await reportJson(rwRepo({ lines, current: mdoc(1, ['story']), archives: { 1: mdoc(1, ['story']) } }));
  assert.equal(rep.perDelivered.costUsd, 4);
  assert.equal(rep.perDelivered.eligible, 1);
});

test('O4: manifestRevision N → manifests/N.json', async () => {
  const lines = [rl('s2', IN_WINDOW_AT, 'story', 2, { manifestRevision: 2 }), rl('a2', IN_WINDOW_AT, 'automation', 1, { manifestRevision: 2 }),
    rl('sp', IN_WINDOW_AT, 'spike', 32)];
  const rep = await reportJson(rwRepo({ lines, current: mdoc(3, ['spike']), archives: { 2: mdoc(2, ['story']), 3: mdoc(3, ['spike']) } }));
  assert.equal(rep.perDelivered.costUsd, 2);
  assert.equal(rep.unverified, undefined);
});

test('O4: missing archive → unverified + finding, excluded from eligible sessions, not reinterpreted', async () => {
  const lines = [rl('rv4', IN_WINDOW_AT, 'automation', 8, { manifestRevision: 4 }), rl('rv1', IN_WINDOW_AT, 'automation', 1, { manifestRevision: 1 })];
  const rep = await reportJson(rwRepo({ lines, current: mdoc(4, ['automation']), archives: { 1: mdoc(1, ['automation']) } }));
  assert.equal(rep.perDelivered.costUsd, 1, 'rv4 is not read under module.json although it declares revision 4');
  assert.equal(rep.perDelivered.eligible, 1);
  assert.deepEqual(rep.unverified, { sessions: 1, costUsd: 8, priced: 1 }, 'beside the ratio, never in its numerator');
  assert.deepEqual(rep.findings, ['manifest-archive-missing: revision 4']);
  assert.equal(rep.totals.costUsd, 9, 'its spend stays in the totals');
});

test('O4: delivered outcomes follow the line\'s revision', async () => {
  const at = IN_WINDOW_AT;
  const rep = await reportJson(rwRepo({
    lines: [rl('a', at, 'automation', 6)],
    current: mdoc(2, ['automation'], ['done']), archives: { 2: mdoc(2, ['automation'], ['done']) },
    receipts: {
      a: { doc: { manifestRevision: 2, revision: at, cases: [{ id: 'D-1', outcome: 'done', at }] } },      // revision 2: 'done' is delivered
      b: { doc: { cases: [{ id: 'D-2', outcome: 'done', at }] } },                                       // revisionless: the TA settings policy, 'done' is not
      c: { doc: { cases: [{ id: 'D-3', outcome: 'delivered', at }] } },                                  // revisionless: delivered
      d: { doc: { manifestRevision: 5, revision: at, cases: [{ id: 'D-4', outcome: 'delivered', at }] } }, // no archive: never counted
    },
  }));
  assert.equal(rep.cases.delivered, 2, 'D-1 and D-3');
  assert.deepEqual(rep.cases.outcomes, { done: 2, delivered: 2 });
  assert.equal(rep.perDelivered.costUsd, 3);
  assert.deepEqual(rep.findings, ['manifest-archive-missing: revision 5']);
});

// Codex B2-05 (review §1.B STAMPED_RECEIPT): one resolved delivered vocabulary per receipt — the period denominator,
// the by-group rows (batch-cost) and the delivered-only per-case statistics agree, and current settings never
// reinterpret a stamped receipt. Drives the shipped CLI with the default migration set.
test('B2-05: a stamped receipt is read by its archive in the denominator, byBatch and per-case statistics alike (real CLI)', () => {
  const q = (n) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
  const sess = (id, batch, cases, costUsd) => ({ v: 1, host: 'copilot', id, user: 'u', repo: 'r', role: 'lead', cases,
    startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T01:00:00Z', capturedAt: '2026-10-01T01:01:00Z', manifestRevision: 2,
    tokens: q(100), tokensByModel: { model: q(100) }, models: ['model'], costUsd, activeMin: 60, wallMin: 60, turns: 1, toolCalls: 0, toolErrors: 0,
    scope: { intent: 'automation', batch, cases }, subagents: [] });
  const repo = tmp();
  const put = (rel, o) => { const f = join(repo, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof o === 'string' ? o : JSON.stringify(o)); };
  const man = { module: 'tokenomics', schema_version: '1.0', domain: 'test', manifestRevision: 2, ratioIntents: ['automation'],
    receipts: { source: 'files', root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['done'] } };
  put('.agents/tokenomics/settings.json', { extension: null, reports: { location: 'tree' } });   // current settings: TA vocabulary
  put('.agents/telemetry/automation/module.json', man);
  put('.agents/telemetry/automation/manifests/2.json', man);
  put('.agents/telemetry/automation/usage-u.jsonl', jsonl([sess('s1', 'g', ['TC-1'], 10), sess('s2', 'h', ['TC-2'], 4), sess('s3', 'k', ['TC-3'], 2)]));
  const at = '2026-10-01T01:00:00Z';
  put('.agents/automation/g/report.json', { manifestRevision: 2, revision: at, cases: [{ id: 'TC-1', outcome: 'done', at }] });       // archive: 'done' delivered
  put('.agents/automation/h/report.json', { manifestRevision: 7, revision: at, cases: [{ id: 'TC-2', outcome: 'delivered', at }] });  // no archive: unverified
  put('.agents/automation/k/report.json', { cases: [{ id: 'TC-3', outcome: 'delivered', at }] });                                    // revisionless: settings
  const env = { ...process.env, TOKENOMICS_NO_CCUSAGE: '1' };
  delete env.TOKENOMICS_MIGRATIONS;
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./team-report.mjs', import.meta.url)), repo, '--since', '2026-10-01', '--until', '2026-10-02', '--json'],
    { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.cases.delivered, 2, 'TC-1 (archive) and TC-3 (settings); TC-2 unverified');
  const g = Object.fromEntries(rep.byBatch.map((b) => [b.batch, b]));
  assert.equal(g.g.delivered, 1, "byBatch reads g's receipt by its archive: 'done' is delivered");
  assert.equal(g.g.perDelivered, 10);
  assert.equal(g.h.delivered, 0, 'a missing archive delivers nothing, never the current settings');
  assert.equal(g.h.perDelivered, null);
  assert.deepEqual(g.h.findings, ['manifest-archive-missing: revision 7']);
  assert.equal(g.k.delivered, 1, 'a revisionless receipt keeps the settings policy (Task 11 ruling)');
  assert.equal(g.g.findings, undefined);
  assert.equal(rep.byBatch.reduce((n, b) => n + b.delivered, 0), rep.cases.delivered + rep.cases.unwindowed, 'one report never contradicts itself');
  assert.deepEqual(rep.findings, ['manifest-archive-missing: revision 7']);
  assert.equal(rep.perCaseStats.loadedCostUsd.n, 2, 'per-case statistics are over TC-1 and TC-3');
  assert.deepEqual(rep.perCase.slice(0, 2).map((c) => c.id).sort(), ['TC-1', 'TC-3'], 'delivered rows first');
  // changing current settings never reinterprets the stamped receipt's history
  put('.agents/tokenomics/settings.json', { extension: null, reports: { location: 'tree' }, receipts: { deliveredOutcomes: ['delivered', 'done'] } });
  const r2 = spawnSync(process.execPath, [fileURLToPath(new URL('./team-report.mjs', import.meta.url)), repo, '--since', '2026-10-01', '--until', '2026-10-02', '--json'],
    { encoding: 'utf8', env });
  assert.equal(r2.status, 0, r2.stderr);
  const rep2 = JSON.parse(r2.stdout);
  assert.deepEqual(rep2.byBatch.map((b) => [b.batch, b.delivered]), rep.byBatch.map((b) => [b.batch, b.delivered]));
  assert.equal(rep2.cases.delivered, 2);
});

// --- report-windows review round 1 ------------------------------------------------------------------------------
test('I1: a non-TA settings policy counts its delivered outcomes; window, outcomes and by-group agree', async () => {
  const repo = tmp();
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ dir: 'stories',
    receipts: { root: '.agents/stories', file: 'receipt.json', deliveredOutcomes: ['done'] }, intents: { default: 'story' }, extension: null }));
  const tdir = join(repo, '.agents', 'telemetry', 'stories');
  mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, 'usage-alice.jsonl'), jsonl([rl('s1', IN_WINDOW_AT, 'story', 2, { scope: { intent: 'story', batch: 'sp1', cases: ['S-1'] } })]));
  for (const [g, row] of [['sp1', { id: 'S-1', outcome: 'done', at: IN_WINDOW_AT }], ['sp2', { id: 'S-2', outcome: 'done' }]]) {
    mkdirSync(join(repo, '.agents', 'stories', g), { recursive: true });
    writeFileSync(join(repo, '.agents', 'stories', g, 'receipt.json'), JSON.stringify({ cases: [row] }));
  }
  const rep = await reportJson(repo);
  assert.equal(rep.cases.delivered, 1, "S-1: 'done' is delivered under the settings policy that discovered the receipt");
  assert.equal(rep.cases.unwindowed, 1, 'S-2: delivered, no at');
  assert.deepEqual(rep.cases.outcomes, { done: 2 });
  const byGroup = rep.byBatch.reduce((n, b) => n + b.delivered, 0);
  assert.equal(byGroup, rep.cases.delivered + rep.cases.unwindowed, 'the by-group delivered count agrees with window + unwindowed');
  assert.equal(rep.findings, undefined);
});

test('I2: lines without a readable endedAt are counted as undated beside the ratio, never in a window total', async () => {
  const lines = [rl('a', IN_WINDOW_AT, 'automation', 1), rl('n1', null, 'automation', 2), rl('n2', 'not-a-date', 'story', null)];
  const repo = rwRepo({ lines });
  const rep = await reportJson(repo);
  assert.deepEqual(rep.undated, { sessions: 2, costUsd: 2, priced: 1 });
  assert.equal(rep.totals.sessions, 1);
  assert.equal(rep.totals.costUsd, 1);
  assert.equal(rep.perDelivered.costUsd, 1, 'never in the numerator');
  for (const flag of [[], ['--html']]) {
    const out = join(tmp(), 'u.txt');
    assert.equal(await underMigA(RW, () => main([repo, '--since', '2026-10-01', '--until', '2026-10-07', ...flag, '--out', out])), 0);
    assert.match(readFileSync(out, 'utf8'), /2 session\(s\) without endedAt \(\$2\.00, 1 of 2 priced\) — outside every window/);
  }
  assert.equal((await reportJson(rwRepo({ lines: [lines[0]] }))).undated, undefined, 'absent when zero');
  const unpriced = await reportJson(rwRepo({ lines: [lines[0], lines[2]] }));
  assert.deepEqual(unpriced.undated, { sessions: 1, costUsd: null, priced: 0 });
});

test('M1: offset-less date-times read as UTC, non-ISO forms refused (flags) or ignored (receipt at), under a non-UTC TZ', () => {
  const repo = rwRepo({ lines: [rl('a', IN_WINDOW_AT, 'automation', 1)], receipts: {
    r1: { doc: { cases: [{ id: 'A-1', outcome: 'delivered', at: '2026-10-01T05:30' }] } },   // UTC 05:30: inside [05:00Z, …)
    r2: { doc: { cases: [{ id: 'A-2', outcome: 'delivered', at: 'Oct 3 2026' }] } },         // not ISO: no at → unwindowed
  } });
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('./team-report.mjs', import.meta.url)), repo, ...args, '--json'],
    { encoding: 'utf8', env: { ...process.env, TZ: 'Europe/Budapest', TOKENOMICS_MIGRATIONS: RW, TOKENOMICS_NO_CCUSAGE: '1' } });
  const ok = run('--since', '2026-10-01T05:00', '--until', '2026-10-07');
  assert.equal(ok.status, 0, ok.stderr);
  const rep = JSON.parse(ok.stdout);
  assert.equal(rep.window, '2026-10-01T05:00:00.000Z → 2026-10-07T00:00:00.000Z');
  assert.equal(rep.cases.delivered, 1, 'A-1 at 05:30 UTC, never 03:30Z (Budapest local)');
  assert.equal(rep.cases.unwindowed, 1, 'A-2: a non-ISO at counts as no at');
  for (const bad of ['Oct 1 2026', '2026-10', '2026-13-45']) {
    const r = run('--since', bad);
    assert.equal(r.status, 2, bad);
    assert.match(r.stderr, /--since '.*' is not an ISO-8601 date \(YYYY-MM-DD\) or date-time; a date-time without an offset is read as UTC/);
  }
});

// B2 item 10 (reports-location): the period report's By-group table finds a relocated cost.json AND a
// tree-located one from an older run in the same repo (mixed eras read by what is on disk, O10).
test('reports-location: the period report reads relocated and tree-located cost.json side by side', async () => {
  const repo = tmp();
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({
    dir: 'stories', receipts: { root: '.agents/stories', file: 'receipt.json', deliveredOutcomes: ['done'] },
    intents: { default: 'story' }, vocabulary: { item: 'story', group: 'sprint', delivered: 'done' },
    ids: { patterns: ['\\bissue-\\d{1,6}\\b'], flags: '', max: 50, stoplist: [] }, extension: null,
  }));
  for (const [g, id] of [['sp1', 'issue-101'], ['sp2', 'issue-102']]) {
    mkdirSync(join(repo, '.agents', 'stories', g), { recursive: true });
    writeFileSync(join(repo, '.agents', 'stories', g, 'receipt.json'), JSON.stringify({ batch: g, cases: [{ id, outcome: 'done' }] }));
  }
  mkdirSync(join(repo, '.agents', 'telemetry', 'stories'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'telemetry', 'stories', 'usage-alice.jsonl'), jsonl([line({ cases: ['issue-101', 'issue-102'], role: null, scope: { intent: 'story', batch: 'sp1', cases: ['issue-101'] } })]));
  // sp1: closed after the upgrade (cost.json relocated); sp2: an older run left its cost.json in the tree
  const { updateBatchCosts } = await import('./batch-cost.mjs');
  const { loadSettings } = await import('../engine/config.mjs');
  const env = { ...process.env, TOKENOMICS_MIGRATIONS: 'reports-location' };
  const settings = loadSettings(repo, env);
  assert.equal(settings.reports.location, 'telemetry');
  await underMigA('reports-location', () => updateBatchCosts(repo, { batch: 'sp1' }, settings, null));
  writeFileSync(join(repo, '.agents', 'stories', 'sp2', 'cost.json'), '{"v":1,"batch":"sp2"}\n');
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(join(repo, '.agents', 'telemetry', 'stories', 'reports', 'sp1', 'cost.json')));
  assert.ok(!existsSync(join(repo, '.agents', 'stories', 'sp1', 'cost.json')));
  const out = join(tmp(), 'period.md');
  assert.equal(await underMigA('reports-location', () => main([repo, '--out', out])), 0);
  const md = readFileSync(out, 'utf8');
  assert.match(md, /## By sprint/);
  assert.match(md, /\| sp1 \|/);
  assert.match(md, /\| sp2 \|/);
  assert.doesNotMatch(md, /\| reports\/sp1 \|/, 'the relocated directory is never mistaken for a receipt group');
});

// --- B2 item 11: writer — Review Focus 2 (mixed-era ledgers; O10: readers decide by line fields) --------------
test('a mixed-era ledger (reference-era, B1-era, inclusive Copilot, writer lines) gives the same period report under TOKENOMICS_MIGRATIONS unset and with copilot-inclusive excluded', async () => {
  const { MIGRATIONS } = await import('../engine/migrations.mjs');
  const q = (input, output = 0) => ({ input, output, cacheRead: 0, cacheWrite: 0 });
  const sub = (role, tokens) => ({ role, n: 1, tokens, activeMin: 2, toolCalls: 3, toolErrors: 0 });
  const W = { writer: 'tokenomics-engine@1.2.0', manifestRevision: 2 };
  // Revision 2 counts only `story`; the implied legacy manifest (revisionless lines) only `automation`. Each era has a
  // line its own manifest counts and a decoy only the other era's manifest would count (review round 1, M1).
  const lines = [
    // reference-era Claude line: no writer, parent + dispatch tokens — counted (implied: automation)
    rl('ref-cl', '2026-10-02T10:00:00Z', 'automation', 1, { tokens: q(100, 10), subagents: [sub('qa-engineer', q(50))] }),
    // B1-era Copilot line: no writer, no tokensBasis (netted parent + dispatch totals) — counted (implied: automation)
    rl('b1-cp', '2026-10-02T11:00:00Z', 'automation', 2, { host: 'copilot', costSource: 'copilot-nano-aiu', tokens: q(200), subagents: [sub('qa-engineer', q(70))] }),
    // reference-era decoy: story is not a ratio intent of the implied manifest
    rl('ref-story', '2026-10-02T12:00:00Z', 'story', 8, { tokens: q(1) }),
    // inclusive Copilot line under revision 2 (the session total already includes its dispatches) — counted (rev 2: story)
    rl('in-cp', '2026-10-03T10:00:00Z', 'story', 3, { ...W, host: 'copilot', costSource: 'copilot-nano-aiu', tokensBasis: 'inclusive', tokens: q(400, 40), subagents: [sub('qa-engineer', null)] }),
    // writer Claude line under revision 2 — counted (rev 2: story)
    rl('wr-cl', '2026-10-04T10:00:00Z', 'story', 4, { ...W, tokens: q(800, 80), subagents: [sub('qa-engineer', q(30))] }),
    // writer decoy: automation is not a ratio intent of revision 2
    rl('wr-auto', '2026-10-04T11:00:00Z', 'automation', 16, { ...W, tokens: q(1) }),
  ];
  const repo = rwRepo({ lines, current: mdoc(2, ['story']), archives: { 2: mdoc(2, ['story']) } });
  const was = process.env.TOKENOMICS_MIGRATIONS;
  delete process.env.TOKENOMICS_MIGRATIONS;   // unset: every landed migration
  let unset;
  try {
    const out = join(tmp(), 'r.json');
    assert.equal(await main([repo, '--since', '2026-10-01', '--until', '2026-10-07', '--json', '--out', out]), 0);
    unset = JSON.parse(readFileSync(out, 'utf8'));
  } finally { if (was === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = was; }
  const noCi = MIGRATIONS.filter((m) => m.landed && m.id !== 'copilot-inclusive').map((m) => m.id).join(',');
  assert.ok(noCi.includes('writer'), 'writer has landed');
  const excluded = await reportJson(repo, ['--since', '2026-10-01', '--until', '2026-10-07'], noCi);
  for (const [name, rep] of [['unset', unset], ['copilot-inclusive excluded', excluded]]) {
    // each line by its own era: ref-cl, b1-cp (implied) and in-cp, wr-cl (revision 2); never the decoys
    assert.equal(rep.perDelivered.eligible, 4, name);
    assert.equal(rep.perDelivered.costUsd, 1 + 2 + 3 + 4, `${name}: one delivered item`);
    // each line by its own basis: the inclusive line contributes its session total only
    assert.deepEqual(rep.totals.tokens, q(100 + 50 + 200 + 70 + 1 + 400 + 800 + 30 + 1, 10 + 40 + 80), name);
    assert.equal(rep.totals.sessions, 6, name);
    assert.equal(rep.unverified, undefined, `${name}: revision 2 lines bind to manifests/2.json`);
  }
  const { generated: _g1, ...a } = excluded; const { generated: _g2, ...b } = unset;
  assert.deepEqual(a, b, 'the switch set never changes how a persisted line is read');
});

test('writer (review round 1, I1): a writer line with manifestRevision null is unverified — excluded from the ratio, counted, with a finding', async () => {
  const lines = [
    rl('ok', '2026-10-02T10:00:00Z', 'automation', 1),
    rl('nul', '2026-10-03T10:00:00Z', 'feature', 5, { writer: 'tokenomics-engine@1.2.0', manifestRevision: null }),
  ];
  // a non-TA module.json without a revision: the writer stamped null, never the implied 1
  const repo = rwRepo({ lines, current: { module: 'tokenomics', schema_version: '1.0', domain: 'stories', ratioIntents: ['feature'] } });
  const rep = await reportJson(repo);
  assert.equal(rep.perDelivered.eligible, 1, 'only the revisionless line, under the implied manifest');
  assert.deepEqual(rep.unverified, { sessions: 1, costUsd: 5, priced: 1 });
  assert.ok(rep.findings.includes('manifest-revision-unknown'), JSON.stringify(rep.findings));
  assert.equal(rep.totals.sessions, 2, 'kept in the totals');
});

// --- B2 item 22: report-conflicts (spec 3.5, 3.3; map R20, obligation O2; owner Q16) ---------------------------------
const RC = 'report-windows,report-conflicts';
const TIE = '2026-10-03T10:00:00Z';
// d4-shaped: one session id, an exact (endedAt, capturedAt) rank tie
const tied = (costUsd, over = {}) => rl('x', TIE, 'automation', costUsd, over);

test('report-conflicts: exact tie, identical payload → one duplicate', async () => {
  const { dedupConflicts } = await import('./team-report.mjs');
  // observer labels (user, repo, branch) are outside the accounting payload (spec 3.3)
  const a = tied(8); const b = tied(8, { user: 'bob', repo: 'zr', branch: 'zb' });
  const r = dedupConflicts([a, b, rl('y', TIE, 'automation', 1)]);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.preview, []);
  assert.deepEqual(r.winners.map((l) => l.id), ['x', 'y']);
  assert.equal(r.winners[0], a, 'the lowest full canonical line represents the payload (main < zb)');
  const rep = await reportJson(rwRepo({ lines: [b, a] }), undefined, RC);
  assert.equal(rep.sessions, 1);
  assert.equal(rep.totals.costUsd, 8);
  assert.equal(rep.conflicts, undefined);
  assert.equal(rep.preview, undefined);
});

test('report-conflicts: exact tie, different payload → conflict: excluded from verified totals; preview total picks the lowest canonical JSON; conflicts: 1', async () => {
  const { dedupConflicts } = await import('./team-report.mjs');
  const lo = tied(8); const hi = tied(800, { startedAt: '2026-10-03T09:00:00Z' });
  const r = dedupConflicts([hi, lo]);
  assert.deepEqual(r.winners, []);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].key, 'claude:x');
  assert.deepEqual(r.conflicts[0].lines, [lo, hi], 'sorted by canonical accounting payload');
  assert.deepEqual(r.preview, [lo], 'the lowest canonical JSON: "costUsd":8, sorts before "costUsd":800');
  const rep = await reportJson(rwRepo({ lines: [hi, lo, rl('y', TIE, 'automation', 1)] }), undefined, RC);
  assert.equal(rep.sessions, 1, 'the conflicted session leaves every verified total');
  assert.equal(rep.totals.costUsd, 1);
  assert.equal(rep.byPerson.alice.sessions, 1);
  assert.equal(rep.perDelivered.costUsd, 1, 'and the ratio numerator');
  assert.deepEqual(rep.conflicts, { sessions: 1, costUsd: 8, priced: 1 });
  assert.deepEqual(rep.preview, { sessions: 2, costUsd: 9, priced: 2 });
  // never silently: rendered in Markdown and HTML (O1)
  const md = join(tmp(), 'r.md'); const html = join(tmp(), 'r.html');
  const repo = rwRepo({ lines: [hi, lo, rl('y', TIE, 'automation', 1)] });
  assert.equal(await underMigA(RC, () => main([repo, '--since', '2026-10-01', '--until', '2026-10-07', '--out', md])), 0);
  assert.equal(await underMigA(RC, () => main([repo, '--since', '2026-10-01', '--until', '2026-10-07', '--html', '--out', html])), 0);
  for (const f of [md, html]) assert.match(readFileSync(f, 'utf8'), /1 session\(s\) in conflict \(\$8\.00, 1 of 1 priced\).*preview total incl\. the lowest-canonical-JSON pick: \$9\.00 over 2 session\(s\)/);
});

test('report-conflicts: forward = reversed input order', async () => {
  const { dedupConflicts } = await import('./team-report.mjs');
  const lines = [tied(800, { startedAt: '2026-10-03T09:00:00Z' }), tied(8), tied(8, { user: 'bob' }), rl('y', TIE, 'automation', 1),
    rl('z', TIE, 'automation', 2, { capturedAt: '2026-10-03T10:00:01Z' }), rl('z', TIE, 'automation', 3)];
  const fwd = dedupConflicts(lines); const rev = dedupConflicts([...lines].reverse());
  assert.deepEqual([fwd.preview, fwd.duplicates, fwd.conflicts], [rev.preview, rev.duplicates, rev.conflicts]);
  assert.deepEqual(new Set(fwd.winners), new Set(rev.winners));
  const strip = ({ generated: _g, window: _w, ...rep }) => rep;
  const a = strip(await reportJson(rwRepo({ lines }), undefined, RC));
  const b = strip(await reportJson(rwRepo({ lines: [...lines].reverse() }), undefined, RC));
  assert.deepEqual(a.totals, b.totals);
  assert.deepEqual([a.conflicts, a.preview], [b.conflicts, b.preview]);
  assert.deepEqual([a.conflicts, a.preview], [{ sessions: 1, costUsd: 8, priced: 1 }, { sessions: 3, costUsd: 11, priced: 3 }]);
  // the reference dedup (migrations off) depends on input order: the first line of the tie wins (map R20, Repro E)
  const ref = (ls) => underMig('none', () => dedupLines(ls)).find((l) => l.id === 'x').costUsd;
  assert.deepEqual([ref(lines), ref([...lines].reverse())], [800, 8]);
});

test('report-conflicts: without the migration the report keeps the reference first-wins dedup and no conflict field', async () => {
  const rep = await reportJson(rwRepo({ lines: [tied(800), tied(8)] }), undefined, RW);
  assert.equal(rep.totals.costUsd, 800);
  assert.equal(rep.conflicts, undefined);
  assert.equal(rep.preview, undefined);
});

test('report-conflicts: the legacy window (report-windows off) and --role apply to the preview picks too', async () => {
  const lines = [tied(800, { startedAt: '2026-10-03T09:00:00Z' }), tied(8), rl('y', TIE, 'automation', 1, { role: 'other' })];
  const rep = await reportJson(rwRepo({ lines }), ['--since', '2026-10-01', '--until', '2026-10-07'], 'report-conflicts');
  assert.deepEqual([rep.sessions, rep.conflicts, rep.preview], [1, { sessions: 1, costUsd: 8, priced: 1 }, { sessions: 2, costUsd: 9, priced: 2 }]);
  const outside = await reportJson(rwRepo({ lines }), ['--since', '2026-11-01'], 'report-conflicts');
  assert.deepEqual([outside.sessions, outside.conflicts], [0, undefined]);
  const role = await reportJson(rwRepo({ lines }), ['--role', 'other'], RC);
  assert.deepEqual([role.sessions, role.conflicts], [1, undefined], 'the pick is a test-automation-lead session');
});

test('report-conflicts (review round 1, I2): a conflicted session without endedAt is a conflict, never undated; undated counts only unconflicted lines', async () => {
  const lines = [rl('n', null, 'automation', 1600, { capturedAt: null, startedAt: '2026-10-03T09:00:00Z' }), rl('n', null, 'automation', 16, { capturedAt: null }),
    rl('u', null, 'automation', 2), rl('y', TIE, 'automation', 1)];
  const rep = await reportJson(rwRepo({ lines }), undefined, RC);
  assert.deepEqual(rep.undated, { sessions: 1, costUsd: 2, priced: 1 }, 'u only');
  assert.deepEqual(rep.conflicts, { sessions: 1, costUsd: 16, priced: 1 });
  assert.deepEqual(rep.preview, { sessions: 2, costUsd: 17, priced: 2 });
});

test('report-conflicts (review round 1, I1): --role — a conflict is in scope when any of its tied lines is', async () => {
  const lines = [tied(7, { role: 'zzz' }), tied(5, { role: 'aaa' }), rl('y', TIE, 'automation', 1, { role: 'zzz' })];
  const rep = await reportJson(rwRepo({ lines }), ['--role', 'zzz', '--since', '2026-10-01', '--until', '2026-10-07'], RC);
  assert.equal(rep.sessions, 1);
  assert.deepEqual(rep.conflicts, { sessions: 1, costUsd: 5, priced: 1 }, 'the zzz line is in scope; the pick (lowest canonical JSON: $5, role aaa) is previewed');
  assert.deepEqual(rep.preview, { sessions: 2, costUsd: 6, priced: 2 });
  const none = await reportJson(rwRepo({ lines }), ['--role', 'bbb', '--since', '2026-10-01', '--until', '2026-10-07'], RC);
  assert.equal(none.conflicts, undefined, 'no tied line has role bbb');
});

test('report-conflicts (review round 1, I1): legacy startedAt window — a conflict is in scope when any of its tied lines is', async () => {
  const lines = [tied(7, { startedAt: '2026-10-02T09:00:00Z' }), tied(5, { startedAt: '2026-09-30T09:00:00Z' }), rl('y', TIE, 'automation', 1)];
  const rep = await reportJson(rwRepo({ lines }), ['--since', '2026-10-01', '--until', '2026-10-07'], 'report-conflicts');
  assert.equal(rep.sessions, 1);
  assert.deepEqual(rep.conflicts, { sessions: 1, costUsd: 5, priced: 1 }, 'the 10-02 line is in the window; its pick (09-30, $5) is previewed');
  assert.deepEqual(rep.preview, { sessions: 2, costUsd: 6, priced: 2 });
});

test('report-conflicts (review round 1, I3): --json and Markdown are byte-identical for forward and reversed input (fractional costs)', async () => {
  const lines = [rl('a', '2026-10-02T10:00:00Z', 'automation', 0.1, { user: 'alice' }), rl('b', '2026-10-02T11:00:00Z', 'story', 0.2, { user: 'carol' }),
    rl('c', '2026-10-02T12:00:00Z', 'automation', 0.3, { user: 'alice' }), tied(0.1, { user: 'carol' }), tied(0.2, { user: 'carol', startedAt: '2026-10-03T09:00:00Z' })];
  const args = ['--since', '2026-10-01', '--until', '2026-10-07'];
  const run = async (ls, extra) => {
    const out = join(tmp(), 'r.out');
    assert.equal(await underMigA(RC, () => main([rwRepo({ lines: ls }), ...args, ...extra, '--out', out])), 0);
    return readFileSync(out, 'utf8').replace(/"generated": "[^"]+"/, '').replace(/^Generated: \S+/m, '');
  };
  for (const extra of [['--json'], []]) assert.equal(await run(lines, extra), await run([...lines].reverse(), extra), extra.join(' ') || 'markdown');
  const rep = await reportJson(rwRepo({ lines: [...lines].reverse() }), args, RC);
  assert.equal(rep.totals.costUsd, 0.1 + 0.2 + 0.3, 'summed in key order (a, b, c)');
  assert.deepEqual(Object.keys(rep.byPerson), ['alice', 'carol']);
});

test('report-conflicts: a restamp line outranks its winner (newer capturedAt) and never creates a conflict', async () => {
  const { dedupConflicts } = await import('./team-report.mjs');
  const { restampedLine } = await import('./work-scope.mjs');
  const winner = tied(4, { writer: 'tokenomics-engine@0.9.0', manifestRevision: 1 });
  const re = restampedLine(winner, { intent: 'story', batch: null, cases: [] }, { restampedBy: 'tokenomics-engine@1.2.0', now: '2026-10-05T00:00:00.000Z' });
  for (const order of [[winner, re], [re, winner]]) {
    const r = dedupConflicts(order);
    assert.deepEqual([r.winners, r.conflicts, r.duplicates], [[re], [], 0]);
  }
});

test('report-conflicts: an exact §5.2 receipt tie with a different payload is a conflict — excluded from the counts, with a deterministic preview', async () => {
  const { receiptWinners } = await import('./team-report.mjs');
  const row = (outcome, id = 'X-1') => ({ id, outcome, revision: 1, at: 2, group: 'g', source: 'files', delivered: outcome === 'delivered' });
  const [first, second] = [row('blocked'), row('delivered')];
  for (const order of [[first, second], [second, first]]) {
    const r = receiptWinners([...order, row('delivered', 'Y-1'), row('delivered', 'Y-1')]);
    assert.deepEqual([...r.win.keys()], ['Y-1'], 'an identical row is a duplicate; the tie with a different payload is not a winner');
    assert.equal(r.duplicates, 1);
    assert.deepEqual(r.conflicts.map((c) => c.id), ['X-1']);
    assert.equal(r.preview.get('X-1'), first, 'lowest canonical JSON: "delivered":false sorts before "delivered":true');
  }
  const repo = rwRepo({ receipts: { g: { doc: { revision: IN_WINDOW_AT, cases: [{ id: 'X-1', outcome: 'delivered', at: IN_WINDOW_AT }, { id: 'X-1', outcome: 'blocked', at: IN_WINDOW_AT }, { id: 'Y-1', outcome: 'delivered', at: IN_WINDOW_AT }] } } } });
  const window = { since: Date.parse('2026-10-01T00:00:00Z'), until: Date.parse('2026-10-07T00:00:00Z') };
  const cases = underMig(RC, () => loadCases([join(repo, '.agents', 'automation')], TA_DEFAULTS_, { window }));
  assert.deepEqual([cases.examined, cases.delivered, cases.outcomes], [1, 1, { delivered: 1 }]);
  assert.deepEqual([cases.conflicts, cases.preview], [1, { examined: 2, delivered: 1, unwindowed: 0 }]);
  const md = join(tmp(), 'r.md');
  assert.equal(await underMigA(RC, () => main([repo, '--since', '2026-10-01', '--until', '2026-10-07', '--out', md])), 0);
  assert.match(readFileSync(md, 'utf8'), /1 case\(s\) with conflicting receipts at an exact rank tie — excluded from these counts; preview: 1 delivered of 2 examined/);
});

test('report-conflicts (review round 1, M2): the receipt preview counts a delivered pick without at as unwindowed', () => {
  const repo = rwRepo({ receipts: { g: { doc: { revision: IN_WINDOW_AT, cases: [{ id: 'X-1', outcome: 'delivered' }, { id: 'X-1', outcome: 'automated' }] } } } });
  const window = { since: Date.parse('2026-10-01T00:00:00Z'), until: Date.parse('2026-10-07T00:00:00Z') };
  const cases = underMig(RC, () => loadCases([join(repo, '.agents', 'automation')], TA_DEFAULTS_, { window }));
  assert.deepEqual([cases.examined, cases.unwindowed, cases.conflicts, cases.preview], [0, 0, 1, { examined: 1, delivered: 0, unwindowed: 1 }]);
});

test('report-conflicts (review round 1, M3): two roots with the same group and rank but different manifest bindings are a receipt conflict', () => {
  // root A: an unstamped receipt (delivered by settings.receipts); root B: stamped with a revision whose archive is missing (delivers nothing)
  const a = rwRepo({ receipts: { g: { doc: { revision: IN_WINDOW_AT, cases: [{ id: 'S-1', outcome: 'delivered', at: IN_WINDOW_AT }] } } } });
  const b = rwRepo({ receipts: { g: { doc: { revision: IN_WINDOW_AT, manifestRevision: 9, cases: [{ id: 'S-1', outcome: 'delivered', at: IN_WINDOW_AT }] } } } });
  const window = { since: Date.parse('2026-10-01T00:00:00Z'), until: Date.parse('2026-10-07T00:00:00Z') };
  const dirs = [a, b].map((r) => join(r, '.agents', 'automation'));
  const tdirs = [a, b].map((r) => join(r, '.agents', 'telemetry', 'automation'));
  const cases = underMig(RC, () => loadCases(dirs, TA_DEFAULTS_, { window, telemetryDirs: tdirs }));
  assert.deepEqual([cases.examined, cases.delivered, cases.conflicts], [0, 0, 1], 'same outcome, different delivered: an accounting disagreement');
  assert.deepEqual(cases.preview, { examined: 1, delivered: 0, unwindowed: 0 }, 'the pick is the lowest canonical row ("delivered":false)');
  assert.deepEqual(cases.findings, ['manifest-archive-missing: revision 9']);
  // with report-conflicts off the later-read row (root B) wins
  assert.deepEqual(underMig(RW, () => loadCases(dirs, TA_DEFAULTS_, { window, telemetryDirs: tdirs })).delivered, 0);
});

// --- B2 item 24: report-revision — the period report records the current manifest's revision (spec 14.4, map O6) ---
const RR = 'report-revision';
const rrLines = [rl('a', IN_WINDOW_AT, 'automation', 2)];
const rrRun = async (repo, extra, mig = RR) => {
  const out = join(tmp(), 'r.out');
  assert.equal(await underMigA(mig, () => main([repo, '--since', '2026-10-01', '--until', '2026-10-07', ...extra, '--out', out])), 0);
  return readFileSync(out, 'utf8');
};

test('report-revision: period --json has manifestRevision right after generated; implied -> 1; module.json -> its revision', async () => {
  const implied = JSON.parse(await rrRun(rwRepo({ lines: rrLines }), ['--json']));
  assert.deepEqual(Object.keys(implied).slice(0, 3), ['generated', 'manifestRevision', 'window']);
  assert.equal(implied.manifestRevision, 1);
  assert.ok(!('manifestRevisions' in implied), 'one directory: no list');
  const cur = JSON.parse(await rrRun(rwRepo({ lines: rrLines, current: mdoc(6, ['automation']) }), ['--json']));
  assert.equal(cur.manifestRevision, 6);
  // unusable module.json -> null (the writer rule), never 1
  const bad = rwRepo({ lines: rrLines }); writeFileSync(join(bad, '.agents', 'telemetry', 'automation', 'module.json'), '{oops');
  assert.equal(JSON.parse(await rrRun(bad, ['--json'])).manifestRevision, null);
  // off: reference shape
  assert.ok(!('manifestRevision' in JSON.parse(await rrRun(rwRepo({ lines: rrLines }), ['--json'], RW))));
});

test('report-revision: period markdown and html end with the footer line; unknown reads "manifest revision unknown"', async () => {
  const repo = rwRepo({ lines: rrLines, current: mdoc(6, ['automation']) });
  assert.match(await rrRun(repo, []), /\nmanifest revision 6\n$/);
  assert.match(await rrRun(repo, ['--html']), /<p class="meta">manifest revision 6<\/p>\s*$/);
  const bad = rwRepo({ lines: rrLines }); writeFileSync(join(bad, '.agents', 'telemetry', 'automation', 'module.json'), '[]');
  for (const extra of [[], ['--html']]) {
    const t = await rrRun(bad, extra);
    assert.match(t, /manifest revision unknown/);
    assert.doesNotMatch(t, /manifest revision (null|NaN|undefined)/);
  }
  assert.doesNotMatch(await rrRun(repo, [], RW), /^manifest revision/m);
});

test('report-revision: several roots -> manifestRevision is the primary root\'s; manifestRevisions lists every directory only when they differ', async () => {
  const a = rwRepo({ lines: rrLines, current: mdoc(2, ['automation']) });
  const same = rwRepo({ lines: [rl('b', IN_WINDOW_AT, 'automation', 1)], current: mdoc(2, ['automation']) });
  const other = rwRepo({ lines: [rl('c', IN_WINDOW_AT, 'automation', 1)], current: mdoc(5, ['automation']) });
  const agree = JSON.parse(await rrRun(a, [same, '--json']));
  assert.equal(agree.manifestRevision, 2);
  assert.ok(!('manifestRevisions' in agree));
  const differ = JSON.parse(await rrRun(a, [other, '--json']));
  assert.equal(differ.manifestRevision, 2, 'the primary (first) root');
  assert.deepEqual(differ.manifestRevisions, [
    { dir: join(a, '.agents', 'telemetry', 'automation'), manifestRevision: 2 },
    { dir: join(other, '.agents', 'telemetry', 'automation'), manifestRevision: 5 },
  ]);
  assert.deepEqual(Object.keys(differ).slice(0, 4), ['generated', 'manifestRevision', 'manifestRevisions', 'window']);
  const md = await rrRun(a, [other]);
  assert.match(md, /\nmanifest revisions: .*automation=2; .*automation=5\n$/);
});

test('report-revision: batch mode --json / md / html carry the cost.json revision', async () => {
  const repo = rwRepo({ lines: rrLines, current: mdoc(4, ['automation']) });
  const out = join(tmp(), 'b.json');
  assert.equal(await underMigA(RR, () => main([repo, '--batches', '--json', '--out', out])), 0);
  const j = JSON.parse(readFileSync(out, 'utf8'));
  const first = Array.isArray(j) ? j[0] : j;
  assert.equal(first.manifestRevision, 4);
  const md = join(tmp(), 'b.md');
  assert.equal(await underMigA(RR, () => main([repo, '--batches', '--out', md])), 0);
  assert.match(readFileSync(md, 'utf8'), /manifest revision 4/);
});

test('report-robustness (item 19): a zero-session group renders — for its token shares, never NaN%; off keeps the reference text', async () => {
  const { renderBatchTokenomicsMarkdown, renderBatchTokenomicsHtml } = await import('./team-report.mjs');
  const q = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cost = {
    batch: 'z', generatedAt: 'x', sources: { sessions: 0, hosts: [], costSources: [], models: [] }, outcomes: {}, delivered: 0,
    totals: { costUsd: null, tokens: 0, tokensSplit: q, activeMin: 0, dispatches: 0, turns: 0, toolCalls: 0, toolErrors: 0, skills: [] },
    overhead: { costUsd: null, sharePct: null, lead: null, stages: { costUsd: null, tokens: 0, activeMin: 0, dispatches: 0 }, byStage: {} },
    averages: {}, stats: {}, cases: [], byRole: {}, coverage: { casesUnattributed: [] },
  };
  const on = underMig('report-robustness', () => [renderBatchTokenomicsMarkdown(cost), renderBatchTokenomicsHtml(cost)]);
  for (const t of on) assert.doesNotMatch(t, /NaN/);
  assert.match(on[0], /real work: input \| 0 \| — \|/);
  const off = underMig('none', () => renderBatchTokenomicsMarkdown(cost));
  assert.match(off, /NaN%/);
});
