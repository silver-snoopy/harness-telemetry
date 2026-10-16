import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const preload = pathToFileURL(fileURLToPath(new URL('./preload.mjs', import.meta.url))).href;
const run = (code, env) => execFileSync(process.execPath, ['-e', code], {
  env: { ...process.env, NODE_OPTIONS: `--import=${preload}`, ...env }, encoding: 'utf8',
});

test('Date is frozen to the constant HT_NOW for every call (no tick)', () => {
  const out = run('console.log(new Date().toISOString(), Date.now(), Date.now(), new Date().getTime(), new Date(Date()).toISOString())', { HT_NOW: '2026-10-01T10:00:00.000Z', HT_SEED: '1' });
  const [iso, a, b, c, s] = out.trim().split(' ');
  const t = Date.parse('2026-10-01T10:00:00.000Z');
  assert.equal(iso, '2026-10-01T10:00:00.000Z');
  assert.deepEqual([Number(a), Number(b), Number(c)], [t, t, t]);
  assert.equal(s, '2026-10-01T10:00:00.000Z');
});

test('Math.random is seeded and repeatable', () => {
  const a = run('console.log(Math.random(), Math.random())', { HT_NOW: '2026-10-01T10:00:00Z', HT_SEED: '42' });
  const b = run('console.log(Math.random(), Math.random())', { HT_NOW: '2026-10-01T10:00:00Z', HT_SEED: '42' });
  assert.equal(a, b);
});

test('new Date(arg) still parses its argument', () => {
  const out = run("console.log(new Date('2020-01-01T00:00:00Z').toISOString())", { HT_NOW: '2026-10-01T10:00:00Z', HT_SEED: '1' });
  assert.equal(out.trim(), '2020-01-01T00:00:00.000Z');
});

const ISO = '2026-10-01T10:00:00.000Z';
const env = { HT_NOW: ISO, HT_SEED: '1' };
const runModule = (code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], {
  env: { ...process.env, NODE_OPTIONS: `--import=${preload}`, ...env }, encoding: 'utf8',
});

test('Date() without new returns a string like the real Date', () => {
  const out = run("console.log(typeof Date(), new Date(Date()).toISOString())", env);
  const [type, iso] = out.trim().split(' ');
  assert.equal(type, 'string');
  assert.ok(iso.startsWith('2026-10-01'), iso);
});

test('Dates created by Node internals are instanceof Date', () => {
  const out = runModule("import { statSync } from 'node:fs'; console.log(statSync('.').mtime instanceof Date)");
  assert.equal(out.trim(), 'true');
});

test('new Date() is instanceof Date', () => {
  assert.equal(run('console.log(new Date() instanceof Date)', env).trim(), 'true');
});

test('Date.name is Date', () => {
  assert.equal(run('console.log(Date.name)', env).trim(), 'Date');
});

test('Date.parse and Date.UTC are inherited', () => {
  const out = run("console.log(Date.parse('2020-01-01T00:00:00Z'), Date.UTC(2020, 0, 1))", env);
  assert.equal(out.trim(), '1577836800000 1577836800000');
});

const NET_CALLS = {
  fetch: "fetch('http://127.0.0.1:9/')",
  'http.request': "require('http').request('http://127.0.0.1:9/')",
  'http.get': "require('http').get('http://127.0.0.1:9/')",
  'https.request': "require('https').request('https://127.0.0.1:9/')",
  'https.get': "require('https').get('https://127.0.0.1:9/')",
  'net.connect': "require('net').connect(9, '127.0.0.1')",
  'net.createConnection': "require('net').createConnection(9, '127.0.0.1')",
};
const probe = (expr) => `try { const r = ${expr}; if (r && r.on) r.on('error', () => {}); if (r && r.destroy) r.destroy(); if (r && r.catch) r.catch(() => {}); console.log('allowed'); } catch (e) { console.log(e.message); }`;

