// Tests for scope-hook.mjs — announce / mark-dispatch / gate decisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceLine, markDispatch, gateDecision, gateDecision as gateDecision0, sweepMarkers, scopesDir } from './scope-hook.mjs';
import { openScope, closeScope } from '../scripts/work-scope.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'scope-hook-'));
// B2: the pre-existing tests pin the reference behaviour, so this file runs under TOKENOMICS_MIGRATIONS=none
// unless a test sets it.
process.env.TOKENOMICS_MIGRATIONS = 'none';
const SCRIPT = fileURLToPath(new URL('./scope-hook.mjs', import.meta.url));
const runHook = (args, payload, env = {}) => execFileSync('node', [SCRIPT, ...args], {
  input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env },
});

test('announceLine: no scope → the ask, carrying the session id and the script path', () => {
  const repo = tmp();
  const line = announceLine(repo, 'sess-1');
  assert.match(line, /session sess-1/);
  assert.match(line, /work-scope\.mjs open --session sess-1/);
  // The label vocabulary is SUGGESTED, not enforced — sessions that all
  // collapse into "other" say nothing about where the money went.
  assert.match(line, /investigation/, 'more than one non-automation label is offered');
  assert.match(line, /other/);
  assert.match(line, /only this intent feeds cost-per-case/, 'says which label the $/case figures use');
  assert.equal(announceLine(repo, ''), null, 'no session id → inject nothing');
});

test('announceLine: existing scope → digest, so resume//clear keeps the batch in context', () => {
  const repo = tmp();
  openScope(repo, { session: 'sess-2', batch: 'b1', cases: ['TC-1', 'TC-2'] });
  const line = announceLine(repo, 'sess-2');
  assert.match(line, /automation \/ batch b1/);
  assert.match(line, /2 case\(s\)/);
});

test('gateDecision: blocks exactly once — and only when work was dispatched with no scope', () => {
  const repo = tmp();
  // no dispatch marker → silent
  assert.equal(gateDecision(repo, { session_id: 's1' }), null);
  markDispatch(repo, 's1');
  // dispatched, undeclared → block, once
  const out = gateDecision(repo, { session_id: 's1' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /open --session s1/);
  assert.equal(gateDecision(repo, { session_id: 's1' }), null, 'nagged marker prevents a second block');
});

// A lead reliably does the git half of closing and then writes its own summary
// in chat — measured on a real batch: scope declared, outcomes recorded,
// merged, cleaned up… and no report, because nothing asked. Declaring got done
// precisely because the gate asked. This is host- and mode-independent: it only
// reads files, so it holds for a Workflow run or a sequential dispatch loop.
test('gateDecision: asks ONCE to close when the batch has a receipt and the scope is open', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  // B1 Task 10: the second gate is the TA extension's stopGateCheck hook.
  const ta = await import('../extensions/test-automation.mjs');
  const gateDecision = (repo, payload) => gateDecision0(repo, payload, undefined, undefined, ta);
  const repo = tmp();
  openScope(repo, { session: 's-open', batch: 'b7', cases: ['TC-1'] });
  // no receipt yet → the batch is still running, say nothing
  assert.equal(gateDecision(repo, { session_id: 's-open' }), null);
  const dir = join(repo, '.agents', 'automation', 'b7');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ batch: 'b7', cases: [{ id: 'TC-1', outcome: 'automated' }] }));

  const out = gateDecision(repo, { session_id: 's-open' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /close --session s-open/);
  assert.match(out.reason, /batch-report\.md/);
  assert.equal(gateDecision(repo, { session_id: 's-open' }), null, 'asked once, never again');

  // a nested campaign wave's receipt is found too
  const repo2 = tmp();
  openScope(repo2, { session: 's-w', batch: 'wave-01', cases: [] });
  const wdir = join(repo2, '.agents', 'automation', 'camp', 'wave-01');
  mkdirSync(wdir, { recursive: true });
  writeFileSync(join(wdir, 'report.json'), '{}');
  assert.equal(gateDecision(repo2, { session_id: 's-w' })?.decision, 'block');
});

test('gateDecision: a CLOSED scope is never nagged', () => {
  const repo = tmp();
  openScope(repo, { session: 's-done', batch: 'b8', cases: [] });
  closeScope(repo, { session: 's-done' });
  const dir = join(repo, '.agents', 'automation', 'b8');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), '{}');
  assert.equal(gateDecision(repo, { session_id: 's-done' }), null);
});

