#!/usr/bin/env node
// doctor.mjs — health-check an installed tokenomics engine (Plan 5 Task 9, spec §14.2, §14.10). Checks that decide
// whether the engine can work FAIL; advisory checks WARN. It reads only and never writes (`--fix` still starts the
// local OTel sink, the one old side effect, and nothing else).
//
//   node <skill>/scripts/doctor.mjs [--repo <dir>] [--json] [--strict] [--fix]
//                                   [--probe [--host h] [--timeout s] [--keep-state]]
//
// One line per check: `ok` / `warn` / `fail`, then the id and its detail. Exit 1 on any `fail` (and on any `warn`
// with --strict). `--json` emits `{checks: [{id, status, detail}]}`. `--probe` runs one isolated probe session per host
// instead of the checks (engine/probe.mjs, spec §14.9): `fired` is ok, `sweep-only (partial)` and `unavailable` warn,
// `not-fired` fails; `--json` emits `{probes: [...]}`.
//
// fail: integrity · activation · substrate · settings · targets · claims (unreadable) · switches
// warn: everything the old `install-hooks --doctor` warned about, a stale claim file, an unreachable OTel sink
//
// The fail checks apply to a repo with at least one installed copy (`.claude/skills/tokenomics`,
// `.github/skills/tokenomics`); a repo with none is the source / reference-era layout and only gets the warnings.
// STDLIB ONLY.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { activationState, explain } from '../engine/activation.mjs';
import { loadSettings, telemetryDir } from '../engine/config.mjs';
import { verifySubstrate } from '../engine/substrate.mjs';
import { isMain } from '../engine/entry.mjs';
import { DEFAULT_TIMEOUT_MS, PARTIAL, PROBE_HOSTS, RECURSION_MESSAGE, normalizeHost, runProbe } from '../engine/probe.mjs';
import { loadSchemas, validate } from '../kit/schema.mjs';
import { GIT_MARKER, MARKER, TASK_LABEL, gitHooksDir } from './install-hooks.mjs';

/** The age past which a `.claim` file is a crash leftover, not a claim in flight. The engine has no claim-staleness
 * constant of its own (scopes.mjs has only the 5-minute pending-matching window), so this is the ruling's 10 minutes. */
export const CLAIM_CRASH_WINDOW_MS = 10 * 60 * 1000;

const COPY_DIRS = ['.claude/skills/tokenomics', '.github/skills/tokenomics'];
const TARGET_ALIASES = { copilot: 'copilot-cli' };
const TARGETS = ['claude', 'copilot-cli', 'vscode'];

const sha = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const posix = (p) => p.split('\\').join('/');
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function walk(root) {
  const out = [];
  const go = (dir, prefix) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) go(join(dir, ent.name), rel);
      else if (ent.name !== '.DS_Store') out.push(rel);
    }
  };
  go(root, '');
  return out.sort();
}

// R11: an empty or whitespace-only TOKENOMICS_MIGRATIONS counts as unset.
const switchSet = (env) => env.TOKENOMICS_MIGRATIONS !== undefined && env.TOKENOMICS_MIGRATIONS.trim() !== '';
function withoutSwitch(env) { const { TOKENOMICS_MIGRATIONS: _, ...rest } = env; return rest; }
function effectiveEnv(env) { return env.TOKENOMICS_MIGRATIONS !== undefined && !switchSet(env) ? withoutSwitch(env) : env; }

const found = (repo) => COPY_DIRS.map((d) => ({ rel: d, root: join(repo, d) })).filter((c) => existsSync(c.root));

// --- the fail checks ---------------------------------------------------------------------------------------------

