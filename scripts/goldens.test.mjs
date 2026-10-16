import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGoldens } from './goldens.mjs';
import { refDir } from './vendor-reference.mjs';

// `work-scope open` with no session id exits 1 by design.
const caseWith = (assertJson) => {
  const d = mkdtempSync(join(tmpdir(), 'ht-goldens-'));
  writeFileSync(join(d, 'replay.json'), JSON.stringify({
    id: 'x', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' }, repo: { path: 'repo', branch: 'main', files: {} },
    stores: [], outputs: [], events: [{ at: '2026-10-01T09:00:00Z', run: 'scripts/work-scope.mjs', args: ['open'], stdin: null, env: {} }],
  }));
  if (assertJson) writeFileSync(join(d, 'assert.json'), JSON.stringify(assertJson));
  return d;
};

test('writeGoldens refuses a non-zero exit the case does not declare', async () => {
  const d = caseWith(null);
  try { await assert.rejects(writeGoldens(d, '49577c7', refDir('49577c7')), /exits 1, expected 0/); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('writeGoldens honours assert.json exits', async () => {
  const d = caseWith({ exits: [1] });
  try {
    assert.deepEqual(await writeGoldens(d, '49577c7', refDir('49577c7')), ['__events__/0.stderr'], 'resolves (no throw) and reports the collected files (the failing event\'s stderr is observed)');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('writeGoldens rejects a declared exit that does not match', async () => {
  const d = caseWith({ exits: [0] });
  try { await assert.rejects(writeGoldens(d, '49577c7', refDir('49577c7')), /exits 1, expected 0/); } finally { rmSync(d, { recursive: true, force: true }); }
});
