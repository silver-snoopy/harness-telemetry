import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relative, join } from 'node:path';
import { readFileSync, rmSync, mkdtempSync, writeFileSync, cpSync, lstatSync, readlinkSync, existsSync, mkdirSync, chmodSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { buildSandbox, makeScrub, encodeProjectPath, removeSandbox } from './sandbox.mjs';
import { runCase, validateManifest, unmetRequirements, RESERVED_ROOTS } from './runner.mjs';
import { refDir } from '../scripts/vendor-reference.mjs';

const seed = fileURLToPath(new URL('../corpus/cases/seed-claude-basic', import.meta.url));

test('R0 gate: a reference capture replays byte-identically twice', async () => {
  const a = await runCase(seed, refDir('49577c7'));
  const b = await runCase(seed, refDir('49577c7'));
  assert.deepEqual(a.exits, [0]);
  const ledgers = Object.keys(a.files).filter((k) => /usage-.*\.jsonl$/.test(k));
  assert.equal(ledgers.length, 1, `one ledger file, got ${Object.keys(a.files)}`);
  assert.deepEqual(a.files, b.files);
});

test('outputs never contain the sandbox path', async () => {
  const a = await runCase(seed, refDir('49577c7'));
  for (const [k, v] of Object.entries(a.files)) {
    assert.doesNotMatch(v, /ht-sandbox-/, k);
    assert.doesNotMatch(v, /\/Users\//, k);
  }
});

test('the captured line carries the seed facts', async () => {
  const a = await runCase(seed, refDir('49577c7'));
  const key = Object.keys(a.files).find((k) => /usage-.*\.jsonl$/.test(k));
  const line = JSON.parse(a.files[key].trim().split('\n').at(-1));
  assert.equal(line.host, 'claude');
  assert.equal(line.id, 's1');
  assert.equal(line.branch, 'feat/384-seed');
  assert.deepEqual(line.tokens, { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 });
  assert.equal(line.costUsd, 0.0123);
  assert.equal(line.costSource, 'ccusage-metered');
});

test('relative caseDir/implDir work (CLI usage)', async () => {
  const rel = (p) => relative(process.cwd(), p);
  const a = await runCase(rel(seed), rel(refDir('49577c7')));
  assert.deepEqual(a.exits, [0]);
});

test('sandbox shadows npx: exits 97 with a clear message', () => {
  const m = JSON.parse(readFileSync(join(seed, 'replay.json'), 'utf8'));
  const sb = buildSandbox(seed, m);
  try {
    const r = spawnSync('npx', ['--version'], { env: sb.env, encoding: 'utf8' });
    assert.equal(r.status, 97);
    assert.match(r.stderr, /npx disabled in replay/);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('makeScrub removes every sandbox path form', () => {
  const sb = { root: '/tmp/ht-sandbox-AbC', home: '/tmp/ht-sandbox-AbC/home', repo: '/tmp/ht-sandbox-AbC/repo' };
  const input = [encodeProjectPath(sb.repo), encodeProjectPath(sb.root), sb.repo, sb.home, sb.root].join(' | ');
  const out = makeScrub(sb)(input);
  assert.equal(out, '<REPOKEY> | <ROOTKEY> | <REPO> | <HOME> | <ROOT>');
  assert.doesNotMatch(out, /ht-sandbox/);
});

test('a host GIT_DIR/GIT_WORK_TREE never leaks into the sandbox git setup', () => {
  const host = mkdtempSync(join(tmpdir(), 'ht-hostrepo-'));
  const git = (...a) => execFileSync('git', ['-C', host, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: host, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'host');
  git('config', 'user.email', 'host@example.invalid');
  writeFileSync(join(host, 'f'), 'x');
  git('add', '-A');
  git('commit', '-q', '-m', 'host');
  const head = git('rev-parse', 'HEAD');
  const config = readFileSync(join(host, '.git/config'), 'utf8');
  const saved = {};
  const leak = { GIT_DIR: join(host, '.git'), GIT_WORK_TREE: host, GIT_INDEX_FILE: join(host, '.git/index') };
  for (const k of Object.keys(leak)) { saved[k] = process.env[k]; process.env[k] = leak[k]; }
  const m = JSON.parse(readFileSync(join(seed, 'replay.json'), 'utf8'));
  let sb;
  try { sb = buildSandbox(seed, m); } finally {
    for (const k of Object.keys(leak)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  try {
    assert.equal(git('rev-parse', 'HEAD'), head, 'host repo got a new commit');
    assert.equal(git('rev-list', '--count', 'HEAD'), '1');
    assert.equal(readFileSync(join(host, '.git/config'), 'utf8'), config, 'host repo config changed');
    assert.equal(execFileSync('git', ['-C', sb.repo, 'log', '-1', '--format=%s %an'], { encoding: 'utf8', env: { PATH: process.env.PATH } }).trim(), `seed ${m.identity.gitUser}`);
  } finally { rmSync(sb.root, { recursive: true, force: true }); rmSync(host, { recursive: true, force: true }); }
});

test('a checkout and case path containing a space replays byte-identically', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ht space-'));
  try {
    const root = join(tmp, 'check out');
    cpSync(fileURLToPath(new URL('.', import.meta.url)), join(root, 'replay'), { recursive: true });
    cpSync(refDir('49577c7'), join(root, 'ref impl'), { recursive: true });
    cpSync(seed, join(root, 'my cases', 'seed-claude-basic'), { recursive: true });
    const { runCase: runCopy } = await import(pathToFileURL(join(root, 'replay', 'runner.mjs')).href);
    const r = await runCopy(join(root, 'my cases', 'seed-claude-basic'), join(root, 'ref impl'));
    assert.deepEqual(r.exits, [0]);
    const golden = join(seed, 'expected/49577c7');
    assert.ok(Object.keys(r.files).length > 0);
    for (const [k, v] of Object.entries(r.files)) assert.equal(v, readFileSync(join(golden, k), 'utf8'), k);
    const line = JSON.parse(Object.entries(r.files).find(([k]) => /usage-.*\.jsonl$/.test(k))[1].trim());
    assert.equal(line.costSource, 'ccusage-metered', 'the ccusage stub ran from the spaced path');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('a malformed manifest is rejected with a clear error before anything runs', async () => {
  const good = JSON.parse(readFileSync(join(seed, 'replay.json'), 'utf8'));
  assert.doesNotThrow(() => validateManifest(good));
  const ev = good.events[0];
  for (const [bad, re] of [
    [{ ...ev, at: 'yesterday' }, /events\[0\]\.at: "yesterday" is not a valid ISO/],
    [{ ...ev, at: '2026-02-30T10:00:00Z' }, /events\[0\]\.at/],
    [{ ...ev, at: undefined }, /events\[0\]\.at/],
    [{ ...ev, run: 42 }, /events\[0\]\.run: must be a non-empty string/],
    [{ ...ev, args: undefined }, /events\[0\]\.args: must be an array of strings/],
    [{ ...ev, args: [1] }, /events\[0\]\.args/],
  ]) assert.throws(() => validateManifest({ ...good, events: [bad] }), re);
  assert.throws(() => validateManifest({ ...good, events: [] }), /events: must be a non-empty array/);
  const d = mkdtempSync(join(tmpdir(), 'ht-badman-'));
  try {
    cpSync(seed, d, { recursive: true });
    writeFileSync(join(d, 'replay.json'), JSON.stringify({ ...good, events: [{ ...ev, at: 'soon' }] }));
    await assert.rejects(runCase(d, refDir('49577c7')), /invalid replay manifest[\s\S]*events\[0\]\.at/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an event env value of null unsets the variable (default-fallback branches)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-envnull-'));
  try {
    const ev = (env) => ({ at: '2026-10-01T09:00:00Z', run: 'hooks/scope-hook.mjs', args: ['--announce'], stdin: { session_id: 't1' }, env, captureStdout: true });
    writeFileSync(join(d, 'replay.json'), JSON.stringify({
      id: 'x', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: { '.agents/telemetry/automation/scopes/t1.json': JSON.stringify({ intent: 'docs', cases: [] }) } },
      stores: [], outputs: [], events: [ev({ CLAUDE_PROJECT_DIR: '/nonexistent' }), ev({ CLAUDE_PROJECT_DIR: null })],
    }));
    const r = await runCase(d, refDir('49577c7'));
    assert.deepEqual(r.exits, [0, 0]);
    assert.match(r.files['__events__/0.stdout'], /declare what this session is for/, 'env set elsewhere: no scope found');
    assert.match(r.files['__events__/1.stdout'], /tokenomics scope \[session t1\]: docs/, 'env unset: falls back to cwd (the repo)');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('manifest symlinks: built as dangling links inside the sandbox, validated before anything runs', () => {
  const good = JSON.parse(readFileSync(join(seed, 'replay.json'), 'utf8'));
  const withLinks = (symlinks) => ({ ...good, symlinks });
  assert.doesNotThrow(() => validateManifest(withLinks([{ path: 'repo/a/link', target: 'nowhere/x' }])));
  for (const [bad, re] of [
    [{ path: '../escape', target: 'x' }, /symlinks\[0\]\.path/],
    [{ path: '/abs/link', target: 'x' }, /symlinks\[0\]\.path/],
    [{ path: 'repo/l', target: '/etc/passwd' }, /symlinks\[0\]\.target/],
    [{ path: 'repo/l', target: '../../../out' }, /symlinks\[0\]\.target/],
    [{ path: 'repo/l' }, /needs string path and target/],
  ]) assert.throws(() => validateManifest(withLinks([bad])), re);
  assert.throws(() => validateManifest({ ...good, symlinks: 'x' }), /symlinks: must be an array/);
  const sb = buildSandbox(seed, withLinks([{ path: 'repo/a/link', target: 'nowhere/x' }]));
  try {
    const at = join(sb.root, 'repo/a/link');
    assert.ok(lstatSync(at).isSymbolicLink());
    assert.equal(readlinkSync(at), 'nowhere/x');
    assert.equal(existsSync(at), false, 'dangling: existsSync is false');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('{impl} in args and stdin expands to the implementation root (repo-relative script paths)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-impl-'));
  try {
    writeFileSync(join(d, 'replay.json'), JSON.stringify({
      id: 'x', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' }, repo: { path: 'repo', branch: 'main', files: {} },
      stores: [], outputs: [], events: [{ at: '2026-10-01T09:00:00Z', run: 'hooks/scope-hook.mjs', args: ['--announce'], stdin: { session_id: 'i1', cwd: '{impl}' }, env: {}, captureStdout: true }],
    }));
    const r = await runCase(d, refDir('49577c7'));
    assert.match(r.files['__events__/0.stdout'], /`node scripts\/work-scope\.mjs open --session i1/, 'script path is relative to the impl root, so it names no checkout path');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('stderr is captured scrubbed by default when non-empty; explicit captureStderr/captureStdout always write', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-stderr-'));
  try {
    const ev = (extra) => ({ at: '2026-10-01T09:00:00Z', run: 'scripts/batch-cost.mjs', args: [], stdin: null, env: {}, ...extra });
    writeFileSync(join(d, 'replay.json'), JSON.stringify({
      id: 'x', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: { 'README.md': 'x' } },
      stores: [], outputs: [], events: [ev({ captureStderr: true, captureStdout: true }), ev({})],
    }));
    const r = await runCase(d, refDir('49577c7'));
    assert.deepEqual(r.exits, [1, 1]);
    assert.match(r.files['__events__/0.stderr'], /^batch-cost: no receipts under .*\.agents\/automation\n$/);
    assert.ok(!/\/(private|var|tmp|Users)\//.test(r.files['__events__/0.stderr']), 'absolute sandbox path scrubbed');
    assert.equal(r.files['__events__/1.stderr'], r.files['__events__/0.stderr'], 'non-empty stderr is captured without the flag');
    assert.equal(r.files['__events__/0.stdout'], '', 'explicit captureStdout writes even an empty stream');
    assert.ok(!('__events__/1.stdout' in r.files), 'an empty stream without the flag is not written');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('removeSandbox removes a tree containing mode-000 and mode-0500 directories', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ht-rm-'));
  t.after(() => removeSandbox(root));
  mkdirSync(join(root, 'a/b'), { recursive: true });
  writeFileSync(join(root, 'a/b/f'), 'x');
  mkdirSync(join(root, 'c'));
  writeFileSync(join(root, 'c/g'), 'y');
  chmodSync(join(root, 'a/b'), 0o500);
  chmodSync(join(root, 'c'), 0o000);
  removeSandbox(root);
  assert.equal(existsSync(root), false);
});

test('removeSandbox does not chmod or follow a symlink pointing outside the sandbox', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ht-rm-'));
  const outside = mkdtempSync(join(tmpdir(), 'ht-out-'));
  t.after(() => { removeSandbox(root); chmodSync(outside, 0o700); rmSync(outside, { recursive: true, force: true }); });
  writeFileSync(join(outside, 'keep'), 'z');
  chmodSync(outside, 0o500);
  symlinkSync(outside, join(root, 'link'));
  removeSandbox(root);
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(outside), true);
  assert.equal(statSync(outside).mode & 0o777, 0o500);
});

test('unmetRequirements: non-root is unmet only for uid 0', () => {
  assert.deepEqual(unmetRequirements({ requires: ['non-root'] }, { uid: 0 }), ['non-root']);
  assert.deepEqual(unmetRequirements({ requires: ['non-root'] }, { uid: 501 }), []);
  assert.deepEqual(unmetRequirements({}, { uid: 0 }), []);
  assert.deepEqual(unmetRequirements({ requires: ['non-root'] }, { uid: undefined }), [], 'no getuid (Windows): nothing to enforce');
});

test('validateManifest rejects an unknown or malformed requirement', () => {
  const base = { events: [{ at: '2026-10-01T00:00:00Z', run: 'x.mjs', args: [] }] };
  assert.throws(() => validateManifest({ ...base, requires: ['gpu'] }), /requires\[0\]: unknown requirement "gpu"/);
  assert.throws(() => validateManifest({ ...base, requires: 'non-root' }), /requires: must be an array/);
  assert.doesNotThrow(() => validateManifest({ ...base, requires: ['non-root'] }));
});

test('a replayed script that writes 200,000 bytes then calls process.exit is captured whole (blocking stdio)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-bigout-'));
  const impl = mkdtempSync(join(tmpdir(), 'ht-bigimpl-'));
  try {
    writeFileSync(join(impl, 'big.mjs'), "process.stdout.write('x'.repeat(200000));\nprocess.exit(0);\n");
    writeFileSync(join(d, 'replay.json'), JSON.stringify({
      id: 'x', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' }, repo: { path: 'repo', branch: 'main', files: {} },
      stores: [], outputs: [], events: [{ at: '2026-10-01T09:00:00Z', run: 'big.mjs', args: [], stdin: null, env: {}, captureStdout: true }],
    }));
    const r = await runCase(d, impl);
    assert.deepEqual(r.exits, [0]);
    assert.equal(r.files['__events__/0.stdout'].length, 200000);
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(impl, { recursive: true, force: true }); }
});

const outputRoots = (caseDir) => {
  const m = JSON.parse(readFileSync(join(caseDir, 'replay.json'), 'utf8'));
  return m.outputs.map((o) => `${m.repo.path}/${o}`.replace(/\/+$/, ''));
};
const assertNoOutputInChanges = (changes, roots) => {
  for (const line of changes.trim().split('\n')) {
    const [, p] = JSON.parse(line); // `["A"|"M"|"D", path, digest…]` (Codex P3-03, P3P-02)
    assert.ok(!roots.some((r) => p === r || p.startsWith(`${r}/`)), `changes.txt lists a declared output: ${line}`);
  }
};

test('observation boundary: a replay is deterministic and changes.txt never lists a declared output', async () => {
  const r1 = await runCase(seed, refDir('49577c7'));
  const r2 = await runCase(seed, refDir('49577c7'));
  assert.deepEqual(r1.files, r2.files);
  const changes = r1.files['__sandbox__/changes.txt'];
  if (changes !== undefined) assertNoOutputInChanges(changes, outputRoots(seed));
});

test('observation boundary: changes.txt with a collapsed git dir is identical across two runs (cov-capture-sync)', async () => {
  const c = fileURLToPath(new URL('../corpus/cases/cov-capture-sync', import.meta.url));
  const r1 = await runCase(c, refDir('49577c7'));
  const r2 = await runCase(c, refDir('49577c7'));
  const changes = r1.files['__sandbox__/changes.txt'];
  assert.equal(typeof changes, 'string', 'cov-capture-sync produces __sandbox__/changes.txt');
  assert.match(changes, /^\["M","repo\/tgit\/","g:[0-9a-f]{16}","g:[0-9a-f]{16}"\]$/m, 'the nested git dir collapses to one entry with summary digests');
  assert.equal(r2.files['__sandbox__/changes.txt'], changes);
  assert.deepEqual(r1.files, r2.files);
  assertNoOutputInChanges(changes, outputRoots(c));
});

test('validateManifest: untracked entries need a path inside the sandbox and a reason of at least 40 chars', () => {
  const base = { events: [{ at: '2026-10-01T00:00:00Z', run: 'x.mjs', args: [] }] };
  const reason = 'a host tool writes a cache here with a random name';
  assert.doesNotThrow(() => validateManifest({ ...base, untracked: [{ path: 'repo/stage-tmp', reason }] }));
  assert.throws(() => validateManifest({ ...base, untracked: 'repo' }), /untracked: must be an array/);
  assert.throws(() => validateManifest({ ...base, untracked: [{ path: '../x', reason }] }), /untracked\[0\]\.path/);
  assert.throws(() => validateManifest({ ...base, untracked: [{ path: '/abs', reason }] }), /untracked\[0\]\.path/);
  assert.throws(() => validateManifest({ ...base, untracked: [{ path: '.', reason }] }), /untracked\[0\]\.path/);
  assert.throws(() => validateManifest({ ...base, untracked: [{ path: 'repo/x', reason: 'too short' }] }), /untracked\[0\]\.reason/);
  assert.throws(() => validateManifest({ ...base, untracked: [null] }), /untracked\[0\]/);
});

test('an untracked path is normalised: `repo/./x/` hides writes under repo/x', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-untracked-'));
  try {
    const impl = join(d, 'impl'); const cs = join(d, 'case');
    mkdirSync(impl); mkdirSync(cs);
    writeFileSync(join(impl, 'w.mjs'), "import { mkdirSync, writeFileSync } from 'node:fs';\nfor (const p of ['x/a', 'x/sub/b', 'y/c']) { mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true }); writeFileSync(p, '1'); }\n");
    writeFileSync(join(cs, 'replay.json'), JSON.stringify({
      id: 'u', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: [],
      untracked: [{ path: 'repo/./x/', reason: 'test: a non-canonical spelling must still hide writes under repo/x' }],
      events: [{ at: '2026-10-01T09:00:00Z', run: 'w.mjs', args: [], stdin: null, env: {} }],
    }));
    const r = await runCase(cs, impl);
    assert.deepEqual(r.exits, [0]);
    assert.equal(r.files['__sandbox__/changes.txt'], '["A","repo/y/c","f:6b86b273ff34fce1"]\n'); // sha256('1')
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a leading BOM changes the f: digest (the decoder does not strip it before hashing)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-bom-'));
  try {
    const impl = join(d, 'impl'); const cs = join(d, 'case');
    mkdirSync(impl); mkdirSync(cs);
    writeFileSync(join(impl, 'w.mjs'), "import { writeFileSync } from 'node:fs';\nwriteFileSync('bom.txt', '\\uFEFFhello');\nwriteFileSync('plain.txt', 'hello');\n");
    writeFileSync(join(cs, 'replay.json'), JSON.stringify({
      id: 'bom', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: [],
      events: [{ at: '2026-10-01T09:00:00Z', run: 'w.mjs', args: [], stdin: null, env: {} }],
    }));
    const r = await runCase(cs, impl);
    const ch = r.files['__sandbox__/changes.txt'] ?? '';
    const dig = (n) => ch.match(new RegExp(`^\\["A","repo/${n}","(f:[0-9a-f]{16})"\\]$`, 'm'))?.[1];
    assert.ok(dig('bom.txt') && dig('plain.txt'), ch);
    assert.notEqual(dig('bom.txt'), dig('plain.txt'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an untracked file path hides only that file: other writes under repo/stage-tmp still appear', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-untracked-file-'));
  try {
    const impl = join(d, 'impl'); const cs = join(d, 'case');
    mkdirSync(impl); mkdirSync(cs);
    writeFileSync(join(impl, 'w.mjs'), "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('stage-tmp', { recursive: true });\nfor (const p of ['stage-tmp/xcrun_db', 'stage-tmp/other.txt']) writeFileSync(p, '1');\n");
    writeFileSync(join(cs, 'replay.json'), JSON.stringify({
      id: 'uf', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: [],
      untracked: [{ path: 'repo/stage-tmp/xcrun_db', reason: 'test: the host xcrun cache is hidden but its sibling writes are not' }],
      events: [{ at: '2026-10-01T09:00:00Z', run: 'w.mjs', args: [], stdin: null, env: {} }],
    }));
    const r = await runCase(cs, impl);
    assert.deepEqual(r.exits, [0]);
    const ch = r.files['__sandbox__/changes.txt'] ?? '';
    assert.match(ch, /^\["A","repo\/stage-tmp\/other\.txt",/m);
    assert.doesNotMatch(ch, /xcrun_db/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an event with via "symlink" spawns <ROOT>/links/<basename> (a symlink to the real script)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-via-'));
  try {
    const impl = join(d, 'impl'); const cs = join(d, 'case');
    mkdirSync(join(impl, 'scripts'), { recursive: true }); mkdirSync(cs);
    writeFileSync(join(impl, 'scripts/p.mjs'), "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('out', { recursive: true });\nwriteFileSync('out/argv1.txt', process.argv[1]);\n");
    writeFileSync(join(cs, 'replay.json'), JSON.stringify({
      id: 'v', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: ['out'],
      events: [{ at: '2026-10-01T09:00:00Z', run: 'scripts/p.mjs', args: [], stdin: null, env: {}, via: 'symlink' }],
    }));
    const r = await runCase(cs, impl);
    assert.deepEqual(r.exits, [0]);
    assert.equal(r.files['out/argv1.txt'], '<ROOT>/links/p.mjs');
    assert.match(r.files['__sandbox__/changes.txt'] ?? '', /^\["A","links\/p\.mjs","l:<IMPL>\/scripts\/p\.mjs"\]$/m, 'the link is a sandbox write outside the outputs, with its scrubbed target');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('validateManifest accepts only "symlink" for an event via', () => {
  const ev = { at: '2026-10-01T00:00:00Z', run: 'x.mjs', args: [] };
  assert.doesNotThrow(() => validateManifest({ events: [{ ...ev, via: 'symlink' }] }));
  assert.throws(() => validateManifest({ events: [{ ...ev, via: 'hardlink' }] }), /events\[0\]\.via: "hardlink" — only "symlink" is supported/);
  assert.throws(() => validateManifest({ events: [{ ...ev, via: true }] }), /events\[0\]\.via/);
});

// Codex P3P-01 (Review Focus 1): a file named after an Object.prototype member is observed exactly, nested or at
// the root of an output, end to end through runCase/collect.
test('P3P-01: prototype-named output files are collected as ordinary own keys', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-proto-'));
  try {
    const impl = join(d, 'impl'); const cs = join(d, 'case');
    mkdirSync(join(impl, 'scripts'), { recursive: true }); mkdirSync(cs);
    writeFileSync(join(impl, 'scripts/p.mjs'), [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "mkdirSync('out', { recursive: true });",
      "writeFileSync('out/__proto__', 'P'); writeFileSync('out/toString', 'T'); writeFileSync('out/constructor', 'C');",
      "writeFileSync('__proto__', 'RP'); writeFileSync('toString', 'RT'); writeFileSync('constructor', 'RC');", '',
    ].join('\n'));
    writeFileSync(join(cs, 'replay.json'), JSON.stringify({
      id: 'p', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: ['out', '__proto__', 'toString', 'constructor'],
      events: [{ at: '2026-10-01T09:00:00Z', run: 'scripts/p.mjs', args: [], stdin: null, env: {} }],
    }));
    const r = await runCase(cs, impl);
    assert.deepEqual(r.exits, [0]);
    // Pairs, not an object literal: `{ '__proto__': v }` would set the literal's prototype.
    const want = [['out/__proto__', 'P'], ['out/constructor', 'C'], ['out/toString', 'T'], ['__proto__', 'RP'], ['constructor', 'RC'], ['toString', 'RT']];
    for (const [k, v] of want) {
      assert.equal(Object.hasOwn(r.files, k), true, `own key ${k}`);
      assert.equal(r.files[k], v, k);
    }
    assert.deepEqual(Object.keys(r.files), ['__proto__', 'constructor', 'out/__proto__', 'out/constructor', 'out/toString', 'toString'], 'sorted, nothing else');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// Codex P3P-02 / Reproduction F (Review Focus 1), end to end: a symlink whose target contains a newline is one
// record in changes.txt, and its scrubbed target round-trips through JSON.parse.
test('P3P-02: a symlink target containing a newline is one changes.txt record, not two', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-nl-link-'));
  try {
    const impl = join(d, 'impl'); const cs = join(d, 'case');
    mkdirSync(impl); mkdirSync(cs);
    writeFileSync(join(impl, 'w.mjs'), "import { symlinkSync } from 'node:fs';\nsymlinkSync('x\\nA repo/rogue l:y', 'link');\nsymlinkSync(process.cwd() + '/t\\n', 'abs');\n");
    writeFileSync(join(cs, 'replay.json'), JSON.stringify({
      id: 'nl', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: [],
      events: [{ at: '2026-10-01T09:00:00Z', run: 'w.mjs', args: [], stdin: null, env: {} }],
    }));
    const r = await runCase(cs, impl);
    assert.deepEqual(r.exits, [0]);
    const ch = r.files['__sandbox__/changes.txt'];
    assert.equal(typeof ch, 'string');
    assert.ok(ch.endsWith('\n'));
    const recs = ch.slice(0, -1).split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(recs, [['A', 'repo/abs', 'l:<REPO>/t\n'], ['A', 'repo/link', 'l:x\nA repo/rogue l:y']]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('every event\'s environment carries the engine version pin (owner Q14: goldens never churn on a version bump)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-pin-'));
  const impl = mkdtempSync(join(tmpdir(), 'ht-pin-impl-'));
  try {
    writeFileSync(join(impl, 'env.mjs'), 'process.stdout.write(`pin=${process.env.TOKENOMICS_ENGINE_VERSION_PIN}\\n`);\n');
    const ev = (env) => ({ at: '2026-10-01T09:00:00Z', run: 'env.mjs', args: [], ...(env ? { env } : {}) });
    writeFileSync(join(d, 'replay.json'), JSON.stringify({
      id: 'x', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: [],
      events: [ev(), ev({ TOKENOMICS_ENGINE_VERSION_PIN: '9.9.9' })],
    }));
    const r = await runCase(d, impl);
    assert.deepEqual(r.exits, [0, 0]);
    assert.equal(r.files['__events__/0.stdout'], 'pin=0.0.0-replay\n');
    assert.equal(r.files['__events__/1.stdout'], 'pin=0.0.0-replay\n', 'an event cannot override the pin');
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(impl, { recursive: true, force: true }); }
});

/** A one-event case running `w.mjs` (body given) with these outputs, in a temp dir removed after the test. */
function scratchCase(t, body, outputs = ['out'], event = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ht-b2-run-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(join(d, 'impl')); mkdirSync(join(d, 'case'));
  writeFileSync(join(d, 'impl', 'w.mjs'), `import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';\n${body}\n`);
  writeFileSync(join(d, 'case', 'replay.json'), JSON.stringify({
    id: 'b2', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
    repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs,
    events: [{ at: '2026-10-01T09:00:00Z', run: 'w.mjs', args: [], stdin: null, env: {}, ...event }],
  }));
  return { cs: join(d, 'case'), impl: join(d, 'impl') };
}

// Codex B2-02: the replay's synthetic observations own __events__/ and __sandbox__/; an output may not select them.
test('B2-02: validateManifest rejects an output under a reserved root, however it is spelled', () => {
  const base = { events: [{ at: '2026-10-01T09:00:00Z', run: 'x.mjs', args: [] }] };
  assert.deepEqual(RESERVED_ROOTS, ['__events__', '__sandbox__']);
  for (const o of ['__events__', '__sandbox__', '__events__/0.stdout', './__sandbox__/', 'x/../__events__', '__sandbox__//changes.txt']) {
    assert.throws(() => validateManifest({ ...base, outputs: ['out', o] }), /outputs\[1\]: .* is reserved for the replay's own observations/, o);
  }
  assert.throws(() => validateManifest({ ...base, outputs: 'out' }), /outputs: must be an array/);
  assert.throws(() => validateManifest({ ...base, outputs: [1] }), /outputs\[0\]: must be a string/);
  for (const o of ['out', '__events', 'x/__events__', '.agents/telemetry']) assert.doesNotThrow(() => validateManifest({ ...base, outputs: [o] }), o);
});

test('B2-02: a real file under a reserved root reached through output "." is refused, not merged with event 0', async (t) => {
  const { cs, impl } = scratchCase(t, "mkdirSync('__events__', { recursive: true }); writeFileSync('__events__/0.stdout', 'UNDECLARED'); console.log('stream');", ['.']);
  await assert.rejects(runCase(cs, impl), /replay observation refused[\s\S]*__events__\/0\.stdout is a real file in the replay's reserved namespace/);
});

// Codex B2-03: selected outputs and event streams are bytes decoded strictly; invalid UTF-8 is refused by name.
test('B2-03: a selected output that is not valid UTF-8 is refused, never decoded to U+FFFD', async (t) => {
  const { cs, impl } = scratchCase(t, "mkdirSync('out'); writeFileSync('out/raw.bin', Buffer.from([0x80])); writeFileSync('out/ok.txt', '\\uFEFFé\\uFFFD');");
  await assert.rejects(runCase(cs, impl), /out\/raw\.bin is not valid UTF-8/);
  const ok = scratchCase(t, "mkdirSync('out'); writeFileSync('out/ok.txt', '\\uFEFFé\\uFFFD');");
  assert.equal((await runCase(ok.cs, ok.impl)).files['out/ok.txt'], '﻿é�', 'valid UTF-8 (BOM and a literal U+FFFD included) is kept exactly');
});

test('B2-03: an event stdout or stderr that is not valid UTF-8 is refused', async (t) => {
  for (const [stream, re] of [['stdout', /__events__\/0\.stdout is not valid UTF-8/], ['stderr', /__events__\/0\.stderr is not valid UTF-8/]]) {
    const { cs, impl } = scratchCase(t, `process.${stream}.write(Buffer.from([0x41, 0x81, 0x0a]));`, ['out'], stream === 'stdout' ? { captureStdout: true } : {});
    await assert.rejects(runCase(cs, impl), re, stream);
  }
});

// Codex B2-01, end to end: a literal scrub token in a sandbox path would read as a scrubbed real path.
test('B2-01: a sandbox path or link target containing a scrub token literally is refused', async (t) => {
  for (const [body, re] of [
    ["writeFileSync('<HOME>', 'x');", /sandbox path or link target "repo\/<HOME>" contains the scrub token <HOME>/],
    ["symlinkSync('<IMPL>/hooks/x.mjs', 'link');", /"<IMPL>\/hooks\/x\.mjs" contains the scrub token <IMPL>/],
    ["writeFileSync(process.cwd().replace(/[^a-zA-Z0-9]/g, '-'), 'U'); writeFileSync('<REPOKEY>', 'A');", /scrub token <REPOKEY>[\s\S]*scrub collision: sandbox paths "repo\/[^"]+" and "repo\/[^"]+" both record as "repo\/<REPOKEY>"/],
  ]) {
    const { cs, impl } = scratchCase(t, body, []);
    await assert.rejects(runCase(cs, impl), re, body);
  }
});

// B3 park 238 (plan-4 ledger ruling): an output file whose raw content literally holds a scrub token is a replay
// problem, never silently equated with the sandbox path.
test('B3-238: an output file containing a scrub token literally is refused by name', async () => {
  for (const token of ['<REPO>', '<HOME>', '<ROOT>', '<REPOKEY>', '<ROOTKEY>', '<IMPL>']) {
    const d = mkdtempSync(join(tmpdir(), 'ht-tok-'));
    try {
      const impl = join(d, 'impl'); const cs = join(d, 'case');
      mkdirSync(impl); mkdirSync(cs);
      writeFileSync(join(impl, 'w.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync('out.txt', ${JSON.stringify(`see ${token}/x\n`)});\n`);
      writeFileSync(join(cs, 'replay.json'), JSON.stringify({
        id: 'tok', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
        repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: ['out.txt'],
        events: [{ at: '2026-10-01T09:00:00Z', run: 'w.mjs', args: [], stdin: null, env: {} }],
      }));
      await assert.rejects(() => runCase(cs, impl), (e) => e.message.includes(`content contains scrub token ${token}`) && e.message.includes('out.txt'), token);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
});

test('B3-238: a file that holds the real sandbox path (scrubbed to a token) is still fine', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-tok-ok-'));
  try {
    const impl = join(d, 'impl'); const cs = join(d, 'case');
    mkdirSync(impl); mkdirSync(cs);
    writeFileSync(join(impl, 'w.mjs'), "import { writeFileSync } from 'node:fs';\nwriteFileSync('out.txt', process.cwd() + '/x\\n');\n");
    writeFileSync(join(cs, 'replay.json'), JSON.stringify({
      id: 'tok', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs: ['out.txt'],
      events: [{ at: '2026-10-01T09:00:00Z', run: 'w.mjs', args: [], stdin: null, env: {} }],
    }));
    const r = await runCase(cs, impl);
    assert.equal(r.files['out.txt'], '<REPO>/x\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// B3 park 238, fix round 1: the same raw-content refusal for event streams and for the `f:` digests of
// non-output files (the other two observations the harness compares).
const tokenCase = async (script, outputs = []) => {
  const d = mkdtempSync(join(tmpdir(), 'ht-tok2-'));
  try {
    const impl = join(d, 'impl'); const cs = join(d, 'case');
    mkdirSync(impl); mkdirSync(cs);
    writeFileSync(join(impl, 'w.mjs'), script);
    writeFileSync(join(cs, 'replay.json'), JSON.stringify({
      id: 'tok2', seed: 1, identity: { gitUser: 'c', gitEmail: 'c@example.invalid' },
      repo: { path: 'repo', branch: 'main', files: {} }, stores: [], outputs,
      events: [{ at: '2026-10-01T09:00:00Z', run: 'w.mjs', args: [], stdin: null, env: {} }],
    }));
    return await runCase(cs, impl);
  } finally { rmSync(d, { recursive: true, force: true }); }
};

test('B3-238: event stdout and stderr containing a scrub token literally are refused by name', async () => {
  await assert.rejects(() => tokenCase("console.log('at <REPO>/x');"), /__events__\/0\.stdout: content contains scrub token <REPO>/);
  await assert.rejects(() => tokenCase("console.error('at <HOME>/x');"), /__events__\/0\.stderr: content contains scrub token <HOME>/);
  const r = await tokenCase("console.log(process.cwd() + '/x');");
  assert.equal(r.files['__events__/0.stdout'].trim(), '<REPO>/x', 'the real sandbox path still scrubs');
});

test('B3-238: a non-output file whose content holds a scrub token is refused; the real sandbox path is not', async () => {
  const w = (body) => `import { writeFileSync } from 'node:fs';\nwriteFileSync('side.txt', ${body});\n`;
  await assert.rejects(() => tokenCase(w("'see <ROOT>/y'")), /"repo\/side\.txt": content contains scrub token <ROOT>/);
  const r = await tokenCase(w("process.cwd() + '/y'"));
  assert.match(r.files['__sandbox__/changes.txt'], /side\.txt/);
});

test('repo files are materialised with strictly increasing mtimes in manifest order (no same-tick ties on any filesystem)', () => {
  const m = JSON.parse(readFileSync(join(seed, 'replay.json'), 'utf8'));
  const names = ['z.json', 'a/report.json', 'm/n/report.json', 'b.txt'];
  m.repo.files = Object.fromEntries(names.map((n) => [n, '{}']));
  const sb = buildSandbox(seed, m);
  try {
    const t = names.map((n) => statSync(join(sb.repo, n)).mtimeMs);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] > 0.5, `${names[i]} (${t[i]}) is ~1 ms newer than ${names[i - 1]} (${t[i - 1]})`); // Node 18 stores 1 ms as 0.999
    assert.ok(t[t.length - 1] <= Date.now(), 'never in the future');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});
