import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedup } from './identity.mjs';
import { canonical, accountingPayload } from './canonical.mjs';

const L = (o) => ({ line: { v: 1, host: 'claude', id: 's', repo: 'r', user: 'u', capturedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:00:00Z', costUsd: 1, ...o }, file: 'f', n: 1 });

test('later endedAt wins, then later capturedAt', () => {
  const { winners } = dedup([L({ endedAt: '2026-10-01T00:00:00Z', costUsd: 1 }), L({ endedAt: '2026-10-01T01:00:00Z', costUsd: 2 })]);
  assert.equal(winners.get('claude:s').line.costUsd, 2);
  const w2 = dedup([L({ capturedAt: '2026-10-01T02:00:00Z', costUsd: 3 }), L({ costUsd: 4 })]).winners;
  assert.equal(w2.get('claude:s').line.costUsd, 3);
});

test('exact tie, identical payload = duplicate; different payload = conflict', () => {
  assert.equal(dedup([L({}), L({})]).conflicts.length, 0);
  const r = dedup([L({ costUsd: 10 }), L({ costUsd: 20 })]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.winners.get('claude:s').line.costUsd, 10); // lowest canonical
});

test('order-independent', () => {
  const a = dedup([L({ costUsd: 10 }), L({ costUsd: 20 })]).winners.get('claude:s').line.costUsd;
  const b = dedup([L({ costUsd: 20 }), L({ costUsd: 10 })]).winners.get('claude:s').line.costUsd;
  assert.equal(a, b);
});

test('null endedAt ranks lowest', () => {
  const { winners } = dedup([L({ endedAt: null, costUsd: 9 }), L({ endedAt: '2026-01-01T00:00:00Z', costUsd: 1 })]);
  assert.equal(winners.get('claude:s').line.costUsd, 1);
});

test('ownership diagnostics are independent of rank', () => {
  const r = dedup([L({ repo: 'a', endedAt: '2026-10-01T00:00:00Z' }), L({ repo: 'b', endedAt: '2026-10-02T00:00:00Z' })]);
  assert.deepEqual(r.ownership[0].repos, ['a', 'b']);
});

test('canonical sorts keys; accounting payload drops observer labels', () => {
  assert.equal(canonical({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
  assert.deepEqual(Object.keys(accountingPayload({ capturedAt: 1, user: 1, repo: 1, branch: 1, costUsd: 1 })), ['costUsd']);
});

test('no endedAt and no capturedAt: conflict reported, same winner in both input orders', () => {
  const a = dedup([L({ endedAt: null, capturedAt: null, costUsd: 10 }), L({ endedAt: null, capturedAt: null, costUsd: 20 })]);
  const b = dedup([L({ endedAt: null, capturedAt: null, costUsd: 20 }), L({ endedAt: null, capturedAt: null, costUsd: 10 })]);
  assert.equal(a.conflicts.length, 1);
  assert.equal(b.conflicts.length, 1);
  assert.equal(a.winners.get('claude:s').line.costUsd, b.winners.get('claude:s').line.costUsd);
});

test('equal endedAt, both capturedAt missing: conflict reported, same winner in both input orders', () => {
  const a = dedup([L({ capturedAt: null, costUsd: 10 }), L({ capturedAt: null, costUsd: 20 })]);
  const b = dedup([L({ capturedAt: null, costUsd: 20 }), L({ capturedAt: null, costUsd: 10 })]);
  assert.equal(a.conflicts.length, 1);
  assert.equal(b.conflicts.length, 1);
  assert.equal(a.winners.get('claude:s').line.costUsd, b.winners.get('claude:s').line.costUsd);
});

test('identical payloads differing only in observer labels: same winner in both input orders', () => {
  const a = dedup([L({ repo: 'b' }), L({ repo: 'a' })]).winners.get('claude:s').line.repo;
  const b = dedup([L({ repo: 'a' }), L({ repo: 'b' })]).winners.get('claude:s').line.repo;
  assert.equal(a, b);
});
