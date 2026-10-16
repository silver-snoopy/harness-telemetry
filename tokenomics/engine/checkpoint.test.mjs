// Tests for the verified checkpoint (Plan 5 Task 6, D-CKPT, spec §18.5). Every git call is isolated: an empty
// temp GIT_CONFIG_GLOBAL, no system config, file protocol only, and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { takeCheckpoint, CheckpointError } from './checkpoint.mjs';
import { INNER_GITIGNORE } from './substrate.mjs';

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'ht-ckpt-')));
const gitconfig = join(sandbox, 'gitconfig');
writeFileSync(gitconfig, '');
// The real git binary lives in its exec-path; on macOS /usr/bin/git is an xcrun shim costing ~0.2 s per spawn.
const PATH = `${execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()}${delimiter}${process.env.PATH}`;
const BASE = { ...process.env, PATH, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file' };
for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_TRACE', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete BASE[k];
// The checkpoint module inherits these too when a test passes no env.
Object.assign(process.env, { PATH, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file' });
const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const ENV = { ...BASE, ...ID };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const SETTINGS = {};
let n = 0;

/** A main repo with one commit on `main`. */
function mainRepo() {
  const repo = join(sandbox, `repo ${++n}`); // a space in the path, on purpose
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  put(repo, 'README.md', 'host\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

/** The submodule form (spec §2): an orphan `telemetry` branch checked out at .agents/telemetry, url ./. */
function submoduleRepo(files = { 'automation/usage-a.jsonl': '{"a":1}\n' }) {
  const repo = mainRepo();
  git(repo, 'checkout', '-q', '--orphan', 'telemetry');
  git(repo, 'rm', '-rq', '--cached', '.');
  rmSync(join(repo, 'README.md'));
  for (const [rel, text] of Object.entries(files)) put(repo, rel, text);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'telemetry: seed');
  for (const rel of Object.keys(files)) rmSync(join(repo, rel));
  for (const d of new Set(Object.keys(files).map((r) => r.split('/')[0]))) rmSync(join(repo, d), { recursive: true, force: true });
  git(repo, 'checkout', '-q', 'main');
  git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', '-b', 'telemetry', '--', './', '.agents/telemetry');
  git(repo, 'config', '-f', '.gitmodules', 'submodule..agents/telemetry.ignore', 'all');
  git(repo, 'add', '.gitmodules');
  git(repo, 'commit', '-q', '-m', 'telemetry submodule');
  return { repo, store: join(repo, '.agents', 'telemetry') };
}

/** The plain-folder form: .agents/telemetry is an ordinary directory of the main tree. */
function plainRepo() {
  const repo = mainRepo();
  put(repo, '.agents/telemetry/automation/usage-a.jsonl', '{"a":1}\n');
  return { repo, store: join(repo, '.agents', 'telemetry') };
}

const files = (root, rel = '') => {
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.name === '.git') continue;
    if (e.isDirectory()) out.push(...files(root, r)); else out.push(r);
  }
  return out.sort();
};
const tagFiles = (cwd, tag) => git(cwd, 'ls-tree', '-r', '--name-only', tag).split('\n').filter(Boolean).sort();
const show = (cwd, spec) => execFileSync('git', ['show', spec], { cwd, env: ENV }).toString();
const isMarker = (rel) => /(^|\/)\.(pending|nagged|unclosed)-/.test(rel);
const indexBytes = (repo) => readFileSync(join(repo, '.git', 'index'));

test('(a) dirty store: modified and untracked ledgers are committed and tagged, markers are not', () => {
  const { repo, store } = submoduleRepo({ 'automation/usage-a.jsonl': '{"a":1}\n', 'automation/scopes/s1.json': '{}\n' });
  put(store, 'automation/usage-a.jsonl', '{"a":1}\n{"a":2}\n'); // modified tracked ledger
  put(store, 'automation/usage-b.jsonl', '{"b":1}\n'); // untracked new ledger
  put(store, 'automation/scopes/.pending-x', 'x'); // transient marker
  put(store, 'automation/scopes/.nagged-y', 'y');
  put(store, '.unclosed-z', 'z');
  put(store, 'automation/scopes/pending-1.json', '{"durable":true}\n'); // durable pending record: data
  const before = git(store, 'rev-parse', 'refs/heads/telemetry');
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV });
  assert.equal(r.tag, 'pre-engine-0.4.0');
  assert.equal(r.reused, false);
  assert.equal(git(store, 'rev-parse', 'refs/tags/pre-engine-0.4.0^{commit}'), r.commit);
  assert.equal(git(store, 'rev-parse', 'refs/heads/telemetry'), r.commit, 'committed on the telemetry branch');
  assert.equal(git(store, 'rev-parse', `${r.commit}^`), before, 'the checkpoint extends the store history');
  const names = tagFiles(store, r.tag);
  for (const f of ['automation/usage-a.jsonl', 'automation/usage-b.jsonl', 'automation/scopes/s1.json', 'automation/scopes/pending-1.json']) assert.ok(names.includes(f), f);
  assert.equal(names.filter(isMarker).length, 0, `no marker in ${names}`);
  assert.equal(show(store, `${r.tag}:automation/usage-a.jsonl`), '{"a":1}\n{"a":2}\n');
  assert.ok(existsSync(join(store, 'automation/scopes/.pending-x')), 'the marker stays on disk');
  const record = JSON.parse(show(store, `${r.tag}:.checkpoints/pre-engine-0.4.0/checkpoint.json`));
  assert.equal(record.version, '0.4.0');
  assert.equal(record.mainTreeCommit, git(repo, 'rev-parse', 'HEAD'));
  assert.ok(!Number.isNaN(Date.parse(record.at)));
  assert.deepEqual(record.copied, []);
  // The store's own checkout agrees with its branch: only the markers remain outside it.
  const status = git(store, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
  assert.deepEqual(status.map((l) => l.slice(3)).sort(), ['.unclosed-z', 'automation/scopes/.nagged-y', 'automation/scopes/.pending-x']);
});

test('(a2) ignored working state stays off the branch: live/ and module-ignored files are left out, a durable untracked ledger is kept, a tracked live/ file is never dropped (B3 final review I1)', () => {
  const { repo, store } = submoduleRepo({ 'automation/usage-a.jsonl': 'a\n', 'automation/live/tracked.jsonl': 'old\n', 'delivery/.gitignore': '.cache/\n' });
  put(store, '.gitignore', INNER_GITIGNORE); // the store's own rules (the substrate seed)
  git(store, 'add', '.gitignore');
  git(store, 'commit', '-q', '-m', 'ignore rules');
  put(store, 'automation/live/s1.jsonl', '{"live":1}\n'); // an in-flight session: ignored working state
  put(store, 'delivery/.cache/x', 'cache\n'); // ignored by the module's own .gitignore
  put(store, 'automation/usage-b.jsonl', '{"b":1}\n'); // an untracked durable ledger
  put(store, 'automation/live/tracked.jsonl', 'old\nnew\n'); // tracked in the parent, though now ignored
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV });
  const names = tagFiles(store, r.tag);
  assert.ok(!names.includes('automation/live/s1.jsonl'), 'an ignored live/ file is not committed');
  assert.ok(!names.includes('delivery/.cache/x'), 'a module-ignored file is not committed');
  assert.ok(names.includes('automation/usage-b.jsonl'), 'an untracked durable ledger is committed');
  assert.equal(show(store, `${r.tag}:automation/live/tracked.jsonl`), 'old\nnew\n', 'a path tracked in the parent is never dropped');
  const tracked = git(store, 'ls-files').split('\n');
  assert.ok(!tracked.includes('automation/live/s1.jsonl') && !tracked.includes('delivery/.cache/x'), 'still untracked afterwards');
  put(store, 'automation/live/s1.jsonl', '{"live":1}\n{"live":2}\n');
  assert.doesNotMatch(git(store, 'status', '--porcelain'), /s1\.jsonl|\.cache/, 'a later append does not show as a change');
});

