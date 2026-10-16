import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCase } from '../../replay/runner.mjs';
import { expectedExits } from '../../replay/exits.mjs';
import { refDir } from '../../scripts/vendor-reference.mjs';

const CASES = fileURLToPath(new URL('./', import.meta.url));
const ptr = (o, p) => p.split('/').slice(1).reduce((a, k) => (a == null ? a : a[k]), o);
// A fact is `{path, equals}`, or `{path, absent: true}` when the key must not exist.
const check = (c, obj, f, label) => {
  if (f.absent) assert.equal(ptr(obj, f.path), undefined, `${c} ${label}${f.path} should be absent`);
  else assert.deepEqual(ptr(obj, f.path), f.equals, `${c} ${label}${f.path}`);
};

// Golden byte-comparison for every case lives in corpus/goldens.test.mjs; this file asserts the facts.
for (const c of readdirSync(CASES).filter((d) => existsSync(join(CASES, d, 'assert.json')))
  .filter((d) => JSON.parse(readFileSync(join(CASES, d, 'replay.json'), 'utf8')).implOnly !== 'engine')) { // engine-only: not a reference case
  test(`${c}`, async () => {
    const a = JSON.parse(readFileSync(join(CASES, c, 'assert.json'), 'utf8'));
    const r = await runCase(join(CASES, c), refDir('49577c7'));
    assert.deepEqual(r.exits, expectedExits(join(CASES, c), JSON.parse(readFileSync(join(CASES, c, 'replay.json'), 'utf8'))), `${c} exits`);
    const key = Object.keys(r.files).find((k) => /usage-.*\.jsonl$/.test(k));
    const lines = key ? r.files[key].trim().split('\n').map((l) => JSON.parse(l)) : [];
    if ('ledgerLines' in a) assert.equal(lines.length, a.ledgerLines);
    for (const f of a.facts ?? []) check(c, lines.at(-1), f, '');
    // fileFacts: pointer into a collected JSON file (e.g. a captured stdout or cost.json).
    for (const f of a.fileFacts ?? []) {
      assert.ok(f.file in r.files, `${c} missing collected file ${f.file}`);
      check(c, JSON.parse(r.files[f.file]), f, `${f.file} `);
    }
    // textFacts: the exact (`equals`) or partial (`includes`) text of a captured, non-JSON stdout.
    for (const f of a.textFacts ?? []) {
      assert.ok(f.file in r.files, `${c} missing collected file ${f.file}`);
      if ('equals' in f) assert.equal(r.files[f.file], f.equals, `${c} ${f.file}`);
      else assert.ok(r.files[f.file].includes(f.includes), `${c} ${f.file} should include ${JSON.stringify(f.includes)}`);
    }
  });
}
