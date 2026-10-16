// Tests for work-scope.mjs — the session's declared-scope record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openScope, recordOutcomes, closeScope, listScopes, scopePath, scopesDir, safeSession, main } from './work-scope.mjs';

// B2: the pre-existing tests pin the reference behaviour, so this file runs under TOKENOMICS_MIGRATIONS=none
// unless a test says otherwise through `under`.
process.env.TOKENOMICS_MIGRATIONS = 'none';
const under = async (mig, fn) => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = mig;
  try { return await fn(); } finally { process.env.TOKENOMICS_MIGRATIONS = was; }
};
const SR = 'scope-resolution';
const SCRIPT = fileURLToPath(new URL('./work-scope.mjs', import.meta.url));
// A child process, so stdout (the handle) is observed without stubbing it; no CLAUDE_* variables unless given.
const cli = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, TOKENOMICS_MIGRATIONS: SR, TOKENOMICS_NO_CCUSAGE: '1', ...env },
});

const tmp = () => mkdtempSync(join(tmpdir(), 'work-scope-'));
const NOW = '2026-08-12T10:00:00.000Z';

test('openScope: writes the record; re-open merges cases and preserves declaredAt', () => {
  const repo = tmp();
  const first = openScope(repo, { session: 's1', batch: 'b1', cases: ['TC-2', 'TC-1'], source: 'tms', now: NOW });
  assert.deepEqual(first.cases, ['TC-1', 'TC-2']);
  assert.equal(first.intent, 'automation');
  assert.equal(first.declaredAt, NOW);
  const again = openScope(repo, { session: 's1', cases: ['TC-3'], now: '2026-08-12T11:00:00.000Z' });
  assert.deepEqual(again.cases, ['TC-1', 'TC-2', 'TC-3'], 're-open merges, never drops');
  assert.equal(again.batch, 'b1', 'batch survives a re-open that omits it');
  assert.equal(again.declaredAt, NOW, 'declaredAt is the FIRST declaration');
  assert.ok(JSON.parse(readFileSync(scopePath(repo, 's1'), 'utf8')));
});

// intent is an OPEN vocabulary — manual-qa declares the same record shape.
test('openScope: generic intent and outcome vocabulary (manual-qa fits unchanged)', () => {
  const repo = tmp();
  openScope(repo, { session: 'm1', intent: 'manual-testing', cases: ['TC-101'], source: 'manual-qa', now: NOW });
  const s = recordOutcomes(repo, { session: 'm1', outcomes: { 'TC-101': 'PASS' }, now: NOW });
  assert.equal(s.intent, 'manual-testing');
  assert.equal(s.outcomes['TC-101'].outcome, 'PASS');
});

test('recordOutcomes: latest wins per id; an outcome on an undeclared case joins cases[]', () => {
  const repo = tmp();
  openScope(repo, { session: 's1', batch: 'b1', cases: ['TC-1'], now: NOW });
  recordOutcomes(repo, { session: 's1', outcomes: { 'TC-1': 'blocked' }, now: NOW });
  const s = recordOutcomes(repo, { session: 's1', outcomes: { 'TC-1': 'automated', 'TC-9': 'blocked' }, now: '2026-08-12T12:00:00.000Z' });
  assert.equal(s.outcomes['TC-1'].outcome, 'automated', 'latest wins');
  assert.ok(s.cases.includes('TC-9'), 'outcome implies membership');
});

test('recordOutcomes: self-healing — no prior open still lands a record', () => {
  const repo = tmp();
  const s = recordOutcomes(repo, { session: 'orphan', outcomes: { 'TC-5': 'automated' }, now: NOW });
  assert.deepEqual(s.cases, ['TC-5']);
});

test('closeScope + listScopes: closed scopes drop out of --open', () => {
  const repo = tmp();
  openScope(repo, { session: 'a', batch: 'b1', now: NOW });
  openScope(repo, { session: 'b', intent: 'other', now: NOW });
  closeScope(repo, { session: 'a', now: NOW });
  assert.equal(listScopes(repo).length, 2);
  assert.deepEqual(listScopes(repo, { openOnly: true }).map((s) => s.session), ['b']);
  assert.throws(() => closeScope(repo, { session: 'ghost' }), /nothing to close/);
});

test('safeSession: the id becomes a filename — traversal characters stripped', () => {
  assert.equal(safeSession('../../etc/passwd'), '....etcpasswd');
  assert.equal(safeSession('abc-123_D.e'), 'abc-123_D.e');
});

test('main: open/outcome/close round-trip through the CLI surface', async () => {
  const repo = tmp();
  assert.equal(await main(['open', '--session', 's9', '--batch', 'b2', '--cases', 'TC-1,TC-2', '--repo', repo], {}), 0);
  assert.equal(await main(['outcome', 'TC-1=automated', '--session', 's9', '--repo', repo], {}), 0);
  assert.equal(await main(['close', '--session', 's9', '--repo', repo], {}), 0);
  const s = JSON.parse(readFileSync(scopePath(repo, 's9'), 'utf8'));
  assert.equal(s.outcomes['TC-1'].outcome, 'automated');
  assert.ok(s.closedAt);
  assert.equal(await main(['open', '--repo', repo], {}), 1, 'no session id anywhere → refuse, never guess');
});