for (const [name, expr] of Object.entries(NET_CALLS)) {
  test(`network is blocked in replay: ${name} throws`, () => {
    assert.equal(run(probe(expr), env).trim(), 'network disabled in replay');
  });
}

test('network block also covers ESM named imports of node:http', () => {
  const out = runModule("import { request } from 'node:http'; try { request('http://127.0.0.1:9/'); console.log('allowed'); } catch (e) { console.log(e.message); }");
  assert.equal(out.trim(), 'network disabled in replay');
});

test('network block is inert outside replay (HT_NOW unset)', () => {
  const out = execFileSync(process.execPath, ['-e', probe(NET_CALLS['net.connect']) + "; console.log(typeof fetch, require('http').request.name)"], {
    env: { ...process.env, NODE_OPTIONS: `--import=${preload}`, HT_NOW: '', HT_SEED: '' }, encoding: 'utf8',
  });
  assert.match(out, /^allowed\nfunction request\n$/);
});

test('HT_PLATFORM (opt-in) overrides process.platform; unset leaves the real value', () => {
  assert.equal(run('console.log(process.platform)', { ...env, HT_PLATFORM: 'darwin' }).trim(), 'darwin');
  assert.equal(run('console.log(process.platform)', { ...env, HT_PLATFORM: 'linux' }).trim(), 'linux');
  assert.equal(run('console.log(process.platform)', env).trim(), process.platform);
});

// Final review F3: directory listings are sorted by name in a replay, so goldens do not depend on the
// host filesystem's raw readdir order (APFS vs ext4; map §3 R13).
test('directory listings are sorted by name in replay (sync, callback, promises; names and Dirents)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ht-pre-ls-'));
  // The last two names order differently by UTF-8 bytes (libuv's scandir strcmp: U+FFFD first) and by
  // UTF-16 code units (the oracle's rule: U+1F600's high surrogate D83D first), so the test sees the wrapper.
  for (const n of ['m', 'B', 'z', 'a', '_', '10', '9', '\uFFFD', '\u{1F600}']) writeFileSync(join(dir, n), '');
  const want = ['10', '9', 'B', '_', 'a', 'm', 'z', '\u{1F600}', '\uFFFD'].join(',');
  const code = `
import fs, { readdirSync, readdir } from 'node:fs';
import { readdir as pReaddir } from 'node:fs/promises';
const d = ${JSON.stringify(dir)};
const j = (a) => a.map((e) => (typeof e === 'string' ? e : e.name)).join(',');
console.log(j(readdirSync(d)));
console.log(j(fs.readdirSync(d, { withFileTypes: true })));
console.log(j(fs.readdirSync(d, 'utf8')));
console.log(j(await pReaddir(d)));
console.log(j(await fs.promises.readdir(d, { withFileTypes: true })));
console.log(j(await new Promise((res, rej) => readdir(d, (e, r) => (e ? rej(e) : res(r))))));
console.log(j(await new Promise((res, rej) => fs.readdir(d, { withFileTypes: true }, (e, r) => (e ? rej(e) : res(r))))));
console.log(Buffer.isBuffer(readdirSync(d, { encoding: 'buffer' })[0]));
`;
  const out = runModule(code).trim().split('\n');
  assert.deepEqual(out.slice(0, 7), Array(7).fill(want));
  assert.equal(out[7], 'true', 'Buffer encodings are left as is');
});

test('readdir errors still surface through every form', () => {
  const missing = join(tmpdir(), 'ht-pre-ls-missing-does-not-exist');
  const code = `
import fs from 'node:fs';
try { fs.readdirSync(${JSON.stringify(missing)}); } catch (e) { console.log(e.code); }
fs.readdir(${JSON.stringify(missing)}, (e) => console.log(e.code));
fs.promises.readdir(${JSON.stringify(missing)}).catch((e) => console.log(e.code));
`;
  assert.deepEqual(runModule(code).trim().split('\n'), ['ENOENT', 'ENOENT', 'ENOENT']);
});
