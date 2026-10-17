import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as config from './config.mjs';
import { loadSettings, validateSettings, TA_DEFAULTS, telemetryDir, receiptsRoot, groupReportsDir, words } from './config.mjs';

const repo = () => mkdtempSync(join(tmpdir(), 'ht-cfg-'));
const HERE = fileURLToPath(new URL('.', import.meta.url));

test('absent settings → TA defaults (frozen)', () => {
  const s = loadSettings(repo());
  assert.equal(s, TA_DEFAULTS);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.receipts));
  assert.equal(s.dir, 'automation');
  assert.equal(s.intents.default, 'automation');
});

test('settings file deep-merges over defaults', () => {
  const r = repo();
  mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
  writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify({ dir: 'stories', intents: { default: 'story' }, extension: null }));
  const s = loadSettings(r);
  assert.equal(s.dir, 'stories');
  assert.equal(s.intents.default, 'story');
  assert.deepEqual(s.receipts, TA_DEFAULTS.receipts);
  assert.equal(telemetryDir(r, s), join(r, '.agents', 'telemetry', 'stories'));
  assert.equal(receiptsRoot(r, s), join(r, '.agents', 'automation'));
});

test('TOKENOMICS_STATE_DIR moves the telemetry dir (and so scopes, markers, ledger) under it; unset or empty keeps the repo path (D-PROBE)', () => {
  const s = { ...TA_DEFAULTS, dir: 'stories' };
  assert.equal(telemetryDir('/r', s, {}), join('/r', '.agents', 'telemetry', 'stories'));
  assert.equal(telemetryDir('/r', s, { TOKENOMICS_STATE_DIR: '' }), join('/r', '.agents', 'telemetry', 'stories'));
  assert.equal(telemetryDir('/r', s, { TOKENOMICS_STATE_DIR: '/state' }), join('/state', 'telemetry', 'stories'));
});

test('malformed settings throws a named error', () => {
  const r = repo();
  mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
  writeFileSync(join(r, '.agents/tokenomics/settings.json'), '{nope');
  assert.throws(() => loadSettings(r), /invalid \.agents\/tokenomics\/settings\.json/);
});

test('reports.location tree → the group\'s receipt dir; anything else is refused', () => {
  const r = repo();
  assert.equal(groupReportsDir(r, TA_DEFAULTS, 'camp/wave-1'), join(r, '.agents', 'automation', 'camp', 'wave-1'));
  assert.throws(() => groupReportsDir(r, { ...TA_DEFAULTS, reports: { location: 'elsewhere' } }, 'b'), /unsupported reports\.location/);
});

test('words() derives the rendered vocabulary forms from the scalar words', () => {
  assert.deepEqual(words(TA_DEFAULTS), {
    item: 'case', items: 'cases', Item: 'Case', Items: 'Cases',
    group: 'batch', groups: 'batches', Group: 'Batch', Groups: 'Batches',
  });
  const w = words({ vocabulary: { item: 'ticket', group: 'branch' } });
  assert.equal(w.items, 'tickets');
  assert.equal(w.Groups, 'Branches');
  assert.equal(words({ vocabulary: { item: 'story', group: 'day' } }).Items, 'Stories');
  assert.equal(words({ vocabulary: { item: 'story', group: 'day' } }).groups, 'days');
});

test('TA defaults pass validation (the B2 rules; the frozen B1 defaults pass the B1 rules)', () => {
  assert.equal(config.validateB2Settings(TA_DEFAULTS), TA_DEFAULTS);
  assert.equal(validateSettings(config.B1_DEFAULTS), config.B1_DEFAULTS);
});

test('invalid settings are rejected at load with the named error', () => {
  const cases = [
    [{ reports: { location: 'elsewhere' } }, /unsupported reports\.location 'elsewhere'/],
    [{ ids: { patterns: ['(unclosed'] } }, /ids\.patterns entry "\(unclosed"/],
    [{ ids: { patterns: [42] } }, /ids\.patterns entry 42 is not a string/],
    [{ ids: { flags: 'gi' } }, /ids\.flags must be a string without 'g'/],
    [{ ratioIntents: [] }, /ratioIntents must be a non-empty array/, { TOKENOMICS_MIGRATIONS: 'none' }],   // B1 rules (report-windows: D1)
    [{ extension: 42 }, /extension must be a module path string or null/],
    [{ extension: '' }, /extension must be a module path string or null/],
  ];
  for (const [doc, re, env = process.env] of cases) {
    const r = repo();
    mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
    writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify({ extension: null, ...doc }));
    assert.throws(() => loadSettings(r, env), (e) => /^tokenomics: invalid \.agents\/tokenomics\/settings\.json: /.test(e.message) && re.test(e.message), JSON.stringify(doc));
  }
});

