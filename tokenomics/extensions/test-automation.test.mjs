import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ta from './test-automation.mjs';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { TA_DEFAULTS } from '../engine/config.mjs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as eng from '../scripts/build-tokenomics-export.mjs';

// B2: the reference differentials below pin the reference behaviour; the B2 tests switch it through the variable.
process.env.TOKENOMICS_MIGRATIONS = 'none';

const HOOKS = ['labelFrom', 'receiptIds', 'classifyDispatch', 'enrichGroup', 'onClose', 'stopGateCheck', 'exportRow'];

test('TA extension exports API 2 and every hook its inventory sites need', () => {
  assert.equal(ta.extensionApi, 2);
  const a = JSON.parse(readFileSync(new URL('../../docs/inventory/b0-assignments.json', import.meta.url), 'utf8'));
  const needed = new Set(Object.values(a).filter((x) => x.owner === 'ta-extension').map((x) => x.target));
  for (const h of needed) assert.equal(typeof ta[h], 'function', `missing hook ${h}`);
  for (const k of Object.keys(ta)) assert.ok(k === 'extensionApi' || HOOKS.includes(k), `unexpected export ${k}`);
});

// exportRow's corpus phases (segment, item, scenarios, size, effort, notes, checklist) are reached on the
// corpus through work-scope close → appendRun; the export CLI's phases (anonymize, submission, compare,
// no-profile) are not (CORPUS_UNREACHED in engine/extension.mjs). So the whole exporter's TA behaviour is
// proven here too — the engine exporter run with the TA extension against the reference exporter (49577c7)
// on the same synthetic input, byte for byte.

const REF = new URL('../../reference/49577c7/scripts/build-tokenomics-export.mjs', import.meta.url);
const quad = (i, o, r, w) => ({ input: i, output: o, cacheRead: r, cacheWrite: w });
const COSTS = [
  { v: 1, batch: 'camp/wave-01', delivered: 3,
    sources: { sessions: 2, hosts: ['claude', 'copilot'], models: ['m-big', 'm-small'] },
    totals: { costUsd: 12.5, tokens: 900, tokensSplit: quad(100, 200, 500, 100), activeMin: 95, dispatches: 7.5, turns: 40,
      tokensByModel: { 'm-big': quad(60, 150, 300, 60), 'm-small': quad(40, 50, 200, 40) }, tokensAttribution: 'partial', unattributedUnits: 2 },
    overhead: { costUsd: 4, sharePct: 32, lead: { costUsd: 3 } },
    outcomes: { delivered: 2, 'defect-found': 1, 'not-started': 1, 'infra-stalled': 1 },
    gate: { verdict: 'green', runs: 3 },
    cases: [{ id: 'A-1' }, { id: 'A-2' }, { id: 'A-3' }, { id: 'A-4' }, { id: 'A-5' }],
    sizing: { bySize: { S: { cases: 2, sp: 4 }, L: { cases: 2, sp: 16 }, M: { cases: 1, sp: 5 } } },
    stats: { directCostUsd: { avg: 1.5, median: 1.4, min: 1, max: 2.2 } },
    averages: { totalPerDelivered: { costUsd: 4.17 }, directPerCase: { costUsd: 1.5 } } },
  { v: 1, batch: 'b2', workItemRef: 'JIRA-9', delivered: 0,
    sources: { sessions: 1, hosts: ['claude'], models: ['m-big'] },
    totals: { costUsd: null, tokens: 10, tokensSplit: null, activeMin: 5, dispatches: 0, turns: 2 },
    overhead: { costUsd: null, sharePct: null, lead: { costUsd: null } },
    outcomes: { blocked: 1 }, gate: null, cases: [{ id: 'B-1' }],
    stats: { directCostUsd: null }, averages: { totalPerDelivered: null, directPerCase: null } },
];
const PROFILES = [{}, { factory_id: 'f-1', factory_name: 'F', work_item_level: 'story', maturity: 'production', env_setup: 'trivial', schema_version: '1.1' }];

