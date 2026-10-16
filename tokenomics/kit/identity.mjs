import { canonical, accountingPayload } from './canonical.mjs';

const ms = (s) => { const t = typeof s === 'string' ? Date.parse(s) : NaN; return Number.isNaN(t) ? -Infinity : t; };
const rank = (l) => [ms(l.endedAt), ms(l.capturedAt)];
const cmpNum = (a, b) => (a > b ? 1 : a < b ? -1 : 0);
// Per-component compare: -Infinity === -Infinity must compare equal (subtraction yields NaN).
const cmp = (a, b) => cmpNum(a[0], b[0]) || cmpNum(a[1], b[1]);

export function dedup(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!e.line?.host || !e.line?.id) continue;
    const k = `${e.line.host}:${e.line.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const winners = new Map(); const conflicts = []; const ownership = [];
  for (const [k, list] of groups) {
    const top = list.reduce((best, e) => { const c = cmp(rank(e.line), rank(best[0].line)); return c > 0 ? [e] : c === 0 ? [...best, e] : best; }, [list[0]]);
    // One representative per accounting payload: the entry with the lowest full canonical line,
    // so observer labels (repo/user/branch/capturedAt) do not depend on input order.
    const byPayload = new Map();
    for (const e of top) {
      const p = canonical(accountingPayload(e.line));
      const prev = byPayload.get(p);
      if (!prev || canonical(e.line) < canonical(prev.line)) byPayload.set(p, e);
    }
    const keys = [...byPayload.keys()].sort();
    winners.set(k, byPayload.get(keys[0]));
    if (keys.length > 1) conflicts.push({ key: k, entries: keys.map((p) => byPayload.get(p)) });
    const repos = [...new Set(list.map((e) => e.line.repo))].sort();
    const users = [...new Set(list.map((e) => e.line.user))].sort();
    if (repos.length > 1 || users.length > 1) ownership.push({ key: k, repos, users });
  }
  return { winners, conflicts, ownership };
}
