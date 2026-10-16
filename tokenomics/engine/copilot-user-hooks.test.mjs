// Copilot user-level wiring (install/read/remove) and the dispatcher it installs, run as the copied file it is on a
// real machine: a spawned child, in temp git repos, with COPILOT_HOME and HOME in a sandbox (never the real ~/.copilot).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installUserHooks, readUserHooks, userHooksFile, dispatchPath } from './copilot-user-hooks.mjs';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'ht-userhooks-'));
after(() => rmSync(sandbox, { recursive: true, force: true }));
let n = 0;
const fresh = (p) => { const d = join(sandbox, `${p}-${n++}`); mkdirSync(d, { recursive: true }); return d; };
const gitcfg = join(sandbox, 'gitconfig');
writeFileSync(gitcfg, '[init]\n\tdefaultBranch = main\n[user]\n\tname = t\n\temail = t@example.invalid\n');
const baseEnv = (home) => ({ PATH: process.env.PATH, HOME: home, COPILOT_HOME: join(home, '.copilot'), GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: '1' });

test('install writes the user-level hooks file and the dispatcher; a re-run touches nothing; read parses it; remove deletes both', () => {
  const env = baseEnv(fresh('home'));
  const first = installUserHooks({ skillRoot: SKILL, env });
  assert.deepEqual(first.sort(), [dispatchPath(env), userHooksFile(env)].sort());
  assert.ok(userHooksFile(env).startsWith(env.COPILOT_HOME), 'under COPILOT_HOME');
  assert.deepEqual(readFileSync(dispatchPath(env)), readFileSync(join(SKILL, 'hooks', 'copilot-user-hook.mjs')), 'the dispatcher is a verbatim copy');
  const doc = JSON.parse(readFileSync(userHooksFile(env), 'utf8'));
  assert.deepEqual(Object.keys(doc), ['version', 'hooks'], 'only the documented keys');
  assert.equal(doc.version, 1);
  assert.deepEqual(Object.keys(doc.hooks), ['sessionStart', 'sessionEnd', 'subagentStart', 'subagentStop', 'agentStop']);
  assert.equal(doc.hooks.sessionEnd[0].env.TOKENOMICS_HOOK_EVENT, 'sessionEnd');
  assert.deepEqual(installUserHooks({ skillRoot: SKILL, env }), [], 'idempotent');
  assert.deepEqual(readUserHooks(env).map((h) => `${h.event} ${h.script} ${h.args.join(' ')}`), [
    'sessionStart telemetry-capture --sweep', 'sessionStart scope-hook --announce --json', 'sessionEnd telemetry-capture --sweep',
    'subagentStart scope-hook --mark-dispatch', 'subagentStop telemetry-capture --dispatch', 'agentStop scope-hook --gate',
  ]);
  assert.deepEqual(installUserHooks({ env, remove: true }).sort(), [dispatchPath(env), userHooksFile(env)].sort());
  assert.equal(readUserHooks(env), null);
  assert.ok(!existsSync(userHooksFile(env)));
});

/** A repo with a fake installed copy whose hook scripts record argv, cwd and stdin; optionally activated. */
function fakeRepo({ activated = true, targets = ['copilot-cli'], stopGate = 'off', rel = '.github/skills/tokenomics', engine = '9.9.9' } = {}) {
  const repo = fresh('repo');
  execFileSync('git', ['init', '-q', repo], { env: baseEnv(sandbox) });
  const log = join(repo, '..', `calls-${n++}.jsonl`);
  const copy = join(repo, rel);
  mkdirSync(join(copy, 'hooks'), { recursive: true });
  for (const s of ['telemetry-capture', 'scope-hook']) {
    writeFileSync(join(copy, 'hooks', `${s}.mjs`), `import { appendFileSync, readFileSync } from 'node:fs';
let stdin = ''; try { stdin = readFileSync(0, 'utf8'); } catch {}
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ script: ${JSON.stringify(s)}, argv: process.argv.slice(2), cwd: process.cwd(), stdin, event: process.env.TOKENOMICS_HOOK_EVENT ?? null }) + '\\n');
process.stdout.write('from ${s}\\n');
`);
  }
  writeFileSync(join(copy, 'ENGINE.json'), JSON.stringify({ engine, installed: { target: 'copilot' } }));
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  if (activated) writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ engine, targets, enforcement: { stopGate } }));
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  return { repo, log, copy };
}
const calls = (log) => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function dispatchFrom(cwd, args, env, input = '') {
  return spawnSync(process.execPath, [dispatchPath(env), ...args], { cwd, env: { ...env, TOKENOMICS_HOOK_EVENT: 'sessionEnd' }, input, encoding: 'utf8' });
}