test('(f2) plain-folder form: <module>/live/ and the markers are left out (B3 final review I1)', () => {
  const { repo, store } = plainRepo();
  put(store, 'automation/live/s1.jsonl', '{"live":1}\n');
  put(store, 'automation/scopes/.pending-x', 'x');
  put(store, 'automation/usage-b.jsonl', '{"b":1}\n');
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'plain-folder', wrappers: [], env: ENV });
  const names = tagFiles(repo, r.tag);
  assert.ok(!names.includes('automation/live/s1.jsonl'), names.join(','));
  assert.equal(names.filter(isMarker).length, 0);
  assert.ok(names.includes('automation/usage-b.jsonl') && names.includes('automation/usage-a.jsonl'));
});

test('(b) offline: no remote, and an unreachable remote, both succeed without a fetch or push', () => {
  for (const remote of [null, 'file:///nonexistent']) {
    const { repo, store } = submoduleRepo();
    if (remote) { git(repo, 'config', 'remote.origin.url', remote); git(store, 'config', 'remote.origin.url', remote); }
    put(store, 'automation/usage-b.jsonl', '{"b":1}\n');
    const trace = join(sandbox, `trace-${n}.log`);
    const r = takeCheckpoint(repo, SETTINGS, { version: '1.0.0', form: 'submodule', wrappers: [], env: { ...ENV, GIT_TRACE: trace } });
    assert.equal(r.reused, false);
    const log = readFileSync(trace, 'utf8');
    assert.match(log, /trace: (built-in|exec): git/, 'the trace recorded the git calls');
    assert.doesNotMatch(log, /\b(fetch|push|ls-remote|remote-\w+|upload-pack|receive-pack)\b/, `network-shaped git call in:\n${log}`);
    const pf = plainRepo();
    if (remote) git(pf.repo, 'config', 'remote.origin.url', remote);
    const trace2 = join(sandbox, `trace-${n}-plain.log`);
    takeCheckpoint(pf.repo, SETTINGS, { version: '1.0.0', form: 'plain-folder', wrappers: [], env: { ...ENV, GIT_TRACE: trace2 } });
    assert.doesNotMatch(readFileSync(trace2, 'utf8'), /\b(fetch|push|ls-remote|remote-\w+|upload-pack|receive-pack)\b/);
  }
});

