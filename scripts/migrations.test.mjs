// The declared-diff harness (spec 18.2, B2) against fake implementations whose output depends only on
// TOKENOMICS_MIGRATIONS: each vacuous-pass route (Review Focus 2) must fail loudly, and the cumulative
// default/all expectation is composed from reviewed declarations, never recorded from the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as M from './migrations.mjs';

const { loadRegistry, registryProblems, expectedFor, compareFiles, checkMigrations, writeDeclared, showDeclared } = M;
const FIX = fileURLToPath(new URL('./fixtures/migrations', import.meta.url));
const implDir = join(FIX, 'impl'); // committed: enables `demo` only when the variable names it (Codex Repro D)
const CASES = join(FIX, 'cases');
const DEMO = [{ id: 'demo', item: 1, landed: true }];
const REASON = 'the demo migration rewrites out/a.txt and adds out/b.txt';

/** A temp registry with one `demo` entry; `after` maps `<case>/<path>` to declared after-content. */
function registry({ declared = {}, after = {}, id = 'demo', item = 1, beforeCases = ['m1'], items } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ht-mig-reg-'));
  mkdirSync(join(dir, id));
  writeFileSync(join(dir, id, 'migration.json'), `${JSON.stringify({ id, item, ...(items === undefined ? {} : { items }), spec: '§14.8 item 1', summary: 'Demo.', beforeCases, declared }, null, 2)}\n`);
  for (const [k, v] of Object.entries(after)) {
    const p = join(dir, id, 'expected', k);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, v);
  }
  return dir;
}
const tempCases = () => { const d = mkdtempSync(join(tmpdir(), 'ht-mig-cases-')); cpSync(CASES, d, { recursive: true }); return d; };
const readdirNames = (d) => (existsSync(d) ? readdirSync(d).sort() : []);
const byMode = (results, mode) => results.filter((r) => r.mode === mode).flatMap((r) => r.problems);
const declaredDemo = () => registry({
  declared: { m1: { reason: REASON, changed: ['out/a.txt', 'out/b.txt'] } },
  after: { 'm1/out/a.txt': 'demo\n', 'm1/out/b.txt': 'added\n' },
});

/** A fake implementation in a temp dir. `on` is the enabled set with enabledMigrations' semantics: the
 * variable unset (or blank) means `landed`, `none` means nothing, otherwise exactly the named ids. */
function fakeImpl(body, landed) {
  const d = mkdtempSync(join(tmpdir(), 'ht-mig-fake-'));
  mkdirSync(join(d, 'scripts'));
  writeFileSync(join(d, 'scripts', 'w.mjs'), [
    "import { mkdirSync, writeFileSync, rmSync } from 'node:fs';",
    'const raw = process.env.TOKENOMICS_MIGRATIONS;',
    `const on = new Set(raw === undefined || !raw.trim() ? ${JSON.stringify(landed)} : raw.trim() === 'none' ? [] : raw.split(',').map((s) => s.trim()));`,
    "mkdirSync('out', { recursive: true });",
    ...body, '',
  ].join('\n'));
  return d;
}
/** The committed demo behaviour, but honouring the unset default. */
const demoImpl = () => fakeImpl(["writeFileSync('out/a.txt', on.has('demo') ? 'demo\\n' : 'base\\n');", "if (on.has('demo')) writeFileSync('out/b.txt', 'added\\n');"], ['demo']);

test('Repro D (adversarial 8): demo passes none, only:demo and all; the unset default fails the named-only w.mjs', async () => {
  const casesDir = tempCases();
  const { results } = await checkMigrations({ implDir, casesDir, registryDir: declaredDemo(), migrations: DEMO });
  assert.deepEqual(byMode(results, 'registry'), []);
  assert.deepEqual(byMode(results, 'none'), []);
  assert.deepEqual(byMode(results, 'only:demo'), []);
  assert.deepEqual(byMode(results, 'all'), []);
  assert.deepEqual(byMode(results, 'default'), ['missing out/b.txt', 'differs out/a.txt']);
  assert.deepEqual([...new Set(results.map((r) => r.mode))], ['none', 'only:demo', 'default', 'all']);
});

test('the isolation run really sets the variable: only:demo produced out/b.txt', async () => {
  const { results } = await checkMigrations({ implDir, casesDir: CASES, registryDir: declaredDemo(), migrations: DEMO });
  const only = results.find((r) => r.mode === 'only:demo' && r.case === 'm1');
  assert.deepEqual(only.problems, []);
  assert.equal(only.files['out/b.txt'], 'added\n');
  assert.equal(results.find((r) => r.mode === 'none').files['out/b.txt'], undefined);
});

test('an undeclared change fails', async () => {
  const registryDir = registry();
  assert.ok(registryProblems(loadRegistry(registryDir).entries, DEMO, CASES).includes('demo: landed but declares no case'));
  const { results } = await checkMigrations({ implDir, casesDir: CASES, registryDir, migrations: DEMO });
  assert.ok(byMode(results, 'registry').includes('demo: landed but declares no case'));
  const only = byMode(results, 'only:demo');
  assert.ok(only.includes('differs out/a.txt'), only.join('; '));
  assert.ok(only.includes('extra out/b.txt'), only.join('; '));
});

test('a declared no-op fails', async () => {
  const declared = { reason: REASON, changed: ['out/a.txt'] };
  assert.throws(() => expectedFor({ 'out/a.txt': 'base\n' }, declared, () => 'base\n', 'm1'), /declares no change: m1 out\/a\.txt/);
  const registryDir = registry({ declared: { m1: declared }, after: { 'm1/out/a.txt': 'base\n' } });
  const { results } = await checkMigrations({ implDir, casesDir: CASES, registryDir, migrations: DEMO });
  assert.ok(byMode(results, 'only:demo').includes('declares no change: m1 out/a.txt'));
  assert.ok(byMode(results, 'default').includes('declares no change: m1 out/a.txt'), 'composition rejects it too');
});

test('expectedFor overlays changed paths and deletes removed ones', () => {
  const got = expectedFor({ a: '1', b: '2', c: '3' }, { changed: ['a', 'd'], removed: ['c'] }, (p) => `new ${p}`, 'k');
  assert.equal(Object.getPrototypeOf(got), null, 'a null-prototype file map');
  assert.deepEqual({ ...got }, { a: 'new a', b: '2', d: 'new d' });
  assert.throws(() => expectedFor({ a: '1' }, { removed: ['zz'] }, () => '', 'k'), /declares no change: k zz/);
});

test('compareFiles: exits, then missing, extra, differs', () => {
  assert.deepEqual(compareFiles({ a: '1', b: '2' }, { b: '3', c: '4' }, [0, 0], [0, 2]), ['exit 1=2', 'missing a', 'extra c', 'differs b']);
  assert.deepEqual(compareFiles({ a: '1' }, { a: '1' }), []);
});

test('registry validation', () => {
  const p = (opts, migrations = DEMO) => registryProblems(loadRegistry(registry(opts)).entries, migrations, CASES);
  assert.ok(p({ declared: { m1: { reason: 'too short', changed: ['out/a.txt'] } }, after: { 'm1/out/a.txt': 'x\n' } })
    .includes('demo: m1 reason must be at least 40 characters'));
  assert.ok(p({ declared: { m1: { reason: REASON, changed: ['out/a.txt'] } } }).includes('demo: m1 missing after-file out/a.txt'));
  assert.ok(p({ id: 'stray' }).includes('stray: unknown migration'));
  assert.ok(p({ id: 'stray' }).includes('demo: no registry entry'));
  assert.ok(p({ item: 2 }).includes('demo: item 2 but MIGRATIONS says 1'));
  assert.ok(p({ beforeCases: ['m1', 'gone'] }).includes('demo: beforeCases names missing case gone'));
  assert.ok(p({ declared: { gone: { reason: REASON, changed: [] } } }).includes('demo: declared case gone does not exist'));
  assert.ok(p({ declared: { m1: { reason: REASON, changed: ['out/a.txt'] } }, after: { 'm1/out/a.txt': 'x\n' } }, [{ id: 'demo', item: 1, landed: false }])
    .includes('demo: not landed but declares m1'));
  assert.deepEqual(p({}, [{ id: 'demo', item: 1, landed: false }]), []);
});