// Hosts whose agent cannot know the session id (Copilot) — a pending record
// the capture sweep later claims by time window.
test('main: --session auto creates a pending record', async () => {
  const repo = tmp();
  assert.equal(await main(['open', '--session', 'auto', '--batch', 'b3', '--repo', repo], {}), 0);
  const [s] = listScopes(repo);
  assert.match(s.session, /^pending-/);
  assert.equal(s.batch, 'b3');
});

// THE close-from-inside problem: the lead closes while its own session is
// still running, so that session has no ledger line yet — without capturing it
// first the report omits the very work it describes.
test('close: captures the still-running session so its own spend is in the report', async () => {
  const repo = tmp(); const proj = tmp();
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const jsonl = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
  // a live transcript for this session, discoverable via TOKENOMICS_CLAUDE_ROOT
  writeFileSync(join(proj, 'live-sess.jsonl'), jsonl([
    { type: 'agent-setting', agentSetting: 'test-automation-lead' },
    { type: 'user', message: { role: 'user', content: 'automate TC-9' }, timestamp: '2026-08-13T10:00:00Z' },
    { type: 'assistant', gitBranch: 'tests/batch-b9', timestamp: '2026-08-13T10:05:00Z',
      message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900 }, content: [] } },
  ]));
  const dir = join(repo, '.agents', 'automation', 'b9');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ batch: 'b9', cases: [{ id: 'TC-9', outcome: 'automated' }] }));
  openScope(repo, { session: 'live-sess', batch: 'b9', cases: ['TC-9'], now: NOW });

  const prevRoot = process.env.TOKENOMICS_CLAUDE_ROOT; const prevCc = process.env.TOKENOMICS_NO_CCUSAGE;
  process.env.TOKENOMICS_CLAUDE_ROOT = proj; process.env.TOKENOMICS_NO_CCUSAGE = '1';
  try {
    assert.ok(!existsSync(join(repo, '.agents', 'telemetry', 'automation', 'usage-' + (process.env.USER ?? '') + '.jsonl')));
    assert.equal(await main(['close', '--session', 'live-sess', '--repo', repo], {}), 0);
    // the running session was captured into the ledger…
    const { listScopes } = await import('./work-scope.mjs');
    assert.ok(listScopes(repo)[0].closedAt);
    const cost = JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8'));
    assert.equal(cost.sources.sessions, 1, 'the still-running session IS in its own report');
    assert.ok(cost.totals.tokens > 0, 'and its spend counted');
  } finally {
    if (prevRoot === undefined) delete process.env.TOKENOMICS_CLAUDE_ROOT; else process.env.TOKENOMICS_CLAUDE_ROOT = prevRoot;
    if (prevCc === undefined) delete process.env.TOKENOMICS_NO_CCUSAGE; else process.env.TOKENOMICS_NO_CCUSAGE = prevCc;
  }
});

// Close is the batch's human milestone — it generates the batch report and
// surfaces receipt-vs-records drift while the lead can still act on it.
test('close: generates batch-report.md from the receipt, drift visible in it', async () => {
  const { generateBatchReports } = await import('./work-scope.mjs');
  const repo = tmp();
  const dir = join(repo, '.agents', 'automation', 'b5');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    batch: 'b5', gate: { verdict: 'not-run' },
    cases: [{ id: 'TC-7', outcome: 'merged-ungated' }],
  }));
  writeFileSync(join(dir, 'gate-runs.jsonl'),
    `${JSON.stringify({ at: '2026-08-13T09:00:00Z', branch: 'tests/batch-b5', base: 'main', n: 3, verdict: 'green', consecutiveGreen: 3 })}\n`);
  openScope(repo, { session: 'lead-1', batch: 'b5', cases: ['TC-7'], now: NOW });
  recordOutcomes(repo, { session: 'lead-1', outcomes: { 'TC-7': 'automated' }, now: NOW });
  assert.equal(await main(['close', '--session', 'lead-1', '--repo', repo], {}), 0);
  const md = readFileSync(join(dir, 'batch-report.md'), 'utf8');
  assert.match(md, /# Batch cost — b5/);
  assert.match(md, /GATE DRIFT/);
  assert.match(md, /OUTCOME DRIFT/);
  // the shareable page rides along, drift banners included
  const html = readFileSync(join(dir, 'batch-report.html'), 'utf8');
  assert.match(html, /<title>Batch cost — b5<\/title>/);
  assert.match(html, /GATE DRIFT/);
  // a wave declared by its short name still resolves to the nested receipt
  const wdir = join(repo, '.agents', 'automation', 'camp', 'wave-01');
  mkdirSync(wdir, { recursive: true });
  writeFileSync(join(wdir, 'report.json'), JSON.stringify({ batch: 'camp', cases: [{ id: 'TC-8', outcome: 'automated' }] }));
  // B1 Task 10: the wave-name resolve is the TA extension's enrichGroup 'match' phase.
  const ta = await import('../extensions/test-automation.mjs');
  const reports = await generateBatchReports(repo, { batch: 'wave-01' }, undefined, ta);
  assert.equal(reports.length, 1);
  assert.match(reports[0].path, /camp\/wave-01\/batch-report\.md$/);
  // no receipt anywhere → close still succeeds, nothing rendered
  assert.deepEqual(await generateBatchReports(repo, { batch: 'ghost' }), []);
});

