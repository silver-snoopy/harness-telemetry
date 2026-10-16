import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hook, loadExtension, extensionPath, EXTENSION_API } from './extension.mjs';
import { TA_DEFAULTS, loadSettings } from './config.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCase } from '../../replay/runner.mjs';

const ENGINE_ROOT = fileURLToPath(new URL('..', import.meta.url));

test('hook calls present functions and returns undefined otherwise', () => {
  assert.equal(hook({ a: (x) => x + 1 }, 'a', 1), 2);
  assert.equal(hook({}, 'a', 1), undefined);
  assert.equal(hook(null, 'a', 1), undefined);
});

// API 2 (D3, Plan 4 Task 21): hooks are synchronous; a thenable result is a named error, never a value the call
// site would spread or concatenate.
const PROMISE_ERR = (name) => `tokenomics: extension hook ${name} returned a Promise (hooks are synchronous)`;

// Run in a child (review M3): the error path writes to stderr and seeds hook()'s once-per-name set, neither of which
// may leak into this test process or the runner's output.
const inChild = (body) => {
  const ext = new URL('./extension.mjs', import.meta.url).href;
  return spawnSync(process.execPath, ['--input-type=module', '-e', `import { hook } from ${JSON.stringify(ext)};\n${body}`], { encoding: 'utf8' });
};

test('a hook returning a Promise throws tokenomics: extension hook <name> returned a Promise (hooks are synchronous)', () => {
  const r = inChild(`
    const out = [];
    const tryHook = (ext, name, ctx) => { try { hook(ext, name, {}, ctx); out.push(null); } catch (e) { out.push({ message: e.message, code: e.code }); } };
    tryHook({ enrichGroup: async () => ({ x: 1 }) }, 'enrichGroup', { phase: 'case' });
    tryHook({ labelFrom: () => Promise.resolve('x') }, 'labelFrom', {});
    tryHook({ onClose: () => ({ then() {} }) }, 'onClose', {});                                  // any thenable
    tryHook({ exportRow: () => Promise.reject(new Error('late')) }, 'exportRow', { phase: 'notes' }); // a rejecting one
    process.stdout.write(JSON.stringify(out));`);
  assert.equal(r.status, 0, r.stderr);
  const names = ['enrichGroup', 'labelFrom', 'onClose', 'exportRow'];
  assert.deepEqual(JSON.parse(r.stdout), names.map((n) => ({ message: PROMISE_ERR(n), code: 'ERR_EXTENSION_ASYNC_HOOK' })));
  assert.equal(r.stderr, names.map((n) => `${PROMISE_ERR(n)}\n`).join(''));
});

test('synchronous hook results pass through unchanged (no existing sync hook is affected)', () => {
  const fn = () => 1;
  const objThenNotFn = { then: 1 };
  for (const v of [undefined, null, 0, '', 'direct', false, [], ['a'], {}, objThenNotFn, fn]) {
    assert.equal(hook({ h: () => v }, 'h', null, {}), v);
  }
});

test('the Promise error reaches stderr even where a best-effort call site swallows the throw, and its rejection is handled', () => {
  const r = inChild(`
    for (let i = 0; i < 3; i++) { try { hook({ onClose: async () => { throw new Error('async body'); } }, 'onClose', {}, {}); } catch { /* swallowed, like close's onClose */ } }
    setTimeout(() => process.stdout.write('alive'), 20);`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'alive', 'no unhandled rejection killed the process');
  assert.equal(r.stderr, `${PROMISE_ERR('onClose')}\n`, 'named once per hook, not once per call');
});

