// doctor --probe (Plan 5 Task 10, D-PROBE, spec §14.9). Every case spawns doctor from an installed copy against a
// consumer repo wired by the real host installers; the host CLI is a fake (fixtures/probe/), found on a PATH that
// holds no real `claude` or `copilot` (owner decision 2026-10-14). Git is isolated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCopy } from './install-copy.mjs';
import { installUserHooks } from './copilot-user-hooks.mjs';
import { installClaude, installCopilot, installGitHook } from '../scripts/install-hooks.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const FAKES = join(ROOT, 'tokenomics', 'fixtures', 'probe');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'tokenomics', 'ENGINE.json'), 'utf8')).engine;
const REL = { claude: '.claude/skills/tokenomics', 'copilot-cli': '.github/skills/tokenomics' };
const TEL = '.agents/telemetry/tokenomics';
const SYSTEM_PATH = ['/usr/bin', '/bin'];

const sandbox = mkdtempSync(join(tmpdir(), 'ht-probe-'));
process.on('exit', () => { unlock(sandbox); rmSync(sandbox, { recursive: true, force: true }); });
const gitconfig = join(sandbox, 'gitconfig');
writeFileSync(gitconfig, '[user]\n\tuseConfigOnly = true\n[init]\n\tdefaultBranch = main\n');

// The bin directory: node, and the fakes under the host CLI names. No real host binary is reachable from PATH.
const bin = join(sandbox, 'bin');
mkdirSync(bin);
symlinkSync(process.execPath, join(bin, 'node'));
const wrapper = (name, fake) => { writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(FAKES, fake)}" "$@"\n`); chmodSync(join(bin, name), 0o755); };
wrapper('claude', 'fake-claude.mjs');
wrapper('copilot', 'fake-copilot.mjs');
const emptyBin = join(sandbox, 'empty-bin');
mkdirSync(emptyBin);
symlinkSync(process.execPath, join(emptyBin, 'node'));
for (const d of SYSTEM_PATH) for (const n of ['claude', 'copilot']) assert.ok(!existsSync(join(d, n)), `a real ${n} at ${d} would be reachable from the test PATH`);

const ID = ['-c', 'user.name=Probe Tester', '-c', 'user.email=probe@example.invalid'];
function baseEnv(home, extra = {}) {
  return {
    PATH: [bin, ...SYSTEM_PATH].join(delimiter), HOME: home, COPILOT_HOME: join(home, '.copilot'), TMPDIR: process.env.TMPDIR ?? tmpdir(),
    GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Probe Tester', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'Probe Tester', GIT_COMMITTER_EMAIL: 'probe@example.invalid',
    TOKENOMICS_CLAUDE_ROOT: join(home, 'claude-project'), TOKENOMICS_COPILOT_ROOT: join(home, 'copilot-state'), TOKENOMICS_VSCODE_ROOT: join(home, 'vscode'),
    TOKENOMICS_PROBE_LATE_MS: '0', // a capture that never lands is not waited for; the late-capture test sets its own
    ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}),
    ...extra,
  };
}
const git = (cwd, env, ...a) => {
  const r = spawnSync('git', [...ID, ...a], { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const writeJson = (p, o) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const MODULE = { module: 'tokenomics', schema_version: '1', domain: 'tokenomics', manifestRevision: 1,
  receipts: { source: 'files', root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red'] },
  ratioIntents: ['automation'] };

/** An activated consumer repo wired for `hosts` (the first one's copy), its telemetry store committed. */
function fixture({ hosts = ['claude'], stopGate = false, gitHook = false, engine = VERSION, targets = hosts, userHooks = false } = {}) {
  const repo = mkdtempSync(join(sandbox, 'repo-'));
  const home = mkdtempSync(join(sandbox, 'home-'));
  const env = baseEnv(home);
  git(repo, env, 'init', '-q');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  for (const host of hosts) {
    installCopy({ packageRoot: ROOT, repo, target: host === 'claude' ? 'claude' : 'copilot' });
    if (host === 'claude') installClaude(repo, REL.claude, { stopGate });
    else if (userHooks) installUserHooks({ skillRoot: join(repo, REL['copilot-cli']), env });
    else installCopilot(repo, REL['copilot-cli'], { stopGate });
  }
  writeJson(join(repo, '.agents', 'tokenomics', 'settings.json'),
    { dir: 'tokenomics', extension: null, engine, targets, enforcement: { announce: true, stopGate: stopGate ? 'on' : 'off' } });
  // The repo's own store: what the probe must never touch.
  writeJson(join(repo, TEL, 'module.json'), MODULE);
  writeJson(join(repo, TEL, 'manifests', '1.json'), MODULE);
  writeFileSync(join(repo, TEL, 'usage-someone.jsonl'), `${JSON.stringify({ v: 1, host: 'claude', id: 'old-1', startedAt: '2026-01-01T00:00:00.000Z' })}\n`);
  writeJson(join(repo, TEL, 'scopes', 'claude', 'old-1.json'), { session: 'old-1', intent: 'automation', cases: [] });
  git(repo, env, 'add', '-A');
  git(repo, env, 'commit', '-q', '-m', 'fixture');
  if (gitHook) assert.equal(installGitHook(repo, REL[hosts[0]]).status, 'installed'); // after the commit: no sweep runs now
  return { repo, home, env };
}

function probe({ repo, env }, args = [], extra = {}) {
  const log = join(sandbox, `fake-${createHash('sha1').update(repo + args.join(' ') + JSON.stringify(extra)).digest('hex').slice(0, 10)}.jsonl`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(repo, REL.claude, 'scripts', 'doctor.mjs'), '--probe', '--repo', repo, '--json', ...args],
    { cwd: repo, env: { ...env, FAKE_PROBE_LOG: log, ...extra }, encoding: 'utf8', timeout: 60000 });
  let probes = null;
  try { probes = Object.fromEntries(JSON.parse(r.stdout).probes.map((p) => [p.host, p])); } catch { /* reported by the assertion */ }
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { ...r, probes, calls, ms: Date.now() - t0 };
}

function unlock(dir) {
  if (!existsSync(dir)) return;
  const go = (d) => { try { chmodSync(d, 0o755); } catch { /* gone */ } for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !e.isSymbolicLink()) go(join(d, e.name)); };
  try { go(dir); } catch { /* best effort */ }
}

/** Every file under `root` (excluding .git) with its bytes' hash. */
function snapshot(root) {
  const out = {};
  const go = (d, p) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const rel = p ? `${p}/${e.name}` : e.name;
      if (e.isDirectory()) go(join(d, e.name), rel);
      else out[rel] = createHash('sha256').update(readFileSync(join(d, e.name))).digest('hex');
    }
  };
  if (existsSync(root)) go(root, '');
  return out;
}