// B2 item 4 (null-unobservable): a timestamp-less live line has null minutes; status says so, never "—m" or "0m".
test('renderStatus: null minutes and counters read "— … (1 unmeasured)"', async () => {
  const { renderStatus: rs } = await import('./work-scope.mjs');
  const line = { id: 's', costUsd: null, tokens: null, activeMin: null, turns: 3, toolCalls: null, toolErrors: null, cases: [],
    subagents: [{ role: 'implementer', costUsd: null, tokens: null, activeMin: null, toolCalls: null, label: 'implement X-1' }] };
  const out = rs({ line, scope: null, liveLog: null });
  assert.match(out, /— active \(1 unmeasured\)/);
  assert.match(out, /3 turns/);
  assert.match(out, /— \(1 unmeasured\) tool calls \(— \(1 unmeasured\) err\)/);
  assert.doesNotMatch(out, /—m|\bnull\b|undefined|NaN/);
  // A measured line renders exactly as before.
  const m = rs({ line: { ...line, activeMin: 4, toolCalls: 2, toolErrors: 0, subagents: [] }, scope: null, liveLog: null });
  assert.match(m, /4m active  ·  3 turns  ·  2 tool calls \(0 err\)/);
});

// Plan 4 final review (ledger 86): a folded dispatch whose tokens are unmeasured prints '—', never '0 tok', and the
// "so far" total sums only measured units, disclosing the rest (O1).
test('renderStatus: a null dispatch token total reads "—" and the total counts it unmeasured, never 0', async () => {
  const { renderStatus: rs } = await import('./work-scope.mjs');
  const q = (n) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
  const d = (tokens, label) => ({ role: 'implementer', costUsd: null, tokens, activeMin: 1, toolCalls: 1, label });
  const line = { id: 's', costUsd: 1, tokens: q(100), activeMin: 4, turns: 3, toolCalls: 2, toolErrors: 0, cases: [],
    subagents: [d(q(50), 'implement X-1'), d(null, 'implement X-2')] };
  const out = await under('null-unobservable', () => rs({ line, scope: null, liveLog: null }));
  assert.match(out, /so far: \$1\.00  ·  150 tokens \(1 unmeasured\)  ·  4m active/);
  assert.match(out, /\s50 tok .*implement X-1/);
  assert.match(out, /\s— tok .*implement X-2/);
  assert.doesNotMatch(out, /\s0 tok/);
  const all = await under('null-unobservable', () => rs({ line: { ...line, subagents: [d(q(50), 'implement X-1')] }, scope: null, liveLog: null }));
  assert.match(all, /so far: \$1\.00  ·  150 tokens  ·  4m active/, 'a fully measured line renders exactly as before');
  const none = await under('null-unobservable', () => rs({ line: { ...line, tokens: null, subagents: [d(null, 'implement X-2')] }, scope: null, liveLog: null }));
  assert.match(none, /so far: \$1\.00  ·  — \(2 unmeasured\) tokens  ·/, 'nothing measured: no total at all');
  // migrations off: the reference reading (null read as 0), byte for byte
  assert.match(rs({ line, scope: null, liveLog: null }), /150 tokens  ·  4m active[\s\S]*\s0 tok .*implement X-2/);
});

// --- B2 item 9 scope-resolution (spec §14.11; owner Q12) ---------------------------------------------------------

test('scope-resolution: open --session auto prints the handle on stdout; the stderr line is unchanged', () => {
  const repo = tmp();
  const r = cli(['open', '--session', 'auto', '--batch', 'b3', '--repo', repo]);
  assert.equal(r.status, 0, r.stderr);
  const m = /^\{"handle":"(pending-[a-z0-9]+-[a-z0-9]+)"\}\n$/.exec(r.stdout);
  assert.ok(m, `stdout: ${JSON.stringify(r.stdout)}`);
  assert.equal(r.stderr, `work-scope: ${m[1]} — automation / b3, 0 case(s)\n`);
  assert.ok(existsSync(join(scopesDir(repo), `${m[1]}.json`)), 'a pending record is host-less until claimed: it stays flat');
  const ref = cli(['open', '--session', 'auto', '--repo', repo], { TOKENOMICS_MIGRATIONS: 'none' });
  assert.equal(ref.status, 0);
  assert.equal(ref.stdout, '', 'none: the reference prints the id on stderr only');
});