test('(c) main tree: a clean tracked file is named by mainTreeCommit; uncommitted and untracked files are copied', () => {
  const { repo, store } = submoduleRepo();
  put(repo, '.agents/tokenomics/settings.json', '{"dir":"x"}\n');
  git(repo, 'add', '.agents/tokenomics/settings.json');
  git(repo, 'commit', '-q', '-m', 'settings');
  const head = git(repo, 'rev-parse', 'HEAD');
  const wrapper = '.github/hooks/tokenomics.json';
  const r1 = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [wrapper, '.claude/settings.json'], env: ENV });
  const rec1 = JSON.parse(show(store, `${r1.tag}:.checkpoints/pre-engine-0.4.0/checkpoint.json`));
  assert.equal(rec1.mainTreeCommit, head);
  assert.deepEqual(rec1.copied, []);
  assert.deepEqual(r1.copied, []);
  assert.equal(tagFiles(store, r1.tag).filter((f) => f.includes('main-tree/')).length, 0, 'a clean tracked file is not copied');

  put(repo, '.agents/tokenomics/settings.json', '{"dir":"y"}\n'); // uncommitted edit
  put(repo, wrapper, '{"hooks":{}}\n'); // untracked wrapper
  put(repo, '.agents/tokenomics/notes/extra.txt', 'untracked\n');
  const idx = indexBytes(repo);
  const r2 = takeCheckpoint(repo, SETTINGS, { version: '0.5.0', form: 'submodule', wrappers: [wrapper, '.claude/settings.json'], env: ENV });
  assert.deepEqual(indexBytes(repo), idx, "the operator's index is untouched");
  const expected = ['.agents/tokenomics/notes/extra.txt', '.agents/tokenomics/settings.json', wrapper];
  assert.deepEqual(r2.copied, expected);
  const rec2 = JSON.parse(show(store, `${r2.tag}:.checkpoints/pre-engine-0.5.0/checkpoint.json`));
  assert.deepEqual(rec2.copied, expected);
  assert.equal(rec2.mainTreeCommit, head);
  const base = '.checkpoints/pre-engine-0.5.0/main-tree';
  assert.equal(show(store, `${r2.tag}:${base}/.agents/tokenomics/settings.json`), '{"dir":"y"}\n');
  assert.equal(show(store, `${r2.tag}:${base}/${wrapper}`), '{"hooks":{}}\n');
  // A staged-only change is uncommitted too.
  put(repo, '.agents/tokenomics/settings.json', '{"dir":"x"}\n');
  rmSync(join(repo, wrapper)); rmSync(join(repo, '.agents/tokenomics/notes'), { recursive: true });
  put(repo, '.agents/tokenomics/settings.json', '{"dir":"z"}\n');
  git(repo, 'add', '.agents/tokenomics/settings.json');
  put(repo, '.agents/tokenomics/settings.json', '{"dir":"x"}\n'); // worktree equals HEAD, index does not
  const r3 = takeCheckpoint(repo, SETTINGS, { version: '0.6.0', form: 'submodule', wrappers: [wrapper], env: ENV });
  assert.deepEqual(r3.copied, ['.agents/tokenomics/settings.json']);
});

