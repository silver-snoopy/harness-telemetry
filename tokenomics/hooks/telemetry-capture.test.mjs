// Tests for telemetry-capture.mjs — fixture transcripts/event streams in temp
// dirs; ccusage is never invoked (config.priceAtCapture=false throughout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync, appendFileSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseClaudeTranscript, dedupUsage, captureClaudeSession, captureCopilotSession,
  knownSessions, appendLine, ledgerPath, sweep, main, readRecords, whoAmI,
  sameCwdOrUnder, encodeProjectPath, USD_PER_CREDIT,
  parseVsCodeChatSession, captureVsCodeSession, vscodeStorageRoots, workspaceFolderOf, ensureSink,
} from './telemetry-capture.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';

// B2: the pre-existing tests pin the reference behaviour, so this file runs under TOKENOMICS_MIGRATIONS=none
// unless a test says otherwise through `under`.
process.env.TOKENOMICS_MIGRATIONS = 'none';
const under = (mig, fn) => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = mig;
  try { return fn(); } finally { process.env.TOKENOMICS_MIGRATIONS = was; }
};

const CFG = { capturePrompts: false, priceAtCapture: false, maxSweep: 10 };
const jsonl = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
const tmp = () => mkdtempSync(join(tmpdir(), 'tokenomics-test-'));

// A realistic little Claude transcript: agent-setting, a prompt, a streaming
// duplicate (same message id, growing output), a tool error, an Agent dispatch
// after a >30-min idle gap.
function claudeRecords() {
  return [
    { type: 'agent-setting', agentSetting: 'test-automation-lead' },
    { type: 'user', message: { role: 'user', content: 'automate TC-101 please' }, timestamp: '2026-07-30T10:00:00Z' },
    {
      type: 'assistant', gitBranch: 'tests/batch-x', timestamp: '2026-07-30T10:01:00Z',
      message: {
        id: 'm1', model: 'claude-sonnet-5',
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
        content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'test-automation-workflow' } }],
      },
    },
    { // streaming rewrite of m1 — output grows, everything else fixed. Max wins.
      type: 'assistant', timestamp: '2026-07-30T10:01:30Z',
      message: {
        id: 'm1', model: 'claude-sonnet-5',
        usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
        content: [],
      },
    },
    { type: 'user', timestamp: '2026-07-30T10:02:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } },
    { // 38-minute gap — excluded from active minutes, kept in wall clock
      type: 'assistant', timestamp: '2026-07-30T10:40:00Z',
      message: {
        id: 'm2', model: 'claude-sonnet-5',
        usage: { input_tokens: 200, output_tokens: 60, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
        content: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'qa-engineer', description: 'analyse TC-101' } }],
      },
    },
    { type: 'user', isSidechain: true, message: { content: '<system-reminder>noise</system-reminder>' }, timestamp: '2026-07-30T10:40:10Z' },
  ];
}

test('dedupUsage: streaming duplicates collapse to max-per-message-id', () => {
  const { tokens, models } = dedupUsage(claudeRecords());
  assert.deepEqual(tokens, { input: 300, output: 100, cacheRead: 2000, cacheWrite: 100 });
  assert.deepEqual([...models], ['claude-sonnet-5']);
});

test('parseClaudeTranscript: role, branch, turns, tools, idle-gap-capped active time', () => {
  const p = parseClaudeTranscript(claudeRecords());
  assert.equal(p.role, 'test-automation-lead');
  assert.equal(p.branch, 'tests/batch-x');
  assert.equal(p.turns, 2);
  assert.equal(p.toolCalls, 2);
  assert.equal(p.toolErrors, 1);
  assert.deepEqual([...p.skills], ['test-automation-workflow']);
  assert.equal(p.dispatched.length, 1);
  assert.equal(p.activeMin, 2);  // 60s + 30s + 30s + 10s counted; the 38-min gap dropped
  assert.equal(p.wallMin, 40);
  assert.equal(p.prompts.length, 0, 'prompts stay off unless capturePrompts');
});

test('parseClaudeTranscript: prompts opt-in captures user text truncated, skips wrappers', () => {
  const p = parseClaudeTranscript(claudeRecords(), { capturePrompts: true });
  assert.equal(p.prompts.length, 1);
  assert.equal(p.prompts[0].text, 'automate TC-101 please');
  assert.equal(p.dispatched[0].description, 'analyse TC-101');
});

function writeClaudeFixture(root, sessionId, { withSub = true } = {}) {
  mkdirSync(root, { recursive: true });
  const transcript = join(root, `${sessionId}.jsonl`);
  writeFileSync(transcript, jsonl(claudeRecords()));
  if (withSub) {
    const subDir = join(root, sessionId, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'qa-engineer', description: 'analyse' }));
    writeFileSync(join(subDir, 'agent-abc.jsonl'), jsonl([
      {
        type: 'assistant', timestamp: '2026-07-30T10:05:00Z',
        message: { id: 's1', model: 'claude-haiku-4-5', usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [] },
      },
      { type: 'assistant', timestamp: '2026-07-30T10:07:00Z', message: { id: 's2', usage: { input_tokens: 10, output_tokens: 5 }, content: [] } },
    ]));
  }
  return transcript;
}

test('captureClaudeSession: one line — parent tokens, per-dispatch sub-agent records, models merged', () => {
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-1');
  const line = captureClaudeSession(repo, transcript, 'sess-1', { config: CFG, user: 'tester' });
  assert.equal(line.host, 'claude');
  assert.equal(line.role, 'test-automation-lead');
  assert.deepEqual(line.tokens, { input: 300, output: 100, cacheRead: 2000, cacheWrite: 100 });
  assert.equal(line.subagents.length, 1);
  // One record PER DISPATCH (n:1) carrying its label — the attribution key
  // batch-cost joins receipt case ids against. No costUsd key when unpriced.
  assert.deepEqual(line.subagents[0], {
    // `id` joins this dispatch to its live-log record and its _returns receipt
    id: 'agent-abc', role: 'qa-engineer', label: 'analyse', n: 1,
    tokens: { input: 510, output: 55, cacheRead: 0, cacheWrite: 0 },
    // per-model quads ride each sub — the dataset's tokens_by_model source
    tokensByModel: { 'claude-haiku-4-5': { input: 500, output: 50, cacheRead: 0, cacheWrite: 0 } },
    activeMin: 2, toolCalls: 0, toolErrors: 0,
  });
  assert.deepEqual(line.models, ['claude-haiku-4-5', 'claude-sonnet-5']);
  assert.equal(line.activeMin, 4); // parent 2 + sub 2
  assert.equal(line.costUsd, null);
  assert.equal(line.costSource, 'none');
  assert.ok(!('prompts' in line), 'prompts key absent by default');
  assert.deepEqual(line.cases, ['TC-101'], 'case ids mined from prompt + dispatch label, ungated');
});

// A workflow dispatch has no description; its prompt opens with boilerplate and
// the case id can sit past the 160-char label window. The per-dispatch record
// must still carry the ids mined from the dispatch's own transcript (`cases`),
// or batch-cost mislabels the work as batch overhead.
test('captureClaudeSession: sub-agent record carries transcript-mined case ids', () => {
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-ids', { withSub: false });
  const subDir = join(proj, 'sess-ids', 'subagents');
  mkdirSync(subDir, { recursive: true });
  // No description in meta (workflow dispatch); prompt is sidechain-marked with
  // the id beyond where the label slice ends.
  writeFileSync(join(subDir, 'agent-wf1.meta.json'), JSON.stringify({ agentType: 'test-automation-engineer' }));
  writeFileSync(join(subDir, 'agent-wf1.jsonl'), jsonl([
    {
      type: 'user', isSidechain: true, timestamp: '2026-07-30T10:05:00Z',
      message: { role: 'user', content: `stabilize workflow. ${'x'.repeat(200)} target case TC-909 on branch tests/909` },
    },
    {
      type: 'assistant', timestamp: '2026-07-30T10:06:00Z',
      message: { id: 'w1', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] },
    },
  ]));
  const line = captureClaudeSession(repo, transcript, 'sess-ids', { config: CFG, user: 'tester' });
  const wf = line.subagents.find((s) => s.role === 'test-automation-engineer');
  assert.deepEqual(wf.cases, ['TC-909']);
  assert.ok(!wf.label.includes('TC-909'), 'the label window itself missed the id — that is the point');
  assert.ok(line.cases.includes('TC-909'), 'session-level cases picks it up too');
});

// A declared work scope (work-scope.mjs) is the strongest identity surface —
// the capture stamps it onto the line and folds its case ids in.
test('captureClaudeSession: declared scope stamped onto the line, declared ids join cases', async () => {
  const { openScope, recordOutcomes } = await import('../scripts/work-scope.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-scope');
  openScope(repo, { session: 'sess-scope', batch: 'b7', cases: ['TC-500'] });
  recordOutcomes(repo, { session: 'sess-scope', outcomes: { 'TC-500': 'automated' } });
  const line = captureClaudeSession(repo, transcript, 'sess-scope', { config: CFG, user: 'tester' });
  assert.equal(line.scope.intent, 'automation');
  assert.equal(line.scope.batch, 'b7');
  assert.deepEqual(line.scope.outcomes, { 'TC-500': 'automated' }, 'compact outcome map, no timestamps');
  assert.ok(line.cases.includes('TC-500'), 'declared id joins the mined ones');
  assert.ok(line.cases.includes('TC-101'), 'mined ids are kept too');
});

// Copilot's agent cannot know its session id — `open --session auto` leaves a
// pending record; the capture claims it by time window, permanently.
test('sessionScope: pending record claimed by time window, then owned by the session', async () => {
  const { openScope, listScopes } = await import('../scripts/work-scope.mjs');
  const { sessionScope } = await import('./telemetry-capture.mjs');
  const repo = tmp();
  const s = openScope(repo, { session: 'pending-x1', batch: 'b8', now: '2026-07-30T10:03:00.000Z' });
  assert.match(s.session, /^pending-/);
  const win = { startTs: Date.parse('2026-07-30T10:00:00Z'), endTs: Date.parse('2026-07-30T11:00:00Z') };
  const claimed = sessionScope(repo, 'real-session', win);
  assert.equal(claimed.batch, 'b8');
  assert.equal(claimed.session, 'real-session');
  assert.equal(claimed.claimedFrom, 'pending-x1');
  const after = listScopes(repo);
  assert.deepEqual(after.map((x) => x.session), ['real-session'], 'claim renames — single-use');
  // outside any window → no claim
  const none = sessionScope(repo, 'other-session', { startTs: Date.parse('2026-07-31T10:00:00Z') });
  assert.equal(none, null);
});

// Measurements update AS DISPATCHES FINISH (SubagentStop), not only at session
// end — one line per dispatch in a transient per-session file, never N
// superseded whole-session rows in the git-committed ledger.
test('captureDispatches: one line per finished dispatch, idempotent, re-records on growth', async () => {
  const { captureDispatches, readDispatchLog, dispatchLogPath } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const sub = (id, text, turns = 1) => {
    const d = join(proj, 'sess-d', 'subagents');
    mkdirSync(d, { recursive: true });
    // No description — a workflow dispatch has none, so the label comes from
    // the prompt, exactly as in the field.
    writeFileSync(join(d, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'qa-engineer' }));
    writeFileSync(join(d, `agent-${id}.jsonl`), jsonl([
      { type: 'user', isSidechain: true, timestamp: '2026-07-30T10:00:00Z', message: { role: 'user', content: text } },
      ...Array.from({ length: turns }, (_, i) => ({
        type: 'assistant', timestamp: `2026-07-30T10:0${i + 1}:00Z`,
        message: { id: `${id}-${i}`, usage: { input_tokens: 100, output_tokens: 20 }, content: [] },
      })),
    ]));
  };
  writeFileSync(join(proj, 'sess-d.jsonl'), jsonl([{ type: 'agent-setting', agentSetting: 'test-automation-lead' }]));
  sub('a1', 'Analyst slot — analyse TC-1');
  sub('a2', 'Implementer slot — implement TC-2');
  const CFGX = { ...CFG, priceAtCapture: false }; // no ccusage in tests

  assert.equal(captureDispatches(repo, 'sess-d', { projectDir: proj, config: CFGX }), 2);
  const log = readDispatchLog(dispatchLogPath(repo, 'sess-d'));
  assert.deepEqual([...log.keys()].sort(), ['agent-a1', 'agent-a2']);
  assert.equal(log.get('agent-a1').role, 'qa-engineer');
  assert.deepEqual(log.get('agent-a1').cases, ['TC-1'], 'case attribution recorded at the moment the dispatch ends');
  assert.match(log.get('agent-a2').label, /^Implementer slot/);

  assert.equal(captureDispatches(repo, 'sess-d', { projectDir: proj, config: CFGX }), 0, 'idempotent — a re-fired stop records nothing');
  // agentId narrows to the one that just finished
  sub('a3', 'Reviewer slot — STATIC review of TC-1');
  assert.equal(captureDispatches(repo, 'sess-d', { projectDir: proj, config: CFGX, agentId: 'agent-a3' }), 1);
  // a resumed dispatch grew → superseding line, latest wins on read
  const before = readDispatchLog(dispatchLogPath(repo, 'sess-d')).get('agent-a1').bytes;
  sub('a1', 'Analyst slot — analyse TC-1', 3);
  assert.equal(captureDispatches(repo, 'sess-d', { projectDir: proj, config: CFGX }), 1);
  const after = readDispatchLog(dispatchLogPath(repo, 'sess-d'));
  assert.ok(after.get('agent-a1').bytes > before, 'the superseding record reflects the grown transcript');
  assert.equal(after.size, 3, 'still one ENTRY per dispatch, however many lines were appended');
});

// The session line is re-derived from transcripts, so it normally already has
// every dispatch — the fold exists for the one case it CANNOT: a sub-agent
// transcript gone by session end. Measured work must not vanish with it.
test('foldDispatchLog: a dispatch whose transcript disappeared survives into the session line', async () => {
  const { captureDispatches, captureClaudeSession } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-f');   // parent + 1 sub (agent-abc)
  // a SECOND dispatch finishes and is measured live…
  const d = join(proj, 'sess-f', 'subagents');
  writeFileSync(join(d, 'agent-gone.meta.json'), JSON.stringify({ agentType: 'test-automation-engineer' }));
  writeFileSync(join(d, 'agent-gone.jsonl'), jsonl([
    { type: 'user', isSidechain: true, timestamp: '2026-07-30T10:05:00Z', message: { role: 'user', content: 'Implementer slot — implement TC-42' } },
    { type: 'assistant', timestamp: '2026-07-30T10:06:00Z', message: { id: 'g1', usage: { input_tokens: 300, output_tokens: 40 }, content: [] } },
  ]));
  assert.equal(captureDispatches(repo, 'sess-f', { projectDir: proj, config: { ...CFG, priceAtCapture: false } }), 2);
  // …then its transcript is gone by the time the session ends
  rmSync(join(d, 'agent-gone.jsonl')); rmSync(join(d, 'agent-gone.meta.json'));

  const line = captureClaudeSession(repo, transcript, 'sess-f', { config: CFG, user: 'tester' });
  const ids = line.subagents.map((s) => s.id).sort();
  assert.deepEqual(ids, ['agent-abc', 'agent-gone'], 'the vanished dispatch is folded back in');
  assert.equal(line.foldedFromLive, 1, 'and the line says so — never a silent merge');
  assert.ok(line.cases.includes('TC-42'), 'its case attribution survives too');
  const folded = line.subagents.find((s) => s.id === 'agent-gone');
  assert.match(folded.label, /^Implementer slot/);
  assert.equal(folded.role, 'test-automation-engineer');
});