test('scope-resolution: outcome/close resolve the handle before and after the capture claim', async () => {
  const { resolveScope } = await import('../hooks/telemetry-capture.mjs');
  const declare = (repo) => openScope(repo, { session: 'pending-h1', batch: 'hb', cases: ['X-1', 'X-2'], now: '2026-10-01T09:58:00.000Z' });
  const start = Date.parse('2026-10-01T10:00:00Z');
  await under(SR, async () => {
    const repo = tmp();
    const tdir = join(repo, '.agents', 'telemetry', 'automation');
    declare(repo);
    assert.equal(await main(['outcome', '--session', 'pending-h1', 'X-1=delivered', '--repo', repo], {}), 0);
    const pending = JSON.parse(readFileSync(join(scopesDir(repo), 'pending-h1.json'), 'utf8'));
    assert.equal(pending.outcomes['X-1'].outcome, 'delivered', 'before the claim: the pending record');
    assert.equal(resolveScope(tdir, 'claude', 'sh', start).scope.claimedFrom, 'pending-h1');
    assert.equal(await main(['outcome', '--session', 'pending-h1', 'X-2=delivered', '--repo', repo], {}), 0);
    assert.equal(await main(['close', '--session', 'pending-h1', '--repo', repo], {}), 0, 'after the claim: the claimed record');
    const claimed = JSON.parse(readFileSync(join(scopesDir(repo), 'claude', 'sh.json'), 'utf8'));
    assert.equal(claimed.session, 'sh');
    assert.equal(claimed.claimedFrom, 'pending-h1');
    assert.deepEqual(Object.keys(claimed.outcomes), ['X-1', 'X-2']);
    assert.ok(claimed.closedAt);
    assert.ok(!existsSync(join(scopesDir(repo), 'pending-h1.json')), 'no orphan pending record under the handle');
  });
  // none pins the reference: the claimed handle has nothing to close
  const repo = tmp();
  declare(repo);
  const { sessionScope } = await import('../hooks/telemetry-capture.mjs');
  assert.equal(sessionScope(repo, 'sh', { startTs: start }).claimedFrom, 'pending-h1');
  assert.equal(await main(['close', '--session', 'pending-h1', '--repo', repo], {}), 1);
});

test('scope-resolution: a handle whose claim a crash interrupted resolves once the claim is completed', async () => {
  await under(SR, async () => {
    const repo = tmp();
    const dir = join(scopesDir(repo), 'claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sc.json.claim'), JSON.stringify({ v: 1, session: 'pending-c1', intent: 'automation', cases: ['X-1'], declaredAt: 'T', updatedAt: 'T' }));
    assert.equal(await main(['outcome', '--session', 'pending-c1', 'X-1=delivered', '--repo', repo], {}), 0);
    const s = JSON.parse(readFileSync(join(dir, 'sc.json'), 'utf8'));
    assert.equal(s.claimedFrom, 'pending-c1');
    assert.equal(s.outcomes['X-1'].outcome, 'delivered');
    assert.ok(!existsSync(join(dir, 'sc.json.claim')));
    assert.ok(!existsSync(join(scopesDir(repo), 'pending-c1.json')), 'never a second record under the handle');
  });
});

test('scope-resolution: --session auto is valid only on open', async () => {
  await under(SR, async () => {
    const repo = tmp();
    for (const cmd of ['outcome', 'close', 'show', 'status', 'restamp']) {
      assert.equal(await main([cmd, '--session', 'auto', 'X-1=done', '--host', 'claude', '--repo', repo], {}), 1, cmd);
    }
    assert.ok(!existsSync(scopesDir(repo)), 'nothing written');
  });
  const r = cli(['outcome', '--session', 'auto', 'X-1=done', '--repo', tmp()]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--session auto is valid only on open/);
});

test('scope-resolution: --host defaults to claude under CLAUDE_SESSION_ID/CLAUDE_PROJECT_DIR, else open needs it', async () => {
  await under(SR, async () => {
    const repo = tmp();
    assert.equal(await main(['open', '--session', 's1', '--repo', repo], {}), 1, 'no host anywhere → usage error');
    assert.ok(!existsSync(scopesDir(repo)));
    assert.equal(await main(['open', '--session', 's1', '--repo', repo], { CLAUDE_PROJECT_DIR: repo }), 0);
    assert.ok(existsSync(join(scopesDir(repo), 'claude', 's1.json')));
    assert.equal(await main(['open', '--session', 's2', '--repo', repo], { CLAUDE_SESSION_ID: 's2' }), 0);
    assert.ok(existsSync(join(scopesDir(repo), 'claude', 's2.json')));
    assert.equal(await main(['open', '--session', 's3', '--host', 'copilot', '--repo', repo], {}), 0);
    assert.ok(existsSync(join(scopesDir(repo), 'copilot', 's3.json')));
    assert.equal(await main(['open', '--session', 's4', '--host', 'bogus', '--repo', repo], {}), 1, 'an unknown host is a usage error');
    assert.ok(!existsSync(join(scopesDir(repo), 'bogus')));
    assert.ok(!existsSync(join(scopesDir(repo), 's1.json')), 'never a flat record for a known session');
  });
  const r = cli(['open', '--session', 's1', '--repo', tmp()]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--host <claude\|copilot\|copilot-vscode>/);
  assert.equal(cli(['open', '--session', 'auto', '--repo', tmp()]).status, 0, 'auto needs no host');
});