test('(c2) a git-ignored or *.local.json file in scope is never committed to the store: it is copied beside the bundle and recorded as localCopies (B3 final review I2)', () => {
  for (const form of ['submodule', 'plain-folder']) {
    const { repo, store } = form === 'submodule' ? submoduleRepo() : plainRepo();
    put(repo, '.gitignore', '.claude/settings.local.json\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-q', '-m', 'ignore local settings');
    const secret = '{"env":{"SECRET":"x"}}\n';
    put(repo, '.claude/settings.local.json', secret); // ignored by the main repo
    put(repo, '.claude/extra.local.json', '{"local":true}\n'); // not ignored, but named *.local.json
    put(repo, '.github/hooks/tokenomics.json', '{"hooks":{}}\n'); // an ordinary untracked wrapper
    const wrappers = ['.claude/settings.local.json', '.claude/extra.local.json', '.github/hooks/tokenomics.json'];
    const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form, wrappers, env: ENV });
    const where = form === 'submodule' ? store : repo;
    const names = tagFiles(where, r.tag);
    const base = '.checkpoints/pre-engine-0.4.0';
    assert.ok(!names.some((f) => f.startsWith(`${base}/main-tree/.claude/`)), `${form}: no local file on the branch: ${names}`);
    assert.ok(names.includes(`${base}/main-tree/.github/hooks/tokenomics.json`), `${form}: an ordinary wrapper is still committed`);
    const record = JSON.parse(show(where, `${r.tag}:${base}/checkpoint.json`));
    assert.deepEqual(record.copied, ['.github/hooks/tokenomics.json']);
    assert.deepEqual(record.localCopies, ['.claude/extra.local.json', '.claude/settings.local.json']);
    assert.deepEqual(r.localCopies, record.localCopies);
    const local = join(dirname(r.bundle), 'pre-engine-0.4.0', 'main-tree');
    assert.equal(readFileSync(join(local, '.claude/settings.local.json'), 'utf8'), secret, 'byte for byte beside the bundle');
    assert.equal(readFileSync(join(local, '.claude/extra.local.json'), 'utf8'), '{"local":true}\n');
    if (form === 'submodule') assert.ok(!existsSync(join(store, base, 'main-tree', '.claude')), 'not in the store checkout either');
    const again = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form, wrappers, env: ENV });
    assert.equal(again.reused, true);
    assert.deepEqual(again.localCopies, record.localCopies);
  }
});

