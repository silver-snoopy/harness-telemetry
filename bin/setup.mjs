// `harness-telemetry setup`: one command from a project root to a working tokenomics install. It detects the hosts,
// copies the engine for each target, activates each host from its installed copy (with the git post-commit fallback;
// Copilot CLI at user level), runs doctor, and prints, or with --commit makes, the commit teammates need. Every step is
// the documented command, run as a child, so a re-run on a set-up project writes nothing new and says so. It never
// passes --force: a locally modified engine copy stops it with the copy step's own reason. STDLIB ONLY.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SETUP_USAGE = `usage: harness-telemetry setup [--repo <dir>] [--host <claude,copilot-cli,vscode>] [--commit] [--probe]
                              [--no-git-hook] [--repo-hooks] [--tracker <jira|github|ado>] [--tracker-keys <K1,K2>]
                              [--tracker-url <https-url>] [--tracker-project <p>] [--no-tracker]
  Detects the hosts (claude / copilot on PATH, .claude/, .github/ Copilot config) unless --host names them.
  --commit       commit the files teammates need (only those paths, nothing else you have staged)
  --probe        also run one short real host session per host to prove the hooks fire
  --no-git-hook  skip the git post-commit fallback sweep
  --repo-hooks   wire Copilot CLI in the repo's .github/hooks/ instead of at user level (~/.copilot/hooks/)
  --tracker      the work-item tracker whose ids to mine (default: inferred from the remote and the history)
  --tracker-keys the Jira project keys, comma separated (with --tracker jira; default: the keys the history shows)
  --tracker-url  the tracker's https address for the receipt adapter (with --tracker)
  --tracker-project  the tracker project for the receipt adapter (with --tracker)
  --no-tracker   write no work-item id rules`;

const HOST_ORDER = ['claude', 'copilot-cli', 'vscode'];
const HOST_ALIASES = { copilot: 'copilot-cli' };
const TARGET_OF = { claude: 'claude', 'copilot-cli': 'copilot', vscode: 'copilot' };
const ADAPTER_FILE = { jira: 'jira.mjs', github: 'github.mjs', ado: 'azure-devops.mjs' };
const COPY_OF = { claude: '.claude/skills/tokenomics', copilot: '.github/skills/tokenomics' };
// What teammates need, as `git add` paths (only the ones with changes are named).
const SHARED_PATHS = ['.claude/skills/tokenomics', '.github/skills/tokenomics', '.agents/tokenomics/settings.json',
  '.claude/settings.json', '.github/hooks/tokenomics.json', '.vscode/tasks.json', '.gitignore', '.gitmodules', '.agents/telemetry'];

function onPath(name, env) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  return (env.PATH ?? '').split(delimiter).filter(Boolean).some((d) => exts.some((x) => existsSync(join(d, name + x))));
}

/** The hosts this project and machine use, each with why: `[{host, why}]`. VS Code is never guessed (opt-in). */
export function detectHosts(repo, env = process.env) {
  const out = [];
  const why = (checks) => checks.filter(([ok]) => ok).map(([, w]) => w);
  const claude = why([[existsSync(join(repo, '.claude')), '.claude/'], [onPath('claude', env), 'claude on PATH']]);
  if (claude.length) out.push({ host: 'claude', why: claude.join(', ') });
  const gh = ['copilot-instructions.md', 'agents', 'prompts', 'hooks', 'skills'].filter((n) => existsSync(join(repo, '.github', n)));
  const copilot = why([[gh.length > 0, `.github/${gh[0]}`], [onPath('copilot', env), 'copilot on PATH']]);
  if (copilot.length) out.push({ host: 'copilot-cli', why: copilot.join(', ') });
  return out;
}

/**
 * Commit exactly `paths` from the index, leaving anything else the operator has staged staged and uncommitted. Built in
 * a temporary index (HEAD plus these paths' entries), because `git commit -- <path>` re-adds from the working tree and
 * git skips the store's gitlink there (`ignore = all`); activation already staged that pointer. Returns an error line,
 * or null.
 */
export function commitShared(repo, paths, env = process.env) {
  const git = (a, o = {}) => spawnSync('git', a, { cwd: repo, encoding: 'utf8', env: { ...env, ...o.env }, input: o.input });
  const plain = paths.filter((p) => p !== '.agents/telemetry');
  const add = plain.length ? git(['add', '--', ...plain]) : { status: 0 };
  if (add.status !== 0) return (add.stderr || '').trim().split('\n').pop();
  const entries = git(['ls-files', '-s', '-z', '--', ...paths]).stdout;
  const tmp = join(git(['rev-parse', '--absolute-git-dir']).stdout.trim(), `tokenomics-setup-index-${process.pid}`);
  const idx = { env: { GIT_INDEX_FILE: tmp } };
  try {
    for (const step of [['read-tree', 'HEAD'], ['update-index', '-z', '--index-info']]) {
      const r = git(step, { ...idx, input: step[0] === 'update-index' ? entries.split('\0').filter(Boolean).map((e) => `${e}\0`).join('') : undefined });
      if (r.status !== 0) return (r.stderr || '').trim().split('\n').pop();
    }
    const c = git(['commit', '-q', '-m', 'chore: add tokenomics telemetry'], idx);
    return c.status === 0 ? null : (c.stderr || c.stdout || '').trim().split('\n').pop();
  } finally {
    rmSync(tmp, { force: true });
  }
}

function hasRules(file) {
  try { const r = JSON.parse(readFileSync(file, 'utf8'))?.ids?.rules; return Array.isArray(r) && r.length > 0; } catch { return false; }
}

/** The trackers to write rules for: `{trackers, receipts, rules}`, or `{error}` for a bad flag (the caller exits 2). */
async function planTrackers(args, opt, repo, env) {
  const none = { trackers: [], receipts: null, rules: [] };
  const flag = opt('--tracker');
  const keyList = opt('--tracker-keys');
  const url = opt('--tracker-url');
  const project = opt('--tracker-project');
  if (args.includes('--no-tracker')) return flag || keyList || url || project ? { error: '--no-tracker cannot be combined with --tracker, --tracker-keys, --tracker-url or --tracker-project' } : none;
  if (!flag) {
    if (url) return { error: '--tracker-url requires --tracker' };
    if (project) return { error: '--tracker-project requires --tracker' };
  }
  if (url) {
    let u = null;
    try { u = new URL(url); } catch { /* reported below */ }
    if (u?.protocol !== 'https:') return { error: `--tracker-url must be https (got '${url}')` };
  }
  const { detectTrackers, rulesFor, PRESETS } = await import('../tokenomics/engine/trackers.mjs');
  const found = detectTrackers(repo, { env });
  let trackers = found.trackers;
  let receipts = found.receipts;
  const chosen = flag ?? (keyList ? 'jira' : null);
  if (chosen) {
    if (!Object.hasOwn(PRESETS, chosen)) return { error: `unknown --tracker '${chosen}' — one of jira, github, ado` };
    if (keyList && chosen !== 'jira') return { error: '--tracker-keys applies to --tracker jira only' };
    const keys = keyList ? keyList.split(',').map((k) => k.trim()).filter(Boolean) : found.trackers.find((t) => t.tracker === 'jira')?.keys;
    if (chosen === 'jira' && !keys?.length) return { error: '--tracker jira needs --tracker-keys (e.g. PAY,WEB): the history shows no project keys' };
    trackers = [{ tracker: chosen, why: 'chosen with --tracker', ...(chosen === 'jira' ? { keys } : {}) }];
    receipts = chosen;
  }
  const tracker = receipts ? { kind: receipts, ...(url ? { url } : {}), ...(project ? { project } : {}) } : null;
  try { return { trackers, receipts, tracker, rules: rulesFor(trackers, found.host) }; } catch (e) { return { error: e.message }; }
}

export async function runSetup(args, { packageRoot, from, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s), env = process.env } = {}) {
  if (args.includes('--help') || args.includes('-h')) { out(`${SETUP_USAGE}\n`); return 0; }
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  for (const n of ['--repo', '--host', '--tracker', '--tracker-keys', '--tracker-url', '--tracker-project']) {
    if (args.includes(n) && (!opt(n) || opt(n).startsWith('--'))) { err(`${n} needs a value\n${SETUP_USAGE}\n`); return 2; }
  }
  const known = new Set(['--repo', '--host', '--commit', '--probe', '--no-git-hook', '--repo-hooks', '--tracker', '--tracker-keys', '--tracker-url', '--tracker-project', '--no-tracker',
    opt('--repo'), opt('--host'), opt('--tracker'), opt('--tracker-keys'), opt('--tracker-url'), opt('--tracker-project')]);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length) { err(`unknown argument ${unknown[0]}\n${SETUP_USAGE}\n`); return 2; }

  const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  const top = git(resolve(opt('--repo') ?? process.cwd()), 'rev-parse', '--show-toplevel');
  if (top.status !== 0) { err('harness-telemetry setup: not inside a git repository — run it from your project (or pass --repo)\n'); return 1; }
  const repo = top.stdout.trim();

  // Work-item tracker rules (Plan 7): validated before anything is written.
  const plan = await planTrackers(args, opt, repo, env);
  if (plan.error) { err(`harness-telemetry setup: ${plan.error}\n${SETUP_USAGE}\n`); return 2; }

  let hosts;
  if (opt('--host')) {
    hosts = opt('--host').split(',').map((h) => HOST_ALIASES[h.trim()] ?? h.trim()).filter(Boolean);
    const bad = hosts.find((h) => !HOST_ORDER.includes(h));
    if (bad) { err(`unknown host '${bad}' — one of ${HOST_ORDER.join(', ')}\n`); return 2; }
    hosts = HOST_ORDER.filter((h) => hosts.includes(h)).map((h) => ({ host: h, why: 'chosen with --host' }));
  } else {
    hosts = detectHosts(repo, env);
    if (!hosts.length) { err('harness-telemetry setup: no host found (no claude or copilot on PATH, no .claude/ or .github/ Copilot config) — pass --host claude,copilot-cli\n'); return 2; }
  }
  out(`harness-telemetry setup in ${repo}\n  hosts: ${hosts.map((h) => `${h.host} (${h.why})`).join(', ')}\n`);

  // 1. copy, once per target
  const { installCopy, InstallError } = await import('../tokenomics/engine/install-copy.mjs');
  const targets = [...new Set(hosts.map((h) => TARGET_OF[h.host]))];
  for (const target of targets) {
    try {
      const r = installCopy({ packageRoot, repo, target, from });
      out(`  copy (${target}): ${r.status} — ${COPY_OF[target]}\n`);
    } catch (e) {
      err(`harness-telemetry setup: the ${target} copy stopped — ${e instanceof InstallError ? e.message : String(e?.message ?? e).split('\n')[0]}\n`);
      return 1;
    }
  }

  // 1b. tracker rules, tracker and receipts.command into fresh settings, written by the installed copy's own helpers
  // (so a legacy store keeps its module directory); an existing settings file is never edited
  if (plan.rules.length) {
    const copy = COPY_OF[targets[0]];
    const receipts = plan.tracker ? { command: ['node', `${copy}/adapters/${ADAPTER_FILE[plan.tracker.kind]}`] } : null;
    const settingsFile = join(repo, '.agents', 'tokenomics', 'settings.json');
    const fresh = !existsSync(settingsFile);
    if (fresh) {
      try {
        const ih = await import(pathToFileURL(join(repo, copy, 'scripts', 'install-hooks.mjs')).href);
        const base = ih.freshSettings({ dir: ih.defaultDir(repo).dir });
        ih.saveSettings(repo, {
          ...base, ids: { ...base.ids, rules: plan.rules },
          ...(plan.tracker ? { tracker: plan.tracker, receipts: { ...base.receipts, ...receipts } } : {}),
        });
      } catch (e) {
        err(`harness-telemetry setup: could not write the tracker rules — ${String(e?.message ?? e).split('\n')[0]}\n`);
        return 1;
      }
    }
    // Reported only now, after the write succeeded; "detected (not applied)" when nothing was written.
    const note = fresh ? '' : ' — detected (not applied)';
    for (const t of plan.trackers) out(`  tracker: ${t.tracker} (${t.why})${note}\n`);
    if (plan.receipts) out(`  receipts from ${plan.receipts}${note}\n`);
    if (!fresh) {
      const known = hasRules(settingsFile);
      const add = { ...(known ? {} : { ids: { rules: plan.rules } }), ...(plan.tracker ? { tracker: plan.tracker, receipts } : {}) };
      if (known) out('  tracker rules: the existing settings already define ids.rules; left as they are\n');
      if (Object.keys(add).length) {
        out(`  settings already exist and are never edited by setup — add these rules to .agents/tokenomics/settings.json (merge into any existing "receipts"), then record them:\n${JSON.stringify(add, null, 2).replace(/^/gm, '    ')}\n    node ${copy}/scripts/install-hooks.mjs --update-manifest\n`);
      }
    }
  }

  // 2. activate each host from its own installed copy (the documented command, as a child)
  const userHooks = !args.includes('--repo-hooks');
  const gitHook = !args.includes('--no-git-hook');
  for (const { host } of hosts) {
    const script = join(repo, COPY_OF[TARGET_OF[host]], 'scripts', 'install-hooks.mjs');
    const argv = [script, '--host', host, '--repo', repo, ...(gitHook ? ['--git-hook'] : []), ...(host === 'copilot-cli' && userHooks ? ['--user-hooks'] : [])];
    out(`  activate ${host}:\n`);
    const r = spawnSync(process.execPath, argv, { cwd: repo, env, stdio: 'inherit' });
    if (r.status !== 0) { err(`harness-telemetry setup: activation of ${host} stopped (exit ${r.status}); fix the cause above and re-run setup\n`); return r.status || 1; }
  }

  // 3. doctor (and the probe on request), from the first copy
  const doctor = join(repo, COPY_OF[targets[0]], 'scripts', 'doctor.mjs');
  out('  doctor:\n');
  const d = spawnSync(process.execPath, [doctor, '--repo', repo], { cwd: repo, env, stdio: 'inherit' });
  let code = d.status ?? 1;
  if (args.includes('--probe')) {
    for (const { host } of hosts.filter((h) => h.host !== 'vscode')) {
      out(`  probe ${host}:\n`);
      const p = spawnSync(process.execPath, [doctor, '--repo', repo, '--probe', '--host', host], { cwd: repo, env, stdio: 'inherit' });
      if (p.status !== 0) code = p.status ?? 1;
    }
  }

  // 4. what teammates need
  const changed = SHARED_PATHS.filter((p) => existsSync(join(repo, p)) && git(repo, 'status', '--porcelain', '--', p).stdout.trim());
  if (!changed.length) {
    out('  nothing to commit — the shared files are already committed\n');
  } else if (args.includes('--commit')) {
    const c = commitShared(repo, changed, env);
    if (c) { err(`harness-telemetry setup: the commit failed — ${c}\n`); return 1; }
    out(`  committed: ${changed.join(' ')}\n`);
  } else {
    out(`  commit these for your teammates (or re-run setup with --commit, which commits only these):\n    git add ${changed.join(' ')}\n    git commit -m "chore: add tokenomics telemetry"\n`);
  }
  if (hosts.some((h) => h.host === 'copilot-cli') && userHooks) {
    out('  teammates: run this same setup once on their machine (Copilot CLI hooks are wired per machine)\n');
  }
  out(code === 0 ? 'harness-telemetry setup: done\n' : `harness-telemetry setup: done, but a check failed (exit ${code}) — see above\n`);
  return code;
}
