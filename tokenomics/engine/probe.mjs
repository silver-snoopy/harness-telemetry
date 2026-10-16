// probe.mjs — `doctor --probe` (Plan 5 Task 10, D-PROBE, spec §14.9): one isolated probe session per host CLI, the
// evidence that each wired hook FIRED kept apart from the session's EXPECTED RESULT (its ledger line and scope stamp),
// so a hook that fires and then crashes reads `fired` + `missing`, never success.
//
// Transport (D-PROBE):
//   TOKENOMICS_PROBE=<32-hex nonce>   every hook entry, before any other work (and before the activation gate, so an
//                                     inert hook still proves it fired), appends {event, entry, host, session, at} to
//                                     $TOKENOMICS_STATE_DIR/probe/<nonce>.jsonl (`recordFired`). `event` is the HOST's
//                                     event name from the hook payload (Claude's `hook_event_name`), else from the
//                                     wired command's env (Copilot: TOKENOMICS_HOOK_EVENT, R25), else null;
//                                     `entry` is the entry and mode that ran (`telemetry-capture --sweep`); `session`
//                                     is the payload's session id, or null (R21, R22; Codex B3-03, B3-04).
//   Attribution (R21): a named record proves the event it names. An unnamed record proves an event only through an
//   entry no other wired event runs; an entry two events share (Copilot's sessionStart and sessionEnd both sweep)
//   leaves the event `unattributed` — never `fired` by counting records.
//   Identity (R22): the expected result (ledger line, scope stamp) is the line of the probe session itself — its id
//   taken from the fired records, or, when no payload carried one, from the host transcript whose first prompt carries
//   the nonce. Host and time are never enough. The scope stamp is that line's scope with intent `probe`.
//   A later ordinary sweep never captures the probe session: the capture skips a session whose first prompt matches
//   PROBE_PROMPT_RE unless TOKENOMICS_PROBE is set (final review I3, R17).
//   TOKENOMICS_STATE_DIR=<temp dir>   the telemetry directory (ledger, scopes, markers) resolves under it
//                                     (config.mjs telemetryDir), so a probe never touches the repo's store.
//   TOKENOMICS_NO_SYNC=1, TOKENOMICS_NO_CCUSAGE=1 (and TOKENOMICS_NO_SINK=1: no OTel sink is started for a probe).
//   Host commands: `claude -p <prompt> --model haiku`, `copilot -p <prompt>`; the binaries are overridable through
//   TOKENOMICS_PROBE_CLAUDE_BIN / TOKENOMICS_PROBE_COPILOT_BIN (tests; a .mjs/.js override runs under this node).
//   Bound: 120 s by default; the child's process group is killed at the bound.
// A probe never triggers another probe: `runProbe` refuses while TOKENOMICS_PROBE is set. STDLIB ONLY.
import { accessSync, appendFileSync, chmodSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { activationState, explain } from './activation.mjs';
import { TA_DEFAULTS, loadSettings } from './config.mjs';
import { hostFromEnv } from './scopes.mjs';
import { readUserHooks } from './copilot-user-hooks.mjs';
import { resolveCopy } from '../hooks/copilot-user-hook.mjs';

export const NONCE_RE = /^[0-9a-f]{32}$/;
/** The probe session's first prompt (`probePrompt`): the capture skips such a session outside a probe (R17). */
export const PROBE_PROMPT_RE = /^tokenomics hook probe [0-9a-f]{32}(?![0-9a-f])/;
export const UNATTRIBUTED = 'unattributed';
export const RECURSION_MESSAGE = 'a probe never triggers another probe';
export const VSCODE_UNAVAILABLE = 'no hooks; verify with a real sidebar session and a sweep (C2)';
export const DEFAULT_TIMEOUT_MS = 120000;
export const CHEAP_MODEL = 'haiku';
export const PARTIAL = 'sweep-only (partial)';
export const PROBE_HOSTS = Object.freeze(['claude', 'copilot-cli', 'vscode']);

const MODES = ['--announce', '--mark-dispatch', '--gate', '--dispatch', '--sweep'];
const ALIASES = { copilot: 'copilot-cli' };
const CLI = {
  claude: { name: 'claude', override: 'TOKENOMICS_PROBE_CLAUDE_BIN', ledgerHost: 'claude', args: (prompt) => ['-p', prompt, '--model', CHEAP_MODEL] },
  // shell(node) approves exactly the one command the prompt asks for (work-scope.mjs open): `-p` denies shell tools
  // unless they are allowed, and without it the scope stamp could never be written.
  'copilot-cli': { name: 'copilot', override: 'TOKENOMICS_PROBE_COPILOT_BIN', ledgerHost: 'copilot', args: (prompt) => ['-p', prompt, '--allow-tool', 'shell(node)'] },
};
// The events that end a session (or a turn) on each host: when none of the wired ones fired, the git fallback decides
// between `not-fired` and `sweep-only (partial)`.
const SESSION_END = { claude: ['SessionEnd', 'Stop'], 'copilot-cli': ['sessionEnd', 'agentStop'] };
const AUTH_RE = /not logged in|log ?in required|please (?:run )?\/?log ?in|unauthori[sz]ed|authentication (?:failed|required|error)|failed to authenticate|invalid api key|(?:missing|invalid|expired) credentials?/i;
const TRUST_RE = /not trusted|untrusted|trust (?:this|the) (?:folder|directory|workspace)/i;
const SETTLE_MS = 300;
const SETTLE_CAP_MS = 3000;
const MIN_SWEEP_MS = 500;
// A session-end hook may capture after the host exits (the Copilot user-level dispatcher sweeps once the session has
// shut down, which the host writes after the hook): the expected result is re-read for up to this long.
const LATE_CAPTURE_MS = 15000;
const LATE_POLL_MS = 500;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const normalizeHost = (h) => ALIASES[h] ?? h;

/** The fired-record key of a hook entry: its script and the one mode flag it ran with. */
export function entryKey(script, argv = []) {
  const mode = MODES.find((m) => argv.includes(m));
  return mode ? `${script} ${mode}` : script;
}

/** True while a probe runs this hook: a well-formed nonce and a state dir. */
export const probing = (env = process.env) => !!env.TOKENOMICS_PROBE && !!env.TOKENOMICS_STATE_DIR && NONCE_RE.test(env.TOKENOMICS_PROBE);

const str = (v) => (typeof v === 'string' && v ? v : null);
/**
 * The host's own event name: the hook payload's (Claude: `hook_event_name`), else the one the wired command names in
 * its env (Copilot: `TOKENOMICS_HOOK_EVENT`, written by installCopilot — R25), else null. Never inferred.
 */
export const hookEventOf = (payload, env = {}) => (isObj(payload) ? str(payload.hook_event_name) ?? str(payload.hookEventName) : null)
  ?? str(env.TOKENOMICS_HOOK_EVENT);
/** The host session id in a hook payload, else null. */
export const hookSessionOf = (payload) => (isObj(payload) ? str(payload.session_id) ?? str(payload.sessionId) : null);

/**
 * The fired record (D-PROBE): only with a well-formed nonce and a state dir; never throws, never fails the hook.
 * `payload` is the hook's parsed stdin (null when there is none): it names the event and the session (R21, R22).
 */
export function recordFired(script, argv = process.argv.slice(2), env = process.env, payload = null) {
  if (!probing(env)) return false;
  try {
    const dir = join(env.TOKENOMICS_STATE_DIR, 'probe');
    mkdirSync(dir, { recursive: true });
    const rec = { event: hookEventOf(payload, env), entry: entryKey(script, argv), host: hostFromEnv(env), session: hookSessionOf(payload), at: new Date().toISOString() };
    appendFileSync(join(dir, `${env.TOKENOMICS_PROBE}.jsonl`), `${JSON.stringify(rec)}\n`);
    return true;
  } catch { return false; }
}

/**
 * The hook's stdin, read once and bounded (a host can leave hook stdin open): resolves to the text read, '' when there
 * is none. Only a probe run reads stdin this early (telemetry-capture), so a plain run's stdin handling is unchanged.
 */
export function readStdinBounded(ms = 2000, stdin = process.stdin) {
  return new Promise((resolveP) => {
    let buf = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { stdin.pause(); stdin.removeAllListeners('data'); } catch { /* fine */ }
      resolveP(buf);
    };
    const timer = setTimeout(finish, ms);
    try {
      if (stdin.isTTY) { finish(); return; }
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => {
        buf += d;
        try { JSON.parse(buf); finish(); } catch { /* incomplete — keep reading */ }
      });
      stdin.on('end', finish);
      stdin.on('error', finish);
    } catch { finish(); }
  });
}

