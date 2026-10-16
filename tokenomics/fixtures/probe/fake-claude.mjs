#!/usr/bin/env node
// fake-claude.mjs — a stand-in for the `claude` CLI in the `doctor --probe` tests (Plan 5 Task 10; owner decision
// 2026-10-14: automated tests never run a real host). It is NOT shipped (fixtures/** is outside the baseline).
//
// It behaves as the host does for a probe session: it reads the repo's WIRED hook config (.claude/settings.json and
// settings.local.json), runs each hook command through `sh -c` with the environment it was started with (so the
// probe's TOKENOMICS_* variables reach the hooks exactly as a real host passes its own environment on), feeds each
// the host's stdin payload, and plays the model's part: declare the scope with work-scope, dispatch one sub-agent,
// write the session transcript where the sweep looks for it. FAKE_PROBE_MODE picks a failure:
//   (FAKE_PROBE_NO_SCOPE=1: the model never declares a scope.)
//   ok (default) · auth (exit 1, "not logged in") · trust (exit 1, folder not trusted) · hang (never returns after
//   SessionStart) · crash-end (the session-end capture crashes: the store is unwritable) · no-session-end (Stop and
//   SessionEnd never fire) · unrelated (the probe session's transcript is never written; another, already-ended session
//   with a declared scope is, so only identity can tell the two apart — Codex B3-03) · unrelated-no-end (both).
//   (FAKE_PROBE_NO_SESSION_ID=1: the hook payloads carry no session id, so the probe must find its session by the
//   nonce in the first prompt.)
// Every payload carries `hook_event_name` and `session_id`, as the real host's does.
// FAKE_PROBE_LOG, when set, receives one JSON line per invocation ({argv, cwd, pid}).
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODE = process.env.FAKE_PROBE_MODE || 'ok';
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function logInvocation() {
  if (process.env.FAKE_PROBE_LOG) appendFileSync(process.env.FAKE_PROBE_LOG, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid })}\n`);
}

/** The host's refusals, before any hook runs. Returns true when the fake exited. */
export function refuseIfAsked(name) {
  if (MODE === 'auth') { process.stderr.write(`Error: not logged in. Run \`${name} login\` first.\n`); process.exit(1); }
  if (MODE === 'trust') { process.stderr.write('Error: this folder is not trusted. Trust it interactively first.\n'); process.exit(1); }
}

/** Run one wired command as the host does: a shell, the inherited environment, the payload on stdin. */
export function runHook(command, { cwd, env, payload, timeoutSec = 60 }) {
  return spawnSync('/bin/sh', ['-c', command], { cwd, env, input: JSON.stringify(payload), encoding: 'utf8', timeout: timeoutSec * 1000 });
}

/** The skill copy a wired command names (`…/<rel>/hooks/<script>.mjs`), relative to the repo. */
export function relOf(command) {
  const m = /"(?:\$\{CLAUDE_PROJECT_DIR\}\/|\.\/)?([^"]+?)\/hooks\/[a-z-]+\.mjs"/.exec(command);
  return m ? m[1] : null;
}