function checkIntegrity(copies) {
  const problems = [];
  for (const c of copies) {
    const manifest = readJson(join(c.root, 'ENGINE.json'));
    if (!isObj(manifest) || !isObj(manifest.files)) { problems.push(`${c.rel}: ENGINE.json is missing or unreadable (reinstall: harness-telemetry install tokenomics)`); continue; }
    const present = walk(c.root).filter((r) => r !== 'ENGINE.json');
    for (const r of present) {
      if (!(r in manifest.files)) { problems.push(`${c.rel}/${r}: unexpected file in the installed copy`); continue; }
      let digest;
      try { digest = sha(join(c.root, r)); } catch (e) { problems.push(`${c.rel}/${r}: unreadable (${e?.code === 'ENOENT' ? 'dangling link' : e?.code ?? 'read error'})`); continue; }
      if (digest !== manifest.files[r]) problems.push(`${c.rel}/${r}: modified against ENGINE.json`);
    }
    for (const r of Object.keys(manifest.files)) if (!present.includes(r)) problems.push(`${c.rel}/${r}: missing from the installed copy`);
  }
  return problems.length ? { status: 'fail', detail: `${problems.join('; ')} (reinstall with: harness-telemetry install tokenomics --force)` }
    : { status: 'ok', detail: `${copies.length} installed cop${copies.length === 1 ? 'y' : 'ies'} match ENGINE.json` };
}

function checkActivation(copies, repo, env) {
  const bad = [];
  for (const c of copies) {
    const st = activationState(c.root, repo, env);
    if (st.state === 'inert' || st.state === 'refused') bad.push(`${c.rel}: ${explain(st, c.root, repo)}`);
  }
  return bad.length ? { status: 'fail', detail: bad.join('; ') } : { status: 'ok', detail: 'active' };
}

function checkSwitches(copies, env) {
  const v = env.TOKENOMICS_MIGRATIONS;
  if (copies.length && switchSet(env)) return { status: 'fail', detail: `TOKENOMICS_MIGRATIONS is set (${JSON.stringify(v)}) for an installed copy; the production switch set is {} (unset it)` };
  return { status: 'ok', detail: 'TOKENOMICS_MIGRATIONS not set' };
}

function checkSubstrate(repo, settings, env) {
  const v = verifySubstrate(repo, settings, { env });
  return v.ok ? { status: 'ok', detail: v.form } : { status: 'fail', detail: v.problems.join('; ') };
}

function checkModule(repo, settings) {
  const dir = telemetryDir(repo, settings);
  const modPath = join(dir, 'module.json');
  const shown = relative(repo, modPath);
  if (!existsSync(modPath)) return `${shown}: missing (re-run install-hooks.mjs to write it)`;
  const mod = readJson(modPath);
  if (!isObj(mod)) return `${shown}: invalid (not a JSON object)`;
  const schemas = loadSchemas();
  const errs = validate(schemas['module.json'], mod, { schemas });
  if (errs.length) return `${shown}: invalid (${errs.slice(0, 3).map((x) => `${x.path}: ${x.message}`).join('; ')})`;
  const arch = join(dir, 'manifests', `${mod.manifestRevision}.json`);
  if (!existsSync(arch)) return `${relative(repo, arch)}: missing (the archive of manifestRevision ${mod.manifestRevision})`;
  return null;
}

function checkSettingsAndModule(repo, env, hasInstalled) {
  let settings;
  // The switch is reported by `switches` and `activation`; settings are judged without it (an installed copy would
  // otherwise throw the refusal here and skip the checks after this one).
  try { settings = loadSettings(repo, withoutSwitch(env)); } catch (e) { return { settings: null, result: { status: 'fail', detail: `.agents/tokenomics/settings.json: ${String(e?.message ?? e).replace(/^tokenomics: /, '')}` } }; }
  if (!hasInstalled) return { settings, result: { status: 'ok', detail: 'settings load (no installed copy: module.json not required)' } };
  const problem = checkModule(repo, settings);
  return { settings, result: problem ? { status: 'fail', detail: problem } : { status: 'ok', detail: 'settings, module.json and its manifest archive are valid' } };
}

