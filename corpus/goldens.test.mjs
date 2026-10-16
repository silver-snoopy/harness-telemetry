// Every corpus case is compared against its reference golden in both directions:
// the produced file set equals the golden file set, and every file is byte-equal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCase } from '../replay/runner.mjs';
import { expectedExits } from '../replay/exits.mjs';
import { refDir } from '../scripts/vendor-reference.mjs';

const CASES = fileURLToPath(new URL('./cases/', import.meta.url));
const IMPL = '49577c7';

export function goldenFiles(dir) {
  const out = [];
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const q = join(p, e.name);
      if (e.isDirectory()) walk(q); else out.push(relative(dir, q).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

const cases = readdirSync(CASES).filter((c) => existsSync(join(CASES, c, 'replay.json')))
  .filter((c) => JSON.parse(readFileSync(join(CASES, c, 'replay.json'), 'utf8')).implOnly !== 'engine').sort(); // engine-only: no reference golden

test('every case has a golden directory', () => {
  assert.ok(cases.length > 0);
  for (const c of cases) assert.ok(existsSync(join(CASES, c, 'expected', IMPL)), `${c}: no expected/${IMPL}`);
});

for (const c of cases) {
  test(`golden ${c}`, async () => {
    const m = JSON.parse(readFileSync(join(CASES, c, 'replay.json'), 'utf8'));
    const wantExits = expectedExits(join(CASES, c), m); // declared in assert.json `exits`, else all zeros
    const r = await runCase(join(CASES, c), refDir(IMPL));
    assert.deepEqual(r.exits, wantExits, `${c} exits`);
    const golden = join(CASES, c, 'expected', IMPL);
    assert.deepEqual(Object.keys(r.files).sort(), goldenFiles(golden), `${c}: produced vs golden file set`);
    for (const [k, v] of Object.entries(r.files)) assert.equal(v, readFileSync(join(golden, k), 'utf8'), `${c} golden ${k}`);
  });
}
