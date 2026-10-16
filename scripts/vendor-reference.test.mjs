import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { refDir, SNAPSHOTS } from './vendor-reference.mjs';

test('every snapshot exists and matches its recorded hashes', () => {
  const prov = JSON.parse(readFileSync(new URL('../reference/PROVENANCE.json', import.meta.url)));
  for (const sha of SNAPSHOTS) {
    assert.ok(prov[sha], `provenance for ${sha}`);
    assert.ok(existsSync(join(refDir(sha), 'hooks', 'telemetry-capture.mjs')), `${sha} capture hook`);
    for (const [rel, h] of Object.entries(prov[sha].files)) {
      const got = createHash('sha256').update(readFileSync(join(refDir(sha), rel))).digest('hex');
      assert.equal(got, h, `${sha}/${rel}`);
    }
  }
});