test('scope-resolution: open --role stores the role; a re-open keeps role and claimedFrom', async () => {
  await under(SR, async () => {
    const repo = tmp();
    assert.equal(await main(['open', '--session', 's1', '--intent', 'automation', '--source', 'handoff', '--role', 'lead', '--repo', repo], { CLAUDE_PROJECT_DIR: repo }), 0);
    const path = join(scopesDir(repo), 'claude', 's1.json');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).role, 'lead');
    openScope(repo, { session: 's1', host: 'claude', cases: ['X-1'] });
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).role, 'lead', 're-open without --role keeps it');
    const dir = join(scopesDir(repo), 'claude');
    writeFileSync(join(dir, 's2.json'), JSON.stringify({ v: 1, session: 's2', intent: 'story', cases: [], declaredAt: 'T', updatedAt: 'T', claimedFrom: 'pending-z' }));
    const s = openScope(repo, { session: 's2', host: 'claude', cases: ['X-2'] });
    assert.equal(s.claimedFrom, 'pending-z', 'a claimed record keeps claimedFrom (the reference drops it)');
  });
  const repo = tmp();
  assert.equal(await main(['open', '--session', 's1', '--role', 'lead', '--repo', repo], {}), 0);
  assert.equal(JSON.parse(readFileSync(scopePath(repo, 's1'), 'utf8')).role, undefined, 'none: --role is ignored');
});

test('scope-resolution: restamp — no prior line → error; reference-era winner → error naming capture --force', () => {
  const repo = tmp();
  let r = cli(['restamp', '--host', 'claude', '--session', 'sx', '--repo', repo]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no ledger line for claude:sx/);
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(dir, { recursive: true });
  const line = (o) => JSON.stringify({ v: 1, host: 'claude', id: 'sx', capturedAt: '2026-10-01T10:30:00.000Z', ...o });
  writeFileSync(join(dir, 'usage-a.jsonl'), `${line({ endedAt: '2026-10-01T10:00:00.000Z', writer: 'tokenomics-engine@0.9.0' })}\n`);
  writeFileSync(join(dir, 'usage-b.jsonl'), `${line({ endedAt: '2026-10-01T10:05:00.000Z' })}\n${JSON.stringify({ v: 1, host: 'copilot', id: 'sx', endedAt: '2026-10-01T11:00:00.000Z', writer: 'x' })}\n`);
  r = cli(['restamp', '--host', 'claude', '--session', 'sx', '--repo', repo]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /reference-era/, 'the winner is the greatest endedAt for claude:sx, and it has no writer');
  assert.match(r.stderr, /capture --force/);
  assert.equal(readFileSync(join(dir, 'usage-b.jsonl'), 'utf8').split('\n').length, 3, 'nothing appended');
  r = cli(['restamp', '--session', 'sx', '--repo', repo]);
  assert.equal(r.status, 1, 'no host anywhere → usage error');
  assert.match(r.stderr, /--host/);
  r = cli(['restamp', '--host', 'claude', '--session', 'sx', '--repo', repo], { TOKENOMICS_MIGRATIONS: 'none' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^usage: work-scope\.mjs/, 'none: restamp is an unknown command');
});

// --- B2 item 11: writer — the restamp success path (map O7, owner Q15) ----------------------------------------
test('restamp a line written by an older writer: original writer + manifestRevision kept, restampedBy set, scope corrected', () => {
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  // the current module.json has advanced to revision 2 (archived) since the measurement was written under revision 1
  const m2 = { module: 'tokenomics', schema_version: '1.0', domain: 'd', manifestRevision: 2, ratioIntents: ['story'] };
  writeFileSync(join(dir, 'module.json'), JSON.stringify(m2));
  writeFileSync(join(dir, 'manifests', '2.json'), JSON.stringify(m2));
  mkdirSync(join(dir, 'scopes', 'claude'), { recursive: true });
  writeFileSync(join(dir, 'scopes', 'claude', 'sr.json'), JSON.stringify({ v: 1, session: 'sr', intent: 'story', batch: 'b-7', cases: ['X-7'], role: 'lead', outcomes: { 'X-7': { outcome: 'delivered', at: 'T' } }, declaredAt: 'T', updatedAt: 'T' }));
  const winner = {
    v: 1, writer: 'tokenomics-engine@0.9.0', manifestRevision: 1, host: 'claude', id: 'sr', user: 'alice',
    capturedAt: '2026-10-01T10:30:00.000Z', repo: 'r', branch: 'main', role: 'test-automation-lead', models: ['claude-sonnet-5'],
    startedAt: '2026-10-01T09:00:00.000Z', endedAt: '2026-10-01T10:00:00.000Z', wallMin: 60, activeMin: 40, turns: 9, toolCalls: 12, toolErrors: 1,
    tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 4 }, tokensByModel: {}, costUsd: 1.25, costSource: 'ccusage-metered',
    cases: ['X-7'], scope: { intent: 'automation', cases: [] }, subagents: [], skills: [], dispatches: 0,
  };
  const older = { ...winner, endedAt: '2026-10-01T09:30:00.000Z', costUsd: 0.5 };
  writeFileSync(join(dir, 'usage-alice.jsonl'), `${JSON.stringify(older)}\n${JSON.stringify(winner)}\n`);
  const before = Date.now();
  const r = cli(['restamp', '--host', 'claude', '--session', 'sr', '--repo', repo], { TOKENOMICS_MIGRATIONS: 'scope-resolution,writer', TOKENOMICS_ENGINE_VERSION_PIN: '1.2.0' });
  const after = Date.now();
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(join(dir, 'usage-alice.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3, 'one line appended to the winner\'s ledger file');
  const got = lines[2];
  assert.equal(got.writer, 'tokenomics-engine@0.9.0', 'the original writer (§3.2: restamping never changes it)');
  assert.equal(got.manifestRevision, 1, 'the revision the measurement was written under, not the current 2');
  assert.equal(got.restampedBy, 'tokenomics-engine@1.2.0');
  assert.deepEqual(Object.keys(got).slice(0, 5), ['v', 'writer', 'manifestRevision', 'restampedBy', 'host']);
  assert.deepEqual(got.scope, { intent: 'story', batch: 'b-7', cases: ['X-7'], outcomes: { 'X-7': 'delivered' }, role: 'lead' }, 'the corrected scope, with role');
  const t = Date.parse(got.capturedAt);
  assert.ok(t >= before - 1000 && t <= after + 1000, `capturedAt = now (${got.capturedAt})`);
  const strip = ({ capturedAt, scope, restampedBy, ...rest }) => rest;
  assert.deepEqual(strip(got), strip(winner), 'measured fields and endedAt unchanged');
  // with writer off the success path does not run: exit 1, nothing appended
  const r2 = cli(['restamp', '--host', 'claude', '--session', 'sr', '--repo', repo], { TOKENOMICS_MIGRATIONS: 'scope-resolution' });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /writer/);
  assert.equal(readFileSync(join(dir, 'usage-alice.jsonl'), 'utf8').trim().split('\n').length, 3);
});

