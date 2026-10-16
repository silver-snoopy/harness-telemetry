#!/usr/bin/env node
// Copilot CLI user-level hook dispatcher. `install-hooks.mjs --host copilot-cli --user-hooks` copies this file to
// `<COPILOT_HOME|~/.copilot>/hooks/tokenomics/dispatch.mjs` and wires `<…>/hooks/tokenomics.json` to it. Copilot CLI
// runs user-level hooks in every session; it did not run a repository's `.github/hooks/*.json` in the B3 readiness
// trial (CLI 1.0.96, `-p`), so the user-level file is the wiring that fires.
//
//   node dispatch.mjs <telemetry-capture|scope-hook> [args…]
//
// One user-level file serves every repository, so the dispatcher resolves the repository at run time: the session's
// checkout (`git rev-parse --show-toplevel` from the hook's cwd), else its primary worktree. It runs that repository's
// installed copy (`.github/skills/tokenomics` or `.claude/skills/tokenomics`, the one matching the activation record)
// with the hook's stdin, stdout and env. A repository that has not activated tokenomics for copilot-cli, or has no
// installed copy, is left alone: exit 0, no output. The Stop gate (`scope-hook --gate`) runs only where the repository's
// `enforcement.stopGate` is "on". A hook never fails the host session.
//
// sessionEnd: Copilot runs the hook BEFORE it writes the session's final usage checkpoint and `session.shutdown` (seen
// in the trial: hook.end, then session.usage_checkpoint, then session.shutdown, ~20 ms later), and the sweep takes a
// Copilot session only once it has shut down. So after the immediate capture, a detached waiter
// (`dispatch.mjs --await-shutdown <sessionId>`) sweeps once that session's events.jsonl records the shutdown, within
// AWAIT_MS. Copilot is never kept waiting; a session that never shuts down is left to the next session's start sweep.
//
// SELF-CONTAINED, STDLIB ONLY: this file runs outside any engine copy and imports nothing from one.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The installed-copy locations, in preference order (the Copilot target first). */
export const COPY_RELS = Object.freeze(['.github/skills/tokenomics', '.claude/skills/tokenomics']);
export const DISPATCH_SCRIPTS = Object.freeze(['telemetry-capture', 'scope-hook']);
export const AWAIT_MS = 60000;
const POLL_MS = 250;
const SID_RE = /^[A-Za-z0-9._-]{1,128}$/;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// The hook's git calls never follow an inherited GIT_DIR / GIT_WORK_TREE (a hook can run inside a git command).
const GIT_ENV_DROP = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'];
function git(cwd, args, env) {
  const clean = { ...env };
  for (const k of GIT_ENV_DROP) delete clean[k];
  try { return execFileSync('git', args, { cwd, env: clean, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null; } catch { return null; }
}

const activatedFor = (settings) => typeof settings?.engine === 'string' && settings.engine !== ''
  && Array.isArray(settings.targets) && (settings.targets.includes('copilot-cli') || settings.targets.includes('copilot'));

/**
 * The repository and installed copy a hook running in `cwd` serves, or null when there is none to serve:
 * `{repo, copy, settings}`. The checkout first, then the primary worktree (which holds the shared store).
 */
export function resolveCopy(cwd, env = process.env) {
  const top = git(cwd, ['rev-parse', '--show-toplevel'], env);
  if (!top) return null;
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], env);
  const primary = common ? dirname(common) : null;
  for (const root of [...new Set([top, primary].filter(Boolean))]) {
    const settings = readJson(join(root, '.agents', 'tokenomics', 'settings.json'));
    if (!activatedFor(settings)) continue;
    const found = COPY_RELS.map((r) => join(root, r)).filter((d) => existsSync(join(d, 'hooks', 'telemetry-capture.mjs')));
    const copy = found.find((d) => readJson(join(d, 'ENGINE.json'))?.engine === settings.engine) ?? found[0];
    if (copy) return { repo: root, copy, settings };
  }
  return null;
}

