// doctor.mjs (Plan 5 Task 9). Every case spawns doctor from the repo's source tree against a fixture consumer repo
// built through the real install steps (installCopy, ensureSubstrate, installClaude); git is isolated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCopy } from '../engine/install-copy.mjs';
import { ensureSubstrate } from '../engine/substrate.mjs';
import { installClaude, installCopilot, installGitignore } from './install-hooks.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const DOCTOR = join(ROOT, 'tokenomics', 'scripts', 'doctor.mjs');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'tokenomics', 'ENGINE.json'), 'utf8')).engine;
const REL = '.claude/skills/tokenomics';
const TEL = '.agents/telemetry/automation';

const sandbox = mkdtempSync(join(tmpdir(), 'ht-doctor-'));
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));
const gitconfig = join(sandbox, 'gitconfig');
writeFileSync(gitconfig, '[user]\n\tuseConfigOnly = true\n[init]\n\tdefaultBranch = main\n');
const home = join(sandbox, 'home');
mkdirSync(home);
const BASE_ENV = {
  PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0',
  TOKENOMICS_CLAUDE_ROOT: home, TOKENOMICS_COPILOT_ROOT: home, TOKENOMICS_VSCODE_ROOT: home, TOKENOMICS_NO_CCUSAGE: '1',
};
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@x'];
const git = (cwd, ...a) => spawnSync('git', [...ID, ...a], { cwd, env: BASE_ENV, encoding: 'utf8' });
const writeJson = (p, o) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const MODULE = { module: 'tokenomics', schema_version: '1', domain: 'automation', manifestRevision: 1,
  receipts: { source: 'files', root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red'] },
  ratioIntents: ['automation'] };

/** A healthy, activated claude-target consumer repo. */
function fixture() {
  const repo = mkdtempSync(join(sandbox, 'repo-'));
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  const { dest } = installCopy({ packageRoot: ROOT, repo, target: 'claude' });
  ensureSubstrate(repo, {}, { env: BASE_ENV });
  writeJson(join(repo, '.agents', 'tokenomics', 'settings.json'), { extension: null, engine: VERSION, targets: ['claude'], enforcement: { announce: true, stopGate: 'off' } });
  writeJson(join(repo, TEL, 'module.json'), MODULE);
  writeJson(join(repo, TEL, 'manifests', '1.json'), MODULE);
  installClaude(repo, REL, {});
  stripStop(repo);
  installGitignore(repo, {});
  return { repo, dest };
}
function stripStop(repo) {
  const f = join(repo, '.claude', 'settings.json');
  const s = readJson(f);
  delete s.hooks.Stop;
  writeJson(f, s);
}
const settingsPath = (repo) => join(repo, '.agents', 'tokenomics', 'settings.json');
const patchSettings = (repo, fn) => { const s = readJson(settingsPath(repo)); fn(s); writeJson(settingsPath(repo), s); };

function doctor(repo, args = [], env = {}, script = DOCTOR) {
  const r = spawnSync(process.execPath, [script, '--repo', repo, '--json', ...args], { env: { ...BASE_ENV, ...env }, encoding: 'utf8', timeout: 120000 });
  let checks = null;
  try { checks = Object.fromEntries(JSON.parse(r.stdout).checks.map((c) => [c.id, c])); } catch { /* reported by the assertion */ }
  return { ...r, checks };
}
const failing = (r) => Object.values(r.checks).filter((c) => c.status === 'fail').map((c) => c.id);

test('a healthy activated fixture is all ok and exits 0 (also in text form)', () => {
  const { repo } = fixture();
  const r = doctor(repo);
  assert.ok(r.checks, r.stderr + r.stdout);
  const bad = Object.values(r.checks).filter((c) => c.status !== 'ok');
  assert.deepEqual(bad, [], JSON.stringify(bad));
  for (const id of ['integrity', 'activation', 'substrate', 'settings', 'targets', 'claims', 'switches']) assert.equal(r.checks[id]?.status, 'ok', id);
  assert.equal(r.status, 0);
  const t = spawnSync(process.execPath, [DOCTOR, '--repo', repo], { env: BASE_ENV, encoding: 'utf8' });
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /^ok\s+integrity/m);
});