const show = (r) => `${r.status}\n${r.stdout}\n${r.stderr}`;

test('(a) claude: every wired event fires, the line is written, the scope is stamped → fired, hooks', () => {
  const fx = fixture();
  const r = probe(fx, ['--host', 'claude']);
  assert.equal(r.status, 0, show(r));
  const p = r.probes?.claude;
  assert.ok(p, show(r));
  assert.equal(p.result, 'fired', show(r));
  assert.equal(p.mode, 'hooks');
  assert.deepEqual(p.events, { SessionEnd: 'fired', SessionStart: 'fired', PreToolUse: 'fired', SubagentStop: 'fired' });
  assert.deepEqual(p.expected, { ledgerLine: 'present', scopeStamp: 'present' });
  // D-PROBE host command: claude -p <prompt> --model <cheap>; the prompt asks for one dispatch and names the nonce
  assert.equal(r.calls.length, 1);
  const argv = r.calls[0].argv;
  assert.equal(argv[0], '-p');
  assert.equal(argv[2], '--model');
  assert.equal(argv[3], 'haiku');
  assert.match(argv[1], /[0-9a-f]{32}/);
  assert.match(argv[1], /sub-agent/);
  const t = spawnSync(process.execPath, [join(fx.repo, REL.claude, 'scripts', 'doctor.mjs'), '--probe', '--repo', fx.repo, '--host', 'claude'], { cwd: fx.repo, env: fx.env, encoding: 'utf8', timeout: 60000 });
  assert.equal(t.status, 0, show(t));
  assert.match(t.stdout, /^fired\s+probe:claude/m);
});

test('(a) the expected events come from the wired config: Stop with the gate on, none for an unwired event', () => {
  const fx = fixture({ stopGate: true });
  const f = join(fx.repo, '.claude', 'settings.json');
  const s = readJson(f);
  delete s.hooks.PreToolUse;
  writeJson(f, s);
  const p = probe(fx, ['--host', 'claude']).probes.claude;
  assert.deepEqual(p.events, { SessionEnd: 'fired', SessionStart: 'fired', Stop: 'fired', SubagentStop: 'fired' });
  assert.equal(p.result, 'fired');
});

