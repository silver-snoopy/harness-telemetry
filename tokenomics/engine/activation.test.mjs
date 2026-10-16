// The activation gate (Plan 5 Task 4, D-ACT): a copied engine is inert until activated, and an installed copy refuses
// TOKENOMICS_MIGRATIONS. The hooks run as spawned children from a copy made by the Task 3 `install` step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCopy } from './install-copy.mjs';
import { activationState, gateOrExplain } from './activation.mjs';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SOURCE = join(REPO, 'tokenomics');
const VERSION = JSON.parse(readFileSync(join(SOURCE, 'ENGINE.json'), 'utf8')).engine;

const tmp = (t, p) => {
  const d = mkdtempSync(join(tmpdir(), `tokenomics-act-${p}-`));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

// An explicit child env: never the parent's TOKENOMICS_* (a shell exporting TOKENOMICS_MIGRATIONS would turn every
// copy refused), git isolated, no metering, no sync, no sink, no real host stores.
const PASS = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'USERPROFILE', 'NODE_V8_COVERAGE'];
function childEnv(t, repo, extra = {}) {
  const home = tmp(t, 'home');
  const gitcfg = join(home, 'gitconfig');
  writeFileSync(gitcfg, '');
  return {
    ...Object.fromEntries(PASS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
    HOME: home, CLAUDE_PROJECT_DIR: repo,
    GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file',
    GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 'tester@example.invalid', GIT_COMMITTER_NAME: 'Tester', GIT_COMMITTER_EMAIL: 'tester@example.invalid',
    TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_SINK: '1', TOKENOMICS_NO_BATCH_COST: '1',
    TOKENOMICS_CLAUDE_ROOT: home, TOKENOMICS_COPILOT_ROOT: home, TOKENOMICS_VSCODE_ROOT: home,
    ...extra,
  };
}

function consumer(t) {
  const repo = tmp(t, 'repo');
  const env = childEnv(t, repo);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo, env }).status, 0);
  const { dest } = installCopy({ packageRoot: REPO, repo, target: 'claude' });
  return { repo, dest };
}