test('(d) bundle: under <git-common-dir>/tokenomics/, verifies, and a clone restores the tagged tree byte-for-byte', () => {
  const { repo, store } = submoduleRepo({ 'automation/usage-a.jsonl': '{"a":1}\n', 'delivery/state.json': '{"s":1}\n' });
  put(store, 'automation/usage-b.jsonl', 'b\r\nbinary\0bytes\n');
  put(store, 'automation/scopes/.pending-q', 'q');
  put(repo, '.agents/tokenomics/settings.json', '{"engine":"0.3.0"}\n');
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0-rc.1', form: 'submodule', wrappers: [], env: ENV });
  const common = realpathSync(join(repo, git(repo, 'rev-parse', '--git-common-dir')));
  assert.equal(r.bundle, join(common, 'tokenomics', 'pre-engine-0.4.0-rc.1.bundle'));
  assert.ok(existsSync(r.bundle));
  git(store, 'bundle', 'verify', '-q', r.bundle);
  const out = join(sandbox, `clone-${n}`);
  git(sandbox, 'clone', '-q', '--no-checkout', r.bundle, out);
  git(out, 'checkout', '-q', '--detach', r.tag);
  assert.equal(git(out, 'rev-parse', 'HEAD'), r.commit);
  const onDisk = files(store).filter((f) => !isMarker(f));
  assert.deepEqual(files(out), onDisk, 'the clone holds exactly the store minus the markers');
  for (const f of onDisk) assert.deepEqual(readFileSync(join(out, f)), readFileSync(join(store, f)), f);
  assert.equal(readFileSync(join(out, '.checkpoints/pre-engine-0.4.0-rc.1/main-tree/.agents/tokenomics/settings.json'), 'utf8'), '{"engine":"0.3.0"}\n');
});

test('(e) re-run: the same version is reused and the tag never moves; a missing bundle is named with its remedy', () => {
  const { repo, store } = submoduleRepo();
  const r1 = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV });
  put(store, 'automation/usage-c.jsonl', '{"c":1}\n');
  const r2 = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV });
  assert.equal(r2.reused, true);
  assert.equal(r2.commit, r1.commit);
  assert.equal(r2.tag, r1.tag);
  assert.equal(r2.bundle, r1.bundle);
  assert.deepEqual(r2.copied, r1.copied);
  assert.equal(git(store, 'rev-parse', 'refs/tags/pre-engine-0.4.0'), r1.commit);
  assert.equal(git(store, 'rev-parse', 'refs/heads/telemetry'), r1.commit, 'no new checkpoint commit on reuse');

  rmSync(r1.bundle);
  assert.throws(() => takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV }), (e) => {
    assert.ok(e instanceof CheckpointError);
    assert.equal(e.code, 'checkpoint-bundle-missing');
    assert.match(e.message, /checkpoint-bundle-missing/);
    assert.ok(e.message.includes(r1.bundle), 'names the bundle path');
    assert.match(e.message, /restore the bundle/);
    assert.match(e.message, /delete the tag/);
    assert.match(e.message, /tag -d pre-engine-0\.4\.0/);
    return true;
  });
  assert.equal(git(store, 'rev-parse', 'refs/tags/pre-engine-0.4.0'), r1.commit, 'the tag never moves');

  writeFileSync(r1.bundle, 'not a bundle\n');
  assert.throws(() => takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV }),
    (e) => e instanceof CheckpointError && e.code === 'checkpoint-bundle-invalid' && /restore the bundle/.test(e.message));
  assert.equal(git(store, 'rev-parse', 'refs/tags/pre-engine-0.4.0'), r1.commit);

  // A valid bundle of a different commit is not this checkpoint's bundle.
  const other = takeCheckpoint(repo, SETTINGS, { version: '0.9.0', form: 'submodule', wrappers: [], env: ENV });
  writeFileSync(r1.bundle, readFileSync(other.bundle));
  assert.throws(() => takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV }),
    (e) => e instanceof CheckpointError && e.code === 'checkpoint-bundle-invalid');
  assert.equal(git(store, 'rev-parse', 'refs/tags/pre-engine-0.4.0'), r1.commit);
});