test('gateDecision: declared scope or an active stop chain never blocks', () => {
  const repo = tmp();
  markDispatch(repo, 's2');
  openScope(repo, { session: 's2', intent: 'other' });
  assert.equal(gateDecision(repo, { session_id: 's2' }), null, 'intent:other satisfies the contract');
  markDispatch(repo, 's3');
  assert.equal(gateDecision(repo, { session_id: 's3', stop_hook_active: true }), null, 'never block a continuation');
  assert.equal(gateDecision(repo, {}), null, 'payload without a session id → do nothing');
});

// Copilot: camelCase payload (sessionId, cwd) and hook stdout parsed as JSON —
// announce wraps its line in {additionalContext}; the gate emits the identical
// decision/reason shape both hosts accept.
test('CLI: Copilot encoding — payload cwd + sessionId honored, --json wraps announce', () => {
  const repo = tmp();
  const out = runHook(['--announce', '--json'], { sessionId: 'cp-1', cwd: repo });
  const parsed = JSON.parse(out);
  assert.match(parsed.additionalContext, /session cp-1/);
  assert.match(parsed.additionalContext, /open --session cp-1/);
  // Claude encoding: raw text, session_id snake_case, repo from env
  const claude = runHook(['--announce'], { session_id: 'cl-1' }, { CLAUDE_PROJECT_DIR: repo });
  assert.match(claude, /^tokenomics \[session cl-1\]/);
  // gate end-to-end over the same dir: dispatch marker via CLI, then block JSON
  runHook(['--mark-dispatch'], { sessionId: 'cp-1', cwd: repo });
  const gate = JSON.parse(runHook(['--gate'], { sessionId: 'cp-1', cwd: repo }));
  assert.equal(gate.decision, 'block');
  assert.equal(runHook(['--gate'], { sessionId: 'cp-1', cwd: repo }), '', 'second stop: silent');
});

test('sweepMarkers: stale pending/nagged markers removed, fresh ones and scopes kept', () => {
  const repo = tmp();
  const dir = scopesDir(repo);
  mkdirSync(dir, { recursive: true });
  markDispatch(repo, 'old');
  const old = new Date(Date.now() - 10 * 86_400_000);
  utimesSync(join(dir, '.pending-old'), old, old);
  markDispatch(repo, 'fresh');
  writeFileSync(join(dir, 'kept.json'), '{}');
  assert.equal(sweepMarkers(repo), 1);
  assert.ok(!existsSync(join(dir, '.pending-old')));
  assert.ok(existsSync(join(dir, '.pending-fresh')));
  assert.ok(existsSync(join(dir, 'kept.json')));
});

// B2 item 8 report-windows (map D1): the suggested ratio intent is the current manifest's, never settings'
test('announceLine / gateDecision: report-windows suggests the current manifest\'s ratio intent; none keeps settings.ratioIntents', () => {
  const run = (mig, fn) => {
    const was = process.env.TOKENOMICS_MIGRATIONS;
    process.env.TOKENOMICS_MIGRATIONS = mig;
    try { return fn(); } finally { if (was === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = was; }
  };
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(dir, { recursive: true });
  run('report-windows', () => assert.match(announceLine(repo, 's1'), /--intent automation`/, 'no module.json → the implied manifest'));
  writeFileSync(join(dir, 'module.json'), JSON.stringify({ module: 'tokenomics', schema_version: '1.0', domain: 'd', manifestRevision: 2, ratioIntents: ['story'] }));
  const line = run('report-windows', () => announceLine(repo, 's1'));
  assert.match(line, /--intent story`/);
  assert.doesNotMatch(line, /--intent automation`/);
  markDispatch(repo, 's2');
  assert.match(run('report-windows', () => gateDecision(repo, { session_id: 's2' })).reason, /--intent story --batch/);
  assert.match(run('none', () => announceLine(repo, 's1')), /--intent automation`/, 'none: settings.ratioIntents (B1_DEFAULTS)');
});

test('announceLine / gateDecision: a manifest without ratio intents never claims an intent feeds the ratio (review M4)', () => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = 'report-windows';
  try {
    const repo = tmp();
    const dir = join(repo, '.agents', 'telemetry', 'automation');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'module.json'), JSON.stringify({ module: 'tokenomics', schema_version: '1.0', domain: 'd', manifestRevision: 2, ratioIntents: [] }));
    const line = announceLine(repo, 's1');
    assert.doesNotMatch(line, /only this intent feeds/);
    assert.match(line, /names no ratio intent, so no intent feeds cost-per-case/);
    markDispatch(repo, 's2');
    assert.match(gateDecision(repo, { session_id: 's2' }).reason, /--intent automation --batch/, 'the default intent is still offered as the label');
  } finally { if (was === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = was; }
});