test('restamp: a writer winner with no own scope record → error, nothing appended', () => {
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'usage-alice.jsonl'), `${JSON.stringify({ v: 1, writer: 'tokenomics-engine@0.9.0', manifestRevision: 1, host: 'claude', id: 'sn', endedAt: '2026-10-01T10:00:00.000Z', capturedAt: '2026-10-01T10:00:00.000Z' })}\n`);
  const r = cli(['restamp', '--host', 'claude', '--session', 'sn', '--repo', repo], { TOKENOMICS_MIGRATIONS: 'scope-resolution,writer' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no scope record for claude:sn/);
  assert.equal(readFileSync(join(dir, 'usage-alice.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('restamp (review round 1, M2): top-level cases re-derive as (winner.cases − winner.scope.cases) ∪ the corrected scope.cases', () => {
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(join(dir, 'scopes', 'claude'), { recursive: true });
  // the session was captured under a mis-declared X-1 (PROJ-12 was mined from the branch); the scope is corrected to X-7
  writeFileSync(join(dir, 'scopes', 'claude', 'sm.json'), JSON.stringify({ v: 1, session: 'sm', intent: 'automation', cases: ['X-7'], declaredAt: 'T', updatedAt: 'T' }));
  const winner = { v: 1, writer: 'tokenomics-engine@0.9.0', manifestRevision: 1, host: 'claude', id: 'sm', user: 'alice', capturedAt: '2026-10-01T10:30:00.000Z',
    endedAt: '2026-10-01T10:00:00.000Z', cases: ['PROJ-12', 'X-1'], scope: { intent: 'automation', cases: ['X-1'] }, subagents: [] };
  writeFileSync(join(dir, 'usage-alice.jsonl'), `${JSON.stringify(winner)}\n`);
  const r = cli(['restamp', '--host', 'claude', '--session', 'sm', '--repo', repo], { TOKENOMICS_MIGRATIONS: 'scope-resolution,writer' });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(readFileSync(join(dir, 'usage-alice.jsonl'), 'utf8').trim().split('\n')[1]);
  assert.deepEqual(got.scope.cases, ['X-7']);
  assert.deepEqual(got.cases, ['PROJ-12', 'X-7'], 'the mis-declared X-1 leaves cases; X-7 joins; the mined PROJ-12 stays');
});

// --- scope-resolution review round 1 ---------------------------------------------------------------------------
test('scope-resolution (I1): COPILOT_CLI=1 defaults --host to copilot, ahead of an inherited CLAUDE_PROJECT_DIR', async () => {
  await under(SR, async () => {
    const repo = tmp();
    assert.equal(await main(['open', '--session', 'c1', '--repo', repo], { COPILOT_CLI: '1', CLAUDE_PROJECT_DIR: repo }), 0);
    assert.ok(existsSync(join(scopesDir(repo), 'copilot', 'c1.json')));
    assert.ok(!existsSync(join(scopesDir(repo), 'claude')));
  });
});

test('scope-resolution (M4): a known host is stamped on a pending record (its host directory); the handle resolves there', () => {
  const repo = tmp();
  const r = cli(['open', '--session', 'auto', '--host', 'copilot', '--repo', repo]);
  assert.equal(r.status, 0, r.stderr);
  const { handle } = JSON.parse(r.stdout);
  assert.ok(existsSync(join(scopesDir(repo), 'copilot', `${handle}.json`)));
  assert.ok(!existsSync(join(scopesDir(repo), `${handle}.json`)));
  assert.equal(cli(['outcome', '--session', handle, 'X-1=done', '--repo', repo]).status, 0);
  assert.equal(JSON.parse(readFileSync(join(scopesDir(repo), 'copilot', `${handle}.json`), 'utf8')).outcomes['X-1'].outcome, 'done');
  const env = cli(['open', '--session', 'auto', '--repo', repo], { COPILOT_CLI: '1' });
  assert.ok(existsSync(join(scopesDir(repo), 'copilot', `${JSON.parse(env.stdout).handle}.json`)), 'the env default stamps it too');
  const bare = cli(['open', '--session', 'auto', '--repo', repo]);
  assert.ok(existsSync(join(scopesDir(repo), `${JSON.parse(bare.stdout).handle}.json`)), 'no host known: host-less, flat');
});

// B2 item 10 (reports-location, Q13): a non-TA close writes its reports and cost.json to the telemetry branch.
const RL = 'reports-location';
const storyRepo = (settings = { extension: null }) => {
  const repo = tmp();
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({
    dir: 'stories', receipts: { root: '.agents/stories', file: 'receipt.json', deliveredOutcomes: ['done'] },
    intents: { default: 'story' }, vocabulary: { item: 'story', group: 'sprint', delivered: 'done' },
    ids: { patterns: ['\\bissue-\\d{1,6}\\b'], flags: '', max: 50, stoplist: [] }, ...settings,
  }));
  mkdirSync(join(repo, '.agents', 'stories', 'sp1'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'stories', 'sp1', 'receipt.json'), JSON.stringify({ batch: 'sp1', cases: [{ id: 'issue-101', outcome: 'done' }] }));
  return repo;
};
const closeSp1 = (repo, mig) => {
  const open = cli(['open', '--session', 's1', '--batch', 'sp1', '--cases', 'issue-101', '--repo', repo, '--host', 'claude'], { TOKENOMICS_MIGRATIONS: mig });
  assert.equal(open.status, 0, open.stderr);
  return cli(['close', '--session', 's1', '--repo', repo, '--host', 'claude'], { TOKENOMICS_MIGRATIONS: mig });
};

test('reports-location: close writes reports and cost.json under the telemetry dir, never the tree', () => {
  const repo = storyRepo();
  const r = closeSp1(repo, RL);
  assert.equal(r.status, 0, r.stderr);
  const rep = join(repo, '.agents', 'telemetry', 'stories', 'reports', 'sp1');
  for (const f of ['cost.json', 'batch-report.md', 'batch-report.html', 'batch-tokenomics.md', 'batch-tokenomics.html']) {
    assert.ok(existsSync(join(rep, f)), `${f} under the telemetry dir`);
    assert.ok(!existsSync(join(repo, '.agents', 'stories', 'sp1', f)), `${f} not in the tree`);
  }
  assert.ok(existsSync(join(repo, '.agents', 'stories', 'sp1', 'receipt.json')), 'the receipt stays in the tree');
});

test('reports-location: the stderr path line names the new path', () => {
  const repo = storyRepo();
  const r = closeSp1(repo, RL);
  assert.ok(r.stderr.includes(`report → ${join(repo, '.agents', 'telemetry', 'stories', 'reports', 'sp1', 'batch-report.md')}`), r.stderr);
});

test('reports-location off: close still writes in-tree (reference layout)', () => {
  const repo = storyRepo();
  const r = closeSp1(repo, 'none');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(repo, '.agents', 'stories', 'sp1', 'cost.json')));
  assert.ok(existsSync(join(repo, '.agents', 'stories', 'sp1', 'batch-report.md')));
  assert.ok(r.stderr.includes(`report → ${join(repo, '.agents', 'stories', 'sp1', 'batch-report.md')}`));
});