// The hook payload: Copilot pipes it (a FIFO, or a socket on macOS); a terminal or closed stdin gives none.
const readStdin = () => { try { const st = fstatSync(0); return st.isFIFO() || st.isSocket() || st.isFile() ? readFileSync(0, 'utf8') : ''; } catch { return ''; } };
const sessionIdOf = (input) => { try { const p = JSON.parse(input); const sid = p?.sessionId ?? p?.session_id; return SID_RE.test(sid ?? '') ? sid : null; } catch { return null; } };

/** Copilot's session-state roots, as the capture reads them (TOKENOMICS_COPILOT_ROOT, COPILOT_HOME, ~/.copilot). */
function sessionRoots(env) {
  if (env.TOKENOMICS_COPILOT_ROOT) return [env.TOKENOMICS_COPILOT_ROOT];
  return [...new Set([env.COPILOT_HOME && join(env.COPILOT_HOME, 'session-state'), join(env.HOME || homedir(), '.copilot', 'session-state')].filter(Boolean))];
}
/** Whether session `sid` has written `session.shutdown` (read from the end of its events.jsonl). */
export function hasShutdown(sid, env = process.env) {
  for (const root of sessionRoots(env)) {
    const p = join(root, sid, 'events.jsonl');
    let fd;
    try {
      fd = openSync(p, 'r');
      const size = fstatSync(fd).size;
      const n = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(n);
      readSync(fd, buf, 0, n, size - n);
      if (buf.toString('utf8').includes('"session.shutdown"')) return true;
    } catch { /* not this root */ } finally { if (fd !== undefined) closeSync(fd); }
  }
  return false;
}

/** Run one hook for the session in `cwd`; returns the exit code to hand back to Copilot (never a failure). */
export function dispatch(argv, { cwd = process.cwd(), env = process.env, input = readStdin() } = {}) {
  const [script, ...args] = argv;
  if (!DISPATCH_SCRIPTS.includes(script)) return 0;
  const hit = resolveCopy(cwd, env);
  if (!hit) return 0;
  if (script === 'scope-hook' && args.includes('--gate') && hit.settings.enforcement?.stopGate !== 'on') return 0;
  const r = spawnSync(process.execPath, [join(hit.copy, 'hooks', `${script}.mjs`), ...args], { cwd: hit.repo, env, input, stdio: ['pipe', 'inherit', 'inherit'] });
  const sid = script === 'telemetry-capture' && args.includes('--sweep') && env.TOKENOMICS_HOOK_EVENT === 'sessionEnd' ? sessionIdOf(input) : null;
  if (sid && !hasShutdown(sid, env)) {
    const { TOKENOMICS_HOOK_EVENT: _event, ...rest } = env; // the deferred sweep is not a hook firing
    try {
      spawn(process.execPath, [fileURLToPath(import.meta.url), '--await-shutdown', sid], { cwd, env: rest, detached: true, stdio: 'ignore' }).unref();
    } catch { /* the next session's start sweep is the fallback */ }
  }
  return r.status ?? 0;
}

/** The detached waiter: sweep once session `sid` has shut down, or give up after AWAIT_MS (TOKENOMICS_AWAIT_MS). */
export async function awaitShutdown(sid, { cwd = process.cwd(), env = process.env } = {}) {
  if (!SID_RE.test(sid ?? '')) return 0;
  const bound = Number(env.TOKENOMICS_AWAIT_MS) > 0 ? Number(env.TOKENOMICS_AWAIT_MS) : AWAIT_MS;
  const until = Date.now() + bound;
  while (!hasShutdown(sid, env)) {
    if (Date.now() >= until) return 0;
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
  return dispatch(['telemetry-capture', '--sweep'], { cwd, env, input: '' });
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return null; } })();
const invoked = (() => { try { return process.argv[1] ? realpathSync(process.argv[1]) : null; } catch { return null; } })();
if (self && self === invoked) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--await-shutdown') awaitShutdown(argv[1]).then((c) => { process.exitCode = c; });
  else process.exitCode = dispatch(argv);
}
