// Tests for otel-sink.mjs — in-process server on an ephemeral port, temp dir,
// injected exit so idle shutdown never kills the test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startSink } from './otel-sink.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenomics-sink-'));

// A sandbox may deny binding even 127.0.0.1 (EPERM): report a named skip instead of hanging (Codex P2 §5).
const listenDenied = await new Promise((res) => {
  const s = createServer();
  s.once('error', (e) => res(e.code ?? 'error'));
  s.listen(0, '127.0.0.1', () => s.close(() => res(null)));
});
const needsListen = listenDenied ? { skip: `local listen unavailable (${listenDenied})` } : {};

// startSink reports a failed listen through the injected exit: reject instead of waiting forever.
function ready(opts) {
  return new Promise((resolvePort, reject) => {
    let up = false;
    const server = startSink({
      ...opts,
      exit: (c) => { if (!up) reject(new Error(`sink exited ${c} before listening`)); else opts.exit?.(c); },
      onReady: (port) => { up = true; resolvePort({ server, port }); },
    });
  });
}

test('sink: accepts OTLP posts, appends one line per request, answers healthz', needsListen, async () => {
  const dir = tmp();
  let exited = null;
  const { server, port } = await ready({ port: 0, dir, idleMs: 60_000, exit: (c) => { exited = c; } });
  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const payload = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: [{ key: 'event.name', value: { stringValue: 'claude_code.api_request' } }] }] }] }] };
    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 200);
    const bad = await fetch(`http://127.0.0.1:${port}/v1/nope`, { method: 'POST', body: '{}' });
    assert.equal(bad.status, 404);

    const files = readdirSync(dir).filter((f) => f.startsWith('otel-'));
    assert.equal(files.length, 1);
    const lines = readFileSync(join(dir, files[0]), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].path, '/v1/logs');
    assert.deepEqual(lines[0].body, payload);
    assert.ok(existsSync(join(dir, 'sink.pid')), 'pid file written');
    assert.equal(exited, null, 'no premature exit');
  } finally {
    server.close();
  }
});

test('sink: unparseable body is preserved, not dropped', needsListen, async () => {
  const dir = tmp();
  const { server, port } = await ready({ port: 0, dir, idleMs: 60_000, exit: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { method: 'POST', body: 'not-json{{' });
    assert.equal(res.status, 200);
    const f = readdirSync(dir).find((x) => x.startsWith('otel-'));
    const line = JSON.parse(readFileSync(join(dir, f), 'utf8').trim());
    assert.equal(line.body.unparsed, 'not-json{{');
  } finally {
    server.close();
  }
});

test('sink: idle timeout closes the server via the injected exit', needsListen, async () => {
  const dir = tmp();
  let exited = null;
  const { server, port } = await ready({ port: 0, dir, idleMs: 150, exit: (c) => { exited = c; } });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(exited, 0, 'idle shutdown fired');
  // server already closing; a late close() must not throw
  try { server.close(); } catch { /* fine */ }
  assert.ok(!existsSync(join(dir, 'sink.pid')), 'pid file cleaned up');
  void port;
});

test('sink: port collision exits 0 (an existing sink is success)', needsListen, async () => {
  const dir = tmp();
  const { server, port } = await ready({ port: 0, dir, idleMs: 60_000, exit: () => {} });
  try {
    let exited = null;
    startSink({ port, dir: tmp(), idleMs: 60_000, exit: (c) => { exited = c; } });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(exited, 0);
  } finally {
    server.close();
  }
});