test('(a) copilot-cli (R25): each wired command names its event through TOKENOMICS_HOOK_EVENT, so sessionStart and sessionEnd sharing the sweep command both read fired', () => {
  const fx = fixture({ hosts: ['copilot-cli'], stopGate: true });
  const d = spawnSync(process.execPath, [join(fx.repo, REL['copilot-cli'], 'scripts', 'doctor.mjs'), '--probe', '--repo', fx.repo, '--json', '--host', 'copilot', '--keep-state'], { cwd: fx.repo, env: fx.env, encoding: 'utf8', timeout: 60000 });
  assert.equal(d.status, 0, show(d));
  const p = JSON.parse(d.stdout).probes[0];
  assert.equal(p.host, 'copilot-cli');
  assert.deepEqual(p.events, { sessionStart: 'fired', sessionEnd: 'fired', subagentStart: 'fired', subagentStop: 'fired', agentStop: 'fired' });
  assert.deepEqual(p.expected, { ledgerLine: 'present', scopeStamp: 'present' });
  assert.equal(p.result, 'fired', show(d));
  // the names come from the wiring's env (the CLI's payload names none), one per wired command
  const dir = join(p.stateDir, 'probe');
  const recs = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(recs.filter((r) => r.entry === 'telemetry-capture --sweep').map((r) => r.event).sort(), ['sessionEnd', 'sessionStart']);
  rmSync(p.stateDir, { recursive: true, force: true });
});

test('(a) copilot-cli: an older wiring without TOKENOMICS_HOOK_EVENT leaves the shared sweep entry unattributed — never fired by counting (R21)', () => {
  const fx = fixture({ hosts: ['copilot-cli'], stopGate: true });
  const f = join(fx.repo, '.github', 'hooks', 'tokenomics.json');
  const cfg = readJson(f);
  for (const list of Object.values(cfg.hooks)) for (const c of list) delete c.env.TOKENOMICS_HOOK_EVENT;
  writeJson(f, cfg);
  const d = spawnSync(process.execPath, [join(fx.repo, REL['copilot-cli'], 'scripts', 'doctor.mjs'), '--probe', '--repo', fx.repo, '--json', '--host', 'copilot'], { cwd: fx.repo, env: fx.env, encoding: 'utf8', timeout: 60000 });
  assert.equal(d.status, 1, show(d));
  const p = JSON.parse(d.stdout).probes[0];
  // sessionStart is proven by its own entry (the announce); sessionEnd runs only the shared sweep entry
  assert.deepEqual(p.events, { sessionStart: 'fired', sessionEnd: 'unattributed', subagentStart: 'fired', subagentStop: 'fired', agentStop: 'fired' });
  assert.equal(p.result, 'not-fired', show(d));
  assert.match(p.reason, /unattributed: sessionEnd/);
});

test('(a) Codex B3-04 repro D: a repeated sessionStart (no sessionEnd at all) never reads sessionEnd fired', () => {
  const fx = fixture({ hosts: ['copilot-cli'], stopGate: true });
  const d = spawnSync(process.execPath, [join(fx.repo, REL['copilot-cli'], 'scripts', 'doctor.mjs'), '--probe', '--repo', fx.repo, '--json', '--host', 'copilot'],
    { cwd: fx.repo, env: { ...fx.env, FAKE_PROBE_MODE: 'repeat-start' }, encoding: 'utf8', timeout: 60000 });
  const p = JSON.parse(d.stdout).probes[0];
  assert.equal(p.events.sessionEnd, 'not-fired', show(d)); // both sweeps are named sessionStart (R25)
  assert.notEqual(p.result, 'fired');
  assert.equal(d.status, 1);
});

test('firedEvents (R21): a named record proves its event; an unnamed one proves only an event whose entry is its own; a shared entry is unattributed', async () => {
  const { firedEvents } = await import('./probe.mjs');
  const wired = [
    { event: 'sessionStart', keys: ['telemetry-capture --sweep', 'scope-hook --announce'] },
    { event: 'sessionEnd', keys: ['telemetry-capture --sweep'] },
    { event: 'subagentStop', keys: ['telemetry-capture --dispatch'] },
    { event: 'agentStop', keys: ['scope-hook --gate'] },
  ];
  const sweep = { event: null, entry: 'telemetry-capture --sweep' };
  // two unnamed sweeps: no count ever turns the second into sessionEnd
  assert.deepEqual(firedEvents(wired, [sweep, sweep, { event: null, entry: 'scope-hook --announce' }]),
    { sessionStart: 'fired', sessionEnd: 'unattributed', subagentStop: 'not-fired', agentStop: 'not-fired' });
  // a host that names its events: each record proves exactly the event it names
  assert.deepEqual(firedEvents(wired, [{ event: 'sessionStart', entry: 'telemetry-capture --sweep' }, { event: 'sessionStart', entry: 'telemetry-capture --sweep' }]),
    { sessionStart: 'fired', sessionEnd: 'not-fired', subagentStop: 'not-fired', agentStop: 'not-fired' });
  assert.deepEqual(firedEvents(wired, [{ event: 'sessionEnd', entry: 'telemetry-capture --sweep' }, { event: null, entry: 'telemetry-capture --dispatch' }]),
    { sessionStart: 'not-fired', sessionEnd: 'fired', subagentStop: 'fired', agentStop: 'not-fired' });
  // a named record for an event whose entry it did not run proves nothing; an unwired name proves nothing
  assert.deepEqual(firedEvents(wired, [{ event: 'agentStop', entry: 'telemetry-capture --sweep' }, { event: 'Other', entry: 'scope-hook --gate' }]),
    { sessionStart: 'not-fired', sessionEnd: 'not-fired', subagentStop: 'not-fired', agentStop: 'not-fired' });
});