test('reports-location: an explicit reports.location tree keeps the in-tree layout', () => {
  const repo = storyRepo({ extension: null, reports: { location: 'tree' } });
  const r = closeSp1(repo, RL);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(repo, '.agents', 'stories', 'sp1', 'cost.json')));
});

// Review round 1 (I1): onClose keeps receiving the RECEIPT dir (TA's gate runs and verdicts live there), whatever
// reports.location says; only the engine's own reports and cost.json move.
test('reports-location (I1): a TA file with explicit telemetry still folds gate verdicts into the receipt dir and detects drift', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ extension: fileURLToPath(new URL('../extensions/test-automation.mjs', import.meta.url)), reports: { location: 'telemetry' } }));
  const dir = join(repo, '.agents', 'automation', 'b5');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ batch: 'b5', gate: { verdict: 'not-run' }, cases: [{ id: 'TC-7', outcome: 'automated' }] }));
  const runs = join(repo, '.agents', 'telemetry', 'automation', 'gate-runs');
  mkdirSync(runs, { recursive: true });
  const green = JSON.stringify({ at: '2026-08-13T09:00:00Z', branch: 'tests/batch-b5', base: 'main', n: 3, verdict: 'green', consecutiveGreen: 3 });
  writeFileSync(join(runs, 'b5.jsonl'), `${green}\n`);
  const o = cli(['open', '--session', 'g1', '--batch', 'b5', '--cases', 'TC-7', '--repo', repo, '--host', 'claude'], { TOKENOMICS_MIGRATIONS: RL });
  assert.equal(o.status, 0, o.stderr);
  const r = cli(['close', '--session', 'g1', '--repo', repo, '--host', 'claude'], { TOKENOMICS_MIGRATIONS: RL });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, 'gate-runs.jsonl'), 'utf8').trim(), green, 'the verdict folded beside the receipt');
  assert.ok(!existsSync(join(runs, 'b5.jsonl')), 'telemetry source cleared');
  const rep = join(repo, '.agents', 'telemetry', 'automation', 'reports', 'b5');
  assert.ok(!existsSync(join(rep, 'gate-runs.jsonl')), 'nothing folded into the reports dir');
  assert.match(readFileSync(join(rep, 'batch-report.md'), 'utf8'), /GATE DRIFT/);
});