test('integrity: a changed file, a missing file and an unexpected file in the copy each fail, naming it', () => {
  const { repo, dest } = fixture();
  assert.equal(doctor(repo).checks.integrity.status, 'ok');
  const target = join(dest, 'engine', 'order.mjs');
  const original = readFileSync(target);
  writeFileSync(target, `${original}\n// tampered\n`);
  let r = doctor(repo);
  assert.equal(r.checks.integrity.status, 'fail');
  assert.match(r.checks.integrity.detail, /engine\/order\.mjs.*modified/);
  assert.equal(r.status, 1);
  writeFileSync(target, original);
  rmSync(join(dest, 'engine', 'scrub.mjs'));
  r = doctor(repo);
  assert.equal(r.checks.integrity.status, 'fail');
  assert.match(r.checks.integrity.detail, /engine\/scrub\.mjs.*missing/);
  writeFileSync(join(dest, 'engine', 'scrub.mjs'), readFileSync(join(ROOT, 'tokenomics', 'engine', 'scrub.mjs')));
  writeFileSync(join(dest, 'engine', 'extra.mjs'), '// not ours\n');
  r = doctor(repo);
  assert.equal(r.checks.integrity.status, 'fail');
  assert.match(r.checks.integrity.detail, /engine\/extra\.mjs.*unexpected/);
  rmSync(join(dest, 'engine', 'extra.mjs'));
  assert.equal(doctor(repo).checks.integrity.status, 'ok');
});

test('integrity: every installed copy is checked (.github/skills/tokenomics too)', () => {
  const { repo } = fixture();
  const { dest } = installCopy({ packageRoot: ROOT, repo, target: 'copilot' });
  assert.equal(doctor(repo).checks.integrity.status, 'ok');
  writeFileSync(join(dest, 'hooks', 'scope-hook.mjs'), '// changed\n');
  const r = doctor(repo);
  assert.equal(r.checks.integrity.status, 'fail');
  assert.match(r.checks.integrity.detail, /\.github\/skills\/tokenomics.*hooks\/scope-hook\.mjs/);
});

test('activation: inert (never activated, another version) and refused fail, naming the remedy', () => {
  const { repo } = fixture();
  patchSettings(repo, (s) => { s.engine = '0.0.1'; });
  let r = doctor(repo);
  assert.equal(r.checks.activation.status, 'fail');
  assert.match(r.checks.activation.detail, /0\.0\.1/);
  assert.match(r.checks.activation.detail, /install-hooks\.mjs/);
  rmSync(settingsPath(repo));
  r = doctor(repo);
  assert.equal(r.checks.activation.status, 'fail');
  assert.match(r.checks.activation.detail, /not activated/);
  const again = fixture();
  r = doctor(again.repo, [], { TOKENOMICS_MIGRATIONS: 'none' });
  assert.equal(r.checks.activation.status, 'fail');
  assert.match(r.checks.activation.detail, /unset it/);
});

test('substrate: wrong ignore, wrong branch and not materialised each fail', () => {
  const a = fixture();
  git(a.repo, 'config', '-f', '.gitmodules', 'submodule..agents/telemetry.ignore', 'dirty');
  let r = doctor(a.repo);
  assert.equal(r.checks.substrate.status, 'fail');
  assert.match(r.checks.substrate.detail, /ignore/);
  const b = fixture();
  git(b.repo, 'submodule', 'deinit', '-f', '--', '.agents/telemetry');
  r = doctor(b.repo);
  assert.equal(r.checks.substrate.status, 'fail');
  assert.match(r.checks.substrate.detail, /materialised/);
  const c = fixture();
  git(c.repo, 'config', '-f', '.gitmodules', 'submodule..agents/telemetry.branch', 'other');
  r = doctor(c.repo);
  assert.equal(r.checks.substrate.status, 'fail');
  assert.match(r.checks.substrate.detail, /branch/);
});

test('substrate: no git repository fails', () => {
  const repo = mkdtempSync(join(sandbox, 'nogit-'));
  installCopy({ packageRoot: ROOT, repo, target: 'claude' });
  writeJson(settingsPath(repo), { extension: null, engine: VERSION, targets: [] });
  const r = doctor(repo);
  assert.equal(r.checks.substrate.status, 'fail');
  assert.match(r.checks.substrate.detail, /no git repository/);
});

test('settings: invalid settings.json, missing module.json, invalid module.json, missing manifests/<N>.json fail', () => {
  let { repo } = fixture();
  writeFileSync(settingsPath(repo), '{ not json');
  let r = doctor(repo);
  assert.equal(r.checks.settings.status, 'fail');
  assert.match(r.checks.settings.detail, /settings\.json/);

  ({ repo } = fixture());
  rmSync(join(repo, TEL, 'module.json'));
  r = doctor(repo);
  assert.equal(r.checks.settings.status, 'fail');
  assert.match(r.checks.settings.detail, /module\.json.*missing/);

  ({ repo } = fixture());
  writeJson(join(repo, TEL, 'module.json'), { ...MODULE, manifestRevision: 'one' });
  r = doctor(repo);
  assert.equal(r.checks.settings.status, 'fail');
  assert.match(r.checks.settings.detail, /module\.json.*invalid/);

  ({ repo } = fixture());
  writeJson(join(repo, TEL, 'module.json'), { ...MODULE, manifestRevision: 2 });
  r = doctor(repo);
  assert.equal(r.checks.settings.status, 'fail');
  assert.match(r.checks.settings.detail, /manifests\/2\.json.*missing/);
});

