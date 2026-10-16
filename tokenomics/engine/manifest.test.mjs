// Tests for the manifest reader (map D1 reading rule, obligation O4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestFor, currentManifest, stampRevision } from './manifest.mjs';
import { IMPLIED_MANIFEST } from '../kit/load.mjs';

const TA_OUTCOMES = ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red'];
const doc = (rev, intents, over = {}) => ({ module: 'tokenomics', schema_version: '1.0', domain: 'd', manifestRevision: rev,
  receipts: { source: 'files', deliveredOutcomes: ['done'] }, ratioIntents: intents, ...over });
/** A telemetry dir with `module.json` (when `current`) and the given archives. */
function tdir({ current = null, archives = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ht-manifest-'));
  if (current) writeFileSync(join(dir, 'module.json'), JSON.stringify(current));
  if (Object.keys(archives).length) mkdirSync(join(dir, 'manifests'));
  for (const [n, m] of Object.entries(archives)) writeFileSync(join(dir, 'manifests', `${n}.json`), typeof m === 'string' ? m : JSON.stringify(m));
  return dir;
}

test('manifestFor: a revisionless record binds to the implied legacy manifest, never the current module.json or manifests/1.json', () => {
  const dir = tdir({ current: doc(1, ['story']), archives: { 1: doc(1, ['story']) } });
  for (const rec of [{}, { manifestRevision: undefined }]) {
    const b = manifestFor(dir, rec);
    assert.equal(b.verified, true);
    assert.equal(b.revision, IMPLIED_MANIFEST.manifestRevision);
    assert.deepEqual(b.ratioIntents, ['automation']);
    assert.deepEqual(b.deliveredOutcomes, TA_OUTCOMES);
    assert.equal(b.receiptPolicy.source, 'files');
    assert.equal(b.receiptPolicy.referenceEra, true, 'a reference-era files receipt may use its mtime as revision (Q10c)');
    assert.equal(b.finding, undefined);
  }
});

test('manifestFor: manifestRevision N → manifests/N.json, not the current module.json', () => {
  const dir = tdir({ current: doc(3, ['spike']), archives: { 1: doc(1, ['automation']), 2: doc(2, ['story']) } });
  const b = manifestFor(dir, { manifestRevision: 2 });
  assert.deepEqual({ revision: b.revision, ratioIntents: b.ratioIntents, deliveredOutcomes: b.deliveredOutcomes, verified: b.verified },
    { revision: 2, ratioIntents: ['story'], deliveredOutcomes: ['done'], verified: true });
  assert.equal(b.receiptPolicy.referenceEra, false, 'a revisioned record never uses mtime');
  assert.deepEqual(manifestFor(dir, { manifestRevision: 1 }).ratioIntents, ['automation']);
});

test('manifestFor: N = 1 with neither module.json nor manifests/ is the implied manifest', () => {
  const b = manifestFor(tdir(), { manifestRevision: 1 });
  assert.equal(b.verified, true);
  assert.deepEqual(b.ratioIntents, ['automation']);
  assert.equal(b.receiptPolicy.referenceEra, false, 'a stamped record is not reference-era: its mtime never serves');
});

test('manifestFor: a missing archive is unverified with the finding, even when module.json declares that revision', () => {
  const dir = tdir({ current: doc(4, ['automation']), archives: { 1: doc(1, ['automation']) } });
  const b = manifestFor(dir, { manifestRevision: 4 });
  assert.equal(b.verified, false);
  assert.equal(b.finding, 'manifest-archive-missing: revision 4');
  assert.deepEqual(b.ratioIntents, [], 'never reinterpreted under another revision');
  assert.deepEqual(b.deliveredOutcomes, []);
  // module.json present but no archive for revision 1 (Q11b strict rule): unverified too
  assert.equal(manifestFor(tdir({ current: doc(1, ['automation']) }), { manifestRevision: 1 }).verified, false);
  // an unreadable archive, a non-integer revision and no telemetry dir are unverified the same way
  assert.equal(manifestFor(tdir({ archives: { 2: '{nope' } }), { manifestRevision: 2 }).finding, 'manifest-archive-missing: revision 2');
  assert.equal(manifestFor(dir, { manifestRevision: '1' }).verified, false);
  assert.equal(manifestFor(null, { manifestRevision: 2 }).verified, false);
});

test('currentManifest: module.json, else the implied manifest at revision 1', () => {
  assert.deepEqual(currentManifest(tdir({ current: doc(3, ['spike']) })), { revision: 3, ...doc(3, ['spike']) });
  assert.deepEqual(currentManifest(tdir()), { revision: 1, ...IMPLIED_MANIFEST });
  assert.deepEqual(currentManifest(null), { revision: 1, ...IMPLIED_MANIFEST });
});

// writer review round 1 (I1): only a writer line can carry an explicit null revision (its module.json was present but
// unusable); it is fresh, so it is never bound to the implied legacy manifest (Q11b).
test('manifestFor: an explicit manifestRevision null is unverified (manifest-revision-unknown); an absent key stays the implied manifest', () => {
  const dir = tdir({ current: doc(1, ['story']), archives: { 1: doc(1, ['story']) } });
  const b = manifestFor(dir, { writer: 'tokenomics-engine@1.2.0', manifestRevision: null });
  assert.equal(b.verified, false);
  assert.equal(b.finding, 'manifest-revision-unknown');
  assert.deepEqual([b.ratioIntents, b.deliveredOutcomes, b.receiptPolicy], [[], [], null]);
  assert.equal(manifestFor(dir, {}).verified, true, 'absent: revisionless, the implied legacy manifest');
  assert.equal(manifestFor(null, { manifestRevision: null }).finding, 'manifest-revision-unknown');
});

test('stampRevision: module.json absent → 1 (implied); present with an integer ≥ 1 → it; present but unusable → null', () => {
  assert.equal(stampRevision(tdir()), 1);
  assert.equal(stampRevision(null), 1);
  assert.equal(stampRevision(tdir({ current: doc(3, ['spike']) })), 3);
  const { manifestRevision: _m, ...noRev } = doc(3, ['feature']);
  assert.equal(stampRevision(tdir({ current: noRev })), null, 'no manifestRevision');
  for (const bad of [0, '3', 2.5, null]) assert.equal(stampRevision(tdir({ current: doc(bad, ['x']) })), null, `revision ${JSON.stringify(bad)}`);
  const broken = tdir({ archives: { 1: doc(1, ['old']), 3: doc(3, ['new']) } });
  writeFileSync(join(broken, 'module.json'), '{"module":"tokenomics",,"manifestRevision":3}');
  assert.equal(stampRevision(broken), null, 'unparseable');
  writeFileSync(join(broken, 'module.json'), '[3]');
  assert.equal(stampRevision(broken), null, 'not an object');
});
