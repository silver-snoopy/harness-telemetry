// Tests for install-hooks.mjs — idempotent wiring in temp repos; never touches
// this repo's own settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, copyFileSync, chmodSync, utimesSync, statSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installClaude, installCopilot, installVsCode, installGitHook, gitHooksDir,
  configureOtel, seedConfig, main, migrateTelemetryLayout,
} from './install-hooks.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenomics-install-'));
const REL = '.claude/skills/tokenomics';
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('installClaude: marked SessionEnd capture + SessionStart sweep, preserves existing settings, idempotent', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({
    model: 'sonnet',
    hooks: { SessionStart: [{ matcher: '*', hooks: [] }] },
  }));
  installClaude(repo, REL, {});
  installClaude(repo, REL, {}); // second run must not duplicate
  const s = read(join(repo, '.claude', 'settings.json'));
  assert.equal(s.model, 'sonnet', 'unrelated settings preserved');
  assert.equal(s.hooks.SessionEnd.length, 1, 'idempotent');
  assert.equal(s.hooks.SessionEnd[0]._tokenomics, true);
  const endCmd = s.hooks.SessionEnd[0].hooks[0].command;
  assert.ok(endCmd.includes('${CLAUDE_PROJECT_DIR}') && endCmd.includes(`${REL}/hooks/telemetry-capture.mjs`), endCmd);
  assert.equal(s.hooks.SessionStart.length, 3, 'pre-existing SessionStart entry preserved, sweep + announce added once');
  const sweep = s.hooks.SessionStart.find((e) => e._tokenomics && e.hooks[0].command.endsWith('--sweep'));
  assert.ok(sweep, 'start hook sweeps, never captures the opening session');
  assert.equal(sweep.hooks[0].async, true, 'sweep injects no context — background it');
  assert.equal(sweep.matcher, 'startup|resume');
  // Scope contract wiring: announce (sync — its one line must reach context),
  // dispatch marker on BOTH dispatch styles, and the one-time Stop gate.
  const announce = s.hooks.SessionStart.find((e) => e._tokenomics && e.hooks[0].command.includes('--announce'));
  assert.ok(announce && announce.hooks[0].command.includes('scope-hook.mjs'));
  assert.notEqual(announce.hooks[0].async, true, 'announce must be sync to inject the session id');
  const pre = s.hooks.PreToolUse.find((e) => e._tokenomics);
  assert.equal(pre.matcher, 'Agent|Workflow', 'covers sequential dispatches AND Workflow runs');
  assert.ok(pre.hooks[0].command.includes('--mark-dispatch'));
  const stop = s.hooks.Stop.find((e) => e._tokenomics);
  assert.ok(stop.hooks[0].command.includes('--gate'));
  // Measurements update as dispatches finish, not only at session end.
  const subStop = s.hooks.SubagentStop.find((e) => e._tokenomics);
  assert.ok(subStop.hooks[0].command.includes('telemetry-capture.mjs') && subStop.hooks[0].command.includes('--dispatch'));
  assert.equal(subStop.hooks[0].async, true, 'per-dispatch metering must never delay the run');
});

test('installClaude --remove: strips only our entries from both events', () => {
  const repo = tmp();
  installClaude(repo, REL, {});
  const file = join(repo, '.claude', 'settings.json');
  const s = read(file);
  s.hooks.SessionEnd.push({ hooks: [{ type: 'command', command: 'echo other' }] });
  writeFileSync(file, JSON.stringify(s));
  installClaude(repo, REL, { remove: true });
  const after = read(file);
  assert.equal(after.hooks.SessionEnd.length, 1);
  assert.equal(after.hooks.SessionEnd[0].hooks[0].command, 'echo other');
  assert.ok(!after.hooks.SessionStart, 'our sweep entry removed; empty event key dropped');
  assert.ok(!after.hooks.PreToolUse, 'dispatch-marker entry removed');
  assert.ok(!after.hooks.Stop, 'scope-gate entry removed');
});

test('installClaude --local targets settings.local.json', () => {
  const repo = tmp();
  installClaude(repo, REL, { local: true });
  assert.ok(existsSync(join(repo, '.claude', 'settings.local.json')));
  assert.ok(!existsSync(join(repo, '.claude', 'settings.json')));
});

test('installCopilot: sweep + the same three scope moments as Claude; remove deletes it', () => {
  const repo = tmp();
  const rel = '.github/skills/tokenomics';
  installCopilot(repo, rel, {});
  const file = join(repo, '.github', 'hooks', 'tokenomics.json');
  const cfg = read(file);
  assert.equal(cfg.version, 1);
  const entry = cfg.hooks.sessionStart[0];
  assert.ok(entry.bash.includes(`${rel}/hooks/telemetry-capture.mjs" --sweep`), entry.bash);
  assert.equal(entry.env.COPILOT_CLI, '1');
  // R25: every command names its own event (the CLI's payload names none), so a probe can attribute a shared entry
  for (const [event, list] of Object.entries(cfg.hooks)) for (const c of list) assert.deepEqual(c.env, { COPILOT_CLI: '1', TOKENOMICS_HOOK_EVENT: event }, event);
  // Copilot parses hook stdout as JSON — announce must run in --json mode.
  const announce = cfg.hooks.sessionStart[1];
  assert.ok(announce.bash.includes('scope-hook.mjs" --announce --json'), announce.bash);
  assert.ok(cfg.hooks.subagentStart[0].bash.includes('--mark-dispatch'));
  assert.ok(cfg.hooks.subagentStop[0].bash.includes('--dispatch'), 'per-dispatch measurement on Copilot too');
  assert.ok(cfg.hooks.agentStop[0].bash.includes('--gate'));
  // sessionEnd captures the ending session now; older CLIs ignore the event.
  assert.ok(cfg.hooks.sessionEnd[0].bash.includes('--sweep'));
  installCopilot(repo, rel, { remove: true });
  assert.ok(!existsSync(file));
});

// A file that is neither committed nor ignored blocks the pipeline's gate, so
// the installer owns the ignore rules for the transient state it writes — and
// deliberately does NOT ignore the records team reporting depends on.
test('installGitignore: owned block, preserves the rest, idempotent, clean remove', async () => {
  const { installGitignore } = await import('./install-hooks.mjs');
  const repo = tmp();
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.env\n');
  installGitignore(repo);
  installGitignore(repo);                                   // second run must not duplicate
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.match(gi, /^node_modules\/$/m, 'existing rules preserved');
  assert.match(gi, /^\.env$/m);
  assert.equal(gi.match(/tokenomics \(managed\)/g).length, 1, 'idempotent');
  for (const p of ['.agents/telemetry/automation/live/', '.agents/telemetry/automation/scopes/.pending-*', '.agents/telemetry/automation/scopes/.nagged-*']) {
    assert.ok(gi.includes(p), p);
  }
  // the RECORDS must stay committable — ignoring them would kill team reporting
  assert.ok(!/^\.agents\/telemetry\/automation\/$/m.test(gi), 'never ignores the whole telemetry dir');
  assert.ok(!gi.includes('usage-'), 'never ignores the ledger');
  assert.ok(!/scopes\/$/m.test(gi), 'never ignores the scope records themselves');

  installGitignore(repo, { remove: true });
  const after = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.equal(after, 'node_modules/\n.env\n', 'block stripped, the rest untouched');
});

test('installGitignore: creates the file when absent, removes it when only ours', async () => {
  const { installGitignore } = await import('./install-hooks.mjs');
  const repo = tmp();
  installGitignore(repo);
  assert.ok(existsSync(join(repo, '.gitignore')));
  installGitignore(repo, { remove: true });
  assert.ok(!existsSync(join(repo, '.gitignore')), 'no orphan empty file left behind');
});

test('seedConfig: creates defaults once, never overwrites', () => {
  const repo = tmp();
  const cfgPath = seedConfig(repo);
  const first = read(cfgPath);
  assert.equal(first.capturePrompts, false);
  assert.equal(first.priceAtCapture, true);
  writeFileSync(cfgPath, JSON.stringify({ capturePrompts: true }));
  seedConfig(repo);
  assert.equal(read(cfgPath).capturePrompts, true, 'existing config untouched');
});

test('main: refuses a repo that does not contain the installed skill', async () => {
  assert.equal(await main(['--repo', tmp()]), 1);
});

test('installVsCode: folderOpen sweep task, preserves other tasks, idempotent, clean remove', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.vscode'), { recursive: true });
  writeFileSync(join(repo, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{ label: 'build', type: 'shell', command: 'make' }] }));
  installVsCode(repo, REL, {});
  installVsCode(repo, REL, {});
  const cfg = read(join(repo, '.vscode', 'tasks.json'));
  assert.equal(cfg.tasks.length, 2, 'idempotent, build task preserved');
  const ours = cfg.tasks.find((t) => t.label === 'tokenomics: telemetry sweep');
  assert.equal(ours.runOptions.runOn, 'folderOpen');
  assert.ok(ours.args.join(' ').includes('--sweep'));
  installVsCode(repo, REL, { remove: true });
  const after = read(join(repo, '.vscode', 'tasks.json'));
  assert.equal(after.tasks.length, 1);
  assert.equal(after.tasks[0].label, 'build');
});