// What makes capturing mid-run cheap: a dispatch the SubagentStop hook already
// priced is NOT re-metered when its transcript is byte-identical, so a capture
// prices the parent plus whatever finished unmeasured — not N+1 transcripts.
test('captureClaudeSession: reuses live-log dollars, meters only what changed', async () => {
  const { captureClaudeSession, dispatchLogPath } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-r');           // parent + agent-abc
  const subPath = join(proj, 'sess-r', 'subagents', 'agent-abc.jsonl');
  const bytes = readFileSync(subPath, 'utf8').length;
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation', 'live'), { recursive: true });
  writeFileSync(dispatchLogPath(repo, 'sess-r'),
    `${JSON.stringify({ v: 1, session: 'sess-r', agentId: 'agent-abc', role: 'qa-engineer', label: 'analyse', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 4.25, bytes })}\n`);

  // a fake ccusage that prices ONLY the parent — proving the sub was not sent
  const fake = join(repo, 'fake-ccusage');
  writeFileSync(fake, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify({ session: [{ sessionId: 'sess-r', totalCost: 1 }] })}\nEOF\n`, { mode: 0o755 });
  const line = captureClaudeSession(repo, transcript, 'sess-r', {
    config: { ...CFG, priceAtCapture: true }, user: 'tester',
    // meterSession reads the binary from env at call time
    env: { ...process.env, TOKENOMICS_CCUSAGE_BIN: fake },
  });
  const sub = line.subagents.find((s) => s.id === 'agent-abc');
  assert.equal(sub.costUsd, 4.25, 'the already-priced dispatch keeps its recorded dollar');
  assert.equal(line.costUsd, 5.25, 'session total = metered parent + reused dispatch');
});

// Copilot has no sub-agent transcripts — its dispatches are events inside the
// session's own events.jsonl, and it prices the session once at shutdown, so
// these records are honestly tokens/time only.
test('captureDispatches: Copilot dispatches come from events.jsonl, tokens-only', async () => {
  const { captureDispatches, readDispatchLog, dispatchLogPath } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const copRoot = tmp();
  const sdir = join(copRoot, 'cp-sess');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(sdir, 'events.jsonl'), jsonl([
    { type: 'session.start', timestamp: '2026-08-13T10:00:00Z', data: { context: { branch: 'tests/batch-x' } } },
    { type: 'subagent.started', timestamp: '2026-08-13T10:01:00Z', data: { toolCallId: 't1', agentName: 'qa-engineer', agentDescription: 'Analyst slot — analyse TC-77' } },
    { type: 'subagent.completed', timestamp: '2026-08-13T10:09:00Z', data: { toolCallId: 't1', agentName: 'qa-engineer', totalTokens: 120000, durationMs: 480000, totalToolCalls: 14 } },
  ]));
  const env = { ...process.env, TOKENOMICS_COPILOT_ROOT: copRoot };
  assert.equal(captureDispatches(repo, 'cp-sess', { config: CFG, env }), 1);
  const rec = readDispatchLog(dispatchLogPath(repo, 'cp-sess')).get('t1');
  assert.equal(rec.role, 'qa-engineer');
  assert.match(rec.label, /^Analyst slot/);
  assert.deepEqual(rec.cases, ['TC-77'], 'case attribution from the dispatch description');
  assert.equal(rec.tokens.input, 120000, 'cache-inclusive total, same convention as the session capture');
  assert.equal(rec.activeMin, 8);
  assert.equal(rec.toolCalls, 14);
  assert.ok(!('costUsd' in rec), 'no per-dispatch dollars exist on this host — never invented');
  assert.equal(captureDispatches(repo, 'cp-sess', { config: CFG, env }), 0, 'idempotent');
});

// The transient log must not outlive the session it described.
test('main: the session-end ledger line supersedes and removes the live dispatch log', async () => {
  const { dispatchLogPath, captureDispatches } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-x');
  captureDispatches(repo, 'sess-x', { projectDir: proj, config: { ...CFG, priceAtCapture: false } });
  assert.ok(existsSync(dispatchLogPath(repo, 'sess-x')), 'dispatch recorded while the session ran');
  await main(['--transcript', transcript, '--session', 'sess-x', '--cwd', repo], { TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_BATCH_COST: '1' });
  assert.ok(!existsSync(dispatchLogPath(repo, 'sess-x')), 'removed once the real ledger line landed');
});

// ccusage keys each staged row by the FILE STEM, not the staged folder name.
// Matching the folder returned null for every per-dispatch dollar, so per-case
// attribution silently degraded to tokens-only (found live: session total
// priced $3.31, every dispatch "unpriced").
test('meterSession: per-file dollars join on the file stem, with the folder shape as fallback', async () => {
  const { meterSession } = await import('./telemetry-capture.mjs');
  const dir = tmp();
  const files = ['sess-1.jsonl', 'agent-aaa.jsonl', 'agent-bbb.jsonl'].map((n) => join(dir, n));
  for (const f of files) writeFileSync(f, '');
  // Fake ccusage: echoes a claude-session payload keyed by stem (current shape)
  const fake = join(dir, 'fake-ccusage');
  writeFileSync(fake, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify({
    session: [
      { sessionId: 'agent-bbb', totalCost: 2 },
      { sessionId: 'sess-1', totalCost: 1 },
      { sessionId: 'agent-aaa', totalCost: 0.5 },
    ],
  })}\nEOF\n`, { mode: 0o755 });
  const r = meterSession(files, { env: { ...process.env, TOKENOMICS_CCUSAGE_BIN: fake } });
  assert.equal(r.totalUsd, 3.5);
  assert.deepEqual(r.perFileUsd, [1, 0.5, 2], 'each staged file gets ITS OWN dollar, in order');
});

// A Workflow run spawns its agents through the workflow runtime, so the parent
// transcript holds ZERO Agent tool_use blocks — counting those reported
// `dispatches: 0` for a whole batch (found on a live workflow session).
test('captureClaudeSession: dispatches counts workflow sub-agents, not just Agent-tool calls', () => {
  const repo = tmp(); const proj = tmp();
  // fixture WITHOUT the Agent tool_use record, sub-agent under workflows/
  const transcript = join(proj, 'wf-sess.jsonl');
  mkdirSync(proj, { recursive: true });
  writeFileSync(transcript, jsonl([
    { type: 'agent-setting', agentSetting: 'test-automation-lead' },
    { type: 'user', message: { role: 'user', content: 'run the batch' }, timestamp: '2026-07-30T10:00:00Z' },
    { type: 'assistant', timestamp: '2026-07-30T10:01:00Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] } },
  ]));
  const wfDir = join(proj, 'wf-sess', 'subagents', 'workflows', 'wf_abc');
  mkdirSync(wfDir, { recursive: true });
  for (const id of ['a1', 'a2']) {
    writeFileSync(join(wfDir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'qa-engineer' }));
    writeFileSync(join(wfDir, `agent-${id}.jsonl`), jsonl([
      { type: 'user', isSidechain: true, timestamp: '2026-07-30T10:02:00Z', message: { role: 'user', content: 'Analyst slot — analyse TC-7' } },
      { type: 'assistant', timestamp: '2026-07-30T10:03:00Z', message: { id: `s-${id}`, usage: { input_tokens: 100, output_tokens: 20 }, content: [] } },
    ]));
  }
  const line = captureClaudeSession(repo, transcript, 'wf-sess', { config: CFG, user: 'tester' });
  assert.equal(line.subagents.length, 2);
  assert.equal(line.dispatches, 2, 'workflow sub-agents counted even with no Agent tool_use blocks');
});

test('captureClaudeSession: empty transcript yields no line', () => {
  const repo = tmp(); const proj = tmp();
  mkdirSync(proj, { recursive: true });
  const t = join(proj, 'empty.jsonl');
  writeFileSync(t, jsonl([{ type: 'summary', summary: 'nothing' }]));
  assert.equal(captureClaudeSession(repo, t, 'empty', { config: CFG, user: 'tester' }), null);
});

function copilotEvents({ shutdown = true, cwd = '/repo', agent = null } = {}) {
  const ev = [
    { type: 'session.start', timestamp: '2026-07-30T09:00:00Z', data: { context: { cwd, branch: 'main' } } },
    // CLI ≥1.0.63 emits these; older sessions lack them (agent stays null below)
    ...(agent ? [
      { type: 'subagent.selected', timestamp: '2026-07-30T09:00:01Z', data: { agentName: agent, agentDisplayName: agent } },
      { type: 'skill.invoked', timestamp: '2026-07-30T09:00:02Z', data: { name: 'test-automation-workflow', path: '/x/SKILL.md' } },
      { type: 'subagent.started', timestamp: '2026-07-30T09:00:03Z', agentId: 'tc9', data: { toolCallId: 'tc9', agentName: 'qa-engineer', agentDescription: 'analyse SCRUM-T101 live' } },
    ] : []),
    { type: 'user.message', timestamp: '2026-07-30T09:00:10Z', data: { text: 'run the batch' } },
    { type: 'assistant.message', timestamp: '2026-07-30T09:00:20Z', data: {} },
    { type: 'tool.execution_start', timestamp: '2026-07-30T09:00:30Z', data: {} },
    { type: 'tool.execution_complete', timestamp: '2026-07-30T09:00:40Z', data: { success: false } },
    { type: 'subagent.started', timestamp: '2026-07-30T09:01:00Z', agentId: 'tc1', data: { toolCallId: 'tc1', agentName: 'qa-engineer' } },
    { type: 'assistant.message', timestamp: '2026-07-30T09:02:00Z', agentId: 'tc1', data: {} }, // sub-agent turn — not the parent's
    { type: 'subagent.completed', timestamp: '2026-07-30T09:03:00Z', agentId: 'tc1', data: { toolCallId: 'tc1', agentName: 'qa-engineer', totalTokens: 1000, totalToolCalls: 5, durationMs: 120000 } },
  ];
  if (shutdown) {
    ev.push({
      type: 'session.shutdown', timestamp: '2026-07-30T09:04:00Z',
      data: {
        totalNanoAiu: 19862850000,
        modelMetrics: { 'gpt-5': { usage: { inputTokens: 5000, outputTokens: 300, cacheReadTokens: 100, cacheWriteTokens: 10 } } },
      },
    });
  }
  return ev;
}

test('captureCopilotSession: billed nanoAIU → USD, parent netted of sub-agent tokens', () => {
  const repo = tmp();
  const dir = tmp();
  const events = join(dir, 'events.jsonl');
  writeFileSync(events, jsonl(copilotEvents({ cwd: repo })));
  const line = captureCopilotSession(repo, events, 'cop-1', { config: CFG, user: 'tester' });
  assert.equal(line.host, 'copilot');
  assert.equal(line.role, null);
  assert.equal(line.branch, 'main');
  assert.ok(Math.abs(line.costUsd - (19862850000 / 1e9) * USD_PER_CREDIT) < 1e-9);
  assert.equal(line.costSource, 'copilot-nano-aiu');
  assert.equal(line.tokens.input, 4000); // 5000 session − 1000 sub-agent
  assert.equal(line.turns, 2);           // parent only — the sub-agent's turn excluded
  assert.equal(line.toolCalls, 1);
  assert.equal(line.toolErrors, 1);
  // This fixture's subagent.started carries no agentDescription — the label is
  // honestly empty (batch-cost will classify such a dispatch as overhead).
  assert.deepEqual(line.subagents[0], {
    role: 'qa-engineer', label: '', n: 1,
    tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 },
    activeMin: 2, toolCalls: 5, toolErrors: 0,
  });
});

test('captureCopilotSession: parent role from subagent.selected, skills from skill.invoked', () => {
  const repo = tmp(); const dir = tmp();
  const events = join(dir, 'events.jsonl');
  writeFileSync(events, jsonl(copilotEvents({ cwd: repo, agent: 'test-automation-lead' })));
  const line = captureCopilotSession(repo, events, 'cop-role', { config: CFG, user: 'tester' });
  assert.equal(line.role, 'test-automation-lead');
  assert.deepEqual(line.skills, ['test-automation-workflow']);
  assert.deepEqual(line.cases, ['SCRUM-T101'], 'case id mined from the dispatch description');
});

test('captureCopilotSession: no shutdown yet → null (still running)', () => {
  const repo = tmp(); const dir = tmp();
  const events = join(dir, 'events.jsonl');
  writeFileSync(events, jsonl(copilotEvents({ shutdown: false, cwd: repo })));
  assert.equal(captureCopilotSession(repo, events, 'cop-2', { config: CFG, user: 'tester' }), null);
});

test('sweep: harvests unknown sessions, skips known ids, respects maxSweep and live grace', () => {
  const repo = tmp();
  const claudeRoot = tmp();
  const old = new Date('2026-07-30T11:00:00Z');
  for (const id of ['s-a', 's-b', 's-c']) {
    writeClaudeFixture(claudeRoot, id, { withSub: false });
    utimesSync(join(claudeRoot, `${id}.jsonl`), old, old);
  }
  // s-c is fully captured (ledger end == transcript end) and its file hasn't
  // grown past that end + margin — must be skipped without a re-parse.
  appendLine(repo, 'tester', { v: 1, host: 'claude', id: 's-c', endedAt: '2026-07-30T10:40:10Z' });
  const cDate = new Date('2026-07-30T10:41:00Z');
  utimesSync(join(claudeRoot, 's-c.jsonl'), cDate, cDate);
  // s-d looks live (fresh mtime) — must be deferred.
  writeClaudeFixture(claudeRoot, 's-d', { withSub: false });

  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot };
  const r1 = sweep(repo, { config: { ...CFG, maxSweep: 1 }, user: 'tester', env });
  assert.equal(r1.captured, 1);
  assert.ok(r1.skipped >= 1, 'the bounded sweep defers the rest');
  const r2 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r2.captured, 1); // the remaining old one; s-c known, s-d live
  const ids = readRecords(ledgerPath(repo, 'tester')).map((l) => l.id).sort();
  assert.deepEqual(ids, ['s-a', 's-b', 's-c']);
});