test('(e2) orphaned bundle: tag absent but bundle present is refused, writing nothing', () => {
  const { repo, store } = submoduleRepo();
  const r1 = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV });
  const before = readFileSync(r1.bundle);
  const head = git(store, 'rev-parse', 'refs/heads/telemetry');
  git(store, 'tag', '-d', 'pre-engine-0.4.0');
  put(store, 'automation/usage-d.jsonl', '{"d":1}\n');
  assert.throws(() => takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV }), (e) => {
    assert.ok(e instanceof CheckpointError);
    assert.equal(e.code, 'checkpoint-bundle-orphaned');
    assert.ok(e.message.includes(r1.bundle), 'names the bundle path');
    assert.match(e.message, /fetch .*refs\/tags\/pre-engine-0\.4\.0:refs\/tags\/pre-engine-0\.4\.0/);
    assert.match(e.message, /move the bundle aside/);
    return true;
  });
  assert.ok(readFileSync(r1.bundle).equals(before), 'bundle bytes unchanged');
  assert.equal(git(store, 'tag', '--list', 'pre-engine-*'), '', 'no tag created');
  assert.equal(git(store, 'rev-parse', 'refs/heads/telemetry'), head, 'no commit created');
  assert.deepEqual(readdirSync(dirname(r1.bundle)).filter((f) => f.includes('partial')), []);
});

test('(f) plain-folder form: an orphan refs/tokenomics/store holds the store; the main tree and index are untouched', () => {
  const { repo, store } = plainRepo();
  put(store, 'automation/scopes/.pending-x', 'x');
  put(store, 'delivery/state.json', '{"s":1}\n');
  put(repo, '.agents/tokenomics/settings.json', '{"dir":"y"}\n');
  put(repo, 'tracked.txt', 'one\n'); git(repo, 'add', 'tracked.txt'); git(repo, 'commit', '-q', '-m', 'tracked');
  put(repo, 'tracked.txt', 'two\n'); // an operator edit in flight
  put(repo, 'staged.txt', 'staged\n'); git(repo, 'add', 'staged.txt');
  const porcelain = () => git(repo, 'status', '--porcelain', '--untracked-files=all');
  const before = porcelain();
  const idx = indexBytes(repo);
  const headBefore = git(repo, 'rev-parse', 'HEAD');
  const listing = files(repo);
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'plain-folder', wrappers: ['.github/hooks/tokenomics.json'], env: ENV });
  assert.deepEqual(indexBytes(repo), idx, "the operator's index is byte-identical");
  assert.equal(porcelain(), before);
  assert.deepEqual(files(repo), listing, 'nothing written to the main working tree');
  assert.equal(git(repo, 'rev-parse', 'HEAD'), headBefore);
  assert.equal(git(repo, 'rev-parse', 'refs/tokenomics/store'), r.commit);
  assert.equal(git(repo, 'rev-list', '--count', r.commit), '1', 'an orphan history');
  assert.equal(git(repo, 'rev-parse', 'refs/tags/pre-engine-0.4.0'), r.commit);
  assert.ok(existsSync(r.bundle));
  git(repo, 'bundle', 'verify', '-q', r.bundle);
  const names = tagFiles(repo, r.tag);
  assert.ok(names.includes('automation/usage-a.jsonl'));
  assert.ok(names.includes('delivery/state.json'));
  assert.ok(names.includes('.checkpoints/pre-engine-0.4.0/checkpoint.json'));
  assert.ok(names.includes('.checkpoints/pre-engine-0.4.0/main-tree/.agents/tokenomics/settings.json'));
  assert.equal(names.filter(isMarker).length, 0);
  assert.deepEqual(r.copied, ['.agents/tokenomics/settings.json']);
  // A later version extends the same orphan history; the old tag stays.
  put(store, 'automation/usage-b.jsonl', 'b\n');
  const before2 = porcelain();
  const r2 = takeCheckpoint(repo, SETTINGS, { version: '0.5.0', form: 'plain-folder', wrappers: [], env: ENV });
  assert.equal(git(repo, 'rev-parse', `${r2.commit}^`), r.commit);
  assert.equal(git(repo, 'rev-parse', 'refs/tags/pre-engine-0.4.0'), r.commit);
  assert.equal(porcelain(), before2);
  assert.ok(tagFiles(repo, r2.tag).includes('automation/usage-b.jsonl'));
  const again = takeCheckpoint(repo, SETTINGS, { version: '0.5.0', form: 'plain-folder', wrappers: [], env: ENV });
  assert.equal(again.reused, true);
  assert.equal(git(repo, 'rev-parse', 'refs/tokenomics/store'), r2.commit);
});