const COMMAND_RE = /"(?:\$\{CLAUDE_PROJECT_DIR\}\/|\.\/)?([^"]*?)\/hooks\/(telemetry-capture|scope-hook)\.mjs"((?:\s+\S+)*)/;
function parseCommand(cmd) {
  const m = COMMAND_RE.exec(typeof cmd === 'string' ? cmd : '');
  return m ? { rel: m[1], key: entryKey(m[2], m[3].trim().split(/\s+/)) } : null;
}

/** The host's wired events, in wiring order, each with the entry keys its commands run, and the copies they name. */
export function wiredEvents(repo, host, marker) {
  const events = new Map();
  const rels = new Set();
  const add = (event, cmd) => {
    const p = parseCommand(cmd);
    if (!p) return;
    rels.add(p.rel);
    if (!events.has(event)) events.set(event, []);
    events.get(event).push(p.key);
  };
  if (host === 'claude') {
    for (const f of ['settings.json', 'settings.local.json']) {
      const hooks = readJson(join(repo, '.claude', f))?.hooks;
      if (!isObj(hooks)) continue;
      for (const [event, entries] of Object.entries(hooks)) {
        for (const e of Array.isArray(entries) ? entries : []) if (e?.[marker]) for (const h of e.hooks ?? []) add(event, h?.command);
      }
    }
  } else if (host === 'copilot-cli') {
    const hooks = readJson(join(repo, '.github', 'hooks', 'tokenomics.json'))?.hooks;
    if (isObj(hooks)) for (const [event, cmds] of Object.entries(hooks)) for (const c of Array.isArray(cmds) ? cmds : []) add(event, c?.bash);
    else {
      // The user-level wiring (--user-hooks): the dispatcher runs the copy it resolves for this repository, and runs
      // the Stop gate only where enforcement.stopGate is "on", so an off gate is not a wired event here.
      const hit = resolveCopy(repo);
      const gateOn = readJson(join(repo, '.agents', 'tokenomics', 'settings.json'))?.enforcement?.stopGate === 'on';
      for (const u of readUserHooks() ?? []) {
        if (u.event === 'agentStop' && !gateOn) continue;
        if (hit) rels.add(relative(repo, hit.copy));
        if (!events.has(u.event)) events.set(u.event, []);
        events.get(u.event).push(entryKey(u.script, u.args));
      }
    }
  }
  return { events: [...events].map(([event, keys]) => ({ event, keys })), rels: [...rels] };
}