test('sweep: re-captures a claude session that continued after its first capture', () => {
  const repo = tmp();
  const claudeRoot = tmp();
  writeClaudeFixture(claudeRoot, 's-grow', { withSub: false });
  // First capture happened mid-life: ledger end 10:02, but the transcript now
  // runs to 10:40:10 and the file was written well past end + margin.
  appendLine(repo, 'tester', { v: 1, host: 'claude', id: 's-grow', endedAt: '2026-07-30T10:02:00Z' });
  const grown = new Date('2026-07-30T10:45:00Z');
  utimesSync(join(claudeRoot, 's-grow.jsonl'), grown, grown);

  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot };
  const r1 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r1.captured, 1, 'grown transcript is re-captured');
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 's-grow');
  assert.equal(lines.length, 2, 'superseding line appended, old one kept (reports dedup latest-wins)');
  assert.equal(lines[1].endedAt, '2026-07-30T10:40:10.000Z');
  assert.deepEqual(lines[1].tokens, { input: 300, output: 100, cacheRead: 2000, cacheWrite: 100 });

  // No further growth: mtime (10:45) is inside the new end (10:40:10) + margin.
  const r2 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r2.captured, 0, 'no growth since the re-capture → nothing appended');
});

test('sweep: re-captures a resumed Copilot session after its second shutdown', () => {
  const repo = tmp();
  const copRoot = tmp();
  mkdirSync(join(copRoot, 'cop-grow'), { recursive: true });
  const events = join(copRoot, 'cop-grow', 'events.jsonl');
  writeFileSync(events, jsonl(copilotEvents({ cwd: repo })));
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: copRoot };
  const r1 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r1.captured, 1);

  // The session is resumed: more events land and a SECOND shutdown carries the
  // updated billed totals (last shutdown wins).
  appendFileSync(events, jsonl([
    { type: 'assistant.message', timestamp: '2026-07-30T09:29:00Z', data: {} },
    {
      type: 'session.shutdown', timestamp: '2026-07-30T09:30:00Z',
      data: {
        totalNanoAiu: 30000000000,
        modelMetrics: { 'gpt-5': { usage: { inputTokens: 9000, outputTokens: 700, cacheReadTokens: 100, cacheWriteTokens: 10 } } },
      },
    },
  ]));
  const grown = new Date('2026-07-30T09:35:00Z');
  utimesSync(events, grown, grown);

  const r2 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r2.captured, 1, 'resumed session re-captured after growth');
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'cop-grow');
  assert.equal(lines.length, 2);
  assert.ok(Math.abs(lines[1].costUsd - 30 * USD_PER_CREDIT) < 1e-9, 'cost follows the latest billed figure');
  assert.equal(lines[1].tokens.input, 8000, '9000 session − 1000 sub-agent');
  assert.equal(lines[1].endedAt, '2026-07-30T09:30:00.000Z');

  const r3 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r3.captured, 0, 'stable after the re-capture');
});

test('main: direct capture appends once, re-run with unchanged transcript is a no-op', async () => {
  const repo = tmp();
  const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-m', { withSub: false });
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'telemetry', 'automation', 'config.json'), JSON.stringify({ priceAtCapture: false }));
  // Empty override roots keep the trailing sweep hermetic (off the real stores).
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp() };
  const argv = ['--transcript', transcript, '--session', 'sess-m', '--cwd', repo];
  assert.equal(await main(argv, env), 0);
  assert.equal(await main(argv, env), 0);
  const me = whoAmI(repo).slug;
  const lines = readRecords(ledgerPath(repo, me));
  assert.equal(lines.length, 1, 'unchanged transcript must not append a duplicate');
  assert.equal(lines[0].id, 'sess-m');
});

// The live page is a pure derivation over scope + receipts + whatever lines
// exist right now — no metering, overwrite-in-place, absent scope → silent no-op.
test('renderLiveReport: writes the live batch page on the telemetry side', async () => {
  const { renderLiveReport } = await import('./telemetry-capture.mjs');
  const repo = tmp();
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(join(tele, 'scopes'), { recursive: true });
  writeFileSync(join(tele, 'scopes', 'sess-live.json'), JSON.stringify({
    v: 1, session: 'sess-live', intent: 'automation', batch: 'b-live', cases: ['TC-1'], declaredAt: 'x', updatedAt: 'x',
  }));
  const dir = join(repo, '.agents', 'automation', 'b-live');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ batch: 'b-live', cases: [{ id: 'TC-1', outcome: 'automated' }] }));
  assert.equal(await renderLiveReport(repo, 'sess-live', { TOKENOMICS_NO_BATCH_COST: '1' }), null, 'off-switch respected');
  const out = await renderLiveReport(repo, 'sess-live', {});
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith(join('telemetry', 'automation', 'reports', 'b-live.html')), `landed at ${out[0]}`);
  assert.match(readFileSync(out[0], 'utf8'), /b-live/);
  assert.ok(!existsSync(join(dir, 'cost.json')), 'live render never writes into the batch dir');
  assert.equal(await renderLiveReport(repo, 'sess-unknown', {}), null, 'no scope → no page, no error');
});

test('sweep: harvests a completed Copilot session for this repo, ignores other cwds', () => {
  const repo = tmp();
  const copRoot = tmp();
  for (const [id, cwd] of [['cop-here', repo], ['cop-elsewhere', '/somewhere/else']]) {
    mkdirSync(join(copRoot, id), { recursive: true });
    writeFileSync(join(copRoot, id, 'events.jsonl'), jsonl(copilotEvents({ cwd })));
  }
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: copRoot };
  const r = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r.captured, 1);
  const lines = readRecords(ledgerPath(repo, 'tester'));
  assert.equal(lines[0].id, 'cop-here');
  assert.equal(lines[0].host, 'copilot');
});

// A realistic sidebar op-log: snapshot, a full-array rewrite introducing a
// custom-agent request, then path ops REWRITING request 0's counters as it
// streams (the shape measured live — naive summing overcounts ~3×).
function vscodeOplog() {
  const req0 = {
    requestId: 'request_aaa', timestamp: 1785849104000, modelId: 'copilot/claude-sonnet-4.6',
    agent: { id: 'github.copilot.editsAgent' },
    modeInfo: {
      kind: 'agent', isBuiltin: false,
      modeInstructions: { uri: { external: 'file:///repo/.github/agents/test-automation-lead.agent.md' } },
    },
    message: { text: 'automate CALCRATE-44 please' },
  };
  const req1 = {
    requestId: 'request_bbb', timestamp: 1785849404000, modelId: 'copilot/gpt-5-mini',
    elapsedMs: 60000, promptTokens: 1000, completionTokens: 20,
    result: { errorDetails: { message: 'rate limited' } },
  };
  return [
    { kind: 0, v: { requests: [req0], inputState: {} } },
    { kind: 1, k: 'requests', v: [req0, req1] },
    // streaming rewrites of request 0 — LAST value wins, never the sum
    { kind: 1, k: 'requests,0,promptTokens', v: 10000 },
    { kind: 1, k: 'requests,0,promptTokens', v: 30000 },
    { kind: 1, k: 'requests,0,promptTokens', v: 48472 },
    { kind: 1, k: 'requests,0,completionTokens', v: 100 },
    { kind: 1, k: 'requests,0,completionTokens', v: 498 },
    { kind: 1, k: 'requests,0,copilotCredits', v: 6.5 },
    { kind: 1, k: 'requests,0,copilotCredits', v: 18.1173 },
    { kind: 1, k: 'requests,0,elapsedMs', v: 120000 },
    { kind: 1, k: 'customTitle', v: 'CALCRATE-44 - automate the rate slider' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
}

test('parseVsCodeChatSession: last-write-wins replay, role from agent file uri, error counted', () => {
  const p = parseVsCodeChatSession(vscodeOplog());
  assert.equal(p.requests, 2);
  assert.deepEqual(p.tokens, { input: 49472, output: 518, cacheRead: 0, cacheWrite: 0 }); // finals, not rewrite sums
  assert.ok(Math.abs(p.credits - 18.1173) < 1e-9, 'credits = final value of the rewritten field');
  assert.equal(p.role, 'test-automation-lead');
  assert.deepEqual([...p.models].sort(), ['claude-sonnet-4.6', 'gpt-5-mini']);
  assert.equal(p.activeMin, 3); // 120s + 60s
  assert.equal(p.toolErrors, 1);
  assert.equal(p.prompts.length, 0, 'prompts off by default');
  assert.equal(p.title, 'CALCRATE-44 - automate the rate slider');
  assert.deepEqual(p.cases, ['CALCRATE-44'], 'ids mined from title + message text, ungated');
});

test('parseVsCodeChatSession: LIVE format — array path keys, kind-2 indexed inserts', () => {
  // exactly the measured shapes: {kind:0,v:snapshot}, {kind:2,k:["requests"],v:[req]},
  // {kind:2,k:["requests"],v:[req],i:1}, {kind:1,k:["requests",0,"field"],v}
  const req0 = { requestId: 'r0', timestamp: 1785849104257, modelId: 'copilot/claude-sonnet-4.6', modeInfo: { isBuiltin: false, modeInstructions: { uri: { external: 'file:///x/.github/agents/scout.agent.md' } } }, message: { text: 'seed CALCRATE-261' } };
  const req1 = { requestId: 'r1', timestamp: 1785849365143, modelId: 'copilot/claude-sonnet-4.6' };
  const doc = [
    { kind: 0, v: { version: 3, sessionId: 'x', requests: [] } },
    { kind: 1, k: ['customTitle'], v: 'Automate test cases for CALCRATE-44' },
    { kind: 2, k: ['requests'], v: [req0] },
    { kind: 1, k: ['requests', 0, 'promptTokens'], v: 20000 },
    { kind: 1, k: ['requests', 0, 'promptTokens'], v: 52633 },
    { kind: 1, k: ['requests', 0, 'completionTokens'], v: 1333 },
    { kind: 1, k: ['requests', 0, 'copilotCredits'], v: 18.1173 },
    { kind: 1, k: ['requests', 0, 'elapsedMs'], v: 66429 },
    { kind: 2, k: ['requests'], v: [req1], i: 1 },
    { kind: 1, k: ['requests', 1, 'completionTokens'], v: 55 },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const p = parseVsCodeChatSession(doc);
  assert.equal(p.requests, 2);
  assert.deepEqual(p.tokens, { input: 52633, output: 1388, cacheRead: 0, cacheWrite: 0 });
  assert.ok(Math.abs(p.credits - 18.1173) < 1e-9);
  assert.equal(p.title, 'Automate test cases for CALCRATE-44');
  assert.equal(p.role, 'scout');
  assert.deepEqual(p.cases, ['CALCRATE-261', 'CALCRATE-44']);
});

test('parseVsCodeChatSession: a re-sent full array never double-counts a request', () => {
  const req = { requestId: 'r0', promptTokens: 100, completionTokens: 10, timestamp: 1785849104257 };
  const doc = [
    { kind: 2, k: ['requests'], v: [req] },
    { kind: 2, k: ['requests'], v: [req] }, // duplicate append — merge by requestId
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const p = parseVsCodeChatSession(doc);
  assert.equal(p.requests, 1);
  assert.equal(p.tokens.input, 100);
});

test('parseVsCodeChatSession: pre-oplog plain-JSON document still parses', () => {
  const doc = JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 500, completionTokens: 5, modelId: 'gpt-4o', timestamp: 1700000000000 }] });
  const p = parseVsCodeChatSession(doc);
  assert.equal(p.requests, 1);
  assert.equal(p.tokens.input, 500);
  assert.equal(p.credits, null, 'no credits recorded → null, never 0');
});

test('captureVsCodeSession: billed credits → USD; tokens-only stays honest', () => {
  const repo = tmp(); const dir = tmp();
  const f = join(dir, 'chat-1.jsonl');
  writeFileSync(f, vscodeOplog());
  const line = captureVsCodeSession(repo, f, 'chat-1', { config: CFG, user: 'tester' });
  assert.equal(line.host, 'copilot-vscode');
  assert.equal(line.role, 'test-automation-lead');
  assert.ok(Math.abs(line.costUsd - 18.1173 * USD_PER_CREDIT) < 1e-9);
  assert.equal(line.costSource, 'copilot-credits');
  assert.equal(line.turns, 2);
  const noCredit = JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 9, timestamp: 1700000000000 }] });
  writeFileSync(f, noCredit);
  const l2 = captureVsCodeSession(repo, f, 'chat-1', { config: CFG, user: 'tester' });
  assert.equal(l2.costUsd, null);
  assert.equal(l2.costSource, 'none');
});

// The sidebar has no hooks, so `open --session auto` (a pending scope) is the
// ONLY way a sidebar session declares — and the time-window claim at capture
// is the only join. Without it every sidebar session reads undeclared.
test('captureVsCodeSession: claims a pending scope by time window, same as the other hosts', () => {
  const repo = tmp(); const dir = tmp();
  const scopes = join(repo, '.agents', 'telemetry', 'automation', 'scopes');
  mkdirSync(scopes, { recursive: true });
  writeFileSync(join(scopes, 'pending-abc.json'), JSON.stringify({
    v: 1, session: 'pending-abc', intent: 'automation', batch: 'b-side', cases: ['TC-9'],
    declaredAt: '2023-11-14T22:14:00.000Z', updatedAt: '2023-11-14T22:14:00.000Z',
  }));
  const f = join(dir, 'chat-2.jsonl');
  writeFileSync(f, JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 50, completionTokens: 5, timestamp: 1700000000000 }] })); // 2023-11-14T22:13:20Z
  const line = captureVsCodeSession(repo, f, 'chat-2', { config: CFG, user: 'tester' });
  assert.equal(line.scope?.intent, 'automation');
  assert.equal(line.scope?.batch, 'b-side');
  assert.ok(line.cases.includes('TC-9'), 'declared ids join the mined ones');
  assert.ok(existsSync(join(scopes, 'chat-2.json')), 'pending record claimed to the exact session id');
  assert.ok(!existsSync(join(scopes, 'pending-abc.json')), 'claim is single-use');
});

test('sweep: vscode sessions matched via workspace.json, re-captured on growth', () => {
  const repo = tmp();
  const root = tmp(); // a workspaceStorage dir
  const hash = join(root, 'abc123');
  mkdirSync(join(hash, 'chatSessions'), { recursive: true });
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
  const other = join(root, 'zzz999'); // different workspace — must be ignored
  mkdirSync(join(other, 'chatSessions'), { recursive: true });
  writeFileSync(join(other, 'workspace.json'), JSON.stringify({ folder: 'file:///somewhere/else' }));
  writeFileSync(join(other, 'chatSessions', 'x.jsonl'), vscodeOplog());
  const f = join(hash, 'chatSessions', 'chat-9.jsonl');
  writeFileSync(f, vscodeOplog());
  const old = new Date('2026-08-01T10:00:00Z');
  utimesSync(f, old, old);
  utimesSync(join(other, 'chatSessions', 'x.jsonl'), old, old);
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp(), TOKENOMICS_VSCODE_ROOT: root };
  const r1 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r1.captured, 1, 'only this repo\'s session captured');
  const r2 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r2.captured, 0, 'unchanged file not re-captured');
  // the chat grows later → mtime moves past the recorded end → re-capture
  appendFileSync(f, JSON.stringify({ kind: 1, k: 'requests,1,completionTokens', v: 999 }) + '\n');
  // growth is detected by mtime moving past the recorded session end (+margin);
  // the fixture's request timestamps end ~2026-08-04T14:04Z, so 20:00Z is past
  // the margin while still safely older than "now" (never live-grace territory)
  const grown = new Date('2026-08-04T20:00:00Z');
  utimesSync(f, grown, grown);
  const r3 = sweep(repo, { config: CFG, user: 'tester', env });
  assert.equal(r3.captured, 1, 'grown file re-captured');
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'chat-9');
  assert.equal(lines.length, 2, 'append-only: both captures kept; the report dedups latest-wins');
  assert.equal(lines[1].tokens.output, 518 - 20 + 999, 'recapture carries the grown final values');
});

