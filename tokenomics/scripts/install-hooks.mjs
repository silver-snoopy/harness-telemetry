#!/usr/bin/env node
// install-hooks.mjs — ACTIVATE the copied engine in a consumer repo (spec §14.2 step 2), or unwire it.
// Copying the skill in (`harness-telemetry install`) never turns capture on; THIS script is the explicit
// opt-in, and it writes the activation record last.
//
//   node <skill>/scripts/install-hooks.mjs --host <claude|copilot-cli|vscode>   (copilot = copilot-cli)
//        [--local] [--plain-folder] [--dir <name>] [--repo <root>]
//   node <skill>/scripts/install-hooks.mjs --update-manifest | --remove [--host …] | --pull | --otel | --doctor
//
// Activation, in order; each step's failure stops the run (exit 1) with activation unrecorded, so the
// hooks stay inert (D-ACT):
//   1. --host parsed and validated (missing or unknown → usage, exit 2);
//   2. .agents/tokenomics/settings.json loaded or created (a fresh one: `engine: null`, `extension: null`,
//      the Stop gate `off`); an existing file's merge is written only after step 4, so the checkpoint holds
//      the operator's original bytes;
//   3. the substrate created or verified (engine/substrate.mjs; the plain folder only with --plain-folder),
//      its form recorded in `substrate.form`;
//   4. the verified checkpoint `pre-engine-<version>` (engine/checkpoint.mjs), over the store, settings and
//      every host file the later steps touch;
//   5. the module manifest (engine/module-manifest.mjs); in the submodule form, one local store commit of
//      `<dir>/module.json`, `<dir>/manifests/` and `<dir>/config.json` (no push);
//   6. the host hooks (installClaude / installCopilot / installVsCode, wired to THIS copy);
//   7. the ignore lines;
//   8. --git-hook (additive): the post-commit sweep, chaining a foreign post-commit hook (D-GIT); a hook that
//      would be refused (a foreign hook beside an existing backup) is refused before step 2;
//   9. `engine` recorded in settings.json, last (D-REC).
// Re-running on an active repo changes nothing and reports `already active`; a re-run that writes anything names it.
//
// Claude Code writes .claude/settings.json (shared; --local: settings.local.json); Copilot CLI writes
// .github/hooks/tokenomics.json; VS Code adds a folderOpen auto-task (see installVsCode). The Stop gate is
// wired only when `enforcement.stopGate` is "on" (§14.12). `--git-hook` adds a host-agnostic post-commit
// sweep, `--otel` writes the OpenTelemetry opt-in, and `--doctor` health-checks the whole telemetry path.
//
// STDLIB ONLY.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync, renameSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSettings, telemetryDir, TA_DEFAULTS } from '../engine/config.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { ensureSubstrate, INNER_GITIGNORE, stageStorePointer, SUBSTRATE_PATH } from '../engine/substrate.mjs';
import { takeCheckpoint } from '../engine/checkpoint.mjs';
import { ensureModuleManifest } from '../engine/module-manifest.mjs';
import { activationState, engineRootOf, entryPointsOn, explain } from '../engine/activation.mjs';
import { installUserHooks, userHooksFile } from '../engine/copilot-user-hooks.mjs';

export const MARKER = '_tokenomics';
export const TASK_LABEL = 'tokenomics: telemetry sweep';
export const GIT_MARKER = '# tokenomics-sweep';

export function skillRootOf(scriptUrl = import.meta.url) {
  return dirname(dirname(fileURLToPath(scriptUrl))); // scripts/ -> skill root
}

const posix = (p) => p.split('\\').join('/');

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

/** Write `body` unless the file already holds exactly those bytes: a re-run on an active repo touches nothing
 * (Review Focus 1, "identical tree" — mtimes included). */
function writeIfChanged(path, body) {
  try { if (readFileSync(path, 'utf8') === body) return false; } catch { /* absent or unreadable: write */ }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return true;
}

function writeJson(path, obj) {
  writeIfChanged(path, `${JSON.stringify(obj, null, 2)}\n`);
}

/**
 * Claude: splice our entries into settings hooks; remove strips them.
 * Capture: SessionEnd captures the ending session (freshest data, priced
 * while the transcript is guaranteed alive), and SessionStart runs a bounded
 * sweep so sessions that never ended cleanly (killed terminal) are harvested
 * the moment anyone opens the repo again — same rhythm as the Copilot side.
 * The start sweep injects no context, so it runs async where supported.
 * Scope contract (scope-hook.mjs): SessionStart --announce injects ONE line
 * with the session id (the model cannot name its scope file without it);
 * PreToolUse on Agent|Workflow marks "this session dispatched work"; Stop
 * --gate blocks the turn end ONCE when work was dispatched with no declared
 * scope — wired only with `stopGate` (activation passes settings
 * `enforcement.stopGate === "on"`; installed off, §14.12), and stripped when it
 * is off. All marked, all stripped by --remove.
 */
export function installClaude(repo, rel, { local = false, remove = false, stopGate = true } = {}) {
  const file = join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
  const settings = readJson(file, {});
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const script = `\${CLAUDE_PROJECT_DIR}/${posix(rel)}/hooks/telemetry-capture.mjs`;
  const scopeScript = `\${CLAUDE_PROJECT_DIR}/${posix(rel)}/hooks/scope-hook.mjs`;
  const splice = (event, entries) => {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = list.filter((e) => !e || !e[MARKER]);
    for (const entry of [].concat(entries ?? [])) kept.push(entry);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  };
  splice('SessionEnd', remove ? null : {
    hooks: [{ type: 'command', command: `node "${script}"`, timeout: 120 }],
    [MARKER]: true,
  });
  splice('SessionStart', remove ? null : [{
    matcher: 'startup|resume',
    hooks: [{ type: 'command', command: `node "${script}" --sweep`, timeout: 120, async: true }],
    [MARKER]: true,
  }, {
    // sync on purpose: its single stdout line (session id + scope ask/digest)
    // must reach context, and it must survive resume/clear/compact.
    matcher: '*',
    hooks: [{ type: 'command', command: `node "${scopeScript}" --announce`, timeout: 10 }],
    [MARKER]: true,
  }]);
  splice('PreToolUse', remove ? null : {
    // Workflow included: its inner agents never pass through the Agent tool,
    // but the Workflow call itself marks the session as work-dispatching.
    matcher: 'Agent|Workflow',
    hooks: [{ type: 'command', command: `node "${scopeScript}" --mark-dispatch`, timeout: 10, async: true }],
    [MARKER]: true,
  });
  splice('Stop', remove || !stopGate ? null : {
    hooks: [{ type: 'command', command: `node "${scopeScript}" --gate`, timeout: 10 }],
    [MARKER]: true,
  });
  // Measurements update as work finishes: each finished dispatch is metered
  // (its own transcript only) into the session's live dispatch log. Async —
  // it injects nothing and must never delay the run.
  splice('SubagentStop', remove ? null : {
    matcher: '*',
    hooks: [{ type: 'command', command: `node "${script}" --dispatch`, timeout: 60, async: true }],
    [MARKER]: true,
  });
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeJson(file, settings);
  return file;
}

