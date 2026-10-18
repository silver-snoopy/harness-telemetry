import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HIDDEN_CLIS, buildToolsDir, sandboxEnv, startServer, assertNoSentinels, SENTINEL, fakeCli, readArgv } from './harness.mjs';
import { spawnSync } from 'node:child_process';

const tmp = mkdtempSync(join(tmpdir(), 'ht-harness-'));
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));

const post = (url, path, body) => new Promise((res, rej) => {
  const req = request(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => {
    let s = '';
    r.on('data', (c) => { s += c; });
    r.on('end', () => res({ status: r.statusCode, json: JSON.parse(s) }));
  });
  req.on('error', rej);
  req.end(body);
});

test('startServer runs the routes in a child process, logs requests, and stops', async () => {
  const routes = join(tmp, 'routes.mjs');
  writeFileSync(routes, "export default (req, body) => ({ status: 201, json: { path: req.url, pid: process.pid, got: JSON.parse(body) } });\n");
  const srv = await startServer(routes, { dir: tmp });
  try {
    assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const r = await post(srv.url, '/x?y=1', '{"a":1}');
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.got, { a: 1 });
    assert.notEqual(r.json.pid, process.pid, 'served by a child process');
    const log = srv.log();
    assert.equal(log.length, 1);
    assert.equal(log[0].method, 'POST');
    assert.equal(log[0].path, '/x?y=1');
    assert.equal(log[0].body, '{"a":1}');
    assert.equal(log[0].headers['content-type'], 'application/json');
  } finally {
    await srv.stop();
  }
  await assert.rejects(post(srv.url, '/', '{}'));
});

test('startServer rejects cleanly on a bad first stdout line and on an early child exit', async () => {
  const noisy = join(tmp, 'noisy.mjs');
  writeFileSync(noisy, "process.stdout.write('not json\\n');\nexport default () => ({ status: 200, json: {} });\n");
  await assert.rejects(startServer(noisy, { dir: tmp }), /server: bad ready line/);
  const broken = join(tmp, 'broken.mjs');
  writeFileSync(broken, "throw new Error('boom');\n");
  await assert.rejects(startServer(broken, { dir: tmp }), /server exited before ready/);
});

test('assertNoSentinels finds raw and base64 credential forms and private markers', () => {
  assert.doesNotThrow(() => assertNoSentinels(['clean', { a: 1 }]));
  assert.throws(() => assertNoSentinels(['ok', `x ${SENTINEL.PAT} y`]), /input 1/);
  assert.throws(() => assertNoSentinels([Buffer.from(`:${SENTINEL.PAT}`).toString('base64')]), /sentinel/);
  assert.throws(() => assertNoSentinels([Buffer.from(`${SENTINEL.EMAIL}:${SENTINEL.TOKEN}`).toString('base64')]), /sentinel/);
  assert.throws(() => assertNoSentinels([['argv', 'PRIVATE_BRANCH']]), /PRIVATE_BRANCH/);
});

test('fakeCli records argv and answers', () => {
  const bin = join(tmp, 'bin');
  const log = join(tmp, 'argv.jsonl');
  fakeCli(bin, 'tool', { stdout: '(argv) => argv.join("+")', argvLog: log, code: 3 });
  const r = spawnSync(join(bin, 'tool'), ['a', 'b'], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'a+b');
  assert.deepEqual(readArgv(log), [['a', 'b']]);
});

test('buildToolsDir: git is linked, gh/az/claude/copilot never are; sandboxEnv PATH has no dir holding gh', () => {
  const fakeSys = join(tmp, 'fake-sys');
  const fakeBinDir = join(tmp, 'fake-bin');
  mkdirSync(fakeSys, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });
  for (const n of ['git', 'sh', ...HIDDEN_CLIS]) writeFileSync(join(fakeSys, n), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(fakeBinDir, 'git'), 'dup\n'); // a duplicate name in a later source is skipped, not an EEXIST
  writeFileSync(join(fakeBinDir, 'ls'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const parent = join(tmp, 'tools-parent');
  const dir = buildToolsDir(parent, { sources: [fakeSys, join(tmp, 'no-such-dir'), fakeBinDir] });
  assert.equal(dir, join(parent, 'tools'));
  const names = readdirSync(dir).sort();
  assert.deepEqual(names, ['git', 'ls', 'node', 'sh']);
  assert.equal(realpathSync(join(dir, 'node')), realpathSync(process.execPath));
  assert.equal(realpathSync(join(dir, 'git')), realpathSync(join(fakeSys, 'git')));
  for (const n of HIDDEN_CLIS) assert.ok(!existsSync(join(dir, n)), `${n} hidden`);
  assert.equal(buildToolsDir(parent, { sources: [fakeSys, join(tmp, 'no-such-dir'), fakeBinDir] }), dir, 'built once, reusable');

  const t = join(tmp, 'env');
  const env = sandboxEnv(t, { bin: join(t, 'bin') });
  const entries = env.PATH.split(':');
  assert.equal(entries[0], join(t, 'bin'));
  for (const d of entries) for (const n of HIDDEN_CLIS) assert.ok(!existsSync(join(d, n)), `${n} found in ${d}`);
  assert.ok(existsSync(join(entries[1], 'node')));
  assert.equal(spawnSync('git', ['--version'], { env, encoding: 'utf8' }).status, 0, 'git resolves');
  assert.deepEqual(sandboxEnv(t), { ...env, PATH: entries[1] }, 'no bin: tools dir only');
});
