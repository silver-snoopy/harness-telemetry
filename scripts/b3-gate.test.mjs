// The B3 gate (Plan 5 Task 11, spec §12). The vendored LeRisque fixture (corpus/fixtures/lerisque, pinned to LeRisque
// 50615f1) is activated with the DOCUMENTED commands: the lines between <!-- b3-commands:begin --> and
// <!-- b3-commands:end --> in tokenomics/SKILL.md, run exactly, with only <package>, <skill> and <host> substituted.
// LeRisque's own wiring test (python3 .claude/tests/_assert_hook_wiring.py) runs before and after and must say the
// same thing. Hermetic: the published files are copied to a temp package, installed from there, and the temp package
// is deleted before any later command runs; isolated git; per-run npm cache; fake host CLIs (never a real one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const FIXTURE = join(ROOT, 'corpus', 'fixtures', 'lerisque');
const FAKES = join(ROOT, 'tokenomics', 'fixtures', 'probe');
const SYSTEM_PATH = ['/usr/bin', '/bin'];
const WIRING = ['.claude/tests/_assert_hook_wiring.py'];
const SKILL_REL = { claude: '.claude/skills/tokenomics', 'copilot-cli': '.github/skills/tokenomics' };

const sandbox = mkdtempSync(join(tmpdir(), 'ht-b3-'));
process.on('exit', () => { rmSync(sandbox, { recursive: true, force: true }); });
const mk = (p) => mkdtempSync(join(sandbox, `${p}-`));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// ---- the documented commands -------------------------------------------------------------------------------------
function documentedCommands() {
  const md = readFileSync(join(ROOT, 'tokenomics', 'SKILL.md'), 'utf8');
  const m = /<!-- b3-commands:begin -->([\s\S]*?)<!-- b3-commands:end -->/.exec(md);
  assert.ok(m, 'tokenomics/SKILL.md carries no <!-- b3-commands:begin --> … <!-- b3-commands:end --> block');
  const lines = m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('```'));
  for (const l of lines) assert.match(l, /^node \S/, `a documented command is one line starting with "node": ${l}`);
  return lines;
}

// ---- the sandbox -------------------------------------------------------------------------------------------------
const gitconfig = join(sandbox, 'gitconfig');
writeFileSync(gitconfig, '[init]\n\tdefaultBranch = main\n');
const bin = join(sandbox, 'bin'); // node and the fake host CLIs; no real claude or copilot is reachable
mkdirSync(bin);
symlinkSync(process.execPath, join(bin, 'node'));
for (const [name, fake] of [['claude', 'fake-claude.mjs'], ['copilot', 'fake-copilot.mjs']]) {
  writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(FAKES, fake)}" "$@"\n`);
  chmodSync(join(bin, name), 0o755);
  for (const d of SYSTEM_PATH) assert.ok(!existsSync(join(d, name)), `a real ${name} at ${d} would be reachable from the test PATH`);
}

