import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, assertNoSentinels, SENTINEL, fakeCli, readArgv } from './harness.mjs';
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
