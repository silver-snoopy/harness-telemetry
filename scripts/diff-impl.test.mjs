import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffImpl, ENGINE, goldenFiles, compareFiles } from './diff-impl.mjs';
import { refDir } from './vendor-reference.mjs';

const CASE = 'seed-claude-basic';
const CAPTURE = 'hooks/telemetry-capture.mjs';

/** Copy ENGINE to a tmp dir (removed after the test), optionally replacing `from` with `to` in CAPTURE. */
function engineCopy(t, from, to) {
  const d = mkdtempSync(join(tmpdir(), 'ht-mut-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  cpSync(ENGINE, d, { recursive: true });
  if (from !== undefined) {
    const f = join(d, CAPTURE);
    const src = readFileSync(f, 'utf8');
    assert.ok(src.includes(from), `mutation anchor not found: ${from}`);
    writeFileSync(f, src.replace(from, to));
  }
  return d;
}

test('the reference itself diffs clean on one case', async () => {
  const r = await diffImpl(refDir('49577c7'), { cases: [CASE] });
  assert.deepEqual(r, [{ case: CASE, problems: [] }]);
});

test('an unmodified copy of the engine in another directory diffs clean', async (t) => {
  const r = await diffImpl(engineCopy(t), { cases: [CASE] });
  assert.deepEqual(r, [{ case: CASE, problems: [] }]);
});

test('a mutated implementation is caught', async (t) => {
  const d = engineCopy(t, "'ccusage-metered'", "'ccusage-metered-x'");
  const r = await diffImpl(d, { cases: [CASE] });
  assert.ok(r[0].problems.some((p) => p.startsWith('differs ')), JSON.stringify(r));
});

test('a non-zero exit is reported', async (t) => {
  const d = engineCopy(t, 'process.exit(code); //', 'process.exit(3); //');
  const r = await diffImpl(d, { cases: [CASE] });
  assert.ok(r[0].problems.includes('exit 0=3'), JSON.stringify(r));
});

test('a file the implementation no longer writes is reported missing', async (t) => {
  const d = engineCopy(t, 'appendFileSync(ledgerPath(repo, slug, settings),', 'void (ledgerPath(repo, slug, settings),');
  const r = await diffImpl(d, { cases: [CASE] });
  assert.ok(r[0].problems.some((p) => p.startsWith('missing ')), JSON.stringify(r));
});

test('a file the reference does not write is reported extra', async (t) => {
  const d = engineCopy(t, 'process.exit(code); //',
    "mkdirSync('.agents/telemetry', { recursive: true }); writeFileSync('.agents/telemetry/zz-extra.txt', 'x'); process.exit(code); //");
  const r = await diffImpl(d, { cases: [CASE] });
  assert.ok(r[0].problems.some((p) => p.startsWith('extra ')), JSON.stringify(r));
});

test('a case without replay.json or golden is a problem, not a skip', async () => {
  const r = await diffImpl(ENGINE, { cases: ['no-such-case'] });
  assert.deepEqual(r, [{ case: 'no-such-case', problems: ['no replay.json'] }]);
});

// The capture hook fails open (exit 0) but names the error on stderr and writes no ledger.
test('the migrations option reaches every replay as TOKENOMICS_MIGRATIONS (an unknown id fails the engine)', async () => {
  const r = await diffImpl(ENGINE, { cases: [CASE], migrations: 'nope' });
  assert.ok(r[0].problems.includes('differs __events__/0.stderr'), JSON.stringify(r));
  assert.ok(r[0].problems.some((p) => p.startsWith('missing ')), JSON.stringify(r));
});

// Codex P3P-01: a golden file named after an Object.prototype member is an ordinary own key of the golden map,
// so the differential gate sees it missing, extra or different like any other path.
test('P3P-01: goldens named __proto__, constructor or toString load as own keys and compare exactly', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ht-proto-gold-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(join(d, 'out'));
  for (const [k, v] of [['__proto__', 'P'], ['constructor', 'C'], ['out/toString', 'T']]) writeFileSync(join(d, k), v);
  const g = goldenFiles(d);
  assert.equal(Object.getPrototypeOf(g), null);
  assert.deepEqual(Object.keys(g).sort(), ['__proto__', 'constructor', 'out/toString']);
  assert.equal(g['__proto__'], 'P');
  const got = Object.create(null); got.constructor = 'C'; got['out/toString'] = 'X'; got.toString = 'extra';
  assert.deepEqual(compareFiles(g, got), ['missing __proto__', 'extra toString', 'differs out/toString']);
});

// Codex B2-03: a stored golden is read under the replay byte policy; invalid UTF-8 is refused, not U+FFFD.
test('B2-03: goldenFiles refuses a golden that is not valid UTF-8 and keeps valid text exactly', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ht-utf8-gold-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(join(d, 'out'));
  writeFileSync(join(d, 'out/ok.txt'), '﻿ok�');
  assert.equal(goldenFiles(d)['out/ok.txt'], '﻿ok�');
  writeFileSync(join(d, 'out/raw.bin'), Buffer.from([0x80]));
  assert.throws(() => goldenFiles(d), /golden out\/raw\.bin is not valid UTF-8/);
});
