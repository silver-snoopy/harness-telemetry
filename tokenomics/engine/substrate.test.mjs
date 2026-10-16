// Substrate create + verify (D-SUB, spec §2, §14.2). Every repo is a temp repo; git is isolated:
// an empty temp global config, no system config, file protocol only, no network, no identity in
// the environment (each fixture commit passes its own through -c).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSubstrate, verifySubstrate, SubstrateError } from './substrate.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'ht-substrate-'));
after(() => rmSync(sandbox, { recursive: true, force: true }));
const gitconfig = join(sandbox, 'gitconfig');
// useConfigOnly: git never invents an identity from the host name, so a commit without one fails.
writeFileSync(gitconfig, '[user]\n\tuseConfigOnly = true\n[init]\n\tdefaultBranch = main\n');
const env = { PATH: process.env.PATH, HOME: sandbox, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' };
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@x'];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const T = '.agents/telemetry';
const opts = (o = {}) => ({ env, ...o });

function freshRepo() {
  const repo = mkdtempSync(join(sandbox, 'repo-'));
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'README.md'), 'main\n');
  git(repo, 'add', '.');
  git(repo, ...ID, 'commit', '-q', '-m', 'init');
  return repo;
}

/** An orphan `telemetry` branch carrying another module's files, built through a temp index. */
function telemetryBranch(repo, files) {
  const idx = join(sandbox, `idx-${Math.random().toString(16).slice(2)}`);
  const e = { ...env, GIT_INDEX_FILE: idx };
  for (const [path, body] of Object.entries(files)) {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, env: e, input: body, encoding: 'utf8' }).trim();
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { cwd: repo, env: e });
  }
  const tree = execFileSync('git', ['write-tree'], { cwd: repo, env: e, encoding: 'utf8' }).trim();
  const commit = execFileSync('git', [...ID, 'commit-tree', tree, '-m', 'telemetry: earlier writer'], { cwd: repo, env: e, encoding: 'utf8' }).trim();
  git(repo, 'update-ref', 'refs/heads/telemetry', commit);
  rmSync(idx, { force: true });
  return commit;
}
const OTHER = { 'automation/usage-x.jsonl': '{"session":"s1"}\n', 'delivery/state.json': '{"ok":true}\n', 'README.md': 'earlier\n', '.gitignore': '*/live/\n' };

/** The reference writer's end state: branch + submodule registered, ignore=all, committed on main. */
function referenceStore(repo) {
  const head = telemetryBranch(repo, OTHER);
  git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', '-b', 'telemetry', '--', './', T);
  git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.ignore`, 'all');
  git(repo, 'add', '.gitmodules');
  git(repo, ...ID, 'commit', '-q', '-m', 'chore: telemetry submodule');
  return head;
}

test('(a) fresh repo, no remote → submodule on telemetry, url ./, ignore all, materialised; main tree stages only .gitmodules + pointer', () => {
  const repo = freshRepo();
  const r = ensureSubstrate(repo, {}, opts());
  assert.deepEqual({ form: r.form, created: r.created }, { form: 'submodule', created: true });
  assert.equal(git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.branch`), 'telemetry');
  assert.equal(git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.url`), './');
  assert.equal(git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.ignore`), 'all');
  assert.ok(existsSync(join(repo, T, '.git')), 'materialised');
  assert.equal(git(join(repo, T), 'branch', '--show-current'), 'telemetry');
  assert.deepEqual(git(repo, 'status', '--porcelain', '--ignore-submodules=none').split('\n').sort(), ['A  .agents/telemetry', 'A  .gitmodules']);
  assert.equal(git(join(repo, T), 'status', '--porcelain'), '', 'no dirty submodule checkout');
  const v = verifySubstrate(repo, {}, opts());
  assert.deepEqual(v, { ok: true, form: 'submodule', problems: [] });
});

