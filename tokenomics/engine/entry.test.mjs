// B2 items 12 `entry-guard` and 13 `stdout-drain` (group `entry-points`; map R8, R17). Anything that touches
// process.stdout runs in a spawned child (stubbing it here would swallow Node 18's test report).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
import { isMain, exitAfterDrain, drained } from './entry.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PASS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'USERPROFILE', 'NODE_V8_COVERAGE'];
const baseEnv = () => Object.fromEntries(PASS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ht-entry-pts-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('isMain: true for the module itself, through a symlinked path, false otherwise and never throws', (t) => {
  const d = tmp(t);
  const real = join(d, 'mod.mjs');
  writeFileSync(real, 'export {};\n');
  const link = join(d, 'link.mjs');
  symlinkSync(real, link);
  const url = pathToFileURL(real).href;
  assert.equal(isMain(url, real), true);
  assert.equal(isMain(url, link), true, 'a symlinked argv[1] resolves to the same module');
  assert.equal(isMain(pathToFileURL(link).href, real), true, 'and the other way round');
  assert.equal(isMain(url, join(d, 'other.mjs')), false, 'a missing argv[1] path is not main');
  assert.equal(isMain(url, undefined), false);
  assert.equal(isMain(url, ''), false);
  assert.equal(isMain('not a url', real), false);
});

test('entry-guard: capture run through a symlinked path captures when entry-points is on, nothing when off', (t) => {
  const d = tmp(t);
  const link = join(d, 'telemetry-capture.mjs');
  symlinkSync(join(ROOT, 'hooks/telemetry-capture.mjs'), link);
  const run = (migrations) => spawnSync(process.execPath, [link], {
    input: '{}', encoding: 'utf8', timeout: 20000, cwd: d,
    env: { ...baseEnv(), TOKENOMICS_MIGRATIONS: migrations, CLAUDE_PROJECT_DIR: d },
  });
  const on = run('entry-points');
  const off = run('none');
  assert.equal(on.status, 0);
  assert.equal(off.status, 0);
  assert.match(on.stderr, /tokenomics: captured 0 session\(s\)/, 'main ran through the symlink');
  assert.equal(off.stderr, '', 'reference guard: the symlinked run does nothing');
});

test('stdout-drain: an unpreloaded child writing a large report to a pipe then exiting delivers every byte', async (t) => {
  const d = tmp(t);
  mkdirSync(join(d, '.agents/telemetry/automation'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: d });
  const base = { v: 1, host: 'claude', user: 'u', capturedAt: '2026-10-01T10:30:00.000Z', repo: 'repo', branch: 'b', role: null,
    models: ['m'], startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T10:01:00.000Z', wallMin: 1, activeMin: 1, turns: 1,
    toolCalls: 0, toolErrors: 0, tokens: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 },
    tokensByModel: { m: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 } }, costUsd: 0.0123, costSource: 'ccusage-metered', subagents: [], skills: [], dispatches: 0 };
  let ledger = '';
  for (let i = 0; i < 5000; i++) ledger += `${JSON.stringify({ ...base, id: `s${i}`, user: `user-${i}`, cases: [`PROJ-${i}`] })}\n`;
  writeFileSync(join(d, '.agents/telemetry/automation/usage-corpus.jsonl'), ledger);
  const script = join(ROOT, 'scripts/team-report.mjs');
  // no NODE_OPTIONS=--import=<preload>: the child's stdout is a real pipe
  const env = { ...baseEnv(), TOKENOMICS_MIGRATIONS: 'entry-points' };
  const file = join(d, 'out.json');
  const f = spawnSync(process.execPath, [script, d, '--json', '--out', file], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(f.status, 0, f.stderr);
  const expected = readFileSync(file).length;
  assert.ok(expected > 2 * 1024 * 1024, `fixture is large enough (${expected} bytes)`);
  const got = await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [script, d, '--json'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    let n = 0; let last = null;
    c.stdout.on('data', (b) => { n += b.length; last = b; });
    c.on('error', reject);
    c.on('close', (code) => resolve({ n, code, last }));
  });
  assert.equal(got.code, 0);
  // the report goes to stdout with one trailing newline; the file form writes the same text plus the same newline
  assert.equal(got.n, expected, 'every byte reached the reader');
});

test('exitAfterDrain: a child that fills a pipe then exits delivers everything (and exits with the code)', async (t) => {
  const d = tmp(t);
  copyFileSync(fileURLToPath(new URL('./entry.mjs', import.meta.url)), join(d, 'entry.mjs'));
  const child = join(d, 'child.mjs');
  writeFileSync(child, `import { exitAfterDrain } from './entry.mjs';\nprocess.stdout.write('x'.repeat(4 * 1024 * 1024));\nprocess.stderr.write('e'.repeat(100000));\nawait exitAfterDrain(3);\n`);
  const got = await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [child], { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = 0; let e = 0;
    c.stdout.on('data', (b) => { o += b.length; });
    c.stderr.on('data', (b) => { e += b.length; });
    c.on('error', reject);
    c.on('close', (code) => resolve({ o, e, code }));
  });
  assert.deepEqual(got, { o: 4 * 1024 * 1024, e: 100000, code: 3 });
  assert.equal(typeof exitAfterDrain, 'function');
});