// --- B2 item 22: report-conflicts (review round 1, M4) -----------------------------------------------------------
test('restamp refuses a winner that is an exact spec 3.5 conflict: exit 1, names the conflict, suggests capture --force', () => {
  const repo = tmp();
  const dir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(join(dir, 'scopes', 'claude'), { recursive: true });
  writeFileSync(join(dir, 'scopes', 'claude', 'sc.json'), JSON.stringify({ v: 1, session: 'sc', intent: 'story', cases: [], declaredAt: 'T', updatedAt: 'T' }));
  const base = { v: 1, writer: 'tokenomics-engine@0.9.0', manifestRevision: 1, host: 'claude', id: 'sc', user: 'alice', endedAt: '2026-10-01T10:00:00.000Z', capturedAt: '2026-10-01T10:00:00.000Z' };
  const body = `${JSON.stringify({ ...base, costUsd: 8 })}\n${JSON.stringify({ ...base, costUsd: 800 })}\n`;
  writeFileSync(join(dir, 'usage-alice.jsonl'), body);
  const env = { TOKENOMICS_MIGRATIONS: 'scope-resolution,writer,report-conflicts' };
  const r = cli(['restamp', '--host', 'claude', '--session', 'sc', '--repo', repo], env);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /claude:sc is a spec 3\.5 conflict/);
  assert.match(r.stderr, /capture --force/);
  assert.equal(readFileSync(join(dir, 'usage-alice.jsonl'), 'utf8'), body, 'nothing appended');
  // an identical-payload tie (a duplicate) is restamped as before
  writeFileSync(join(dir, 'usage-alice.jsonl'), `${JSON.stringify({ ...base, costUsd: 8 })}\n${JSON.stringify({ ...base, costUsd: 8, branch: 'x' })}\n`);
  assert.equal(cli(['restamp', '--host', 'claude', '--session', 'sc', '--repo', repo], env).status, 0);
});

// B2 item 24 (report-revision, map O6): a close writes cost.json and the four renders with the current revision.
test('report-revision: close writes cost.json and every render with the current manifest revision', () => {
  const repo = storyRepo();
  mkdirSync(join(repo, '.agents', 'telemetry', 'stories'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'telemetry', 'stories', 'module.json'), JSON.stringify({ manifestRevision: 3 }));
  const r = closeSp1(repo, 'report-revision');
  assert.equal(r.status, 0, r.stderr);
  const dir = join(repo, '.agents', 'stories', 'sp1');
  assert.equal(JSON.parse(readFileSync(join(dir, 'cost.json'), 'utf8')).manifestRevision, 3);
  for (const f of ['batch-report.md', 'batch-tokenomics.md']) assert.match(readFileSync(join(dir, f), 'utf8'), /\nmanifest revision 3\n?$/, f);
  for (const f of ['batch-report.html', 'batch-tokenomics.html']) assert.match(readFileSync(join(dir, f), 'utf8'), /manifest revision 3<\/p>\s*$/, f);
  // implied manifest -> 1
  const repo2 = storyRepo();
  assert.equal(closeSp1(repo2, 'report-revision').status, 0);
  assert.match(readFileSync(join(repo2, '.agents', 'stories', 'sp1', 'batch-report.md'), 'utf8'), /\nmanifest revision 1\n?$/);
});

test('report-robustness (item 18): close --repo "" is a usage error naming --repo (exit 1), the scope stays open; off: the reference pass-through', async () => {
  const repo = tmp();
  openScope(repo, { session: 'e1', batch: 'b1', cases: ['T-1'], now: NOW });
  const r = cli(['close', '--repo', '', '--session', 'e1'], { TOKENOMICS_MIGRATIONS: 'report-robustness', CLAUDE_PROJECT_DIR: repo });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--repo/);
  assert.equal(JSON.parse(readFileSync(scopePath(repo, 'e1'), 'utf8')).closedAt, undefined, 'nothing was closed');
  assert.ok(!existsSync(join(repo, '.agents', 'automation', 'b1', 'cost.json')) && !existsSync(join(repo, '.agents', 'automation', 'b1', 'batch-report.md')), 'no cost.json or report written');
  const bare = cli(['close', '--session', 'e1', '--repo'], { TOKENOMICS_MIGRATIONS: 'report-robustness', CLAUDE_PROJECT_DIR: repo });
  assert.equal(bare.status, 1, 'a bare trailing --repo is the same usage error');
  assert.match(bare.stderr, /--repo/);
  const off = cli(['close', '--repo', '', '--session', 'e1'], { TOKENOMICS_MIGRATIONS: 'none', CLAUDE_PROJECT_DIR: repo });
  assert.doesNotMatch(off.stderr, /--repo needs/);
});
