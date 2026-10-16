import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConservation } from './conservation.mjs';

const W = (lines) => new Map(lines.map((l) => [`${l.host}:${l.id}`, { line: l }]));
const line = (id, costUsd, extra = {}) => ({ v: 1, host: 'claude', id, costUsd, tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }, activeMin: 10, ...extra });

test('overdraw split across two groups is a violation even though the global sum is small', () => {
  const r = checkConservation(W([line('A', 10), line('B', 100)]), { allocations: [
    { source: 'claude:A', group: 'g1', quantity: 'costUsd', amount: 7.5 },
    { source: 'claude:A', group: 'g2', quantity: 'costUsd', amount: 7.5 } ] });
  assert.deepEqual(r.violations, [{ source: 'claude:A', quantity: 'costUsd', allocated: 15, available: 10 }]);
  assert.ok(r.unallocated.some((u) => u.source === 'claude:B' && u.quantity === 'costUsd' && u.amount === 100));
});

test('within tolerance passes; rollup groups are excluded', () => {
  const r = checkConservation(W([line('A', 10)]), { rollups: ['epic'], allocations: [
    { source: 'claude:A', group: 'g1', quantity: 'costUsd', amount: 10.005 },
    { source: 'claude:A', group: 'epic', quantity: 'costUsd', amount: 10 } ] });
  assert.deepEqual(r.violations, []);
});

test('allocating an unknown quantity is a violation; negative amounts are violations', () => {
  const r = checkConservation(W([line('A', null)]), { allocations: [{ source: 'claude:A', group: 'g', quantity: 'costUsd', amount: 1 }] });
  assert.deepEqual(r.violations, [{ source: 'claude:A', quantity: 'costUsd', allocated: 1, available: null }]);
  const n = checkConservation(W([line('A', 5)]), { allocations: [{ source: 'claude:A', group: 'g', quantity: 'costUsd', amount: -1 }] });
  assert.equal(n.violations.length, 1);
});

const here = dirname(fileURLToPath(import.meta.url));
const joinDir = join(here, '..', 'fixtures', 'join');

const cases = readdirSync(joinDir).filter((c) => existsSync(join(joinDir, c, 'expected.json'))).sort();

test('join fixtures: the fixture set includes the pre-grain cases, the five grain cases, the two copilot-inclusive cases, the shared-allocation case and the active-minutes case', () => {
  for (const c of ['absent-source', 'activemin', 'double-full-weight', 'ok', 'overdraw-split', 'tokens-inclusive-overdraw', 'tokens-parent', 'tokens-unmeasured-dispatch', 'unknown-stays-unknown',
    'grain-activemin-dispatch', 'grain-inclusive-dispatch-tokens', 'grain-parent-dispatch-ok', 'grain-dispatch-overdraw', 'grain-cost-unmeasured-dispatch',
    'copilot-inclusive-session', 'copilot-inclusive-dispatch-split', 'shared-dispatch-split', 'activemin-session-grain']) {
    assert.ok(cases.includes(c), `missing join fixture ${c}`);
  }
});

for (const c of cases) {
  test(`join fixture ${c}: yields its expected violations and unallocated remainders`, () => {
    const dir = join(joinDir, c);
    const lines = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s));
    const winners = new Map(lines.map((l) => [`${l.host}:${l.id}`, { line: l }]));
    const trace = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'));
    const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    assert.deepEqual(checkConservation(winners, trace), { violations: expected.violations, unallocated: expected.unallocated });
  });
}

const sub = (extra = {}) => ({ id: 'd1', tokens: { input: 20, output: 5, cacheRead: 100, cacheWrite: 2 }, costUsd: 1, ...extra });
const grainLine = (extra = {}) => line('A', 3, { tokens: { input: 50, output: 12, cacheRead: 300, cacheWrite: 8 }, subagents: [sub()], ...extra });

test('grain: a dispatch-grain allocation naming a dispatch absent from the source line is unknown-dispatch', () => {
  const r = checkConservation(W([grainLine()]), { allocations: [
    { source: 'claude:A', group: 'g1', quantity: 'tokens.input', amount: 5, grain: 'dispatch', dispatch: 'd9' } ] });
  assert.deepEqual(r.violations, [{ source: 'claude:A', quantity: 'tokens.input', group: 'g1', rule: 'unknown-dispatch', detail: 'dispatch d9 not in the source line' }]);
});

test('grain: an explicit session grain behaves like a missing grain; rollup groups skip the grain checks', () => {
  const r = checkConservation(W([grainLine()]), { rollups: ['epic'], allocations: [
    { source: 'claude:A', group: 'g1', quantity: 'activeMin', amount: 10, grain: 'session' },
    { source: 'claude:A', group: 'epic', quantity: 'activeMin', amount: 10, grain: 'dispatch', dispatch: 'd1' } ] });
  assert.deepEqual(r.violations, []);
});

