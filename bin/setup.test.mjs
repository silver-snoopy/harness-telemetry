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
import { mineIds } from '../tokenomics/hooks/telemetry-capture.mjs';
import { TA_DEFAULTS } from '../tokenomics/engine/config.mjs';

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

// ---- tracker inference (Plan 7, Task 2) ----
const settingsOf = (w) => join(w.repo, '.agents', 'tokenomics', 'settings.json');
const commits = (w, msgs) => { for (const m of msgs) w.g('commit', '-q', '--allow-empty', '-m', m); };
const jiraWorld = (origin = null) => {
  const w = world();
  commits(w, [...Array(6).fill('PAY-1 pay thing (#7)'), ...Array(5).fill('WEB-2 web thing'), 'SHA-256 bump']);
  if (origin) w.g('remote', 'add', 'origin', origin);
  return w;
};
const BASE = ['--host', 'claude', '--no-git-hook'];

test('setup: fresh settings carry the detected tracker rules; dir tokenomics, extension null; the output names tracker and why; doctor ok', () => {
  const w = jiraWorld('https://github.com/o/r.git');
  const r = setup(w, BASE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /tracker: jira \(PAY, WEB — 11 of \d+ commits and branches\)/);
  assert.match(r.stdout, /tracker: github \(github\.com remote/);
  assert.match(r.stdout, /receipts from jira/);
  assert.match(r.stdout, /ok\s+targets/);
  const s = JSON.parse(readFileSync(settingsOf(w), 'utf8'));
  assert.equal(s.dir, 'tokenomics');
  assert.equal(s.extension, null);
  const jira = s.ids.rules.filter((x) => x.tracker === 'jira');
  const gh = s.ids.rules.filter((x) => x.tracker === 'github');
  assert.ok(jira.length && gh.length);
  assert.ok(gh.some((x) => x.source === 'branch'), 'github carries the branch rule');
  assert.ok(!jira.some((x) => x.source === 'branch'), 'jira never does');
  assert.ok(!s.ids.rules.some((x) => x.tracker === 'ado'));
  const mined = mineIds({ ...TA_DEFAULTS, ids: { ...TA_DEFAULTS.ids, rules: s.ids.rules } }, ['PAY-1 (#7)']);
  assert.deepEqual(mined, ['gh:7', 'jira:PAY-1']);
});

test('setup: an ado remote gets the ado branch rule and no github rules', () => {
  const w = world();
  w.g('remote', 'add', 'origin', 'https://dev.azure.com/acme/proj/_git/app');
  const r = setup(w, BASE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rules = JSON.parse(readFileSync(settingsOf(w), 'utf8')).ids.rules;
  assert.deepEqual([...new Set(rules.map((x) => x.tracker))], ['ado']);
  assert.ok(rules.some((x) => x.source === 'branch'));
});

test('setup: a legacy store keeps its module directory (P7-04)', () => {
  const w = jiraWorld();
  mkdirSync(join(w.repo, '.agents', 'telemetry', 'automation'), { recursive: true });
  writeFileSync(join(w.repo, '.agents', 'telemetry', 'automation', 'usage-x.jsonl'), '');
  const r = setup(w, BASE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = JSON.parse(readFileSync(settingsOf(w), 'utf8'));
  assert.equal(s.dir, 'automation');
  assert.ok(s.ids.rules.length);
});

test('setup: existing settings are never edited; the rules and the update command are printed', () => {
  const w = jiraWorld();
  mkdirSync(join(w.repo, '.agents', 'tokenomics'), { recursive: true });
  const body = '{"dir":"tokenomics","extension":null}\n';
  writeFileSync(settingsOf(w), body);
  const r = setup(w, BASE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = JSON.parse(readFileSync(settingsOf(w), 'utf8'));
  assert.equal(after.ids, undefined, 'no ids written');
  assert.match(r.stdout, /settings already exist and are never edited by setup — add these rules/);
  assert.match(r.stdout, /"normalize": "jira:\$1-\$2"/);
  assert.match(r.stdout, /node \.claude\/skills\/tokenomics\/scripts\/install-hooks\.mjs --update-manifest/);
});

test('setup: existing settings that already carry ids.rules are left alone without noise', () => {
  const w = jiraWorld();
  mkdirSync(join(w.repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(settingsOf(w), JSON.stringify({ dir: 'tokenomics', extension: null, ids: { rules: [{ pattern: '(a)', normalize: 'x:$1' }] } }));
  const r = setup(w, BASE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /already define ids\.rules/);
  assert.doesNotMatch(r.stdout, /add these rules/);
});

test('setup flags: --tracker/--tracker-keys override detection; --no-tracker writes no rules; a bad key exits 2 naming it', () => {
  const o = jiraWorld();
  const r = setup(o, [...BASE, '--tracker', 'jira', '--tracker-keys', 'ABC,XY1']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rules = JSON.parse(readFileSync(settingsOf(o), 'utf8')).ids.rules;
  assert.deepEqual([...new Set(rules.map((x) => x.tracker))], ['jira']);
  assert.match(rules[0].pattern, /ABC\|XY1/);
  assert.doesNotMatch(rules[0].pattern, /PAY/);

  const no = jiraWorld();
  const q = setup(no, [...BASE, '--no-tracker']);
  assert.equal(q.status, 0, q.stdout + q.stderr);
  assert.equal(JSON.parse(readFileSync(settingsOf(no), 'utf8')).ids, undefined);
  assert.doesNotMatch(q.stdout, /tracker:/);

  const bad = jiraWorld();
  const b = setup(bad, [...BASE, '--tracker', 'jira', '--tracker-keys', '12']);
  assert.equal(b.status, 2);
  assert.match(b.stderr, /'12'/);
  assert.ok(!existsSync(join(bad.repo, '.agents')), 'nothing written');
  assert.equal(setup(bad, [...BASE, '--tracker', 'trello']).status, 2);
  assert.equal(setup(world(), [...BASE, '--tracker', 'jira']).status, 2, 'jira without keys given or detected');
  assert.equal(setup(bad, [...BASE, '--tracker', 'ado', '--no-tracker']).status, 2);
  assert.equal(setup(bad, [...BASE, '--tracker']).status, 2);
});