test('(a) Codex B3-03 repro C: an unrelated recent session with a scope is never the probe\'s expected result', () => {
  const fx = fixture();
  const r = probe(fx, ['--host', 'claude', '--keep-state'], { FAKE_PROBE_MODE: 'unrelated' });
  const p = r.probes?.claude;
  assert.ok(p, show(r));
  // the attack is live: the state ledger does hold the unrelated session, stamped
  const tel = join(p.stateDir, 'telemetry', 'tokenomics');
  const lines = readdirSync(tel).filter((f) => f.startsWith('usage-')).flatMap((f) => readFileSync(join(tel, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
  assert.ok(lines.some((l) => l.id.startsWith('unrelated-') && l.scope), JSON.stringify(lines));
  assert.equal(p.expected.ledgerLine, 'missing', show(r));
  assert.equal(p.expected.scopeStamp, 'missing');
  assert.equal(p.result, 'not-fired');
  assert.match(p.reason, /ledger line is missing/);
  assert.equal(r.status, 1);
  rmSync(p.stateDir, { recursive: true, force: true });
  // the fallback uses the same identity: with session-end hooks suppressed it is never sweep-only (partial)
  const g = fixture({ gitHook: true });
  const f = probe(g, ['--host', 'claude'], { FAKE_PROBE_MODE: 'unrelated-no-end' });
  const q = f.probes?.claude;
  assert.ok(q, show(f));
  assert.equal(q.mode, 'hooks', show(f));
  assert.equal(q.result, 'not-fired');
  assert.equal(q.expected.ledgerLine, 'missing');
  assert.match(q.reason, /the git post-commit sweep did not capture it either/);
  assert.equal(f.status, 1);
});

test('(a) R22: with no session id in any payload the probe finds its session by the nonce in the first prompt', () => {
  const fx = fixture();
  const r = probe(fx, ['--host', 'claude'], { FAKE_PROBE_NO_SESSION_ID: '1' });
  assert.equal(r.probes?.claude?.result, 'fired', show(r));
  assert.deepEqual(r.probes.claude.expected, { ledgerLine: 'present', scopeStamp: 'present' });
  // …and the nonce never matches an unrelated session
  const u = probe(fixture(), ['--host', 'claude'], { FAKE_PROBE_NO_SESSION_ID: '1', FAKE_PROBE_MODE: 'unrelated' });
  assert.equal(u.probes?.claude?.expected.ledgerLine, 'missing', show(u));
  // copilot without sessionId in its payloads: the events.jsonl whose first user message carries the nonce
  const c = fixture({ hosts: ['copilot-cli'] });
  const d = spawnSync(process.execPath, [join(c.repo, REL['copilot-cli'], 'scripts', 'doctor.mjs'), '--probe', '--repo', c.repo, '--json', '--host', 'copilot'],
    { cwd: c.repo, env: { ...c.env, FAKE_PROBE_NO_SESSION_ID: '1' }, encoding: 'utf8', timeout: 60000 });
  assert.deepEqual(JSON.parse(d.stdout).probes[0].expected, { ledgerLine: 'present', scopeStamp: 'present' }, show(d));
});

test('(b) a crashing session-end capture: Stop and SessionEnd fired, ledger line missing, not success', () => {
  const fx = fixture({ stopGate: true });
  const r = probe(fx, ['--host', 'claude'], { FAKE_PROBE_MODE: 'crash-end' });
  const p = r.probes?.claude;
  assert.ok(p, show(r));
  assert.equal(p.events.Stop, 'fired');
  assert.equal(p.events.SessionEnd, 'fired');
  assert.equal(p.expected.ledgerLine, 'missing');
  assert.notEqual(p.result, 'fired');
  assert.match(p.reason, /ledger line/);
  assert.equal(r.status, 1, show(r));
});

test('(c) the CLI is not on PATH (or the override names nothing): unavailable — claude CLI not found', () => {
  const fx = fixture();
  let r = probe(fx, ['--host', 'claude'], { PATH: [emptyBin, ...SYSTEM_PATH].join(delimiter) });
  assert.equal(r.probes?.claude?.result, 'unavailable', show(r));
  assert.equal(r.probes.claude.reason, 'claude CLI not found');
  assert.equal(r.calls.length, 0);
  r = probe(fx, ['--host', 'claude'], { TOKENOMICS_PROBE_CLAUDE_BIN: join(sandbox, 'no-such-claude') });
  assert.equal(r.probes.claude.result, 'unavailable');
  assert.equal(r.probes.claude.reason, 'claude CLI not found');
  // the override reaches a fake that is not on PATH at all
  r = probe(fx, ['--host', 'claude'], { PATH: [emptyBin, ...SYSTEM_PATH].join(delimiter), TOKENOMICS_PROBE_CLAUDE_BIN: join(FAKES, 'fake-claude.mjs') });
  assert.equal(r.probes.claude.result, 'fired', show(r));
});

test('(d) an auth failure: unavailable — auth', () => {
  const fx = fixture();
  const r = probe(fx, ['--host', 'claude'], { FAKE_PROBE_MODE: 'auth' });
  assert.equal(r.probes?.claude?.result, 'unavailable', show(r));
  assert.equal(r.probes.claude.reason, 'auth');
  assert.equal(r.calls.length, 1);
  const tr = probe(fx, ['--host', 'claude'], { FAKE_PROBE_MODE: 'trust' });
  assert.equal(tr.probes.claude.result, 'unavailable');
  assert.equal(tr.probes.claude.reason, 'folder not trusted');
});

test('(e) a hanging CLI is killed at --timeout 3: under 5 s, the later events not-fired, never fired', () => {
  const fx = fixture();
  const r = probe(fx, ['--host', 'claude', '--timeout', '3'], { FAKE_PROBE_MODE: 'hang' });
  assert.ok(r.ms < 5000, `wall clock ${r.ms} ms`);
  const p = r.probes?.claude;
  assert.ok(p, show(r));
  assert.notEqual(p.result, 'fired');
  assert.equal(p.result, 'not-fired');
  assert.match(p.reason, /timed out after 3 s/);
  assert.equal(p.events.SessionStart, 'fired');
  for (const e of ['SessionEnd', 'PreToolUse', 'SubagentStop']) assert.equal(p.events[e], 'not-fired', e);
  assert.equal(r.status, 1);
  const pid = r.calls[0].pid;
  assert.throws(() => process.kill(pid, 0), 'the hung child was killed');
  const grandchild = r.calls.find((c) => c.grandchild)?.grandchild;
  assert.ok(grandchild, 'the fake started a grandchild');
  assert.throws(() => process.kill(grandchild, 0), 'the whole process group was killed');
});

test('(e) a hang never falls back to the sweep: with a git hook installed and the transcript written, still not-fired within the bound', () => {
  const fx = fixture({ gitHook: true });
  const r = probe(fx, ['--host', 'claude', '--timeout', '3'], { FAKE_PROBE_MODE: 'hang' });
  assert.ok(r.ms < 5000, `wall clock ${r.ms} ms`);
  const p = r.probes?.claude;
  assert.ok(p, show(r));
  assert.equal(p.mode, 'hooks', show(r));
  assert.equal(p.result, 'not-fired');
  assert.match(p.reason, /timed out after 3 s/);
  assert.doesNotMatch(p.reason, /sweep/);
  assert.equal(r.status, 1, 'a timeout is a fail, never an accepted partial');
});

test('(f) partial never hides a missing scope stamp: it is reported alongside', () => {
  const fx = fixture({ gitHook: true });
  const r = probe(fx, ['--host', 'claude'], { FAKE_PROBE_MODE: 'no-session-end', FAKE_PROBE_NO_SCOPE: '1' });
  const p = r.probes?.claude;
  assert.ok(p, show(r));
  assert.equal(p.mode, 'sweep-only (partial)', show(r));
  assert.deepEqual(p.expected, { ledgerLine: 'present', scopeStamp: 'missing' });
  assert.match(p.reason, /scope stamp/);
  const t = spawnSync(process.execPath, [join(fx.repo, REL.claude, 'scripts', 'doctor.mjs'), '--probe', '--repo', fx.repo, '--host', 'claude'],
    { cwd: fx.repo, env: { ...fx.env, FAKE_PROBE_MODE: 'no-session-end', FAKE_PROBE_NO_SCOPE: '1' }, encoding: 'utf8', timeout: 60000 });
  assert.match(t.stdout, /^partial\s+probe:claude .*scope stamp missing/m, show(t));
});

test('(f) session-end hooks suppressed with a git hook installed: sweep-only (partial)', () => {
  const fx = fixture({ gitHook: true });
  const r = probe(fx, ['--host', 'claude'], { FAKE_PROBE_MODE: 'no-session-end' });
  const p = r.probes?.claude;
  assert.ok(p, show(r));
  assert.equal(p.mode, 'sweep-only (partial)', show(r));
  assert.equal(p.events.SessionEnd, 'not-fired');
  assert.equal(p.events.SessionStart, 'fired');
  assert.equal(p.expected.ledgerLine, 'present');
  assert.notEqual(p.result, 'fired');
  assert.equal(r.status, 0, 'partial is accepted (a warning)');
  assert.equal(probe(fx, ['--host', 'claude', '--strict'], { FAKE_PROBE_MODE: 'no-session-end' }).status, 1, '--strict fails a partial');
  // without the git hook there is no fallback: not-fired, mode hooks
  const bare = fixture();
  const b = probe(bare, ['--host', 'claude'], { FAKE_PROBE_MODE: 'no-session-end' });
  assert.equal(b.probes.claude.mode, 'hooks');
  assert.equal(b.probes.claude.result, 'not-fired');
  assert.equal(b.status, 1);
});

test('(g) isolation: the repo store is byte-identical (status, tree hash) and every write lands in the state dir', () => {
  const fx = fixture();
  const before = { files: snapshot(fx.repo), status: git(fx.repo, fx.env, 'status', '--porcelain', '--ignored', '--untracked-files=all'), tree: git(fx.repo, fx.env, 'rev-parse', 'HEAD^{tree}'), index: git(fx.repo, fx.env, 'ls-files', '-s') };
  const r = probe(fx, ['--host', 'claude', '--keep-state']);
  const p = r.probes?.claude;
  assert.equal(p?.result, 'fired', show(r));
  assert.deepEqual(snapshot(fx.repo), before.files);
  assert.equal(git(fx.repo, fx.env, 'status', '--porcelain', '--ignored', '--untracked-files=all'), before.status);
  assert.equal(git(fx.repo, fx.env, 'rev-parse', 'HEAD^{tree}'), before.tree);
  assert.equal(git(fx.repo, fx.env, 'ls-files', '-s'), before.index);
  assert.ok(p.stateDir && existsSync(p.stateDir), 'the kept state dir');
  const state = Object.keys(snapshot(p.stateDir));
  assert.ok(state.some((f) => /^probe\/[0-9a-f]{32}\.jsonl$/.test(f)), state.join(', '));
  assert.ok(state.some((f) => /^telemetry\/tokenomics\/usage-.*\.jsonl$/.test(f)), state.join(', '));
  assert.ok(state.some((f) => /^telemetry\/tokenomics\/scopes\/claude\/.+\.json$/.test(f)), state.join(', '));
  const fired = readFileSync(join(p.stateDir, state.find((f) => f.startsWith('probe/'))), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  // R21/R22: each record names the host's own event (hook_event_name) and the probe session, beside the entry that ran
  const sessions = new Set();
  for (const rec of fired) {
    assert.deepEqual(Object.keys(rec), ['event', 'entry', 'host', 'session', 'at']);
    assert.equal(rec.host, 'claude');
    assert.ok(['SessionStart', 'PreToolUse', 'SubagentStop', 'SessionEnd'].includes(rec.event), rec.event);
    assert.match(rec.entry, /^(telemetry-capture|scope-hook)/);
    sessions.add(rec.session);
  }
  assert.equal(sessions.size, 1);
  assert.match([...sessions][0], /^[0-9a-f-]{36}$/);
  // without --keep-state the state dir is removed
  const q = probe(fx, ['--host', 'claude']).probes.claude;
  assert.equal(q.stateDir, undefined);
  rmSync(p.stateDir, { recursive: true, force: true });
});

test('(h) recursion guard: TOKENOMICS_PROBE already set → exit 2, a probe never triggers another probe', () => {
  const fx = fixture();
  const r = probe(fx, ['--host', 'claude'], { TOKENOMICS_PROBE: 'a'.repeat(32) });
  assert.equal(r.status, 2, show(r));
  assert.match(r.stderr, /a probe never triggers another probe/);
  assert.equal(r.calls.length, 0, 'no host CLI started');
});

test('hosts: every settings.targets host; vscode is unavailable (no hooks), never inferred', () => {
  const fx = fixture({ targets: ['claude', 'vscode'] });
  const r = probe(fx);
  assert.equal(r.probes?.claude?.result, 'fired', show(r));
  assert.equal(r.probes.vscode.result, 'unavailable');
  assert.equal(r.probes.vscode.reason, 'no hooks; verify with a real sidebar session and a sweep (C2)');
  assert.equal(r.status, 0);
});

test('an inert wired copy: the hooks still prove they fired, and the probe says the engine is inert', () => {
  const fx = fixture({ engine: '0.0.1' });
  const r = probe(fx, ['--host', 'claude']);
  const p = r.probes?.claude;
  assert.ok(p, show(r));
  assert.equal(p.events.SessionStart, 'fired');
  assert.equal(p.expected.ledgerLine, 'missing');
  assert.equal(p.result, 'not-fired');
  assert.match(p.reason, /inert/);
  assert.match(p.reason, /activation records engine 0\.0\.1/);
  assert.equal(r.status, 1);
});

test('usage: an unknown --host or a bad --timeout exits 2', () => {
  const fx = fixture();
  assert.equal(probe(fx, ['--host', 'nope']).status, 2);
  assert.equal(probe(fx, ['--host', 'claude', '--timeout', '0']).status, 2);
  assert.equal(probe(fx, ['--host', 'claude', '--timeout', 'x']).status, 2);
  assert.equal(probe(fx, ['--host', 'claude', '--timeout', '3000000']).status, 2, 'beyond the setTimeout range');
});

test('hooks record nothing without the nonce, and the state dir moves the store only when set', () => {
  // a plain run of a hook entry (no TOKENOMICS_PROBE) writes no fired log anywhere under the state dir
  const fx = fixture();
  const state = mkdtempSync(join(sandbox, 'state-'));
  const r = spawnSync(process.execPath, [join(fx.repo, REL.claude, 'hooks', 'scope-hook.mjs'), '--mark-dispatch'],
    { cwd: fx.repo, env: { ...fx.env, CLAUDE_PROJECT_DIR: fx.repo, TOKENOMICS_STATE_DIR: state }, input: JSON.stringify({ session_id: 's9', cwd: fx.repo }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(state, 'probe')));
  assert.ok(existsSync(join(state, 'telemetry', 'tokenomics', 'scopes', '.pending-s9')), 'the marker lands in the state dir');
  assert.ok(!existsSync(join(fx.repo, TEL, 'scopes', '.pending-s9')));
  // a malformed nonce is ignored, never a path
  const bad = spawnSync(process.execPath, [join(fx.repo, REL.claude, 'hooks', 'scope-hook.mjs'), '--mark-dispatch'],
    { cwd: fx.repo, env: { ...fx.env, CLAUDE_PROJECT_DIR: fx.repo, TOKENOMICS_STATE_DIR: state, TOKENOMICS_PROBE: '../../x' }, input: JSON.stringify({ session_id: 's9', cwd: fx.repo }), encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.ok(!existsSync(join(state, 'probe')));
  assert.ok(statSync(state).isDirectory());
});

// --- final review I3 (R17): the probe's real host session is never captured by a later ordinary sweep ------------------
const capture = (fx, extra = {}) => spawnSync(process.execPath, [join(fx.repo, REL[fx.host ?? 'claude'], 'hooks', 'telemetry-capture.mjs'), '--sweep'],
  { cwd: fx.repo, env: { ...fx.env, CLAUDE_PROJECT_DIR: fx.repo, TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SINK: '1', ...extra }, encoding: 'utf8', timeout: 60000 });
const ledgerIds = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^usage-.*\.jsonl$/.test(f))
  .flatMap((f) => readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id)) : []);
const age = (p) => utimesSync(p, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));

test('I3 claude: after a probe, an ordinary sweep in the repo appends nothing for the probe session (TOKENOMICS_PROBE exempts it)', () => {
  const fx = fixture();
  assert.equal(probe(fx, ['--host', 'claude']).probes?.claude?.result, 'fired');
  const proj = fx.env.TOKENOMICS_CLAUDE_ROOT;
  const probeIds = readdirSync(proj).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''));
  assert.equal(probeIds.length, 1, 'the probe session transcript is where the host left it');
  // a real session of the repo beside it, so the sweep is shown to capture
  writeFileSync(join(proj, 'real-1.jsonl'), `${[
    { type: 'user', timestamp: '2026-10-01T10:00:00.000Z', sessionId: 'real-1', message: { role: 'user', content: 'tokenomics hook probe is not a nonce: real work' } },
    { type: 'assistant', timestamp: '2026-10-01T10:00:05.000Z', sessionId: 'real-1', message: { id: 'r1', model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 2 }, content: [] } },
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);
  for (const f of readdirSync(proj)) if (f.endsWith('.jsonl')) age(join(proj, f));
  const r = capture(fx);
  assert.equal(r.status, 0, r.stderr);
  const ids = ledgerIds(join(fx.repo, TEL));
  assert.ok(ids.includes('real-1'), `the sweep ran: ${ids}`);
  for (const id of probeIds) assert.ok(!ids.includes(id), `probe session ${id} captured into the repo ledger: ${ids}`);
  // a sweep that IS a probe's (TOKENOMICS_PROBE set) still captures it, into its state dir
  const state = mkdtempSync(join(sandbox, 'state-'));
  assert.equal(capture(fx, { TOKENOMICS_PROBE: 'b'.repeat(32), TOKENOMICS_STATE_DIR: state }).status, 0);
  assert.ok(ledgerIds(join(state, 'telemetry', 'tokenomics')).includes(probeIds[0]));
});

test('I3 copilot: after a probe, an ordinary sweep in the repo appends nothing for the probe session', () => {
  const fx = { ...fixture({ hosts: ['copilot-cli'] }), host: 'copilot-cli' };
  const d = spawnSync(process.execPath, [join(fx.repo, REL['copilot-cli'], 'scripts', 'doctor.mjs'), '--probe', '--repo', fx.repo, '--json', '--host', 'copilot'], { cwd: fx.repo, env: fx.env, encoding: 'utf8', timeout: 60000 });
  assert.equal(JSON.parse(d.stdout).probes[0].expected.ledgerLine, 'present', show(d));
  const root = fx.env.TOKENOMICS_COPILOT_ROOT;
  const probeIds = readdirSync(root);
  assert.equal(probeIds.length, 1);
  mkdirSync(join(root, 'real-c1'));
  writeFileSync(join(root, 'real-c1', 'events.jsonl'), `${[
    { type: 'session.start', timestamp: '2026-10-01T10:00:00.000Z', data: { context: { cwd: realpathSync(fx.repo) } } },
    { type: 'user.message', timestamp: '2026-10-01T10:00:01.000Z', data: { content: 'real work' } },
    { type: 'assistant.message', timestamp: '2026-10-01T10:00:02.000Z', data: {} },
    { type: 'session.shutdown', timestamp: '2026-10-01T10:00:03.000Z', data: { modelMetrics: { 'gpt-5-mini': { usage: { inputTokens: 10, outputTokens: 1 } } } } },
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);
  const r = capture(fx, { COPILOT_CLI: '1', CLAUDE_PROJECT_DIR: realpathSync(fx.repo) }); // the CLI records its realpath cwd
  assert.equal(r.status, 0, r.stderr);
  const ids = ledgerIds(join(fx.repo, TEL));
  assert.ok(ids.includes('real-c1'), `the sweep ran: ${ids}`);
  assert.ok(!ids.includes(probeIds[0]), `probe session captured into the repo ledger: ${ids}`);
});

test('copilot-cli user-level wiring, in the order CLI 1.0.96 runs it (sessionEnd hooks before session.shutdown): every event fired, the deferred sweep lands the ledger line and scope stamp, result fired', () => {
  const fx = fixture({ hosts: ['copilot-cli'], userHooks: true });
  assert.ok(!existsSync(join(fx.repo, '.github', 'hooks', 'tokenomics.json')), 'no repo-level file: only the user-level wiring');
  const d = spawnSync(process.execPath, [join(fx.repo, REL['copilot-cli'], 'scripts', 'doctor.mjs'), '--probe', '--repo', fx.repo, '--json', '--host', 'copilot-cli'],
    { cwd: fx.repo, env: { ...fx.env, FAKE_PROBE_MODE: 'late-shutdown', TOKENOMICS_PROBE_LATE_MS: '15000' }, encoding: 'utf8', timeout: 90000 });
  const p = JSON.parse(d.stdout).probes[0];
  assert.deepEqual(p.events, { sessionStart: 'fired', sessionEnd: 'fired', subagentStart: 'fired', subagentStop: 'fired' }, d.stdout + d.stderr);
  assert.deepEqual(p.expected, { ledgerLine: 'present', scopeStamp: 'present' }, d.stdout);
  assert.equal(p.result, 'fired');
  assert.equal(d.status, 0);
});
