const TOL = { costUsd: 0.01, activeMin: 1 };
const tol = (q) => TOL[q] ?? 1;

function available(line, q) {
  if (q === 'costUsd') return typeof line.costUsd === 'number' ? line.costUsd : null;
  if (q === 'activeMin') return typeof line.activeMin === 'number' ? line.activeMin : null;
  if (q.startsWith('tokens.')) {
    const c = q.slice(7);
    if (!line.tokens) return null;
    const parent = line.tokens[c];
    if (typeof parent !== 'number') return null;
    if (line.tokensBasis === 'inclusive') return parent;
    const subs = (line.subagents ?? []).map((s) => s.tokens?.[c]);
    if (subs.some((x) => typeof x !== 'number')) return null;
    return parent + subs.reduce((a, b) => a + b, 0);
  }
  return null;
}

export function checkConservation(winners, trace) {
  const rollups = new Set(trace.rollups ?? []);
  const sums = new Map();
  const violations = [];
  // Grain rules (spec 5.4, 3.2.1). A missing grain means session grain; any grain other than session or
  // dispatch is an unknown-grain violation. Dispatch-grain amounts still count toward the session sums below.
  const grainViolation = (a, rule, detail) => violations.push({ source: a.source, quantity: a.quantity, group: a.group, rule, detail });
  const dispatchSums = new Map();
  for (const a of trace.allocations ?? []) {
    if (rollups.has(a.group) || a.grain === undefined || a.grain === 'session') continue;
    if (a.grain !== 'dispatch') { grainViolation(a, 'unknown-grain', `grain ${a.grain} is not session or dispatch`); continue; }
    const line = winners.get(a.source)?.line;
    if (a.quantity === 'activeMin') { grainViolation(a, 'activeMin-partitioned', 'active minutes are never partitioned across dispatches (spec 5.4)'); continue; }
    if (a.quantity.startsWith('tokens.') && line?.tokensBasis === 'inclusive') { grainViolation(a, 'inclusive-dispatch-split', 'tokensBasis inclusive: dispatch tokens are informative and cannot be allocated (spec 3.2.1)'); continue; }
    const d = (line?.subagents ?? []).find((s) => s.id === a.dispatch);
    if (!d) { grainViolation(a, 'unknown-dispatch', `dispatch ${a.dispatch} not in the source line`); continue; }
    const measured = a.quantity === 'costUsd' ? d.costUsd : a.quantity.startsWith('tokens.') ? d.tokens?.[a.quantity.slice(7)] : undefined;
    if (typeof measured !== 'number') { grainViolation(a, 'unmeasured-dispatch-split', `dispatch ${a.dispatch} has no measured ${a.quantity === 'costUsd' ? 'costUsd' : a.quantity}`); continue; }
    const k = `${a.source}\0${a.quantity}\0${a.dispatch}`;
    dispatchSums.set(k, { a, measured, sum: (dispatchSums.get(k)?.sum ?? 0) + a.amount });
  }
  for (const { a, measured, sum } of dispatchSums.values()) {
    if (sum > measured + tol(a.quantity)) grainViolation(a, 'dispatch-overdraw', `dispatch ${a.dispatch} allocated ${sum}, measured ${measured}`);
  }
  for (const a of trace.allocations ?? []) {
    if (rollups.has(a.group)) continue;
    if (!(a.amount >= 0)) { violations.push({ source: a.source, quantity: a.quantity, allocated: a.amount, available: null }); continue; }
    const k = `${a.source}\0${a.quantity}`;
    sums.set(k, (sums.get(k) ?? 0) + a.amount);
  }
  for (const [k, allocated] of sums) {
    const [source, quantity] = k.split('\0');
    const w = winners.get(source);
    const avail = w ? available(w.line, quantity) : null;
    if (avail === null || allocated > avail + tol(quantity)) violations.push({ source, quantity, allocated, available: avail });
  }
  const unallocated = [];
  for (const [source, { line }] of winners) {
    for (const quantity of ['costUsd', 'activeMin', 'tokens.input', 'tokens.output', 'tokens.cacheRead', 'tokens.cacheWrite']) {
      const avail = available(line, quantity);
      if (avail === null) continue;
      const rest = avail - (sums.get(`${source}\0${quantity}`) ?? 0);
      if (rest > tol(quantity)) unallocated.push({ source, quantity, amount: rest, reason: 'not attributed in trace' });
    }
  }
  return { violations, unallocated };
}