/**
 * Copilot: a standalone hooks file — Copilot reads every .github/hooks/*.json.
 * Since the CLI hooks-reference added the full event set, the scope contract
 * gets the SAME three moments as Claude (hooks-reference, checked 2026-08-12):
 * sessionStart may return {additionalContext} (the announce — hence --json),
 * subagentStart fires per dispatch (better than a tool matcher: named agents
 * only, exactly the work we mean), and agentStop takes the identical
 * {decision:'block', reason} shape with its own stop_hook_active guard and a
 * runaway cap. Older CLIs simply ignore events they don't know — the
 * `open --session auto` pending-record path stays as their fallback.
 * agentStop (the gate) is written only with `stopGate`, as for Claude.
 */
export function installCopilot(repo, rel, { remove = false, stopGate = true } = {}) {
  const file = join(repo, '.github', 'hooks', 'tokenomics.json');
  if (remove) {
    if (existsSync(file)) rmSync(file);
    return file;
  }
  // TOKENOMICS_HOOK_EVENT (R25): the CLI's payload names no event, and sessionStart and sessionEnd run the same sweep
  // command, so each command names its own event for the probe's fired record (engine/probe.mjs).
  const cmd = (event, script, args) => ({
    type: 'command',
    bash: `node "./${posix(rel)}/hooks/${script}" ${args}`,
    powershell: `& node "./${posix(rel)}/hooks/${script}" ${args}`,
    env: { COPILOT_CLI: '1', TOKENOMICS_HOOK_EVENT: event },
    timeoutSec: script === 'telemetry-capture.mjs' ? 120 : 10,
  });
  writeJson(file, {
    version: 1,
    hooks: {
      sessionStart: [
        cmd('sessionStart', 'telemetry-capture.mjs', '--sweep'),
        cmd('sessionStart', 'scope-hook.mjs', '--announce --json'),
      ],
      // sessionEnd exists per the hooks-reference: capture the ending session
      // NOW instead of waiting for the next session's start. Just a sweep —
      // the Copilot path has no live-grace (it keys on session.shutdown being
      // written), so the ended session qualifies immediately; if shutdown
      // races the hook, the start sweep remains the safety net, as before.
      sessionEnd: [cmd('sessionEnd', 'telemetry-capture.mjs', '--sweep')],
      subagentStart: [cmd('subagentStart', 'scope-hook.mjs', '--mark-dispatch')],
      // per-dispatch measurement, same as Claude's SubagentStop
      subagentStop: [cmd('subagentStop', 'telemetry-capture.mjs', '--dispatch')],
      ...(stopGate ? { agentStop: [cmd('agentStop', 'scope-hook.mjs', '--gate')] } : {}),
    },
  });
  return file;
}

/**
 * VS Code: a folderOpen auto-task running the sweep — the sidebar has no hook
 * mechanism, but tasks.json is its native "on session start". VS Code prompts
 * once per folder to allow automatic tasks; the task runs silently after that.
 * Identified by its label — never touches other tasks.
 *
 * OPT-IN (`--host vscode`), deliberately NOT part of `--host all`: every sweep
 * walks all three stores, so a repo where anyone runs Claude Code or Copilot
 * CLI already harvests sidebar sessions on those sweeps. This task only earns
 * its keep in a SIDEBAR-ONLY repo — and it is the one thing the installer
 * writes into SHARED editor config, so it costs every teammate a "allow
 * automatic tasks?" prompt for a benefit most repos already have.
 */
export function installVsCode(repo, rel, { remove = false } = {}) {
  const file = join(repo, '.vscode', 'tasks.json');
  const cfg = readJson(file, { version: '2.0.0', tasks: [] });
  const kept = (Array.isArray(cfg.tasks) ? cfg.tasks : []).filter((t) => !t || t.label !== TASK_LABEL);
  if (remove) {
    const onlyOurs = kept.length === 0 && Object.keys(cfg).every((k) => k === 'version' || k === 'tasks');
    if (onlyOurs) { if (existsSync(file)) rmSync(file); return file; }
    cfg.tasks = kept;
    writeJson(file, cfg);
    return file;
  }
  kept.push({
    label: TASK_LABEL,
    type: 'shell',
    command: 'node',
    args: [`./${posix(rel)}/hooks/telemetry-capture.mjs`, '--sweep'],
    runOptions: { runOn: 'folderOpen' },
    presentation: { reveal: 'never', echo: false },
    problemMatcher: [],
  });
  cfg.version = cfg.version || '2.0.0';
  cfg.tasks = kept;
  writeJson(file, cfg);
  return file;
}

/** The hooks directory git actually runs for this repo (D-GIT): `git rev-parse --git-path hooks` honours
 * `core.hooksPath` and linked worktrees (the common dir). A relative answer is relative to `repo`. */
export function gitHooksDir(repo) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out ? resolve(repo, out) : null;
  } catch { return null; /* not a git repo, or no git */ }
}

export const GIT_PRE = 'post-commit.pre-tokenomics';

/**
 * Host-agnostic belt and braces: a post-commit hook that starts a sweep detached (D-GIT). The sweep never
 * delays or fails a commit. A foreign `post-commit` is moved to `post-commit.pre-tokenomics` and chained: our
 * hook runs it first (only when git itself would have, i.e. it is executable) and exits with its status.
 * `--remove` puts the original back, bytes and mode intact. The script holds no repo or copy path (R23): it finds
 * the committing checkout and its installed copy when it runs, so a shared hooks dir serves every linked worktree.
 * Status: installed | removed | no-git | not-ours | backup-exists. `chained`: 'executable' | 'non-executable' | null.
 */