test('registry validation: a grouped entry\'s optional items is an integer array that includes item', () => {
  const p = (items) => registryProblems(loadRegistry(registry({ items })).entries, [{ id: 'demo', item: 1, landed: false }], CASES);
  const BAD = 'demo: items must be an array of integers that includes item 1';
  assert.deepEqual(p(undefined), []);
  assert.deepEqual(p([1, 2]), []);
  assert.deepEqual(p([3, 1]), []);
  for (const bad of [[], [2, 3], [1, 2.5], [1, '2'], ['1'], 1, '1,2', { 0: 1 }, null]) assert.ok(p(bad).includes(BAD), `items ${JSON.stringify(bad)}`);
});

// Moved from "write generates the declared files; b2 generates expected/b2; default then passes": the
// cumulative expectation is now the composition, so default and all pass with nothing recorded under cases/.
test('write generates the declared files; default and all then pass against the composition', async () => {
  const casesDir = tempCases();
  const impl = demoImpl();
  const registryDir = registry({ declared: { m1: { reason: REASON, changed: [] } } });
  const opts = { implDir: impl, casesDir, registryDir, migrations: DEMO };
  await assert.rejects(writeDeclared({ ...opts, registryDir: registry({ declared: {} }), id: 'demo', cases: ['m1'] }), /no declared reason for m1/);
  await writeDeclared({ ...opts, id: 'demo', cases: ['m1'] });
  const entry = JSON.parse(readFileSync(join(registryDir, 'demo', 'migration.json'), 'utf8'));
  assert.deepEqual(entry.declared.m1, { reason: REASON, changed: ['out/a.txt', 'out/b.txt'] });
  assert.equal(readFileSync(join(registryDir, 'demo', 'expected', 'm1', 'out', 'b.txt'), 'utf8'), 'added\n');
  assert.deepEqual(readdirNames(join(casesDir, 'm1', 'expected')), ['49577c7'], 'write never touches the cases tree');
  const shown = showDeclared({ casesDir, registryDir, id: 'demo' });
  assert.match(shown, /^-base$/m);
  assert.match(shown, /^\+demo$/m);
  assert.match(shown, /^\+added$/m);
  const { results } = await checkMigrations(opts);
  assert.deepEqual(results.flatMap((r) => r.problems), []);
  assert.deepEqual([...new Set(results.map((r) => r.mode))], ['none', 'only:demo', 'default', 'all']);
});

// Fix round 1: a migration whose implementation ignores the variable must not pass through an empty or
// baseline-equal declaration.
const inertImpl = () => fakeImpl(["writeFileSync('out/a.txt', 'base\\n');"], ['demo']);

test('an empty declaration is a registry problem', () => {
  const entries = loadRegistry(registry({ declared: { m1: { reason: REASON, changed: [] } } })).entries;
  assert.ok(registryProblems(entries, DEMO, CASES).includes('demo: m1 declares no change'));
  const withExits = loadRegistry(registry({ declared: { m1: { reason: REASON, changed: [], exits: [1] } } })).entries;
  assert.ok(!registryProblems(withExits, DEMO, CASES).includes('demo: m1 declares no change'));
});

test('write refuses a case the migration does not change', async () => {
  const registryDir = registry({ declared: { m1: { reason: REASON, changed: [] } } });
  const before = readFileSync(join(registryDir, 'demo', 'migration.json'), 'utf8');
  await assert.rejects(writeDeclared({ implDir: inertImpl(), casesDir: CASES, registryDir, migrations: DEMO, id: 'demo', cases: ['m1'] }),
    /demo: m1 shows no difference from its baseline under only:demo/);
  assert.equal(readFileSync(join(registryDir, 'demo', 'migration.json'), 'utf8'), before);
  assert.ok(!existsSync(join(registryDir, 'demo', 'expected')));
});

// Moved from "default: an expected/b2 equal to the baseline is a problem": an inert implementation now fails
// default and all against the composed expectation (there is no recorded b2 to equal the baseline).
test('default and all: an inert implementation fails the composed expectation', async () => {
  const { results } = await checkMigrations({ implDir: inertImpl(), casesDir: CASES, registryDir: declaredDemo(), migrations: DEMO });
  for (const mode of ['only:demo', 'default', 'all']) assert.deepEqual(byMode(results, mode), ['missing out/b.txt', 'differs out/a.txt'], mode);
  assert.deepEqual(byMode(results, 'none'), []);
});

test('an always-on implementation fails none', async () => {
  const impl = fakeImpl(["writeFileSync('out/a.txt', 'demo\\n');", "writeFileSync('out/b.txt', 'added\\n');"], ['demo']);
  const { results } = await checkMigrations({ implDir: impl, casesDir: CASES, registryDir: declaredDemo(), migrations: DEMO });
  assert.deepEqual(byMode(results, 'none'), ['extra out/b.txt', 'differs out/a.txt']);
  assert.deepEqual(byMode(results, 'default'), []);
});

test('a case directory without replay.json is a problem, never skipped', async () => {
  const casesDir = tempCases();
  mkdirSync(join(casesDir, 'empty'));
  const registryDir = registry({ beforeCases: ['m1', 'empty'], declared: { m1: { reason: REASON, changed: ['out/a.txt', 'out/b.txt'] }, empty: { reason: REASON, changed: ['x'] } },
    after: { 'm1/out/a.txt': 'demo\n', 'm1/out/b.txt': 'added\n', 'empty/x': 'x\n' } });
  const reg = registryProblems(loadRegistry(registryDir).entries, DEMO, casesDir);
  assert.ok(reg.includes('demo: beforeCases case empty has no replay.json'), reg.join('; '));
  assert.ok(reg.includes('demo: declared case empty has no replay.json'), reg.join('; '));
  const { results } = await checkMigrations({ implDir, casesDir, registryDir, migrations: DEMO });
  for (const mode of ['none', 'only:demo', 'default', 'all']) {
    assert.deepEqual(results.filter((r) => r.mode === mode && r.case === 'empty').map((r) => r.problems), [['no replay.json']], mode);
  }
});

test('compareFiles reports an exit-count mismatch', () => {
  assert.deepEqual(compareFiles({}, {}, [0, 0], [0]), ['1 exit(s), expected 2']);
  assert.deepEqual(compareFiles({}, {}, [0], [0, 3]), ['exit 1=3', '2 exit(s), expected 1']);
});

// Codex P3P-01, Reproduction E: a filename that collides with an Object.prototype member is an ordinary path.
test('P3P-01: prototype-named paths are ordinary paths everywhere', () => {
  const g = Object.create(null); g.toString = 'UNDECLARED';
  assert.deepEqual(compareFiles(Object.create(null), g), ['extra toString']);
  const want = expectedFor(Object.create(null), { changed: ['__proto__'] }, () => 'DECLARED', 'c');
  assert.equal(Object.hasOwn(want, '__proto__'), true);
  assert.equal(want['__proto__'], 'DECLARED');
  const base = { files: Object.assign(Object.create(null), { 'out/a.txt': 'base' }), exits: [0] };
  const r = M.composeExpected(base, [{ id: 'a', entry: null, d: { removed: ['toString'] } }], null, 'c');
  assert.ok(r.problems.includes('declares no change: c toString'), r.problems.join('\n'));
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const w = Object.create(null); w[name] = 'A';
    const x = Object.create(null); x[name] = 'B';
    assert.deepEqual(compareFiles(w, x), [`differs ${name}`]);
    assert.deepEqual(compareFiles(w, Object.create(null)), [`missing ${name}`]);
  }
});

/** A copy of the fixture cases whose m1 also selects `extraOutputs` and whose baseline golden also holds `golden`
 * (pairs, so a `__proto__` name stays an ordinary path). */
function protoCases(extraOutputs = [], golden = []) {
  const d = tempCases();
  const p = join(d, 'm1', 'replay.json');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  m.outputs = [...m.outputs, ...extraOutputs];
  writeFileSync(p, `${JSON.stringify(m)}\n`);
  for (const [k, v] of golden) writeFileSync(join(d, 'm1', 'expected', '49577c7', k), v);
  return d;
}

test('P3P-01 (full gate): a declared out/__proto__ with wrong bytes fails only:demo and default', async () => {
  const impl = fakeImpl(["writeFileSync('out/a.txt', 'base\\n');", "if (on.has('demo')) writeFileSync('out/__proto__', 'WRONG\\n');"], ['demo']);
  const registryDir = registry({ declared: { m1: { reason: REASON, changed: ['out/__proto__'] } }, after: { 'm1/out/__proto__': 'DECLARED\n' } });
  const { results } = await checkMigrations({ implDir: impl, casesDir: CASES, registryDir, migrations: DEMO });
  assert.deepEqual(byMode(results, 'registry'), []);
  for (const mode of ['only:demo', 'default', 'all']) assert.deepEqual(byMode(results, mode), ['differs out/__proto__'], mode);
  assert.deepEqual(byMode(results, 'none'), []);
});

