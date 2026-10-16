import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { aggregate } from './aggregate.mjs';

const BIN = new URL('../../bin/harness-telemetry.mjs', import.meta.url).href;

const FX = fileURLToPath(new URL('../fixtures/aggregate/', import.meta.url));

for (const c of readdirSync(FX)) {
  test(`aggregate fixture ${c}`, () => {
    const dir = join(FX, c);
    const inputs = JSON.parse(readFileSync(join(dir, 'inputs.json'), 'utf8')).map((i) => ({ ...i, path: join(dir, i.path) }));
    const exp = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    const got = aggregate(inputs, exp.window ?? {});
    for (const k of ['verified', 'unverified', 'coverage', 'ownership', 'byHost', 'byUser', 'byRole', 'byIntent']) if (exp[k]) assert.deepEqual(got[k], exp[k], `${c}.${k}`);
  });
}

test('mode is required per input', () => {
  assert.throws(() => aggregate([{ path: FX }]), /mode/);
});

test('a v:2 reference line never reaches verified cost (spec §7.3)', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-agg-v2-'));
  mkdirSync(join(d, 'automation'));
  writeFileSync(join(d, 'automation/usage-x.jsonl'), '{"v":2,"host":"claude","id":"a","costUsd":1.25,"costSource":"ccusage-metered","tokens":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0}}\n{"v":1,"host":"claude","id":"b","costUsd":2,"costSource":"ccusage-metered","tokens":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0}}\n');
  const r = aggregate([{ mode: 'reference', path: d }]);
  assert.equal(r.verified.costUsd, 2);
  assert.equal(r.verified.sessions, 1);
  assert.equal(r.unverified.costUsd, 1.25);
  assert.equal(r.unverified.sessions, 1);
});

test('reference §7.4 limitations taint tokens only, never cost', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-agg-lim-'));
  mkdirSync(join(d, 'automation'));
  writeFileSync(join(d, 'automation/usage-x.jsonl'), '{"v":1,"host":"claude","id":"z","costUsd":0.5,"costSource":"ccusage-metered","foldedFromLive":1,"tokens":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}\n');
  const r = aggregate([{ mode: 'reference', path: d }]);
  assert.equal(r.verified.costUsd, 0.5);
  assert.equal(r.verified.sessions, 1);
});

// The CLI runs in a child: stubbing this process's stdout would swallow Node 18's per-file test report.
const cli = async (args) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { main } = await import(${JSON.stringify(BIN)}); process.exitCode = await main(process.argv.slice(1));`,
    '--', 'aggregate', ...args], { encoding: 'utf8' });
  return { code: r.status, err: r.stderr, out: r.stdout };
};
const WIN = join(FX, 'window/a');

test('aggregate: an unparseable --since/--until throws; CLI exits 2', async () => {
  assert.throws(() => aggregate([{ mode: 'port', path: WIN }], { since: 'yesterday-ish' }), /--since/);
  assert.throws(() => aggregate([{ mode: 'port', path: WIN }], { until: '2026-13-45' }), /--until/);
  const r = await cli(['--input', `port:${WIN}`, '--until', 'not-a-date']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--until "not-a-date" is not a parseable date/);
});

test('aggregate: zero --input exits 2', async () => {
  assert.throws(() => aggregate([]), /at least one --input/);
  const r = await cli(['--since', '2026-10-01T00:00:00Z']);
  assert.equal(r.code, 2);
  assert.match(r.err, /at least one --input/);
});

test('aggregate: the same path twice with different modes exits 2; same mode twice is read once', async () => {
  const r = await cli(['--input', `port:${WIN}`, '--input', `reference:${WIN}`]);
  assert.equal(r.code, 2);
  assert.match(r.err, /given twice with different modes/);
  const once = aggregate([{ mode: 'port', path: WIN }]);
  const twice = await cli(['--input', `port:${WIN}`, '--input', `port:${WIN}/.`]);
  assert.equal(twice.code, 0);
  assert.deepEqual(JSON.parse(twice.out).verified, once.verified);
});
