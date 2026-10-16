import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('./team-report.mjs', import.meta.url).href;

const repo = (t, settings) => {
  const d = mkdtempSync(join(tmpdir(), 'ht-roots-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  if (settings) { mkdirSync(join(d, '.agents/tokenomics'), { recursive: true }); writeFileSync(join(d, '.agents/tokenomics/settings.json'), JSON.stringify(settings)); }
  return d;
};
// main() runs in a child: stubbing this process's stdout would swallow Node 18's per-file test report.
// exitCode (not process.exit) lets the child's piped stdout drain in full.
const run = async (args) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { main } = await import(${JSON.stringify(SCRIPT)}); process.exitCode = await main(process.argv.slice(1));`,
    '--', ...args, '--json'], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const foreign = { dir: 'stories', extension: null, vocabulary: { item: 'story', group: 'sprint' } };

test('two TA roots (no settings) report together', async (t) => {
  assert.equal((await run([repo(t), repo(t)])).code, 0);
});
test('two roots with identical foreign settings report together', async (t) => {
  assert.equal((await run([repo(t, foreign), repo(t, foreign)])).code, 0);
});
test('the same root twice reports', async (t) => {
  const r = repo(t, foreign);
  assert.equal((await run([r, r])).code, 0);
});
test('a TA root and a foreign root are rejected in either order', async (t) => {
  const a = repo(t), b = repo(t, foreign);
  for (const roots of [[a, b], [b, a]]) {
    const r = await run(roots);
    assert.equal(r.code, 2);
    assert.match(r.err, /use different \.agents\/tokenomics\/settings\.json — report them separately/);
    assert.equal(r.out, '');
  }
});

// Fix round 1: settings that compare equal must also load the same extension module.
const EXT = (tag) => `export const extensionApi = 2;\nexport const tag = '${tag}';\n`;
const withExt = (t, src) => {
  const d = repo(t, { extension: './ext/x.mjs' });
  mkdirSync(join(d, 'ext'), { recursive: true });
  writeFileSync(join(d, 'ext/x.mjs'), src);
  return d;
};
test('equal settings naming different extension modules are rejected in either order', async (t) => {
  const c = withExt(t, EXT('c')), d = withExt(t, EXT('d'));
  for (const roots of [[c, d], [d, c]]) {
    const r = await run(roots);
    assert.equal(r.code, 2);
    assert.match(r.err, /load different extension modules .* — report them separately/);
    assert.equal(r.out, '');
  }
});
test('equal settings naming byte-identical extension modules report together', async (t) => {
  assert.equal((await run([withExt(t, EXT('same')), withExt(t, EXT('same'))])).code, 0);
});
test('a TA root and a root re-declaring the TA extension path (missing there) are rejected in either order, no crash', async (t) => {
  const a = repo(t);
  const b = repo(t, { extension: './extensions/test-automation.mjs' });
  for (const roots of [[a, b], [b, a]]) {
    const r = await run(roots);
    assert.equal(r.code, 2);
    assert.ok(r.err.includes(`${join(b, 'extensions/test-automation.mjs')} does not exist — report them separately`), r.err);
    assert.equal(r.out, '');
  }
});
test('batch mode uses the first root only and skips the roots check', async (t) => {
  const a = repo(t), f = repo(t, foreign);
  const r = await run(['--batches', a, f]);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes(`no receipts under ${join(a, '.agents/automation')}`), r.err);
});

// Final review: settings equality is canonical (recursively sorted keys), not key-order dependent.
test('settings with the same keys in a different order report together', async (t) => {
  const a = repo(t, { extension: null, zz: 1, yy: { b: 2, a: [1, { d: 4, c: 3 }] } });
  const b = repo(t, { yy: { a: [1, { c: 3, d: 4 }], b: 2 }, zz: 1, extension: null });
  for (const roots of [[a, b], [b, a]]) assert.equal((await run(roots)).code, 0);
  const c = repo(t, { extension: null, yy: { a: [{ c: 3, d: 4 }, 1], b: 2 }, zz: 1 }); // array order still matters
  const r = await run([a, c]);
  assert.equal(r.code, 2);
  assert.match(r.err, /use different \.agents\/tokenomics\/settings\.json/);
});

// Plan 3 Task 5 (parked): an unreadable extension path is a named conflict (exit 2), not a crash.
test('equal settings whose extension path is a directory in one root are rejected, no crash', async (t) => {
  const settings = { extension: './ext.mjs' };
  const a = repo(t, settings), b = repo(t, settings);
  mkdirSync(join(a, 'ext.mjs'));
  writeFileSync(join(b, 'ext.mjs'), EXT('b'));
  for (const roots of [[a, b], [b, a]]) {
    const r = await run(roots);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /cannot read .*ext\.mjs \(EISDIR\)/);
    assert.equal(r.out, '');
  }
});