test('dispatcher: from a subdirectory of an activated repo it runs that repo\'s copy at the repo root, with stdin, stdout and env', () => {
  const env = baseEnv(fresh('home'));
  installUserHooks({ skillRoot: SKILL, env });
  const { repo, log } = fakeRepo();
  const r = dispatchFrom(join(repo, 'src', 'deep'), ['telemetry-capture', '--sweep'], env, '{"sessionId":"s1"}');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'from telemetry-capture\n', 'the hook\'s stdout reaches Copilot');
  const [c] = calls(log);
  assert.deepEqual(c.argv, ['--sweep']);
  assert.equal(statSync(c.cwd).ino, statSync(repo).ino, 'runs at the repo root');
  assert.equal(c.stdin, '{"sessionId":"s1"}', 'stdin is passed through');
  assert.equal(c.event, 'sessionEnd', 'env is passed through');
});

test('dispatcher: outside a repo, in a repo that never activated, or activated for another host only — exit 0, nothing runs', () => {
  const env = baseEnv(fresh('home'));
  installUserHooks({ skillRoot: SKILL, env });
  const outside = fresh('not-a-repo');
  const r0 = dispatchFrom(outside, ['telemetry-capture', '--sweep'], env);
  assert.equal(r0.status, 0); assert.equal(r0.stdout, '');
  for (const opts of [{ activated: false }, { targets: ['claude'] }]) {
    const { repo, log } = fakeRepo(opts);
    const r = dispatchFrom(repo, ['telemetry-capture', '--sweep'], env);
    assert.equal(r.status, 0); assert.equal(r.stdout, '');
    assert.deepEqual(calls(log), [], JSON.stringify(opts));
  }
  const { repo, log } = fakeRepo();
  assert.equal(dispatchFrom(repo, ['rm', '-rf'], env).status, 0, 'an unknown script is never run');
  assert.deepEqual(calls(log), []);
});

test('dispatcher: the Stop gate runs only where enforcement.stopGate is "on"; the copy matching the activation record wins', () => {
  const env = baseEnv(fresh('home'));
  installUserHooks({ skillRoot: SKILL, env });
  const off = fakeRepo({ stopGate: 'off' });
  assert.equal(dispatchFrom(off.repo, ['scope-hook', '--gate'], env).stdout, '');
  assert.deepEqual(calls(off.log), []);
  const on = fakeRepo({ stopGate: 'on' });
  assert.equal(dispatchFrom(on.repo, ['scope-hook', '--gate'], env).stdout, 'from scope-hook\n');
  // a stale .github copy and a current .claude copy: the one whose ENGINE.json matches settings.engine runs
  const both = fakeRepo({ engine: '2.0.0' });
  writeFileSync(join(both.copy, 'ENGINE.json'), JSON.stringify({ engine: '1.0.0', installed: {} }));
  const claudeCopy = join(both.repo, '.claude', 'skills', 'tokenomics');
  mkdirSync(join(claudeCopy, 'hooks'), { recursive: true });
  for (const s of ['telemetry-capture', 'scope-hook']) copyFileSync(join(both.copy, 'hooks', `${s}.mjs`), join(claudeCopy, 'hooks', `${s}.mjs`));
  writeFileSync(join(claudeCopy, 'hooks', 'telemetry-capture.mjs'), "process.stdout.write('claude copy\\n');\n");
  writeFileSync(join(claudeCopy, 'ENGINE.json'), JSON.stringify({ engine: '2.0.0', installed: {} }));
  assert.equal(dispatchFrom(both.repo, ['telemetry-capture', '--sweep'], env).stdout, 'claude copy\n');
});