test('grain: overdraw sums every allocation to the same dispatch across groups', () => {
  const r = checkConservation(W([grainLine()]), { allocations: [
    { source: 'claude:A', group: 'g1', quantity: 'costUsd', amount: 0.6, grain: 'dispatch', dispatch: 'd1' },
    { source: 'claude:A', group: 'g2', quantity: 'costUsd', amount: 0.6, grain: 'dispatch', dispatch: 'd1' } ] });
  assert.deepEqual(r.violations.map((v) => v.rule), ['dispatch-overdraw']);
});

test('grain: a dispatch missing one token category is unmeasured for that category only', () => {
  const r = checkConservation(W([grainLine({ subagents: [sub({ tokens: { input: 20 } })] })]), { allocations: [
    { source: 'claude:A', group: 'g1', quantity: 'tokens.input', amount: 20, grain: 'dispatch', dispatch: 'd1' },
    { source: 'claude:A', group: 'g1', quantity: 'tokens.output', amount: 1, grain: 'dispatch', dispatch: 'd1' } ] });
  assert.deepEqual(r.violations.filter((v) => v.rule), [{ source: 'claude:A', quantity: 'tokens.output', group: 'g1', rule: 'unmeasured-dispatch-split', detail: 'dispatch d1 has no measured tokens.output' }]);
});

// Final review F5: a grain other than missing / session / dispatch is its own violation, never dispatch rules.
test('grain: an unknown grain is an unknown-grain violation, not a dispatch-rule one', () => {
  const r = checkConservation(W([grainLine()]), { allocations: [
    { source: 'claude:A', group: 'g1', quantity: 'activeMin', amount: 1, grain: 'Dispatch', dispatch: 'd1' },
    { source: 'claude:A', group: 'g1', quantity: 'tokens.input', amount: 1, grain: 'turn' } ] });
  assert.deepEqual(r.violations, [
    { source: 'claude:A', quantity: 'activeMin', group: 'g1', rule: 'unknown-grain', detail: 'grain Dispatch is not session or dispatch' },
    { source: 'claude:A', quantity: 'tokens.input', group: 'g1', rule: 'unknown-grain', detail: 'grain turn is not session or dispatch' },
  ]);
});

test('copilot-inclusive fixtures: zero violations at session grain; the dispatch-grain variant reports inclusive-dispatch-split', () => {
  const run = (c) => {
    const dir = join(joinDir, c);
    const lines = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s));
    return checkConservation(new Map(lines.map((l) => [`${l.host}:${l.id}`, { line: l }])), JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8')));
  };
  assert.deepEqual(run('copilot-inclusive-session').violations, []);
  assert.deepEqual(run('copilot-inclusive-dispatch-split').violations.map((v) => v.rule), ['inclusive-dispatch-split']);
});

// B2 item 2 (shared-allocation, D5): one dispatch mine in two groups, its measured dollars and tokens allocated
// 1/2 to each at dispatch grain, the parent remainder and the minutes at session grain.
test('shared-dispatch-split fixture: dispatch-grain 1/k shares conserve with zero violations', () => {
  const dir = join(joinDir, 'shared-dispatch-split');
  const lines = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s));
  const trace = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'));
  assert.ok(trace.allocations.some((a) => a.grain === 'dispatch'), 'the fixture exercises dispatch grain');
  const r = checkConservation(new Map(lines.map((l) => [`${l.host}:${l.id}`, { line: l }])), trace);
  assert.deepEqual(r, { violations: [], unallocated: [] });
});

// B2 item 7 (active-minutes, D5): one line with two dispatches serving two groups. Its dollars and tokens are
// allocated per dispatch at dispatch grain (plus the parent remainder at session grain); its active minutes are
// allocated once, at session grain (30 / 2 groups), never per dispatch. grain-activemin-dispatch stays the
// negative control: the same minutes allocated at dispatch grain are an activeMin-partitioned violation.
test('activemin-session-grain fixture: minutes at session grain conserve with zero violations; dispatch grain stays a violation', () => {
  const run = (c) => {
    const dir = join(joinDir, c);
    const lines = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s));
    const trace = JSON.parse(readFileSync(join(dir, 'trace.json'), 'utf8'));
    return { trace, r: checkConservation(new Map(lines.map((l) => [`${l.host}:${l.id}`, { line: l }])), trace) };
  };
  const { trace, r } = run('activemin-session-grain');
  const minutes = trace.allocations.filter((a) => a.quantity === 'activeMin');
  assert.ok(minutes.length >= 2 && minutes.every((a) => (a.grain ?? 'session') === 'session'), 'minutes only at session grain');
  assert.ok(new Set(trace.allocations.filter((a) => a.grain === 'dispatch').map((a) => a.dispatch)).size >= 2, 'a multi-dispatch line');
  assert.deepEqual(r, { violations: [], unallocated: [] });
  assert.deepEqual(run('grain-activemin-dispatch').r.violations.map((v) => v.rule), ['activeMin-partitioned']);
});
