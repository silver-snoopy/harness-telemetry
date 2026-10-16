import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { snapshotTree, treeChanges, normalizeDiagnostics, gitDirSummary } from './observe.mjs';

// Every temp dir a test makes is removed when that test ends.
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ht-obs-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('treeChanges reports added, modified and deleted files, sorted', (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'keep'), '1'); writeFileSync(join(d, 'mod'), '1'); writeFileSync(join(d, 'gone'), '1');
  const before = snapshotTree(d, { skip: () => false });
  writeFileSync(join(d, 'mod'), '2'); rmSync(join(d, 'gone')); mkdirSync(join(d, 'n')); writeFileSync(join(d, 'n', 'new'), 'x');
  symlinkSync('keep', join(d, 'ln'));
  const lines = treeChanges(before, snapshotTree(d, { skip: () => false }));
  assert.deepEqual(lines.map((l) => JSON.parse(l).slice(0, 2).join(' ')), ['D gone', 'A ln', 'M mod', 'A n/new']);
  assert.equal(lines[1], '["A","ln","l:keep"]');
});

// Codex P3-03 / Reproduction C: a line carries the content digest, not only the path.
test('treeChanges: an addition carries its digest, so different contents give different lines', () => {
  assert.deepEqual(treeChanges(new Map(), new Map([['x', 'f:aaa']])), ['["A","x","f:aaa"]']);
  assert.notDeepEqual(treeChanges(new Map(), new Map([['x', 'f:bbb']])), ['["A","x","f:aaa"]']);
});

test('treeChanges: a modification carries old and new digests', () => {
  assert.deepEqual(treeChanges(new Map([['x', 'f:aaa']]), new Map([['x', 'f:bbb']])), ['["M","x","f:aaa","f:bbb"]']);
});

test('treeChanges: a deletion carries the old digest', () => {
  assert.deepEqual(treeChanges(new Map([['x', 'f:aaa']]), new Map()), ['["D","x","f:aaa"]']);
});

test('treeChanges: a symlink retarget shows both targets', () => {
  assert.deepEqual(treeChanges(new Map([['ln', 'l:a']]), new Map([['ln', 'l:b']])), ['["M","ln","l:a","l:b"]']);
});

// Codex P3P-02 / Reproduction F: records are JSON arrays, so a newline in a link target cannot forge a second record.
test('P3P-02: one link with a newline target is not two links', () => {
  const one = treeChanges(new Map(), new Map([['repo/link', 'l:x\nA repo/rogue l:y']]));
  const two = treeChanges(new Map(), new Map([['repo/link', 'l:x'], ['repo/rogue', 'l:y']]));
  assert.notEqual(one.join('\n'), two.join('\n'));
  assert.deepEqual(one.map((l) => JSON.parse(l)), [['A', 'repo/link', 'l:x\nA repo/rogue l:y']]);
});

test('records round-trip paths with spaces, quotes and arrows', () => {
  const p = 'repo/a "b" c→d';
  const [rec] = treeChanges(new Map([[p, 'f:1']]), new Map([[p, 'f:2']]));
  assert.deepEqual(JSON.parse(rec), ['M', p, 'f:1', 'f:2']);
});

test('snapshotTree: scrub maps each path and link target before it is recorded', (t) => {
  const d = tmp(t);
  mkdirSync(join(d, 'SECRET-dir'));
  symlinkSync(`${d}/SECRET-dir\nA rogue l:y`, join(d, 'SECRET-dir', 'ln'));
  const s = snapshotTree(d, { skip: () => false, scrub: (x) => x.replaceAll(d, '<ROOT>').replaceAll('SECRET', '<S>') });
  assert.deepEqual([...s], [['<S>-dir/ln', 'l:<ROOT>/<S>-dir\nA rogue l:y']]);
});

// Isolated environment for test git calls: no inherited GIT_*, no system/global config, HOME inside the temp dir.
const isoEnv = (home) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });

// A real repository under <d>/<name>; `commits` is a list of { files: {path: content}, date }.
const realRepo = (d, name, commits, branch = 'main') => {
  const w = join(d, name);
  mkdirSync(w);
  const env = isoEnv(d);
  const git = (...a) => execFileSync('git', ['-C', w, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { env, stdio: 'pipe' });
  git('init', '-q', '-b', branch);
  for (const c of commits) {
    for (const [f, content] of Object.entries(c.files)) writeFileSync(join(w, f), content);
    git('add', '-A');
    execFileSync('git', ['-C', w, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'c'],
      { env: { ...env, GIT_AUTHOR_DATE: c.date, GIT_COMMITTER_DATE: c.date }, stdio: 'pipe' });
  }
  return join(w, '.git');
};
const gdig = (g) => snapshotTree(join(g, '..'), { skip: (rel) => rel !== '.git' }).get('.git/');

// Codex P3-03 fix round 1: the digest is branch + commit count + tip tree, never commit ids or dates.
test('a git directory digest: same branch, count and tree with different commit times digest equal', (t) => {
  const d = tmp(t);
  const one = [{ files: { a: '1' }, date: '2026-01-01T00:00:00Z' }, { files: { b: '2' }, date: '2026-01-02T00:00:00Z' }];
  const two = [{ files: { a: '1' }, date: '2025-05-05T05:05:05Z' }, { files: { b: '2' }, date: '2025-06-06T06:06:06Z' }];
  const a = gdig(realRepo(d, 'one', one));
  assert.match(a, /^g:[0-9a-f]{16}$/);
  assert.equal(gdig(realRepo(d, 'two', two)), a);
  assert.notEqual(gdig(realRepo(d, 'extra', [...one, { files: {}, date: '2026-01-03T00:00:00Z' }])), a, 'one extra (empty) commit is seen');
  assert.notEqual(gdig(realRepo(d, 'content', [one[0], { files: { b: '3' }, date: one[1].date }])), a, 'a changed file content is seen');
  assert.notEqual(gdig(realRepo(d, 'branch', one, 'topic')), a, 'a different branch name is seen');
});

test('a git directory digest: packed refs are read like loose ones', (t) => {
  const d = tmp(t);
  const commits = [{ files: { a: '1' }, date: '2026-01-01T00:00:00Z' }];
  const loose = realRepo(d, 'loose', commits);
  const packed = realRepo(d, 'packed', commits);
  execFileSync('git', [`--git-dir=${packed}`, 'pack-refs', '--all'], { env: isoEnv(d), stdio: 'pipe' });
  assert.match(gitDirSummary(packed), /^ref refs\/heads\/main 1$/m);
  assert.equal(gdig(packed), gdig(loose));
});

test('a git directory digest: detached HEAD is distinct', (t) => {
  const d = tmp(t);
  const g = realRepo(d, 'r', [{ files: { a: '1' }, date: '2026-01-01T00:00:00Z' }]);
  const attached = gdig(g);
  const id = execFileSync('git', [`--git-dir=${g}`, 'rev-parse', 'HEAD'], { env: isoEnv(d), encoding: 'utf8' }).trim();
  writeFileSync(join(g, 'HEAD'), `${id}\n`);
  assert.match(gitDirSummary(g), /^HEAD detached$/m);
  assert.notEqual(gdig(g), attached);
});

test('a directory shaped like a git dir that git cannot summarise is walked as ordinary files, not collapsed', (t) => {
  const d = tmp(t);
  const bad = join(d, 'bad');
  mkdirSync(join(bad, 'objects'), { recursive: true }); writeFileSync(join(bad, 'HEAD'), 'garbage'); writeFileSync(join(bad, 'objects', 'note.txt'), 'inside');
  const s = snapshotTree(d, { skip: () => false });
  assert.equal(s.has('bad/'), false);
  assert.match(s.get('bad/HEAD'), /^f:[0-9a-f]{16}$/);
  const changes = treeChanges(new Map(), s);
  assert.ok(changes.some((l) => l.startsWith('["A","bad/objects/note.txt","f:')), changes.join('\n'));
});

test('a git directory summary degrades per ref: a tag of a blob is unavailable, the rest stands', (t) => {
  const d = tmp(t);
  const g = realRepo(d, 'r', [{ files: { a: '1' }, date: '2026-01-01T00:00:00Z' }]);
  const blob = execFileSync('git', [`--git-dir=${g}`, 'hash-object', '-w', join(d, 'r', 'a')], { env: isoEnv(d), encoding: 'utf8' }).trim();
  execFileSync('git', [`--git-dir=${g}`, 'tag', 'blobtag', blob], { env: isoEnv(d), stdio: 'pipe' });
  const sum = gitDirSummary(g);
  assert.notEqual(sum, null);
  assert.match(sum, /^ref refs\/tags\/blobtag unavailable$/m);
  assert.match(sum, /^ref refs\/heads\/main 1$/m);
  assert.match(sum, /^tree refs\/heads\/main 100644 blob [0-9a-f]+\ta$/m);
  assert.match(gdig(g), /^g:[0-9a-f]{16}$/);
});

test('snapshotTree: normalise maps file bytes before hashing', (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'x'), `path ${d}/y`);
  const n = (b) => Buffer.from(b.toString('utf8').replaceAll(d, '<ROOT>'));
  const e = tmp(t);
  writeFileSync(join(e, 'x'), `path ${e}/y`);
  const ne = (b) => Buffer.from(b.toString('utf8').replaceAll(e, '<ROOT>'));
  assert.equal(snapshotTree(d, { skip: () => false, normalise: n }).get('x'), snapshotTree(e, { skip: () => false, normalise: ne }).get('x'));
  assert.notEqual(snapshotTree(d, { skip: () => false }).get('x'), snapshotTree(e, { skip: () => false }).get('x'));
});