// What the wired hooks of each host point at: the set of copy paths (relative to the repo) and whether a gate is wired.
function wiredClaude(repo) {
  const rels = new Set();
  let stop = false; let any = false;
  for (const f of ['settings.json', 'settings.local.json']) {
    const hooks = readJson(join(repo, '.claude', f))?.hooks;
    if (!isObj(hooks)) continue;
    for (const [event, list] of Object.entries(hooks)) {
      for (const e of Array.isArray(list) ? list : []) {
        if (!e || !e[MARKER]) continue;
        any = true;
        if (event === 'Stop') stop = true;
        for (const h of e.hooks ?? []) { const m = /\$\{CLAUDE_PROJECT_DIR\}\/(.+?)\/hooks\//.exec(h?.command ?? ''); if (m) rels.add(m[1]); }
      }
    }
  }
  return { any, rels, stop };
}
function wiredCopilot(repo) {
  const rels = new Set();
  const doc = readJson(join(repo, '.github', 'hooks', 'tokenomics.json'));
  const hooks = isObj(doc?.hooks) ? doc.hooks : null;
  if (!hooks) return { any: false, rels, stop: false };
  for (const list of Object.values(hooks)) for (const h of Array.isArray(list) ? list : []) { const m = /\.\/(.+?)\/hooks\//.exec(h?.bash ?? ''); if (m) rels.add(m[1]); }
  return { any: true, rels, stop: Array.isArray(hooks.agentStop) && hooks.agentStop.length > 0 };
}
function wiredVsCode(repo) {
  const rels = new Set();
  const tasks = (readJson(join(repo, '.vscode', 'tasks.json'))?.tasks ?? []).filter((t) => t?.label === TASK_LABEL);
  for (const t of tasks) for (const a of t.args ?? []) { const m = /^\.\/(.+?)\/hooks\//.exec(a); if (m) rels.add(m[1]); }
  return { any: tasks.length > 0, rels, stop: false };
}
const WIRED = { claude: wiredClaude, 'copilot-cli': wiredCopilot, vscode: wiredVsCode };

function checkTargets(repo, settings) {
  const raw = settings?.targets;
  if (!Array.isArray(raw) || !raw.length) return { status: 'fail', detail: 'settings.targets is not recorded (re-run install-hooks.mjs --host <claude|copilot-cli|vscode>)' };
  const engine = settings.engine;
  if (typeof engine !== 'string') return { status: 'fail', detail: 'settings.engine (the activation record) is missing, so no wired copy can be compared' };
  const stopOn = settings.enforcement?.stopGate === 'on';
  const problems = [];
  const names = [];
  for (const name of raw) {
    const host = TARGET_ALIASES[name] ?? name;
    if (!TARGETS.includes(host)) { problems.push(`target ${JSON.stringify(name)}: unknown (use ${TARGETS.join(', ')})`); continue; }
    names.push(host);
    const w = WIRED[host](repo);
    if (!w.any) { problems.push(`${host}: hooks not wired (run install-hooks.mjs --host ${host})`); continue; }
    if (!w.rels.size) problems.push(`${host}: wired hooks name no engine copy`);
    for (const rel of w.rels) {
      const m = readJson(join(repo, rel, 'ENGINE.json'));
      if (!isObj(m) || m.installed == null) problems.push(`${host}: wired to ${rel}, which is not an installed copy`);
      else if (m.engine !== engine) problems.push(`${host}: wired to ${rel} at engine ${m.engine}, but the activation record is ${engine}`);
    }
    if (host !== 'vscode') {
      if (stopOn && !w.stop) problems.push(`${host}: Stop gate not wired but enforcement.stopGate is "on"`);
      if (!stopOn && w.stop) problems.push(`${host}: Stop gate wired but enforcement.stopGate is not "on" (off)`);
    }
  }
  return problems.length ? { status: 'fail', detail: problems.join('; ') } : { status: 'ok', detail: `${names.join(', ')} wired to engine ${engine}` };
}

function checkClaims(repo, settings) {
  const scopes = join(telemetryDir(repo, settings), 'scopes');
  if (!existsSync(scopes)) return { status: 'ok', detail: 'no scopes yet' };
  const files = [];
  for (const ent of readdirSync(scopes, { withFileTypes: true })) {
    if (ent.isDirectory()) { for (const n of readdirSync(join(scopes, ent.name))) if (n.endsWith('.claim')) files.push(join(scopes, ent.name, n)); }
    else if (ent.name.endsWith('.claim')) files.push(join(scopes, ent.name));
  }
  const unreadable = [];
  const stale = [];
  for (const f of files) {
    const shown = posix(relative(repo, f));
    let doc = null;
    try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { /* unreadable */ }
    if (!isObj(doc)) { unreadable.push(shown); continue; }
    const age = Date.now() - statSync(f).mtimeMs;
    if (age > CLAIM_CRASH_WINDOW_MS) stale.push(shown);
  }
  if (unreadable.length) return { status: 'fail', detail: `unreadable claim file: ${unreadable.join(', ')} (the next capture leaves it for you; inspect, then remove or repair it)` };
  if (stale.length) return { status: 'warn', detail: `claim file older than the crash window of 10 minutes: ${stale.join(', ')} (a crashed claim; the next capture completes it)` };
  return { status: 'ok', detail: `${files.length} claim file(s), none stale` };
}

// --- the warnings the old `install-hooks --doctor` made ----------------------------------------------------------

async function legacyChecks(repo, settings, env, { fix = false } = {}) {
  const out = [];
  const add = (id, status, detail) => out.push({ id, status, detail: detail ?? '' });
  const warnIf = (ok, id, note, okNote) => add(id, ok ? 'ok' : 'warn', ok ? okNote : note);
  let cap;
  try { cap = await import('../hooks/telemetry-capture.mjs'); } catch (e) { add('capture', 'warn', `capture hook cannot load: ${e?.message ?? e}`); return out; }
  const cfg = cap.loadConfig(repo, settings);

  const claude = wiredClaude(repo);
  const wantsClaude = !Array.isArray(settings?.targets) || settings.targets.includes('claude');
  if (claude.any && wantsClaude) {
    const pre = (readJson(join(repo, '.claude', 'settings.json'))?.hooks?.PreToolUse ?? []).some((e) => e && e[MARKER]);
    warnIf(pre, 'claude-scope-contract', 'dispatch marker not wired (re-run install-hooks.mjs — older install)');
  } else if (!Array.isArray(settings?.targets)) {
    add('claude-hooks', 'warn', 'not wired (run install-hooks.mjs)');
  }
  const copFile = join(repo, '.github', 'hooks', 'tokenomics.json');
  if (existsSync(copFile)) {
    const h = readJson(copFile)?.hooks ?? {};
    warnIf(!!(h.subagentStart && h.sessionEnd), 'copilot-scope-contract', 're-run install-hooks.mjs (older install; old CLIs ignore unknown events, safe to write)');
  }
  // A file that is neither committed nor ignored blocks the pipeline's gate.
  const gi = existsSync(join(repo, '.gitignore')) ? readFileSync(join(repo, '.gitignore'), 'utf8') : '';
  warnIf(gi.includes(`.agents/telemetry/${settings.dir}/live/`), 'gitignore', 'transient telemetry files are not ignored — they will dirty the tree and block the gate; re-run install-hooks.mjs');

  const telDir = join(repo, '.agents', 'telemetry');
  const gm = existsSync(join(repo, '.gitmodules')) ? readFileSync(join(repo, '.gitmodules'), 'utf8') : '';
  const registered = gm.includes('.agents/telemetry');
  const materialized = existsSync(join(telDir, '.git'));
  if (registered && materialized) {
    let note = '';
    try {
      const g = (args) => execFileSync('git', ['-C', telDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, env }).trim();
      const branch = g(['branch', '--show-current']);
      if (branch !== 'telemetry') note = `detached/off-branch (${branch || 'detached'}) — the next capture sync re-pins it`;
      else {
        let ahead = 0;
        try { ahead = Number(g(['rev-list', '--count', 'origin/telemetry..HEAD'])) || 0; } catch { /* no remote-tracking yet */ }
        note = ahead ? `${ahead} unpushed commit(s) — sync pushes at the next capture` : 'in sync';
      }
    } catch { note = 'state unreadable'; }
    add('telemetry-submodule', 'ok', `${note}; team view: install-hooks.mjs --pull before a team report`);
    // Local-only era leaves the submodule's origin pointing at the repo's own directory; once a REAL remote appears
    // every sync still lands only in the local branch until `git submodule sync` re-resolves './'.
    try {
      const originOf = (cwd) => execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, env }).trim().replace(/\/+$/, '');
      const superRemote = originOf(repo); // throws when the repo has no remote → local-only, no warning
      const subRemote = originOf(telDir);
      if (subRemote !== superRemote) add('telemetry-submodule-remote', 'warn', `points at ${subRemote} while the repo's origin is ${superRemote} — captures stay local-only; run: git submodule sync .agents/telemetry`);
    } catch { /* no remote at all — local-only mode */ }
  } else if (registered && !materialized) {
    add('telemetry-submodule', 'warn', 'registered but empty — cloned without --recurse-submodules; run: git submodule update --init');
  } else if (existsSync(telDir)) {
    add('telemetry-submodule', 'ok', 'plain dir (local-only); re-run install-hooks.mjs in a git repo to get the shared branch');
  }

  const scopeDir = join(telemetryDir(repo, settings), 'scopes');
  if (existsSync(scopeDir)) {
    const names = readdirSync(scopeDir);
    const records = names.filter((n) => n.endsWith('.json')).length;
    const pendings = names.filter((n) => n.startsWith('pending-')).length;
    const markers = names.filter((n) => n.startsWith('.pending-') || n.startsWith('.nagged-')).length;
    add('scopes', 'ok', `${records} record(s)${pendings ? `, ${pendings} unclaimed pending (a sweep claims them)` : ''}${markers ? `, ${markers} marker(s)` : ''}`);
  } else {
    add('scopes', 'ok', 'none yet (sessions declare via work-scope.mjs; see SKILL.md § Session scope)');
  }
  const vsTaskInstalled = wiredVsCode(repo).any;
  const hooksDir = gitHooksDir(repo);
  const gitHook = hooksDir && existsSync(join(hooksDir, 'post-commit')) && readFileSync(join(hooksDir, 'post-commit'), 'utf8').includes(GIT_MARKER);
  add('git-post-commit', 'ok', gitHook ? 'sweep installed' : 'sweep not installed (optional; --git-hook)');

  const claudeDirs = cap.claudeProjectDirs(repo);
  const copRoots = cap.copilotRoots(repo);
  const vsRoots = cap.vscodeStorageRoots(repo, env, cfg);
  let vsHashes = 0;
  for (const root of vsRoots) {
    try {
      for (const h of readdirSync(root)) {
        const folder = cap.workspaceFolderOf(join(root, h));
        if (folder && (cap.sameCwdOrUnder(folder, repo) || cap.sameCwdOrUnder(repo, folder))) vsHashes++;
      }
    } catch { /* ignore */ }
  }
  add('stores', 'ok', `claude: ${claudeDirs.length} project dir(s), copilot: ${copRoots.length} root(s), vscode: ${vsRoots.length} root(s) / ${vsHashes} matching workspace(s)`);
  if (vsTaskInstalled) add('vscode-sidebar', 'ok', 'folderOpen task installed (sidebar sweeps on folder open)');
  else if (vsHashes && !claudeDirs.length && !copRoots.length) add('vscode-sidebar', 'warn', `${vsHashes} sidebar workspace(s) for this repo and no Claude/Copilot store — nothing will sweep them here; run install-hooks.mjs --host vscode (adds a folderOpen task to shared .vscode/tasks.json; each teammate allows auto-tasks once)`);
  else if (vsHashes) add('vscode-sidebar', 'ok', `${vsHashes} workspace(s), swept by the other host(s)' sweeps (no task needed)`);
  else add('vscode-sidebar', 'ok', 'no workspaces for this repo (task not needed)');

  let ccusage = 'via npx at capture time';
  try { execFileSync('ccusage', ['--version'], { stdio: 'ignore', timeout: 5000, env }); ccusage = 'on PATH'; } catch { /* npx fallback is the documented default */ }
  add('ccusage', 'ok', ccusage);

  if (cfg.otel?.enabled) {
    const endpoint = cfg.otel.endpoint || 'http://localhost:4318';
    const probe = async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1000);
        const res = await fetch(`${endpoint.replace(/\/$/, '')}/healthz`, { signal: ctl.signal }).catch(() => null);
        clearTimeout(t);
        return !!res; // any HTTP answer means something is listening
      } catch { return false; }
    };
    let listening = await probe();
    if (!listening && fix) {
      cap.ensureSink(cfg.otel, env, repo);
      await new Promise((r) => setTimeout(r, 400));
      listening = await probe();
    }
    warnIf(listening, 'otel', 'configured but NOTHING is listening — emitted telemetry is being dropped (sink autostarts at the next capture; or rerun with --fix)', `endpoint ${endpoint} is listening`);
  } else {
    add('otel', 'ok', 'not enabled (optional; --otel)');
  }
  return out;
}