export function installGitHook(repo, _rel, { remove = false } = {}) {
  const dir = gitHooksDir(repo);
  if (!dir) return { file: null, status: 'no-git' };
  const file = join(dir, 'post-commit');
  const pre = join(dir, GIT_PRE);
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const ours = existing !== null && existing.includes(GIT_MARKER);
  if (remove) {
    if (ours) rmSync(file);
    if (existsSync(pre) && (ours || existing === null)) { renameSync(pre, file); return { file, status: 'removed', restored: true }; }
    return { file, status: ours ? 'removed' : 'not-ours' };
  }
  let chained = null;
  if (existing !== null && !ours) {
    if (existsSync(pre)) return { file, status: 'backup-exists', pre };
    mkdirSync(dir, { recursive: true });
    renameSync(file, pre); // rename keeps the bytes and the mode
  }
  if (existsSync(pre)) chained = (statSync(pre).mode & 0o111) ? 'executable' : 'non-executable';
  mkdirSync(dir, { recursive: true });
  // The hook file lives in the git COMMON dir, so every linked worktree runs the same script. It therefore bakes in
  // no repo or copy path: when it runs it resolves the committing checkout (`git rev-parse --show-toplevel`) and that
  // checkout's installed copy, the one whose ENGINE.json engine matches its activation record (else the first copy
  // present; the capture hook's own gate decides whether that copy may run). A linked worktree that carries no copy
  // falls back to the primary worktree's, which holds the shared store (R23).
  const engineOf = "sed -n 's/.*\"engine\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p'";
  writeFileSync(file, [
    '#!/bin/sh',
    `${GIT_MARKER} — background telemetry harvest (tokenomics skill); safe to delete`,
    "# A foreign post-commit hook moved aside by the installer runs first, and its exit status stays git's.",
    'rc=0',
    `pre="$(dirname "$0")/${GIT_PRE}"`,
    'if [ -x "$pre" ]; then "$pre" "$@"; rc=$?; fi',
    '# The sweep must not inherit the hook environment: GIT_DIR / GIT_INDEX_FILE would aim its git calls at this worktree.',
    'gd=$(git rev-parse --absolute-git-dir 2>/dev/null)',
    'unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES',
    '# The committing checkout, and the primary worktree (the shared hooks dir serves every linked worktree).',
    'top=$(git rev-parse --show-toplevel 2>/dev/null)',
    'primary=$(cd "$(git rev-parse --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd)',
    'sel=""; selroot=""',
    'for root in "$top" "$primary"; do',
    '  [ -n "$root" ] || continue',
    `  want=$(${engineOf} "$root/.agents/tokenomics/settings.json" 2>/dev/null | head -n 1)`,
    '  first=""',
    '  for d in .claude/skills/tokenomics .github/skills/tokenomics; do',
    '    [ -f "$root/$d/hooks/telemetry-capture.mjs" ] || continue',
    '    [ -n "$first" ] || first="$root/$d/hooks/telemetry-capture.mjs"',
    `    have=$(${engineOf} "$root/$d/ENGINE.json" 2>/dev/null | head -n 1)`,
    '    if [ -n "$want" ] && [ "$have" = "$want" ]; then sel="$root/$d/hooks/telemetry-capture.mjs"; break; fi',
    '  done',
    '  [ -n "$sel" ] || sel="$first"',
    '  if [ -n "$sel" ]; then selroot="$root"; break; fi',
    'done',
    'if [ -z "$sel" ]; then',
    '  [ -n "$gd" ] && echo "$(date) tokenomics: no installed tokenomics engine copy found for ${top:-this checkout}; sweep skipped" >> "$gd/tokenomics-post-commit.log"',
    'elif command -v node >/dev/null 2>&1; then',
    '  ( node "$sel" --sweep --cwd "$selroot" </dev/null >/dev/null 2>&1 & )',
    'elif [ -n "$gd" ]; then',
    '  echo "$(date) tokenomics: node not found on the hook PATH; sweep skipped" >> "$gd/tokenomics-post-commit.log"',
    'fi',
    'exit $rc',
    '',
  ].join('\n'), { mode: 0o755 });
  chmodSync(file, 0o755);
  return { file, status: 'installed', chained, pre: chained ? pre : null };
}

function gitHookNote(r) {
  const base = {
    installed: 'installed',
    removed: r.restored ? 'removed (the original post-commit hook restored)' : 'removed',
    'no-git': 'SKIPPED — not a git repo',
    'backup-exists': `NOT installed — a foreign post-commit hook and ${r.pre} both exist; merge them by hand`,
    'not-ours': 'nothing of ours to remove',
  }[r.status];
  const chain = r.chained === 'executable' ? '; the existing post-commit hook is chained (runs first, its exit status kept)'
    : r.chained === 'non-executable' ? `; the existing post-commit hook is chained but is NOT executable, so git would not have run it and neither do we (${r.pre})` : '';
  return `tokenomics: git post-commit sweep ${base}${chain}${r.file ? ` (${r.file})` : ''}\n`;
}

// The exact settings this skill owns when OTel is enabled. Nothing else in the
// user's settings/env is ever touched; --otel-remove deletes precisely these.
const OTEL_CLAUDE_ENV = (endpoint) => ({
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  OTEL_METRICS_EXPORTER: 'otlp',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', // what makes the stdlib sink possible
  OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
});
const OTEL_VSCODE_KEYS = (endpoint) => ({
  'github.copilot.chat.otel.enabled': true,
  'github.copilot.chat.otel.exporterType': 'otlp-http',
  'github.copilot.chat.otel.otlpEndpoint': endpoint,
});

/**
 * Write (or strip) the OTel opt-in across the three config surfaces: the
 * telemetry config (capture hook reads `otel.enabled` to keep the sink alive),
 * Claude Code's settings env block, and the workspace VS Code settings (which
 * cover the sidebar AND are forwarded to Copilot CLI terminals VS Code opens).
 * Standalone-terminal Copilot CLI needs shell exports — printed by main, since
 * editing someone's shell profile is not this script's business.
 */
export function configureOtel(repo, { endpoint = 'http://localhost:4318', remove = false, local = false } = {}, engineSettings = loadSettings(repo)) {
  const touched = [];
  const cfgPath = seedConfig(repo, engineSettings);
  const cfg = readJson(cfgPath, {});
  cfg.otel = remove ? { enabled: false } : { enabled: true, endpoint };
  writeJson(cfgPath, cfg);
  touched.push(cfgPath);

  const sPath = join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
  const settings = readJson(sPath, {});
  settings.env = settings.env && typeof settings.env === 'object' ? settings.env : {};
  for (const [k, v] of Object.entries(OTEL_CLAUDE_ENV(endpoint))) {
    if (remove) delete settings.env[k]; else settings.env[k] = v;
  }
  if (!Object.keys(settings.env).length) delete settings.env;
  writeJson(sPath, settings);
  touched.push(sPath);

  const vPath = join(repo, '.vscode', 'settings.json');
  const vs = readJson(vPath, {});
  for (const [k, v] of Object.entries(OTEL_VSCODE_KEYS(endpoint))) {
    if (remove) delete vs[k]; else vs[k] = v;
  }
  if (Object.keys(vs).length || existsSync(vPath)) { writeJson(vPath, vs); touched.push(vPath); }
  return touched;
}

// The README committed INSIDE the telemetry submodule — the first thing anyone
// sees when they open the folder or browse the `telemetry` branch on the host.
// Domain-neutral (owner sign-off): it names the module's folder, never a domain noun.
const telemetryReadme = (settings) => `# Team telemetry (auto-written)

Machine-written usage data: what each AI session cost and what work it was
scoped to. Hooks write here; commits go to the \`telemetry\` branch of THIS
repo — never to main.

One subfolder per module — \`${settings.dir}/\` is the tokenomics module's;
other modules add their own and ride the same branch and sync.

- Don't edit by hand. Don't commit this folder to main.
- See the team picture:  \`git -C .agents/telemetry pull\`  → then run team-report
- Empty after clone? run:  \`git submodule update --init\`
`;