// The sidebar task is the one thing written into SHARED editor config (and it
// costs every teammate an "allow automatic tasks?" prompt), while every sweep
// already walks the sidebar store — so it is opt-in, and only --remove touches
// it from `all` so an uninstall never leaves it behind. main() refuses a repo
// that does not contain the installed skill (tested below), so the host
// dispatch is pinned at the source, as the workflow scripts' tests do.
test('vscode task is opt-in: activation wires only the named --host; --remove without one strips every host', () => {
  const src = readFileSync(new URL('./install-hooks.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(host === 'claude'\) touched\.push\(installClaude/);
  assert.match(src, /if \(host === 'copilot-cli'\) touched\.push\(installCopilot/);
  assert.match(src, /if \(host === 'vscode'\) touched\.push\(installVsCode/);
  assert.match(src, /if \(all \|\| host === 'vscode'\) touched\.push\(installVsCode\(repo, rel, \{ remove \}\)\)/);
  assert.doesNotMatch(src, /host === 'all' \|\| host === 'vscode'/, 'vscode must not ride a default install');
});

test('installVsCode: remove deletes the file when only our task existed', () => {
  const repo = tmp();
  installVsCode(repo, REL, {});
  assert.ok(existsSync(join(repo, '.vscode', 'tasks.json')));
  installVsCode(repo, REL, { remove: true });
  assert.ok(!existsSync(join(repo, '.vscode', 'tasks.json')));
});

function gitRepo() {
  const repo = tmp();
  const gitcfg = join(repo, '..', `${repo.split('/').pop()}.gitconfig`);
  writeFileSync(gitcfg, '');
  execFileSync('git', ['-C', repo, 'init', '-q'], { env: { PATH: process.env.PATH, HOME: repo, GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file' } });
  return repo;
}

test('installGitHook: installs, never overwrites a foreign hook, removes only ours', () => {
  const repo = gitRepo();
  const r1 = installGitHook(repo, REL, {});
  assert.equal(r1.status, 'installed');
  const txt = readFileSync(r1.file, 'utf8');
  assert.ok(txt.includes('# tokenomics-sweep') && txt.includes('--sweep'));
  assert.equal(installGitHook(repo, REL, {}).status, 'installed', 'reinstall over our own hook is fine');
  assert.equal(installGitHook(repo, REL, { remove: true }).status, 'removed');
  writeFileSync(join(gitHooksDir(repo), 'post-commit'), '#!/bin/sh\necho mine\n');
  const r3 = installGitHook(repo, REL, {});
  assert.equal(r3.status, 'installed', 'a foreign hook is chained, not skipped');
  assert.equal(r3.chained, 'non-executable', 'writeFileSync without a mode is 0644');
  assert.equal(readFileSync(join(gitHooksDir(repo), 'post-commit.pre-tokenomics'), 'utf8'), '#!/bin/sh\necho mine\n');
  assert.equal(installGitHook(repo, REL, { remove: true }).status, 'removed');
  assert.equal(readFileSync(join(gitHooksDir(repo), 'post-commit'), 'utf8'), '#!/bin/sh\necho mine\n');
  assert.equal(installGitHook(repo, REL, { remove: true }).status, 'not-ours');
  assert.equal(installGitHook(tmp(), REL, {}).status, 'no-git');
});

test('configureOtel: writes exactly its keys across the three surfaces; remove strips only them', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet', env: { KEEP: '1' } }));
  mkdirSync(join(repo, '.vscode'), { recursive: true });
  writeFileSync(join(repo, '.vscode', 'settings.json'), JSON.stringify({ 'editor.fontSize': 14 }));
  configureOtel(repo, { endpoint: 'http://localhost:4318' });
  const s = read(join(repo, '.claude', 'settings.json'));
  assert.equal(s.model, 'sonnet');
  assert.equal(s.env.KEEP, '1');
  assert.equal(s.env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.equal(s.env.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/json');
  const v = read(join(repo, '.vscode', 'settings.json'));
  assert.equal(v['editor.fontSize'], 14);
  assert.equal(v['github.copilot.chat.otel.enabled'], true);
  assert.equal(read(join(repo, '.agents', 'telemetry', 'automation', 'config.json')).otel.enabled, true);
  configureOtel(repo, { remove: true });
  const s2 = read(join(repo, '.claude', 'settings.json'));
  assert.equal(s2.env.KEEP, '1');
  assert.ok(!('CLAUDE_CODE_ENABLE_TELEMETRY' in s2.env));
  const v2 = read(join(repo, '.vscode', 'settings.json'));
  assert.equal(v2['editor.fontSize'], 14);
  assert.ok(!('github.copilot.chat.otel.enabled' in v2));
  assert.equal(read(join(repo, '.agents', 'telemetry', 'automation', 'config.json')).otel.enabled, false);
});

// The flat era wrote at the telemetry root; readers look only in automation/.
// Un-migrated history silently vanishes from reports — so every install run
// migrates, idempotently, without ever clobbering newer automation/ data.
test('migrateTelemetryLayout: moves flat-era files into automation/, merges dirs, never clobbers', () => {
  const repo = tmp();
  const root = join(repo, '.agents', 'telemetry');
  mkdirSync(join(root, 'scopes'), { recursive: true });
  writeFileSync(join(root, 'usage-alice.jsonl'), '{"v":1}\n');
  writeFileSync(join(root, 'config.json'), '{}');
  writeFileSync(join(root, 'scopes', 'sess-1.json'), '{}');
  writeFileSync(join(root, 'README.md'), 'seeded');       // submodule seed — must stay put
  // automation/ already holds a NEWER scopes record with a clashing name
  mkdirSync(join(root, 'automation', 'scopes'), { recursive: true });
  writeFileSync(join(root, 'automation', 'scopes', 'sess-1.json'), '{"newer":true}');
  const moved = migrateTelemetryLayout(repo);
  assert.ok(moved >= 2, `usage + config moved (got ${moved})`);
  assert.ok(existsSync(join(root, 'automation', 'usage-alice.jsonl')));
  assert.ok(existsSync(join(root, 'automation', 'config.json')));
  assert.ok(!existsSync(join(root, 'usage-alice.jsonl')), 'nothing left at the flat root');
  assert.equal(readFileSync(join(root, 'automation', 'scopes', 'sess-1.json'), 'utf8'), '{"newer":true}',
    'existing automation/ data wins over the flat-era clash');
  assert.ok(existsSync(join(root, 'README.md')), 'non-telemetry seeds untouched');
  assert.equal(migrateTelemetryLayout(repo), 0, 'idempotent — second run is a no-op');
  assert.equal(migrateTelemetryLayout(tmp()), 0, 'no telemetry dir → quiet no-op');
});

// --- Activation (Plan 5 Task 7; spec §14.2 step 2, D-ACT, D-REC, D-SUB, D-CKPT, D-HOST, D-MAN) ----------------------
// Hermetic (spec §14.2): the package's published files are copied to a temp directory, `install` runs from there into
// a temp consumer repo, the temp package is deleted, and every later command runs from the installed copy only, as a
// spawned child. Git is isolated: a temp global config, no system config, file protocol only, no network.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC_ENGINE = JSON.parse(readFileSync(join(ROOT, 'tokenomics', 'ENGINE.json'), 'utf8')).engine;

const sandbox = (t, p) => {
  const d = mkdtempSync(join(tmpdir(), `tokenomics-act7-${p}-`));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })); // a detached sweep may still be writing
  return d;
};

let publishedFiles = null;
function published() {
  if (!publishedFiles) {
    const cache = mkdtempSync(join(tmpdir(), 'tokenomics-act7-npm-'));
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--offline'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, npm_config_cache: cache, npm_config_update_notifier: 'false' },
    });
    rmSync(cache, { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr);
    publishedFiles = JSON.parse(r.stdout)[0].files.map((f) => f.path);
  }
  return publishedFiles;
}

// Child env: never the parent's TOKENOMICS_* or git config; no metering, sync or sink; fake host stores.
const PASS = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'USERPROFILE', 'NODE_V8_COVERAGE'];
function isolatedEnv(t, repo, extra = {}) {
  const home = sandbox(t, 'home');
  const gitcfg = join(home, 'gitconfig');
  writeFileSync(gitcfg, '[init]\n\tdefaultBranch = main\n');
  const store = join(home, 'claude-store');
  mkdirSync(store);
  return {
    ...Object.fromEntries(PASS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
    HOME: home, CLAUDE_PROJECT_DIR: repo,
    GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0',
    TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_SINK: '1', TOKENOMICS_NO_BATCH_COST: '1',
    TOKENOMICS_CLAUDE_ROOT: store, TOKENOMICS_COPILOT_ROOT: join(home, 'none'), TOKENOMICS_VSCODE_ROOT: join(home, 'none'),
    ...extra,
  };
}
const ID = ['-c', 'user.name=Tester', '-c', 'user.email=tester@example.invalid'];
const gitIn = (cwd, env, ...args) => {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A temp package (the published files), optionally re-versioned (a synthetic upgrade). */
function makePackage(t, { engine = null } = {}) {
  const pkg = sandbox(t, 'pkg');
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
/** `install` from a temp package, then the package is deleted. */
function installFrom(t, repo, env, { engine = null } = {}) {
  const pkg = makePackage(t, { engine });
  const r = spawnSync(process.execPath, [join(pkg, 'bin', 'harness-telemetry.mjs'), 'install', 'tokenomics', '--target', 'claude', '--repo', repo], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  rmSync(pkg, { recursive: true, force: true });
  return join(repo, '.claude', 'skills', 'tokenomics');
}
/** A consumer repo with one commit and the engine installed (not activated). */
function consumerRepo(t, { name = 'repo' } = {}) {
  const repo = join(sandbox(t, 'c'), name);
  mkdirSync(repo);
  const env = isolatedEnv(t, repo);
  gitIn(repo, env, 'init', '-q');
  writeFileSync(join(repo, 'README.md'), 'consumer\n');
  gitIn(repo, env, 'add', '.');
  gitIn(repo, env, ...ID, 'commit', '-q', '-m', 'init');
  const skill = installFrom(t, repo, env);
  return { repo, env, skill };
}
const run = (skill, rel, args, { repo, env, input = '' }) =>
  spawnSync(process.execPath, [join(skill, rel), ...args], { cwd: repo, env, input, encoding: 'utf8', timeout: 120000 });
const activateCli = (ctx, args = ['--host', 'claude']) => run(ctx.skill, 'scripts/install-hooks.mjs', args, ctx);
const settingsOf = (repo) => JSON.parse(readFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), 'utf8'));
const STORE = '.agents/telemetry';
const tagCommit = (ctx, tag) => spawnSync('git', ['rev-parse', '--verify', '-q', `refs/tags/${tag}`], { cwd: join(ctx.repo, STORE), env: ctx.env, encoding: 'utf8' }).stdout.trim();

function oldTranscript(dir, id) {
  const p = join(dir, `${id}.jsonl`);
  writeFileSync(p, `${[
    { type: 'user', message: { role: 'user', content: 'hello' }, timestamp: '2026-07-30T10:00:00Z' },
    { type: 'assistant', timestamp: '2026-07-30T10:01:00Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [] } },
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(p, old, old); // past the live grace: a sweep may take it
  return p;
}
const ledgerLines = (repo, dir = 'tokenomics') => {
  const d = join(repo, STORE, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => /^usage-.*\.jsonl$/.test(f))
    .flatMap((f) => readFileSync(join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
};
const walk = (root, skip = () => false) => {
  const out = {};
  const go = (d, p) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = p ? `${p}/${e.name}` : e.name;
      if (skip(rel)) continue;
      if (e.isDirectory()) go(join(d, e.name), rel); else out[rel] = readFileSync(join(d, e.name)).toString('base64');
    }
  };
  go(root, '');
  return out;
};

// Every file's mtime (ns): a no-op re-run must not even rewrite identical bytes.
const mtimes = (root, skip = () => false) => {
  const out = {};
  const go = (d, p) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = p ? `${p}/${e.name}` : e.name;
      if (skip(rel)) continue;
      if (e.isDirectory()) go(join(d, e.name), rel); else out[rel] = statSync(join(d, e.name), { bigint: true }).mtimeNs.toString();
    }
  };
  go(root, '');
  return out;
};

test('activation (a): the order is observable — a failing hook step leaves the checkpoint taken and engine unrecorded; a re-run completes', (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores a read-only file');
  const ctx = consumerRepo(t);
  const claudeSettings = join(ctx.repo, '.claude', 'settings.json');
  writeFileSync(claudeSettings, '{}\n');
  chmodSync(claudeSettings, 0o444);
  const r = activateCli(ctx);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /activation stopped at host hooks/);
  assert.match(r.stderr, /activation NOT recorded/);
  // steps 2-5 ran: settings (unrecorded), substrate, checkpoint, module manifest; step 7 did not
  assert.equal(settingsOf(ctx.repo).engine, null, 'engine not recorded');
  assert.equal(settingsOf(ctx.repo).substrate.form, 'submodule');
  const tag = tagCommit(ctx, `pre-engine-${SRC_ENGINE}`);
  assert.match(tag, /^[0-9a-f]{40}$/, 'checkpoint tag exists');
  assert.ok(existsSync(join(ctx.repo, STORE, 'tokenomics', 'module.json')), 'module manifest (step 5) written');
  assert.ok(!existsSync(join(ctx.repo, '.gitignore')), 'ignore lines (step 7) not reached');
  assert.equal(readFileSync(claudeSettings, 'utf8'), '{}\n');
  // the copy stays inert
  const inert = run(ctx.skill, 'hooks/telemetry-capture.mjs', ['--sweep'], ctx);
  assert.equal(inert.status, 0);
  assert.match(inert.stderr, /inactive — engine .* copied but not activated/);

  chmodSync(claudeSettings, 0o644);
  const r2 = activateCli(ctx);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stderr, /already taken \(bundle verified\)/);
  const s = settingsOf(ctx.repo);
  assert.equal(s.engine, SRC_ENGINE);
  assert.deepEqual(s.targets, ['claude']);
  assert.equal(tagCommit(ctx, `pre-engine-${SRC_ENGINE}`), tag, 'the tag never moves');
  assert.ok(JSON.parse(readFileSync(claudeSettings, 'utf8')).hooks.SessionEnd, 'hooks wired');
  assert.match(readFileSync(join(ctx.repo, '.gitignore'), 'utf8'), /tokenomics \(managed\)/);
  // the pointer staged in the main repo names the telemetry branch head (the checkpoint commit)
  const staged = gitIn(ctx.repo, ctx.env, 'ls-files', '-s', '--', STORE).split(/\s+/)[1];
  assert.equal(staged, gitIn(join(ctx.repo, STORE), ctx.env, 'rev-parse', 'refs/heads/telemetry'));
});

test('activation: a fresh settings.json is the standalone document; extension null, Stop gate off, TA receipts', (t) => {
  const ctx = consumerRepo(t);
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(settingsOf(ctx.repo), {
    engine: SRC_ENGINE, dir: 'tokenomics', extension: null,
    substrate: { required: null, form: 'submodule' },
    enforcement: { announce: true, stopGate: 'off' },
    targets: ['claude'],
    receipts: { root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red'] },
  });
  // an active standalone copy loads no extension (Task 4 carried item)
  const w = run(ctx.skill, 'scripts/work-scope.mjs', ['list'], ctx);
  assert.doesNotMatch(w.stderr, /cannot load extension/);
});

test('activation (b): a missing --host exits 2 with the list; --host copilot equals --host copilot-cli', (t) => {
  const ctx = consumerRepo(t);
  const r = activateCli(ctx, []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--host is required — one of: claude, copilot-cli, vscode/);
  assert.ok(!existsSync(join(ctx.repo, '.agents')), 'nothing written');
  assert.equal(activateCli(ctx, ['--host', 'nope']).status, 2);
  const hosts = ['copilot', 'copilot-cli'];
  const repos = hosts.map(() => consumerRepo(t));
  repos.forEach((c, i) => { const a = activateCli(c, ['--host', hosts[i]]); assert.equal(a.status, 0, a.stderr); });
  const [a, b] = repos.map((c) => readFileSync(join(c.repo, '.github', 'hooks', 'tokenomics.json'), 'utf8'));
  assert.equal(a, b);
  for (const c of repos) assert.deepEqual(settingsOf(c.repo).targets, ['copilot-cli']);
  assert.ok(!('agentStop' in JSON.parse(a).hooks), 'the Copilot gate is off too');
});

test('activation (c): the Stop gate is not wired while stopGate is off, and is wired after it is set on and activation re-runs', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx).status, 0);
  const cs = () => JSON.parse(readFileSync(join(ctx.repo, '.claude', 'settings.json'), 'utf8')).hooks;
  assert.ok(!cs().Stop, 'no Stop entry');
  assert.ok(cs().PreToolUse && cs().SessionStart, 'the rest of the scope contract is wired');
  const s = settingsOf(ctx.repo);
  writeFileSync(join(ctx.repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ ...s, enforcement: { ...s.enforcement, stopGate: 'on' } }));
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(cs().Stop.some((e) => e._tokenomics && e.hooks[0].command.includes('--gate')), 'Stop gate wired');
});

test('activation (d): activating twice is a no-op the second time — identical tree, tags and settings; "already active"', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx).status, 0);
  const state = () => ({
    tree: walk(ctx.repo, (p) => p === '.git' || p === `${STORE}/.git`),
    mtimes: mtimes(ctx.repo, (p) => p === '.git' || p === `${STORE}/.git`),
    index: gitIn(ctx.repo, ctx.env, 'ls-files', '-s'),
    status: gitIn(ctx.repo, ctx.env, 'status', '--porcelain', '--ignore-submodules=none'),
    refs: gitIn(ctx.repo, ctx.env, 'for-each-ref'),
    storeRefs: gitIn(join(ctx.repo, STORE), ctx.env, 'for-each-ref'),
    storeStatus: gitIn(join(ctx.repo, STORE), ctx.env, 'status', '--porcelain'),
    bundles: walk(join(gitIn(ctx.repo, ctx.env, 'rev-parse', '--absolute-git-dir'), 'tokenomics')),
  });
  const before = state();
  // M12: the store files activation writes are committed (locally) at once: the store checkout is clean.
  assert.equal(before.storeStatus, '', 'the store is clean after activation');
  const tracked = gitIn(join(ctx.repo, STORE), ctx.env, 'ls-files', '--', 'tokenomics').split('\n');
  for (const f of ['tokenomics/module.json', 'tokenomics/manifests/1.json', 'tokenomics/config.json']) assert.ok(tracked.includes(f), f);
  assert.equal(gitIn(join(ctx.repo, STORE), ctx.env, 'log', '-1', '--format=%s'), `tokenomics: activate ${SRC_ENGINE}`);
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /already active/);
  assert.deepEqual(state(), before);
  const s = JSON.parse(readFileSync(join(ctx.repo, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.hooks.SessionEnd.length, 1, 'no duplicate host hooks');
});

test('activation (e): an interrupted upgrade, end to end — the inert copy captures nothing; activation checkpoints and records 0.4.1; the next sweep captures the missed session once', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx).status, 0);
  installFrom(t, ctx.repo, ctx.env, { engine: '0.4.1' }); // a synthetic 0.4.1, copied over the active 0.4.0
  oldTranscript(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'missed-1');
  const inert = run(ctx.skill, 'hooks/telemetry-capture.mjs', ['--sweep'], ctx);
  assert.equal(inert.status, 0);
  assert.match(inert.stderr, /inactive — engine 0\.4\.1 copied but activation records engine 0\.4\.0/);
  assert.deepEqual(ledgerLines(ctx.repo), [], 'captures nothing');
  assert.ok(existsSync(join(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'missed-1.jsonl')), 'the transcript stays in the store');

  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(tagCommit(ctx, 'pre-engine-0.4.1'), /^[0-9a-f]{40}$/, 'checkpoint pre-engine-0.4.1');
  assert.notEqual(tagCommit(ctx, 'pre-engine-0.4.1'), tagCommit(ctx, `pre-engine-${SRC_ENGINE}`));
  assert.equal(settingsOf(ctx.repo).engine, '0.4.1');

  for (let i = 0; i < 2; i++) {
    const s = run(ctx.skill, 'hooks/telemetry-capture.mjs', ['--sweep'], ctx);
    assert.equal(s.status, 0, s.stderr);
  }
  assert.deepEqual(ledgerLines(ctx.repo).map((l) => l.id), ['missed-1'], 'captured exactly once');
});

test('activation (f): module.json and manifests/1.json written once, schema-valid; a changed deliveredOutcomes is reported, never rewritten; --update-manifest writes revision 2', async (t) => {
  const { loadSchemas, validate } = await import('../kit/schema.mjs');
  const schemas = loadSchemas();
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx).status, 0);
  const dir = join(ctx.repo, STORE, 'tokenomics');
  const cur = readFileSync(join(dir, 'module.json'), 'utf8');
  assert.equal(readFileSync(join(dir, 'manifests', '1.json'), 'utf8'), cur);
  assert.deepEqual(validate(schemas['module.json'], JSON.parse(cur), { schemas }), []);
  assert.equal(JSON.parse(cur).domain, 'tokenomics');

  const s = settingsOf(ctx.repo);
  writeFileSync(join(ctx.repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ ...s, receipts: { ...s.receipts, deliveredOutcomes: ['delivered'] } }));
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /module\.json revision 1 differs from settings in receipts\.deliveredOutcomes — left as is/);
  assert.equal(readFileSync(join(dir, 'module.json'), 'utf8'), cur, 'never rewritten');
  assert.deepEqual(readdirSync(join(dir, 'manifests')), ['1.json']);

  const u = run(ctx.skill, 'scripts/install-hooks.mjs', ['--update-manifest'], ctx);
  assert.equal(u.status, 0, u.stderr);
  const m2 = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8'));
  assert.equal(m2.manifestRevision, 2);
  assert.deepEqual(m2.receipts.deliveredOutcomes, ['delivered']);
  assert.equal(readFileSync(join(dir, 'manifests', '2.json'), 'utf8'), readFileSync(join(dir, 'module.json'), 'utf8'));
  assert.equal(readFileSync(join(dir, 'manifests', '1.json'), 'utf8'), cur);
});

test('activation (g): in a repo path with spaces, the wired Claude command, run through sh -c as written, reaches the hook', (t) => {
  const ctx = consumerRepo(t, { name: 'my consumer repo' });
  assert.equal(activateCli(ctx).status, 0);
  const hooks = JSON.parse(readFileSync(join(ctx.repo, '.claude', 'settings.json'), 'utf8')).hooks;
  const command = hooks.SessionEnd.find((e) => e._tokenomics).hooks[0].command;
  const tp = oldTranscript(sandbox(t, 'tp'), 'spaced-1');
  const r = spawnSync('sh', ['-c', command], { cwd: ctx.repo, env: ctx.env, input: JSON.stringify({ transcript_path: tp, session_id: 'spaced-1' }), encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ledgerLines(ctx.repo).map((l) => l.id), ['spaced-1']);
});

test('activation (h): the generated README and the doctor text name no "test-automation factory" and no "cases"', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx).status, 0);
  const readme = readFileSync(join(ctx.repo, STORE, 'README.md'), 'utf8');
  const doc = run(ctx.skill, 'scripts/install-hooks.mjs', ['--doctor'], ctx);
  assert.equal(doc.status, 0, doc.stderr);
  for (const text of [readme, doc.stderr + doc.stdout]) {
    assert.doesNotMatch(text, /test-automation factory/i);
    assert.doesNotMatch(text, /\bcases\b/i);
  }
  assert.doesNotMatch(doc.stderr, /scope contract — announce\/gate not wired/, 'a gate installed off is not a warning');
});

test('activation: a substrate failure (no git) stops the run, nonzero, activation unrecorded, no hooks', (t) => {
  const repo = join(sandbox(t, 'nogit'), 'repo');
  mkdirSync(repo);
  const env = isolatedEnv(t, repo, { GIT_CEILING_DIRECTORIES: dirname(repo) });
  const skill = installFrom(t, repo, env);
  const r = run(skill, 'scripts/install-hooks.mjs', ['--host', 'claude'], { repo, env });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /activation stopped at substrate — substrate: .* is not a git repository/);
  assert.match(r.stderr, /remedy: run `git init`/);
  assert.equal(settingsOf(repo).engine, null);
  assert.ok(!existsSync(join(repo, '.claude', 'settings.json')), 'no hooks wired');
});

test('activation: an installed copy refuses to activate with TOKENOMICS_MIGRATIONS set', (t) => {
  const ctx = consumerRepo(t);
  const r = activateCli({ ...ctx, env: { ...ctx.env, TOKENOMICS_MIGRATIONS: 'none' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused — TOKENOMICS_MIGRATIONS is set in an installed engine/);
  assert.ok(!existsSync(join(ctx.repo, '.agents')));
});

// ---- B3 fix wave, Lane A: store, checkpoint, substrate, activation flow ----------------------------------------
/** An orphan `telemetry` branch holding `files`, built through a temp index (the main tree never moves). */
function telemetryBranchIn(t, ctx, files) {
  const idx = join(sandbox(t, 'idx'), 'index');
  const e = { ...ctx.env, GIT_INDEX_FILE: idx };
  for (const [path, body] of Object.entries(files)) {
    const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: ctx.repo, env: e, input: body, encoding: 'utf8' }).stdout.trim();
    gitIn(ctx.repo, e, 'update-index', '--add', '--cacheinfo', `100644,${blob},${path}`);
  }
  const tree = gitIn(ctx.repo, e, 'write-tree');
  const commit = gitIn(ctx.repo, ctx.env, ...ID, 'commit-tree', tree, '-m', 'telemetry: earlier writer');
  gitIn(ctx.repo, ctx.env, 'update-ref', 'refs/heads/telemetry', commit);
  return commit;
}
const showIn = (cwd, env, spec) => spawnSync('git', ['show', spec], { cwd, env, encoding: 'utf8' });

test('activation (Codex B3-02): interim files over an existing module directory — the extended ledger and a new scope reach the store and the checkpoint; nothing stays stranded', (t) => {
  const ctx = consumerRepo(t);
  telemetryBranchIn(t, ctx, { 'automation/usage-review.jsonl': '{"id":"old-session"}\n' });
  mkdirSync(join(ctx.repo, STORE, 'automation'), { recursive: true });
  writeFileSync(join(ctx.repo, STORE, 'automation', 'usage-review.jsonl'), '{"id":"old-session"}\n{"id":"new-session"}\n');
  writeFileSync(join(ctx.repo, STORE, 'automation', 'new.json'), 'durable-new-scope');
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  const store = join(ctx.repo, STORE);
  const tag = `pre-engine-${SRC_ENGINE}`;
  assert.equal(showIn(store, ctx.env, `${tag}:automation/usage-review.jsonl`).stdout, '{"id":"old-session"}\n{"id":"new-session"}\n', 'the checkpoint holds the new session');
  assert.equal(showIn(store, ctx.env, `${tag}:automation/new.json`).stdout, 'durable-new-scope');
  assert.ok(!existsSync(join(ctx.repo, `${STORE}.pre-submodule`)), 'nothing stranded');
});

test('activation (Codex B3-07): an ordinary clone (no --recurse-submodules) activates — the store gets a local telemetry branch tracking origin/telemetry before the checkpoint', async (t) => {
  const { ensureSubstrate } = await import('../engine/substrate.mjs');
  const ctx = consumerRepo(t);
  ensureSubstrate(ctx.repo, {}, { env: ctx.env });
  const store = join(ctx.repo, STORE);
  gitIn(ctx.repo, ctx.env, 'fetch', '-q', '--no-write-fetch-head', store, `${gitIn(store, ctx.env, 'rev-parse', 'HEAD')}:refs/heads/telemetry`); // the seed, published
  gitIn(ctx.repo, ctx.env, 'add', '-A');
  gitIn(ctx.repo, ctx.env, ...ID, 'commit', '-q', '-m', 'store + installed copy');
  const clone = join(sandbox(t, 'clone'), 'clone');
  gitIn(dirname(clone), ctx.env, 'clone', '-q', ctx.repo, clone);
  const cctx = { repo: clone, env: isolatedEnv(t, clone), skill: join(clone, '.claude', 'skills', 'tokenomics') };
  const r = activateCli(cctx);
  assert.equal(r.status, 0, r.stderr);
  const cs = join(clone, STORE);
  assert.equal(gitIn(cs, cctx.env, 'branch', '--show-current'), 'telemetry');
  assert.equal(gitIn(cs, cctx.env, 'rev-parse', '--abbrev-ref', 'telemetry@{upstream}'), 'origin/telemetry');
  assert.match(tagCommit(cctx, `pre-engine-${SRC_ENGINE}`), /^[0-9a-f]{40}$/);
  assert.equal(settingsOf(clone).engine, SRC_ENGINE);
});

test('activation (B3 final review M9): an existing, uncommitted settings.json is checkpointed as the operator wrote it; the merge lands after the checkpoint', (t) => {
  const ctx = consumerRepo(t);
  const original = '{"dir":"tokenomics","extension":null}\n';
  mkdirSync(join(ctx.repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(ctx.repo, '.agents', 'tokenomics', 'settings.json'), original);
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  const tag = `pre-engine-${SRC_ENGINE}`;
  const snap = showIn(join(ctx.repo, STORE), ctx.env, `${tag}:.checkpoints/${tag}/main-tree/.agents/tokenomics/settings.json`);
  assert.equal(snap.status, 0, snap.stderr);
  assert.equal(snap.stdout, original, 'the checkpoint holds the original bytes, not the merge');
  const s = settingsOf(ctx.repo);
  assert.deepEqual(s.enforcement, { announce: true, stopGate: 'off' });
  assert.equal(s.substrate.form, 'submodule');
  assert.equal(s.engine, SRC_ENGINE);
});

test('activation (B3 final review M10): --git-hook over a foreign hook with an existing backup is refused before any step writes', (t) => {
  const ctx = consumerRepo(t);
  mkdirSync(join(ctx.repo, '.git', 'hooks'), { recursive: true });
  writeFileSync(hookPath(ctx.repo), '#!/bin/sh\necho foreign\n', { mode: 0o755 });
  writeFileSync(hookPath(ctx.repo, 'post-commit.pre-tokenomics'),'#!/bin/sh\necho older\n', { mode: 0o755 });
  const r = activateCli(ctx, ['--host', 'claude', '--git-hook']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /activation stopped at git hook/);
  assert.match(r.stderr, /NOT installed — a foreign post-commit hook and .* both exist/);
  assert.ok(!existsSync(join(ctx.repo, '.agents')), 'no settings, no store');
  assert.ok(!existsSync(join(ctx.repo, '.gitmodules')), 'no substrate');
  assert.ok(!existsSync(join(ctx.repo, '.gitignore')) && !existsSync(join(ctx.repo, '.claude', 'settings.json')), 'no ignore lines, no host hooks');
  assert.ok(!existsSync(join(ctx.repo, '.git', 'tokenomics')), 'no checkpoint bundle');
});

test('activation (B3 final review M8): a re-run that rewires a hook does not claim "already active", and names what it wrote', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx).status, 0);
  const s = settingsOf(ctx.repo);
  writeFileSync(join(ctx.repo, '.agents', 'tokenomics', 'settings.json'), `${JSON.stringify({ ...s, enforcement: { ...s.enforcement, stopGate: 'on' } }, null, 2)}\n`);
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /already active/);
  assert.match(r.stderr, /activated engine \S+ for claude \(was active; this run updated: \.claude\/settings\.json\)/);
  const again = activateCli(ctx);
  assert.match(again.stderr, /already active — .*nothing written/);
});

test('activation (B3 final review T7-5): spawned --remove unwires the host and the ignore block; --host claude --update-manifest writes revision 2', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx).status, 0);
  const s = settingsOf(ctx.repo);
  writeFileSync(join(ctx.repo, '.agents', 'tokenomics', 'settings.json'), `${JSON.stringify({ ...s, receipts: { ...s.receipts, deliveredOutcomes: ['delivered'] } }, null, 2)}\n`);
  const u = activateCli(ctx, ['--host', 'claude', '--update-manifest']);
  assert.equal(u.status, 0, u.stderr);
  assert.match(u.stderr, /module manifest revision 2 written/);
  const dir = join(ctx.repo, STORE, 'tokenomics');
  assert.equal(JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8')).manifestRevision, 2);
  assert.deepEqual(readdirSync(join(dir, 'manifests')).sort(), ['1.json', '2.json']);

  const rm = activateCli(ctx, ['--remove', '--host', 'claude']);
  assert.equal(rm.status, 0, rm.stderr);
  assert.match(rm.stderr, /removed hooks from/);
  const cs = JSON.parse(readFileSync(join(ctx.repo, '.claude', 'settings.json'), 'utf8'));
  assert.ok(!cs.hooks || !Object.values(cs.hooks).flat().some((e) => e?._tokenomics), 'no marked entry left');
  assert.ok(!existsSync(join(ctx.repo, '.gitignore')) || !/tokenomics \(managed\)/.test(readFileSync(join(ctx.repo, '.gitignore'), 'utf8')), 'the ignore block is gone');
});

test('activation (B3 final review T7-6): flat-era files at the store root are in the checkpoint at the root, and under <dir>/ after activation', (t) => {
  const ctx = consumerRepo(t);
  const flat = { 'usage-old.jsonl': '{"v":1,"host":"claude","id":"flat-era"}\n', 'scopes/s1.json': '{"scope":1}\n', 'config.json': '{"capturePrompts":false}\n' };
  telemetryBranchIn(t, ctx, flat);
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /migrated \d+ old-layout telemetry entr/);
  const store = join(ctx.repo, STORE);
  const tag = `pre-engine-${SRC_ENGINE}`;
  for (const [p, body] of Object.entries(flat)) assert.equal(showIn(store, ctx.env, `${tag}:${p}`).stdout, body, `the tag holds ${p} at the root`);
  const dir = settingsOf(ctx.repo).dir;
  assert.equal(dir, 'tokenomics');
  assert.equal(readFileSync(join(store, dir, 'usage-old.jsonl'), 'utf8'), flat['usage-old.jsonl']);
  assert.equal(readFileSync(join(store, dir, 'scopes', 's1.json'), 'utf8'), flat['scopes/s1.json']);
  assert.equal(readFileSync(join(store, dir, 'config.json'), 'utf8'), flat['config.json'], 'an existing config is moved, never overwritten');
  for (const p of ['usage-old.jsonl', 'scopes', 'config.json']) assert.ok(!existsSync(join(store, p)), `${p} left the root`);
});

test('activation (B3 R26): an existing store without the working-state ignore lines gets them; an untracked live/ file never reaches the pushed telemetry branch', async (t) => {
  const { INNER_GITIGNORE } = await import('../engine/substrate.mjs');
  const ctx = consumerRepo(t);
  const g = (...a) => gitIn(ctx.repo, ctx.env, ...a);
  telemetryBranchIn(t, ctx, { 'automation/usage-x.jsonl': '{"v":1,"host":"claude","id":"earlier"}\n', 'automation/live/old.jsonl': '{"tracked":true}\n' });
  g('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', '-b', 'telemetry', '--', './', STORE);
  g('config', '-f', '.gitmodules', `submodule.${STORE}.ignore`, 'all');
  g('add', '.gitmodules');
  g(...ID, 'commit', '-q', '-m', 'chore: telemetry submodule (reference era, no inner .gitignore)');
  const store = join(ctx.repo, STORE);
  assert.ok(!existsSync(join(store, '.gitignore')));
  mkdirSync(join(store, 'automation', 'live'), { recursive: true });
  writeFileSync(join(store, 'automation', 'live', 'x.jsonl'), '{"live":1}\n');

  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(store, '.gitignore'), 'utf8'), INNER_GITIGNORE, 'the working-state lines are added');
  assert.ok(gitIn(store, ctx.env, 'ls-files').split('\n').includes('.gitignore'), 'committed in the activation commit');
  assert.ok(gitIn(store, ctx.env, 'ls-files').split('\n').includes('automation/live/old.jsonl'), 'a tracked file is never untracked');
  assert.equal(gitIn(store, ctx.env, 'status', '--porcelain'), '', 'the store is clean');
  assert.match(activateCli(ctx).stderr, /already active/, 'a re-run changes nothing');

  const bare = join(sandbox(t, 'bare'), 'remote.git');
  gitIn(ctx.repo, ctx.env, 'init', '-q', '--bare', bare);
  gitIn(store, ctx.env, 'remote', 'set-url', 'origin', bare);
  oldTranscript(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'r26-1');
  const env = { ...ctx.env };
  delete env.TOKENOMICS_NO_SYNC; // sync really runs and pushes
  const s = run(ctx.skill, 'hooks/telemetry-capture.mjs', ['--sweep'], { ...ctx, env });
  assert.equal(s.status, 0, s.stderr);
  const pushed = () => spawnSync('git', ['ls-tree', '-r', '--name-only', 'refs/heads/telemetry'], { cwd: bare, env, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const captured = () => pushed().filter((p) => /^automation\/usage-.*\.jsonl$/.test(p))
    .some((p) => spawnSync('git', ['show', `refs/heads/telemetry:${p}`], { cwd: bare, env, encoding: 'utf8' }).stdout.includes('r26-1'));
  assert.ok(waitFor(captured), `the capture was pushed: ${pushed()}`);
  assert.ok(!pushed().includes('automation/live/x.jsonl'), `live/x.jsonl is not on the pushed branch: ${pushed()}`);
  assert.ok(pushed().includes('automation/live/old.jsonl'), 'the tracked file stays');
});

// ---- Plan 5 Task 8: the git post-commit fallback (D-GIT) ------------------------------------------------------
const commitIn = (cwd, env, msg = 'c') => gitIn(cwd, env, ...ID, 'commit', '--allow-empty', '-q', '-m', msg);
const hookPath = (repo, name = 'post-commit') => join(repo, '.git', 'hooks', name);
const waitFor = (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
  return fn();
};
const gitHookCli = (ctx, args) => run(ctx.skill, 'scripts/install-hooks.mjs', args, ctx);

test('git fallback (a): --host claude --git-hook wires the host AND the hook; --git-hook alone on an active install adds only the hook', (t) => {
  const ctx = consumerRepo(t);
  const plain = activateCli(ctx);
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(!existsSync(hookPath(ctx.repo)), 'no git hook unless asked');
  const settingsFile = join(ctx.repo, '.claude', 'settings.json');
  const before = readFileSync(settingsFile);
  const only = gitHookCli(ctx, ['--git-hook']);
  assert.equal(only.status, 0, only.stderr);
  assert.ok(existsSync(hookPath(ctx.repo)));
  assert.deepEqual(readFileSync(settingsFile), before, 'the host wiring is untouched');

  const both = consumerRepo(t);
  const r = activateCli(both, ['--host', 'claude', '--git-hook']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(readFileSync(join(both.repo, '.claude', 'settings.json'), 'utf8')).hooks.SessionEnd, 'host wired');
  assert.match(readFileSync(hookPath(both.repo), 'utf8'), /# tokenomics-sweep/);
  assert.equal(settingsOf(both.repo).engine, SRC_ENGINE, 'activation recorded after the hook');
});

test('git fallback (b): core.hooksPath=.githooks — the hook lands there', (t) => {
  const ctx = consumerRepo(t);
  gitIn(ctx.repo, ctx.env, 'config', 'core.hooksPath', '.githooks');
  const r = activateCli(ctx, ['--host', 'claude', '--git-hook']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(ctx.repo, '.githooks', 'post-commit')));
  assert.ok(!existsSync(hookPath(ctx.repo)), 'not in .git/hooks, which git would not run');
});

test('git fallback (c): a linked worktree — the hook is in the common hooks dir and a commit in the worktree triggers it', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx, ['--host', 'claude', '--git-hook']).status, 0);
  const wt = join(sandbox(t, 'wt'), 'linked');
  gitIn(ctx.repo, ctx.env, 'worktree', 'add', '-q', '-b', 'wt', wt);
  assert.ok(existsSync(hookPath(ctx.repo)));
  assert.ok(!existsSync(join(wt, '.git', 'hooks')), 'a worktree .git is a file');
  oldTranscript(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'wt-1');
  commitIn(wt, ctx.env);
  assert.ok(waitFor(() => ledgerLines(ctx.repo).some((l) => l.id === 'wt-1')), 'the worktree commit ran the sweep');
  assert.equal(realpathSync(gitHooksDir(wt)), realpathSync(join(ctx.repo, '.git', 'hooks')), 'the worktree resolves to the common hooks dir');
});

test('git fallback (d): a foreign exit-3 hook is chained — marker written, commit reported, sweep ran, status 3; --remove restores it byte for byte', (t) => {
  const ctx = consumerRepo(t);
  const marker = join(sandbox(t, 'm'), 'foreign-ran');
  const original = `#!/bin/sh\n# my hook\necho ran > '${marker}'\nexit 3\n`;
  writeFileSync(hookPath(ctx.repo), original, { mode: 0o755 });
  const r = activateCli(ctx, ['--host', 'claude', '--git-hook']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /chained/);
  assert.equal(readFileSync(hookPath(ctx.repo, 'post-commit.pre-tokenomics'), 'utf8'), original);
  oldTranscript(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'fx-1');
  commitIn(ctx.repo, ctx.env, 'with foreign');
  assert.match(gitIn(ctx.repo, ctx.env, 'log', '-1', '--format=%s'), /with foreign/, 'git still reports the commit');
  assert.ok(existsSync(marker), 'the foreign hook ran');
  assert.ok(waitFor(() => ledgerLines(ctx.repo).some((l) => l.id === 'fx-1')), 'our sweep ran');
  // a no-op `node` so this direct run starts no second detached sweep that could outlive the test's cleanup
  const shim = sandbox(t, 'shim');
  writeFileSync(join(shim, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const direct = spawnSync('sh', [hookPath(ctx.repo)], { cwd: ctx.repo, env: { ...ctx.env, PATH: `${shim}:${ctx.env.PATH}` }, encoding: 'utf8' });
  assert.equal(direct.status, 3, 'the foreign hook exit status is the hook exit status');

  const rm = gitHookCli(ctx, ['--git-hook', '--remove']);
  assert.equal(rm.status, 0, rm.stderr);
  assert.equal(readFileSync(hookPath(ctx.repo), 'utf8'), original, 'byte for byte');
  assert.equal(statSync(hookPath(ctx.repo)).mode & 0o777, 0o755);
  assert.ok(!existsSync(hookPath(ctx.repo, 'post-commit.pre-tokenomics')));
});

test('git fallback (e): a non-executable foreign hook is chained and left non-executable; the report says git would not have run it', (t) => {
  const ctx = consumerRepo(t);
  const marker = join(sandbox(t, 'm'), 'foreign-ran');
  const original = `#!/bin/sh\necho ran > '${marker}'\nexit 3\n`;
  writeFileSync(hookPath(ctx.repo), original, { mode: 0o644 });
  chmodSync(hookPath(ctx.repo), 0o644);
  const r = activateCli(ctx, ['--host', 'claude', '--git-hook']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /NOT executable.*git would not have run it/);
  const pre = hookPath(ctx.repo, 'post-commit.pre-tokenomics');
  assert.equal(statSync(pre).mode & 0o111, 0, 'left non-executable');
  commitIn(ctx.repo, ctx.env);
  assert.ok(!existsSync(marker), 'neither git nor we ran it');
  const shim = sandbox(t, 'shim'); // a no-op `node`: the direct run starts no second sweep (see (d))
  writeFileSync(join(shim, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(spawnSync('sh', [hookPath(ctx.repo)], { cwd: ctx.repo, env: { ...ctx.env, PATH: `${shim}:${ctx.env.PATH}` } }).status, 0);
  assert.equal(gitHookCli(ctx, ['--git-hook', '--remove']).status, 0);
  assert.equal(readFileSync(hookPath(ctx.repo), 'utf8'), original);
  assert.equal(statSync(hookPath(ctx.repo)).mode & 0o111, 0, 'still non-executable');
});

test('git fallback (f): a real git commit produces the session ledger line; the commit returns before the sweep finishes', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx, ['--host', 'claude', '--git-hook']).status, 0);
  oldTranscript(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'real-1');
  assert.deepEqual(ledgerLines(ctx.repo), []);
  commitIn(ctx.repo, ctx.env);
  assert.ok(waitFor(() => ledgerLines(ctx.repo).some((l) => l.id === 'real-1')), 'the ledger line appeared within 20 s');

  // never blocks: a `node` that sleeps stands in for a slow sweep; the commit must not wait for it
  const shim = sandbox(t, 'shim');
  const done = join(shim, 'finished');
  writeFileSync(join(shim, 'node'), `#!/bin/sh\nsleep 5\ntouch '${done}'\n`, { mode: 0o755 });
  const slowEnv = { ...ctx.env, PATH: `${shim}:${ctx.env.PATH}` };
  const t0 = Date.now();
  commitIn(ctx.repo, slowEnv, 'slow sweep');
  assert.ok(Date.now() - t0 < 3500, `the commit returned in ${Date.now() - t0} ms, before the 5 s sweep`);
  assert.ok(!existsSync(done), 'the sweep was still running when the commit returned');
});

test('git fallback (g): a repo path with spaces — the hook runs the sweep', (t) => {
  const ctx = consumerRepo(t, { name: 'my consumer repo' });
  assert.equal(activateCli(ctx, ['--host', 'claude', '--git-hook']).status, 0);
  oldTranscript(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'sp-1');
  commitIn(ctx.repo, ctx.env);
  assert.ok(waitFor(() => ledgerLines(ctx.repo).some((l) => l.id === 'sp-1')));
});

test('git fallback: a foreign hook behind an existing backup is refused, not overwritten; plain --remove restores the original', (t) => {
  const ctx = consumerRepo(t);
  writeFileSync(hookPath(ctx.repo), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(hookPath(ctx.repo, 'post-commit.pre-tokenomics'), '#!/bin/sh\nexit 9\n', { mode: 0o755 });
  const r = activateCli(ctx, ['--host', 'claude', '--git-hook']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /activation stopped at git hook/);
  assert.ok(!existsSync(join(ctx.repo, '.agents')), 'activation not recorded: refused before any step wrote (M10)');
  assert.equal(readFileSync(hookPath(ctx.repo, 'post-commit.pre-tokenomics'), 'utf8'), '#!/bin/sh\nexit 9\n');
  rmSync(hookPath(ctx.repo, 'post-commit.pre-tokenomics'));
  assert.equal(activateCli(ctx, ['--host', 'claude', '--git-hook']).status, 0);
  assert.equal(run(ctx.skill, 'scripts/install-hooks.mjs', ['--remove'], ctx).status, 0);
  assert.equal(readFileSync(hookPath(ctx.repo), 'utf8'), '#!/bin/sh\nexit 0\n', '--remove with no host restores the original too');
});

// Ruling R13: a fresh settings.json (no --dir) keeps an existing store's module directory, the one holding a ledger.
const seedStore = (repo, dirs) => {
  for (const d of dirs) {
    mkdirSync(join(repo, STORE, d), { recursive: true });
    writeFileSync(join(repo, STORE, d, `usage-${d}.jsonl`), '{"v":1,"host":"claude","id":"earlier"}\n');
  }
};

test('activation R13: a reference-era store (automation/ ledger, no settings) keeps dir automation; a captured line lands in automation/', (t) => {
  const ctx = consumerRepo(t);
  seedStore(ctx.repo, ['automation']);
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /settings dir "automation" — the existing store's module directory \.agents\/telemetry\/automation\/ holds a ledger/);
  assert.equal(settingsOf(ctx.repo).dir, 'automation');
  assert.ok(existsSync(join(ctx.repo, STORE, 'automation', 'module.json')));
  assert.ok(!existsSync(join(ctx.repo, STORE, 'tokenomics')), 'no second module directory');
  oldTranscript(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'after-1');
  const s = run(ctx.skill, 'hooks/telemetry-capture.mjs', ['--sweep'], ctx);
  assert.equal(s.status, 0, s.stderr);
  assert.deepEqual(ledgerLines(ctx.repo, 'automation').map((l) => l.id).sort(), ['after-1', 'earlier']);
});

test('activation R13: several ledger directories — automation/ preferred; without it a usage error asking for --dir; --dir wins', (t) => {
  const pref = consumerRepo(t);
  seedStore(pref.repo, ['delivery', 'automation']);
  const a = activateCli(pref);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(settingsOf(pref.repo).dir, 'automation');
  assert.match(a.stderr, /settings dir "automation" — preferred among the store's module directories with a ledger \(automation, delivery\)/);

  const amb = consumerRepo(t);
  seedStore(amb.repo, ['alpha', 'beta']);
  const b = activateCli(amb);
  assert.equal(b.status, 2, b.stderr);
  assert.match(b.stderr, /several module directories hold a ledger \(alpha, beta\) — pass --dir <name>/);
  assert.ok(!existsSync(join(amb.repo, '.agents', 'tokenomics', 'settings.json')), 'nothing recorded');
  const c = activateCli(amb, ['--host', 'claude', '--dir', 'beta']);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(settingsOf(amb.repo).dir, 'beta');
});

test('activation: an empty store keeps the standalone default dir tokenomics and says why', (t) => {
  const ctx = consumerRepo(t);
  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /settings dir "tokenomics" — the standalone default \(no module directory under \.agents\/telemetry\/ holds a ledger\)/);
});

test('--update-manifest on a repo that was never activated refuses and writes nothing (review minor 1)', (t) => {
  const ctx = consumerRepo(t);
  const u = run(ctx.skill, 'scripts/install-hooks.mjs', ['--update-manifest'], ctx);
  assert.equal(u.status, 1, u.stderr);
  assert.match(u.stderr, /no module\.json .* activate first/);
  assert.ok(!existsSync(join(ctx.repo, '.agents')));
});

// Ruling R13, fix 1b: a clone without --recurse-submodules has an empty store directory; the default dir comes from the
// store's history (the `telemetry` branch), not the disk.
test('activation R13: an unmaterialised store (registered, deinit\'d) whose telemetry branch holds automation/ gets dir automation', (t) => {
  const ctx = consumerRepo(t);
  const g = (...a) => gitIn(ctx.repo, ctx.env, ...a);
  // An orphan `telemetry` branch with a reference-era ledger, built through a temp index (the main tree never moves).
  const idx = join(sandbox(t, 'idx'), 'index');
  const e = { ...ctx.env, GIT_INDEX_FILE: idx };
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: ctx.repo, env: e, input: '{"v":1,"host":"claude","id":"earlier"}\n', encoding: 'utf8' }).stdout.trim();
  gitIn(ctx.repo, e, 'update-index', '--add', '--cacheinfo', `100644,${blob},automation/usage-x.jsonl`);
  const tree = gitIn(ctx.repo, e, 'write-tree');
  g('update-ref', 'refs/heads/telemetry', gitIn(ctx.repo, ctx.env, ...ID, 'commit-tree', tree, '-m', 'telemetry: reference era'));
  g('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', '-b', 'telemetry', '--', './', STORE);
  g('config', '-f', '.gitmodules', `submodule.${STORE}.ignore`, 'all');
  g('add', '.gitmodules');
  g(...ID, 'commit', '-q', '-m', 'chore: telemetry submodule');
  g('submodule', 'deinit', '-q', '-f', '--', STORE);
  assert.deepEqual(readdirSync(join(ctx.repo, STORE)), [], 'the store directory is empty, as after a clone without --recurse');

  const r = activateCli(ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(settingsOf(ctx.repo).dir, 'automation');
  assert.match(r.stderr, /settings dir "automation" — the store's history \(refs\/heads\/telemetry\) holds a ledger in automation\//);
  assert.ok(existsSync(join(ctx.repo, STORE, 'automation', 'usage-x.jsonl')), 'materialised by the substrate step');
  assert.ok(!existsSync(join(ctx.repo, STORE, 'tokenomics')));
});

test('git fallback fix 1: the sweep runs outside the hook environment — from a linked worktree with sync on, the worktree branch, HEAD, index and main HEAD are unchanged and the telemetry commit lands on the telemetry branch', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx, ['--host', 'claude', '--git-hook']).status, 0);
  const store = join(ctx.repo, STORE);
  const bare = join(sandbox(t, 'bare'), 'remote.git');
  gitIn(ctx.repo, ctx.env, 'init', '-q', '--bare', bare);
  gitIn(store, ctx.env, 'remote', 'set-url', 'origin', bare);
  const wt = join(sandbox(t, 'wt'), 'linked');
  gitIn(ctx.repo, ctx.env, 'worktree', 'add', '-q', '-b', 'wt', wt);
  oldTranscript(ctx.env.TOKENOMICS_CLAUDE_ROOT, 'sync-1');
  const env = { ...ctx.env };
  delete env.TOKENOMICS_NO_SYNC; // sync really runs
  const mainHead0 = gitIn(ctx.repo, env, 'rev-parse', 'HEAD');
  commitIn(wt, env, 'in worktree');
  const wtHead = gitIn(wt, env, 'rev-parse', 'HEAD');
  assert.ok(waitFor(() => ledgerLines(ctx.repo).some((l) => l.id === 'sync-1')), 'swept');
  assert.ok(waitFor(() => gitIn(store, env, 'log', '-1', '--format=%s', 'refs/heads/telemetry') === 'telemetry: capture'), 'the telemetry commit landed on the telemetry branch');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); // let the sync finish
  assert.equal(gitIn(wt, env, 'branch', '--show-current'), 'wt');
  assert.equal(gitIn(wt, env, 'rev-parse', 'HEAD'), wtHead, 'worktree HEAD unchanged');
  assert.equal(gitIn(wt, env, 'status', '--porcelain'), '', 'index and tree unchanged');
  assert.equal(gitIn(ctx.repo, env, 'rev-parse', 'HEAD'), mainHead0, 'main HEAD unchanged');
  assert.equal(gitIn(store, env, 'branch', '--show-current'), 'telemetry');
});

test('git fallback fix 1: --host X --git-hook --remove removes the hook too; a missing node is logged, not silent', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx, ['--host', 'claude', '--git-hook']).status, 0);
  // no node on git's PATH: a single line in <git-dir>/tokenomics-post-commit.log
  const bin = sandbox(t, 'bin');
  const real = (n) => spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nexec '${real('git')}' "$@"\n`, { mode: 0o755 });
  for (const n of ['dirname', 'date']) writeFileSync(join(bin, n), `#!/bin/sh\nexec '${real(n)}' "$@"\n`, { mode: 0o755 });
  commitIn(ctx.repo, { ...ctx.env, PATH: bin });
  const log = join(ctx.repo, '.git', 'tokenomics-post-commit.log');
  assert.ok(waitFor(() => existsSync(log), 5000), 'the failure is logged');
  assert.match(readFileSync(log, 'utf8'), /node not found/);
  assert.equal(gitHookCli(ctx, ['--host', 'claude', '--git-hook', '--remove']).status, 0);
  assert.ok(!existsSync(hookPath(ctx.repo)), 'the hook is removed with --host too');
  assert.equal(JSON.parse(readFileSync(join(ctx.repo, '.claude', 'settings.json'), 'utf8')).hooks?.SessionEnd, undefined, 'host unwired as well');
});

