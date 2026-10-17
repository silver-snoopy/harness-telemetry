// Shared adapter helpers (Plan 7 Task 5). baseUrl and httpJson are unused by the GitHub adapter; Tasks 6 and 7 use them.
import { test } from 'node:test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSchemas } from '../kit/schema.mjs';
import { startServer } from '../fixtures/trackers/harness.mjs';
import { loadSettings } from '../engine/config.mjs';
import * as C from './common.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));

test('CREDENTIAL_ENV is the four D-ADAPTERS names', () => {
  assert.deepEqual([...C.CREDENTIAL_ENV], ['AZURE_DEVOPS_EXT_PAT', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PAT']);
});

test('parseArgs: --ids, --repo, --base-url, --max-pages; unknown flags and missing values are errors', () => {
  assert.deepEqual(C.parseArgs(['--ids', 'a,b', '--repo', '/r']), { ids: ['a', 'b'], repo: '/r', baseUrl: undefined, maxPages: 50 });
  assert.equal(C.parseArgs([]).repo, process.cwd());
  assert.equal(C.parseArgs([]).ids, undefined);
  const p = C.parseArgs(['--base-url', 'http://127.0.0.1:1', '--max-pages', '3']);
  assert.equal(p.baseUrl, 'http://127.0.0.1:1');
  assert.equal(p.maxPages, 3);
  assert.match(C.parseArgs(['--nope']).error, /--nope/);
  assert.match(C.parseArgs(['--ids']).error, /needs a value/);
  assert.match(C.parseArgs(['--max-pages', 'x']).error, /max-pages/);
});

test('selectIds strips the exact prefix, validates, dedupes and counts invalid', () => {
  const re = /^\d{1,9}$/;
  assert.deepEqual(C.selectIds(['gh:2', 'gh:1', 'gh:2', 'gh:x', 'gh:', 'jira:1', '3', 7], 'gh:', re), { ids: ['1', '2'], invalid: 5 });
});

test('idsFromLedger reads every prefixed id through team-report loadLines (cases and scope.cases)', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-cm-'));
  try {
    const L = (id, extra) => JSON.stringify({ v: 1, host: 'claude', id, endedAt: '2026-10-01T00:00:00Z', ...extra });
    writeFileSync(join(d, 'usage-a.jsonl'), [L('a', { cases: ['gh:3', 'jira:PAY-1', 'gh:zz'] }), L('b', { scope: { cases: ['gh:1'] } }), 'not json'].join('\n'));
    assert.deepEqual(C.idsFromLedger(d, loadSettings(d), 'gh:', /^\d{1,9}$/), { ids: ['1', '3'], invalid: 1 });
    assert.deepEqual(C.idsFromLedger(join(d, 'none'), loadSettings(d), 'gh:', /^\d+$/), { ids: [], invalid: 0 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('R14: idsFromLedger reads unprefixed historical ids through ids.rules; without rules they are not ours', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-cm-'));
  try {
    const L = (id, cases) => JSON.stringify({ v: 1, host: 'claude', id, endedAt: '2026-10-01T00:00:00Z', cases });
    writeFileSync(join(d, 'usage-a.jsonl'), [L('a', ['PAY-1', 'TC-2']), L('b', ['jira:PAY-1', 'jira:PAY-3'])].join('\n'));
    const base = loadSettings(d);
    const ruled = { ...base, ids: { ...base.ids, rules: [{ tracker: 'jira', pattern: '\\b(PAY)-(\\d+)\\b', normalize: 'jira:$1-$2' }] } };
    const re = /^[A-Z][A-Z0-9]+-[1-9]\d*$/;
    assert.deepEqual(C.idsFromLedger(d, ruled, 'jira:', re), { ids: ['PAY-1', 'PAY-3'], invalid: 0 });
    writeFileSync(join(d, 'usage-a.jsonl'), L('a', ['PAY-7']));
    assert.deepEqual(C.idsFromLedger(d, ruled, 'jira:', re), { ids: ['PAY-7'], invalid: 0 });
    assert.deepEqual(C.idsFromLedger(d, base, 'jira:', re), { ids: [], invalid: 0 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('envelope: the §5.6 shape, schema-valid; no cases means no receipts', () => {
  const schemas = loadSchemas();
  const e = C.envelope('gh:o/r', 'github', [{ id: 'gh:1', outcome: 'open' }], false);
  assert.deepEqual(e, { schema: 1, complete: false, receipts: [{ group: 'gh:o/r', source: 'github', cases: [{ id: 'gh:1', outcome: 'open' }] }] });
  assert.deepEqual(validate(schemas['receipts-envelope.json'], e, { schemas }), []);
  assert.deepEqual(C.envelope('g', 's', [], true), { schema: 1, complete: true, receipts: [] });
});

test('projectCase: an explicit projection; nothing else survives', () => {
  const c = C.projectCase({
    id: 'gh:1', outcome: 'delivered', at: '2026-03-01T00:00:00Z', atSource: 'closedAt', type: 'bug', points: 3, sprint: 'S1',
    title: 'PRIVATE_TITLE', author: { login: 'PRIVATE_PERSON' }, url: 'https://x', body: 'b',
  });
  assert.deepEqual(c, { id: 'gh:1', outcome: 'delivered', at: '2026-03-01T00:00:00Z', atSource: 'closedAt', type: 'bug', points: 3, sprint: 'S1' });
  assert.deepEqual(C.projectCase({ id: 'x', outcome: 'open', type: { name: 'o' }, sprint: ['a'], points: NaN, at: 5 }), { id: 'x', outcome: 'open' });
  assert.equal(C.projectCase({ id: 'x', outcome: 'open', type: 't'.repeat(100) }).type.length, 64);
  assert.equal(C.projectCase({ id: 'x', outcome: 'open', points: Infinity }).points, undefined);
  assert.equal(C.projectCase({ id: 'x', outcome: 'open', points: 0 }).points, 0);
});

test('batches splits in order; the last is the remainder', () => {
  assert.deepEqual(C.batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(C.batches([], 2), []);
});

test('fail throws an AdapterFailure; reportFailure writes exactly one clean line and returns the exit code', () => {
  let err;
  try { C.fail('github', 'http', 500); } catch (e) { err = e; }
  assert.ok(err instanceof C.AdapterFailure);
  assert.deepEqual([err.cls, err.code], ['http', 500]);
  const lines = [];
  assert.equal(C.reportFailure('github', err, (s) => lines.push(s)), 1);
  assert.deepEqual(lines, ['github: http (500)\n']);
  // an unexpected error never leaks its message
  const l2 = [];
  assert.equal(C.reportFailure('github', new Error('token=SECRET https://x?q=1'), (s) => l2.push(s)), 1);
  assert.deepEqual(l2, ['github: internal (error)\n']);
  // a config failure exits 2
  const l3 = [];
  assert.equal(C.reportFailure('jira', new C.AdapterFailure('config', 'base-url', 2), (s) => l3.push(s)), 2);
});

test('baseUrl: https only; http only for loopback; credentials and junk refused', () => {
  assert.equal(C.baseUrl('https://x.example/org/'), 'https://x.example/org');
  assert.equal(C.baseUrl('https://x.example', 'http://127.0.0.1:9'), 'http://127.0.0.1:9');
  assert.equal(C.baseUrl('http://localhost:8080/a'), 'http://localhost:8080/a');
  assert.equal(C.baseUrl(undefined, 'http://[::1]:5'), 'http://[::1]:5');
  for (const bad of ['http://example.com', 'http://127.0.0.1.evil.io', 'ftp://x', 'nope', 'https://u:p@x.example', undefined]) {
    assert.throws(() => C.baseUrl(bad), (e) => e instanceof C.AdapterFailure && e.cls === 'config' && e.exit === 2, String(bad));
  }
});

test('httpJson: JSON on 200; a 500 is {cls:http, code:500} without the body; timeout, network and non-JSON classed', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-cm-'));
  const routes = join(d, 'routes.mjs');
  writeFileSync(routes, `export default async (req, body) => {
    if (req.url === '/ok') return { status: 200, json: { a: 1, echo: body ? JSON.parse(body) : null, h: req.headers['x-t'] } };
    if (req.url === '/500') return { status: 500, json: { error: 'SECRET-BODY-PRIVATE_TITLE' } };
    if (req.url === '/slow') { await new Promise((r) => setTimeout(r, 3000)); return { status: 200, json: {} }; }
    return { status: 404, json: {} };
  };\n`);
  const srv = await startServer(routes, { dir: d });
  try {
    assert.deepEqual(await C.httpJson(`${srv.url}/ok`, { method: 'POST', headers: { 'x-t': 'v' }, body: { q: 1 } }), { a: 1, echo: { q: 1 }, h: 'v' });
    await assert.rejects(C.httpJson(`${srv.url}/500`), (e) => e.cls === 'http' && e.code === 500 && !JSON.stringify(e).includes('SECRET') && !String(e.message).includes('SECRET'));
    const html = createServer((q, r) => r.end('<html>nope</html>'));
    await new Promise((ok) => html.listen(0, '127.0.0.1', ok));
    try { await assert.rejects(C.httpJson(`http://127.0.0.1:${html.address().port}/`), (e) => e.cls === 'parse' && e.code === 'json'); } finally { html.close(); }
    await assert.rejects(C.httpJson(`${srv.url}/slow`, { timeoutMs: 150 }), (e) => e.cls === 'timeout');
  } finally { await srv.stop(); }
  await assert.rejects(C.httpJson('http://127.0.0.1:9/x'), (e) => e.cls === 'network' && /^[A-Za-z0-9_-]+$/.test(String(e.code)));
  rmSync(d, { recursive: true, force: true });
});

test('env scan: adapter sources read only CREDENTIAL_ENV and TOKENOMICS_TRACKER_BASE_URL', () => {
  const allowed = new Set([...C.CREDENTIAL_ENV, 'TOKENOMICS_TRACKER_BASE_URL']);
  const files = readdirSync(DIR).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'));
  assert.ok(files.includes('common.mjs') && files.includes('github.mjs'));
  const found = [];
  for (const f of files) {
    const src = readFileSync(join(DIR, f), 'utf8');
    for (const m of src.matchAll(/\b(?:process\.)?env(?:\.([A-Za-z_]\w*)|\[\s*['"`]([^'"`]+)['"`]\s*\])/g)) found.push([f, m[1] ?? m[2]]);
    assert.ok(!/\b(?:process\.)?env\[(?!\s*['"`])/.test(src), `${f}: computed env read`);
    assert.ok(!/\{[^}]*\}\s*=\s*process\.env/.test(src), `${f}: destructured env read`);
  }
  for (const [f, x] of found) assert.ok(allowed.has(x), `${f} reads env ${x}`);
});
