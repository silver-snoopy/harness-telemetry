// `harness-telemetry setup`, run as the CLI it is, in temp git repos. HOME (and so ~/.copilot) is a sandbox, git is
// isolated, and PATH holds only git, /bin and a shim dir: a no-op `node` (the post-commit sweep a --commit starts must
// not outlive the test) plus fake `claude` / `copilot` where a test detects them. setup runs its children with the
// test's own node binary (process.execPath), never the PATH one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectHosts } from './setup.mjs';

const CLI = fileURLToPath(new URL('./harness-telemetry.mjs', import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'ht-setup-'));
after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
let n = 0;
const fresh = (p) => { const d = join(sandbox, `${p}-${n++}`); mkdirSync(d, { recursive: true }); return d; };
const GIT_DIR = dirname(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim());

function world({ clis = [] } = {}) {
  const home = fresh('home');
  const shim = fresh('shim');
  writeFileSync(join(shim, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const c of clis) writeFileSync(join(shim, c), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const gitcfg = join(home, 'gitconfig');
  writeFileSync(gitcfg, '[init]\n\tdefaultBranch = main\n[user]\n\tname = Tester\n\temail = tester@example.invalid\n');
  const env = {
    PATH: [shim, GIT_DIR, '/usr/bin', '/bin'].join(':'), HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir(),
    GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0',
    TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_SINK: '1',
    TOKENOMICS_CLAUDE_ROOT: join(home, 'none'), TOKENOMICS_COPILOT_ROOT: join(home, 'none'), TOKENOMICS_VSCODE_ROOT: join(home, 'none'),
  };
  const repo = join(fresh('c'), 'project');
  mkdirSync(repo);
  const g = (...a) => { const r = spawnSync('git', a, { cwd: repo, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  g('init', '-q');
  writeFileSync(join(repo, 'README.md'), 'project\n');
  g('add', '.'); g('commit', '-q', '-m', 'init');
  return { home, repo, env, g };
}
const setup = (w, args = [], cwd = w.repo) => spawnSync(process.execPath, [CLI, 'setup', ...args], { cwd, env: w.env, encoding: 'utf8', timeout: 180000 });

test('setup: a Copilot-agent project — detected, copied, activated at user level with the git fallback, doctor ok, commit command printed; a re-run writes nothing', () => {
  const w = world();
  mkdirSync(join(w.repo, '.github', 'agents'), { recursive: true });
  writeFileSync(join(w.repo, '.github', 'agents', 'coder.agent.md'), '# coder\n');
  w.g('add', '.'); w.g('commit', '-q', '-m', 'agents');
  mkdirSync(join(w.repo, 'src'));
  const r = setup(w, [], join(w.repo, 'src')); // from a subdirectory: setup works on the repository root
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /hosts: copilot-cli \(\.github\/agents\)/);
  assert.match(r.stdout, /copy \(copilot\): installed — \.github\/skills\/tokenomics/);
  assert.match(r.stderr, /activated engine .* for copilot-cli/);
  assert.match(r.stderr, /Copilot CLI hooks wired at user level/);
  assert.match(r.stderr, /git post-commit sweep installed/);
  assert.match(r.stdout, /ok\s+targets\s+— copilot-cli wired/);
  assert.match(r.stdout, /git add .*\.github\/skills\/tokenomics .*\.agents\/tokenomics\/settings\.json .*\.gitmodules \.agents\/telemetry/);
  assert.match(r.stdout, /teammates: run this same setup once on their machine/);
  assert.match(r.stdout, /setup: done\n$/);
  assert.ok(existsSync(join(w.home, '.copilot', 'hooks', 'tokenomics.json')));
  assert.ok(!existsSync(join(w.repo, '.github', 'hooks', 'tokenomics.json')), 'no repo-level Copilot file');
  assert.deepEqual(JSON.parse(readFileSync(join(w.repo, '.agents', 'tokenomics', 'settings.json'), 'utf8')).targets, ['copilot-cli']);

  const again = setup(w);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /copy \(copilot\): unchanged/);
  assert.match(again.stderr, /already active/);
});

test('setup --commit commits only the shared paths; something the operator staged stays staged and uncommitted', () => {
  const w = world({ clis: ['claude'] });
  writeFileSync(join(w.repo, 'notes.txt'), 'mine\n');
  w.g('add', 'notes.txt');
  const r = setup(w, ['--commit']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /hosts: claude \(claude on PATH\)/);
  assert.match(r.stdout, /committed: /);
  const files = w.g('show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.ok(files.includes('.claude/settings.json') && files.includes('.gitmodules'), files.join(','));
  // diff output (show --name-only) hides an ignore=all submodule, so the pointer is checked in the tree itself
  assert.match(w.g('ls-tree', 'HEAD', '.agents/telemetry'), /^160000 commit [0-9a-f]{40}\t\.agents\/telemetry$/);
  assert.notEqual(w.g('ls-tree', 'HEAD~1', '.agents/telemetry'), w.g('ls-tree', 'HEAD', '.agents/telemetry'), 'the pointer arrived in this commit');
  assert.ok(files.some((f) => f.startsWith('.claude/skills/tokenomics/')));
  assert.ok(!files.includes('notes.txt'), 'the operator\'s staged file is not in the setup commit');
  assert.match(w.g('status', '--porcelain', '--', 'notes.txt'), /^A {2}notes\.txt$/);
  assert.equal(w.g('log', '-1', '--format=%s'), 'chore: add tokenomics telemetry');
  assert.match(setup(w).stdout, /nothing to commit/);
});

test('setup: host detection — PATH and project config, both hosts; --host overrides; --repo-hooks keeps the repo-level Copilot file', () => {
  const both = world({ clis: ['copilot'] });
  mkdirSync(join(both.repo, '.claude'));
  assert.deepEqual(detectHosts(both.repo, both.env).map((h) => `${h.host}: ${h.why}`), ['claude: .claude/', 'copilot-cli: copilot on PATH']);
  const none = world();
  assert.deepEqual(detectHosts(none.repo, none.env), []);
  const r = setup(none, ['--host', 'copilot', '--repo-hooks', '--no-git-hook']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /hosts: copilot-cli \(chosen with --host\)/);
  assert.ok(existsSync(join(none.repo, '.github', 'hooks', 'tokenomics.json')), '--repo-hooks: the repo-level file');
  assert.ok(!existsSync(join(none.home, '.copilot', 'hooks', 'tokenomics.json')), 'and no user-level one');
  assert.doesNotMatch(r.stderr, /git post-commit sweep installed/);
});

test('setup refuses clearly: no host found (2), not a git repository (1), an unknown host or argument (2)', () => {
  const w = world();
  const none = setup(w);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no host found .* pass --host/);
  assert.ok(!existsSync(join(w.repo, '.agents')), 'nothing written');
  const outside = fresh('plain');
  const r = spawnSync(process.execPath, [CLI, 'setup'], { cwd: outside, env: w.env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not inside a git repository/);
  assert.equal(setup(w, ['--host', 'cursor']).status, 2);
  assert.equal(setup(w, ['--frobnicate']).status, 2);
  assert.equal(setup(w, ['--host']).status, 2);
  assert.match(setup(w, ['--help']).stdout, /usage: harness-telemetry setup/);
});
