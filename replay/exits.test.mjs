import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectedExits } from './exits.mjs';

test('expectedExits: declared exits win, otherwise one zero per event', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-exits-'));
  try {
    const m = { events: [{}, {}, {}] };
    assert.deepEqual(expectedExits(d, m), [0, 0, 0], 'no assert.json');
    writeFileSync(join(d, 'assert.json'), JSON.stringify({ ledgerLines: 0 }));
    assert.deepEqual(expectedExits(d, m), [0, 0, 0], 'assert.json without exits');
    writeFileSync(join(d, 'assert.json'), JSON.stringify({ exits: [0, 1, 0] }));
    assert.deepEqual(expectedExits(d, m), [0, 1, 0]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