test('a present settings file must state extension explicitly (path or null) — it never inherits TA silently', () => {
  for (const doc of [{}, { dir: 'stories' }]) {
    const r = repo();
    mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
    writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify(doc));
    assert.throws(() => loadSettings(r), { message: 'tokenomics: invalid .agents/tokenomics/settings.json: extension must be set explicitly (path or null)' });
  }
  const r = repo();
  mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
  writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify({ extension: './glue/ext.mjs' }));
  assert.equal(loadSettings(r).extension, './glue/ext.mjs');
});

// Plan 3 Task 5 (P2-11): every nested structure the engine consumes is validated at load.
test('validateSettings accepts the B1 defaults', () => { assert.doesNotThrow(() => validateSettings(config.B1_DEFAULTS)); });

for (const [label, patch, msg] of [
  ['receipts null', { receipts: null }, /receipts must be an object/],
  ['receipts.root empty', { receipts: { ...TA_DEFAULTS.receipts, root: '' } }, /receipts\.root must be a non-empty string/],
  ['receipts.file number', { receipts: { ...TA_DEFAULTS.receipts, file: 3 } }, /receipts\.file must be a non-empty string/],
  ['deliveredOutcomes not array', { receipts: { ...TA_DEFAULTS.receipts, deliveredOutcomes: 'delivered' } }, /receipts\.deliveredOutcomes must be an array of non-empty strings/],
  ['intents null', { intents: null }, /intents\.default must be a non-empty string/],
  ['paths null', { paths: null }, /paths\.factoryProfile must be a non-empty string/],
  ['vocabulary.delivered number', { vocabulary: { ...TA_DEFAULTS.vocabulary, delivered: 1 } }, /vocabulary\.delivered must be a non-empty string/],
  ['reports null', { reports: null }, /reports\.location/],
]) {
  test(`validateSettings rejects ${label}`, () => {
    assert.throws(() => validateSettings({ ...config.B1_DEFAULTS, extension: null, ...patch }), msg);
    assert.throws(() => config.validateB2Settings({ ...TA_DEFAULTS, extension: null, ...patch }), msg);
  });
}

test('loadSettings rejects an unknown TOKENOMICS_MIGRATIONS id before anything else', () => {
  assert.throws(() => loadSettings(mkdtempSync(join(tmpdir(), 'ht-mig-')), { TOKENOMICS_MIGRATIONS: 'nope' }), /unknown migration 'nope'/);
});

// --- B2 item 8 report-windows: frozen B1 defaults behind `none` (map D1, obligation O8) -------------------
const NONE = { TOKENOMICS_MIGRATIONS: 'none' };
const RW_ENV = { TOKENOMICS_MIGRATIONS: 'report-windows' };
/** A foreign repo whose settings.json omits ratioIntents: story receipts, two priced sessions (automation $2, story $1). */
function foreignRepo() {
  const r = repo();
  mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
  writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify({ dir: 'stories',
    receipts: { root: '.agents/stories', file: 'receipt.json', deliveredOutcomes: ['done'] }, intents: { default: 'story' }, extension: null }));
  const tdir = join(r, '.agents/telemetry/stories');
  mkdirSync(tdir, { recursive: true });
  const ln = (id, intent, costUsd) => JSON.stringify({ v: 1, host: 'claude', id, user: 'alice', capturedAt: '2026-10-05T11:00:00Z', repo: 'r', branch: 'main',
    role: null, models: ['m'], startedAt: '2026-10-05T10:00:00Z', endedAt: '2026-10-05T11:00:00Z', wallMin: 60, activeMin: 60, turns: 1, toolCalls: 0, toolErrors: 0,
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd, costSource: 'ccusage-metered', cases: [], scope: { intent, batch: null, cases: [] }, subagents: [], skills: [] });
  writeFileSync(join(tdir, 'usage-alice.jsonl'), `${ln('a', 'automation', 2)}\n${ln('s', 'story', 1)}\n`);
  mkdirSync(join(r, '.agents/stories/sp1'), { recursive: true });
  writeFileSync(join(r, '.agents/stories/sp1/receipt.json'), JSON.stringify({ cases: [{ id: 'issue-1', outcome: 'done' }] }));
  return r;
}

