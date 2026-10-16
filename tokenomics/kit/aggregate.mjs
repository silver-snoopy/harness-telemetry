import { realpathSync } from 'node:fs';
import { loadTelemetry } from './load.mjs';
import { loadSchemas } from './schema.mjs';
import { lineFindings } from './invariants.mjs';
import { dedup } from './identity.mjs';
import { HOSTS } from './registry.mjs';

const CATS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const zero = () => ({ sessions: 0, costUsd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
const round = (x) => Math.round(x * 1e6) / 1e6;
// Which metrics a finding taints (spec 1.2: verification is per record and per metric).
const AFFECTS = { 'prompts-unverified': [], ownership: [], 'inclusive-overflow': ['tokens'], 'unknown-cost-source': ['cost'], 'cost-source-mismatch': ['cost'],
  'unknown-version': ['cost', 'tokens'], // spec §7.3: never reaches verified
  'reference-copilot-tokens': ['tokens'], 'reference-vscode-counters': ['tokens'], 'reference-folded': ['tokens'], 'zero-for-unmeasured': ['tokens'] };
const affects = (rule) => AFFECTS[rule] ?? ['cost', 'tokens'];
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Session token total per spec §3.2.1: parent basis = parent + sum(dispatch); inclusive = session only.
// Any unmeasured contribution makes the total unknown (null), never a partial sum.
function sessionTokens(line) {
  if (!line.tokens) return null;
  if (line.tokensBasis === 'inclusive') return { ...line.tokens };
  const out = { ...line.tokens };
  for (const s of line.subagents ?? []) { if (!s.tokens) return null; for (const c of CATS) out[c] += s.tokens[c] ?? 0; }
  return out;
}

function addTo(bucket, { sessions = 0, cost = null, toks = null }) {
  bucket.sessions += sessions;
  if (cost !== null) bucket.costUsd = round(bucket.costUsd + cost);
  if (toks) for (const c of CATS) bucket.tokens[c] += toks[c];
}

// Per-dimension entry: verified totals at the top level, the same record set's unverified totals nested.
function dim(map, key, extra) {
  if (!map[key]) map[key] = { ...zero(), ...extra, unverified: zero() };
  return map[key];
}

export function aggregate(inputs, { since = null, until = null } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('aggregate: at least one --input <mode>:<path> is required');
  for (const [name, v] of [['since', since], ['until', until]]) {
    if (v != null && Number.isNaN(Date.parse(v))) throw new Error(`aggregate: --${name} ${JSON.stringify(v)} is not a parseable date`);
  }
  for (const inp of inputs) {
    if (!['port', 'reference', 'mixed'].includes(inp?.mode)) throw new Error(`aggregate: each input needs mode port|reference|mixed (${inp?.path})`);
  }
  const schemas = loadSchemas();
  const seen = new Map(); // canonical path -> mode
  const entries = [];
  const coverage = { sessions: 0, unpriced: 0, unmeasured: 0, conflicts: 0, identityUnverified: 0, excluded: 0, unrecognized: 0, undated: 0, possibleCollisions: 0 };
  for (const inp of inputs) {
    const p = realpathSync(inp.path);
    if (seen.has(p)) {
      if (seen.get(p) !== inp.mode) throw new Error(`aggregate: ${inp.path} given twice with different modes (${seen.get(p)}, ${inp.mode})`);
      continue;
    }
    seen.set(p, inp.mode);
    const { modules, unrecognized } = loadTelemetry(p);
    coverage.unrecognized += unrecognized.length;
    for (const m of modules) for (const lg of m.ledgers) for (const x of lg.lines) {
      if (!isObj(x.line)) { coverage.excluded++; continue; }
      const f = lineFindings(x.line, { file: lg.file, n: x.n }, { mode: inp.mode, schemas });
      if (f.some((y) => y.class === 'error')) { coverage.excluded++; continue; }
      entries.push({ line: x.line, file: lg.file, n: x.n, mode: inp.mode, module: m.name, findings: f });
    }
  }
  const { winners, conflicts, ownership } = dedup(entries);
  const conflicted = new Set(conflicts.map((c) => c.key));
  const modulesOf = new Map(); const startsOf = new Map();
  for (const e of entries) {
    const k = `${e.line.host}:${e.line.id}`;
    if (!modulesOf.has(k)) { modulesOf.set(k, new Set()); startsOf.set(k, new Set()); }
    modulesOf.get(k).add(e.module);
    if (e.line.startedAt != null) startsOf.get(k).add(e.line.startedAt);
  }
  const inWindow = new Set();
  const byModule = {};
  const verified = zero(); const unverified = zero();
  const byHost = {}; const byUser = {}; const byRole = {}; const byIntent = {};
  const t0 = since ? Date.parse(since) : -Infinity; const t1 = until ? Date.parse(until) : Infinity;
  for (const [key, e] of [...winners].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const l = e.line;
    const end = l.endedAt ? Date.parse(l.endedAt) : NaN;
    if ((since || until) && Number.isNaN(end)) { coverage.undated++; continue; }
    if ((since || until) && !(end >= t0 && end < t1)) continue;
    inWindow.add(key);
    if (conflicted.has(key)) coverage.conflicts++;
    if (HOSTS[l.host]?.ids !== 'generated-uuid' && startsOf.get(key).size > 1) coverage.possibleCollisions++;
    coverage.sessions++;
    const idOk = HOSTS[l.host]?.ids === 'generated-uuid';
    if (!idOk) coverage.identityUnverified++;
    const toks = sessionTokens(l);
    const cost = typeof l.costUsd === 'number' ? l.costUsd : null;
    const hit = (metric) => e.findings.some((f) => ['limitation', 'unverified', 'conflict'].includes(f.class) && affects(f.rule).includes(metric));
    const base = !conflicted.has(key) && idOk;
    const clean = base && cost !== null && !hit('cost'); // session count and cost bucket
    const tokOk = base && toks !== null && 'writer' in l && !hit('tokens');
    if (cost === null) coverage.unpriced++;
    if (!toks) coverage.unmeasured++;
    addTo(clean ? verified : unverified, { sessions: 1, cost });
    addTo(tokOk ? verified : unverified, { toks });
    const labels = [
      [byHost, l.host, { activeMin: 0, turns: 0 }],
      [byUser, l.user ?? '(none)'],
      [byRole, l.scope?.role ?? l.role ?? '(none)'],
      [byIntent, l.scope?.intent ?? '(none)'],
    ];
    for (const mname of modulesOf.get(key)) labels.push([byModule, mname]);
    for (const [map, k, extra] of labels) {
      const d = dim(map, k, extra);
      addTo(clean ? d : d.unverified, { sessions: 1, cost });
      addTo(tokOk ? d : d.unverified, { toks });
      if (extra) { if (Number.isInteger(l.activeMin)) d.activeMin += l.activeMin; if (Number.isInteger(l.turns)) d.turns += l.turns; }
    }
  }
  return { verified, unverified, coverage, byHost, byUser, byRole, byIntent, byModule, ownership: ownership.filter((o) => inWindow.has(o.key)) };
}