/**
 * Which wired events fired, from the fired records (R21). A record that names its event proves that event, when it
 * ran one of the event's entries. A record the host did not name proves an event only through an entry no other wired
 * event runs; an entry several events share leaves each of them, unless otherwise proven, `unattributed`. Records are
 * never counted out to events: two unnamed sweeps are not a sessionStart and a sessionEnd (Codex B3-04).
 */
export function firedEvents(wired, records) {
  const named = new Set();
  const unnamed = new Set();
  for (const r of records) {
    if (!isObj(r) || typeof r.entry !== 'string') continue;
    if (str(r.event)) named.add(`${r.event}\u0000${r.entry}`);
    else unnamed.add(r.entry);
  }
  const users = new Map();
  for (const { keys } of wired) for (const k of new Set(keys)) users.set(k, (users.get(k) ?? 0) + 1);
  const state = ({ event, keys }) => {
    if (keys.some((k) => named.has(`${event}\u0000${k}`))) return 'fired';
    if (keys.some((k) => users.get(k) === 1 && unnamed.has(k))) return 'fired';
    return keys.some((k) => unnamed.has(k)) ? UNATTRIBUTED : 'not-fired';
  };
  return Object.fromEntries(wired.map((w) => [w.event, state(w)]));
}

/** The probe session's ids, from the fired records' payload session ids (R22). */
export const recordSessions = (records) => new Set(records.map((r) => (isObj(r) ? str(r.session) : null)).filter(Boolean));