function transcript(t) {
  const dir = tmp(t, 'proj');
  const p = join(dir, 's1.jsonl');
  writeFileSync(p, `${[
    { type: 'user', message: { role: 'user', content: 'hello' }, timestamp: '2026-07-30T10:00:00Z' },
    { type: 'assistant', timestamp: '2026-07-30T10:01:00Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [] } },
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);
  return p;
}

const run = (engine, rel, args, { repo, env, input = '' }) =>
  spawnSync(process.execPath, [join(engine, rel), ...args], { cwd: repo, env, input, encoding: 'utf8', timeout: 30000 });

// A full Claude Stop (SessionEnd capture), a scope-hook event and a writing work-scope command.
function events(t, engine, repo, extra = {}) {
  const env = childEnv(t, repo, extra);
  const tp = transcript(t);
  return [
    run(engine, 'hooks/telemetry-capture.mjs', [], { repo, env, input: JSON.stringify({ transcript_path: tp, session_id: 's1' }) }),
    run(engine, 'hooks/scope-hook.mjs', ['--mark-dispatch'], { repo, env, input: JSON.stringify({ session_id: 's1', cwd: repo }) }),
    run(engine, 'scripts/work-scope.mjs', ['open', '--session', 's1', '--host', 'claude', '--intent', 'automation'], { repo, env }),
  ];
}

const files = (root) => {
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (d, p) => { for (const e of readdirSync(d, { withFileTypes: true })) { const rel = p ? `${p}/${e.name}` : e.name; if (e.isDirectory()) walk(join(d, e.name), rel); else out.push(rel); } };
  walk(root, '');
  return out.sort();
};
const activate = (repo, engine) => {
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), `${JSON.stringify({ engine, extension: null })}\n`);
};
const ledger = (repo) => files(join(repo, '.agents', 'telemetry', 'automation')).filter((f) => /^usage-.*\.jsonl$/.test(f));

function assertInert(results, line) {
  for (const r of results) {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `${line}\n`);
  }
}

test('(a) copied, not activated: a Stop, a scope-hook event and work-scope open write nothing and print the inert line', (t) => {
  const { repo, dest } = consumer(t);
  const results = events(t, dest, repo);
  assertInert(results, `tokenomics: inactive — engine ${VERSION} copied but not activated (run: node .claude/skills/tokenomics/scripts/install-hooks.mjs --host claude)`);
  assert.ok(!existsSync(join(repo, '.agents')), 'nothing under .agents/');
});

test('(b) activated (settings.json engine = the copy\'s engine): the same events write the ledger line', (t) => {
  const { repo, dest } = consumer(t);
  activate(repo, VERSION);
  const results = events(t, dest, repo);
  for (const r of results) assert.equal(r.status, 0, r.stderr);
  for (const r of results) assert.doesNotMatch(r.stderr, /inactive|refused|cannot load extension/);
  const [f] = ledger(repo);
  assert.ok(f, `a ledger file: ${files(join(repo, '.agents')).join(', ')}`);
  const lines = readFileSync(join(repo, '.agents', 'telemetry', 'automation', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, 's1');
  assert.ok(existsSync(join(repo, '.agents', 'telemetry', 'automation', 'scopes', '.pending-s1')), 'the scope-hook marker');
  assert.ok(existsSync(join(repo, '.agents', 'telemetry', 'automation', 'scopes', 'claude', 's1.json')), 'the work-scope record');
});

test('(c) an activation naming another engine (an interrupted upgrade) is inert again', (t) => {
  const { repo, dest } = consumer(t);
  activate(repo, '0.3.0');
  assert.deepEqual(activationState(dest, repo, {}), { state: 'inert', engine: VERSION, recorded: '0.3.0', reason: 'activation names another engine version' });
  const results = events(t, dest, repo);
  assertInert(results, `tokenomics: inactive — engine ${VERSION} copied but activation records engine 0.3.0 (run: node .claude/skills/tokenomics/scripts/install-hooks.mjs --host claude)`);
  assert.deepEqual(files(join(repo, '.agents')), ['tokenomics/settings.json']);
});

test('(d) an installed copy with TOKENOMICS_MIGRATIONS set is refused, writes nothing and exits 0 (any value)', (t) => {
  const { repo, dest } = consumer(t);
  activate(repo, VERSION);
  const REFUSED = 'tokenomics: refused — TOKENOMICS_MIGRATIONS is set in an installed engine (production switch set is {}; unset it)';
  for (const value of ['none', 'not-a-migration', ' writer ']) {
    assert.equal(activationState(dest, repo, { TOKENOMICS_MIGRATIONS: value }).state, 'refused');
    assertInert(events(t, dest, repo, { TOKENOMICS_MIGRATIONS: value }), REFUSED);
    const sinkDir = tmp(t, 'sink');
    const s = run(dest, 'hooks/otel-sink.mjs', ['--port', '0', '--dir', sinkDir, '--idle-ms', '500'], { repo, env: childEnv(t, repo, { TOKENOMICS_MIGRATIONS: value }) });
    assert.equal(s.status, 0, s.stderr);
    assert.equal(s.stdout, '');
    assert.equal(s.stderr, `${REFUSED}\n`);
    assert.deepEqual(readdirSync(sinkDir), []);
  }
  assert.deepEqual(files(join(repo, '.agents')), ['tokenomics/settings.json']);
});

test('(d) the otel sink of an inert copy never starts', (t) => {
  const { repo, dest } = consumer(t);
  const sinkDir = tmp(t, 'sink');
  const s = run(dest, 'hooks/otel-sink.mjs', ['--port', '0', '--dir', sinkDir, '--idle-ms', '500'], { repo, env: childEnv(t, repo) });
  assert.equal(s.status, 0, s.stderr);
  assert.equal(s.stdout, '');
  assert.match(s.stderr, /^tokenomics: inactive — engine .* copied but not activated/);
  assert.deepEqual(readdirSync(sinkDir), []);
});

test('(e) the source checkout and a copy without ENGINE.json are source: never gated, behaviour unchanged', (t) => {
  const repo = tmp(t, 'repo');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo, env: childEnv(t, repo) }).status, 0);
  assert.deepEqual(activationState(SOURCE, repo, {}), { state: 'source', engine: VERSION, recorded: null, reason: 'source checkout' });
  assert.equal(activationState(SOURCE, repo, { TOKENOMICS_MIGRATIONS: 'none' }).state, 'source', 'the harness lever stays open in the source checkout');
  assert.equal(activationState(tmp(t, 'bare'), repo, {}).state, 'source', 'no ENGINE.json: a reference-era copy');
  const results = events(t, SOURCE, repo);
  for (const r of results) { assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.stderr, /inactive|refused/); }
  assert.equal(ledger(repo).length, 1);
});

test('(f) a copy whose ENGINE.json is unreadable is inert (engine manifest unreadable), never source', (t) => {
  const { repo, dest } = consumer(t);
  activate(repo, VERSION);
  writeFileSync(join(dest, 'ENGINE.json'), '{ not json');
  assert.deepEqual(activationState(dest, repo, {}), { state: 'inert', engine: null, recorded: null, reason: 'engine manifest unreadable' });
  const results = events(t, dest, repo);
  assertInert(results, `tokenomics: inactive — engine manifest unreadable (${join(realpathSync(dest), 'ENGINE.json')}; reinstall: harness-telemetry install tokenomics --target <claude|copilot>)`);
  assert.deepEqual(files(join(repo, '.agents')), ['tokenomics/settings.json']);
  writeFileSync(join(dest, 'ENGINE.json'), '[]');
  assert.equal(activationState(dest, repo, {}).reason, 'engine manifest unreadable');
});

test('the gate never throws: an unparsable or non-object settings.json is inert with a named cause', (t) => {
  const { repo, dest } = consumer(t);
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), '{ nope');
  assert.deepEqual(activationState(dest, repo, {}), { state: 'inert', engine: VERSION, recorded: null, reason: 'settings.json unreadable' });
  const r = run(dest, 'hooks/scope-hook.mjs', ['--announce'], { repo, env: childEnv(t, repo), input: '{}' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /^tokenomics: inactive — engine .* copied but \.agents\/tokenomics\/settings\.json is unreadable/);
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), '"0.4.0"');
  assert.equal(activationState(dest, repo, {}).reason, 'not activated');
  assert.equal(gateOrExplain(join(repo, 'missing'), repo, {}), true, 'a missing engine root has no manifest: source');
});

test('read-only work-scope commands are not gated', (t) => {
  const { repo, dest } = consumer(t);
  // inert copy: list is not gated — it reaches the settings load (the default TA extension is not shipped)
  let r = run(dest, 'scripts/work-scope.mjs', ['list'], { repo, env: childEnv(t, repo) });
  assert.match(r.stderr, /^work-scope: tokenomics: cannot load extension .*test-automation\.mjs/);
  activate(repo, VERSION);
  r = run(dest, 'scripts/work-scope.mjs', ['list'], { repo, env: childEnv(t, repo) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

test('(R11) an empty or whitespace-only TOKENOMICS_MIGRATIONS is unset: an activated copy runs', (t) => {
  const { repo, dest } = consumer(t);
  activate(repo, VERSION);
  for (const value of ['', '  ']) assert.equal(activationState(dest, repo, { TOKENOMICS_MIGRATIONS: value }).state, 'active', JSON.stringify(value));
  const results = events(t, dest, repo, { TOKENOMICS_MIGRATIONS: ' ' });
  for (const r of results) { assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.stderr, /refused|inactive/); }
  assert.equal(ledger(repo).length, 1);
});

const REFUSED_MSG = 'tokenomics: refused — TOKENOMICS_MIGRATIONS is set in an installed engine (production switch set is {}; unset it)';
test('(R12) every other entry of an installed copy refuses TOKENOMICS_MIGRATIONS: exit 1, the message, nothing written', (t) => {
  const { repo, dest } = consumer(t);
  activate(repo, VERSION);
  const before = files(repo);
  const env = childEnv(t, repo, { TOKENOMICS_MIGRATIONS: 'none' });
  for (const [rel, args] of [
    ['scripts/team-report.mjs', [repo]],
    ['scripts/batch-cost.mjs', ['--batch', 'b']],
    ['scripts/build-tokenomics-export.mjs', ['--batch', 'b']],
    ['scripts/work-scope.mjs', ['list']],
    ['scripts/work-scope.mjs', ['status', '--session', 's1']],
    ['scripts/otel-report.mjs', ['--dir', tmp(t, 'otel')]],
  ]) {
    const r = run(dest, rel, args, { repo, env });
    assert.equal(r.status, 1, `${rel}: ${r.stderr}`);
    // M4: one line, no stack (work-scope prefixes its own name)
    assert.equal(r.stderr.replace(/^work-scope: /, ''), `${REFUSED_MSG}\n`, `${rel}: exactly the message, no stack`);
    assert.equal(r.stdout, '', rel);
  }
  assert.deepEqual(files(repo), before, 'nothing written');
  // the source checkout keeps the harness lever
  const src = run(SOURCE, 'scripts/work-scope.mjs', ['list'], { repo, env });
  assert.equal(src.status, 0, src.stderr);
  assert.doesNotMatch(src.stderr, /refused/);
});

// --- fix wave lane C: Codex B3-05 (R19), B3-06 / M5 -----------------------------------------------------------------

const inertLine = (recorded) => `tokenomics: inactive — engine ${VERSION} copied but ${recorded ? `activation records engine ${recorded}` : 'not activated'} (run: node .claude/skills/tokenomics/scripts/install-hooks.mjs --host claude)`;

test('(R19, Codex B3-05) every report CLI that writes refuses in an inert copy: exit 1, the one inactive line, nothing written', (t) => {
  for (const recorded of [null, '0.3.0']) {
    const { repo, dest } = consumer(t);
    if (recorded) activate(repo, recorded);
    const before = files(repo);
    const out = join(tmp(t, 'out'), 'report.md');
    const env = childEnv(t, repo);
    for (const [rel, args] of [
      ['scripts/batch-cost.mjs', ['--batch', 'g']],
      ['scripts/build-tokenomics-export.mjs', ['--batch', 'g']],
      ['scripts/build-tokenomics-export.mjs', ['--submission']],
      ['scripts/team-report.mjs', ['--batch', 'g']],
      ['scripts/team-report.mjs', ['--out', out]],
    ]) {
      const r = run(dest, rel, args, { repo, env });
      assert.equal(r.status, 1, `${rel} ${args.join(' ')}: ${r.stderr}`);
      assert.equal(r.stderr, `${inertLine(recorded)}\n`, `${rel} ${args.join(' ')}`);
      assert.equal(r.stdout, '', rel);
    }
    assert.deepEqual(files(repo), before, 'nothing written under the repo');
    assert.ok(!existsSync(out), '--out target not created');
  }
});

test('(R19) read-only runs stay available when inert; the source checkout is never gated; an active copy is let through', (t) => {
  const { repo, dest } = consumer(t);
  const env = childEnv(t, repo);
  const ro = run(dest, 'scripts/otel-report.mjs', ['--dir', tmp(t, 'otel')], { repo, env });
  assert.equal(ro.status, 0, ro.stderr);
  assert.equal(ro.stderr, '');
  const src = run(SOURCE, 'scripts/batch-cost.mjs', ['--batch', 'g'], { repo, env });
  assert.doesNotMatch(src.stderr, /inactive|refused/);
  activate(repo, VERSION);
  const act = run(dest, 'scripts/batch-cost.mjs', ['--batch', 'g'], { repo, env });
  assert.doesNotMatch(act.stderr, /inactive|refused/);
});

test('(R19) the gate runs before the settings load: an inert copy with a broken settings.json still explains and exits 1', (t) => {
  const { repo, dest } = consumer(t);
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), '{ nope');
  const r = run(dest, 'scripts/batch-cost.mjs', ['--batch', 'g'], { repo, env: childEnv(t, repo) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^tokenomics: inactive — engine .* copied but \.agents\/tokenomics\/settings\.json is unreadable/);
});

test('(Codex B3-06, M5) a present but unreadable ENGINE.json is an installed copy: the switch is refused, never honoured', (t) => {
  const { repo, dest } = consumer(t);
  activate(repo, VERSION);
  writeFileSync(join(dest, 'ENGINE.json'), '{');
  const env = childEnv(t, repo, { TOKENOMICS_MIGRATIONS: 'none' });
  const before = files(repo);
  const r = run(dest, 'scripts/build-tokenomics-export.mjs', ['--batch', 'g'], { repo, env });
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
  assert.deepEqual(files(repo), before);
  // the selection itself fails closed (not only the entry's gate)
  const sel = (d, expr) => spawnSync(process.execPath, ['--input-type=module', '-e', `import { enabledMigrations } from ${JSON.stringify(join(d, 'engine', 'migrations.mjs'))};
try { console.log(${expr}); } catch (e) { console.log(e.message); }`], { encoding: 'utf8', cwd: repo }).stdout.trim();
  assert.equal(sel(dest, "enabledMigrations({ TOKENOMICS_MIGRATIONS: 'none' }).size"), REFUSED_MSG);
  // a missing manifest stays "not installed" (a reference-era copy): the switch is honoured
  rmSync(join(dest, 'ENGINE.json'));
  assert.equal(sel(dest, "enabledMigrations({ TOKENOMICS_MIGRATIONS: 'none' }).size"), '0');
});
