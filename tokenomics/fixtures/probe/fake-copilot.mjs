#!/usr/bin/env node
// fake-copilot.mjs — a stand-in for the `copilot` CLI in the `doctor --probe` tests (Plan 5 Task 10). Not shipped.
// Same contract as fake-claude.mjs, for the Copilot CLI wiring: it reads .github/hooks/tokenomics.json, runs each
// command's `bash` form through `sh -c` with the inherited environment plus the entry's own `env`, feeds the
// camelCase payload, and writes the session's events.jsonl (session.start … session.shutdown) where the sweep reads
// it. FAKE_PROBE_MODE as in fake-claude.mjs (session-end events here: agentStop, sessionEnd), plus repeat-start (the
// session starts again instead of ending: sessionStart fires twice, sessionEnd never — Codex B3-04). The payloads carry
// no event name, as the CLI's do (the event is the config key); FAKE_PROBE_NO_SESSION_ID=1 drops `sessionId` too.
// The user-level file (<COPILOT_HOME|~/.copilot>/hooks/tokenomics.json, --user-hooks) is read as well, as the CLI does.
// late-shutdown: the order CLI 1.0.96 was seen to use — the sessionEnd hooks run, THEN the session's final
// usage_checkpoint and session.shutdown are written.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODE, breakStore, declareScope, hang, hangChild, logInvocation, refuseIfAsked, relOf, runHook } from './fake-claude.mjs';

async function main() {
  logInvocation();
  refuseIfAsked('copilot');
  const repo = process.cwd();
  let hooks = {};
  try { hooks = JSON.parse(readFileSync(join(repo, '.github', 'hooks', 'tokenomics.json'), 'utf8')).hooks ?? {}; } catch { /* nothing wired */ }
  const userFile = join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'hooks', 'tokenomics.json');
  let user = {};
  try { user = JSON.parse(readFileSync(userFile, 'utf8')).hooks ?? {}; } catch { /* no user-level wiring */ }
  for (const [event, list] of Object.entries(user)) hooks[event] = [...(hooks[event] ?? []), ...(Array.isArray(list) ? list : [])];
  const session = randomUUID();
  const fire = (event, extra = {}) => {
    for (const cmd of hooks[event] ?? []) {
      if (cmd?.type !== 'command' || !cmd.bash) continue;
      runHook(cmd.bash, { cwd: repo, env: { ...env, ...(cmd.env ?? {}) }, timeoutSec: cmd.timeoutSec ?? 60,
        payload: { ...(process.env.FAKE_PROBE_NO_SESSION_ID ? {} : { sessionId: session }), cwd: repo, timestamp: Date.now(), ...extra } });
    }
  };
  // the copy the model runs work-scope from: the one a repo-level command names, else (user-level wiring) the installed one
  const rel = Object.values(hooks).flat().map((c) => relOf(c?.bash ?? '')).find(Boolean)
    ?? ['.github/skills/tokenomics', '.claude/skills/tokenomics'].find((r) => existsSync(join(repo, r, 'scripts', 'work-scope.mjs')));
  const env = { ...process.env, COPILOT_CLI: '1' };

  const t0 = new Date();
  const prompt = process.argv[process.argv.indexOf('-p') + 1] ?? '';
  fire('sessionStart', { source: 'new', initialPrompt: prompt });
  if (MODE === 'hang') { hangChild(); await hang(); }
  if (!process.env.FAKE_PROBE_NO_SCOPE) declareScope({ repo, rel, env, session, host: 'copilot' });
  fire('subagentStart', { agentName: 'probe' });
  const at = (s) => new Date(t0.getTime() + s * 1000).toISOString();
  const dir = join(env.TOKENOMICS_COPILOT_ROOT || join(homedir(), '.copilot', 'session-state'), session);
  mkdirSync(dir, { recursive: true });
  const shutdown = { type: 'session.shutdown', timestamp: at(5), data: { totalNanoAiu: 1000000, modelMetrics: { 'gpt-5-mini': { usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } } } };
  writeFileSync(join(dir, 'events.jsonl'), `${[
    { type: 'session.start', timestamp: at(0), data: { context: { cwd: repo, branch: 'main' } } },
    { type: 'user.message', timestamp: at(1), data: { content: prompt } },
    { type: 'subagent.started', timestamp: at(2), agentId: 'tc1', data: { toolCallId: 'tc1', agentName: 'probe' } },
    { type: 'subagent.completed', timestamp: at(3), agentId: 'tc1', data: { toolCallId: 'tc1', agentName: 'probe', totalTokens: 50, totalToolCalls: 0, durationMs: 1000 } },
    { type: 'assistant.message', timestamp: at(4), data: {} },
    ...(MODE === 'late-shutdown' ? [] : [shutdown]),
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);
  fire('subagentStop', { agentName: 'probe' });
  if (MODE !== 'no-session-end') {
    fire('agentStop', { stopHookActive: false });
    if (MODE === 'crash-end') breakStore(repo, env);
    if (MODE === 'repeat-start') fire('sessionStart', { source: 'resume' });
    else fire('sessionEnd', { reason: 'complete' });
  }
  if (MODE === 'late-shutdown') appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'session.usage_checkpoint', timestamp: at(5) })}\n${JSON.stringify(shutdown)}\n`);
  process.stdout.write('done\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (e) => { process.stderr.write(`fake-copilot: ${e?.stack ?? e}\n`); process.exit(3); });
}