test('P3P-01 (full gate): root-level __proto__, toString and constructor are exact paths in every mode', async () => {
  // A declared root __proto__ with wrong bytes fails; with the declared bytes it passes.
  const casesDir = protoCases(['__proto__']);
  const registryDir = registry({ declared: { m1: { reason: REASON, changed: ['__proto__'] } }, after: { 'm1/__proto__': 'DECLARED\n' } });
  const write = (v) => fakeImpl(["writeFileSync('out/a.txt', 'base\\n');", `if (on.has('demo')) writeFileSync('__proto__', ${JSON.stringify(v)});`], ['demo']);
  const bad = await checkMigrations({ implDir: write('WRONG\n'), casesDir, registryDir, migrations: DEMO });
  assert.deepEqual(byMode(bad.results, 'registry'), []);
  for (const mode of ['only:demo', 'default', 'all']) assert.deepEqual(byMode(bad.results, mode), ['differs __proto__'], mode);
  const ok = await checkMigrations({ implDir: write('DECLARED\n'), casesDir, registryDir, migrations: DEMO });
  assert.deepEqual(ok.results.flatMap((r) => r.problems), []);
  assert.equal(ok.results.find((r) => r.mode === 'default').files['__proto__'], 'DECLARED\n');
  // An undeclared root toString is extra; a baseline root constructor the run omits is missing; a baseline
  // root __proto__ the run rewrites differs.
  const off = [{ id: 'demo', item: 1, landed: false }];
  const extra = await checkMigrations({ implDir: fakeImpl(["writeFileSync('out/a.txt', 'base\\n');", "writeFileSync('toString', 'UNDECLARED\\n');"], []),
    casesDir: protoCases(['toString']), registryDir: registry(), migrations: off });
  for (const mode of ['none', 'default']) assert.deepEqual(byMode(extra.results, mode), ['extra toString'], mode);
  const missing = await checkMigrations({ implDir: fakeImpl(["writeFileSync('out/a.txt', 'base\\n');"], []),
    casesDir: protoCases(['constructor'], [['constructor', 'base\n']]), registryDir: registry(), migrations: off });
  assert.deepEqual(byMode(missing.results, 'none'), ['missing constructor']);
  const differs = await checkMigrations({ implDir: fakeImpl(["writeFileSync('out/a.txt', 'base\\n');", "writeFileSync('__proto__', 'X\\n');"], []),
    casesDir: protoCases(['__proto__'], [['__proto__', 'base\n']]), registryDir: registry(), migrations: off });
  assert.deepEqual(byMode(differs.results, 'none'), ['differs __proto__']);
});

test('P3P-01: the registry treats prototype-named cases as ordinary names', () => {
  const casesDir = tempCases();
  const { entries } = loadRegistry(registry({ beforeCases: ['m1'], declared: { m1: { reason: REASON, changed: ['out/a.txt'] } }, after: { 'm1/out/a.txt': 'x\n' } }));
  // JSON.parse keeps Object.prototype: `toString in declared` must not count as a declaration.
  entries.get('demo').beforeCases.push('toString');
  mkdirSync(join(casesDir, 'toString'));
  writeFileSync(join(casesDir, 'toString', 'replay.json'), readFileSync(join(casesDir, 'm1', 'replay.json')));
  assert.ok(registryProblems(entries, DEMO, casesDir).includes('demo: before-case toString not declared'));
});

// ---- Two landed migrations: composition (Codex P3-01, Reproduction A) --------------------------------------
const AB = [{ id: 'a', item: 1, landed: true }, { id: 'b', item: 2, landed: true }];
const A_REASON = 'migration a rewrites out/a.txt from base to A';
const B_REASON = 'migration b adds out/b.txt holding the letter B';
const I_REASON = 'a and b together stamp out/a.txt with both letters, AB';
/** Fake impl: a rewrites out/a.txt to A, b adds out/b.txt = B; `combined` lines run when both are on. */
const abImpl = (...combined) => fakeImpl([
  "writeFileSync('out/a.txt', on.has('a') ? 'A\\n' : 'base\\n');",
  "if (on.has('b')) writeFileSync('out/b.txt', 'B\\n');",
  ...combined.map((l) => `if (on.has('a') && on.has('b')) ${l}`),
], ['a', 'b']);
/** A temp registry holding several entries: `{ <id>: { item, declared, after: { '<case>/<path>': content } } }`;
 * `_interactions: { <case>: { json, after: { <path>: content } } }` adds interaction declarations. */
function multiRegistry(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'ht-mig-reg-'));
  const put = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, v); };
  for (const [id, s] of Object.entries(spec)) {
    if (id === '_interactions') {
      for (const [c, { json, after = {} }] of Object.entries(s)) {
        put(join(dir, '_interactions', c, 'interaction.json'), `${JSON.stringify(json, null, 2)}\n`);
        for (const [k, v] of Object.entries(after)) put(join(dir, '_interactions', c, 'expected', k), v);
      }
      continue;
    }
    const { item, declared, after = {}, beforeCases = ['m1'], extra = {} } = s;
    put(join(dir, id, 'migration.json'), `${JSON.stringify({ id, item, spec: '§14.8', summary: 'Demo.', beforeCases, declared, ...extra }, null, 2)}\n`);
    for (const [k, v] of Object.entries(after)) put(join(dir, id, 'expected', k), v);
  }
  return dir;
}
const aEntry = { item: 1, declared: { m1: { reason: A_REASON, changed: ['out/a.txt'] } }, after: { 'm1/out/a.txt': 'A\n' } };
const bEntry = { item: 2, declared: { m1: { reason: B_REASON, changed: ['out/b.txt'] } }, after: { 'm1/out/b.txt': 'B\n' } };
const abRegistry = (extra = {}) => multiRegistry({ a: aEntry, b: bEntry, ...extra });
const both = (results) => assert.deepEqual(byMode(results, 'all'), byMode(results, 'default'), 'default and all agree');

test('adversarial 1: combined run writes undeclared bytes on a declared path — default and all report differs', async () => {
  const { results } = await checkMigrations({ implDir: abImpl("writeFileSync('out/a.txt', 'UNDECLARED\\n');"), casesDir: CASES, registryDir: abRegistry(), migrations: AB });
  assert.deepEqual(byMode(results, 'only:a'), []);
  assert.deepEqual(byMode(results, 'only:b'), []);
  assert.deepEqual(byMode(results, 'default'), ['differs out/a.txt']);
  both(results);
});

test('adversarial 2: combined run cancels a declared change — default and all report differs', async () => {
  const { results } = await checkMigrations({ implDir: abImpl("writeFileSync('out/a.txt', 'base\\n');"), casesDir: CASES, registryDir: abRegistry(), migrations: AB });
  assert.deepEqual(byMode(results, 'only:a'), []);
  assert.deepEqual(byMode(results, 'default'), ['differs out/a.txt']);
  both(results);
});

test('adversarial 3: combined run removes a path declared only as changed — default and all report missing', async () => {
  const { results } = await checkMigrations({ implDir: abImpl("rmSync('out/a.txt');"), casesDir: CASES, registryDir: abRegistry(), migrations: AB });
  assert.deepEqual(byMode(results, 'only:a'), []);
  assert.deepEqual(byMode(results, 'default'), ['missing out/a.txt']);
  both(results);
});

// Moved from the F1 b2 tests ("b2 refuses a combined-run file no landed migration declares" and "default mode
// rejects an expected/b2 carrying an undeclared difference"): the composition has no such file, so the run fails.
test('F1: default and all reject a combined-run file no landed migration declares', async () => {
  const { results } = await checkMigrations({ implDir: abImpl("writeFileSync('out/undeclared.txt', 'surprise\\n');"), casesDir: CASES, registryDir: abRegistry(), migrations: AB });
  assert.deepEqual(byMode(results, 'default'), ['extra out/undeclared.txt']);
  both(results);
  assert.deepEqual(byMode(results, 'only:a'), []);
  assert.deepEqual(byMode(results, 'only:b'), []);
});