test('vscodeStorageRoots: env override wins; config extras accepted as user-data or storage dirs', () => {
  const ws = tmp();
  assert.deepEqual(vscodeStorageRoots('/x', { TOKENOMICS_VSCODE_ROOT: ws }, {}), [ws]);
  const userData = tmp();
  mkdirSync(join(userData, 'User', 'workspaceStorage'), { recursive: true });
  const roots = vscodeStorageRoots('/x', { TOKENOMICS_VSCODE_ROOT: '' }, { vscodeUserDataDirs: [userData] });
  assert.ok(roots.includes(join(userData, 'User', 'workspaceStorage')));
});

test('workspaceFolderOf: decodes file URIs including windows drive form', () => {
  const hash = tmp();
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: 'file:///c%3A/Repos/My%20App' }));
  assert.equal(workspaceFolderOf(hash), 'c:/Repos/My App');
  assert.equal(workspaceFolderOf(tmp()), null, 'no workspace.json → null');
});

test('ensureSink: refuses to manage a remote collector', () => {
  assert.equal(ensureSink({ enabled: true, endpoint: 'https://otel.example.com:4318' }), false);
});

test('knownSessions reads every user ledger and keeps the latest endedAt', () => {
  const repo = tmp();
  appendLine(repo, 'alice', { v: 1, host: 'claude', id: 'x', endedAt: '2026-07-30T10:00:00Z' });
  appendLine(repo, 'bob', { v: 1, host: 'claude', id: 'x', endedAt: '2026-07-30T12:00:00Z' });
  appendLine(repo, 'bob', { v: 1, host: 'copilot', id: 'y', endedAt: null });
  const known = knownSessions(repo);
  assert.equal(known.get('claude:x'), Date.parse('2026-07-30T12:00:00Z'));
  assert.ok(known.has('copilot:y'));
});

test('sameCwdOrUnder: exact, nested, separator/case-insensitive', () => {
  assert.ok(sameCwdOrUnder('/a/b', '/a/b'));
  assert.ok(sameCwdOrUnder('/a/b/c', '/a/b'));
  assert.ok(!sameCwdOrUnder('/a/bc', '/a/b'));
  assert.ok(sameCwdOrUnder('C:\\Repo\\X', 'c:/repo'));
});

test('encodeProjectPath matches the transcript-store encoding', () => {
  assert.equal(encodeProjectPath('/Users/x y/repo.name'), '-Users-x-y-repo-name');
});

// Field case 2026-08-18 (manual-qa-verified route): the dispatch prompt names
// the run report "RUN-2026-08-17-001", and the case-id regex minted a phantom
// case "RUN-2026" that siphoned half the combined slot's cost attribution.
// A real case id is never immediately followed by another dash-digit segment.
test('extractCaseIds rejects fragments of longer dash-number chains', async () => {
  const { extractCaseIds } = await import('./telemetry-capture.mjs');
  assert.deepEqual(extractCaseIds('validated by RUN-2026-08-17-001 evidence'), []);
  assert.deepEqual(extractCaseIds('implement TC-001 per tasks/smoke/TC-001_home.md'), ['TC-001']);
  assert.deepEqual(extractCaseIds('ELITEA-2083 on branch tests/batch-chat-2083'), ['ELITEA-2083']);
  // a bare run-report-shaped token with no continuation still counts — honesty
  // over cleverness; the scope intersection is the second guard for those
  assert.deepEqual(extractCaseIds('see RUN-2026 for details'), ['RUN-2026']);
});

// Attribution reads the workflow-return RECEIPT first — a parameter round-trip
// (workflow args → prompt → schema-required unit_ids echo → receipt) — and
// only falls back to scope-gated prompt mining where no receipt exists.
test('receiptCaseIds: unit_ids echo wins; analyst cases[] and triage units[] parse too', async () => {
  // B1 Task 10: receiptCaseIds is the TA extension's receiptIds hook now.
  const { receiptIds } = await import('../extensions/test-automation.mjs');
  const receiptCaseIds = (repo, id) => receiptIds({ id }, { repo });
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const repo = mkdtempSync(join(tmpdir(), 'receipt-ids-'));
  const dir = join(repo, '.agents', 'telemetry', 'automation', 'returns', 'wf_x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'aaa.json'), JSON.stringify({ result: { unit_ids: ['TC-2', 'TC-1'] } }));
  writeFileSync(join(dir, 'bbb.json'), JSON.stringify({ result: { cases: [{ case_id: 'TC-7' }, { case_id: 'TC-7' }] } }));
  writeFileSync(join(dir, 'ccc.json'), JSON.stringify({ result: { units: [{ ids: ['TC-1'] }, { ids: ['TC-2'] }] } }));
  writeFileSync(join(dir, 'ddd.json'), JSON.stringify({ result: { text: 'no ids here' } }));
  assert.deepEqual(receiptCaseIds(repo, 'aaa'), ['TC-1', 'TC-2']);
  assert.deepEqual(receiptCaseIds(repo, 'bbb'), ['TC-7']);
  assert.deepEqual(receiptCaseIds(repo, 'ccc'), ['TC-1', 'TC-2']);
  assert.equal(receiptCaseIds(repo, 'ddd'), null, 'text-shaped receipt → fall back to mining');
  assert.equal(receiptCaseIds(repo, 'zzz'), null, 'no receipt → fall back to mining');
});

// --- B2 item 6: fold-flags ------------------------------------------------------------------------
const Q = (n) => ({ input: n, output: 1, cacheRead: 0, cacheWrite: 0 });
function foldFixture(live, lineOver = {}) {
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation', 'live');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 's1.jsonl'), jsonl(live.map((r) => ({ v: 1, session: 's1', ...r }))));
  const line = {
    id: 's1', models: ['claude-sonnet-5'], tokens: Q(10), activeMin: 1, dispatches: 1, cases: [],
    subagents: [{ id: 'agent-abc', role: 'qa', label: 'x', n: 1, tokens: Q(5), tokensByModel: {}, activeMin: 0, toolCalls: 0, toolErrors: 0 }],
    ...lineOver,
  };
  return { repo, line };
}

test('fold: unmeasured folded dispatch → tokens null + tokensAttributed false + line partial', async () => {
  const { foldDispatchLog, attributionOf } = await import('./telemetry-capture.mjs');
  const { repo, line } = foldFixture([{ agentId: 'agent-gone', role: 'qa', label: 'gone', activeMin: 2 }]);
  const out = under('fold-flags', () => foldDispatchLog(repo, line));
  const f = out.subagents.find((s) => s.id === 'agent-gone');
  assert.equal(f.tokens, null);
  assert.equal(f.tokensAttributed, false);
  assert.deepEqual(f.tokensByModel, {});
  assert.equal(out.tokensAttribution, 'partial');
  assert.equal(attributionOf(out), 'partial');
  const ref = foldFixture([{ agentId: 'agent-gone', role: 'qa', label: 'gone', activeMin: 2 }]);
  const r = under('none', () => foldDispatchLog(ref.repo, ref.line)).subagents.find((s) => s.id === 'agent-gone');
  assert.equal(JSON.stringify(r), JSON.stringify({ id: 'agent-gone', role: 'qa', label: 'gone', n: 1, activeMin: 2, toolCalls: 0, toolErrors: 0 }), 'reference shape kept off');
});

test('fold: models = sorted union with folded tokensByModel keys', async () => {
  const { foldDispatchLog } = await import('./telemetry-capture.mjs');
  const mk = () => foldFixture([{ agentId: 'agent-gone', role: 'qa', label: 'g', tokens: Q(3), tokensByModel: { 'claude-opus-4': Q(3), 'claude-haiku-4-5': Q(1) } }]);
  const a = mk();
  assert.deepEqual(under('fold-flags', () => foldDispatchLog(a.repo, a.line)).models, ['claude-haiku-4-5', 'claude-opus-4', 'claude-sonnet-5']);
  const b = mk();
  assert.deepEqual(under('none', () => foldDispatchLog(b.repo, b.line)).models, ['claude-sonnet-5'], 'reference: models untouched');
});

test('fold: complete stays flag-free', async () => {
  const { foldDispatchLog } = await import('./telemetry-capture.mjs');
  const { repo, line } = foldFixture([{ agentId: 'agent-gone', role: 'qa', label: 'g', tokens: Q(3) }]);
  const out = under('fold-flags', () => foldDispatchLog(repo, line));
  assert.ok(!('tokensAttribution' in out));
  const f = out.subagents.find((s) => s.id === 'agent-gone');
  assert.ok(!('tokensAttributed' in f));
  assert.deepEqual(f.tokensByModel, {});
});

test('fold: a record marked tokensAttributed false is unmeasured, and a partial line stays partial', async () => {
  const { foldDispatchLog } = await import('./telemetry-capture.mjs');
  const { repo, line } = foldFixture([{ agentId: 'agent-gone', role: 'qa', label: 'g', tokens: Q(3), tokensAttributed: false }]);
  const out = under('fold-flags', () => foldDispatchLog(repo, line));
  assert.equal(out.subagents.find((s) => s.id === 'agent-gone').tokensAttributed, false);
  assert.equal(out.tokensAttribution, 'partial');
  const n = foldFixture([{ agentId: 'agent-gone', role: 'qa', label: 'g' }], { tokens: null, tokensAttributed: false, subagents: [] });
  assert.equal(under('fold-flags', () => foldDispatchLog(n.repo, n.line)).tokensAttribution, 'none');
});

test('attributionOf: parent and every dispatch', async () => {
  const { attributionOf } = await import('./telemetry-capture.mjs');
  const ok = { tokens: Q(1), subagents: [{ tokens: Q(1) }] };
  assert.equal(attributionOf(ok), undefined);
  assert.equal(attributionOf({ tokens: Q(1), subagents: [{ tokens: null, tokensAttributed: false }] }), 'partial');
  assert.equal(attributionOf({ tokens: null, tokensAttributed: false, subagents: [{ tokens: null }] }), 'none');
  assert.equal(attributionOf({ tokens: null, tokensAttributed: false }), 'none');
  assert.equal(attributionOf({ tokens: Q(1) }), undefined);
});

test('fold: folded entry key order equals a captured entry\'s', async () => {
  const { foldDispatchLog } = await import('./telemetry-capture.mjs');
  const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sess-k');
  const captured = under('fold-flags', () => captureClaudeSession(tmp(), transcript, 'sess-k', { config: CFG, user: 'tester' })).subagents[0];
  const { repo, line } = foldFixture([{ agentId: 'agent-gone', role: 'qa', label: 'g', tokens: Q(3) }]);
  const folded = under('fold-flags', () => foldDispatchLog(repo, line)).subagents.find((s) => s.id === 'agent-gone');
  assert.deepEqual(Object.keys(folded), Object.keys(captured));
});

// --- B2 item 4: null-unobservable (capture half) -------------------------------------------------
const NU = 'null-unobservable';
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const copilotFile = (events) => { const dir = tmp(); const p = join(dir, 'events.jsonl'); writeFileSync(p, jsonl(events)); return p; };
const usageless = (cwd, { sub = null } = {}) => [
  { type: 'session.start', timestamp: '2026-10-01T10:00:00Z', data: { context: { cwd, branch: 'main' } } },
  { type: 'user.message', timestamp: '2026-10-01T10:00:30Z', data: { text: 'go' } },
  ...(sub ? [
    { type: 'subagent.started', timestamp: '2026-10-01T10:01:00Z', data: { toolCallId: 'tc1', agentName: 'implementer', agentDescription: 'implement X-1' } },
    { type: 'subagent.completed', timestamp: '2026-10-01T10:02:00Z', data: { toolCallId: 'tc1', agentName: 'implementer', ...sub } },
  ] : []),
  { type: 'assistant.message', timestamp: '2026-10-01T10:05:00Z', data: {} },
  { type: 'session.shutdown', timestamp: '2026-10-01T10:10:00Z', data: { modelMetrics: { 'gpt-5': {} } } },
];

test('copilot usage-less shutdown → tokens null + tokensAttribution none', () => {
  const repo = tmp();
  const p = copilotFile(usageless(repo));
  const on = under(NU, () => captureCopilotSession(repo, p, 'cu1', { config: CFG, user: 'tester' }));
  assert.equal(on.tokens, null);
  assert.equal(on.tokensAttribution, 'none');
  assert.deepEqual(Object.keys(on).slice(Object.keys(on).indexOf('tokens'), Object.keys(on).indexOf('tokens') + 2), ['tokens', 'tokensAttribution']);
  // A measured dispatch makes the line partial (attributionOf over parent + dispatches, parent basis).
  const ps = copilotFile(usageless(repo, { sub: { totalTokens: 500, durationMs: 60000, totalToolCalls: 2 } }));
  const part = under(NU, () => captureCopilotSession(repo, ps, 'cu2', { config: CFG, user: 'tester' }));
  assert.equal(part.tokens, null, 'no netting against an unmeasured parent');
  assert.equal(part.tokensAttribution, 'partial');
  // A shutdown with usage stays measured and flag-free.
  const measured = under(NU, () => captureCopilotSession(repo, copilotFile(copilotEvents({ cwd: repo })), 'cu3', { config: CFG, user: 'tester' }));
  assert.equal(measured.tokens.input, 4000);
  assert.ok(!('tokensAttribution' in measured));
  // Reference (none): a zero quad and no flag.
  const off = under('none', () => captureCopilotSession(repo, p, 'cu1', { config: CFG, user: 'tester' }));
  assert.deepEqual(off.tokens, ZERO);
  assert.ok(!('tokensAttribution' in off));
});

test('copilot dispatch toolErrors null; activeMin/toolCalls null when absent', async () => {
  const { captureDispatches, readDispatchLog, dispatchLogPath } = await import('./telemetry-capture.mjs');
  const repo = tmp();
  const full = copilotFile(usageless(repo, { sub: { totalTokens: 500, durationMs: 120000, totalToolCalls: 3 } }));
  const bare = copilotFile(usageless(repo, { sub: { totalTokens: 500 } }));
  const s = (p, mig) => under(mig, () => captureCopilotSession(repo, p, 'cd', { config: CFG, user: 'tester' })).subagents[0];
  assert.deepEqual([s(full, NU).activeMin, s(full, NU).toolCalls, s(full, NU).toolErrors], [2, 3, null]);
  assert.deepEqual([s(bare, NU).activeMin, s(bare, NU).toolCalls, s(bare, NU).toolErrors], [null, null, null]);
  assert.deepEqual([s(bare, 'none').activeMin, s(bare, 'none').toolCalls, s(bare, 'none').toolErrors], [0, 0, 0]);
  // The live dispatch log (captureCopilotDispatches) writes the same nulls.
  for (const [mig, want] of [[NU, [null, null, null]], ['none', [0, 0, 0]]]) {
    const r = tmp(); const root = tmp();
    mkdirSync(join(root, 'cdl'), { recursive: true });
    writeFileSync(join(root, 'cdl', 'events.jsonl'), jsonl(usageless(r, { sub: { totalTokens: 500 } })));
    const env = { ...process.env, TOKENOMICS_COPILOT_ROOT: root, TOKENOMICS_CLAUDE_ROOT: tmp() };
    assert.equal(under(mig, () => captureDispatches(r, 'cdl', { config: CFG, env })), 1);
    const rec = readDispatchLog(dispatchLogPath(r, 'cdl')).get('tc1');
    assert.deepEqual([rec.activeMin, rec.toolCalls, rec.toolErrors], want, mig);
  }
});

test('vscode toolCalls/skills null', () => {
  const repo = tmp(); const dir = tmp();
  const f = join(dir, 'chat-v.jsonl');
  writeFileSync(f, vscodeOplog());
  const on = under(NU, () => captureVsCodeSession(repo, f, 'chat-v', { config: CFG, user: 'tester' }));
  assert.equal(on.toolCalls, null);
  assert.equal(on.skills, null);
  assert.ok(on.tokens.input > 0 && on.tokens.cacheRead === 0 && on.tokens.cacheWrite === 0, 'cache categories stay 0 (Q8a)');
  assert.ok(!('tokensAttribution' in on));
  const off = under('none', () => captureVsCodeSession(repo, f, 'chat-v', { config: CFG, user: 'tester' }));
  assert.equal(off.toolCalls, 0);
  assert.deepEqual(off.skills, []);
});

test('vscode usage-less → tokens null + attribution none', () => {
  const repo = tmp(); const dir = tmp();
  const f = join(dir, 'chat-u.jsonl');
  // No promptTokens / completionTokens on any request; the timed request has no elapsedMs.
  writeFileSync(f, JSON.stringify({ requests: [{ requestId: 'r1', timestamp: 1785849104000, copilotCredits: 2 }, { requestId: 'r2', timestamp: 1785849404000 }] }));
  const on = under(NU, () => captureVsCodeSession(repo, f, 'chat-u', { config: CFG, user: 'tester' }));
  assert.equal(on.tokens, null);
  assert.equal(on.tokensAttribution, 'none');
  assert.equal(on.activeMin, 0, 'a missing elapsedMs stays 0 (Q8c, the 4.2 registry definition)');
  assert.equal(on.wallMin, 5);
  const off = under('none', () => captureVsCodeSession(repo, f, 'chat-u', { config: CFG, user: 'tester' }));
  assert.deepEqual(off.tokens, ZERO);
  assert.ok(!('tokensAttribution' in off));
});

const stampless = (recs) => recs.map(({ timestamp, ...r }) => r);
test('timestamp-less session → wallMin/activeMin null', () => {
  const repo = tmp();
  // Claude: a transcript with usage but no timestamps.
  const proj = tmp();
  const t = join(proj, 'cl-nots.jsonl');
  writeFileSync(t, jsonl(stampless(claudeRecords())));
  const cl = (mig) => under(mig, () => captureClaudeSession(repo, t, 'cl-nots', { config: CFG, user: 'tester' }));
  assert.deepEqual([cl(NU).wallMin, cl(NU).activeMin], [null, null]);
  assert.deepEqual([cl('none').wallMin, cl('none').activeMin], [0, 0]);
  // A single timestamp is measured: wall 0, active 0.
  const one = join(proj, 'cl-one.jsonl');
  writeFileSync(one, jsonl([...stampless(claudeRecords()), { type: 'user', timestamp: '2026-07-30T10:00:00Z', message: { content: 'x' } }]));
  const o = under(NU, () => captureClaudeSession(repo, one, 'cl-one', { config: CFG, user: 'tester' }));
  assert.deepEqual([o.wallMin, o.activeMin], [0, 0]);
  // Copilot: no event carries a timestamp.
  const cp = copilotFile(stampless(copilotEvents({ cwd: repo })));
  const co = (mig) => under(mig, () => captureCopilotSession(repo, cp, 'cp-nots', { config: CFG, user: 'tester' }));
  assert.deepEqual([co(NU).wallMin, co(NU).activeMin], [null, null]);
  assert.deepEqual([co('none').wallMin, co('none').activeMin], [0, 0]);
  // VS Code: no request carries a timestamp.
  const dir = tmp(); const f = join(dir, 'vs-nots.jsonl');
  writeFileSync(f, JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 9, completionTokens: 1 }] }));
  const vs = (mig) => under(mig, () => captureVsCodeSession(repo, f, 'vs-nots', { config: CFG, user: 'tester' }));
  assert.deepEqual([vs(NU).wallMin, vs(NU).activeMin], [null, null]);
  assert.deepEqual([vs('none').wallMin, vs('none').activeMin], [0, 0]);
});