test('drained: waits for a pending write below the high-water mark (writableNeedDrain stays false)', async () => {
  let release;
  const w = new Writable({ highWaterMark: 1024, write(chunk, enc, cb) { if (chunk.length) release = cb; else cb(); } });
  w.write('tiny');
  assert.equal(w.writableNeedDrain, false, 'below the mark: the old predicate would not wait');
  assert.ok(w.writableLength > 0);
  let done = false;
  const p = drained(w).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(done, false, 'still waiting while the write is pending');
  release();
  await p;
  assert.equal(done, true);
});

test('drained: resolves at once for an idle, destroyed or erroring stream, and at the cap for a stalled one', async () => {
  const idle = new Writable({ write(c, e, cb) { cb(); } });
  await drained(idle);
  const dead = new Writable({ write(c, e, cb) { cb(); } });
  dead.destroy();
  await drained(dead);
  const stalled = new Writable({ write() { /* never calls back */ } });
  stalled.write('x');
  const t0 = Date.now();
  await drained(stalled, 60);
  assert.ok(Date.now() - t0 < 2000);
  const failing = new Writable({ write(c, e, cb) { cb(new Error('boom')); } });
  failing.on('error', () => {});
  failing.write('x');
  await drained(failing, 60);
});

test('entry-guard: bin/harness-telemetry.mjs, otel-report and install-hooks run through a symlink (on), not off', (t) => {
  const d = tmp(t);
  for (const [rel, args, re] of [
    ['../bin/harness-telemetry.mjs', ['nope'], /usage: harness-telemetry/],
    ['scripts/otel-report.mjs', ['--dir', join(d, 'none')], /\S/],
    ['scripts/install-hooks.mjs', ['--help'], /\S/],
  ]) {
    const link = join(d, rel.split('/').pop());
    symlinkSync(join(ROOT, rel), link);
    const run = (m) => spawnSync(process.execPath, [link, ...args], { encoding: 'utf8', timeout: 20000, cwd: d, env: { ...baseEnv(), TOKENOMICS_MIGRATIONS: m } });
    const on = run('entry-points'); const off = run('none');
    assert.equal(off.stdout + off.stderr, '', `${rel}: reference guard does nothing through a symlink`);
    assert.match(on.stdout + on.stderr, re, `${rel}: main ran through the symlink`);
  }
});

// B3 park 188 (a): a stream whose write throws synchronously leaves no timer or listener behind.
test('B3-188a: drained on a stream whose write throws resolves and leaves nothing behind', async () => {
  const s = new Writable({ write(c, e, cb) { cb(); } });
  Object.defineProperty(s, 'writableLength', { get: () => 1 });
  s.write = () => { throw new Error('sync write failure'); };
  const before = { err: s.listenerCount('error'), close: s.listenerCount('close') };
  const timers = () => process.getActiveResourcesInfo().filter((n) => n === 'Timeout').length;
  const t0 = timers();
  await drained(s, 60000);
  assert.equal(s.listenerCount('error'), before.err, 'no error listener left');
  assert.equal(s.listenerCount('close'), before.close, 'no close listener left');
  assert.equal(timers(), t0, 'no cap timer left');
});

test('B3-188a: a child whose drained write throws exits promptly (no 10 s cap timer pins the loop)', (t) => {
  const d = tmp(t);
  const f = join(d, 'c.mjs');
  writeFileSync(f, [
    `import { drained } from ${JSON.stringify(pathToFileURL(join(ROOT, 'engine/entry.mjs')).href)};`,
    "import { Writable } from 'node:stream';",
    "const s = new Writable({ write(c, e, cb) { cb(); } });",
    "Object.defineProperty(s, 'writableLength', { get: () => 1 });",
    "s.write = () => { throw new Error('x'); };",
    "await drained(s);", '',
  ].join('\n'));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', timeout: 8000, env: baseEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - t0 < 5000, 'exited before the 10 s drain cap');
});

// B3 park 188 (b): the B2 item-12 guard, spawned for otel-sink itself through a symlink.
// Main ran when the sink writes sink.pid (it removes it on idle shutdown, so the test watches for it and kills the child).
test('B3-188b: a spawned otel-sink reached through a symlink runs its main (on); the reference guard does not (off)', async (t) => {
  const d = tmp(t);
  const link = join(d, 'sink-link.mjs');
  symlinkSync(join(ROOT, 'hooks/otel-sink.mjs'), link);
  const run = async (m, dir, waitMs) => {
    mkdirSync(dir);
    const c = spawn(process.execPath, [link, '--port', '0', '--dir', dir, '--idle-ms', '60000'], { env: { ...baseEnv(), TOKENOMICS_MIGRATIONS: m }, stdio: 'ignore' });
    const pid = join(dir, 'sink.pid');
    const until = Date.now() + waitMs;
    while (Date.now() < until && !existsSync(pid)) await new Promise((r) => setTimeout(r, 50));
    const ran = existsSync(pid);
    c.kill('SIGKILL');
    return ran;
  };
  assert.equal(await run('entry-points', join(d, 'on'), 8000), true, 'main ran through the symlink: the sink wrote its pid file');
  assert.equal(await run('none', join(d, 'off'), 1500), false, 'the reference guard skips main through a symlink');
});