test('O8: `none` with a foreign settings.json lacking ratioIntents loads and reports as today (frozen B1_DEFAULTS)', () => {
  const r = foreignRepo();
  const s = loadSettings(r, NONE);
  assert.deepEqual(s.ratioIntents, ['automation'], 'the frozen B1 default supplies it');
  const out = spawnSync(process.execPath, [join(HERE, '..', 'scripts', 'team-report.mjs'), r, '--json'],
    { encoding: 'utf8', env: { ...process.env, ...NONE, TOKENOMICS_NO_CCUSAGE: '1' } });
  assert.equal(out.status, 0, out.stderr);
  const rep = JSON.parse(out.stdout);
  assert.equal(rep.cases.delivered, 1);
  assert.equal(rep.perDelivered.costUsd, 3, 'all priced spend ÷ delivered, as the reference');
  assert.equal(rep.perDelivered.automationOnlyCostUsd, 2, 'settings.ratioIntents (from B1_DEFAULTS) still scopes the ratio under none');
  assert.equal(rep.semantics, undefined);
});

test('O8: B1_DEFAULTS has ratioIntents — a frozen copy of the B1 literal that `none` merges over', () => {
  assert.deepEqual(config.B1_DEFAULTS.ratioIntents, ['automation']);
  assert.ok(Object.isFrozen(config.B1_DEFAULTS) && Object.isFrozen(config.B1_DEFAULTS.ratioIntents) && Object.isFrozen(config.B1_DEFAULTS.receipts));
  assert.notEqual(config.B1_DEFAULTS, TA_DEFAULTS, 'a separate object: removing ratioIntents from TA_DEFAULTS at B2 close cannot touch it');
  const { ratioIntents: _ri, ...b1Rest } = config.B1_DEFAULTS;
  assert.deepEqual(b1Rest, { ...TA_DEFAULTS }, 'B1_DEFAULTS = the B2 contract plus the frozen ratioIntents');
  assert.equal(loadSettings(repo(), NONE), config.B1_DEFAULTS, 'absent settings under none → B1_DEFAULTS');
  assert.equal(loadSettings(repo(), RW_ENV), TA_DEFAULTS, 'absent settings with report-windows → TA_DEFAULTS');
});

test('after B2 close, `TA_DEFAULTS` has no `ratioIntents`; `B1_DEFAULTS` still has it; `none` with a settings.json lacking ratioIntents reports as today', () => {
  assert.equal('ratioIntents' in TA_DEFAULTS, false, 'the B2 settings contract drops ratioIntents (map §4 step 19, D1)');
  assert.deepEqual(config.B1_DEFAULTS.ratioIntents, ['automation'], 'the frozen B1 defaults keep it (O8)');
  assert.doesNotThrow(() => config.validateB2Settings(TA_DEFAULTS), 'the B2 validator accepts the contract without it');
  assert.throws(() => validateSettings(TA_DEFAULTS), /ratioIntents must be a non-empty array/, 'the B1 rules still require it');
  assert.equal(validateSettings(config.B1_DEFAULTS), config.B1_DEFAULTS);
  // A present file lacking ratioIntents: report-windows merges over TA_DEFAULTS (no key); none over B1_DEFAULTS.
  const r = foreignRepo();
  assert.equal('ratioIntents' in loadSettings(r, RW_ENV), false);
  assert.deepEqual(loadSettings(r, NONE).ratioIntents, ['automation']);
  const out = spawnSync(process.execPath, [join(HERE, '..', 'scripts', 'team-report.mjs'), r, '--json'],
    { encoding: 'utf8', env: { ...process.env, ...NONE, TOKENOMICS_NO_CCUSAGE: '1' } });
  assert.equal(out.status, 0, out.stderr);
  const rep = JSON.parse(out.stdout);
  assert.deepEqual([rep.cases.delivered, rep.perDelivered.costUsd, rep.perDelivered.automationOnlyCostUsd], [1, 3, 2]);
});

test('validation split: the B1 rules require ratioIntents; with report-windows it is not validated (D1)', () => {
  const r = repo();
  mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
  writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify({ ratioIntents: [], extension: null }));
  assert.throws(() => loadSettings(r, NONE), /ratioIntents must be a non-empty array/);
  assert.doesNotThrow(() => loadSettings(r, RW_ENV));
  assert.throws(() => validateSettings({ ...TA_DEFAULTS, ratioIntents: [] }), /ratioIntents/);
  assert.doesNotThrow(() => config.validateB2Settings({ ...TA_DEFAULTS, ratioIntents: [] }));
});

// B2 item 10 (reports-location, owner Q13): reports and cost.json relocate to the telemetry branch.
const RL_ENV = { TOKENOMICS_MIGRATIONS: 'reports-location' };
const withSettings = (doc) => {
  const r = repo();
  mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
  writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify(doc));
  return r;
};