test('(a2) an unreachable origin (offline): the submodule is still created locally; .gitmodules keeps url ./ (Plan 5 Task 11)', () => {
  const repo = freshRepo();
  git(repo, 'remote', 'add', 'origin', 'file:///nonexistent/ht-substrate-remote.git');
  const r = ensureSubstrate(repo, {}, opts());
  assert.deepEqual({ form: r.form, created: r.created }, { form: 'submodule', created: true });
  assert.equal(git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.url`), './');
  assert.equal(git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.ignore`), 'all');
  assert.ok(existsSync(join(repo, T, '.git')), 'materialised');
  assert.deepEqual(verifySubstrate(repo, {}, opts()), { ok: true, form: 'submodule', problems: [] });
  assert.equal(git(repo, 'remote', 'get-url', 'origin'), 'file:///nonexistent/ht-substrate-remote.git', 'the remote is untouched');
});

test('(b) an existing reference store (automation/ ledger + delivery/) is verified, not recreated; branch head unchanged', () => {
  const repo = freshRepo();
  const head = referenceStore(repo);
  const before = git(repo, 'status', '--porcelain', '--ignore-submodules=none');
  const r = ensureSubstrate(repo, {}, opts());
  assert.deepEqual({ form: r.form, created: r.created }, { form: 'submodule', created: false });
  assert.equal(git(repo, 'rev-parse', 'refs/heads/telemetry'), head);
  assert.equal(git(join(repo, T), 'rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(join(repo, T, 'automation/usage-x.jsonl'), 'utf8'), OTHER['automation/usage-x.jsonl']);
  assert.equal(readFileSync(join(repo, T, 'delivery/state.json'), 'utf8'), OTHER['delivery/state.json']);
  assert.equal(git(repo, 'status', '--porcelain', '--ignore-submodules=none'), before, 'nothing rewritten');
});

test('(b2) a clone without --recurse (registered, empty dir) is materialised from the existing branch, not recreated', () => {
  const repo = freshRepo();
  const head = referenceStore(repo);
  git(repo, 'submodule', 'deinit', '-q', '-f', '--', T);
  assert.ok(!existsSync(join(repo, T, '.git')));
  assert.equal(verifySubstrate(repo, {}, opts()).ok, false, 'not materialised is a problem');
  const r = ensureSubstrate(repo, {}, opts());
  assert.deepEqual({ form: r.form, created: r.created }, { form: 'submodule', created: true });
  assert.equal(git(repo, 'rev-parse', 'refs/heads/telemetry'), head);
  assert.equal(git(join(repo, T), 'rev-parse', 'HEAD'), head);
  assert.equal(verifySubstrate(repo, {}, opts()).ok, true);
});

test('(b3) a clone without --recurse-submodules (detached, origin/telemetry but no local branch) gets a local telemetry branch tracking origin/telemetry, checked out; the checkpoint then succeeds (Codex B3-07)', async () => {
  const { takeCheckpoint } = await import('./checkpoint.mjs');
  const repo = freshRepo();
  ensureSubstrate(repo, {}, opts());
  const store = join(repo, T);
  git(repo, 'fetch', '-q', '--no-write-fetch-head', store, `${git(store, 'rev-parse', 'HEAD')}:refs/heads/telemetry`); // the seed, published
  git(repo, ...ID, 'commit', '-q', '-m', 'store');
  const clone = join(mkdtempSync(join(sandbox, 'clone-')), 'c');
  git(sandbox, 'clone', '-q', repo, clone);
  ensureSubstrate(clone, {}, opts());
  const cs = join(clone, T);
  assert.equal(git(cs, 'branch', '--show-current'), 'telemetry');
  assert.equal(git(cs, 'rev-parse', 'refs/heads/telemetry'), git(cs, 'rev-parse', 'refs/remotes/origin/telemetry'));
  assert.equal(git(cs, 'rev-parse', '--abbrev-ref', 'telemetry@{upstream}'), 'origin/telemetry');
  assert.equal(git(cs, 'status', '--porcelain'), '');
  assert.equal(verifySubstrate(clone, {}, opts()).ok, true);
  const r = takeCheckpoint(clone, {}, { version: '0.4.0', form: 'submodule', env: { ...env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  assert.equal(git(cs, 'rev-parse', `${r.commit}^`), git(cs, 'rev-parse', 'refs/remotes/origin/telemetry'), 'the checkpoint extends the published history');
});

test('(c) commit-tree succeeds with no global git identity', () => {
  const repo = freshRepo();
  assert.throws(() => git(repo, 'commit-tree', git(repo, 'hash-object', '-t', 'tree', '/dev/null'), '-m', 'x'), 'the fixture really has no identity');
  const r = ensureSubstrate(repo, {}, opts());
  assert.equal(r.form, 'submodule');
  assert.equal(git(repo, 'log', '-1', '--format=%an', 'refs/heads/telemetry'), 'telemetry');
});

test('(d) an existing branch without a submodule: seeded and committed, no dirty checkout, pointer = submodule HEAD', () => {
  const repo = freshRepo();
  const head = telemetryBranch(repo, { 'delivery/state.json': '{"ok":true}\n' }); // no README, no .gitignore
  const r = ensureSubstrate(repo, {}, opts());
  assert.deepEqual({ form: r.form, created: r.created }, { form: 'submodule', created: true });
  const sub = join(repo, T);
  assert.equal(git(sub, 'status', '--porcelain'), '', 'seed committed, not left pending');
  assert.ok(existsSync(join(sub, 'README.md')) && existsSync(join(sub, '.gitignore')));
  assert.equal(readFileSync(join(sub, 'delivery/state.json'), 'utf8'), '{"ok":true}\n');
  git(sub, 'merge-base', '--is-ancestor', head, 'HEAD'); // history kept, never rewritten
  assert.equal(git(repo, 'ls-files', '-s', T).split(/\s+/)[1], git(sub, 'rev-parse', 'HEAD'), 'staged gitlink is the seeded commit');
  assert.equal(git(repo, 'rev-parse', 'refs/heads/telemetry'), git(sub, 'rev-parse', 'HEAD'));
});

test('(d2) interim plain-dir files move into the submodule and are committed', () => {
  const repo = freshRepo();
  mkdirSync(join(repo, T, 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, T, 'tokenomics', 'usage-x.jsonl'), '{"a":1}\n');
  ensureSubstrate(repo, {}, opts());
  const sub = join(repo, T);
  assert.equal(readFileSync(join(sub, 'tokenomics', 'usage-x.jsonl'), 'utf8'), '{"a":1}\n');
  assert.equal(git(sub, 'status', '--porcelain'), '');
  assert.ok(!existsSync(`${sub}.pre-submodule`));
});

test('(d3) interim files over an existing module directory are restored file by file: an extended ledger and a new file reach the store, nothing stays stranded (Codex B3-02)', () => {
  const repo = freshRepo();
  telemetryBranch(repo, { 'automation/usage-review.jsonl': 'old-session\n' });
  mkdirSync(join(repo, T, 'automation'), { recursive: true });
  writeFileSync(join(repo, T, 'automation/usage-review.jsonl'), 'old-session\nnew-session\n');
  writeFileSync(join(repo, T, 'automation/new.json'), 'durable-new-scope');
  ensureSubstrate(repo, {}, opts());
  const sub = join(repo, T);
  assert.equal(readFileSync(join(sub, 'automation/usage-review.jsonl'), 'utf8'), 'old-session\nnew-session\n', 'the interim ledger extends the branch copy');
  assert.equal(readFileSync(join(sub, 'automation/new.json'), 'utf8'), 'durable-new-scope');
  assert.equal(git(sub, 'status', '--porcelain'), '', 'committed');
  assert.ok(!existsSync(`${sub}.pre-submodule`), 'nothing stranded');
  assert.equal(verifySubstrate(repo, {}, opts()).ok, true);
});

test('(d4) an interim file that conflicts with the branch copy is never lost: the rest is restored, the conflict stays in the stash, and the run refuses until it is merged (Codex B3-02)', () => {
  const repo = freshRepo();
  telemetryBranch(repo, { 'automation/state.json': '{"a":1}\n', 'automation/usage-x.jsonl': 'a\nb\n' });
  mkdirSync(join(repo, T, 'automation'), { recursive: true });
  writeFileSync(join(repo, T, 'automation/state.json'), '{"b":2}\n');
  writeFileSync(join(repo, T, 'automation/usage-x.jsonl'), 'a\n'); // the branch already holds every byte
  writeFileSync(join(repo, T, 'automation/other.json'), '{"o":1}\n');
  const stash = join(repo, `${T}.pre-submodule`);
  assert.throws(() => ensureSubstrate(repo, {}, opts()), (e) => e instanceof SubstrateError && e.code === 'interim-conflict'
    && e.message.includes('automation/state.json') && /remedy:/.test(e.message));
  const sub = join(repo, T);
  assert.equal(readFileSync(join(sub, 'automation/other.json'), 'utf8'), '{"o":1}\n', 'the non-conflicting file is restored');
  assert.equal(readFileSync(join(sub, 'automation/state.json'), 'utf8'), '{"a":1}\n', 'the branch copy is untouched');
  assert.equal(readFileSync(join(sub, 'automation/usage-x.jsonl'), 'utf8'), 'a\nb\n');
  assert.equal(readFileSync(join(stash, 'automation/state.json'), 'utf8'), '{"b":2}\n', 'the conflicting bytes are kept');
  assert.ok(!existsSync(join(stash, 'automation/usage-x.jsonl')) && !existsSync(join(stash, 'automation/other.json')));
  const v = verifySubstrate(repo, {}, opts());
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /pre-submodule/.test(p) && /automation\/state\.json/.test(p)), v.problems.join('; '));
  assert.throws(() => ensureSubstrate(repo, {}, opts()), (e) => e.code === 'interim-conflict', 'a re-run refuses while the conflict remains');
  // The operator merges by hand; the re-run then completes and the stash is gone.
  writeFileSync(join(sub, 'automation/state.json'), '{"a":1,"b":2}\n');
  rmSync(join(stash, 'automation/state.json'));
  ensureSubstrate(repo, {}, opts());
  assert.ok(!existsSync(stash));
  assert.equal(verifySubstrate(repo, {}, opts()).ok, true);
});

test('(e) a submodule failure: required → throws naming the cause; default → throws naming --plain-folder; --plain-folder → plain-folder', () => {
  const repo = freshRepo();
  mkdirSync(join(repo, '.agents'), { recursive: true });
  writeFileSync(join(repo, T), 'a file, not a directory\n');
  const required = { substrate: { required: 'submodule' } };
  for (const o of [{}, { plainFolder: true }]) {
    assert.throws(() => ensureSubstrate(repo, required, opts(o)), (e) => e instanceof SubstrateError
      && e.code === 'submodule-required' && /not a directory/.test(e.message) && /remedy:/.test(e.message) && !!e.remedy);
  }
  assert.throws(() => ensureSubstrate(repo, {}, opts()), (e) => e instanceof SubstrateError
    && e.code === 'submodule-failed' && /not a directory/.test(e.message) && /--plain-folder/.test(e.message) && /remedy:/.test(e.message));
  const r = ensureSubstrate(repo, {}, opts({ plainFolder: true }));
  assert.equal(r.form, 'plain-folder');
  assert.equal(r.created, false);
  assert.match(r.cause, /not a directory/);
});

test('(e2) a recorded plain folder is honoured; required submodule refuses it', () => {
  const repo = freshRepo();
  assert.deepEqual(ensureSubstrate(repo, { substrate: { form: 'plain-folder' } }, opts()), { form: 'plain-folder', created: false });
  assert.ok(!existsSync(join(repo, '.gitmodules')), 'no submodule attempted');
  assert.deepEqual(verifySubstrate(repo, { substrate: { form: 'plain-folder' } }, opts()), { ok: true, form: 'plain-folder', problems: [] });
  assert.throws(() => ensureSubstrate(repo, { substrate: { form: 'plain-folder', required: 'submodule' } }, opts()), (e) => e.code === 'submodule-required');
});

test('(e3) --plain-folder over a registered submodule that fails verification is refused: submodule-registered', () => {
  const repo = freshRepo();
  ensureSubstrate(repo, {}, opts());
  git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.ignore`, 'dirty');
  const refused = (e) => e instanceof SubstrateError && e.code === 'submodule-registered'
    && /ignore/.test(e.message) && /remedy:/.test(e.message) && /\.ignore all/.test(e.remedy) && /deinit|deregister/.test(e.remedy);
  assert.throws(() => ensureSubstrate(repo, {}, opts({ plainFolder: true })), refused, 'materialised');
  git(repo, 'submodule', 'deinit', '-q', '-f', '--', T);
  rmSync(join(repo, T), { recursive: true, force: true });
  writeFileSync(join(repo, T), 'a file now, so materialising fails\n');
  assert.throws(() => ensureSubstrate(repo, {}, opts({ plainFolder: true })), (e) => e.code === 'submodule-registered', 'registered only');
  assert.throws(() => ensureSubstrate(repo, { substrate: { required: 'submodule' } }, opts({ plainFolder: true })), (e) => e.code === 'submodule-required');
});

test('(f) no git repository → throws no-git with a remedy', () => {
  const dir = mkdtempSync(join(sandbox, 'nogit-'));
  assert.throws(() => ensureSubstrate(dir, {}, opts({ plainFolder: true })), (e) => e instanceof SubstrateError && e.code === 'no-git' && /remedy:/.test(e.message));
  const v = verifySubstrate(dir, {}, opts());
  assert.equal(v.ok, false);
  assert.equal(v.form, null);
  assert.match(v.problems[0], /no git repository/);
});

test('(h) the `rm --cached` migration step is undone when a later substrate step fails (Plan 5 Task 7)', () => {
  const repo = freshRepo();
  // An earlier era committed telemetry to main.
  mkdirSync(join(repo, T, 'automation'), { recursive: true });
  writeFileSync(join(repo, T, 'automation', 'usage-old.jsonl'), '{"v":1}\n');
  git(repo, 'add', '.');
  git(repo, ...ID, 'commit', '-q', '-m', 'old telemetry on main');
  // `submodule add` cannot clone into .git/modules/.agents when that path is a file.
  writeFileSync(join(repo, '.git', 'modules'), 'not a directory\n');
  assert.throws(() => ensureSubstrate(repo, {}, opts()), (e) => e instanceof SubstrateError && e.code === 'submodule-failed');
  assert.equal(git(repo, 'ls-files', '--', T), `${T}/automation/usage-old.jsonl`, 'the index entries are back');
  assert.equal(git(repo, 'status', '--porcelain', '--', T), '', 'nothing staged for the old telemetry');
  assert.equal(readFileSync(join(repo, T, 'automation', 'usage-old.jsonl'), 'utf8'), '{"v":1}\n', 'the data is in place');
});

/** An env whose `git` fails (exit 1) when its argument string contains `needle`, and runs the real git otherwise. */
function failingGit(needle) {
  const real = execFileSync('sh', ['-c', 'command -v git'], { env, encoding: 'utf8' }).trim();
  const bin = mkdtempSync(join(sandbox, 'shim-'));
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase " $* " in *${JSON.stringify(` ${needle} `)}*) echo "simulated failure" >&2; exit 1;; esac\nexec ${JSON.stringify(real)} "$@"\n`, { mode: 0o755 });
  return { ...env, PATH: `${bin}:${env.PATH}` };
}

test('(h2) a failed conversion restores the operator\'s exact index entries, never resetting them to HEAD (Codex B3-08)', () => {
  const repo = freshRepo();
  const p = `${T}/automation/usage-review.jsonl`;
  const q = `${T}/automation/notes.json`;
  mkdirSync(join(repo, T, 'automation'), { recursive: true });
  writeFileSync(join(repo, p), 'old\n');
  writeFileSync(join(repo, q), '{"v":1}\n');
  git(repo, 'add', '.');
  git(repo, ...ID, 'commit', '-q', '-m', 'old telemetry on main');
  writeFileSync(join(repo, p), 'old\nstaged-new\n');
  git(repo, 'add', p); // staged
  writeFileSync(join(repo, q), '{"v":2}\n');
  git(repo, 'add', q);
  writeFileSync(join(repo, q), '{"v":3}\n'); // staged v2, worktree v3
  const before = git(repo, 'ls-files', '-s', '--', T);
  assert.throws(() => ensureSubstrate(repo, {}, { env: failingGit('submodule add') }), (e) => e instanceof SubstrateError && e.code === 'submodule-failed' && /simulated failure/.test(e.message));
  assert.equal(git(repo, 'ls-files', '-s', '--', T), before, 'the index entries are exactly as before');
  assert.equal(git(repo, 'show', `:${p}`), 'old\nstaged-new');
  assert.equal(git(repo, 'show', `:${q}`), '{"v":2}');
  assert.equal(readFileSync(join(repo, p), 'utf8'), 'old\nstaged-new\n');
  assert.equal(readFileSync(join(repo, q), 'utf8'), '{"v":3}\n', 'the worktree file is back too');
});

test('(h3) a failure between `submodule add` and the url reset rolls the registration back: .gitmodules bytes, its index entry and the gitlink are as before, and a re-run succeeds (B3 final review T11-2)', () => {
  const repo = freshRepo();
  const gm = '[submodule "vendor/x"]\n\tpath = vendor/x\n\turl = ../x.git\n';
  writeFileSync(join(repo, '.gitmodules'), gm);
  git(repo, 'add', '.gitmodules');
  git(repo, ...ID, 'commit', '-q', '-m', 'unrelated submodule entry');
  writeFileSync(join(repo, '.gitmodules'), `${gm}# an unstaged operator edit\n`);
  mkdirSync(join(repo, T, 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, T, 'tokenomics', 'usage-x.jsonl'), '{"a":1}\n');
  const index = git(repo, 'ls-files', '-s');
  assert.throws(() => ensureSubstrate(repo, {}, { env: failingGit(`.gitmodules submodule.${T}.url ./`) }), (e) => e.code === 'submodule-failed');
  assert.equal(readFileSync(join(repo, '.gitmodules'), 'utf8'), `${gm}# an unstaged operator edit\n`, 'no absolute url left behind');
  assert.equal(git(repo, 'ls-files', '-s'), index, 'no staged .gitmodules, no gitlink');
  assert.equal(tryConfig(repo, `submodule.${T}.url`), null, 'the registration is gone from .git/config');
  assert.equal(readFileSync(join(repo, T, 'tokenomics', 'usage-x.jsonl'), 'utf8'), '{"a":1}\n', 'the interim file is back');
  assert.ok(!existsSync(join(repo, T, '.git')), 'no half-made checkout');
  ensureSubstrate(repo, {}, opts());
  assert.equal(git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.url`), './');
  assert.equal(verifySubstrate(repo, {}, opts()).ok, true);
  assert.equal(readFileSync(join(repo, T, 'tokenomics', 'usage-x.jsonl'), 'utf8'), '{"a":1}\n');
});
const tryConfig = (repo, key) => { try { return git(repo, 'config', '--get', key); } catch { return null; } };

test('(g) verifySubstrate reports wrong branch, ignore not all, not materialised, unrecorded plain folder', () => {
  const plain = freshRepo();
  let v = verifySubstrate(plain, {}, opts());
  assert.equal(v.form, 'plain-folder');
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /plain folder not recorded/.test(p)), v.problems.join('; '));

  const repo = freshRepo();
  ensureSubstrate(repo, {}, opts());
  git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.ignore`, 'dirty');
  v = verifySubstrate(repo, {}, opts());
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /ignore is "dirty", not "all"/.test(p)), v.problems.join('; '));
  assert.throws(() => ensureSubstrate(repo, {}, opts()), (e) => e.code === 'submodule-failed' && /ignore/.test(e.message));
  git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.ignore`, 'all');

  git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.branch`, 'main');
  v = verifySubstrate(repo, {}, opts());
  assert.ok(v.problems.some((p) => /wrong branch/.test(p) && /"main"/.test(p)), v.problems.join('; '));
  git(repo, 'config', '-f', '.gitmodules', `submodule.${T}.branch`, 'telemetry');

  git(join(repo, T), 'checkout', '-q', '-b', 'other');
  v = verifySubstrate(repo, {}, opts());
  assert.ok(v.problems.some((p) => /wrong branch/.test(p) && /checkout is on "other"/.test(p)), v.problems.join('; '));
  git(join(repo, T), 'checkout', '-q', 'telemetry');
  git(join(repo, T), 'checkout', '-q', '--detach');
  assert.deepEqual(verifySubstrate(repo, {}, opts()).problems, [], 'a detached pointer on the telemetry history is fine (fresh clone)');

  git(repo, 'submodule', 'deinit', '-q', '-f', '--', T);
  v = verifySubstrate(repo, {}, opts());
  assert.ok(v.problems.some((p) => /not materialised/.test(p)), v.problems.join('; '));
});