/** The model's part: declare the session's scope through the wired copy's work-scope, as the probe prompt asks. */
export function declareScope({ repo, rel, env, session, host }) {
  if (!rel) return;
  spawnSync(process.execPath, [join(repo, rel, 'scripts', 'work-scope.mjs'), 'open', '--session', session, '--host', host, '--intent', 'probe'],
    { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
}

/** crash-end: make the store unwritable so the session-end capture throws after its fired record. */
export function breakStore(repo, env) {
  if (!env.TOKENOMICS_STATE_DIR) return;
  const dir = readJson(join(repo, '.agents', 'tokenomics', 'settings.json'))?.dir ?? 'automation';
  const tel = join(env.TOKENOMICS_STATE_DIR, 'telemetry', dir);
  mkdirSync(tel, { recursive: true });
  chmodSync(tel, 0o555);
}

/** hang: a grandchild in the host's process group that never exits on its own (the probe must kill the group). */
export function hangChild() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' });
  if (process.env.FAKE_PROBE_LOG) appendFileSync(process.env.FAKE_PROBE_LOG, `${JSON.stringify({ grandchild: child.pid })}\n`);
}

export const hang = () => { setInterval(() => {}, 1 << 30); return new Promise(() => {}); };

function wiredHooks(repo) {
  const out = {};
  for (const f of ['settings.json', 'settings.local.json']) {
    const hooks = readJson(join(repo, '.claude', f))?.hooks ?? {};
    for (const [event, entries] of Object.entries(hooks)) out[event] = [...(out[event] ?? []), ...(Array.isArray(entries) ? entries : [])];
  }
  return out;
}

const matches = (matcher, value) => !matcher || matcher === '*' || new RegExp(`^(?:${matcher})$`).test(value);

async function main() {
  logInvocation();
  refuseIfAsked('claude');
  const repo = process.cwd();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo };
  const hooks = wiredHooks(repo);
  const session = randomUUID();
  const projDir = env.TOKENOMICS_CLAUDE_ROOT || join(homedir(), '.claude', 'projects', repo.replace(/[/\\:._ ]/g, '-'));
  const transcript = join(projDir, `${session}.jsonl`);
  const fire = (event, match, extra = {}) => {
    for (const entry of hooks[event] ?? []) {
      if (!matches(entry?.matcher, match)) continue;
      for (const h of entry.hooks ?? []) {
        if (h?.type !== 'command') continue;
        runHook(h.command, { cwd: repo, env, timeoutSec: h.timeout ?? 60,
          payload: { ...(process.env.FAKE_PROBE_NO_SESSION_ID ? {} : { session_id: session }), transcript_path: transcript, cwd: repo, hook_event_name: event, ...extra } });
      }
    }
  };
  const rel = Object.values(hooks).flat().flatMap((e) => e?.hooks ?? []).map((h) => relOf(h?.command ?? '')).find(Boolean);

  const prompt = process.argv[process.argv.indexOf('-p') + 1] ?? '';
  const writeSession = (path, id, text) => {
    const t0 = new Date();
    mkdirSync(projDir, { recursive: true });
    writeFileSync(path, `${[
      { type: 'user', timestamp: t0.toISOString(), sessionId: id, message: { role: 'user', content: text } },
      { type: 'assistant', timestamp: new Date(t0.getTime() + 1000).toISOString(), sessionId: id,
        message: { id: 'm1', model: 'claude-haiku-4-5', usage: { input_tokens: 120, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [] } },
    ].map((r) => JSON.stringify(r)).join('\n')}\n`);
  };
  const writeTranscript = () => {
    if (!MODE.startsWith('unrelated')) { writeSession(transcript, session, prompt); return; }
    // unrelated: a different session of this repo, ended long ago (past the sweep's live grace), scope declared
    const other = `unrelated-${session}`;
    const path = join(projDir, `${other}.jsonl`);
    writeSession(path, other, 'unrelated work in this repository');
    utimesSync(path, new Date(0), new Date(0));
    declareScope({ repo, rel, env, session: other, host: 'claude' });
  };

  fire('SessionStart', 'startup', { source: 'startup' });
  // hang: the host writes its transcript as it goes, starts a child of its own, then never returns
  if (MODE === 'hang') { writeTranscript(); hangChild(); await hang(); }
  if (!process.env.FAKE_PROBE_NO_SCOPE) declareScope({ repo, rel, env, session, host: 'claude' });
  fire('PreToolUse', 'Agent', { tool_name: 'Agent', tool_input: { description: 'probe', prompt: 'reply ok' } });
  writeTranscript();
  fire('SubagentStop', 'general-purpose', { agent_id: 'agent-probe', stop_hook_active: false });
  if (MODE !== 'no-session-end' && MODE !== 'unrelated-no-end') {
    fire('Stop', '', { stop_hook_active: false });
    if (MODE === 'crash-end') breakStore(repo, env);
    fire('SessionEnd', 'other', { reason: 'other' });
  }
  process.stdout.write('done\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (e) => { process.stderr.write(`fake-claude: ${e?.stack ?? e}\n`); process.exit(3); });
}