/**
 * Telemetry as a SELF-referential submodule: .agents/telemetry is a checkout
 * of this same repository's orphan `telemetry` branch (.gitmodules url = ./).
 *
 * WHY. Telemetry is written continuously; the main tree lives in transactions
 * (checkout/stash/gate demand cleanliness). Two lifecycles in one tree
 * conflict by construction — measured: a stash swept the ledger, ` M usage-*`
 * blocked a gate, cost.json rewrites dirtied the tree on every session end.
 * A submodule gives the continuous writer its own branch and working dir the
 * parent never scans (`ignore = all`), on any git, any OS, with the native
 * clone story (`git clone --recurse-submodules` → team history in place).
 *
 * No silent degradation (D-SUB): no git, or a submodule that cannot be
 * created or verified, is reported with its cause and remedy; the plain-folder
 * form needs --plain-folder. Cloned without --recurse → this installer
 * materialises the registered submodule (moving any interim files back in).
 *
 * Create + verify live in engine/substrate.mjs (`ensureSubstrate`), called as activation step 3 (`activate`);
 * the submodule sits at the telemetry ROOT, shared by every module, each in its own subfolder. `--remove`
 * never touches it: removing hooks never deletes data.
 */

/**
 * Layout migration: the flat era wrote this factory's files at the telemetry
 * ROOT (usage-*.jsonl, scopes/, live/, config.json, factory-profile.json);
 * the shared-submodule era puts them under automation/. Readers look ONLY in
 * automation/, so un-migrated history silently vanishes from every report —
 * hence this runs on every install, idempotent, plain dir or submodule alike.
 * Never clobbers: an entry already present in automation/ wins (it is newer);
 * directory moves merge file-by-file on the same rule.
 */
export function migrateTelemetryLayout(repo, settings = loadSettings(repo)) {
  const root = join(repo, '.agents', 'telemetry');
  if (!existsSync(root)) return 0;
  const auto = join(root, settings.dir);
  const OLD_FILES = (n) => /^usage-.*\.jsonl$/.test(n) || n === 'config.json' || n === settings.paths.factoryProfile;
  const OLD_DIRS = new Set(['scopes', 'live']);
  let moved = 0;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const old = e.isDirectory() ? OLD_DIRS.has(e.name) : OLD_FILES(e.name);
    if (!old) continue;
    const src = join(root, e.name);
    const dest = join(auto, e.name);
    try {
      mkdirSync(auto, { recursive: true });
      if (!existsSync(dest)) {
        renameSync(src, dest);
        moved++;
      } else if (e.isDirectory()) {
        for (const f of readdirSync(src)) {
          const d2 = join(dest, f);
          if (!existsSync(d2)) { renameSync(join(src, f), d2); moved++; }
        }
        if (readdirSync(src).length === 0) rmSync(src, { recursive: true, force: true });
      } // a same-named FILE already in automation/: keep both untouched — surfaced by doctor, never merged blindly
    } catch { /* best-effort per entry — a locked file must not abort the rest */ }
  }
  return moved;
}

/**
 * The chief lead's "give me everyone's telemetry NOW" button. Sync (in the
 * capture hooks) only PUSHES this machine's state — a clean local branch
 * fast-forwards nowhere and never fetches, so teammates' pushes sit unseen
 * until something merges them. Pull is that something: commit anything local,
 * fetch, merge (per-user files → conflict-free), push the merge back.
 */
export function pullTelemetry(repo) {
  const dir = join(repo, '.agents', 'telemetry'); // submodule root — all factories
  if (!existsSync(join(dir, '.git'))) return { status: 'no-submodule' };
  const git = (args, timeout = 20000) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
  try {
    git(['add', '-A']);
    if (git(['status', '--porcelain']).trim()) {
      git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'commit', '-m', 'telemetry: capture']);
    }
    if (git(['branch', '--show-current']).trim() !== 'telemetry') git(['checkout', '-B', 'telemetry']);
    git(['fetch', 'origin', 'telemetry']);
    git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'merge', '--no-edit', 'FETCH_HEAD']);
    try { git(['push', 'origin', 'HEAD:telemetry']); } catch { /* offline push-back — next sync retries */ }
    return { status: 'pulled' };
  } catch (err) {
    return { status: 'failed', error: String(err?.message ?? err).split('\n')[0] };
  }
}

/**
 * Ignore the WORKING STATE this skill writes, so it never blocks a gate.
 *
 * The constraint that forces this: `gate-case.mjs` refuses a dirty tree, so a
 * file that is neither committed nor ignored stops the pipeline. Everything
 * tokenomics writes falls in one of two classes and this block encodes the
 * split — the RECORDS (ledger, scope files, config, factory profile) are
 * deliberately NOT ignored, because team-wide reporting is exactly their
 * point; only the transient per-run state is.
 *
 * Owned block, replaced in place on re-run and stripped by --remove; the rest
 * of the file is never touched. Artifacts written by OTHER skills
 * (.agents/automation/_returns/, case snapshots, browser scratch) are the
 * project's call — the skill README lists them.
 */
const GI_START = '# >>> tokenomics (managed) — working state only; the ledger/scopes/receipts stay COMMITTED';
const GI_END = '# <<< tokenomics';
export const gitignoreBlock = (settings = TA_DEFAULTS) => [
  GI_START,
  `.agents/telemetry/${settings.dir}/live/`,
  `.agents/telemetry/${settings.dir}/scopes/.pending-*`,
  `.agents/telemetry/${settings.dir}/scopes/.nagged-*`,
  `.agents/telemetry/${settings.dir}/scopes/.unclosed-*`,
  GI_END,
].join('\n');
export const GITIGNORE_BLOCK = gitignoreBlock();

export function installGitignore(repo, { remove = false } = {}, settings = loadSettings(repo)) {
  const file = join(repo, '.gitignore');
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : '';
  // Drop any previous block (start..end inclusive), keeping everything else.
  const kept = [];
  let skipping = false;
  for (const line of prev.split('\n')) {
    if (line.startsWith(GI_START.slice(0, 24))) { skipping = true; continue; }
    if (skipping) { if (line.trim() === GI_END) skipping = false; continue; }
    kept.push(line);
  }
  let body = kept.join('\n').replace(/\n{3,}$/, '\n\n').trimEnd();
  if (!remove) body = `${body ? `${body}\n\n` : ''}${gitignoreBlock(settings)}`;
  if (!body.trim()) { if (existsSync(file)) rmSync(file); return file; }
  writeIfChanged(file, `${body}\n`);
  return file;
}