test('(g) a store holding another module (delivery/) is fully in the checkpoint', () => {
  const { repo, store } = submoduleRepo({ 'automation/usage-a.jsonl': 'a\n', 'delivery/module.json': '{"module":"delivery"}\n', 'delivery/events/2026-10.jsonl': 'e\n' });
  put(store, 'delivery/events/2026-11.jsonl', 'new\n');
  put(store, 'delivery/deep/nested/x.json', '{}\n');
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV });
  const names = tagFiles(store, r.tag);
  for (const f of ['delivery/module.json', 'delivery/events/2026-10.jsonl', 'delivery/events/2026-11.jsonl', 'delivery/deep/nested/x.json']) assert.ok(names.includes(f), f);
});

test('(h) a failed checkpoint leaves no half-written .checkpoints/pre-engine-<v> in the store checkout (B3 final review M11)', () => {
  if (process.getuid?.() === 0) return;
  const { repo, store } = submoduleRepo();
  put(repo, '.agents/tokenomics/settings.json', '{"dir":"x"}\n'); // untracked: copied into the record
  const unreadable = join(store, 'automation/locked.jsonl');
  put(store, 'automation/locked.jsonl', 'x\n');
  chmodSync(unreadable, 0o000);
  try {
    assert.throws(() => takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV }), (e) => e instanceof CheckpointError && e.code === 'checkpoint-failed');
  } finally { chmodSync(unreadable, 0o644); }
  assert.ok(!existsSync(join(store, '.checkpoints')), 'the record directory this call created is removed');
  assert.doesNotMatch(git(store, 'status', '--porcelain', '--untracked-files=all'), /\.checkpoints/);
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV });
  assert.equal(r.reused, false, 'a re-run takes the checkpoint');
});

test('(i) a tag without a checkpoint record is refused as checkpoint-foreign-tag, even with a verifying bundle (B3 final review T6-2)', () => {
  const { repo, store } = submoduleRepo();
  git(store, 'tag', 'pre-engine-0.4.0', 'HEAD'); // someone else's tag: no .checkpoints/pre-engine-0.4.0/checkpoint.json
  const common = realpathSync(join(repo, git(repo, 'rev-parse', '--git-common-dir')));
  const bundle = join(common, 'tokenomics', 'pre-engine-0.4.0.bundle');
  mkdirSync(dirname(bundle), { recursive: true });
  git(store, 'bundle', 'create', '-q', bundle, 'refs/tags/pre-engine-0.4.0');
  assert.throws(() => takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV }), (e) => {
    assert.ok(e instanceof CheckpointError);
    assert.equal(e.code, 'checkpoint-foreign-tag');
    assert.match(e.message, /checkpoint\.json/);
    assert.match(e.message, /tag -d pre-engine-0\.4\.0/);
    return true;
  });
});