// ---- fix wave lane C: Codex B3-09 (R23) — the shared post-commit hook resolves the committing checkout at run time ----
test('git fallback (R23, Codex B3-09): primary and linked worktrees each carry an activated copy; a commit in either sweeps that checkout only', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx, ['--host', 'claude', '--git-hook']).status, 0);
  const wt = join(sandbox(t, 'wt'), 'linked');
  gitIn(ctx.repo, ctx.env, 'worktree', 'add', '-q', '-b', 'wt', wt);
  // the linked checkout's own activated copy (as a teammate who committed the copy would have; here installed + recorded)
  installFrom(t, wt, ctx.env);
  mkdirSync(join(wt, '.agents', 'tokenomics'), { recursive: true });
  copyFileSync(join(ctx.repo, '.agents', 'tokenomics', 'settings.json'), join(wt, '.agents', 'tokenomics', 'settings.json'));
  assert.equal(realpathSync(gitHooksDir(wt)), realpathSync(gitHooksDir(ctx.repo)), 'one shared hooks directory');

  const rootA = sandbox(t, 'rootA'); const rootB = sandbox(t, 'rootB');
  oldTranscript(rootA, 'primary-session');
  oldTranscript(rootB, 'linked-session');
  const ids = (repo) => ledgerLines(repo).map((l) => l.id).sort();

  commitIn(ctx.repo, { ...ctx.env, TOKENOMICS_CLAUDE_ROOT: rootA }, 'in primary');
  assert.ok(waitFor(() => ids(ctx.repo).includes('primary-session')), `primary swept: ${ids(ctx.repo)}`);
  assert.deepEqual(ids(wt), [], 'the linked checkout was not swept by a primary commit');

  commitIn(wt, { ...ctx.env, TOKENOMICS_CLAUDE_ROOT: rootB }, 'in linked');
  assert.ok(waitFor(() => ids(wt).includes('linked-session')), `the linked checkout's own copy swept it: primary ${ids(ctx.repo)}, linked ${ids(wt)}`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  assert.deepEqual(ids(ctx.repo), ['primary-session'], 'a linked commit does not sweep the primary');
});