/** Seed the telemetry dir + default config (never overwrites an existing one). */
export function seedConfig(repo, settings = loadSettings(repo)) {
  const dir = telemetryDir(repo, settings);
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, 'config.json');
  if (!existsSync(cfg)) {
    writeJson(cfg, { capturePrompts: false, priceAtCapture: true, maxSweep: 10 });
  }
  return cfg;
}

// --- Activation (Plan 5 Task 7; spec §14.2 step 2, §14.4, §14.12) ----------------------------------------------

/** The activation targets (spec §14.4 names); `copilot` is accepted as an alias of `copilot-cli` (D-HOST). */
export const HOSTS = Object.freeze(['claude', 'copilot-cli', 'vscode']);
const HOST_ALIASES = { copilot: 'copilot-cli' };
const hostUsage = (got) => `tokenomics: ${got === null ? '--host is required' : `unknown --host '${got}'`} — one of: ${HOSTS.join(', ')} (copilot = copilot-cli)\n`;

/** The settings file activation creates or merges into. */
export const settingsPath = (repo) => join(repo, '.agents', 'tokenomics', 'settings.json');

/**
 * A fresh standalone settings document (D-HOST, D-REC, D-SUB; ruling R2 keeps the TA receipt defaults). `engine` is
 * null until step 9 records it; `extension` is null because a standalone copy ships none (spec §14.1).
 */
export function freshSettings({ dir = 'tokenomics' } = {}) {
  return {
    engine: null,
    dir,
    extension: null,
    substrate: { required: null, form: null },
    enforcement: { announce: true, stopGate: 'off' },
    targets: [],
    receipts: { root: TA_DEFAULTS.receipts.root, file: TA_DEFAULTS.receipts.file, deliveredOutcomes: [...TA_DEFAULTS.receipts.deliveredOutcomes] },
  };
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Write-then-rename: the activation record is never half-written.
function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.partial-${process.pid}`;
  try {
    writeFileSync(partial, `${JSON.stringify(obj, null, 2)}\n`);
    renameSync(partial, path);
  } catch (e) { rmSync(partial, { force: true }); throw e; }
}

/** Write `doc` only when its serialisation differs from what is on disk (a re-run leaves the file untouched). */
export function saveSettings(repo, doc) {
  const path = settingsPath(repo);
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  if (existsSync(path) && readFileSync(path, 'utf8') === body) return false;
  writeJsonAtomic(path, doc);
  return true;
}

class ActivationError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

/**
 * Step 2. An existing file is merged: only the absent `enforcement` keys are written here (`engine`, `targets` and
 * `substrate.form` follow in their own steps); everything else the operator wrote is kept. A missing file is created
 * from `freshSettings`. Returns the raw document; the engine reads it through `loadSettings`.
 */
/**
 * Ruling R13: the `dir` of a fresh settings file written without --dir. An existing store keeps its module directory
 * (a reference-era repo has `automation/` and no settings file): the one directory under `.agents/telemetry/` that
 * holds a `usage-*.jsonl` ledger; `automation/` when it is among several; several without it is a usage error.
 * Otherwise the standalone default `tokenomics`. Returns `{dir, why}`.
 */
export function defaultDir(repo) {
  const root = join(repo, '.agents', 'telemetry');
  let found = [];
  try {
    found = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .filter((e) => { try { return readdirSync(join(root, e.name)).some((f) => /^usage-.*\.jsonl$/.test(f)); } catch { return false; } })
      .map((e) => e.name).sort();
  } catch { /* no store yet */ }
  let source = null;
  if (!found.length) {
    // Fix 1b: a store not materialised yet (cloned without --recurse-submodules) is read from its history — the first
    // of the telemetry branch, its remote-tracking ref, or the submodule checkout's HEAD that exists.
    const refs = [['refs/heads/telemetry', repo], ['refs/remotes/origin/telemetry', repo], ['HEAD', root]];
    for (const [ref, cwd] of refs) {
      if (ref === 'HEAD' && !existsSync(join(root, '.git'))) continue;
      let names;
      try {
        names = execFileSync('git', ['ls-tree', '-r', '--name-only', `${ref}^{tree}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, maxBuffer: 1 << 28 }).split('\n');
      } catch { continue; }
      found = [...new Set(names.map((p) => p.split('/')).filter((s) => s.length === 2 && !s[0].startsWith('.') && /^usage-.*\.jsonl$/.test(s[1])).map((s) => s[0]))].sort();
      source = ref === 'HEAD' ? 'the store checkout\'s HEAD' : ref;
      break;
    }
  }
  if (source && found.length === 1) return { dir: found[0], why: `the store's history (${source}) holds a ledger in ${found[0]}/` };
  if (found.length === 1) return { dir: found[0], why: `the existing store's module directory .agents/telemetry/${found[0]}/ holds a ledger` };
  if (found.includes('automation')) return { dir: 'automation', why: `preferred among the store's module directories with a ledger (${found.join(', ')})` };
  if (found.length) throw new ActivationError(`several module directories hold a ledger (${found.join(', ')}) — pass --dir <name> to choose the one this engine reads and writes`, 2);
  return { dir: 'tokenomics', why: 'the standalone default (no module directory under .agents/telemetry/ holds a ledger)' };
}

/**
 * `defer` (activation, B3 final review M9): an existing file's merge is kept in memory and returned as
 * `pending: true` for the caller to write after the checkpoint, so the checkpoint holds the operator's original bytes.
 * A fresh file has no original and is written at once.
 */
export function loadOrCreateSettings(repo, { dir = null, defer = false } = {}) {
  const path = settingsPath(repo);
  if (!existsSync(path)) {
    const chosen = dir ? { dir, why: 'chosen with --dir' } : defaultDir(repo);
    const doc = freshSettings({ dir: chosen.dir });
    saveSettings(repo, doc);
    return { doc, created: true, dirWhy: chosen.why, pending: false };
  }
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new ActivationError(`${path} is not valid JSON (${e.message}); fix it and re-run`); }
  if (!isObject(doc)) throw new ActivationError(`${path} is not a JSON object; fix it and re-run`);
  if (dir && doc.dir !== dir) {
    throw new ActivationError(`--dir ${dir}: ${path} already sets dir to ${JSON.stringify(doc.dir)}; an existing file's dir is never changed (edit it yourself, or drop --dir)`, 2);
  }
  const enforcement = isObject(doc.enforcement) ? doc.enforcement : {};
  const merged = { ...doc, enforcement: { announce: true, stopGate: 'off', ...enforcement } };
  const needed = !('enforcement' in doc) || Object.keys(merged.enforcement).length !== Object.keys(enforcement).length;
  if (needed && !defer) saveSettings(repo, merged);
  return { doc: merged, created: false, pending: needed && defer };
}