test('targets: an unwired host, a wired copy of another version, and a Stop gate that disagrees with enforcement fail', () => {
  let { repo, dest } = fixture();
  patchSettings(repo, (s) => { s.targets = ['claude', 'copilot-cli']; });
  let r = doctor(repo);
  assert.equal(r.checks.targets.status, 'fail');
  assert.match(r.checks.targets.detail, /copilot-cli.*not wired/);

  // wired to a copy of another version
  installCopilot(repo, '.github/skills/tokenomics', {});
  mkdirSync(join(repo, '.github', 'skills', 'tokenomics'), { recursive: true });
  writeJson(join(repo, '.github', 'skills', 'tokenomics', 'ENGINE.json'), { ...readJson(join(dest, 'ENGINE.json')), engine: '0.0.1' });
  r = doctor(repo);
  assert.equal(r.checks.targets.status, 'fail');
  assert.match(r.checks.targets.detail, /copilot-cli.*0\.0\.1/);

  // stopGate on, but the Stop hook is not wired
  ({ repo } = fixture());
  patchSettings(repo, (s) => { s.enforcement.stopGate = 'on'; });
  r = doctor(repo);
  assert.equal(r.checks.targets.status, 'fail');
  assert.match(r.checks.targets.detail, /Stop gate.*not wired/);
  installClaude(repo, REL, {}); // wires Stop
  assert.equal(doctor(repo).checks.targets.status, 'ok');

  // stopGate off but wired
  patchSettings(repo, (s) => { s.enforcement.stopGate = 'off'; });
  r = doctor(repo);
  assert.equal(r.checks.targets.status, 'fail');
  assert.match(r.checks.targets.detail, /Stop gate.*wired.*off/);
});

test('targets: an unknown target name and a missing targets record fail', () => {
  let { repo } = fixture();
  patchSettings(repo, (s) => { s.targets = ['emacs']; });
  assert.match(doctor(repo).checks.targets.detail, /emacs/);
  ({ repo } = fixture());
  patchSettings(repo, (s) => { delete s.targets; });
  const r = doctor(repo);
  assert.equal(r.checks.targets.status, 'fail');
  assert.match(r.checks.targets.detail, /targets/);
});

test('claims: an unreadable .claim fails naming the file; a flat claim past the crash window warns', () => {
  const { repo } = fixture();
  const scopes = join(repo, TEL, 'scopes');
  mkdirSync(join(scopes, 'claude'), { recursive: true });
  writeFileSync(join(scopes, 'claude', 's1.json.claim'), '{ broken');
  let r = doctor(repo);
  assert.equal(r.checks.claims.status, 'fail');
  assert.match(r.checks.claims.detail, /scopes\/claude\/s1\.json\.claim/);
  rmSync(join(scopes, 'claude', 's1.json.claim'));
  assert.equal(doctor(repo).checks.claims.status, 'ok');

  const claim = join(scopes, 's2.json.claim');
  writeJson(claim, { session: 'pending-1' });
  assert.equal(doctor(repo).checks.claims.status, 'ok', 'a fresh claim is in flight, not stale');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  utimesSync(claim, old, old);
  r = doctor(repo);
  assert.equal(r.checks.claims.status, 'warn');
  assert.match(r.checks.claims.detail, /s2\.json\.claim/);
  assert.match(r.checks.claims.detail, /10 minutes/);
  assert.equal(r.status, 0, 'a warning does not fail the run');
});

test('switches: TOKENOMICS_MIGRATIONS set fails for an installed copy; empty counts as unset', () => {
  const { repo } = fixture();
  let r = doctor(repo, [], { TOKENOMICS_MIGRATIONS: 'none' });
  assert.equal(r.checks.switches.status, 'fail');
  assert.match(r.checks.switches.detail, /TOKENOMICS_MIGRATIONS/);
  assert.equal(r.status, 1);
  r = doctor(repo, [], { TOKENOMICS_MIGRATIONS: '' });
  assert.equal(r.checks.switches.status, 'ok');
  assert.equal(r.checks.activation.status, 'ok', 'empty is unset for activation too (R11)');
});