// --- driver ------------------------------------------------------------------------------------------------------

/** All checks for a repo, as `[{id, status, detail}]`. Reads only (apart from `fix`'s optional sink start). */
export async function runChecks(repo, { env = process.env, fix = false } = {}) {
  const e = effectiveEnv(env);
  const copies = found(repo);
  const checks = [];
  const add = (id, r) => checks.push({ id, ...r });
  const applicable = (r) => (copies.length ? r : { status: 'ok', detail: 'not applicable (no installed copy: source or reference-era layout)' });

  add('integrity', applicable(copies.length ? checkIntegrity(copies) : null));
  add('activation', applicable(copies.length ? checkActivation(copies, repo, e) : null));
  add('switches', checkSwitches(copies, e));
  const { settings, result } = checkSettingsAndModule(repo, e, copies.length > 0);
  add('settings', result);
  if (!settings) return checks;
  let rawSettings = settings;
  try { const doc = JSON.parse(readFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), 'utf8')); if (isObj(doc)) rawSettings = { ...settings, ...doc, enforcement: { ...settings.enforcement, ...doc.enforcement }, substrate: { ...settings.substrate, ...doc.substrate } }; } catch { /* defaults */ }
  add('substrate', applicable(copies.length ? checkSubstrate(repo, rawSettings, e) : null));
  add('targets', applicable(copies.length ? checkTargets(repo, rawSettings) : null));
  add('claims', checkClaims(repo, settings));
  checks.push(...await legacyChecks(repo, settings, e, { fix }));
  return checks;
}

