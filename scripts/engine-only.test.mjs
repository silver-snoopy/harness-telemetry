import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineOnlyProblems, approvedEngineOnly } from './engine-only.mjs';

const R = 'a foreign configuration the reference cannot run: no reference golden can exist';
const mk = (cases) => {
  const d = mkdtempSync(join(tmpdir(), 'ht-eo-'));
  for (const [c, { implOnly, refGolden }] of Object.entries(cases)) {
    mkdirSync(join(d, c, 'expected', refGolden ? '49577c7' : 'engine'), { recursive: true });
    writeFileSync(join(d, c, 'replay.json'), JSON.stringify(implOnly ? { implOnly } : {}));
  }
  return d;
};

test('engineOnlyProblems: approved implOnly case passes', () => {
  assert.deepEqual(engineOnlyProblems(mk({ f: { implOnly: 'engine' }, r: {} }), { f: { reason: R } }), []);
});
test('engineOnlyProblems: unapproved, short reason, approved-but-reference, stray value, reference golden present', () => {
  const d = mk({ f: { implOnly: 'engine' }, g: { implOnly: 'engine', refGolden: true }, r: {}, s: { implOnly: 'x' } });
  const p = engineOnlyProblems(d, { g: { reason: R }, r: { reason: R }, z: { reason: 'short' } });
  assert.ok(p.includes('f: implOnly "engine" but not approved in corpus/engine-only.json'));
  assert.ok(p.includes('g: implOnly "engine" case must not carry expected/49577c7'));
  assert.ok(p.includes('r: approved in corpus/engine-only.json but replay.json has no implOnly "engine"'));
  assert.ok(p.includes('s: unknown implOnly "x"'));
  assert.ok(p.includes('z: approved in corpus/engine-only.json but no such case'));
  assert.ok(p.includes('z: reason must be at least 40 characters'));
});
test('the repo approval file is clean', () => {
  const cases = fileURLToPath(new URL('../corpus/cases', import.meta.url));
  const approvals = JSON.parse(readFileSync(new URL('../corpus/engine-only.json', import.meta.url), 'utf8'));
  assert.deepEqual(engineOnlyProblems(cases, approvals), []);
  assert.deepEqual(approvedEngineOnly(approvals), ['foreign-mixed-roots', 'foreign-null-extension', 'foreign-settings']);
});