test('a git directory collapses to one entry; skip() hides a subtree', (t) => {
  const d = tmp(t);
  execFileSync('git', ['init', '-q', '-b', 'main', '--bare', join(d, 'g')], { env: isoEnv(d), stdio: 'pipe' });
  mkdirSync(join(d, 'out')); writeFileSync(join(d, 'out', 'f'), '1');
  const s = snapshotTree(d, { skip: (rel) => rel === 'out' });
  assert.deepEqual([...s.keys()], ['g/']);
  assert.match(s.get('g/'), /^g:/);
});

test('normalizeDiagnostics drops Node warnings and stack frames, keeps the message', () => {
  const raw = [
    '(node:4242) ExperimentalWarning: something is experimental',
    '(Use `node --trace-warnings ...` to show where the warning was created)',
    'file:///x/scripts/a.mjs:12',
    '  throw new Error(\'boom\');',
    '  ^',
    '',
    'Error: boom',
    '    at main (file:///x/scripts/a.mjs:12:9)',
    '    at file:///x/scripts/a.mjs:20:1',
    '',
  ].join('\n');
  assert.equal(normalizeDiagnostics(raw, { stream: 'stderr' }), '<uncaught-at>\n\nError: boom\n    at <frame>\n');
  assert.equal(normalizeDiagnostics('plain message\n', { stream: 'stderr' }), 'plain message\n');
});

// Final review F4.
test('normalizeDiagnostics drops the Node.js version trailer (stderr)', () => {
  const raw = 'Error: boom\n    at file:///x/a.mjs:1:7\n\nNode.js v18.19.0\n';
  assert.equal(normalizeDiagnostics(raw, { stream: 'stderr' }), 'Error: boom\n    at <frame>\n\n');
  assert.equal(normalizeDiagnostics('Node.js v24.3.1', { stream: 'stderr' }), '');
  assert.equal(normalizeDiagnostics('Node.js version notes\n', { stream: 'stderr' }), 'Node.js version notes\n', 'only a real version trailer');
});