test('dispatcher: a linked worktree without its own copy is served by the primary worktree\'s', () => {
  const env = baseEnv(fresh('home'));
  installUserHooks({ skillRoot: SKILL, env });
  const { repo, log } = fakeRepo();
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { env: baseEnv(sandbox), stdio: 'ignore' });
  writeFileSync(join(repo, 'README.md'), 'x\n');
  g('add', 'README.md'); g('commit', '-q', '-m', 'init');
  const wt = join(fresh('wt'), 'linked');
  g('worktree', 'add', '-q', wt);
  const r = dispatchFrom(wt, ['telemetry-capture', '--sweep'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statSync(calls(log)[0].cwd).ino, statSync(repo).ino, 'run at the primary worktree, which holds the store');
});

const waitFor = async (cond, ms = 8000) => { const until = Date.now() + ms; while (Date.now() < until) { if (cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return cond(); };

test('dispatcher sessionEnd: Copilot writes session.shutdown after the hook, so a detached waiter sweeps once it appears; never without it', async () => {
  const env0 = baseEnv(fresh('home'));
  installUserHooks({ skillRoot: SKILL, env: env0 });
  const root = fresh('copilot-store');
  const env = { ...env0, TOKENOMICS_COPILOT_ROOT: root, TOKENOMICS_AWAIT_MS: '4000' };
  const sessionEnd = (repo, sid) => spawnSync(process.execPath, [dispatchPath(env), 'telemetry-capture', '--sweep'],
    { cwd: repo, env: { ...env, TOKENOMICS_HOOK_EVENT: 'sessionEnd' }, input: JSON.stringify({ sessionId: sid }), encoding: 'utf8' });
  const events = (sid, types) => { mkdirSync(join(root, sid), { recursive: true }); writeFileSync(join(root, sid, 'events.jsonl'), types.map((type) => JSON.stringify({ type })).join('\n') + '\n'); };

  // the hook runs before the shutdown: the immediate capture, then the deferred one once session.shutdown lands
  const a = fakeRepo();
  events('s-late', ['session.start', 'hook.start']);
  const t0 = Date.now();
  assert.equal(sessionEnd(a.repo, 's-late').status, 0);
  assert.ok(Date.now() - t0 < 3000, 'Copilot is never kept waiting');
  assert.equal(calls(a.log).length, 1, 'the immediate capture');
  assert.equal(calls(a.log)[0].event, 'sessionEnd');
  events('s-late', ['session.start', 'hook.start', 'hook.end', 'session.usage_checkpoint', 'session.shutdown']);
  assert.ok(await waitFor(() => calls(a.log).length === 2), 'the deferred sweep ran after the shutdown');
  const late = calls(a.log)[1];
  assert.deepEqual(late.argv, ['--sweep']);
  assert.equal(late.event, null, 'the deferred sweep is not a hook firing');

  // already shut down when the hook ran (an older CLI): no waiter
  const b = fakeRepo();
  events('s-done', ['session.start', 'session.shutdown']);
  assert.equal(sessionEnd(b.repo, 's-done').status, 0);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(calls(b.log).length, 1);

  // never shuts down within the bound: the waiter gives up without sweeping
  const c = fakeRepo();
  events('s-hung', ['session.start']);
  assert.equal(sessionEnd(c.repo, 's-hung').status, 0);
  await new Promise((r) => setTimeout(r, 5500));
  assert.equal(calls(c.log).length, 1);
});