test('TA defaults (no settings file) load the TA extension from the engine root; null loads none', async () => {
  assert.equal(EXTENSION_API, 2);
  const r = mkdtempSync(join(tmpdir(), 'ht-ext-'));
  try {
    assert.equal((await loadExtension(TA_DEFAULTS, r)).extensionApi, 2);
    assert.equal(await loadExtension({ ...TA_DEFAULTS, extension: null }, r), null);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test('a settings-supplied relative extension path resolves against the repo root, not the engine', async () => {
  const r = mkdtempSync(join(tmpdir(), 'ht-ext-'));
  try {
    mkdirSync(join(r, '.agents', 'tokenomics'), { recursive: true });
    writeFileSync(join(r, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ extension: './glue/ext.mjs' }));
    mkdirSync(join(r, 'glue'));
    writeFileSync(join(r, 'glue', 'ext.mjs'), "export const extensionApi = 2;\nexport const where = 'repo';\n");
    const s = loadSettings(r);
    assert.equal((await loadExtension(s, r)).where, 'repo');
    // the TA default's own relative path, when written into a settings file, is repo-relative too
    writeFileSync(join(r, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ extension: TA_DEFAULTS.extension }));
    await assert.rejects(loadExtension(loadSettings(r), r), (e) => e.message === `tokenomics: cannot load extension ${join(r, TA_DEFAULTS.extension)}: ERR_MODULE_NOT_FOUND`);
    await assert.rejects(loadExtension(s, undefined), /needs the repo root/);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

// The API version check is part of the freeze and does not consult TOKENOMICS_MIGRATIONS: the migrations-off path
// (replay, the B4 rescue writer) runs the same hook() with the same synchronous contract, so an API 1 module is
// rejected there too (Task 21 report: no corpus case loads a non-TA extension module, so no golden observes it).
test('loadExtension requires extensionApi 2 exactly, with migrations on or off', async () => {
  const r = mkdtempSync(join(tmpdir(), 'ht-ext-'));
  const saved = process.env.TOKENOMICS_MIGRATIONS;
  try {
    for (const [api, ok] of [['1', false], ['2', true], ['3', false], ["'2'", false]]) {
      writeFileSync(join(r, `v${api.replace(/'/g, 's')}.mjs`), `export const extensionApi = ${api};\n`);
    }
    writeFileSync(join(r, 'none.mjs'), 'export const x = 1;\n');
    for (const m of ['none', undefined]) {
      if (m === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = m;
      for (const f of ['v1', 'v3', 'vs2s', 'none']) await assert.rejects(loadExtension({ extension: `./${f}.mjs` }, r), { message: 'tokenomics: extension API mismatch' }, `${f} (${m})`);
      assert.equal((await loadExtension({ extension: './v2.mjs' }, r)).extensionApi, 2);
    }
  } finally {
    if (saved === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = saved;
    rmSync(r, { recursive: true, force: true });
  }
});

test('extensionPath resolves the module loadExtension would import', () => {
  assert.equal(extensionPath(TA_DEFAULTS, '/r'), join(ENGINE_ROOT, TA_DEFAULTS.extension));
  assert.equal(extensionPath({ ...TA_DEFAULTS, extension: null }, '/r'), null);
  assert.equal(extensionPath({ ...TA_DEFAULTS, extension: TA_DEFAULTS.extension }, '/r'), join('/r', TA_DEFAULTS.extension));
  assert.equal(extensionPath({ extension: '/abs/x.mjs' }, undefined), '/abs/x.mjs');
  assert.throws(() => extensionPath({ extension: './x.mjs' }, undefined), /needs the repo root/);
});

// Spy test (spec §14.3, Review Focus 3): a foreign configuration — settings `extension: null` — never
// reaches a TA hook. The case's control replay (same events, TA defaults) proves the events do reach
// hook call sites — all seven, labelFrom / receiptIds through the case's sub-agent dispatch (`--dispatch`) —
// so an empty trace is not vacuous.

const CASE = fileURLToPath(new URL('../../corpus/cases/foreign-null-extension', import.meta.url));
const SEED_LINE = fileURLToPath(new URL('../../corpus/cases/seed-claude-basic/expected/49577c7/.agents/telemetry/automation/usage-corpus.jsonl', import.meta.url));
const traced = async (caseDir) => {
  const dir = mkdtempSync(join(tmpdir(), 'ht-spy-'));
  const trace = join(dir, 'hooks.txt');
  try {
    writeFileSync(trace, '');
    const r = await runCase(caseDir, ENGINE_ROOT, { extraEnv: { HT_EXT_TRACE_FILE: trace } });
    return { r, hooks: readFileSync(trace, 'utf8').split('\n').filter(Boolean) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('extension null: no TA hook is called, and the ledger line measures the same as seed-claude-basic', async () => {
  const { r, hooks } = await traced(CASE);
  assert.deepEqual(hooks, []);
  const line = JSON.parse(r.files['.agents/telemetry/automation/usage-corpus.jsonl'].trim().split('\n').at(-1));
  const seed = JSON.parse(readFileSync(SEED_LINE, 'utf8').trim().split('\n').at(-1));
  assert.equal(line.costSource, seed.costSource);
  assert.deepEqual(line.tokens, seed.tokens);
  // the export row written at close carries no QA identity or domain fields
  const doc = JSON.parse(r.files['.agents/telemetry/automation/export/runs.json']);
  for (const k of ['stop', 'owner_group', 'work_item_level', 'factory_type']) assert.equal(k in doc.segment, false, `segment.${k}`);
  for (const k of ['work_item_level', 'work_item_brief', 'scenarios_authored', 'scenarios_automated', 'scenarios_executed', 'notes']) {
    if (k === 'notes') assert.doesNotMatch(doc.runs[0].notes, /gate|Telemetry cohort|scenarios_/);
    else assert.equal(k in doc.runs[0], false, `row.${k}`);
  }

  // control: the same case under TA defaults (no settings file) calls the hooks its events reach
  const ctlDir = mkdtempSync(join(tmpdir(), 'ht-spy-ctl-'));
  let control;
  try {
    const ctl = join(ctlDir, 'case');
    cpSync(CASE, ctl, { recursive: true });
    const m = JSON.parse(readFileSync(join(ctl, 'replay.json'), 'utf8'));
    delete m.implOnly;
    delete m.repo.files['.agents/tokenomics/settings.json'];
    writeFileSync(join(ctl, 'replay.json'), JSON.stringify(m));
    control = new Set((await traced(ctl)).hooks.map((h) => h.split(/[:#]/)[0]));
  } finally { rmSync(ctlDir, { recursive: true, force: true }); }
  // all seven hooks are reachable by these events (the sub-agent dispatch reaches labelFrom / receiptIds)
  assert.deepEqual([...control].sort(), ['classifyDispatch', 'enrichGroup', 'exportRow', 'labelFrom', 'onClose', 'receiptIds', 'stopGateCheck']);
});

test('extension null: the export keeps profile values and the engine-generic §7 checks', async () => {
  const x = await import('../scripts/build-tokenomics-export.mjs');
  const cost = { batch: 'g', v: 1, delivered: 0, cases: [], outcomes: {}, sources: { sessions: 1, hosts: ['claude'], models: ['a', 'b'] },
    totals: { costUsd: 0, dispatches: 0, tokensSplit: null, tokensAttribution: 'none', unattributedUnits: 1 }, overhead: {} };
  const profile = { work_item_level: 'story', stop: 'build' };
  const segment = x.buildSegment(profile, cost);
  assert.equal(segment.work_item_level, 'story');
  assert.equal(segment.stop, 'build');
  assert.equal('owner_group' in segment, false);
  const row = x.buildRunRow(cost, profile);
  assert.equal(row.work_item_level, 'story');
  const { missing } = x.checklist(segment, row);
  for (const m of ['segment.factory_id', 'work_item_brief', 'size_tshirt', 'tokens (4 totals)', 'cost_api_equivalent_usd > 0', 'tokens_by_model']) {
    assert.ok(missing.some((f) => f.startsWith(m)), `missing ${m}: ${JSON.stringify(missing)}`);
  }
  assert.ok(missing.some((f) => /FLOOR/.test(f)), 'attribution floor flagged');
  assert.ok(!missing.some((f) => /scenario|^effort_days|env_setup|segment\.stop/.test(f)), 'no QA checks without the extension');
});

test('extension null: the submission omits the absent stop / owner_group instead of printing undefined', async () => {
  const x = await import('../scripts/build-tokenomics-export.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'ht-sub-'));
  try {
    const cost = { batch: 'g', v: 1, delivered: 1, cases: [{ id: 'S-1', outcome: 'done' }], outcomes: {}, sources: { sessions: 1, hosts: ['claude'], models: ['m'] },
      totals: { costUsd: 1, dispatches: 1, tokensSplit: null, tokensAttribution: 'none', unattributedUnits: 0 }, overhead: {} };
    const settings = { ...TA_DEFAULTS, extension: null };
    x.appendRun(repo, cost, { factory_id: 'f1' }, settings, null);
    const r = x.writeSubmission(repo, {}, settings, null);
    assert.equal(r.error, undefined);
    const md = readFileSync(join(repo, '.agents', 'telemetry', 'automation', 'export', 'datasets', 'f1', 'submission.md'), 'utf8');
    assert.doesNotMatch(md, /undefined/);
    assert.match(md, /^# Submission — f1$/m);
    assert.doesNotMatch(md, /\*\*Stop|\*\*Owner/);
    x.appendRun(repo, cost, { factory_id: 'f1', owner_group: 'web' }, settings, null);
    x.writeSubmission(repo, {}, settings, null);
    assert.match(readFileSync(join(repo, '.agents', 'telemetry', 'automation', 'export', 'datasets', 'f1', 'submission.md'), 'utf8'), /^\| \*\*Owner\*\* \| `web` \|$/m);
    // a profile with `stop` present: the engine default title carries `` (`<stop>` stop)``
    x.appendRun(repo, cost, { factory_id: 'f1', owner_group: 'web', stop: 'build' }, settings, null);
    x.writeSubmission(repo, {}, settings, null);
    const withStop = readFileSync(join(repo, '.agents', 'telemetry', 'automation', 'export', 'datasets', 'f1', 'submission.md'), 'utf8');
    assert.match(withStop, /^# Submission — f1 \(`build` stop\)$/m);
    assert.match(withStop, /^\| \*\*Stop · owner\*\* \| `build` · `web` \|$/m);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// Plan 3 Task 5: an import failure names the extension path and the cause.
test('loadExtension names the extension and the cause when the import fails', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'ht-ext-'));
  mkdirSync(join(repo, 'dir.mjs'));
  writeFileSync(join(repo, 'bad.mjs'), 'export const = ;');
  for (const ext of ['./missing.mjs', './dir.mjs', './bad.mjs']) {
    await assert.rejects(loadExtension({ extension: ext }, repo), (e) => e.message.startsWith(`tokenomics: cannot load extension ${join(repo, ext)}: `));
  }
});