test('sweep twice over a timestamp-less session → one line (Review Focus 3)', () => {
  const repo = tmp(); const claudeRoot = tmp(); const copRoot = tmp();
  const old = new Date('2026-07-30T11:00:00Z');
  writeFileSync(join(claudeRoot, 'cl-nots.jsonl'), jsonl(stampless(claudeRecords())));
  utimesSync(join(claudeRoot, 'cl-nots.jsonl'), old, old);
  mkdirSync(join(copRoot, 'cp-nots'), { recursive: true });
  writeFileSync(join(copRoot, 'cp-nots', 'events.jsonl'), jsonl(stampless(copilotEvents({ cwd: repo }))));
  utimesSync(join(copRoot, 'cp-nots', 'events.jsonl'), old, old);
  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot, TOKENOMICS_COPILOT_ROOT: copRoot };
  under(NU, () => {
    assert.equal(sweep(repo, { config: CFG, user: 'tester', env, all: true }).captured, 2);
    assert.equal(sweep(repo, { config: CFG, user: 'tester', env, all: true }).captured, 0);
  });
  const lines = readRecords(ledgerPath(repo, 'tester'));
  assert.deepEqual(lines.map((l) => l.id).sort(), ['cl-nots', 'cp-nots'], 'one line per session');
  for (const l of lines) assert.deepEqual([l.wallMin, l.activeMin], [null, null]);
});

test('kit check over null-unobservable after-lines: no error findings', async () => {
  const { check } = await import('../kit/check.mjs');
  const repo = tmp();
  const lines = under(NU, () => {
    const out = [];
    out.push(captureCopilotSession(repo, copilotFile(usageless(repo)), 'k-cu', { config: CFG, user: 'tester' }));
    out.push(captureCopilotSession(repo, copilotFile(usageless(repo, { sub: { totalTokens: 5 } })), 'k-cd', { config: CFG, user: 'tester' }));
    out.push(captureCopilotSession(repo, copilotFile(stampless(copilotEvents({ cwd: repo }))), 'k-cn', { config: CFG, user: 'tester' }));
    const d = tmp();
    writeFileSync(join(d, 'u.jsonl'), JSON.stringify({ requests: [{ requestId: 'r1', timestamp: 1785849104000 }] }));
    out.push(captureVsCodeSession(repo, join(d, 'u.jsonl'), 'k-vu', { config: CFG, user: 'tester' }));
    writeFileSync(join(d, 'n.jsonl'), JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 3 }] }));
    out.push(captureVsCodeSession(repo, join(d, 'n.jsonl'), 'k-vn', { config: CFG, user: 'tester' }));
    const t = join(d, 'cl.jsonl');
    writeFileSync(t, jsonl(stampless(claudeRecords())));
    out.push(captureClaudeSession(repo, t, 'k-cl', { config: CFG, user: 'tester' }));
    return out;
  });
  assert.ok(lines.every(Boolean));
  const telem = tmp();
  mkdirSync(join(telem, 'automation'));
  writeFileSync(join(telem, 'automation', 'usage-tester.jsonl'), jsonl(lines));
  for (const mode of ['reference', 'mixed']) {
    const r = check(telem, { mode });
    assert.deepEqual(r.findings.filter((f) => f.class === 'error'), [], `${mode}: ${JSON.stringify(r.findings)}`);
  }
});

// Known reference defect, owned by Plan 4 Task 19 (capture-robustness): the VS Code sweep loop has no
// end-advance guard and a timestamp-less session's endedAt is null (read back as 0), so every sweep re-appends
// it. Identical in reference/49577c7, under `none` and under null-unobservable. This pins today's count so the
// fix is visible when it lands: update the expectation to 1 then.
test('sweep: a timestamp-less VS Code session is re-appended on every sweep (known reference defect, Task 19)', () => {
  for (const mig of ['none', NU]) {
    const repo = tmp(); const vsRoot = tmp();
    const hash = join(vsRoot, 'h1');
    mkdirSync(join(hash, 'chatSessions'), { recursive: true });
    writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: `file://${repo}` }));
    writeFileSync(join(hash, 'chatSessions', 'vs-nots.jsonl'), JSON.stringify({ requests: [{ requestId: 'r1', promptTokens: 9, completionTokens: 1 }] }));
    const old = new Date('2026-07-30T11:00:00Z');
    utimesSync(join(hash, 'chatSessions', 'vs-nots.jsonl'), old, old);
    const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp(), TOKENOMICS_VSCODE_ROOT: vsRoot };
    const runs = under(mig, () => [1, 2, 3].map(() => sweep(repo, { config: CFG, user: 'tester', env, all: true }).captured));
    assert.deepEqual(runs, [1, 1, 1], mig);
    const lines = readRecords(ledgerPath(repo, 'tester'));
    assert.equal(lines.length, 3, `${mig}: three lines for one session (the defect)`);
    assert.deepEqual(lines.map((l) => l.activeMin), mig === NU ? [null, null, null] : [0, 0, 0]);
  }
});

test('sweep: mixed era — a session captured under none is not re-appended under null-unobservable', () => {
  const repo = tmp(); const claudeRoot = tmp(); const copRoot = tmp();
  const old = new Date('2026-07-30T11:00:00Z');
  writeFileSync(join(claudeRoot, 'cl-nots.jsonl'), jsonl(stampless(claudeRecords())));
  utimesSync(join(claudeRoot, 'cl-nots.jsonl'), old, old);
  writeClaudeFixture(claudeRoot, 'cl-ts', { withSub: false });
  utimesSync(join(claudeRoot, 'cl-ts.jsonl'), old, old);
  mkdirSync(join(copRoot, 'cp-nots'), { recursive: true });
  writeFileSync(join(copRoot, 'cp-nots', 'events.jsonl'), jsonl(stampless(copilotEvents({ cwd: repo }))));
  utimesSync(join(copRoot, 'cp-nots', 'events.jsonl'), old, old);
  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot, TOKENOMICS_COPILOT_ROOT: copRoot };
  assert.equal(under('none', () => sweep(repo, { config: CFG, user: 'tester', env, all: true })).captured, 3);
  assert.equal(under(NU, () => sweep(repo, { config: CFG, user: 'tester', env, all: true })).captured, 0);
  const lines = readRecords(ledgerPath(repo, 'tester'));
  assert.deepEqual(lines.map((l) => l.id).sort(), ['cl-nots', 'cl-ts', 'cp-nots'], 'one line per session across eras');
  for (const l of lines.filter((x) => x.id !== 'cl-ts')) assert.deepEqual([l.wallMin, l.activeMin], [0, 0], 'the none-era line stays as written');
});

// --- B2 item 3: copilot-inclusive (capture half) ---------------------------------------------------
const CI = 'copilot-inclusive';