test('exportRow: the engine exporter + TA extension equals the reference exporter byte for byte', async () => {
  const ref = await import(REF.href);
  const same = (a, b, what) => assert.equal(JSON.stringify(a), JSON.stringify(b), what);
  for (const profile of PROFILES) {
    for (const cost of COSTS) {
      const segment = eng.buildSegment(profile, cost, ta);
      same(segment, ref.buildSegment(profile, cost), `segment ${cost.batch}`);
      const row = eng.buildRunRow(cost, profile, ta);
      same(row, ref.buildRunRow(cost, profile), `row ${cost.batch}`);
      same(eng.checklist(segment, row, ta), ref.checklist(segment, row), `checklist ${cost.batch}`);
    }
    assert.equal(eng.renderCompare(COSTS[0], COSTS[1], undefined, ta), ref.renderCompare(COSTS[0], COSTS[1]));
    // the accumulated runs.json, its anonymised form and the submission folder
    const repos = [mkdtempSync(join(tmpdir(), 'ta-exp-e-')), mkdtempSync(join(tmpdir(), 'ta-exp-r-'))];
    try {
      for (const cost of COSTS) { eng.appendRun(repos[0], cost, profile, undefined, ta); ref.appendRun(repos[1], cost, profile); }
      const doc = JSON.parse(readFileSync(eng.exportPath(repos[0]), 'utf8'));
      same(eng.anonymizeDoc(doc, ta), ref.anonymizeDoc(doc), 'anonymised doc');
      for (const anon of [false, true]) {
        const [e, r] = [eng.writeSubmission(repos[0], { anon }, undefined, ta), ref.writeSubmission(repos[1], { anon })];
        for (const f of ['runs.json', 'submission.md']) {
          assert.equal(readFileSync(join(e.dir, f), 'utf8'), readFileSync(join(r.dir, f), 'utf8'), `${f} (anon ${anon})`);
        }
      }
    } finally { for (const r of repos) rmSync(r, { recursive: true, force: true }); }
  }
});

test('exportRow submission: stop / owner identity equals the reference for complete and incomplete segments', async (t) => {
  const ref = await import(REF.href);
  const full = JSON.parse(readFileSync(new URL('../../corpus/cases/cov-dispatch-batch/expected/49577c7/.agents/telemetry/automation/export/runs.json', import.meta.url), 'utf8'));
  const bare = structuredClone(full);
  delete bare.segment.stop; delete bare.segment.owner_group;
  for (const [what, doc] of [['complete', full], ['incomplete', bare]]) {
    const repos = [mkdtempSync(join(tmpdir(), 'ta-sub-e-')), mkdtempSync(join(tmpdir(), 'ta-sub-r-'))];
    t.after(() => { for (const r of repos) rmSync(r, { recursive: true, force: true }); });
    for (const r of repos) {
      const path = eng.exportPath(r);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
    }
    const [e, r] = [eng.writeSubmission(repos[0], {}, undefined, ta), ref.writeSubmission(repos[1], {})];
    assert.equal(readFileSync(join(e.dir, 'submission.md'), 'utf8'), readFileSync(join(r.dir, 'submission.md'), 'utf8'), `${what} segment`);
  }
});

// The corpus hook-coverage check (every inventory hook called on the TA corpus) rides the B1 gate's
// own traced replay in corpus/engine.test.mjs — one corpus replay serves both assertions.