/** Repo-relative paths of the host files `host` wiring touches, so the checkpoint covers them before they change. */
export function plannedWrappers(host, { local = false } = {}) {
  const files = {
    claude: [`.claude/${local ? 'settings.local.json' : 'settings.json'}`],
    'copilot-cli': ['.github/hooks/tokenomics.json'],
    vscode: ['.vscode/tasks.json'],
  }[host];
  return [...files, '.gitignore']; // step 7 (step 8, --git-hook, lives in .git)
}

function engineVersion(skillRoot) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(skillRoot, 'ENGINE.json'), 'utf8')); } catch (e) {
    throw new ActivationError(`cannot read ${join(skillRoot, 'ENGINE.json')} (${e.code === 'ENOENT' ? 'missing' : e.message}); reinstall: harness-telemetry install tokenomics --target <claude|copilot>`);
  }
  if (!isObject(doc) || typeof doc.engine !== 'string' || !doc.engine) throw new ActivationError(`${join(skillRoot, 'ENGINE.json')} names no engine version; reinstall it`);
  return doc.engine;
}

const SUBSTRATE_NOTE = (settings, migrate) => `\ntokenomics: telemetry set up as a submodule (.agents/telemetry → branch 'telemetry', same repo; this module writes ${settings.dir}/)\n`
  + '\n  what this means, once:\n'
  + '  • hooks write usage data there; it commits to its OWN branch — your working tree never gets dirty\n'
  + '  • one commit to make now (adds .gitmodules + the pointer):\n'
  + '        git add .gitmodules .agents/telemetry && git commit -m "chore: telemetry submodule"\n'
  + (migrate ? '    (old telemetry files were tracked on main — their removal is ALREADY STAGED and rides this same commit; the data itself lives on in the telemetry branch)\n' : '')
  + '  • teammates: git clone --recurse-submodules   (forgot? this installer fixes it on next run)\n'
  + '  • team report anytime:  git -C .agents/telemetry pull && node …/team-report.mjs --html\n';

/** M10: the one-line refusal step 8 would give (`installGitHook` status `backup-exists`: a foreign post-commit hook
 * and a `post-commit.pre-tokenomics` backup both exist), or null. Read-only, so activation can refuse before step 2. */
function gitHookBlocked(repo) {
  const dir = gitHooksDir(repo);
  if (!dir) return null;
  const file = join(dir, 'post-commit');
  const pre = join(dir, GIT_PRE);
  let existing = null;
  try { existing = readFileSync(file, 'utf8'); } catch { /* no post-commit hook */ }
  return existing !== null && !existing.includes(GIT_MARKER) && existsSync(pre) ? gitHookNote({ status: 'backup-exists', file, pre }).trim() : null;
}

/** Stage the store pointer in the main repository, so it names the telemetry branch head. */
const stagePointer = (repo) => stageStorePointer(repo);

/**
 * M12: one local store commit (`tokenomics: activate <v>`, no push) of the files activation writes into the store —
 * `<dir>/module.json`, `<dir>/manifests/`, `<dir>/config.json` — and of nothing else. Only on the telemetry branch
 * (never on a detached or foreign checkout); the fallback identity when none is configured. Returns whether a commit
 * was made: a re-run with nothing new commits nothing.
 */