// Moved from "F1: with two declarers and no undeclared difference, b2 + default pass".
test('F1: two disjoint declarers compose; every mode passes with no recorded cumulative golden', async () => {
  const casesDir = tempCases();
  const { results } = await checkMigrations({ implDir: abImpl(), casesDir, registryDir: abRegistry(), migrations: AB });
  assert.deepEqual(results.flatMap((r) => r.problems), []);
  assert.deepEqual([...new Set(results.map((r) => r.mode))], ['none', 'only:a', 'only:b', 'default', 'all']);
  const dflt = results.find((r) => r.mode === 'default');
  assert.deepEqual({ ...dflt.files }, { 'out/a.txt': 'A\n', 'out/b.txt': 'B\n' });
  assert.ok(!existsSync(join(casesDir, 'm1', 'expected', 'b2')));
});

// Moved from "F1: a single declarer pins expected/b2 to baseline + its declared diff exactly".
test('F1: a single declarer pins default to baseline + its declared diff exactly', async () => {
  const impl = fakeImpl(["writeFileSync('out/a.txt', raw === undefined ? 'other\\n' : on.has('demo') ? 'demo\\n' : 'base\\n');", "if (on.has('demo')) writeFileSync('out/b.txt', 'added\\n');"], ['demo']);
  const { results } = await checkMigrations({ implDir: impl, casesDir: CASES, registryDir: declaredDemo(), migrations: DEMO });
  assert.deepEqual(byMode(results, 'default'), ['differs out/a.txt']);
  assert.deepEqual(byMode(results, 'all'), []);
});

// Moved from "F1: b2 refuses an exit change no landed migration declares".
test('F1: default and all reject an exit change no landed migration declares', async () => {
  const impl = fakeImpl(["writeFileSync('out/a.txt', on.has('demo') ? 'demo\\n' : 'base\\n');", "if (on.has('demo')) { writeFileSync('out/b.txt', 'added\\n'); process.exitCode = 3; }"], ['demo']);
  const { results } = await checkMigrations({ implDir: impl, casesDir: CASES, registryDir: declaredDemo(), migrations: DEMO });
  for (const mode of ['only:demo', 'default', 'all']) assert.deepEqual(byMode(results, mode), ['exit 0=3'], mode);
});

const sameA = { item: 2, declared: { m1: { reason: B_REASON.replace('adds out/b.txt', 'rewrites out/a.txt'), changed: ['out/a.txt'] } }, after: { 'm1/out/a.txt': 'B\n' } };
/** a writes out/a.txt = A, b writes out/a.txt = B; `combined` decides the content when both are on. */
const overlapImpl = (combined) => fakeImpl([
  "writeFileSync('out/a.txt', on.has('a') && on.has('b') ? " + JSON.stringify(combined) + " : on.has('a') ? 'A\\n' : on.has('b') ? 'B\\n' : 'base\\n');",
], ['a', 'b']);
const CONFLICT = 'm1: out/a.txt is declared by a and b — needs an interaction declaration';
const interaction = (over = {}, after = { 'out/a.txt': 'AB\n' }) => ({ m1: { json: { case: 'm1', migrations: ['a', 'b'], reason: I_REASON, changed: ['out/a.txt'], ...over }, after } });

test('adversarial 4: two declarers of one path without an interaction is a composition problem', async () => {
  const { results } = await checkMigrations({ implDir: overlapImpl('AB\n'), casesDir: CASES, registryDir: multiRegistry({ a: aEntry, b: sameA }), migrations: AB });
  assert.deepEqual(byMode(results, 'only:a'), []);
  assert.deepEqual(byMode(results, 'only:b'), []);
  assert.deepEqual(byMode(results, 'default'), [CONFLICT]);
  assert.deepEqual(byMode(results, 'all'), [CONFLICT]);
});

test('adversarial 5: an interaction covers the overlap; the run must produce its bytes exactly', async () => {
  const registryDir = multiRegistry({ a: aEntry, b: sameA, _interactions: interaction() });
  const ok = await checkMigrations({ implDir: overlapImpl('AB\n'), casesDir: CASES, registryDir, migrations: AB });
  assert.deepEqual(ok.results.flatMap((r) => r.problems), []);
  const bad = await checkMigrations({ implDir: overlapImpl('A\n'), casesDir: CASES, registryDir, migrations: AB });
  assert.deepEqual(byMode(bad.results, 'default'), ['differs out/a.txt']);
  assert.deepEqual(byMode(bad.results, 'all'), ['differs out/a.txt']);
  assert.deepEqual(byMode(bad.results, 'only:a'), [], 'isolation modes ignore interactions');
});

test('adversarial 6: an interaction naming an unlanded (or unknown, or single) migration is a registry problem', () => {
  const ABC = [...AB, { id: 'c', item: 3, landed: false }];
  const regOf = (spec, migrations) => { const { entries, interactions, problems } = loadRegistry(multiRegistry(spec)); return [...problems, ...registryProblems(entries, migrations, CASES, interactions)]; };
  const c = { item: 3, declared: {} };
  assert.ok(regOf({ a: aEntry, b: bEntry, c, _interactions: interaction({ migrations: ['a', 'c'] }) }, ABC).includes('_interactions/m1: migration c has not landed'));
  assert.ok(regOf({ a: aEntry, b: bEntry, c, _interactions: interaction({ migrations: ['a', 'zz'] }) }, ABC).includes('_interactions/m1: unknown migration zz'));
  assert.ok(regOf({ a: aEntry, b: bEntry, c, _interactions: interaction({ migrations: ['a'] }) }, ABC).includes('_interactions/m1: migrations must name at least 2 distinct migrations'));
  assert.ok(regOf({ a: aEntry, b: bEntry, _interactions: interaction({ reason: 'short' }) }, AB).includes('_interactions/m1: reason must be at least 40 characters'));
  assert.ok(regOf({ a: aEntry, b: bEntry, _interactions: interaction({}, {}) }, AB).includes('_interactions/m1: missing after-file out/a.txt'));
  assert.ok(regOf({ a: aEntry, b: bEntry, _interactions: interaction({ changed: [] }, {}) }, AB).includes('_interactions/m1: declares no change'));
  assert.ok(regOf({ a: aEntry, b: bEntry, _interactions: interaction({ changed: ['../x'] }, {}) }, AB).includes('_interactions/m1: changed must be a list of relative paths'));
  assert.ok(regOf({ a: aEntry, b: bEntry, _interactions: interaction({ case: 'm2' }) }, AB).includes('_interactions/m1: interaction.json case "m2" does not match its directory'));
  assert.ok(regOf({ a: aEntry, b: bEntry, _interactions: { gone: interaction({ case: 'gone' }).m1 } }, AB).includes('_interactions/gone: case gone does not exist'));
  assert.ok(regOf({ a: aEntry, b: bEntry, _interactions: interaction({ exits: [0, 1] }) }, AB).includes('_interactions/m1: exits has 2 value(s), the baseline has 1'));
  assert.deepEqual(regOf({ a: aEntry, b: sameA, _interactions: interaction() }, AB), []);
  assert.equal(loadRegistry(multiRegistry({ a: aEntry, b: bEntry, _interactions: interaction() })).entries.has('_interactions'), false, 'loadRegistry skips _interactions');
});

test('adversarial 7: an interaction path equal to the plain composition is a vacuous declaration', async () => {
  const registryDir = abRegistry({ _interactions: interaction({}, { 'out/a.txt': 'A\n' }) });
  const { results } = await checkMigrations({ implDir: abImpl(), casesDir: CASES, registryDir, migrations: AB });
  assert.deepEqual(byMode(results, 'default'), ['interaction declares no change: m1 out/a.txt']);
  assert.deepEqual(byMode(results, 'all'), ['interaction declares no change: m1 out/a.txt']);
});

/** A two-event copy of m1 (event i runs w.mjs with argument i), baseline exits [0, 0]. */
function twoEventCases() {
  const casesDir = tempCases();
  cpSync(join(casesDir, 'm1'), join(casesDir, 'm2'), { recursive: true });
  const m = JSON.parse(readFileSync(join(casesDir, 'm2', 'replay.json'), 'utf8'));
  m.id = 'm2';
  m.events = [0, 1].map((i) => ({ ...m.events[0], args: [String(i)] }));
  writeFileSync(join(casesDir, 'm2', 'replay.json'), `${JSON.stringify(m)}\n`);
  return casesDir;
}
const exitImpl = (aCode, bCode) => fakeImpl([
  "writeFileSync('out/a.txt', 'base\\n');",
  `if (process.argv[2] === '0' && on.has('a')) process.exitCode = ${aCode};`,
  `if (process.argv[2] === '1' && on.has('b')) process.exitCode = ${bCode};`,
], ['a', 'b']);