/** CLI. Returns the exit code. */
export async function runDoctor(argv = process.argv.slice(2), { env = process.env } = {}) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv.includes('--probe')) return probeCli(argv, arg, env);
  const repo = resolve(arg('--repo') || process.cwd());
  const checks = await runChecks(repo, { env, fix: argv.includes('--fix') });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
  else {
    const width = Math.max(...checks.map((c) => c.id.length));
    process.stdout.write(`${checks.map((c) => `${c.status.padEnd(4)} ${c.id.padEnd(width)}${c.detail ? ` — ${c.detail}` : ''}`).join('\n')}\n`);
  }
  if (checks.some((c) => c.status === 'fail')) return 1;
  return argv.includes('--strict') && checks.some((c) => c.status === 'warn') ? 1 : 0;
}

// --- --probe (Plan 5 Task 10, D-PROBE, spec §14.9) ----------------------------------------------------------------

// setTimeout's limit is 2^31-1 ms; a larger bound would fire at once.
const MAX_TIMEOUT_S = 86400;
const PROBE_STATUS = (p) => (p.result === 'fired' ? 'ok' : p.result === 'unavailable' || p.mode === PARTIAL ? 'warn' : 'fail');

/** `--probe [--host h] [--timeout s] [--keep-state]`: one probe session per host. Exit 1 on a not-fired host (and with
 * --strict on a partial or unavailable one), 2 on a usage error or inside a probe session. */