// B2 item 9 scope-resolution (spec §14.11): announce and gate read the host-qualified record; a legacy flat one still reads
test('announceLine / gateDecision: scope-resolution reads <host>/<session>.json and the legacy flat record', () => {
  const run = (mig, fn) => {
    const was = process.env.TOKENOMICS_MIGRATIONS;
    process.env.TOKENOMICS_MIGRATIONS = mig;
    try { return fn(); } finally { process.env.TOKENOMICS_MIGRATIONS = was; }
  };
  const repo = tmp();
  run('scope-resolution', () => openScope(repo, { session: 'h1', host: 'claude', batch: 'b1', cases: ['TC-1'] }));
  assert.match(run('scope-resolution', () => announceLine(repo, 'h1', undefined, undefined, 'claude')), /automation \/ batch b1/);
  assert.match(run('none', () => announceLine(repo, 'h1')), /declare what this session is for/, 'none: only the flat record is read');
  assert.match(run('scope-resolution', () => announceLine(repo, 'h1', undefined, undefined, 'copilot')), /declare what this session is for/, 'another host\'s record is not this session\'s');
  writeFileSync(join(scopesDir(repo), 'legacy.json'), JSON.stringify({ v: 1, session: 'legacy', intent: 'docs', cases: [] }));
  assert.match(run('scope-resolution', () => announceLine(repo, 'legacy', undefined, undefined, 'claude')), /tokenomics scope \[session legacy\]: docs/);
  markDispatch(repo, 'h1');
  assert.equal(run('scope-resolution', () => gateDecision(repo, { session_id: 'h1' }, undefined, undefined, null, 'claude')), null, 'a declared scope: no nag');
  assert.equal(run('none', () => gateDecision(repo, { session_id: 'h1' })).decision, 'block', 'none: the host-qualified record is invisible');
});

// scope-resolution review round 1
const underSR = (fn) => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = 'scope-resolution';
  try { return fn(); } finally { process.env.TOKENOMICS_MIGRATIONS = was; }
};
test('announceLine / gateDecision (I1, M3): the suggested open names the known host', () => {
  const repo = tmp();
  assert.match(underSR(() => announceLine(repo, 's1', undefined, undefined, 'copilot')), /open --session s1 --host copilot --intent/);
  markDispatch(repo, 's1');
  assert.match(underSR(() => gateDecision(repo, { session_id: 's1' }, undefined, undefined, null, 'copilot')).reason, /open --session s1 --host copilot --intent/);
  assert.match(announceLine(repo, 's2'), /open --session s2 --intent/, 'none: the reference text');
  const out = execFileSync('node', [SCRIPT, '--announce', '--json'], {
    input: JSON.stringify({ sessionId: 's3', cwd: repo }), encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TOKENOMICS_MIGRATIONS: 'scope-resolution', COPILOT_CLI: '1', CLAUDE_PROJECT_DIR: repo },
  });
  assert.match(JSON.parse(out).additionalContext, /open --session s3 --host copilot/, 'the Copilot hook marker wins');
});

test('gateDecision (M5): an ambiguous id is reported as ambiguous, never as undeclared, and no open is suggested', () => {
  const repo = tmp();
  for (const h of ['claude', 'copilot']) underSR(() => openScope(repo, { session: 'amb', host: h }));
  markDispatch(repo, 'amb');
  const out = underSR(() => gateDecision(repo, { session_id: 'amb' }, undefined, undefined, null, 'copilot-vscode'));
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /ambiguous/);
  assert.match(out.reason, /claude\/amb\.json, copilot\/amb\.json/);
  assert.doesNotMatch(out.reason, /declared no scope|open --session/);
  assert.equal(underSR(() => gateDecision(repo, { session_id: 'amb' }, undefined, undefined, null, 'copilot-vscode')), null, 'once');
});
