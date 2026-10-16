import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTestFiles, testArgs } from './test.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('findTestFiles excludes vendored reference snapshots and includes our own tests', () => {
  const files = findTestFiles(ROOT);
  assert.ok(files.length > 0);
  for (const f of files) assert.ok(!f.includes('/reference/'), `reference file leaked: ${f}`);
  assert.ok(files.includes(join(ROOT, 'scripts', 'vendor-reference.test.mjs')));
  assert.deepEqual(files, [...files].sort());
});

test('findTestFiles returns [] for a root with no test files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ht-empty-'));
  try {
    assert.deepEqual(findTestFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('testArgs builds node --test args for a non-empty list', () => {
  assert.deepEqual(testArgs(['/x/a.test.mjs']), ['--test', '/x/a.test.mjs']);
});

test('testArgs throws on an empty list so node --test never falls back to default discovery', () => {
  assert.throws(() => testArgs([]), /no \*\.test\.mjs files found/);
});
