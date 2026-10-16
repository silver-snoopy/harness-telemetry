// module-manifest.mjs (Plan 5 Task 7, D-MAN): module.json + manifests/<N>.json written once on activation, validated
// against the kit schema, never rewritten; a mismatch with settings is reported and left for --update-manifest (N+1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureModuleManifest, manifestFromSettings, ModuleManifestError } from './module-manifest.mjs';
import { loadSchemas, validate } from '../kit/schema.mjs';
import { TA_DEFAULTS } from './config.mjs';

const tmp = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'tokenomics-modman-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const settings = (over = {}) => ({ ...TA_DEFAULTS, dir: 'tokenomics', ...over });
const schemas = loadSchemas();
const valid = (doc) => assert.deepEqual(validate(schemas['module.json'], doc, { schemas }), []);

test('manifestFromSettings: the D-MAN document, valid against the kit schema', () => {
  const doc = manifestFromSettings(settings(), 1);
  assert.deepEqual(doc, {
    module: 'tokenomics', schema_version: '1', domain: 'tokenomics', manifestRevision: 1,
    receipts: { source: 'files', root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red'] },
    ratioIntents: ['automation'],
  });
  valid(doc);
});

test('fresh: module.json and manifests/1.json written once, byte-identical, valid; a re-run writes nothing', (t) => {
  const dir = join(tmp(t), 'tokenomics');
  const r = ensureModuleManifest(dir, settings());
  assert.deepEqual(r, { revision: 1, written: true, mismatch: [] });
  const cur = readFileSync(join(dir, 'module.json'), 'utf8');
  assert.equal(readFileSync(join(dir, 'manifests', '1.json'), 'utf8'), cur);
  valid(JSON.parse(cur));
  const again = ensureModuleManifest(dir, settings());
  assert.deepEqual(again, { revision: 1, written: false, mismatch: [] });
  assert.deepEqual(readdirSync(join(dir, 'manifests')), ['1.json']);
});

test('a changed deliveredOutcomes is a mismatch, never rewritten; --update-manifest writes revision 2 and its archive', (t) => {
  const dir = join(tmp(t), 'tokenomics');
  ensureModuleManifest(dir, settings());
  const before = readFileSync(join(dir, 'module.json'), 'utf8');
  const changed = settings({ receipts: { ...TA_DEFAULTS.receipts, deliveredOutcomes: ['delivered'] } });
  const r = ensureModuleManifest(dir, changed);
  assert.deepEqual(r, { revision: 1, written: false, mismatch: ['receipts.deliveredOutcomes'] });
  assert.equal(readFileSync(join(dir, 'module.json'), 'utf8'), before, 'never rewritten');
  const u = ensureModuleManifest(dir, changed, { update: true });
  assert.deepEqual(u, { revision: 2, written: true, mismatch: ['receipts.deliveredOutcomes'] });
  assert.equal(read(join(dir, 'module.json')).manifestRevision, 2);
  assert.deepEqual(read(join(dir, 'module.json')).receipts.deliveredOutcomes, ['delivered']);
  assert.equal(readFileSync(join(dir, 'manifests', '2.json'), 'utf8'), readFileSync(join(dir, 'module.json'), 'utf8'));
  assert.equal(readFileSync(join(dir, 'manifests', '1.json'), 'utf8'), before, 'revision 1 archive retained');
  valid(read(join(dir, 'module.json')));
  assert.deepEqual(ensureModuleManifest(dir, changed, { update: true }), { revision: 2, written: false, mismatch: [] }, 'no mismatch: no new revision');
});

test('a module.json without its archive gets the archive (same document); the current file is not touched', (t) => {
  const dir = join(tmp(t), 'automation');
  mkdirSync(dir, { recursive: true });
  const doc = { ...manifestFromSettings(settings({ dir: 'automation' }), 3) };
  writeFileSync(join(dir, 'module.json'), JSON.stringify(doc));
  const r = ensureModuleManifest(dir, settings({ dir: 'automation' }));
  assert.deepEqual(r, { revision: 3, written: true, mismatch: [] });
  assert.equal(readFileSync(join(dir, 'manifests', '3.json'), 'utf8'), JSON.stringify(doc));
  assert.equal(readFileSync(join(dir, 'module.json'), 'utf8'), JSON.stringify(doc));
});

test('refusals: an invalid module.json, and archives without a current module.json', (t) => {
  const dir = join(tmp(t), 'tokenomics');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'module.json'), '{ not json');
  assert.throws(() => ensureModuleManifest(dir, settings()), (e) => e instanceof ModuleManifestError && e.code === 'manifest-unreadable');
  writeFileSync(join(dir, 'module.json'), JSON.stringify({ module: 'tokenomics', schema_version: '1', domain: 'x', manifestRevision: 0 }));
  assert.throws(() => ensureModuleManifest(dir, settings()), (e) => e.code === 'manifest-invalid' && /minimum/.test(e.message));
  rmSync(join(dir, 'module.json'));
  mkdirSync(join(dir, 'manifests'));
  writeFileSync(join(dir, 'manifests', '1.json'), '{}');
  assert.throws(() => ensureModuleManifest(dir, settings()), (e) => e.code === 'manifest-current-missing');
  assert.ok(!existsSync(join(dir, 'module.json')));
});