test('normalizeDiagnostics collapses a run of frames into one line, whatever the frame count', () => {
  const frames = (n) => Array.from({ length: n }, (_, i) => `    at f${i} (node:internal/x:${i + 1}:2)`).join('\n');
  const a = normalizeDiagnostics(`Error: x\n${frames(3)}\nnext\n${frames(1)}\n`, { stream: 'stderr' });
  const b = normalizeDiagnostics(`Error: x\n${frames(9)}\nnext\n${frames(2)}\n`, { stream: 'stderr' });
  assert.equal(a, 'Error: x\n    at <frame>\nnext\n    at <frame>\n');
  assert.equal(b, a);
});

test('normalizeDiagnostics matches only real V8 frame shapes', () => {
  const frame = (l) => normalizeDiagnostics(l, { stream: 'stderr' }) === '    at <frame>';
  for (const l of [
    '    at main (file:///x/scripts/a.mjs:12:9)',
    '    at file:///x/scripts/a.mjs:20:1',
    '    at Module._compile (node:internal/modules/cjs/loader:1256:14)',
    '    at node:internal/main/run_main_module:28:49',
    '    at Object.<anonymous> (/x/scripts/a.js:3:9)',
    '    at /x/scripts/a.js:3:9',
    '    at new Ledger (file:///x/lib/l.mjs:4:11)',
    '    at async Promise.all (index 0)',
    '    at Array.forEach (<anonymous>)',
    '    at <anonymous>',
    '    at JSON.parse (<anonymous>)',
    '    at run (C:\\x\\a.mjs:1:2)',
    '\tat main (/x/a.mjs:1:2)',
  ]) assert.ok(frame(l), l);
  for (const l of [
    '    at least one dispatch was skipped',
    '    at 10:00 the batch closed',
    '    at main (file:///x/a.mjs)',
    '    at main (somewhere:1:2)',
    'at main (/x/a.mjs:1:2)',
    '    at new things',
  ]) assert.ok(!frame(l), l);
});

test('normalizeDiagnostics leaves stdout "at" lines alone', () => {
  const text = 'report:\n    at main (/x/a.mjs:1:2)\n    at least one\n';
  assert.equal(normalizeDiagnostics(text, { stream: 'stdout' }), text);
  assert.equal(normalizeDiagnostics(text), text, 'stdout is the default');
  assert.equal(normalizeDiagnostics('Node.js v18.19.0\n', { stream: 'stdout' }), 'Node.js v18.19.0\n');
});

test('normalizeDiagnostics: node: internal async frames and bare async <anonymous> frames become `    at <frame>`', () => {
  const se = { stream: 'stderr' };
  assert.equal(normalizeDiagnostics('Error: boom\n    at async node:internal/modules/esm/loader:1:1\n', se), 'Error: boom\n    at <frame>\n');
  assert.equal(normalizeDiagnostics('Error: boom\n    at async <anonymous>\n', se), 'Error: boom\n    at <frame>\n');
});

test('normalizeDiagnostics normalises anonymous and named async frames (stderr only)', () => {
  const se = { stream: 'stderr' };
  assert.equal(normalizeDiagnostics('Error: boom\n    at async file:///impl/a.mjs:15:4\n    at async file:///impl/a.mjs:2:1\n', se), 'Error: boom\n    at <frame>\n');
  assert.equal(normalizeDiagnostics('Error: boom\n    at async Promise.all (index 0)\n', se), 'Error: boom\n    at <frame>\n');
  assert.equal(normalizeDiagnostics('Error: boom\n    at async main (file:///impl/a.mjs:3:9)\n', se), 'Error: boom\n    at <frame>\n');
  assert.equal(normalizeDiagnostics('note\n    at async something here\n', se), 'note\n    at async something here\n', 'not any indented at-text');
  const raw = 'Error: boom\n    at async file:///impl/a.mjs:15:4\n';
  assert.equal(normalizeDiagnostics(raw), raw, 'stdout untouched');
});