test('reports.location telemetry accepted; default telemetry for a present non-TA file', () => {
  const r = withSettings({ dir: 'stories', extension: null });
  assert.equal(loadSettings(r, RL_ENV).reports.location, 'telemetry', 'a present file omitting the key relocates');
  const explicit = withSettings({ extension: null, reports: { location: 'telemetry' } });
  assert.equal(loadSettings(explicit, RL_ENV).reports.location, 'telemetry');
  const tree = withSettings({ extension: null, reports: { location: 'tree' } });
  assert.equal(loadSettings(tree, RL_ENV).reports.location, 'tree', 'an explicit tree is honoured');
  assert.equal(loadSettings(repo(), RL_ENV).reports.location, 'tree', 'no settings file → TA defaults, in-tree');
  assert.throws(() => loadSettings(withSettings({ extension: null, reports: { location: 'elsewhere' } }), RL_ENV), /unsupported reports\.location 'elsewhere'/);
  const s = loadSettings(r, RL_ENV);
  assert.equal(groupReportsDir('/x', s, 'a/b'), join('/x', '.agents', 'telemetry', 'stories', 'reports', 'a', 'b'));
});

test('reports.location telemetry is refused with reports-location off (B1 rules)', () => {
  const r = withSettings({ extension: null, reports: { location: 'telemetry' } });
  assert.throws(() => loadSettings(r, NONE), /unsupported reports\.location 'telemetry'/);
  assert.equal(loadSettings(withSettings({ extension: null }), NONE).reports.location, 'tree');
  assert.throws(() => loadSettings(r, RW_ENV), /unsupported reports\.location 'telemetry'/);
});

test('Review Focus 5: a present TA settings file without reports.location keeps tree', () => {
  for (const ext of ['./extensions/test-automation.mjs', 'extensions/test-automation.mjs', '/abs/path/test-automation']) {
    assert.equal(loadSettings(withSettings({ extension: ext }), RL_ENV).reports.location, 'tree', ext);
  }
  assert.equal(loadSettings(withSettings({ extension: './extensions/test-automation.mjs', reports: { location: 'telemetry' } }), RL_ENV).reports.location, 'telemetry', 'TA may opt in explicitly');
});

test('effectiveReportsLocation: explicit value, else tree for no file or test-automation, else telemetry', () => {
  const e = config.effectiveReportsLocation;
  assert.equal(e({ reports: { location: 'tree' }, extension: null }, true), 'tree');
  assert.equal(e({ reports: { location: 'telemetry' }, extension: './extensions/test-automation.mjs' }, true), 'telemetry');
  assert.equal(e(null, false), 'tree');
  assert.equal(e({ extension: null }, true), 'telemetry');
  assert.equal(e({ extension: './ext/mine.mjs' }, true), 'telemetry');
  assert.equal(e({ extension: './extensions/test-automation.mjs' }, true), 'tree');
});

test('ids.rules validation names the rule index (Plan 7)', () => {
  const bad = (rule, re) => {
    const r = repo();
    mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
    writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify({ extension: null, ids: { rules: [{ pattern: '(a)', normalize: 'x:$1' }, rule] } }));
    assert.throws(() => loadSettings(r), (e) => e.message.includes('ids.rules[1]') && re.test(e.message), JSON.stringify(rule));
  };
  bad({ pattern: '(', normalize: 'x:$1' }, /pattern/);
  bad({ pattern: '(a)', flags: 'g', normalize: 'x:$1' }, /flags/);
  bad({ pattern: '(a)(b)', normalize: 'gh:$3' }, /\$3/);
  bad({ pattern: '(a)', normalize: 'gh:$10' }, /\$1-\$9/);
  bad({ pattern: '(a)', normalize: 'gh:$0' }, /\$1-\$9/);
  bad({ pattern: '(a)', normalize: '$1' }, /normalize/);
  bad({ pattern: '(a)', normalize: 'x:$1', source: 'x' }, /source/);
  const r = repo();
  mkdirSync(join(r, '.agents/tokenomics'), { recursive: true });
  writeFileSync(join(r, '.agents/tokenomics/settings.json'), JSON.stringify({ extension: null, ids: { rules: 'no' } }));
  assert.throws(() => loadSettings(r), /ids\.rules must be an array/);
});

test('idRules: absent → empty; compiled and cached per ids; prefixes derived', () => {
  assert.deepEqual(config.idRules(TA_DEFAULTS).rules, []);
  const s = { ...TA_DEFAULTS, ids: { ...TA_DEFAULTS.ids, rules: [{ pattern: '#(\\d+)', normalize: 'gh:$1' }, { pattern: 'B(\\d+)', normalize: 'ado:$1', source: 'branch' }] } };
  const a = config.idRules(s);
  assert.equal(a, config.idRules(s));
  assert.deepEqual([...a.prefixes].sort(), ['ado', 'gh']);
  assert.deepEqual(a.rules.map((x) => x.source), ['any', 'branch']);
  assert.ok(a.rules[0].re.global);
});
