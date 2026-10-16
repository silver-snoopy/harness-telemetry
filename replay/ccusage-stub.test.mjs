import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pricingKey, encodeProjectPath } from './ccusage-stub.mjs';

const stub = fileURLToPath(new URL('./ccusage-stub.mjs', import.meta.url));

function stage(content) {
  const d = mkdtempSync(join(tmpdir(), 'ht-stage-'));
  mkdirSync(join(d, 'projects', 'f0'), { recursive: true });
  writeFileSync(join(d, 'projects', 'f0', 's1.jsonl'), content);
  return d;
}

test('key ignores the f<i> staging index but not content', () => {
  const a = stage('x'); const b = stage('x'); const c = stage('y');
  assert.equal(pricingKey(a), pricingKey(b));
  assert.notEqual(pricingKey(a), pricingKey(c));
});

test('replay serves a recorded response, fails loudly when missing', () => {
  const cfg = stage('x');
  const dir = mkdtempSync(join(tmpdir(), 'ht-pricing-'));
  const miss = spawnSync(process.execPath, [stub, 'claude', 'session', '--json', '--offline'], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, HT_PRICING_DIR: dir }, encoding: 'utf8' });
  assert.equal(miss.status, 3);
  assert.match(miss.stderr, /no recorded response/);
  writeFileSync(join(dir, `${pricingKey(cfg)}.json`), '{"sessions":[]}');
  const out = execFileSync(process.execPath, [stub, 'claude', 'session', '--json', '--offline'], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, HT_PRICING_DIR: dir }, encoding: 'utf8' });
  assert.equal(out, '{"sessions":[]}');
});

test('sandbox root is normalised out of the key (R1)', () => {
  const mk = (root) => {
    const d = mkdtempSync(join(tmpdir(), 'ht-stage-'));
    mkdirSync(join(d, 'projects', 'f0'), { recursive: true });
    writeFileSync(join(d, 'projects', 'f0', `${encodeProjectPath(root)}-repo.jsonl`), `{"cwd":"${root}/repo"}`);
    return d;
  };
  const a = mk('/tmp/ht-sandbox-AAA');
  const b = mk('/tmp/ht-sandbox-BBB');
  assert.equal(pricingKey(a, '/tmp/ht-sandbox-AAA'), pricingKey(b, '/tmp/ht-sandbox-BBB'));
  assert.notEqual(pricingKey(a, null), pricingKey(b, null));
});

test('record mode refuses without HT_REAL_NPX and never falls back to bare npx (R3)', () => {
  const cfg = stage('x');
  const dir = mkdtempSync(join(tmpdir(), 'ht-pricing-'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, HT_PRICING_DIR: dir, HT_PRICING_MODE: 'record' };
  delete env.HT_REAL_NPX;
  const r = spawnSync(process.execPath, [stub, 'claude', 'session', '--json', '--offline'], { env, encoding: 'utf8' });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /ccusage-stub: HT_REAL_NPX required in record mode/);
});