const runnable = (p, script) => {
  try {
    if (!statSync(p).isFile()) return false;
    if (script && /\.[cm]?js$/.test(p)) return true;
    accessSync(p, constants.X_OK);
    return true;
  } catch { return false; }
};

/** The host CLI: the override variable when set (it must exist), else the first executable on PATH. */
export function findCli(host, env = process.env) {
  const c = CLI[host];
  const override = env[c.override];
  if (override) return runnable(override, true) ? override : null;
  const exts = process.platform === 'win32' ? String(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) { const p = join(dir, `${c.name}${ext}`); if (runnable(p, false)) return p; }
  }
  return null;
}

/** The probe session's prompt: declare the scope (so the stamp can be checked) and dispatch exactly one sub-agent. */
export function probePrompt(nonce, rel, host) {
  const scopeHost = CLI[host].ledgerHost;
  return `tokenomics hook probe ${nonce}. This is an automated check that this repository's hooks fire; do only this, then stop. `
    + `1) Declare this session's work scope: run \`node ${rel}/scripts/work-scope.mjs open --session <this session's id, from the tokenomics line in your context> --host ${scopeHost} --intent probe\`. `
    + '2) Dispatch exactly one sub-agent whose only task is to reply "ok". 3) Reply "done".';
}

const killGroup = (child) => {
  try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
};

/** Run the host CLI in its own process group, killed at the bound. Resolves on exit; the group stays for `settle`. */
function runBounded(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((resolveRun) => {
    const script = /\.[cm]?js$/.test(cmd);
    let child;
    try {
      child = spawn(script ? process.execPath : cmd, script ? [cmd, ...args] : args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (error) { resolveRun({ code: null, timedOut: false, stdout: '', stderr: '', error, child: null }); return; }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    const keep = (s, d) => (s.length < 65536 ? s + d : s);
    child.stdout.on('data', (d) => { stdout = keep(stdout, d); });
    child.stderr.on('data', (d) => { stderr = keep(stderr, d); });
    const finish = (code, error = null) => { if (done) return; done = true; clearTimeout(timer); resolveRun({ code, timedOut, stdout, stderr, error, child }); };
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, timeoutMs);
    child.on('error', (e) => finish(null, e));
    child.on('exit', (code) => setTimeout(() => finish(code), 20));
  });
}

const sizeOf = (p) => { try { return statSync(p).size; } catch { return -1; } };
/** Wait for the hooks the host left running (async hooks) until the fired log is quiet, bounded by `until`. */
async function settle(log, until) {
  let last = sizeOf(log);
  let quietSince = Date.now();
  while (Date.now() < until) {
    await sleep(100);
    const n = sizeOf(log);
    if (n !== last) { last = n; quietSince = Date.now(); } else if (Date.now() - quietSince >= SETTLE_MS) return;
  }
}

const readLines = (p) => {
  try { return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
};

/** The host's ledger lines in the state dir (every session the probe's sweeps captured, the probe's among them). */
function hostLines(dir, ledgerHost) {
  let files = [];
  try { files = readdirSync(dir).filter((f) => /^usage-.*\.jsonl$/.test(f)); } catch { return []; }
  return files.flatMap((f) => readLines(join(dir, f))).filter((l) => l.host === ledgerHost && str(l.id));
}

/**
 * The probe session's ids when no payload carried one (R22): of the sessions captured into the state dir, those whose
 * host transcript opens with this probe's prompt (`tokenomics hook probe <nonce>`).
 */
async function nonceSessions(repo, host, nonce, lines, env) {
  const cap = await import('../hooks/telemetry-capture.mjs');
  const prefix = `tokenomics hook probe ${nonce}`;
  const ids = new Set();
  for (const id of new Set(lines.map((l) => l.id))) {
    const paths = host === 'claude'
      ? cap.claudeProjectDirs(repo, env).map((d) => join(d, `${id}.jsonl`))
      : cap.copilotRoots(repo, env).map((r) => join(r, id, 'events.jsonl'));
    if (paths.some((p) => (cap.firstPromptOf(host === 'claude' ? 'claude' : 'copilot', p) ?? '').startsWith(prefix))) ids.add(id);
  }
  return ids;
}

function removeState(dir) {
  const unlock = (d) => {
    try { chmodSync(d, 0o755); } catch { return; }
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) if (e.isDirectory()) unlock(join(d, e.name));
  };
  unlock(dir);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort: a temp dir */ }
}