async function probeCli(argv, arg, env) {
  if (env.TOKENOMICS_PROBE) {
    process.stderr.write(`tokenomics doctor: ${RECURSION_MESSAGE} (TOKENOMICS_PROBE is set: this is a probe session)\n`);
    return 2;
  }
  const repo = resolve(arg('--repo') || process.cwd());
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (argv.includes('--timeout')) {
    const s = Number(arg('--timeout'));
    if (!arg('--timeout') || !Number.isFinite(s) || s <= 0 || s > MAX_TIMEOUT_S) { process.stderr.write(`tokenomics doctor: --timeout needs a positive number of seconds, at most ${MAX_TIMEOUT_S}\n`); return 2; }
    timeoutMs = s * 1000;
  }
  let hosts;
  if (argv.includes('--host')) {
    const h = normalizeHost(arg('--host'));
    if (!PROBE_HOSTS.includes(h)) { process.stderr.write(`tokenomics doctor: --probe --host must be one of ${PROBE_HOSTS.join(', ')} (copilot = copilot-cli)\n`); return 2; }
    hosts = [h];
  } else {
    const raw = readJson(join(repo, '.agents', 'tokenomics', 'settings.json'))?.targets;
    hosts = [...new Set((Array.isArray(raw) ? raw : []).map(normalizeHost))].filter((h) => PROBE_HOSTS.includes(h));
    if (!hosts.length) { process.stderr.write('tokenomics doctor: no probe host — settings.targets records none; pass --host <claude|copilot-cli|vscode>\n'); return 2; }
  }
  const e = effectiveEnv(env);
  const probes = [];
  for (const host of hosts) probes.push(await runProbe(repo, { host, timeoutMs, env: e, keepState: argv.includes('--keep-state') }));
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify({ probes }, null, 2)}\n`);
  else {
    const label = (p) => (p.mode === PARTIAL ? 'partial' : p.result);
    const body = (p) => [
      `mode ${p.mode}`,
      Object.keys(p.events).length ? `events: ${Object.entries(p.events).map(([k, v]) => `${k} ${v}`).join(', ')}` : null,
      `ledger line ${p.expected.ledgerLine}, scope stamp ${p.expected.scopeStamp}`,
      p.reason ?? null,
      p.stateDir ? `state kept at ${p.stateDir}` : null,
    ].filter(Boolean).join('; ');
    process.stdout.write(`${probes.map((p) => `${label(p).padEnd(11)} probe:${p.host} — ${body(p)}`).join('\n')}\n`);
  }
  const statuses = probes.map(PROBE_STATUS);
  if (statuses.includes('fail')) return 1;
  return argv.includes('--strict') && statuses.includes('warn') ? 1 : 0;
}

// The realpath main guard (engine/entry.mjs): a copy reached through a symlinked path (macOS /var → /private/var)
// still runs.
if (isMain(import.meta.url)) {
  runDoctor().then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`tokenomics doctor: ${err?.message || err}\n`);
    process.exitCode = 1;
  });
}