test('stopGateCheck finds a nested campaign-wave receipt by settings.receipts.file, not a literal report.json', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ht-ta-rcpt-'));
  try {
    const settings = { ...TA_DEFAULTS, receipts: { ...TA_DEFAULTS.receipts, file: 'receipt.json' } };
    mkdirSync(join(repo, '.agents', 'automation', 'camp', 'w1'), { recursive: true });
    writeFileSync(join(repo, '.agents', 'automation', 'camp', 'w1', 'receipt.json'), '{"cases":[]}');
    const ctx = { repo, settings, sid: 's', askedOnce: () => false, scriptPath: 'w.mjs' };
    assert.equal(ta.stopGateCheck({ batch: 'w1' }, ctx)?.decision, 'block');
    writeFileSync(join(repo, '.agents', 'automation', 'camp', 'w1', 'report.json'), '{"cases":[]}');
    rmSync(join(repo, '.agents', 'automation', 'camp', 'w1', 'receipt.json'));
    assert.equal(ta.stopGateCheck({ batch: 'w1' }, ctx), null, 'a report.json is not this configuration\'s receipt');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('enrichGroup delivered-note returns the TA outcome prose', () => {
  assert.equal(ta.enrichGroup({ outcomes: [] }, { phase: 'delivered-note' }), 'delivered/defect-found; legacy automated/merged-sanctioned-red');
});

test('anonymize scrubs the cost.json path', () => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  const notes = "Telemetry cohort: reconstructed from .agents/automation/b1/cost.json (v1); batch slug 'b1'.";
  try {
    process.env.TOKENOMICS_MIGRATIONS = 'anon-complete';
    const r = ta.exportRow({ notes, scenarios_executed: 2 }, { phase: 'anonymize' });
    assert.equal(r.notes, "Telemetry cohort: reconstructed from .agents/automation/anonymised/cost.json (v1); batch slug 'anonymised'.");
    assert.deepEqual(r.scrub, ['b1']);
    process.env.TOKENOMICS_MIGRATIONS = 'none';
    assert.match(ta.exportRow({ notes }, { phase: 'anonymize' }).notes, /automation\/b1\/cost\.json/);
  } finally { process.env.TOKENOMICS_MIGRATIONS = was; }
});

// B2 item 4 (null-unobservable): render parts receive buckets whose sums may be null beside an `unmeasured` count.
test('render parts print "n unmeasured" beside a null or partial sum, never null', () => {
  const U = (o) => ({ tokens: 0, activeMin: 0, wallMin: 0, turns: 0, toolCalls: 0, toolErrors: 0, ...o });
  const usd = (n) => (typeof n === 'number' ? `$${n.toFixed(2)}` : 'n/a');
  const c = {
    cases: [{ direct: { fixRounds: 1 } }],
    overhead: { lead: { costUsd: 1 }, byStage: { gate: { costUsd: null, activeMin: null, tok: null, unmeasured: U({ activeMin: 2 }) }, triage: { costUsd: 0.5, activeMin: 3, unmeasured: U({ activeMin: 1 }) } } },
    rework: { costUsd: null, dispatches: 1, activeMin: null, unmeasured: U({ activeMin: 1 }) },
  };
  const out = ta.classifyDispatch(c, { phase: 'render-md', part: 'cost', settings: TA_DEFAULTS, usd }).join('\n');
  assert.match(out, /gate n\/a \(— \(2 unmeasured\)\)/);
  assert.match(out, /triage \$0\.50 \(3m \(1 unmeasured\)\)/);
  assert.match(out, /·  — \(1 unmeasured\)$/m);
  assert.doesNotMatch(out, /\bnull\b|NaN|undefined/);
  // Reference shape (no unmeasured field, numeric sums) renders exactly as before.
  const ref = { ...c, overhead: { lead: { costUsd: 1 }, byStage: { gate: { costUsd: 1, activeMin: 2 } } }, rework: { costUsd: 1, dispatches: 1, activeMin: 4 } };
  assert.deepEqual(ta.classifyDispatch(ref, { phase: 'render-md', part: 'cost', settings: TA_DEFAULTS, usd }),
    ['  - by stage: lead $1.00 · gate $1.00 (2m)', '- Rework (fix rounds — already inside per-case direct): $1.00  ·  1 dispatch(es)  ·  4m']);
});

// B2 item 7 (active-minutes): byStage / rework minutes are not allocated at dispatch grain (null, no count).
test('render-md cost part with null minutes', () => {
  const usd = (n) => (typeof n === 'number' ? `$${n.toFixed(2)}` : 'n/a');
  const U0 = { tokens: 0, activeMin: 0, wallMin: 0, turns: 0, toolCalls: 0, toolErrors: 0 };
  const mk = (unm) => ({
    cases: [{ direct: { fixRounds: 1, activeMin: null } }],
    overhead: { lead: { costUsd: 1, activeMin: 30 }, byStage: { gate: { costUsd: 0.8, activeMin: null, ...(unm ? { unmeasured: U0 } : {}) } } },
    rework: { costUsd: 0.3, dispatches: 1, activeMin: null, ...(unm ? { unmeasured: U0 } : {}) },
  });
  for (const unm of [false, true]) {
    const out = ta.classifyDispatch(mk(unm), { phase: 'render-md', part: 'cost', settings: TA_DEFAULTS, usd }).join('\n');
    assert.match(out, /gate \$0\.80 \(—\)/, `unmeasured field: ${unm}`);
    assert.match(out, /1 dispatch\(es\)  ·  —$/m);
    assert.doesNotMatch(out, /\bnull\b|NaN|undefined|—m|\b0m\b|unmeasured/);
  }
  // TA sizing (review round 1, I2): the batch-grain actual is an allocation over loaded minutes, labelled as such;
  // an unmeasured loaded minute renders '— (n unmeasured)', never 0; the flagged list follows a blank line (M6).
  const flag = { id: 'TC-1', size: 'M', flag: 'above-p90', detail: 'x' };
  const alloc = { sizing: { bySize: { M: { cases: 2, sp: 6, estMin: 50, actualMin: 35, actualTok: 20, actualMinBasis: 'allocated' } },
    estVsActualMin: { est: 50, actual: 35, ratio: 0.7, basis: 'allocated' }, flagged: [flag] }, cases: [] };
  const md = (ta.enrichGroup(alloc, { phase: 'render-md', part: 'sections', settings: TA_DEFAULTS }) ?? []).join('\n');
  assert.match(md, /50m predicted \/ 35m actual \(allocated: batch time ÷ cases\)/);
  const html = ta.enrichGroup(alloc, { phase: 'render-html', part: 'sections', settings: TA_DEFAULTS, esc: (x) => x, statCell: () => '', fmtInt: String });
  assert.match(html, /35m actual \(allocated: batch time ÷ cases\)/);
  const unm = { sizing: { bySize: { M: { cases: 1, sp: 3, estMin: 30, actualMin: null, actualTok: 20, actualMinBasis: 'allocated', actualMinUnmeasured: 1 } }, flagged: [flag] }, cases: [] };
  const umd = (ta.enrichGroup(unm, { phase: 'render-md', part: 'sections', settings: TA_DEFAULTS }) ?? []).join('\n');
  assert.match(umd, /\| — \(1 unmeasured\) \|/);
  assert.match(umd, /\|\n\n- ⚠ \*\*TC-1\*\*/, 'a blank line before the flagged list');
  for (const t of [md, html, umd]) assert.doesNotMatch(t, /\bnull\b|\| 0 \|/);
});

test('capture-robustness (14): receiptIds searches run directories in sorted order, not the listing order', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ta-receipts-'));
  const base = join(repo, '.agents', 'telemetry', 'automation', 'returns');
  for (const run of ['run-a', 'run-b']) {
    mkdirSync(join(base, run), { recursive: true });
    writeFileSync(join(base, run, 'ag1.json'), JSON.stringify({ result: { unit_ids: [run] } }));
  }
  const ent = (name) => ({ name, isDirectory: () => true });
  const fs = { readdirSync: (d, o) => (d === base ? [ent('run-b'), ent('run-a')] : readdirSync(d, o)) };
  const was = process.env.TOKENOMICS_MIGRATIONS;
  try {
    process.env.TOKENOMICS_MIGRATIONS = 'capture-robustness';
    assert.deepEqual(ta.receiptIds({ id: 'ag1' }, { repo, settings: TA_DEFAULTS, fs }), ['run-a']);
    process.env.TOKENOMICS_MIGRATIONS = 'none';
    assert.deepEqual(ta.receiptIds({ id: 'ag1' }, { repo, settings: TA_DEFAULTS, fs }), ['run-b'], 'the reference trusts the listing');
  } finally { process.env.TOKENOMICS_MIGRATIONS = was; }
});