test('copilot session: inclusive basis, un-netted totals, null dispatch split', () => {
  const repo = tmp();
  const p = copilotFile(copilotEvents({ cwd: repo }));
  const on = under(CI, () => captureCopilotSession(repo, p, 'ci1', { config: CFG, user: 'tester' }));
  assert.equal(on.tokensBasis, 'inclusive');
  assert.deepEqual(on.tokens, { input: 5000, output: 300, cacheRead: 100, cacheWrite: 10 }, 'the host total, not netted of the dispatch');
  assert.equal(on.subagents[0].tokens, null, 'one cache-inclusive total and no category split: never invented');
  assert.ok(!('tokensAttributed' in on.subagents[0]), 'an unavailable split is implied by the basis, not an attribution gap');
  assert.ok(!('tokensAttribution' in on), 'no session flag caused by the null dispatch split');
  const keys = Object.keys(on);
  assert.equal(keys[keys.indexOf('tokens') + 1], 'tokensBasis', 'tokensBasis goes right after tokens');
  // Reference: netted, no basis, a dispatch total in `input`.
  const off = under('none', () => captureCopilotSession(repo, p, 'ci1', { config: CFG, user: 'tester' }));
  assert.ok(!('tokensBasis' in off));
  assert.equal(off.tokens.input, 4000);
  assert.deepEqual(off.subagents[0].tokens, { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test('copilot inclusive session with null-unobservable: usage-less shutdown keeps tokens null, dispatches do not make it partial', () => {
  const repo = tmp();
  const p = copilotFile(usageless(repo, { sub: { totalTokens: 500, durationMs: 60000, totalToolCalls: 2 } }));
  const on = under(`${CI},${NU}`, () => captureCopilotSession(repo, p, 'ci2', { config: CFG, user: 'tester' }));
  assert.equal(on.tokens, null);
  assert.equal(on.tokensBasis, 'inclusive');
  assert.equal(on.subagents[0].tokens, null);
  assert.equal(on.tokensAttribution, 'none', 'the parent is unmeasured and nothing else is');
});

test('copilot live record: null tokens', async () => {
  const { captureDispatches, readDispatchLog, dispatchLogPath } = await import('./telemetry-capture.mjs');
  for (const [mig, want] of [[CI, null], ['none', { input: 500, output: 0, cacheRead: 0, cacheWrite: 0 }]]) {
    const r = tmp(); const root = tmp();
    mkdirSync(join(root, 'cil'), { recursive: true });
    writeFileSync(join(root, 'cil', 'events.jsonl'), jsonl(usageless(r, { sub: { totalTokens: 500 } })));
    const env = { ...process.env, TOKENOMICS_COPILOT_ROOT: root, TOKENOMICS_CLAUDE_ROOT: tmp() };
    assert.equal(under(mig, () => captureDispatches(r, 'cil', { config: CFG, env })), 1);
    assert.deepEqual(readDispatchLog(dispatchLogPath(r, 'cil')).get('tc1').tokens, want, mig);
  }
});

// --- B2 item 9 scope-resolution (spec §14.11; owner Q12) ---------------------------------------------------------
const SR = 'scope-resolution';
const putScope = (tdir, rel, rec) => {
  const p = join(tdir, 'scopes', rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, `${JSON.stringify(rec, null, 2)}\n`);
};
const rec = (session, o = {}) => ({ v: 1, session, intent: 'automation', cases: [], declaredAt: '2026-10-01T09:58:00.000Z', updatedAt: '2026-10-01T09:58:00.000Z', ...o });
const START = Date.parse('2026-10-01T10:00:00Z');

test('resolveScope: host-qualified read, legacy flat read, an id under two hosts is ambiguous and never merged', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const t = tmp();
  putScope(t, 'claude/a.json', rec('a', { intent: 'story' }));
  assert.deepEqual(resolveScope(t, 'claude', 'a', null), { scope: rec('a', { intent: 'story' }), ambiguous: [] });
  assert.equal(resolveScope(t, 'copilot', 'a', null).scope, null, 'another host\'s record is not this session\'s');
  putScope(t, 'b.json', rec('b', { intent: 'docs' }));
  assert.equal(resolveScope(t, 'copilot', 'b', null).scope.intent, 'docs', 'a legacy flat record is still read');
  putScope(t, 'copilot/a.json', rec('a', { intent: 'bugfix' }));
  const both = resolveScope(t, 'claude', 'a', null);
  assert.equal(both.scope.intent, 'story', 'each host keeps its own record — never merged');
  assert.deepEqual(both.ambiguous, ['claude/a.json', 'copilot/a.json']);
  assert.deepEqual(resolveScope(t, 'copilot-vscode', 'a', null), { scope: null, ambiguous: ['claude/a.json', 'copilot/a.json'] });
  putScope(t, 'c.json', rec('c'));
  putScope(t, 'claude/c.json', rec('c', { intent: 'story' }));
  assert.deepEqual(resolveScope(t, 'copilot', 'c', null), { scope: null, ambiguous: ['claude/c.json', 'c.json'] }, 'flat + another host: the flat record is not read');
});

test('capture: an ambiguous scope id is reported on stderr and the line carries only its own host\'s record', () => {
  const repo = tmp(); const proj = tmp(); const empty = tmp();
  const transcript = writeClaudeFixture(proj, 'amb', { withSub: false });
  const tdir = join(repo, '.agents', 'telemetry', 'automation');
  putScope(tdir, 'claude/amb.json', rec('amb', { intent: 'story' }));
  putScope(tdir, 'copilot/amb.json', rec('amb', { intent: 'bugfix' }));
  const SCRIPT = new URL('./telemetry-capture.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [SCRIPT, '--transcript', transcript, '--session', 'amb', '--cwd', repo], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: empty, TOKENOMICS_MIGRATIONS: SR, TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_SINK: '1', TOKENOMICS_NO_BATCH_COST: '1', TOKENOMICS_CLAUDE_ROOT: empty, TOKENOMICS_COPILOT_ROOT: empty, TOKENOMICS_VSCODE_ROOT: empty },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /scope for claude:amb is ambiguous — records at claude\/amb\.json, copilot\/amb\.json/);
  const [line] = readRecords(join(tdir, readdirSync(tdir).find((f) => f.startsWith('usage-'))));
  assert.equal(line.scope.intent, 'story');
});

// T10-8: the capture message names the directory it wrote, including the probe's state dir.
test('capture message names the resolved telemetry dir: repo-relative normally, the state dir during a probe', () => {
  const SCRIPT = new URL('./telemetry-capture.mjs', import.meta.url).pathname;
  const run = (extra) => {
    const repo = tmp(); const proj = tmp(); const empty = tmp();
    const transcript = writeClaudeFixture(proj, 'msg', { withSub: false });
    const r = spawnSync(process.execPath, [SCRIPT, '--transcript', transcript, '--session', 'msg', '--cwd', repo], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: empty, TOKENOMICS_MIGRATIONS: SR, TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_SINK: '1', TOKENOMICS_NO_BATCH_COST: '1', TOKENOMICS_CLAUDE_ROOT: empty, TOKENOMICS_COPILOT_ROOT: empty, TOKENOMICS_VSCODE_ROOT: empty, ...extra(empty) },
    });
    assert.equal(r.status, 0, r.stderr);
    return { err: r.stderr, state: empty };
  };
  const normal = run(() => ({}));
  assert.match(normal.err, /captured 1 session\(s\) → \.agents\/telemetry\/automation\/usage-[^/\n]+\.jsonl\n/);
  const probe = run((state) => ({ TOKENOMICS_STATE_DIR: state }));
  assert.ok(probe.err.includes(`→ ${join(probe.state, 'telemetry', 'automation')}/usage-`), probe.err);
  assert.ok(!probe.err.includes('→ .agents/'), 'a probe run never claims the repo store');
});

test('resolveScope: precedence handoff > claimed pending > other; a claim over a self-declared record merges (Q12c)', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const pending = rec('pending-p', { intent: 'story', batch: 'issue-7', cases: ['issue-7'], role: 'lead', outcomes: { 'issue-7': { outcome: 'delivered', at: 'P' } } });
  // (1) hand-off: wins; the pending record is never claimed over it
  let t = tmp();
  putScope(t, 'claude/s.json', rec('s', { source: 'handoff' }));
  putScope(t, 'pending-p.json', pending);
  assert.equal(resolveScope(t, 'claude', 's', START).scope.source, 'handoff');
  assert.ok(existsSync(join(t, 'scopes', 'pending-p.json')), 'a later pending declaration never displaces a hand-off');
  // (2) over (3): the in-window pending record is claimed and displaces the self-declared one
  t = tmp();
  const own = rec('s', { intent: 'bugfix', batch: 'issue-9', cases: ['issue-9'], source: 'manual', role: 'solo',
    outcomes: { 'issue-9': { outcome: 'done', at: 'O' }, 'issue-7': { outcome: 'blocked', at: 'O' } }, closedAt: 'C' });
  putScope(t, 'claude/s.json', own);
  putScope(t, 'pending-p.json', pending);
  const r = resolveScope(t, 'claude', 's', START);
  const want = {
    v: 1, session: 's', intent: 'story', cases: ['issue-7'], declaredAt: pending.declaredAt, updatedAt: pending.updatedAt,
    batch: 'issue-7', role: 'lead',
    outcomes: { 'issue-7': { outcome: 'delivered', at: 'P' }, 'issue-9': { outcome: 'done', at: 'O' } },
    closedAt: 'C', claimedFrom: 'pending-p',
  };
  assert.deepEqual(r.scope, want, 'declaration fields (intent, batch, cases, role, source) from the pending record; outcomes merged pending-first; closedAt kept');
  assert.deepEqual(Object.keys(r.scope.outcomes), ['issue-7', 'issue-9']);
  assert.equal(r.claimedFrom, 'pending-p');
  assert.deepEqual(JSON.parse(readFileSync(join(t, 'scopes', 'claude', 's.json'), 'utf8')), want);
  assert.ok(!existsSync(join(t, 'scopes', 'pending-p.json')), 'single-use');
  assert.deepEqual(readdirSync(join(t, 'scopes', 'claude')), ['s.json'], 'no claim file left');
  // a claimed record is not displaced by a second in-window pending record
  putScope(t, 'pending-q.json', rec('pending-q', { intent: 'other' }));
  assert.equal(resolveScope(t, 'claude', 's', START).scope.intent, 'story');
  assert.ok(existsSync(join(t, 'scopes', 'pending-q.json')));
  // (3) alone: the session's own record
  t = tmp();
  putScope(t, 'claude/s.json', rec('s', { intent: 'docs' }));
  assert.equal(resolveScope(t, 'claude', 's', START).scope.intent, 'docs');
});

test('resolveScope: a crashed claim (.claim left, no record) is completed by the next resolution; no second session can claim it', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const t = tmp();
  putScope(t, 'claude/A.json.claim', rec('pending-c', { intent: 'story', batch: 'b1' }));
  assert.deepEqual(resolveScope(t, 'claude', 'B', START), { scope: null, ambiguous: [] }, 'the pending record is owned by the claim');
  assert.ok(!existsSync(join(t, 'scopes', 'claude', 'B.json')));
  const r = resolveScope(t, 'claude', 'A', null);
  assert.equal(r.scope.session, 'A');
  assert.equal(r.scope.batch, 'b1');
  assert.equal(r.scope.claimedFrom, 'pending-c');
  assert.equal(JSON.parse(readFileSync(join(t, 'scopes', 'claude', 'A.json'), 'utf8')).claimedFrom, 'pending-c');
  assert.ok(!existsSync(join(t, 'scopes', 'claude', 'A.json.claim')), 'the claim file is removed once completed');
});

test('scope-resolution: an unreadable scopes store resolves to no scope and the line is still written (R9)', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'r9', { withSub: false });
  const tdir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(tdir, { recursive: true });
  writeFileSync(join(tdir, 'scopes'), 'not a directory\n');
  assert.throws(() => captureClaudeSession(repo, transcript, 'r9', { config: CFG, user: 'tester' }), /ENOTDIR/, 'none pins the reference throw');
  const line = under(SR, () => captureClaudeSession(repo, transcript, 'r9', { config: CFG, user: 'tester' }));
  assert.ok(line);
  assert.ok(!('scope' in line));
  assert.deepEqual(resolveScope(tdir, 'claude', 'r9', START), { scope: null, ambiguous: [] });
});

test('scope-resolution: scope.role is stamped on the line at capture', async () => {
  const { openScope } = await import('../scripts/work-scope.mjs');
  const repo = tmp(); const proj = tmp();
  const transcript = writeClaudeFixture(proj, 'sr1', { withSub: false });
  const line = under(SR, () => {
    openScope(repo, { session: 'sr1', host: 'claude', batch: 'b1', cases: ['TC-1'], role: 'lead' });
    return captureClaudeSession(repo, transcript, 'sr1', { config: CFG, user: 'tester' });
  });
  assert.deepEqual(line.scope, { intent: 'automation', batch: 'b1', cases: ['TC-1'], role: 'lead' });
  // none: a record carrying a role is stamped without it (the reference compact form)
  const repo2 = tmp();
  putScope(join(repo2, '.agents', 'telemetry', 'automation'), 'sr1.json', rec('sr1', { role: 'lead' }));
  assert.deepEqual(captureClaudeSession(repo2, transcript, 'sr1', { config: CFG, user: 'tester' }).scope, { intent: 'automation', cases: [] });
});

// --- scope-resolution review round 1 ---------------------------------------------------------------------------
test('hostFromEnv (I1): COPILOT_CLI=1 first, then CLAUDE_SESSION_ID/CLAUDE_PROJECT_DIR, else none', async () => {
  const { hostFromEnv } = await import('../engine/scopes.mjs');
  assert.equal(hostFromEnv({ COPILOT_CLI: '1', CLAUDE_PROJECT_DIR: '/r' }), 'copilot', 'the hook marker beats an inherited Claude variable');
  assert.equal(hostFromEnv({ CLAUDE_PROJECT_DIR: '/r' }), 'claude');
  assert.equal(hostFromEnv({ CLAUDE_SESSION_ID: 's' }), 'claude');
  assert.equal(hostFromEnv({}), null);
});

test('resolveScope (I1): a record only under another host is reported, never a silent no-scope', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const t = tmp();
  putScope(t, 'claude/c1.json', rec('c1', { batch: 'b1' }));
  assert.deepEqual(resolveScope(t, 'copilot', 'c1', START), { scope: null, ambiguous: [], misfiled: ['claude/c1.json'] });
  assert.deepEqual(resolveScope(t, 'claude', 'c1', START).misfiled, undefined, 'its own host reads it');
});

test('capture (I1): a record filed under another host is reported on stderr', () => {
  const repo = tmp(); const proj = tmp(); const empty = tmp();
  const transcript = writeClaudeFixture(proj, 'mis', { withSub: false });
  const tdir = join(repo, '.agents', 'telemetry', 'automation');
  putScope(tdir, 'copilot/mis.json', rec('mis', { intent: 'story' }));
  const SCRIPT = new URL('./telemetry-capture.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [SCRIPT, '--transcript', transcript, '--session', 'mis', '--cwd', repo], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: empty, TOKENOMICS_MIGRATIONS: SR, TOKENOMICS_NO_CCUSAGE: '1', TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_SINK: '1', TOKENOMICS_NO_BATCH_COST: '1', TOKENOMICS_CLAUDE_ROOT: empty, TOKENOMICS_COPILOT_ROOT: empty, TOKENOMICS_VSCODE_ROOT: empty },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /scope for claude:mis: the only record is copilot\/mis\.json \(another host's\) — not stamped/);
});

test('resolveScope (I2): an unreadable, dangling or directory pending entry is skipped, the own record still resolves', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const { symlinkSync } = await import('node:fs');
  const t = tmp();
  putScope(t, 'claude/s.json', rec('s', { intent: 'docs' }));
  symlinkSync(join(t, 'scopes', 'gone.json'), join(t, 'scopes', 'pending-zzz.json'));
  mkdirSync(join(t, 'scopes', 'pending-dir.json'));
  assert.equal(resolveScope(t, 'claude', 's', START).scope?.intent, 'docs');
  putScope(t, 'pending-ok.json', rec('pending-ok', { intent: 'story' }));
  assert.equal(resolveScope(t, 'claude', 's', START).scope?.intent, 'story', 'a readable pending record is still claimed past the bad entries');
});

test('resolveScope (M4): a pending record stamped with another host is never claimed; a host-less one keeps the precedence', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const t = tmp();
  putScope(t, 'claude/S.json', rec('S', { intent: 'bugfix' }));                       // Claude session S self-declared
  putScope(t, 'copilot/pending-cp.json', rec('pending-cp', { intent: 'story' }));     // Copilot `open --session auto` (host known)
  assert.equal(resolveScope(t, 'claude', 'S', START).scope.intent, 'bugfix', 'a Claude session never takes a Copilot declaration');
  assert.ok(existsSync(join(t, 'scopes', 'copilot', 'pending-cp.json')));
  const c = resolveScope(t, 'copilot', 'C', START);
  assert.equal(c.scope.intent, 'story');
  assert.equal(c.scope.claimedFrom, 'pending-cp');
  assert.ok(!existsSync(join(t, 'scopes', 'copilot', 'pending-cp.json')));
  putScope(t, 'pending-any.json', rec('pending-any', { intent: 'other' }));
  assert.equal(resolveScope(t, 'claude', 'S', START).scope.intent, 'other', 'host-less pending: spec precedence (claimed pending > other)');
});

test('resolveScope (M6): a crash after the merged write and before the unlink is not re-merged', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const t = tmp();
  putScope(t, 'claude/A.json.claim', rec('pending-c', { outcomes: { 'X-1': { outcome: 'blocked', at: 'P' } } }));
  putScope(t, 'claude/A.json', rec('A', { claimedFrom: 'pending-c', outcomes: { 'X-1': { outcome: 'delivered', at: 'L' } } }));
  const r = resolveScope(t, 'claude', 'A', null);
  assert.equal(r.scope.outcomes['X-1'].outcome, 'delivered', 'the later outcome survives');
  assert.ok(!existsSync(join(t, 'scopes', 'claude', 'A.json.claim')));
});

test('resolveScope (M6, M1): recovery merges an existing own record — host-qualified, or legacy flat (then removed)', async () => {
  const { resolveScope } = await import('./telemetry-capture.mjs');
  const pending = rec('pending-c', { intent: 'story', outcomes: { 'X-1': { outcome: 'delivered', at: 'P' } } });
  const own = rec('A', { intent: 'bugfix', outcomes: { 'X-9': { outcome: 'done', at: 'O' } }, closedAt: 'C' });
  for (const where of ['claude/A.json', 'A.json']) {
    const t = tmp();
    putScope(t, 'claude/A.json.claim', pending);
    putScope(t, where, own);
    const r = resolveScope(t, 'claude', 'A', null);
    assert.equal(r.scope.intent, 'story', where);
    assert.deepEqual(Object.keys(r.scope.outcomes), ['X-1', 'X-9'], where);
    assert.equal(r.scope.closedAt, 'C', where);
    assert.equal(r.scope.claimedFrom, 'pending-c', where);
    assert.deepEqual(r.ambiguous, [], `${where}: a displaced flat record is removed`);
    assert.ok(!existsSync(join(t, 'scopes', 'A.json')));
  }
});

