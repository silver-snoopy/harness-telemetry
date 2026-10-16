// Copilot CLI user-level hook wiring (`install-hooks.mjs --host copilot-cli --user-hooks`). Copilot CLI loads every
// `<COPILOT_HOME|~/.copilot>/hooks/*.json` in every session; this module owns `hooks/tokenomics.json` there and the
// dispatcher beside it (`hooks/tokenomics/dispatch.mjs`, a copy of hooks/copilot-user-hook.mjs), which resolves the
// session's repository and its installed copy at run time. The repository-level `.github/hooks/tokenomics.json` is
// then not written: one wiring per machine, never two that would both capture. The file holds only the documented
// keys (`version`, `hooks`); it is ours by its name and by commands that name the dispatcher. STDLIB ONLY.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const copilotHome = (env = process.env) => env.COPILOT_HOME || join(homedir(), '.copilot');
export const userHooksFile = (env = process.env) => join(copilotHome(env), 'hooks', 'tokenomics.json');
export const dispatchPath = (env = process.env) => join(copilotHome(env), 'hooks', 'tokenomics', 'dispatch.mjs');

// The same events and commands as the repository-level file (installCopilot), routed through the dispatcher. The Stop
// gate entry is always present: the dispatcher runs it only where the repository's enforcement.stopGate is "on".
const EVENTS = [
  ['sessionStart', 'telemetry-capture', '--sweep'],
  ['sessionStart', 'scope-hook', '--announce --json'],
  ['sessionEnd', 'telemetry-capture', '--sweep'],
  ['subagentStart', 'scope-hook', '--mark-dispatch'],
  ['subagentStop', 'telemetry-capture', '--dispatch'],
  ['agentStop', 'scope-hook', '--gate'],
];

const USER_COMMAND_RE = /dispatch\.mjs"\s+(telemetry-capture|scope-hook)((?:\s+\S+)*)\s*$/;

/** Write (or with `remove`, delete) the user-level wiring; returns the paths touched. `skillRoot` is the copy whose
 * dispatcher is installed. Idempotent: an unchanged file is not rewritten. */
export function installUserHooks({ skillRoot, env = process.env, remove = false } = {}) {
  const file = userHooksFile(env);
  const disp = dispatchPath(env);
  if (remove) {
    const gone = [file, disp].filter((p) => existsSync(p));
    for (const p of gone) rmSync(p, { force: true });
    return gone;
  }
  const touched = [];
  mkdirSync(dirname(disp), { recursive: true });
  const src = join(skillRoot, 'hooks', 'copilot-user-hook.mjs');
  const want = readFileSync(src);
  if (!existsSync(disp) || !readFileSync(disp).equals(want)) { copyFileSync(src, disp); touched.push(disp); }
  const cmd = (event, script, args) => ({
    type: 'command',
    bash: `node "${disp}" ${script} ${args}`,
    powershell: `& node "${disp}" ${script} ${args}`,
    env: { COPILOT_CLI: '1', TOKENOMICS_HOOK_EVENT: event },
    timeoutSec: script === 'telemetry-capture' ? 120 : 10,
  });
  const hooks = {};
  for (const [event, script, args] of EVENTS) (hooks[event] ??= []).push(cmd(event, script, args));
  const body = `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`;
  let old = null;
  try { old = readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (old !== body) { writeFileSync(file, body); touched.push(file); }
  return touched;
}

/** The user-level wiring as `[{event, script, args}]`, or null when this machine has none. */
export function readUserHooks(env = process.env) {
  let doc;
  try { doc = JSON.parse(readFileSync(userHooksFile(env), 'utf8')); } catch { return null; }
  const hooks = doc && typeof doc.hooks === 'object' && doc.hooks ? doc.hooks : null;
  if (!hooks) return null;
  const out = [];
  for (const [event, cmds] of Object.entries(hooks)) {
    for (const c of Array.isArray(cmds) ? cmds : []) {
      const m = USER_COMMAND_RE.exec(typeof c?.bash === 'string' ? c.bash : '');
      if (m) out.push({ event, script: m[1], args: m[2].trim() ? m[2].trim().split(/\s+/) : [] });
    }
  }
  return out.length ? out : null;
}
