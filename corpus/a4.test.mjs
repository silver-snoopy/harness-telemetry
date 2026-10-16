import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../tokenomics/kit/check.mjs';

const CASES = fileURLToPath(new URL('./cases/', import.meta.url));

// Cases whose goldens carry no .agents/telemetry (stdout-only or nothing collected).
const NO_TELEMETRY = ['seed-receipts-waves', 'fault-scope-dir-blocked', 'cov-scope-hook-stdin-chunks', 'cov-team-report-rollup', 'cov-capture-identity', 'fault-capture-sweep', 'cov-export-compare', 'fault-export-usage',
  'before-entry-symlink']; // before-entry-symlink: the main guard skips main() through the symlink, nothing is written (map §3 R8)

test('A4: every reference golden reads with zero error in reference mode', () => {
  let checked = 0;
  for (const c of readdirSync(CASES)) {
    const t = join(CASES, c, 'expected/49577c7/.agents/telemetry');
    if (!existsSync(join(CASES, c, 'replay.json'))) continue;
    if (JSON.parse(readFileSync(join(CASES, c, 'replay.json'), 'utf8')).implOnly === 'engine') continue; // engine-only: no reference golden
    if (NO_TELEMETRY.includes(c)) {
      assert.ok(!existsSync(t), `${c} is listed as telemetry-less but has a telemetry golden`);
      continue;
    }
    assert.ok(existsSync(t), `${c}: no telemetry golden and not in NO_TELEMETRY`);
    const r = check(t, { mode: 'reference', profiles: ['core', 'scope'] });
    checked++;
    assert.equal(r.findings.filter((f) => f.class === 'error').length, 0, `${c}: ${JSON.stringify(r.findings.filter((f) => f.class === 'error'))}`);
  }
  for (const c of NO_TELEMETRY) assert.ok(existsSync(join(CASES, c, 'replay.json')), `${c} in NO_TELEMETRY is not a case`);
  assert.ok(checked > 0);
});