test('resolveScope (M2): the merged record is written atomically (temp file, then rename)', async () => {
  const { readFileSync: rf } = await import('node:fs');
  const src = rf(new URL('../engine/scopes.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const writeScopeFile'), src.indexOf('\n', src.indexOf('const writeScopeFile')) + 400);
  assert.match(body, /renameSync/, 'writeScopeFile renames a temp file into place');
});

// --- B2 item 11: writer (map D4, O7; owner Q14) --------------------------------------------------------------
const WR = 'writer';
const PIN = 'TOKENOMICS_ENGINE_VERSION_PIN';
const withPin = (v, fn) => {
  const was = process.env[PIN];
  process.env[PIN] = v;
  try { return fn(); } finally { if (was === undefined) delete process.env[PIN]; else process.env[PIN] = was; }
};
const measured = (id) => ({ v: 1, host: 'claude', id, user: 'tester', capturedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T09:59:00.000Z', tokens: null });
const lastLine = (repo) => readRecords(ledgerPath(repo, 'tester')).at(-1);

test('appendLine stamps writer + manifestRevision; module.json revision; implied → 1', () => {
  withPin('1.2.0', () => {
    const repo = tmp();
    under(WR, () => appendLine(repo, 'tester', measured('a')));
    let l = lastLine(repo);
    assert.deepEqual(Object.keys(l).slice(0, 4), ['v', 'writer', 'manifestRevision', 'host'], 'right after v (§3.2 order)');
    assert.equal(l.writer, 'tokenomics-engine@1.2.0');
    assert.equal(l.manifestRevision, 1, 'no module.json: the implied TA manifest, revision 1');
    // module.json at revision 2 → the line records 2
    const dir = join(repo, '.agents', 'telemetry', 'automation');
    writeFileSync(join(dir, 'module.json'), JSON.stringify({ module: 'tokenomics', schema_version: '1.0', domain: 'd', manifestRevision: 2 }));
    under(WR, () => appendLine(repo, 'tester', measured('b')));
    l = lastLine(repo);
    assert.deepEqual([l.writer, l.manifestRevision], ['tokenomics-engine@1.2.0', 2]);
    // none: the reference line, no stamp
    under('none', () => appendLine(repo, 'tester', measured('c')));
    l = lastLine(repo);
    assert.ok(!('writer' in l) && !('manifestRevision' in l), 'none writes no writer field');
    assert.deepEqual(Object.keys(l), Object.keys(measured('c')));
    // a restamp append keeps the caller's provenance (O7): never the current writer or revision
    const re = { v: 1, writer: 'tokenomics-engine@0.9.0', manifestRevision: 1, restampedBy: 'tokenomics-engine@1.2.0', ...measured('d') };
    under(WR, () => appendLine(repo, 'tester', re, undefined, { restamp: true }));
    assert.deepEqual(lastLine(repo), re);
  });
});

test('writer: every capture path stamps its lines (Claude direct + sweep, Copilot, VS Code)', async () => {
  const repo = tmp(); const claudeRoot = tmp(); const copRoot = tmp(); const vsRoot = tmp();
  const old = new Date('2026-07-30T11:00:00Z');
  writeClaudeFixture(claudeRoot, 'cl-1', { withSub: false });
  utimesSync(join(claudeRoot, 'cl-1.jsonl'), old, old);
  mkdirSync(join(copRoot, 'cp-1'), { recursive: true });
  writeFileSync(join(copRoot, 'cp-1', 'events.jsonl'), jsonl(copilotEvents({ cwd: repo })));
  utimesSync(join(copRoot, 'cp-1', 'events.jsonl'), old, old);
  const hash = join(vsRoot, 'h1');
  mkdirSync(join(hash, 'chatSessions'), { recursive: true });
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
  writeFileSync(join(hash, 'chatSessions', 'vs-1.jsonl'), vscodeOplog());
  const vsOld = new Date('2026-08-01T10:00:00Z');
  utimesSync(join(hash, 'chatSessions', 'vs-1.jsonl'), vsOld, vsOld);
  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot, TOKENOMICS_COPILOT_ROOT: copRoot, TOKENOMICS_VSCODE_ROOT: vsRoot };
  withPin('1.2.0', () => under(WR, () => sweep(repo, { config: CFG, user: 'tester', env, all: true })));
  const lines = readRecords(ledgerPath(repo, 'tester'));
  assert.deepEqual(lines.map((l) => l.host).sort(), ['claude', 'copilot', 'copilot-vscode']);
  for (const l of lines) assert.deepEqual([l.writer, l.manifestRevision], ['tokenomics-engine@1.2.0', 1], l.host);
});

// Review Focus 3: a second sweep over sessions already captured, once lines carry writer/manifestRevision/
// tokensBasis/nulls, appends nothing. VS Code timestamp-less sessions are excluded: they are re-appended on every
// sweep in every era (a known reference defect owned by Task 19, pinned above).
test('sweep twice with every migration on → one line per session (Review Focus 3)', () => {
  const repo = tmp(); const claudeRoot = tmp(); const copRoot = tmp(); const vsRoot = tmp();
  const old = new Date('2026-07-30T11:00:00Z');
  writeClaudeFixture(claudeRoot, 'cl-ts', { withSub: true });
  utimesSync(join(claudeRoot, 'cl-ts.jsonl'), old, old);
  writeFileSync(join(claudeRoot, 'cl-nots.jsonl'), jsonl(stampless(claudeRecords())));
  utimesSync(join(claudeRoot, 'cl-nots.jsonl'), old, old);
  for (const [id, ev] of [['cp-ts', copilotEvents({ cwd: repo, agent: 'test-automation-lead' })], ['cp-nots', stampless(copilotEvents({ cwd: repo }))], ['cp-nu', usageless(repo, { sub: { totalTokens: 5 } })]]) {
    mkdirSync(join(copRoot, id), { recursive: true });
    writeFileSync(join(copRoot, id, 'events.jsonl'), jsonl(ev));
    utimesSync(join(copRoot, id, 'events.jsonl'), old, old);
  }
  const hash = join(vsRoot, 'h1');
  mkdirSync(join(hash, 'chatSessions'), { recursive: true });
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
  writeFileSync(join(hash, 'chatSessions', 'vs-ts.jsonl'), vscodeOplog());
  const vsOld = new Date('2026-08-01T10:00:00Z');
  utimesSync(join(hash, 'chatSessions', 'vs-ts.jsonl'), vsOld, vsOld);
  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot, TOKENOMICS_COPILOT_ROOT: copRoot, TOKENOMICS_VSCODE_ROOT: vsRoot };
  under('', () => {   // TOKENOMICS_MIGRATIONS empty = every landed migration
    assert.equal(sweep(repo, { config: CFG, user: 'tester', env, all: true }).captured, 6);
    assert.equal(sweep(repo, { config: CFG, user: 'tester', env, all: true }).captured, 0, 'the second sweep appends nothing');
  });
  const lines = readRecords(ledgerPath(repo, 'tester'));
  assert.deepEqual(lines.map((l) => l.id).sort(), ['cl-nots', 'cl-ts', 'cp-nots', 'cp-nu', 'cp-ts', 'vs-ts'], 'one line per session');
  for (const l of lines) assert.ok(typeof l.writer === 'string' && Number.isInteger(l.manifestRevision), `${l.id} stamped`);
  assert.ok(lines.filter((l) => l.host === 'copilot').every((l) => l.tokensBasis === 'inclusive'));
});

test('kit check over writer after-lines: --mode mixed beside reference-era lines → no error; --mode port on the writer lines → no error', async () => {
  const { check } = await import('../kit/check.mjs');
  const repo = tmp(); const claudeRoot = tmp(); const copRoot = tmp(); const vsRoot = tmp();
  const old = new Date('2026-07-30T11:00:00Z');
  writeClaudeFixture(claudeRoot, 'k-cl', { withSub: true });
  utimesSync(join(claudeRoot, 'k-cl.jsonl'), old, old);
  mkdirSync(join(copRoot, 'k-cp'), { recursive: true });
  writeFileSync(join(copRoot, 'k-cp', 'events.jsonl'), jsonl(copilotEvents({ cwd: repo, agent: 'test-automation-lead' })));
  utimesSync(join(copRoot, 'k-cp', 'events.jsonl'), old, old);
  const hash = join(vsRoot, 'h1');
  mkdirSync(join(hash, 'chatSessions'), { recursive: true });
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
  writeFileSync(join(hash, 'chatSessions', 'k-vs.jsonl'), vscodeOplog());
  const vsOld = new Date('2026-08-01T10:00:00Z');
  utimesSync(join(hash, 'chatSessions', 'k-vs.jsonl'), vsOld, vsOld);
  const env = { TOKENOMICS_CLAUDE_ROOT: claudeRoot, TOKENOMICS_COPILOT_ROOT: copRoot, TOKENOMICS_VSCODE_ROOT: vsRoot };
  // the same sessions captured once by the reference-era writer (none) and once with every migration on
  const refRepo = tmp();
  under('none', () => sweep(refRepo, { config: CFG, user: 'tester', env, all: true }));
  withPin('1.2.0', () => under('', () => sweep(repo, { config: CFG, user: 'tester', env, all: true })));
  const writerLines = readRecords(ledgerPath(repo, 'tester'));
  const refLines = readRecords(ledgerPath(refRepo, 'tester'));
  assert.equal(writerLines.length, 3);
  assert.ok(writerLines.every((l) => 'writer' in l) && refLines.every((l) => !('writer' in l)));
  const telem = (lines) => { const t = tmp(); mkdirSync(join(t, 'automation')); writeFileSync(join(t, 'automation', 'usage-tester.jsonl'), jsonl(lines)); return t; };
  const errors = (r) => r.findings.filter((f) => f.class === 'error');
  assert.deepEqual(errors(check(telem([...refLines, ...writerLines]), { mode: 'mixed' })), [], 'mixed');
  assert.deepEqual(errors(check(telem(writerLines), { mode: 'port' })), [], 'port');
});

test('writer (review round 1, I1): a present but unusable module.json stamps manifestRevision null, never the implied 1', () => {
  withPin('1.2.0', () => {
    const repo = tmp();
    const dir = join(repo, '.agents', 'telemetry', 'automation');
    mkdirSync(join(dir, 'manifests'), { recursive: true });
    // no manifestRevision (a non-TA install's hand-written module.json)
    writeFileSync(join(dir, 'module.json'), JSON.stringify({ module: 'tokenomics', schema_version: '1.0', domain: 'stories', ratioIntents: ['feature'] }));
    under(WR, () => appendLine(repo, 'tester', measured('a')));
    let l = lastLine(repo);
    assert.ok('manifestRevision' in l, 'never dropped (O1)');
    assert.equal(l.manifestRevision, null);
    // unparseable (a hand edit while bumping to revision 3), with archives 1 and 3 present
    writeFileSync(join(dir, 'manifests', '1.json'), JSON.stringify({ module: 'tokenomics', schema_version: '1.0', domain: 'd', manifestRevision: 1, ratioIntents: ['old'] }));
    writeFileSync(join(dir, 'module.json'), '{"module":"tokenomics",,"manifestRevision":3}');
    under(WR, () => appendLine(repo, 'tester', measured('b')));
    l = lastLine(repo);
    assert.equal(l.manifestRevision, null, 'never revision 1 under a broken module.json');
  });
});

// --- capture-robustness group (B2 items 14-17, 21) ----------------------------------------------------------
const CR = 'capture-robustness';

test('capture-robustness (14): findSubagents sorts an unsorted readdirSync listing; off keeps the listing order', async () => {
  const { findSubagents } = await import('./telemetry-capture.mjs');
  const proj = tmp();
  const d = join(proj, 'sess-s', 'subagents');
  mkdirSync(d, { recursive: true });
  for (const id of ['a', 'b', 'c']) {
    writeFileSync(join(d, `agent-${id}.meta.json`), JSON.stringify({ agentType: id }));
    writeFileSync(join(d, `agent-${id}.jsonl`), '');
  }
  const ent = (name) => ({ name, isDirectory: () => false });
  const fs = { readdirSync: (dir, o) => (dir === d ? ['agent-b.meta.json', 'agent-a.meta.json', 'agent-c.meta.json'].map(ent) : require_real(dir, o)) };
  const ids = (mig) => under(mig, () => findSubagents(proj, 'sess-s', { fs })).map((s) => s.id);
  assert.deepEqual(ids(CR), ['agent-a', 'agent-b', 'agent-c']);
  assert.deepEqual(ids('none'), ['agent-b', 'agent-a', 'agent-c'], 'the reference trusts the listing');
});
const require_real = (dir, o) => readdirSync(dir, o);