test('git fallback (R23): a copilot-only checkout (.github/skills/tokenomics) is found at run time; a checkout with no copy is skipped and logged', (t) => {
  const repo = join(sandbox(t, 'c'), 'repo');
  mkdirSync(repo);
  const env = isolatedEnv(t, repo);
  gitIn(repo, env, 'init', '-q');
  writeFileSync(join(repo, 'README.md'), 'consumer\n');
  gitIn(repo, env, 'add', '.');
  gitIn(repo, env, ...ID, 'commit', '-q', '-m', 'init');
  const pkg = makePackage(t);
  const inst = spawnSync(process.execPath, [join(pkg, 'bin', 'harness-telemetry.mjs'), 'install', 'tokenomics', '--target', 'copilot', '--repo', repo], { encoding: 'utf8', env });
  assert.equal(inst.status, 0, inst.stderr);
  rmSync(pkg, { recursive: true, force: true });
  const skill = join(repo, '.github', 'skills', 'tokenomics');
  const a = run(skill, 'scripts/install-hooks.mjs', ['--host', 'copilot-cli', '--git-hook'], { repo, env });
  assert.equal(a.status, 0, a.stderr);
  oldTranscript(env.TOKENOMICS_CLAUDE_ROOT, 'cop-1');
  commitIn(repo, env);
  assert.ok(waitFor(() => ledgerLines(repo).some((l) => l.id === 'cop-1')), 'the copilot copy swept');

  // no copy at all: nothing runs, and the reason is logged for the operator
  rmSync(join(repo, '.github', 'skills'), { recursive: true, force: true });
  commitIn(repo, env, 'no copy');
  const log = join(repo, '.git', 'tokenomics-post-commit.log');
  assert.ok(waitFor(() => existsSync(log)), 'a log line explains the skipped sweep');
  assert.match(readFileSync(log, 'utf8'), /no installed tokenomics engine copy/);
});

test('git fallback (R23): the generated hook names no repo or copy path (it resolves them when it runs)', (t) => {
  const ctx = consumerRepo(t);
  assert.equal(activateCli(ctx, ['--host', 'claude', '--git-hook']).status, 0);
  const text = readFileSync(hookPath(ctx.repo), 'utf8');
  assert.ok(!text.includes(ctx.repo), 'no absolute repo path baked in');
  assert.ok(!text.includes(realpathSync(ctx.repo)), 'no resolved repo path baked in');
  assert.match(text, /show-toplevel/);
});