function commitActivationFiles(repo, settings, engine) {
  const store = join(repo, ...SUBSTRATE_PATH.split('/'));
  const git = (args) => execFileSync('git', args, { cwd: store, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tryGit = (args) => { try { return git(args).trim(); } catch { return null; } };
  if (tryGit(['symbolic-ref', '-q', 'HEAD']) !== 'refs/heads/telemetry') return false;
  const paths = [...['module.json', 'manifests', 'config.json'].map((p) => `${settings.dir}/${p}`), '.gitignore'].filter((p) => existsSync(join(store, ...p.split('/'))));
  if (!paths.length) return false;
  git(['add', '--', ...paths]);
  if (tryGit(['diff', '--cached', '--quiet', '--', ...paths]) !== null) return false; // exit 0: nothing new
  const ident = [['user.name', 'tokenomics'], ['user.email', 'tokenomics@localhost']]
    .filter(([k]) => tryGit(['config', '--get', k]) === null).flatMap(([k, v]) => ['-c', `${k}=${v}`]);
  git([...ident, 'commit', '-q', '--no-verify', '-m', `tokenomics: activate ${engine}`, '--', ...paths]);
  return true;
}

/**
 * Ruling R26: the store's inner `.gitignore` carries every working-state line (INNER_GITIGNORE, the list the
 * checkpoint shares), so a store created by an earlier writer stops its sync from committing `<module>/live/` or a
 * marker. Only missing lines are appended (a re-run writes nothing); a file already tracked stays tracked, since
 * ignore rules never untrack. Returns whether the file was written.
 */
function ensureInnerIgnore(repo) {
  const file = join(repo, ...SUBSTRATE_PATH.split('/'), '.gitignore');
  let prev = '';
  try { prev = readFileSync(file, 'utf8'); } catch { /* absent: created */ }
  const have = new Set(prev.split(/\r?\n/).map((l) => l.trim()));
  const missing = INNER_GITIGNORE.split('\n').filter((l) => l && !have.has(l));
  if (!missing.length) return false;
  writeFileSync(file, `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${missing.map((l) => `${l}\n`).join('')}`);
  return true;
}

/**
 * The activation flow, steps 2–9 (step 1, --host, is parsed by main). Throws on the first failing step; the
 * activation record (step 9) is only reached when every earlier step succeeded.
 */
function activate(repo, skillRoot, rel, { host, local, plainFolder, dir, updateManifest, gitHook, userHooks = false }) {
  const say = (s) => process.stderr.write(s);
  let step = 'settings';
  const at = (name) => { step = name; };
  const wrote = []; // what this run changed: `already active` only when nothing was written (B3 final review M8)
  const bytesOf = (p) => { try { return readFileSync(p); } catch { return null; } };
  const sameBytes = (a, b) => (a === null ? b === null : b !== null && a.equals(b));
  const watch = (path, name, fn) => { const prior = bytesOf(path); const out = fn(); if (!sameBytes(prior, bytesOf(path))) wrote.push(name); return out; };
  try {
    const engine = engineVersion(skillRoot);
    // 8, checked first (M10): a --git-hook that would be refused is refused before any step writes anything.
    if (gitHook) {
      at('git hook');
      const blocked = gitHookBlocked(repo);
      if (blocked) throw new ActivationError(blocked);
    }

    // 2. settings. An existing file's merge stays in memory until after the checkpoint (M9), so the checkpoint
    // holds the operator's original bytes; a fresh file has no original and is written now.
    at('settings');
    const { doc, created, dirWhy, pending: merged } = loadOrCreateSettings(repo, { dir, defer: true });
    if (created) wrote.push('settings');
    let pending = merged;
    if (dirWhy) say(`tokenomics: settings dir "${doc.dir}" — ${dirWhy}\n`);
    const before = { engine: doc.engine ?? null, targets: Array.isArray(doc.targets) ? doc.targets : [] };
    let settings = loadSettings(repo);

    // 3. substrate; its form is recorded in a fresh settings file before the checkpoint, so the checkpoint holds it
    // (an existing file gets it after the checkpoint, with the rest of the merge)
    at('substrate');
    const sub = ensureSubstrate(repo, settings, { plainFolder, seed: { 'README.md': telemetryReadme(settings) } });
    if (sub.created) wrote.push('substrate');
    if (sub.form === 'submodule' && sub.created) say(SUBSTRATE_NOTE(settings, !!sub.migrate));
    if (sub.form === 'plain-folder') say(`tokenomics: telemetry in the plain-folder form (${sub.cause ? `chosen with --plain-folder; the submodule form failed: ${sub.cause}` : 'recorded in settings.substrate.form'}) — it writes the main tree\n`);
    const substrate = isObject(doc.substrate) ? doc.substrate : { required: null };
    if (substrate.form !== sub.form) {
      doc.substrate = { ...substrate, form: sub.form };
      if (created) { saveSettings(repo, doc); settings = loadSettings(repo); } else pending = true;
    }

    // 4. the verified checkpoint, over the store, settings and the host files steps 6–7 will touch
    at('checkpoint');
    const ck = takeCheckpoint(repo, settings, { version: engine, form: sub.form, wrappers: plannedWrappers(host, { local }) });
    if (!ck.reused) wrote.push('checkpoint');
    // The checkpoint moved the telemetry branch: stage the pointer, as the seed commit does, so it names that commit.
    if (sub.form === 'submodule' && !ck.reused) stagePointer(repo);
    say(`tokenomics: checkpoint ${ck.tag} ${ck.reused ? 'already taken (bundle verified)' : 'taken'} — ${ck.bundle}\n`);
    if (ck.localCopies?.length) say(`tokenomics: local-only files kept off the shared store, copied beside the bundle (${join(dirname(ck.bundle), ck.tag, 'main-tree')}): ${ck.localCopies.join(', ')}\n`);
    if (pending) {
      if (saveSettings(repo, doc)) wrote.push('settings');
      settings = loadSettings(repo);
      pending = false;
    }
    // Old flat-layout data moves into the module folder only now, after the checkpoint holds it as it was.
    const migrated = migrateTelemetryLayout(repo, settings);
    if (migrated) { wrote.push('layout migration'); say(`tokenomics: migrated ${migrated} old-layout telemetry entr${migrated === 1 ? 'y' : 'ies'} → .agents/telemetry/${settings.dir}/\n`); }
    watch(join(telemetryDir(repo, settings), 'config.json'), 'config.json', () => seedConfig(repo, settings));

    // 5. the module manifest
    at('module manifest');
    const man = ensureModuleManifest(telemetryDir(repo, settings), settings, { update: updateManifest });
    if (man.written) wrote.push('module manifest');
    if (man.mismatch.length && !updateManifest) {
      say(`tokenomics: module.json revision ${man.revision} differs from settings in ${man.mismatch.join(', ')} — left as is (a revision is never rewritten); run install-hooks.mjs --update-manifest to write revision ${man.revision + 1}\n`);
    } else if (man.written) {
      say(`tokenomics: module manifest revision ${man.revision} written (.agents/telemetry/${settings.dir}/module.json + manifests/${man.revision}.json)\n`);
    }
    // M12: the store files activation writes are committed locally at once (no push), so a teammate's
    // --recurse-submodules clone never gets an active copy without its module.json.
    if (sub.form === 'submodule' && ensureInnerIgnore(repo)) wrote.push('store .gitignore');
    if (sub.form === 'submodule' && commitActivationFiles(repo, settings, engine)) {
      wrote.push('store commit');
      stagePointer(repo);
    }

    // 6. the host hooks, wired to the copy this script runs from
    at('host hooks');
    const stopGate = settings.enforcement?.stopGate === 'on';
    const touched = [];
    const hostFile = join(repo, ...plannedWrappers(host, { local })[0].split('/'));
    watch(hostFile, relative(repo, hostFile), () => {
      if (host === 'claude') touched.push(installClaude(repo, rel, { local, stopGate }));
      if (host === 'copilot-cli' && !userHooks) touched.push(installCopilot(repo, rel, { stopGate }));
      // --user-hooks: the machine-wide wiring replaces this repository's file, so a session is never captured twice.
      if (host === 'copilot-cli' && userHooks && existsSync(hostFile)) touched.push(installCopilot(repo, rel, { remove: true }));
      if (host === 'vscode') touched.push(installVsCode(repo, rel));
    });
    if (host === 'copilot-cli' && userHooks) {
      const user = userHooksFile();
      if (installUserHooks({ skillRoot }).length) {
        wrote.push('Copilot user-level hooks');
        say(`tokenomics: Copilot CLI hooks wired at user level (${user}); they serve every repository on this machine that activates copilot-cli\n`);
      }
    }

    // 7. the ignore lines (the transient state would otherwise dirty the tree and block a gate)
    at('ignore lines');
    watch(join(repo, '.gitignore'), '.gitignore', () => touched.push(installGitignore(repo, {}, settings)));

    // 8. --git-hook (additive): the post-commit sweep, chaining any foreign post-commit hook (D-GIT)
    if (gitHook) {
      at('git hook');
      const hooks = gitHooksDir(repo);
      const g = watch(hooks ? join(hooks, 'post-commit') : join(repo, '.git', 'hooks', 'post-commit'), 'git hook', () => installGitHook(repo, rel, {}));
      if (g.status !== 'installed') throw new ActivationError(gitHookNote(g).trim());
      say(gitHookNote(g));
    }

    // 9. the activation record, LAST (D-REC): the hooks are inert until this write lands.
    at('activation record');
    const targets = before.targets.includes(host) ? before.targets : [...before.targets, host];
    const wasActive = before.engine === engine && before.targets.includes(host);
    if (saveSettings(repo, { ...doc, engine, targets })) wrote.push('activation record');
    const already = wasActive && wrote.length === 0;
    const what = already ? `already active — engine ${engine}, host ${host}; every step re-checked, nothing written`
      : `activated engine ${engine} for ${host}${wasActive ? ` (was active; this run updated: ${[...new Set(wrote)].join(', ')})` : ''}`;
    say(`tokenomics: ${what}${stopGate ? '' : ' (Stop gate off)'}\n${touched.map((f) => `  ${relative(repo, f)}`).join('\n')}\n`);
    return 0;
  } catch (err) {
    const code = err instanceof ActivationError ? err.code : 1;
    const msg = String(err?.message ?? err);
    process.stderr.write(`tokenomics: activation stopped at ${step} — ${msg}\n  activation NOT recorded: the hooks stay inert. Fix the cause and re-run install-hooks.mjs --host ${host}.\n`);
    return code;
  }
}

export async function main(argv = process.argv.slice(2)) {
  // `--doctor` is an alias of doctor.mjs (Plan 5 Task 9): the checks live there, and fail rather than warn.
  if (argv.includes('--doctor')) return (await import('./doctor.mjs')).runDoctor(argv.filter((a) => a !== '--doctor'));
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const remove = argv.includes('--remove');
  const local = argv.includes('--local');
  const repo = resolve(arg('--repo') || process.cwd());
  const skillRoot = skillRootOf();
  const rel = relative(repo, skillRoot);
  if (rel.startsWith('..')) {
    process.stderr.write(`tokenomics: the installed skill (${skillRoot}) is outside the repo (${repo}) — run from the consumer repo the skill was installed into, or pass --repo.\n`);
    return 1;
  }
  // An installed copy refuses TOKENOMICS_MIGRATIONS (Q3): activation never runs, or records, under the harness lever.
  const gate = activationState(skillRoot, repo);
  if (gate.state === 'refused') {
    process.stderr.write(`${explain(gate, skillRoot, repo)}\n`);
    return 1;
  }

  if (argv.includes('--pull')) {
    const r = pullTelemetry(repo);
    const note = {
      pulled: 'telemetry pulled — the team\'s pushes are merged in; reports now see everyone',
      'no-submodule': 'no telemetry submodule here — nothing to pull (plain-dir mode is local-only)',
      failed: `pull failed (${r.error}) — offline, or no telemetry branch on the remote yet`,
    }[r.status];
    process.stderr.write(`tokenomics: ${note}\n`);
    return r.status === 'failed' ? 1 : 0;
  }

  if (argv.includes('--otel') || argv.includes('--otel-remove')) {
    const off = argv.includes('--otel-remove');
    const endpoint = arg('--endpoint') || 'http://localhost:4318';
    const touched = configureOtel(repo, { endpoint, remove: off, local }, loadSettings(repo));
    process.stderr.write(`tokenomics: OTel ${off ? 'disabled' : `enabled → ${endpoint}`}\n${touched.map((f) => `  ${relative(repo, f)}`).join('\n')}\n`);
    if (!off) {
      process.stderr.write('for STANDALONE Copilot CLI terminals also export (shell profile):\n'
        + '  export COPILOT_OTEL_ENABLED=true\n'
        + `  export OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}\n`
        + '(VS Code terminals get these forwarded automatically.)\n');
    }
    return 0;
  }

  const hostArg = arg('--host');
  const host = hostArg === null ? null : (HOST_ALIASES[hostArg] ?? hostArg);

  // `--git-hook` alone (no --host): only the post-commit hook, additive on an active install. With --host it is step 8.
  if (argv.includes('--git-hook') && host === null) {
    const r = installGitHook(repo, rel, { remove });
    process.stderr.write(gitHookNote(r));
    return r.status === 'backup-exists' ? 1 : 0;
  }

  if (remove) {
    // Unwiring takes one host, or every host (no --host, or `all`), so an uninstall never leaves a task behind.
    const all = host === null || host === 'all';
    if (!all && !HOSTS.includes(host)) { process.stderr.write(hostUsage(hostArg)); return 2; }
    const settings = loadSettings(repo);
    const touched = [];
    if (all || host === 'claude') touched.push(installClaude(repo, rel, { local, remove }));
    if (all || host === 'copilot-cli') touched.push(installCopilot(repo, rel, { remove }));
    if (all || host === 'vscode') touched.push(installVsCode(repo, rel, { remove }));
    // The user-level Copilot wiring serves every repository on this machine: it goes only when asked by name.
    if (argv.includes('--user-hooks')) touched.push(...installUserHooks({ remove: true }));
    else if (existsSync(userHooksFile())) process.stderr.write(`tokenomics: the Copilot user-level hooks (${userHooksFile()}) are kept — they serve every repository on this machine; remove them with --remove --user-hooks\n`);
    touched.push(installGitignore(repo, { remove }, settings));
    if (all || argv.includes('--git-hook')) {
      const g = installGitHook(repo, rel, { remove: true });
      if (g.status === 'removed') process.stderr.write(gitHookNote(g));
    }
    process.stderr.write(`tokenomics: removed hooks from\n${touched.map((f) => `  ${relative(repo, f)}`).join('\n')}\n`);
    return 0;
  }

  if (argv.includes('--update-manifest') && host === null) {
    // On its own: write revision N+1 when module.json differs from settings (D-MAN); a no-op otherwise.
    try {
      const settings = loadSettings(repo);
      const dir = telemetryDir(repo, settings);
      // N+1 presumes N: a repo never activated has no module.json, and this mode never writes revision 1 (review minor 1).
      if (!existsSync(join(dir, 'module.json'))) {
        process.stderr.write(`tokenomics: --update-manifest: no module.json in ${relative(repo, dir) || dir} — activate first (install-hooks.mjs --host <${HOSTS.join('|')}>)\n`);
        return 1;
      }
      const r = ensureModuleManifest(dir, settings, { update: true });
      process.stderr.write(`tokenomics: module manifest ${r.mismatch.length ? `revision ${r.revision} written (${r.mismatch.join(', ')} changed)` : `revision ${r.revision} matches settings${r.written ? ' (its missing archive written)' : '; nothing to write'}`}\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`tokenomics: --update-manifest failed — ${err?.message ?? err}\n`);
      return 1;
    }
  }

  // 1. --host is required for activation (D-HOST).
  if (host === null || !HOSTS.includes(host)) { process.stderr.write(hostUsage(hostArg)); return 2; }
  const dir = arg('--dir');
  if (argv.includes('--dir') && (!dir || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(dir))) {
    process.stderr.write(`tokenomics: --dir needs a folder name (letters, digits, '.', '_', '-'; no path), got ${JSON.stringify(dir)}\n`);
    return 2;
  }
  if (argv.includes('--user-hooks') && host !== 'copilot-cli') { process.stderr.write('tokenomics: --user-hooks applies to --host copilot-cli only\n'); return 2; }
  return activate(repo, skillRoot, rel, { host, local, plainFolder: argv.includes('--plain-folder'), dir, updateManifest: argv.includes('--update-manifest'), gitHook: argv.includes('--git-hook'), userHooks: argv.includes('--user-hooks') });
}

// items 12/13: realpath main guard, exit after stdio drains. In an installed copy run with TOKENOMICS_MIGRATIONS set,
// the variable is never parsed here (main refuses it with its own line).
const entryOn = entryPointsOn(engineRootOf(import.meta.url));
const exit_ = entryOn ? exitAfterDrain : (c) => process.exit(c);
if (entryOn ? isMain(import.meta.url) : (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  Promise.resolve(main()).then((code) => exit_(code), (err) => {
    process.stderr.write(`tokenomics: ${err?.message || err}\n`);
    exit_(1);
  });
}