test('capture-robustness (15): a directory transcript path skips that dispatch with a stderr note, the rest are recorded', () => {
  const repo = tmp(); const proj = tmp();
  const d = join(proj, 'sess-e', 'subagents');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(proj, 'sess-e.jsonl'), jsonl([{ type: 'agent-setting', agentSetting: 'x' }]));
  for (const id of ['a1', 'a2']) writeFileSync(join(d, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'qa' }));
  mkdirSync(join(d, 'agent-a1.jsonl'));                       // a directory where the transcript should be
  writeFileSync(join(d, 'agent-a2.jsonl'), jsonl([
    { type: 'user', isSidechain: true, timestamp: '2026-07-30T10:00:00Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', timestamp: '2026-07-30T10:01:00Z', message: { id: 'm', usage: { input_tokens: 1, output_tokens: 2 }, content: [] } },
  ]));
  const run = (mig) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { captureDispatches, readDispatchLog, dispatchLogPath } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, 'telemetry-capture.mjs')).href)};
     let n; try { n = captureDispatches(${JSON.stringify(repo)}, 'sess-e', { projectDir: ${JSON.stringify(proj)}, config: { priceAtCapture: false } }); } catch (e) { n = 'threw ' + e.code; }
     console.log(JSON.stringify({ n, keys: [...readDispatchLog(dispatchLogPath(${JSON.stringify(repo)}, 'sess-e')).keys()] }));`],
  { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TOKENOMICS_MIGRATIONS: mig, TOKENOMICS_NO_CCUSAGE: '1' } });
  const off = run('none');
  assert.match(JSON.parse(off.stdout).n, /threw EISDIR/, 'reference: the loop aborts');
  const on = run(CR);
  assert.deepEqual(JSON.parse(on.stdout), { n: 1, keys: ['agent-a2'] });
  assert.match(on.stderr, /agent-a1.*directory, skipped/);
  assert.equal(on.status, 0);
});

test('capture-robustness (16): an op-log update two past the end leaves a hole; the session is captured, the hole ignored', () => {
  const ops = [
    { kind: 0, v: { requests: [{ requestId: 'r0', timestamp: 1785849104000, promptTokens: 10, completionTokens: 5 }] } },
    { kind: 1, k: ['requests', 2, 'promptTokens'], v: 99 },   // index 2 with only index 0 present: a hole at 1
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
  assert.throws(() => under('none', () => parseVsCodeChatSession(ops)), TypeError);
  const p = under(CR, () => parseVsCodeChatSession(ops));
  assert.equal(p.requests, 1, 'only the real request counts');
  assert.equal(p.tokens.input, 10);
});

test('capture-robustness (17): a timestamp-less VS Code session is appended once across three sweeps', () => {
  const mk = () => {
    const repo = tmp(); const root = tmp();
    const hash = join(root, 'h1');
    mkdirSync(join(hash, 'chatSessions'), { recursive: true });
    writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
    const f = join(hash, 'chatSessions', 'nots.jsonl');
    writeFileSync(f, [{ kind: 0, v: { requests: [{ requestId: 'r0', promptTokens: 10, completionTokens: 5 }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const old = new Date('2026-08-01T10:00:00Z');
    utimesSync(f, old, old);
    const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp(), TOKENOMICS_VSCODE_ROOT: root };
    return { repo, env, f };
  };
  const sweeps = (mig) => {
    const { repo, env, f } = mk();
    for (let i = 0; i < 3; i++) {
      under(mig, () => sweep(repo, { config: CFG, user: 'tester', env, all: true }));
      const t = new Date(Date.parse('2026-08-02T10:00:00Z') + i * 86400000); utimesSync(f, t, t);   // mtime moves, content does not
    }
    return readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'nots');
  };
  assert.ok(sweeps('none').length > 1, 'reference: re-appended');
  const on = sweeps(CR);
  assert.equal(on.length, 1);
  assert.equal(on[0].endedAt, null);
});

test('capture-robustness (21): a Copilot dispatch log names its host, and a provisional live line carries it', async () => {
  const { captureDispatches, readDispatchLog, dispatchLogPath } = await import('./telemetry-capture.mjs');
  const { loadLiveLines } = await import('../scripts/batch-cost.mjs');
  for (const [mig, want] of [[CR, 'copilot'], ['none', 'claude']]) {
    const r = tmp(); const root = tmp();
    mkdirSync(join(root, 'cl'), { recursive: true });
    writeFileSync(join(root, 'cl', 'events.jsonl'), jsonl([
      { type: 'subagent.started', data: { toolCallId: 'tc1', agentName: 'qa' } },
      { type: 'subagent.completed', timestamp: '2026-07-30T10:00:00Z', data: { toolCallId: 'tc1', agentName: 'qa', totalTokens: 5 } },
    ]));
    const env = { ...process.env, TOKENOMICS_COPILOT_ROOT: root, TOKENOMICS_CLAUDE_ROOT: tmp() };
    assert.equal(under(mig, () => captureDispatches(r, 'cl', { config: CFG, env })), 1);
    assert.equal(readDispatchLog(dispatchLogPath(r, 'cl')).get('tc1').host, mig === CR ? 'copilot' : undefined);
    assert.equal(under(mig, () => loadLiveLines(r))[0].host, want, mig);
  }
});

test('capture-robustness (17, review I1): a grown timestamp-less VS Code session is re-appended once, superseding, never double-counted', async () => {
  const { dedupLines } = await import('../scripts/team-report.mjs');
  const repo = tmp(); const root = tmp();
  const hash = join(root, 'h1');
  mkdirSync(join(hash, 'chatSessions'), { recursive: true });
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
  const f = join(hash, 'chatSessions', 'grow.jsonl');
  const req = (id, p) => JSON.stringify({ kind: 0, v: { requests: [{ requestId: id, promptTokens: p, completionTokens: 1 }] } });
  writeFileSync(f, `${req('r0', 10)}\n`);
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp(), TOKENOMICS_VSCODE_ROOT: root };
  let day = 0;
  const sweepAt = () => { const t = new Date(Date.parse('2026-08-02T10:00:00Z') + (day++) * 86400000); utimesSync(f, t, t); return under(`${CR},null-unobservable`, () => sweep(repo, { config: CFG, user: 'tester', env, all: true })).captured; };
  assert.equal(sweepAt(), 1);
  assert.equal(sweepAt(), 0, 'unchanged: nothing');
  appendFileSync(f, `${JSON.stringify({ kind: 1, k: 'requests', i: 1, v: [{ requestId: 'r1', promptTokens: 20, completionTokens: 2 }] })}\n`);
  assert.equal(sweepAt(), 1, 'grown: re-appended');
  assert.equal(sweepAt(), 0);
  assert.equal(sweepAt(), 0);
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'grow');
  assert.deepEqual(lines.map((l) => l.turns), [1, 2]);
  assert.equal(lines[1].activeMin, null, 'Q8b: activeMin stays null');
  const kept = dedupLines(lines);
  assert.equal(kept.length, 1, 'readers keep one line per host:id');
  assert.equal(kept[0].tokens.input, 30, 'the grown line supersedes, it is not summed with the first');
});

test('B2-08 (Codex): a billing patch that leaves turns and tokens unchanged supersedes the earlier timestamp-less line, never conflicts', async () => {
  const { dedupLines, dedupConflicts } = await import('../scripts/team-report.mjs');
  const repo = tmp(); const root = tmp();
  const hash = join(root, 'h1');
  mkdirSync(join(hash, 'chatSessions'), { recursive: true });
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
  const f = join(hash, 'chatSessions', 'credits.jsonl');
  writeFileSync(f, `${JSON.stringify({ kind: 0, v: { requests: [{ requestId: 'r0', promptTokens: 10, completionTokens: 5 }] } })}\n`);
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp(), TOKENOMICS_VSCODE_ROOT: root };
  let day = 0;
  const sweepAt = () => { const t = new Date(Date.parse('2026-08-02T10:00:00Z') + (day++) * 86400000); utimesSync(f, t, t); return under(`${CR},null-unobservable`, () => sweep(repo, { config: CFG, user: 'tester', env, all: true })).captured; };
  assert.equal(sweepAt(), 1);
  assert.equal(sweepAt(), 0, 'unchanged: nothing');
  appendFileSync(f, `${JSON.stringify({ kind: 1, k: ['requests', 0, 'copilotCredits'], v: 2 })}\n`);
  assert.equal(sweepAt(), 1, 'cost went null to measured: superseding line');
  assert.equal(sweepAt(), 0);
  assert.equal(sweepAt(), 0);
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'credits');
  assert.deepEqual(lines.map((l) => l.costUsd), [null, 0.02]);
  assert.equal(lines[0].turns, lines[1].turns);
  assert.deepEqual(lines[0].tokens, lines[1].tokens);
  assert.ok(Date.parse(lines[1].capturedAt) > Date.parse(lines[0].capturedAt), 'strictly later capturedAt');
  assert.equal(dedupConflicts(lines).conflicts.length, 0, 'supersession, not a conflict');
  const kept = dedupLines(lines);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].costUsd, 0.02);
});

test('M1 (Plan 4 final review): a restamped timestamp-less VS Code line is not superseded by a re-capture of the unchanged file (O7)', async () => {
  const { restampedLine } = await import('../scripts/work-scope.mjs');
  const repo = tmp(); const root = tmp();
  const hash = join(root, 'h1');
  mkdirSync(join(hash, 'chatSessions'), { recursive: true });
  writeFileSync(join(hash, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(repo).href }));
  const f = join(hash, 'chatSessions', 'rest.jsonl');
  writeFileSync(f, `${JSON.stringify({ kind: 0, v: { requests: [{ requestId: 'r0', promptTokens: 10, completionTokens: 5 }] } })}\n`);
  const env = { TOKENOMICS_CLAUDE_ROOT: tmp(), TOKENOMICS_COPILOT_ROOT: tmp(), TOKENOMICS_VSCODE_ROOT: root };
  let day = 0;
  const sweepAt = () => { const t = new Date(Date.parse('2026-08-02T10:00:00Z') + (day++) * 86400000); utimesSync(f, t, t); return under('', () => sweep(repo, { config: CFG, user: 'tester', env, all: true })).captured; };
  assert.equal(sweepAt(), 1);
  const [winner] = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'rest');
  const re = restampedLine({ ...winner, manifestRevision: 9, writer: 'tokenomics-engine@0.0.1' }, winner.scope ?? null, { restampedBy: 'tokenomics-engine@9.9.9', now: new Date(Date.parse(winner.capturedAt) + 60000).toISOString() });
  under('', () => appendLine(repo, 'tester', re, undefined, { restamp: true }));
  assert.equal(sweepAt(), 0, 'restamp provenance is not measurement state');
  const lines = readRecords(ledgerPath(repo, 'tester')).filter((l) => l.id === 'rest');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].restampedBy, 'tokenomics-engine@9.9.9');
  assert.equal(lines[1].manifestRevision, 9, 'the restamped line keeps its original revision binding');
});

// --- B2-07 (Codex): the provisional live parent is not measured yet ----------------------------------------------
function liveRepo(rec) {
  const repo = tmp();
  const tele = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(join(tele, 'scopes'), { recursive: true });
  mkdirSync(join(tele, 'live'), { recursive: true });
  writeFileSync(join(tele, 'scopes', 's.json'), JSON.stringify({ v: 1, session: 's', intent: 'automation', batch: 'g', cases: ['TC-1'], declaredAt: 'x', updatedAt: 'x' }));
  writeFileSync(join(tele, 'live', 's.jsonl'), `${JSON.stringify({ v: 1, host: 'copilot', agentId: 'd', cases: ['TC-1'], label: 'TC-1', ...rec })}\n`);
  const dir = join(repo, '.agents', 'automation', 'g');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ cases: [{ id: 'TC-1', outcome: 'delivered' }] }));
  return repo;
}
const UNMEAS = { tokens: null, activeMin: null, toolCalls: null, toolErrors: null };

test('B2-07 live line: with null-unobservable the unmeasured parent is null, not an invented zero; migrations off keeps the zeros', async () => {
  const { loadLiveLines, updateBatchCosts } = await import('../scripts/batch-cost.mjs');
  const { renderLiveReport } = await import('./telemetry-capture.mjs');
  const repo = liveRepo(UNMEAS);
  const off = under('none', () => loadLiveLines(repo)[0]);
  assert.deepEqual(off.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(off.turns, 0);
  under(NU, () => {
    const line = loadLiveLines(repo)[0];
    assert.equal(line.tokens, null);
    assert.equal(line.turns, null);
    assert.equal(line.toolCalls, null);
    assert.equal(line.toolErrors, null);
    const t = updateBatchCosts(repo, { write: false })[0].totals;
    assert.equal(t.tokens, null, 'every live unit is unmeasured: null, not 0');
    assert.equal(t.turns, null);
    assert.equal(t.unmeasured.turns, 1);
    assert.equal(t.unmeasured.tokens, 2, 'parent and dispatch');
    assert.equal(t.toolCalls, null);
    assert.equal(t.toolErrors, null);
    assert.equal(t.unmeasured.toolCalls, 2);
    assert.notEqual(updateBatchCosts(repo, { write: false })[0].tokensAttribution, 'partial');
  });
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = NU;   // `under` is synchronous; renderLiveReport is async
  let html;
  try { html = readFileSync((await renderLiveReport(repo, 's', {}))[0], 'utf8'); } finally { process.env.TOKENOMICS_MIGRATIONS = was; }
  const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Total incl\. cache — \(2 unmeasured\)/);
  assert.match(text, /Turns — \(1 unmeasured\)/);
  assert.match(text, /Tool calls — \(2 unmeasured\)/);
});

test('B2-07 live line: an observed zero dispatch stays zero; only the parent is unmeasured', () => {
  const repo = liveRepo({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, activeMin: 0, toolCalls: 0, toolErrors: 0 });
  return import('../scripts/batch-cost.mjs').then(({ updateBatchCosts }) => under(NU, () => {
    const t = updateBatchCosts(repo, { write: false })[0].totals;
    assert.equal(t.tokens, 0, 'the dispatch measured zero');
    assert.equal(t.unmeasured.tokens, 1, 'the parent only');
    assert.equal(t.toolCalls, 0);
    assert.equal(t.unmeasured.toolCalls, 1);
    assert.equal(t.turns, null);
  }));
});

// Codex B2-10: under reports-location a group directory (reports/<group>/) and a live page must never share a name.
// Groups `foo` and `foo.html` (both valid) used to meet at reports/foo.html; `a/b` and `a-b` met at a-b.html.
async function collisionRepo() {
  const repo = tmp();
  const put = (rel, data) => { const p = join(repo, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, `${JSON.stringify(data)}\n`); };
  put('.agents/tokenomics/settings.json', { extension: null });
  for (const slug of ['foo', 'foo.html']) put(`.agents/automation/${slug}/report.json`, { cases: [{ id: slug, outcome: 'delivered' }] });
  put('.agents/telemetry/automation/scopes/s.json', { v: 1, session: 's', batch: 'foo', cases: ['foo'], intent: 'automation' });
  return repo;
}
const withRl = async (fn) => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = 'reports-location';
  try { return await fn(); } finally { if (was === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = was; }
};
const runBatch = (repo, batch) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/batch-cost.mjs', import.meta.url)), repo, '--batch', batch],
  { encoding: 'utf8', env: { ...process.env, TOKENOMICS_MIGRATIONS: 'reports-location', TOKENOMICS_NO_CCUSAGE: '1' } });

test('reports-location: live page first, then batch-cost for foo.html, both survive (B2-10)', async () => {
  const { renderLiveReport } = await import('./telemetry-capture.mjs');
  const repo = await collisionRepo();
  const live = await withRl(() => renderLiveReport(repo, 's', {}));
  assert.equal(live?.length, 1);
  const r = runBatch(repo, 'foo.html');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(live[0]), 'the live page is still there');
  assert.ok(existsSync(join(repo, '.agents/telemetry/automation/reports/foo.html/cost.json')));
});

test('reports-location: batch-cost for foo.html first, then the live page for foo (B2-10)', async () => {
  const { renderLiveReport } = await import('./telemetry-capture.mjs');
  const repo = await collisionRepo();
  const r = runBatch(repo, 'foo.html');
  assert.equal(r.status, 0, r.stderr);
  const live = await withRl(() => renderLiveReport(repo, 's', {}));
  assert.equal(live?.length, 1, 'the live write is not swallowed');
  assert.ok(existsSync(live[0]));
  assert.ok(existsSync(join(repo, '.agents/telemetry/automation/reports/foo.html/cost.json')));
});

test('reports-location: live page names are injective (a/b and a-b stay distinct) and outside reports/ (B2-10)', async () => {
  const { liveReportPath, loadSettings } = await import('../engine/config.mjs');
  const repo = await collisionRepo();
  const s = await withRl(() => loadSettings(repo));
  const paths = ['a/b', 'a-b', 'a%2Fb', 'foo', 'foo.html'].map((b) => liveReportPath(repo, s, b));
  assert.equal(new Set(paths).size, paths.length);
  for (const p of paths) assert.ok(!p.includes(join('automation', 'reports') + '/'), p);
});