const IDENT = { GIT_AUTHOR_NAME: 'B3 Gate', GIT_AUTHOR_EMAIL: 'b3@example.invalid', GIT_COMMITTER_NAME: 'B3 Gate', GIT_COMMITTER_EMAIL: 'b3@example.invalid' };
function envFor(home, { sync = false } = {}) {
  return {
    PATH: [bin, ...SYSTEM_PATH].join(delimiter), HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir(),
    GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0', ...IDENT,
    npm_config_cache: join(home, 'npmcache'), npm_config_update_notifier: 'false',
    TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SINK: '1', ...(sync ? {} : { TOKENOMICS_NO_SYNC: '1' }),
    TOKENOMICS_CLAUDE_ROOT: join(home, 'claude-project'), TOKENOMICS_COPILOT_ROOT: join(home, 'copilot-state'), TOKENOMICS_VSCODE_ROOT: join(home, 'vscode'),
    ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}),
  };
}
const gitOut = (cwd, env, ...a) => {
  const r = spawnSync('git', a, { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

let publishedList = null;
function published() {
  if (!publishedList) {
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--offline'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, npm_config_cache: mk('npmcache'), npm_config_update_notifier: 'false' },
    });
    assert.equal(r.status, 0, r.stderr);
    publishedList = JSON.parse(r.stdout)[0].files.map((f) => f.path);
  }
  return publishedList;
}
/** A temp package of the published files, optionally re-versioned (a synthetic upgrade). */
function makePackage({ engine = null } = {}) {
  const pkg = mk('pkg');
  for (const rel of published()) {
    mkdirSync(dirname(join(pkg, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(pkg, rel));
  }
  if (engine) {
    const p = join(pkg, 'tokenomics', 'ENGINE.json');
    writeFileSync(p, `${JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), engine }, null, 2)}\n`);
  }
  return pkg;
}

/** The fixture as a git repository, its commit-msg githook installed as a foreign hook, one commit. */
function lerisqueRepo({ sync = false, remote = null, dirtyLedger = false } = {}) {
  const repo = join(mk('c'), 'LeRisque');
  const home = mk('home');
  const env = envFor(home, { sync });
  cpSync(FIXTURE, repo, { recursive: true });
  rmSync(join(repo, 'PROVENANCE.md')); // documentation of the fixture, not part of the repository shape
  gitOut(repo, env, 'init', '-q');
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  copyFileSync(join(repo, 'githooks', 'commit-msg'), join(repo, '.git', 'hooks', 'commit-msg'));
  chmodSync(join(repo, '.git', 'hooks', 'commit-msg'), 0o755);
  if (remote) gitOut(repo, env, 'remote', 'add', 'origin', remote);
  gitOut(repo, env, 'add', '-A');
  gitOut(repo, env, 'commit', '-q', '-m', 'LeRisque fixture');
  if (dirtyLedger) { // an existing store, not yet a submodule, holding a ledger that nothing has committed
    mkdirSync(join(repo, '.agents', 'telemetry', 'automation'), { recursive: true });
    writeFileSync(join(repo, '.agents', 'telemetry', 'automation', 'usage-dirty.jsonl'), `${JSON.stringify({ v: 1, host: 'claude', id: 'dirty-1', startedAt: '2026-01-01T00:00:00.000Z' })}\n`);
  }
  return { repo, home, env };
}

/** One documented command (by index into the block), placeholders substituted, run from the repository. */
function runDoc(ctx, host, index, { pkg, env = ctx.env } = {}) {
  const line = documentedCommands()[index];
  // Split the documented line first, then substitute into each argument: a path with whitespace stays one argument (T11-1).
  const argv = line.split(/\s+/).slice(1)
    .map((a) => a.replace(/<package>/g, pkg ?? '').replace(/<skill>/g, join(ctx.repo, SKILL_REL[host])).replace(/<host>/g, host));
  assert.doesNotMatch(argv.join(' '), /<[a-z|-]+>/, `an unsubstituted placeholder in: ${line}`);
  const r = spawnSync(process.execPath, argv, { cwd: ctx.repo, env, encoding: 'utf8', timeout: 240000 });
  return { ...r, line, out: `${r.status}\n${r.stdout}\n${r.stderr}` };
}
const CMD = { copy: 0, activate: 1, doctor: 2, probe: 3 };

/** LeRisque's own wiring test, byte-for-byte unchanged, run with the developer's PATH (it needs python3). */
function wiring(ctx) {
  const r = spawnSync('python3', [...WIRING], { cwd: ctx.repo, env: { ...ctx.env, PATH: process.env.PATH }, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error };
}

function snapshot(root, skip = () => false) {
  const out = {};
  const go = (d, p) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const rel = p ? `${p}/${e.name}` : e.name;
      if (skip(rel)) continue;
      if (e.isDirectory()) go(join(d, e.name), rel);
      else out[rel] = `${sha(join(d, e.name))}:${(statSync(join(d, e.name)).mode & 0o777).toString(8)}`;
    }
  };
  go(root, '');
  return out;
}

function assertAllOk(r, label) {
  assert.equal(r.status, 0, `${label}\n${r.out}`);
  const lines = r.stdout.split('\n').filter((l) => l.trim());
  assert.ok(lines.length >= 8, `${label}: too few checks\n${r.out}`);
  for (const l of lines) assert.match(l, /^ok /, `${label}: not ok: ${l}\n${r.out}`);
}

/** The fixture's own activation-independent invariants after the documented commands ran. */
function assertFixtureIntact(ctx, host, { wiringBefore, preSnap, preHook }) {
  const after = wiring(ctx);
  assert.equal(after.status, 0, `wiring script: ${after.stdout}${after.stderr}`);
  assert.deepEqual(after, wiringBefore, 'the wiring script says the same thing before and after activation');

  // 6. LeRisque's 8 Python hook entries are unchanged: deep-equal, only ours (marked) are added
  const orig = JSON.parse(readFileSync(join(FIXTURE, '.claude', 'settings.json'), 'utf8'));
  const now = JSON.parse(readFileSync(join(ctx.repo, '.claude', 'settings.json'), 'utf8'));
  const { hooks: origHooks, ...origRest } = orig;
  const { hooks: nowHooks, ...nowRest } = now;
  assert.deepEqual(nowRest, origRest, 'everything outside hooks is untouched');
  const cmds = (h) => Object.values(h).flat().flatMap((e) => e.hooks ?? []).map((x) => x.command).filter((c) => c.includes('.claude/hooks/'));
  assert.equal(cmds(origHooks).length, 8);
  assert.deepEqual(cmds(nowHooks), cmds(origHooks), 'the 8 LeRisque hook commands are unchanged, in order');
  for (const [event, entries] of Object.entries(nowHooks)) {
    const ours = entries.filter((e) => e._tokenomics);
    assert.deepEqual(entries.filter((e) => !e._tokenomics), origHooks[event] ?? [], `${event}: LeRisque entries deep-equal`);
    if (!origHooks[event]) assert.equal(ours.length, entries.length, `${event}: only our entries were added`);
  }

  // 7. the foreign commit-msg hook is untouched (bytes and mode)
  const hook = join(ctx.repo, '.git', 'hooks', 'commit-msg');
  assert.deepEqual({ sha: sha(hook), mode: statSync(hook).mode & 0o777 }, preHook);
  assert.equal(sha(join(ctx.repo, 'githooks', 'commit-msg')), sha(join(FIXTURE, 'githooks', 'commit-msg')));

  // 8. the main tree has only the documented changes: the submodule (staged, the one commit the installer tells
  //    the operator to make), the activation files, and the host copy. Nothing of LeRisque's own is modified.
  const porcelain = gitOut(ctx.repo, ctx.env, 'status', '--porcelain').split('\n').filter(Boolean).sort();
  const staged = porcelain.filter((l) => /^[AMDR]/.test(l));
  assert.deepEqual(staged, ['A  .agents/telemetry', 'A  .gitmodules'], `staged: ${porcelain.join(' | ')}`);
  const modified = porcelain.filter((l) => /^ M/.test(l)).map((l) => l.slice(3)).sort();
  assert.deepEqual(modified, host === 'claude' ? ['.agents/tokenomics/settings.json', '.claude/settings.json'] : ['.agents/tokenomics/settings.json']);
  const untracked = porcelain.filter((l) => l.startsWith('??')).map((l) => l.slice(3)).sort();
  assert.deepEqual(untracked, host === 'claude' ? ['.claude/skills/', '.gitignore'] : ['.github/', '.gitignore']);
  const post = snapshot(ctx.repo, (rel) => rel.startsWith('.agents/') || rel.startsWith('.claude/skills/') || rel.startsWith('.github/') || rel === '.gitignore' || rel === '.gitmodules');
  const unchanged = Object.keys(preSnap).filter((k) => k !== '.claude/settings.json' && !k.startsWith('.agents/'));
  for (const k of unchanged) assert.equal(post[k], preSnap[k], `LeRisque file ${k} unchanged`);
  if (host !== 'claude') assert.equal(post['.claude/settings.json'], preSnap['.claude/settings.json']);
}

function before(ctx) {
  const wiringBefore = wiring(ctx);
  assert.equal(wiringBefore.error, undefined, 'python3 is required for the B3 gate');
  assert.equal(wiringBefore.status, 0, `the wiring script passes on the fixture: ${wiringBefore.stdout}${wiringBefore.stderr}`);
  assert.match(wiringBefore.stdout, /hook wiring OK: 8 hook\(s\) wired/);
  const hook = join(ctx.repo, '.git', 'hooks', 'commit-msg');
  return { wiringBefore, preSnap: snapshot(ctx.repo), preHook: { sha: sha(hook), mode: statSync(hook).mode & 0o777 } };
}

// ---- tests -------------------------------------------------------------------------------------------------------
test('python3 is required for the B3 gate (never skipped)', () => {
  const r = spawnSync('python3', ['-c', 'import sys; print(sys.version_info >= (3, 9))'], { encoding: 'utf8' });
  assert.equal(r.error, undefined, 'python3 is required for the B3 gate');
  assert.equal(r.stdout.trim(), 'True', 'python3 is required for the B3 gate (3.9 or newer)');
});

test('the documented commands block has the four published commands, in order', () => {
  const c = documentedCommands();
  assert.equal(c.length, 4);
  assert.match(c[CMD.copy], /^node <package>\/bin\/harness-telemetry\.mjs install tokenomics --target <host>$/);
  assert.match(c[CMD.activate], /^node <skill>\/scripts\/install-hooks\.mjs --host <host> --git-hook$/);
  assert.match(c[CMD.doctor], /^node <skill>\/scripts\/doctor\.mjs$/);
  assert.match(c[CMD.probe], /^node <skill>\/scripts\/doctor\.mjs --probe --host <host>$/);
});

test('the vendored LeRisque files match their recorded sha256 and LeRisque commit 50615f1', () => {
  const prov = readFileSync(join(FIXTURE, 'PROVENANCE.md'), 'utf8');
  assert.match(prov, /50615f1/);
  const rows = [...prov.matchAll(/\| `([^`]+)` \| `([0-9a-f]{64})` \|/g)];
  assert.deepEqual(rows.map((m) => m[1]).sort(), ['.claude/hooks/_run.sh', '.claude/settings.json', '.claude/tests/_assert_hook_wiring.py']);
  for (const [, rel, hash] of rows) assert.equal(sha(join(FIXTURE, rel)), hash, rel);
  const hooks = readdirSync(join(FIXTURE, '.claude', 'hooks')).sort();
  assert.deepEqual(hooks, ['_run.sh', '_shell_lex.py', 'block-firewall.py', 'block-unmanaged-issue-create.py', 'check-doc-rot.py', 'check-file-budget.py',
    'check-non-null-assertion.py', 'check-silent-catch.py', 'check-stub-patterns.py', 'py-syntax-check.py']);
  assert.equal(statSync(join(FIXTURE, 'githooks', 'commit-msg')).mode & 0o111, 0o111);
  const s = JSON.parse(readFileSync(join(FIXTURE, '.agents', 'tokenomics', 'settings.json'), 'utf8'));
  assert.deepEqual(s, { substrate: { required: 'submodule' }, extension: null });
});

for (const host of ['claude', 'copilot-cli']) {
  test(`gate (${host}): documented commands run exactly; the wiring script is unchanged; doctor all ok; probe fired`, () => {
    const ctx = lerisqueRepo();
    const pre = before(ctx);
    const pkg = makePackage();
    const copy = runDoc(ctx, host, CMD.copy, { pkg });
    assert.equal(copy.status, 0, copy.out);
    rmSync(pkg, { recursive: true, force: true }); // every later command runs from the installed copy alone
    const act = runDoc(ctx, host, CMD.activate);
    assert.equal(act.status, 0, act.out);
    assert.match(act.stderr + act.stdout, /activated engine \S+ for/);
    assertAllOk(runDoc(ctx, host, CMD.doctor), 'doctor');
    const probe = runDoc(ctx, host, CMD.probe);
    assert.equal(probe.status, 0, probe.out);
    assert.match(probe.stdout, new RegExp(`^fired\\s+probe:${host}`, 'm'), probe.out);
    assertFixtureIntact(ctx, host, pre);
    // the post-commit fallback was installed beside, not over, the foreign commit-msg hook
    assert.ok(existsSync(join(ctx.repo, '.git', 'hooks', 'post-commit')));
  });
}

test('gate variant dirty: an untracked ledger in an existing store is kept, checkpointed, and the commands still pass', () => {
  const ctx = lerisqueRepo({ dirtyLedger: true });
  const ledger = join(ctx.repo, '.agents', 'telemetry', 'automation', 'usage-dirty.jsonl');
  const bytes = readFileSync(ledger);
  const pre = before(ctx);
  const pkg = makePackage();
  assert.equal(runDoc(ctx, 'claude', CMD.copy, { pkg }).status, 0);
  rmSync(pkg, { recursive: true, force: true });
  const act = runDoc(ctx, 'claude', CMD.activate);
  assert.equal(act.status, 0, act.out);
  assert.deepEqual(readFileSync(ledger), bytes, 'the ledger is byte-identical in the store');
  // the fixture's settings.json names no dir, so the engine default (automation) applies: the same folder the ledger is in
  assert.ok(existsSync(join(ctx.repo, '.agents', 'telemetry', 'automation', 'module.json')), 'the existing store keeps its module folder');
  const store = join(ctx.repo, '.agents', 'telemetry');
  assert.match(gitOut(store, ctx.env, 'log', '--all', '--format=%H', '--', 'automation/usage-dirty.jsonl'), /^[0-9a-f]{40}/m, 'the ledger is in the store history');
  const tag = gitOut(store, ctx.env, 'tag', '-l', 'pre-engine-*').trim();
  assert.match(tag, /^pre-engine-\d/);
  assert.match(gitOut(store, ctx.env, 'show', `${tag}:automation/usage-dirty.jsonl`), /dirty-1/, 'the checkpoint holds the ledger');
  assertAllOk(runDoc(ctx, 'claude', CMD.doctor), 'doctor');
  const probe = runDoc(ctx, 'claude', CMD.probe);
  assert.equal(probe.status, 0, probe.out);
  assert.match(probe.stdout, /^fired\s+probe:claude/m);
  assertFixtureIntact(ctx, 'claude', pre);
});

test('gate variant offline: an unreachable remote — no fetch or push needed, the commands still pass', () => {
  const ctx = lerisqueRepo({ sync: true, remote: 'file:///nonexistent/b3-gate-remote.git' });
  const pre = before(ctx);
  const pkg = makePackage();
  assert.equal(runDoc(ctx, 'claude', CMD.copy, { pkg }).status, 0);
  rmSync(pkg, { recursive: true, force: true });
  const act = runDoc(ctx, 'claude', CMD.activate);
  assert.equal(act.status, 0, act.out);
  assert.match(act.stdout + act.stderr, /checkpoint pre-engine-\S+ taken/);
  assertAllOk(runDoc(ctx, 'claude', CMD.doctor), 'doctor');
  const probe = runDoc(ctx, 'claude', CMD.probe);
  assert.equal(probe.status, 0, probe.out);
  assert.match(probe.stdout, /^fired\s+probe:claude/m);
  assertFixtureIntact(ctx, 'claude', pre);
  assert.equal(gitOut(ctx.repo, ctx.env, 'remote', 'get-url', 'origin').trim(), 'file:///nonexistent/b3-gate-remote.git');
});

test('gate variant interrupted upgrade: a newer copy is inert until the documented activation is re-run', () => {
  const ctx = lerisqueRepo();
  const pre = before(ctx);
  const pkg = makePackage();
  assert.equal(runDoc(ctx, 'claude', CMD.copy, { pkg }).status, 0);
  rmSync(pkg, { recursive: true, force: true });
  assert.equal(runDoc(ctx, 'claude', CMD.activate).status, 0);
  assertAllOk(runDoc(ctx, 'claude', CMD.doctor), 'doctor before the upgrade');

  const upgrade = makePackage({ engine: '0.4.1' }); // the copy lands; activation is interrupted before it runs
  const copy = runDoc(ctx, 'claude', CMD.copy, { pkg: upgrade });
  assert.equal(copy.status, 0, copy.out);
  rmSync(upgrade, { recursive: true, force: true });
  const inert = runDoc(ctx, 'claude', CMD.doctor);
  assert.equal(inert.status, 1, inert.out);
  assert.match(inert.stdout, /^fail activation/m, inert.out);
  assert.match(inert.stdout, /0\.4\.1/);
  assert.equal(wiring(ctx).status, 0, 'LeRisque wiring is unaffected while the copy is inert');

  const act = runDoc(ctx, 'claude', CMD.activate);
  assert.equal(act.status, 0, act.out);
  assert.equal(JSON.parse(readFileSync(join(ctx.repo, '.agents', 'tokenomics', 'settings.json'), 'utf8')).engine, '0.4.1');
  const store = join(ctx.repo, '.agents', 'telemetry');
  assert.deepEqual(gitOut(store, ctx.env, 'tag', '-l', 'pre-engine-*').trim().split('\n').sort(), ['pre-engine-0.4.0', 'pre-engine-0.4.1']);
  assertAllOk(runDoc(ctx, 'claude', CMD.doctor), 'doctor after re-activation');
  const probe = runDoc(ctx, 'claude', CMD.probe);
  assert.equal(probe.status, 0, probe.out);
  assert.match(probe.stdout, /^fired\s+probe:claude/m);
  assertFixtureIntact(ctx, 'claude', pre);
});