test('adversarial 9: per-event exits compose; conflicting values at one event need an interaction', async () => {
  const casesDir = twoEventCases();
  const ex = (id, item, exits) => ({ item, beforeCases: ['m2'], declared: { m2: { reason: `${id} changes the exit code of one event of m2 only`, changed: [], exits } } });
  const registryDir = multiRegistry({ a: ex('a', 1, [2, 0]), b: ex('b', 2, [0, 3]) });
  const { results } = await checkMigrations({ implDir: exitImpl(2, 3), casesDir, registryDir, migrations: AB });
  assert.deepEqual(results.flatMap((r) => r.problems), []);
  assert.deepEqual(results.find((r) => r.mode === 'default' && r.case === 'm2').exits, [2, 3]);
  const base = { files: { 'out/a.txt': 'base\n' }, exits: [0, 0] };
  const dec = (id, exits) => ({ id, entry: null, d: { reason: 'x'.repeat(40), changed: [], exits } });
  const composed = M.composeExpected(base, [dec('a', [2, 0]), dec('b', [0, 3])], null, 'm2');
  assert.deepEqual(composed.exits, [2, 3]);
  assert.deepEqual(composed.problems, []);
  assert.deepEqual(M.composeExpected(base, [dec('a', [2, 0]), dec('b', [5, 0])], null, 'm2').problems, ['m2: exit:0 is declared by a and b — needs an interaction declaration']);
  assert.deepEqual(M.composeExpected(base, [dec('a', [2, 0]), dec('b', [2, 0])], null, 'm2').problems, [], 'the same non-baseline value is no conflict');
  assert.deepEqual(M.composeExpected(base, [dec('a', [2])], null, 'm2').problems, ['m2: a declares 1 exit(s), the baseline has 2']);
  const conflicting = multiRegistry({ a: ex('a', 1, [2, 0]), b: ex('b', 2, [5, 0]) });
  const r2 = await checkMigrations({ implDir: exitImpl(2, 3), casesDir, registryDir: conflicting, migrations: AB });
  assert.deepEqual(byMode(r2.results, 'default'), ['m2: exit:0 is declared by a and b — needs an interaction declaration']);
});

// Pinned behaviour (adversarial 10): `write` RECORDS the run's complete exit vector — it sets `exits` when the
// run's exits differ from the baseline and drops a stale `exits` key when they equal it — so the recorded
// declaration always matches the run, and `show` prints it next to the baseline for review.
test('adversarial 10: write records the run\'s exit vector, replacing a stale declared one', async () => {
  const impl = fakeImpl(["writeFileSync('out/a.txt', on.has('demo') ? 'demo\\n' : 'base\\n');", "if (on.has('demo')) process.exitCode = 3;"], ['demo']);
  const registryDir = registry({ declared: { m1: { reason: REASON, changed: [], exits: [7] } } });
  await writeDeclared({ implDir: impl, casesDir: CASES, registryDir, migrations: DEMO, id: 'demo', cases: ['m1'] });
  assert.deepEqual(JSON.parse(readFileSync(join(registryDir, 'demo', 'migration.json'), 'utf8')).declared.m1, { reason: REASON, changed: ['out/a.txt'], exits: [3] });
  assert.match(showDeclared({ casesDir: CASES, registryDir, id: 'demo' }), /^exits: \[0\] → \[3\]$/m);
  const { results } = await checkMigrations({ implDir: impl, casesDir: CASES, registryDir, migrations: DEMO });
  assert.deepEqual(results.flatMap((r) => r.problems), []);
  const noExit = fakeImpl(["writeFileSync('out/a.txt', on.has('demo') ? 'demo\\n' : 'base\\n');"], ['demo']);
  await writeDeclared({ implDir: noExit, casesDir: CASES, registryDir, migrations: DEMO, id: 'demo', cases: ['m1'] });
  assert.deepEqual(JSON.parse(readFileSync(join(registryDir, 'demo', 'migration.json'), 'utf8')).declared.m1, { reason: REASON, changed: ['out/a.txt'] }, 'stale exits dropped');
});

test('adversarial 11: an approved engine-only case participates in default and all against expected/engine', async () => {
  const casesDir = tempCases();
  cpSync(join(casesDir, 'm1'), join(casesDir, 'e1'), { recursive: true });
  const m = JSON.parse(readFileSync(join(casesDir, 'e1', 'replay.json'), 'utf8'));
  writeFileSync(join(casesDir, 'e1', 'replay.json'), `${JSON.stringify({ ...m, id: 'e1', implOnly: 'engine' })}\n`);
  cpSync(join(casesDir, 'e1', 'expected', '49577c7'), join(casesDir, 'e1', 'expected', 'engine'), { recursive: true });
  rmSync(join(casesDir, 'e1', 'expected', '49577c7'), { recursive: true });
  writeFileSync(join(casesDir, 'e1', 'expected', 'engine', 'out', 'a.txt'), 'engine base\n');
  const e1m = JSON.parse(readFileSync(join(casesDir, 'e1', 'replay.json'), 'utf8'));
  e1m.events[0].args = ['engine'];
  writeFileSync(join(casesDir, 'e1', 'replay.json'), `${JSON.stringify(e1m)}\n`);
  const impl = fakeImpl(["writeFileSync('out/a.txt', on.has('demo') ? 'demo\\n' : process.argv[2] === 'engine' ? 'engine base\\n' : 'base\\n');", "if (on.has('demo')) writeFileSync('out/b.txt', 'added\\n');"], ['demo']);
  const approvals = { e1: { reason: 'a fake engine-only case for the declared-diff harness test suite' } };
  const reg = registry({ beforeCases: ['m1', 'e1'], declared: { m1: { reason: REASON, changed: ['out/a.txt', 'out/b.txt'] }, e1: { reason: REASON, changed: ['out/a.txt', 'out/b.txt'] } },
    after: { 'm1/out/a.txt': 'demo\n', 'm1/out/b.txt': 'added\n', 'e1/out/a.txt': 'demo\n', 'e1/out/b.txt': 'added\n' } });
  const { results } = await checkMigrations({ implDir: impl, casesDir, registryDir: reg, migrations: DEMO, approvals });
  const e1 = (mode) => results.find((r) => r.mode === mode && r.case === 'e1');
  for (const mode of ['default', 'all']) {
    assert.deepEqual(e1(mode).problems, [], mode);
    assert.deepEqual({ ...e1(mode).files }, { 'out/a.txt': 'demo\n', 'out/b.txt': 'added\n' }, mode);
  }
  // A declaration that is vacuous only against expected/engine proves the engine golden is the base.
  const vac = registry({ beforeCases: ['m1', 'e1'], declared: { m1: { reason: REASON, changed: ['out/a.txt', 'out/b.txt'] }, e1: { reason: REASON, changed: ['out/a.txt'] } },
    after: { 'm1/out/a.txt': 'demo\n', 'm1/out/b.txt': 'added\n', 'e1/out/a.txt': 'engine base\n' } });
  const r2 = await checkMigrations({ implDir: impl, casesDir, registryDir: vac, migrations: DEMO, approvals });
  assert.deepEqual(r2.results.find((r) => r.mode === 'all' && r.case === 'e1').problems, ['declares no change: e1 out/a.txt']);
});