test('doctor never writes: the tree is unchanged before and after (failing fixture included)', () => {
  const { repo } = fixture();
  mkdirSync(join(repo, TEL, 'scopes'), { recursive: true });
  writeFileSync(join(repo, TEL, 'scopes', 'x.json.claim'), 'broken');
  const snap = () => {
    const out = {};
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = `${statSync(p).mtimeMs}:${readFileSync(p).length}`; } };
    walk(repo);
    return out;
  };
  const before = snap();
  doctor(repo);
  assert.deepEqual(snap(), before);
});

test('--probe inside a probe session exits 2 and starts no host (engine/probe.test.mjs covers the probe)', () => {
  const { repo } = fixture();
  const r = spawnSync(process.execPath, [DOCTOR, '--repo', repo, '--probe'], { env: { ...BASE_ENV, TOKENOMICS_PROBE: '0'.repeat(32) }, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /a probe never triggers another probe/);
  assert.equal(r.stdout, '');
});

test('install-hooks --doctor is an alias that runs doctor.mjs', () => {
  const { repo, dest } = fixture();
  const r = spawnSync(process.execPath, [join(dest, 'scripts', 'install-hooks.mjs'), '--doctor', '--repo', repo, '--json'], { env: BASE_ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).checks.some((c) => c.id === 'integrity'));
});

test('legacy warnings survive as warn: an unwired repo with no installed copy warns, does not fail', () => {
  const repo = mkdtempSync(join(sandbox, 'bare-'));
  git(repo, 'init', '-q');
  const r = doctor(repo);
  assert.ok(r.checks, r.stderr);
  assert.equal(r.status, 0, JSON.stringify(failing(r)));
  assert.ok(Object.values(r.checks).some((c) => c.status === 'warn'), 'gitignore warns');
});

// --- fix wave lane C: M1, M2, M3, T9-1 (Codex B3-11), T9-6 ----------------------------------------------------------

test('(M1) a whitespace-only TOKENOMICS_MIGRATIONS counts as unset for switches, activation and settings (R11)', () => {
  const { repo, dest } = fixture();
  const r = doctor(repo, [], { TOKENOMICS_MIGRATIONS: '   ' }, join(dest, 'scripts', 'doctor.mjs')); // the installed copy's own doctor
  assert.deepEqual(failing(r), []);
  assert.equal(r.checks.switches.status, 'ok');
  assert.equal(r.status, 0);
});

test('(M2) with the switch set the refusal is reported by switches and activation only; settings, substrate, targets and claims still run', () => {
  const { repo, dest } = fixture();
  const r = doctor(repo, [], { TOKENOMICS_MIGRATIONS: 'none' }, join(dest, 'scripts', 'doctor.mjs')); // the installed copy's own doctor
  assert.ok(r.checks, `${r.stderr}${r.stdout}`);
  assert.deepEqual(failing(r).sort(), ['activation', 'switches']);
  for (const id of ['settings', 'substrate', 'targets', 'claims']) assert.equal(r.checks[id]?.status, 'ok', id);
  assert.equal(r.status, 1);
});

test('(M3) doctor --fix starts the sink for this repo (the repo is passed to ensureSink)', () => {
  const src = readFileSync(DOCTOR, 'utf8');
  assert.match(src, /cap\.ensureSink\(cfg\.otel, env, repo\)/);
});

test('(Codex B3-11, T9-1) a dangling symlink replacing a listed engine file is a named integrity failure; every other check still reports', () => {
  const { repo, dest } = fixture();
  const target = join(dest, 'engine', 'order.mjs');
  rmSync(target);
  symlinkSync(join(sandbox, 'nowhere'), target);
  const r = doctor(repo);
  assert.ok(r.checks, `${r.stderr}${r.stdout}`);
  assert.equal(r.checks.integrity.status, 'fail');
  assert.match(r.checks.integrity.detail, /engine\/order\.mjs: unreadable \(dangling link\)/);
  assert.equal(r.checks.activation.status, 'ok');
  assert.equal(r.checks.claims.status, 'ok');
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, /ENOENT/);
});

test('(T9-6) a partial enforcement record is judged by what it holds: Stop wired without stopGate "on" fails, with it passes', () => {
  const { repo } = fixture();
  patchSettings(repo, (s) => { s.enforcement = { announce: true }; });
  assert.equal(doctor(repo).checks.targets.status, 'ok');
  installClaude(repo, REL, {}); // wires Stop
  const r = doctor(repo);
  assert.equal(r.checks.targets.status, 'fail');
  assert.match(r.checks.targets.detail, /Stop gate wired but enforcement\.stopGate is not "on"/);
  patchSettings(repo, (s) => { s.enforcement = { stopGate: 'on' }; });
  assert.equal(doctor(repo).checks.targets.status, 'ok');
});