// Codex B2-01: two distinct raw paths that scrub to one key are a collision, never a silent overwrite.
test('B2-01: snapshotTree refuses two raw paths that scrub to one key (default throws; onCollision records)', (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'TOKEN'), 'approved'); writeFileSync(join(d, 'real-path'), 'undeclared');
  const scrub = (s) => s.replaceAll('real-path', 'TOKEN');
  assert.throws(() => snapshotTree(d, { skip: () => false, scrub }), /scrub collision: sandbox paths "TOKEN" and "real-path" both record as "TOKEN"/);
  const seen = [];
  const snap = snapshotTree(d, { skip: () => false, scrub, onCollision: (...a) => seen.push(a) });
  assert.deepEqual(seen, [['TOKEN', 'TOKEN', 'real-path']]);
  assert.deepEqual([...snap.keys()], ['TOKEN'], 'the first entry is kept, not overwritten');
  assert.equal(snapshotTree(d, { skip: () => false }).size, 2, 'no scrub: no collision');
});

// B3 park 38 (plan-4 ledger Task 2) and Codex B3-01 (R20): a committed path with a double quote is summarised as it
// always was; a path with a control character or a backslash is escaped as a JSON string literal, so it never spans lines.
test('B3-38: gitDirSummary lists a committed path containing a quote or a newline exactly', (t) => {
  const d = tmp(t);
  const g = realRepo(d, 'r', [{ files: { 'a\nb': '1', 'q"x': '2', 'plain': '3' }, date: '2026-01-01T00:00:00Z' }]);
  const sum = gitDirSummary(g);
  assert.notEqual(sum, null);
  const trees = sum.split('\n').filter((l) => l.startsWith('tree '));
  assert.equal(trees.length, 3, 'one line per committed path, even one holding a newline');
  assert.ok(trees.some((l) => l.endsWith('\t"a\\nb"')), JSON.stringify(sum));
  assert.ok(trees.some((l) => l.endsWith('\tq"x')), 'an ordinary path (even with a quote) is serialised as it always was');
  assert.ok(trees.some((l) => l.endsWith('\tplain')));
  assert.equal(sum.split('\n').length, 5, 'HEAD, ref, three trees: no stray line');
});

test('B3-01: gitDirSummary escapes control characters and backslashes, and nothing else', (t) => {
  const d = tmp(t);
  const g = realRepo(d, 'r', [{ files: { 'a\tb': '1', 'c\\d': '2', 'e f': '3', 'café': '4' }, date: '2026-01-01T00:00:00Z' }]);
  const paths = gitDirSummary(g).split('\n').filter((l) => l.startsWith('tree ')).map((l) => l.slice(l.indexOf('\t') + 1));
  assert.deepEqual(paths.sort(), ['"a\\tb"', '"c\\\\d"', 'café', 'e f'].sort());
});

// Codex B3-01 reproduction A: two distinct committed trees must not summarise alike.
test('B3-01: a path that embeds a second tree record does not alias two committed entries', (t) => {
  const d = tmp(t);
  const env = isoEnv(d);
  const bare = (name, namesFor) => {
    const store = join(d, name);
    const run = (a, input) => execFileSync('git', [`--git-dir=${store}`, ...a], { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', store], { env });
    const blob = run(['hash-object', '-w', '--stdin'], 'same bytes');
    for (const n of namesFor(blob)) run(['update-index', '--add', '--cacheinfo', `100644,${blob},${n}`]);
    const tree = run(['write-tree']);
    const commit = execFileSync('git', [`--git-dir=${store}`, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit-tree', tree, '-m', 'one'], { env, encoding: 'utf8' }).trim();
    run(['update-ref', 'refs/heads/main', commit]);
    return store;
  };
  const two = bare('two', () => ['a', 'b']);
  const crafted = bare('crafted', (blob) => [`a\ntree refs/heads/main 100644 blob ${blob}\tb`]);
  assert.notEqual(gitDirSummary(crafted), gitDirSummary(two), 'the crafted tree summarises differently from the two-file tree');
});