test('adversarial 12: write-interaction refuses when the run equals the composition, and writes nothing', async () => {
  const registryDir = abRegistry({ _interactions: interaction({ changed: [] }, {}) });
  const file = join(registryDir, '_interactions', 'm1', 'interaction.json');
  const before = readFileSync(file, 'utf8');
  const casesDir = tempCases();
  const opts = { implDir: abImpl(), casesDir, registryDir, migrations: AB };
  await assert.rejects(M.writeInteraction({ ...opts, caseId: 'm1' }), /m1: the default-mode output equals the composition of its declarations — no interaction recorded/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.ok(!existsSync(join(registryDir, '_interactions', 'm1', 'expected')));
  assert.deepEqual(readdirNames(join(casesDir, 'm1', 'expected')), ['49577c7']);
  await assert.rejects(M.writeInteraction({ ...opts, registryDir: abRegistry(), caseId: 'm1' }), /no _interactions\/m1\/interaction\.json/);
  await assert.rejects(M.writeInteraction({ ...opts, registryDir: abRegistry({ _interactions: interaction({ reason: '' }) }), caseId: 'm1' }), /write the reason/);
});

test('write-interaction refuses a difference the interaction does not list, naming each key, and writes nothing', async () => {
  const registryDir = abRegistry({ _interactions: interaction({ changed: ['out/a.txt'] }, {}) });
  const file = join(registryDir, '_interactions', 'm1', 'interaction.json');
  const before = readFileSync(file, 'utf8');
  const opts = { implDir: abImpl("writeFileSync('out/a.txt', 'AB\\n');", "writeFileSync('out/c.txt', 'stamp\\n');", "writeFileSync('out/d.txt', 'stamp\\n');"), casesDir: tempCases(), registryDir, migrations: AB };
  await assert.rejects(M.writeInteraction({ ...opts, caseId: 'm1' }), (e) => {
    assert.match(e.message, /m1: default run differs at out\/c\.txt, not listed in the interaction — add it to changed\/removed first, then re-run/);
    assert.match(e.message, /m1: default run differs at out\/d\.txt, not listed/);
    assert.doesNotMatch(e.message, /out\/a\.txt/);
    return true;
  });
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.ok(!existsSync(join(registryDir, '_interactions', 'm1', 'expected')));
});

test('write-interaction records the listed unowned paths that differ from the composition; show-interaction reviews them', async () => {
  const registryDir = abRegistry({ _interactions: interaction({ changed: ['out/a.txt', 'out/c.txt'] }, {}) });
  const casesDir = tempCases();
  const opts = { implDir: abImpl("writeFileSync('out/a.txt', 'AB\\n');", "writeFileSync('out/c.txt', 'stamp\\n');"), casesDir, registryDir, migrations: AB };
  await M.writeInteraction({ ...opts, caseId: 'm1' });
  const json = JSON.parse(readFileSync(join(registryDir, '_interactions', 'm1', 'interaction.json'), 'utf8'));
  assert.deepEqual(json, { case: 'm1', migrations: ['a', 'b'], reason: I_REASON, changed: ['out/a.txt', 'out/c.txt'] });
  assert.equal(readFileSync(join(registryDir, '_interactions', 'm1', 'expected', 'out', 'a.txt'), 'utf8'), 'AB\n');
  assert.deepEqual(readdirNames(join(casesDir, 'm1', 'expected')), ['49577c7'], 'never writes into the cases tree');
  const { results } = await checkMigrations(opts);
  assert.deepEqual(results.flatMap((r) => r.problems), []);
  const shown = M.showInteraction({ ...opts, caseId: 'm1' });
  assert.match(shown, /^## interaction m1 \(a, b\): a and b together/m);
  assert.match(shown, /^-A$/m);
  assert.match(shown, /^\+AB$/m);
  assert.match(shown, /^\+stamp$/m);
});

test('write-interaction always records a conflicted path, even when the run equals one declarer', async () => {
  const registryDir = multiRegistry({ a: aEntry, b: sameA, _interactions: interaction({ changed: [] }, {}) });
  const opts = { implDir: overlapImpl('B\n'), casesDir: CASES, registryDir, migrations: AB };
  await M.writeInteraction({ ...opts, caseId: 'm1' });
  assert.deepEqual(JSON.parse(readFileSync(join(registryDir, '_interactions', 'm1', 'interaction.json'), 'utf8')).changed, ['out/a.txt']);
  const { results } = await checkMigrations(opts);
  assert.deepEqual(results.flatMap((r) => r.problems), []);
});

// ---- Fix round 1: an interaction may override a declared key only when it names every owner -------------
const ABCW = [...AB, { id: 'c', item: 3, landed: true }, { id: 'w', item: 4, landed: true }];
const cEntry = { item: 3, declared: { m1: { reason: 'migration c adds out/c.txt holding the letter C', changed: ['out/c.txt'] } }, after: { 'm1/out/c.txt': 'C\n' } };
const wEntry = { item: 4, beforeCases: [], declared: {} };
/** Interaction problems only (w and x land declaring no case, which is its own registry problem). */
const interactionProblems = (list) => list.filter((p) => p.startsWith('_interactions/') || p.startsWith('m1:'));
/** composeExpected over a temp registry: the landed declarers of m1 in registry order, plus m1's interaction. */
function composeFrom(spec, migrations = ABCW) {
  const { entries, interactions } = loadRegistry(multiRegistry(spec));
  const declarers = migrations.filter((m) => m.landed && entries.get(m.id)?.declared?.m1).map((m) => ({ id: m.id, entry: entries.get(m.id), d: entries.get(m.id).declared.m1 }));
  return M.composeExpected({ files: { 'out/a.txt': 'base\n' }, exits: [0] }, declarers, interactions.get('m1') ?? null, 'm1');
}
const stamp = (migrations, over = {}, after = { 'out/c.txt': 'STAMP\n' }) => ({ m1: { json: { case: 'm1', migrations, reason: I_REASON, changed: Object.keys(after), ...over }, after } });

test('fix 1: a stale interaction — a migration landing later on an already-overridden path — is a problem', () => {
  const before = composeFrom({ a: aEntry, b: bEntry, _interactions: stamp(['a', 'b']) }, AB);
  assert.deepEqual(before.problems, [], 'unowned stamped path: allowed');
  const after = composeFrom({ a: aEntry, b: bEntry, c: cEntry, w: wEntry, _interactions: stamp(['a', 'b']) });
  assert.deepEqual(after.problems, ['m1: interaction overrides out/c.txt owned by c without naming it']);
});

test('fix 1: an interaction overriding a single-declarer path or exit without naming it is a problem; naming it passes', () => {
  const overA = (migrations) => stamp(migrations, {}, { 'out/a.txt': 'AB\n' });
  assert.deepEqual(composeFrom({ a: aEntry, b: bEntry, c: cEntry, w: wEntry, _interactions: overA(['b', 'c']) }).problems, ['m1: interaction overrides out/a.txt owned by a without naming it']);
  assert.deepEqual(composeFrom({ a: aEntry, b: bEntry, c: cEntry, w: wEntry, _interactions: overA(['a', 'b']) }).problems, []);
  const aExit = { ...aEntry, declared: { m1: { ...aEntry.declared.m1, exits: [2] } } };
  const overExit = (migrations) => stamp(migrations, { exits: [4] });
  assert.deepEqual(composeFrom({ a: aExit, b: bEntry, c: cEntry, w: wEntry, _interactions: overExit(['b', 'c']) }).problems, ['m1: interaction overrides exit:0 owned by a without naming it']);
  assert.deepEqual(composeFrom({ a: aExit, b: bEntry, c: cEntry, w: wEntry, _interactions: overExit(['a', 'c']) }).problems, []);
  const r = composeFrom({ a: aExit, b: bEntry, c: cEntry, w: wEntry, _interactions: overExit(['a', 'c']) });
  assert.deepEqual([r.exits, r.files['out/c.txt']], [[4], 'STAMP\n']);
});

test('fix 1: an unowned-path interaction with one named declarer of the case passes composition and the registry', () => {
  const spec = { a: aEntry, b: bEntry, c: cEntry, w: wEntry, _interactions: stamp(['a', 'w'], {}, { 'out/s.txt': 'STAMP\n' }) };
  assert.deepEqual(composeFrom(spec).problems, []);
  const { entries, interactions, problems } = loadRegistry(multiRegistry(spec));
  assert.deepEqual(interactionProblems([...problems, ...registryProblems(entries, ABCW, CASES, interactions)]), []);
});

test('fix 1: an interaction whose named migrations declare nothing for the case is a registry problem', () => {
  const W2 = [...ABCW, { id: 'x', item: 5, landed: true }];
  const { entries, interactions } = loadRegistry(multiRegistry({ a: aEntry, b: bEntry, c: cEntry, w: wEntry, x: { item: 5, beforeCases: [], declared: {} }, _interactions: stamp(['w', 'x']) }));
  assert.deepEqual(interactionProblems(registryProblems(entries, W2, CASES, interactions)), ['_interactions/m1: interaction names no migration that declares the case']);
});

test('fix 1: write-interaction refuses a key owned by an unnamed migration, and a short reason; writes nothing', async () => {
  const ABC = ABCW.slice(0, 3);
  const impl = fakeImpl([
    "writeFileSync('out/a.txt', on.has('a') ? 'A\\n' : 'base\\n');",
    "if (on.has('b')) writeFileSync('out/b.txt', 'B\\n');",
    "if (on.has('c')) writeFileSync('out/c.txt', on.has('a') && on.has('b') ? 'X\\n' : 'C\\n');",
  ], ['a', 'b', 'c']);
  const registryDir = multiRegistry({ a: aEntry, b: bEntry, c: cEntry, _interactions: stamp(['a', 'b'], { changed: [] }, {}) });
  const file = join(registryDir, '_interactions', 'm1', 'interaction.json');
  const before = readFileSync(file, 'utf8');
  await assert.rejects(M.writeInteraction({ implDir: impl, casesDir: CASES, registryDir, migrations: ABC, caseId: 'm1' }),
    /m1: the run differs at out\/c\.txt, owned by c, which the interaction does not name — nothing written/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.ok(!existsSync(join(registryDir, '_interactions', 'm1', 'expected')));
  const short = multiRegistry({ a: aEntry, b: bEntry, _interactions: stamp(['a', 'b'], { changed: [], reason: 'too short a reason' }, {}) });
  await assert.rejects(M.writeInteraction({ implDir: abImpl("writeFileSync('out/a.txt', 'AB\\n');"), casesDir: CASES, registryDir: short, migrations: AB, caseId: 'm1' }), /reason must be at least 40 characters/);
  assert.ok(!existsSync(join(short, '_interactions', 'm1', 'expected')));
});

/** Every file under `dir` (recursive) with its bytes, as sorted `[relative path, content]` pairs. */
function snapshotDir(dir) {
  const out = [];
  const walk = (p, rel) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { out.push([`${r}/`, null]); walk(join(p, e.name), r); } else out.push([r, readFileSync(join(p, e.name), 'utf8')]);
    }
  };
  walk(dir, '');
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// Codex P3P-03, Reproduction G: the owner check covers conflicted keys too, before anything is written.
test('P3P-03: write-interaction refuses a conflicted key whose owner it does not name, and writes nothing', async () => {
  const ABC = ABCW.slice(0, 3);
  const impl = fakeImpl([
    "writeFileSync('out/a.txt', on.has('a') && on.has('b') ? 'AB\\n' : on.has('a') ? 'A\\n' : on.has('b') ? 'B\\n' : 'base\\n');",
    "if (on.has('c')) writeFileSync('out/c.txt', 'C\\n');",
  ], ['a', 'b', 'c']);
  // A previous recording's after-file must survive the refusal untouched.
  const registryDir = multiRegistry({ a: aEntry, b: sameA, c: cEntry, _interactions: stamp(['a', 'c'], { changed: [] }, { 'out/a.txt': 'OLD\n' }) });
  const idir = join(registryDir, '_interactions', 'm1');
  const before = snapshotDir(idir);
  await assert.rejects(M.writeInteraction({ implDir: impl, casesDir: CASES, registryDir, migrations: ABC, caseId: 'm1' }), (e) => {
    assert.match(e.message, /m1: interaction overrides out\/a\.txt owned by b without naming it/);
    return true;
  });
  assert.deepEqual(snapshotDir(idir), before, 'the interaction directory is byte-identical');
});

// Parked recorder polish: a hand-listed key the run does not change used to be dropped silently.
test('P3P-03: write-interaction refuses a listed key that shows no difference, and writes nothing', async () => {
  const registryDir = multiRegistry({ a: aEntry, b: sameA, _interactions: interaction({ changed: ['out/z.txt'] }, { 'out/z.txt': 'OLD\n' }) });
  const idir = join(registryDir, '_interactions', 'm1');
  const before = snapshotDir(idir);
  await assert.rejects(M.writeInteraction({ implDir: overlapImpl('AB\n'), casesDir: CASES, registryDir, migrations: AB, caseId: 'm1' }),
    /m1: listed key out\/z\.txt shows no difference in the default run/);
  assert.deepEqual(snapshotDir(idir), before, 'the interaction directory is byte-identical');
  const rm = multiRegistry({ a: aEntry, b: sameA, _interactions: interaction({ changed: [], removed: ['out/gone.txt'] }, {}) });
  await assert.rejects(M.writeInteraction({ implDir: overlapImpl('AB\n'), casesDir: CASES, registryDir: rm, migrations: AB, caseId: 'm1' }),
    /m1: listed key out\/gone\.txt shows no difference in the default run/);
  const ex = multiRegistry({ a: aEntry, b: sameA, _interactions: interaction({ changed: [], exits: [0] }, {}) });
  await assert.rejects(M.writeInteraction({ implDir: overlapImpl('AB\n'), casesDir: CASES, registryDir: ex, migrations: AB, caseId: 'm1' }),
    /m1: listed key exits shows no difference in the default run/);
  assert.ok(!existsSync(join(ex, '_interactions', 'm1', 'expected')));
});

test('A2: a path literally named exit:<i> is a registry problem and cannot clear an exit conflict', () => {
  const casesDir = twoEventCases();
  const ex = (id, item, exits) => ({ item, beforeCases: [], declared: { m2: { reason: `${id} changes the exit code of one event of m2 only`, changed: [], exits } } });
  const spec = { a: ex('a', 1, [1, 0]), b: ex('b', 2, [2, 0]), _interactions: { m2: { json: { case: 'm2', migrations: ['a', 'b'], reason: I_REASON, changed: ['exit:0'] }, after: { 'exit:0': 'x\n' } } } };
  const { entries, interactions, problems } = loadRegistry(multiRegistry(spec));
  const all = [...problems, ...registryProblems(entries, AB, casesDir, interactions)];
  assert.ok(all.includes('_interactions/m2: changed must be a list of relative paths'), all.join('\n'));
});

test('fix 1: a 2/5/2 three-way exit conflict keeps all three owners and needs all three named', () => {
  const base = { files: {}, exits: [0] };
  const dec = (id, exits) => ({ id, entry: null, d: { reason: 'x'.repeat(40), changed: [], exits } });
  const ds = [dec('a', [2]), dec('b', [5]), dec('c', [2])];
  const r = M.composeExpected(base, ds, null, 'm1');
  assert.deepEqual(r.problems, ['m1: exit:0 is declared by a and b and c — needs an interaction declaration']);
  assert.deepEqual(r.conflicts, [{ key: 'exit:0', ids: ['a', 'b', 'c'] }]);
  assert.deepEqual(M.composeExpected(base, ds, { migrations: ['a', 'b'], changed: [], exits: [7] }, 'm1').problems, ['m1: interaction overrides exit:0 owned by c without naming it']);
  assert.deepEqual(M.composeExpected(base, ds, { migrations: ['a', 'b', 'c'], changed: [], exits: [7] }, 'm1').problems, []);
  assert.deepEqual(M.composeExpected(base, [dec('a', [2]), dec('c', [2])], null, 'm1').problems, [], 'the same value twice: owned by both, no conflict');
});

test('nothing landed: check runs none and default, both against the baseline', async () => {
  const off = [{ id: 'demo', item: 1, landed: false }];
  const { results } = await checkMigrations({ implDir, casesDir: CASES, registryDir: registry(), migrations: off });
  assert.deepEqual([...new Set(results.map((r) => r.mode))], ['none', 'default']);
  assert.deepEqual(results.flatMap((r) => r.problems), []);
});

test('the removed b2 surface stays removed', () => {
  for (const k of ['writeB2', 'b2Problems']) assert.equal(M[k], undefined, k);
});

// Final review F2: a landed migration declares each of its before-cases, or waives it with a reason.
test('F2: a landed migration must declare its beforeCases unless waived', () => {
  const p = (spec, migrations = DEMO) => registryProblems(loadRegistry(multiRegistry(spec)).entries, migrations, CASES);
  const declared = { m1: { reason: REASON, changed: ['out/a.txt'] } };
  const after = { 'm1/out/a.txt': 'x\n' };
  const casesDir = tempCases();
  cpSync(join(casesDir, 'm1'), join(casesDir, 'm2'), { recursive: true });
  const q = (spec, migrations = DEMO) => registryProblems(loadRegistry(multiRegistry(spec)).entries, migrations, casesDir);
  assert.ok(q({ demo: { item: 1, beforeCases: ['m1', 'm2'], declared, after } }).includes('demo: before-case m2 not declared'));
  assert.ok(!q({ demo: { item: 1, beforeCases: ['m1', 'm2'], declared, after, extra: { beforeCasesWaived: { m2: 'm2 pins a path this migration leaves alone on purpose' } } } })
    .some((s) => s.includes('before-case')));
  assert.ok(q({ demo: { item: 1, beforeCases: ['m1', 'm2'], declared, after, extra: { beforeCasesWaived: { m2: 'too short' } } } })
    .includes('demo: beforeCasesWaived m2 reason must be at least 40 characters'));
  assert.ok(q({ demo: { item: 1, beforeCases: ['m1'], declared, after, extra: { beforeCasesWaived: { m3: 'm3 is not even a before-case of this migration at all' } } } })
    .includes('demo: beforeCasesWaived names m3, which is not a before-case'));
  assert.deepEqual(q({ demo: { item: 1, beforeCases: ['m1', 'm2'], declared: {} } }, [{ id: 'demo', item: 1, landed: false }]), [], 'unlanded: unaffected');
  assert.deepEqual(p({ demo: { item: 1, declared, after } }), []);
});

// Codex B2-01…03 (review §1.A), against the real checkMigrations and runCase: three adversarial fixtures that
// certified undeclared output in every mode. Each case's baseline golden is what the pre-fix runner observed for
// the benign implementation (written here by hand: a fixed runner refuses to observe it). The registry declares
// only out/a.txt; the implementation under test adds an undeclared difference the old observation aliased away.
// Each attack must fail in none, only:demo, default and all.
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const CHECKER_ATTACKS = {
  // B2-02: a real selected output __events__/0.stdout was replaced by event 0's captured stream in the merge.
  namespace: {
    outputs: ['out', '__events__'],
    extra: "mkdirSync('__events__', { recursive: true }); writeFileSync('__events__/0.stdout', 'UNDECLARED'); console.log('stream');",
    baseline: [['__events__/0.stdout', 'stream\n']],
    problem: /replay: [\s\S]*outputs\[1\]: "__events__" is reserved for the replay's own observations/,
  },
  // B2-03: bytes 80 (baseline) and 81 (bad) both decoded to U+FFFD.
  binary: {
    outputs: ['out'],
    extra: "writeFileSync('out/raw.bin', Buffer.from([0x81]));",
    baseline: [['out/raw.bin', '�']],
    problem: /replay: [\s\S]*out\/raw\.bin is not valid UTF-8/,
  },
  // B2-01: a literal `<REPOKEY>` file and the real encoded repo-path file scrubbed to one Map key; the last won.
  'scrub-collision': {
    outputs: ['out'],
    extra: "writeFileSync(process.cwd().replace(/[^a-zA-Z0-9]/g, '-'), 'UNDECLARED'); writeFileSync('<REPOKEY>', 'APPROVED');",
    baseline: [['__sandbox__/changes.txt', `${JSON.stringify(['A', 'repo/<REPOKEY>', `f:${sha16('APPROVED')}`])}\n`]],
    problem: /replay: [\s\S]*(contains the scrub token <REPOKEY>|both record as)/,
  },
};
const CHECK_MODES = ['none', 'only:demo', 'default', 'all'];
/** A temp case m1 (outputs as given, baseline = out/a.txt `base` plus `baseline`), a `demo` registry declaring only
 * out/a.txt, and an implementation writing out/a.txt (`demo` unless TOKENOMICS_MIGRATIONS=none) plus `extra`. */
function checkerAttack(t, { outputs, extra, baseline }) {
  const d = mkdtempSync(join(tmpdir(), 'ht-b2-attack-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const put = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, v); };
  const casesDir = join(d, 'cases');
  const manifest = JSON.parse(readFileSync(join(CASES, 'm1', 'replay.json'), 'utf8'));
  put(join(casesDir, 'm1', 'replay.json'), JSON.stringify({ ...manifest, outputs }));
  for (const [k, v] of [['out/a.txt', 'base\n'], ...baseline]) put(join(casesDir, 'm1', 'expected', '49577c7', k), v);
  const registryDir = registry({ declared: { m1: { reason: 'The declared migration changes only the ordinary output a.txt.', changed: ['out/a.txt'] } }, after: { 'm1/out/a.txt': 'demo\n' } });
  t.after(() => rmSync(registryDir, { recursive: true, force: true }));
  const impl = join(d, 'impl');
  put(join(impl, 'scripts', 'w.mjs'), [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "const on = process.env.TOKENOMICS_MIGRATIONS !== 'none';",
    "mkdirSync('out', { recursive: true }); writeFileSync('out/a.txt', on ? 'demo\\n' : 'base\\n');",
    extra, '',
  ].join('\n'));
  return { implDir: impl, casesDir, registryDir, migrations: DEMO };
}
for (const [name, attack] of Object.entries(CHECKER_ATTACKS)) {
  test(`Codex B2-0${{ 'scrub-collision': 1, namespace: 2, binary: 3 }[name]} (§1.A ${name}): the full checker fails every mode`, async (t) => {
    const { results } = await checkMigrations(checkerAttack(t, attack));
    assert.deepEqual(byMode(results, 'registry'), []);
    assert.deepEqual([...new Set(results.map((r) => r.mode))], CHECK_MODES);
    for (const mode of CHECK_MODES) {
      const problems = byMode(results, mode);
      assert.ok(problems.length > 0, `${mode}: certified undeclared output`);
      assert.ok(problems.some((p) => attack.problem.test(p)), `${mode}: ${JSON.stringify(problems)}`);
    }
  });
}

// B2-03, the stored side: a stored golden that is not valid UTF-8 (byte 80) aliased a run writing U+FFFD.
test('Codex B2-03: a stored golden that is not valid UTF-8 is a problem in every mode, never lossily decoded', async (t) => {
  const opts = checkerAttack(t, { outputs: ['out'], extra: "writeFileSync('out/raw.bin', '\\uFFFD');", baseline: [['out/raw.bin', Buffer.from([0x80])]] });
  const { results } = await checkMigrations(opts);
  for (const mode of CHECK_MODES) {
    assert.ok(byMode(results, mode).some((p) => /out\/raw\.bin is not valid UTF-8/.test(p)), `${mode}: ${JSON.stringify(byMode(results, mode))}`);
  }
});

// B2-03, the declared side: an after-file that is not valid UTF-8 is never compared as replacement characters.
test('Codex B2-03: a declared after-file that is not valid UTF-8 is a problem, not U+FFFD', async (t) => {
  const opts = checkerAttack(t, { outputs: ['out'], extra: "writeFileSync('out/raw.bin', on ? '\\uFFFD' : 'b');", baseline: [['out/raw.bin', 'b']] });
  const registryDir = registry({ declared: { m1: { reason: 'The declared migration changes the ordinary output and raw.bin.', changed: ['out/a.txt', 'out/raw.bin'] } }, after: { 'm1/out/a.txt': 'demo\n', 'm1/out/raw.bin': Buffer.from([0x80]) } });
  t.after(() => rmSync(registryDir, { recursive: true, force: true }));
  const { results } = await checkMigrations({ ...opts, registryDir });
  for (const mode of ['only:demo', 'default', 'all']) {
    assert.ok(byMode(results, mode).some((p) => /raw\.bin is not valid UTF-8/.test(p)), `${mode}: ${JSON.stringify(byMode(results, mode))}`);
  }
  assert.deepEqual(byMode(results, 'none'), []);
});

// The negative controls of §1.A stay detected (an ordinary extra or differing output).
test('Codex §1.A controls: an ordinary undeclared extra file and a differing valid byte fail every mode', async (t) => {
  for (const [extra, baseline, want] of [
    ["writeFileSync('out/raw.bin', Buffer.from([0x41]));", [['out/raw.bin', 'B']], 'differs out/raw.bin'],
    ["mkdirSync('o2', { recursive: true }); writeFileSync('NON_COLLIDING', 'UNDECLARED');", [], 'differs __sandbox__/changes.txt'],
  ]) {
    const { results } = await checkMigrations(checkerAttack(t, { outputs: ['out'], extra, baseline: [...baseline, ...(want.includes('changes') ? [['__sandbox__/changes.txt', `${JSON.stringify(['A', 'repo/OTHER', `f:${sha16('x')}`])}\n`]] : [])] }));
    for (const mode of CHECK_MODES) assert.ok(byMode(results, mode).includes(want), `${mode}: ${JSON.stringify(byMode(results, mode))}`);
  }
});