test('(j) an inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE (a git hook environment) never redirects the checkout (B3 final review T6-4)', () => {
  const { repo, store } = submoduleRepo();
  put(store, 'automation/usage-b.jsonl', '{"b":1}\n');
  const idx = indexBytes(repo);
  const mainTelemetry = git(repo, 'rev-parse', 'refs/heads/telemetry');
  const hookEnv = { ...ENV, GIT_DIR: join(repo, '.git'), GIT_WORK_TREE: repo, GIT_INDEX_FILE: join(repo, '.git', 'index') };
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: hookEnv });
  assert.equal(git(store, 'rev-parse', 'refs/heads/telemetry'), r.commit, 'committed in the store repository');
  assert.ok(tagFiles(store, r.tag).includes('automation/usage-b.jsonl'));
  assert.equal(git(repo, 'rev-parse', 'refs/heads/telemetry'), mainTelemetry, "the main repository's refs are untouched");
  assert.equal(git(repo, 'tag', '-l'), '');
  assert.deepEqual(indexBytes(repo), idx, "the operator's index is untouched");
});

test('identity: with none configured, the commit is made as tokenomics <tokenomics@localhost>', () => {
  const { repo, store } = submoduleRepo();
  const r = takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: BASE });
  assert.equal(git(store, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', r.commit), 'tokenomics <tokenomics@localhost>|tokenomics <tokenomics@localhost>');
  git(store, 'config', 'user.name', 'Op');
  git(store, 'config', 'user.email', 'op@example.test');
  const r2 = takeCheckpoint(repo, SETTINGS, { version: '0.5.0', form: 'submodule', wrappers: [], env: BASE });
  assert.equal(git(store, 'log', '-1', '--format=%an <%ae>', r2.commit), 'Op <op@example.test>', 'a configured identity is used');
});

test('refusals: no git, a missing store, a bad form, version or wrapper path', () => {
  const nogit = join(sandbox, 'no-git');
  put(nogit, '.agents/telemetry/automation/usage-a.jsonl', 'a\n');
  const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof CheckpointError, String(e)); return e.code; } return null; };
  const ceiling = { ...ENV, GIT_CEILING_DIRECTORIES: sandbox };
  assert.equal(code(() => takeCheckpoint(nogit, SETTINGS, { version: '0.4.0', form: 'plain-folder', wrappers: [], env: ceiling })), 'checkpoint-no-git');
  const repo = mainRepo();
  assert.equal(code(() => takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV })), 'checkpoint-no-store');
  assert.equal(code(() => takeCheckpoint(repo, SETTINGS, { version: '0.4.0', form: 'plain-folder', wrappers: [], env: ENV })), 'checkpoint-no-store');
  const { repo: sub } = submoduleRepo();
  assert.equal(code(() => takeCheckpoint(sub, SETTINGS, { version: '0.4.0', form: 'folder', wrappers: [], env: ENV })), 'checkpoint-bad-form');
  for (const v of ['', '../x', '1.0 0', '1..0', 'v/1', '1.0.', '1.lock', undefined]) assert.equal(code(() => takeCheckpoint(sub, SETTINGS, { version: v, form: 'submodule', wrappers: [], env: ENV })), 'checkpoint-bad-version', String(v));
  for (const w of ['/etc/passwd', '../outside.json', 'a/../../b', '.agents/telemetry/x.json']) assert.equal(code(() => takeCheckpoint(sub, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [w], env: ENV })), 'checkpoint-bad-wrapper', w);
  // A git failure while building is a CheckpointError too, and tags nothing.
  const unreadable = join(sub, '.agents/telemetry/automation/locked.jsonl');
  put(sub, '.agents/telemetry/automation/locked.jsonl', 'x\n');
  chmodSync(unreadable, 0o000);
  try { assert.equal(code(() => takeCheckpoint(sub, SETTINGS, { version: '0.4.0', form: 'submodule', wrappers: [], env: ENV })), 'checkpoint-failed'); }
  finally { chmodSync(unreadable, 0o644); }
  assert.ok(!lstatSync(join(sub, '.agents/telemetry')).isSymbolicLink());
  assert.equal(git(join(sub, '.agents/telemetry'), 'tag', '-l'), '', 'a refusal tags nothing');
});