const settingsDir = (repo, env) => {
  try { return loadSettings(repo, env).dir; } catch { /* inert/refused/invalid: the probe still runs and reports it */ }
  const raw = readJson(join(repo, '.agents', 'tokenomics', 'settings.json'));
  return typeof raw?.dir === 'string' && raw.dir ? raw.dir : TA_DEFAULTS.dir;
};

const MISSING = Object.freeze({ ledgerLine: 'missing', scopeStamp: 'missing' });
const unavailable = (host, reason, extra = {}) => ({ host, result: 'unavailable', reason, events: {}, expected: { ...MISSING }, mode: 'hooks', ...extra });

/**
 * One probe session for `host` in `repo` (D-PROBE). Returns
 * `{host, result: 'fired'|'not-fired'|'unavailable', reason?, events: {[event]: 'fired'|'not-fired'},
 *   expected: {ledgerLine, scopeStamp: 'present'|'missing'}, mode: 'hooks'|'sweep-only (partial)', durationMs?, stateDir?}`.
 * `result` is `fired` only when every wired event fired AND the expected result is present.
 */
export async function runProbe(repo, { host, timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env, keepState = false } = {}) {
  if (env.TOKENOMICS_PROBE) throw new Error(`tokenomics: ${RECURSION_MESSAGE} (TOKENOMICS_PROBE is set)`);
  host = normalizeHost(host);
  if (host === 'vscode') return unavailable(host, VSCODE_UNAVAILABLE);
  if (!CLI[host]) throw new Error(`tokenomics: unknown probe host '${host}' (one of ${PROBE_HOSTS.join(', ')})`);
  const { MARKER, GIT_MARKER, gitHooksDir } = await import('../scripts/install-hooks.mjs');
  const wired = wiredEvents(repo, host, MARKER);
  if (!wired.events.length) {
    return { host, result: 'not-fired', reason: `no ${host} hooks are wired (run install-hooks.mjs --host ${host})`, events: {}, expected: { ...MISSING }, mode: 'hooks' };
  }
  const cli = findCli(host, env);
  if (!cli) return unavailable(host, `${CLI[host].name} CLI not found`);

  const nonce = randomBytes(16).toString('hex');
  const state = mkdtempSync(join(tmpdir(), 'tokenomics-probe-'));
  const started = Date.now();
  let run = null;
  try {
    // Seed the state store with the repo's module manifest and capture config (read, never written), so the probe
    // session is stamped and configured as a real one would be.
    const dir = settingsDir(repo, env);
    const repoTel = join(repo, '.agents', 'telemetry', dir);
    const stateTel = join(state, 'telemetry', dir);
    mkdirSync(stateTel, { recursive: true });
    for (const f of ['module.json', 'config.json', 'manifests']) {
      if (existsSync(join(repoTel, f))) try { cpSync(join(repoTel, f), join(stateTel, f), { recursive: true }); } catch { /* unreadable: run without it */ }
    }
    const probeEnv = { ...env, TOKENOMICS_PROBE: nonce, TOKENOMICS_STATE_DIR: state, TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SINK: '1' };
    const rel = wired.rels[0];
    run = await runBounded(cli, CLI[host].args(probePrompt(nonce, rel, host)), { cwd: repo, env: probeEnv, timeoutMs });
    const log = join(state, 'probe', `${nonce}.jsonl`);
    if (!run.timedOut && run.child) await settle(log, Math.min(started + timeoutMs, Date.now() + SETTLE_CAP_MS));
    if (run.child) killGroup(run.child); // whatever the host left behind
    const durationMs = Date.now() - started;
    const keep = keepState ? { stateDir: state } : {};
    const records = readLines(log);
    const events = firedEvents(wired.events, records);
    const firedAny = Object.values(events).includes('fired');

    if (run.error) return unavailable(host, `${CLI[host].name} CLI could not be started: ${run.error.message}`, { events, durationMs, ...keep });
    if (!run.timedOut && run.code !== 0) {
      const text = `${run.stderr}\n${run.stdout}`;
      if (TRUST_RE.test(text)) return unavailable(host, 'folder not trusted', { events, durationMs, detail: firstLine(text), ...keep });
      if (AUTH_RE.test(text)) return unavailable(host, 'auth', { events, durationMs, detail: firstLine(text), ...keep });
    }

    // R22: the expected result is the probe session's own line — by id, never by host and time.
    let ids = recordSessions(records);
    let lines = [];
    const findLines = async () => {
      const all = hostLines(stateTel, CLI[host].ledgerHost);
      if (!recordSessions(records).size) ids = await nonceSessions(repo, host, nonce, all, probeEnv);
      lines = all.filter((l) => ids.has(l.id));
    };
    await findLines();
    const endFired = (SESSION_END[host] ?? []).some((e) => events[e] === 'fired');
    if (!lines.length && endFired && !run.timedOut) {
      const late = Number(env.TOKENOMICS_PROBE_LATE_MS) >= 0 && env.TOKENOMICS_PROBE_LATE_MS !== undefined ? Number(env.TOKENOMICS_PROBE_LATE_MS) : LATE_CAPTURE_MS;
      const until = Math.min(started + timeoutMs, Date.now() + late);
      while (!lines.length && Date.now() < until) { await new Promise((r) => setTimeout(r, LATE_POLL_MS)); await findLines(); }
    }
    const expected = () => ({ ledgerLine: lines.length ? 'present' : 'missing', scopeStamp: lines.some((l) => isObj(l.scope) && l.scope.intent === 'probe') ? 'present' : 'missing' });
    const engineRoot = join(repo, rel);
    const st = activationState(engineRoot, repo, env);
    const inert = st.state === 'source' || st.state === 'active' ? null : explain(st, engineRoot, repo);
    const allFired = Object.values(events).every((v) => v === 'fired');
    let exp = expected();
    if (allFired && exp.ledgerLine === 'present' && exp.scopeStamp === 'present' && !inert && !run.timedOut) {
      return { host, result: 'fired', events, expected: exp, mode: 'hooks', durationMs, ...keep };
    }

    const reasons = [];
    if (run.timedOut) reasons.push(`timed out after ${timeoutMs / 1000} s (the ${CLI[host].name} process group was killed)`);
    else if (run.code !== 0) reasons.push(`${CLI[host].name} exited ${run.code}${firstLine(run.stderr) ? `: ${firstLine(run.stderr)}` : ''}`);
    if (inert) reasons.push(`${firedAny ? 'hooks fired but ' : ''}the wired engine is inert — ${inert}`);
    const notFired = Object.entries(events).filter(([, v]) => v === 'not-fired').map(([e]) => e);
    if (notFired.length) reasons.push(`not fired: ${notFired.join(', ')}`);
    const unattributed = Object.entries(events).filter(([, v]) => v === UNATTRIBUTED).map(([e]) => e);
    if (unattributed.length) reasons.push(`unattributed: ${unattributed.join(', ')} (the host does not name its hook events, and the entry ${unattributed.length > 1 ? 'they run is' : 'it runs is'} shared with another event)`);
    if (exp.ledgerLine === 'missing') reasons.push(`the probe session's ledger line is missing${firedAny ? ' (a hook fired, then failed or wrote nothing)' : ''}`);
    else if (exp.scopeStamp === 'missing') reasons.push("the probe session's ledger line carries no scope stamp");

    // Fallback (spec §14.9): no session-end hook fired, but a git post-commit sweep is installed. The probe runs that
    // sweep itself once the session is over; if it captures the session the install is sweep-only (partial). Only a
    // session that ENDED NORMALLY qualifies (exit 0, within the bound): a timeout or a failed host is never partial,
    // and the sweep itself is bounded by what is left of --timeout.
    const ends = (SESSION_END[host] ?? []).filter((e) => e in events);
    const hooksDir = (() => { try { return gitHooksDir(repo); } catch { return null; } })();
    const gitHook = !!hooksDir && (readFileOr(join(hooksDir, 'post-commit')) ?? '').includes(GIT_MARKER);
    const endedNormally = !run.timedOut && run.code === 0;
    if (endedNormally && !inert && ends.length && ends.every((e) => events[e] === 'not-fired') && gitHook) {
      const remaining = started + timeoutMs - Date.now();
      if (remaining < MIN_SWEEP_MS) {
        reasons.push(`no time left within ${timeoutMs / 1000} s for the git post-commit sweep`);
      } else {
        // TOKENOMICS_PROBE stays set: it exempts the probe session from the capture's probe-session skip (R17). The
        // fired record this sweep appends is never read — the events were settled above.
        spawnSync(process.execPath, [join(repo, rel, 'hooks', 'telemetry-capture.mjs'), '--sweep', '--ended'],
          { cwd: repo, env: { ...probeEnv, CLAUDE_PROJECT_DIR: repo }, stdio: 'ignore', timeout: remaining, killSignal: 'SIGKILL' });
        await findLines();
        exp = expected();
        if (exp.ledgerLine === 'present') {
          // Partial hides nothing: the other events that did not fire and a missing scope stamp are named alongside.
          const others = notFired.filter((e) => !ends.includes(e));
          const reason = [
            `session-end hooks did not fire (${ends.join(', ')}); the git post-commit sweep captured the session — capture is eventual, not proof of hook execution`,
            ...(others.length ? [`also not fired: ${others.join(', ')}`] : []),
            ...(exp.scopeStamp === 'missing' ? ["the probe session's ledger line carries no scope stamp"] : []),
          ].join('; ');
          return { host, result: 'not-fired', mode: PARTIAL, reason, events, expected: exp, durationMs: Date.now() - started, ...keep };
        }
        reasons.push('the git post-commit sweep did not capture it either');
      }
    }
    return { host, result: 'not-fired', reason: reasons.join('; ') || 'the expected result is missing', events, expected: exp, mode: 'hooks', durationMs, ...keep };
  } finally {
    if (run?.child) killGroup(run.child);
    if (!keepState) removeState(state);
  }
}

function readFileOr(p) { try { return readFileSync(p, 'utf8'); } catch { return null; } }
function firstLine(s) { return String(s ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? ''; }
