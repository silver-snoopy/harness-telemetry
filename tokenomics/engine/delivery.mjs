// The delivery join (Plan 7 layer 2, D-DELIVERY and D-JOIN): merged work derived from the local git history, optionally
// enriched by `gh` or `az`, and ledger lines joined to tickets and to PRs with every line's cost conserved by even
// splits (D-ALLOC). Read-only: git is never fetched, the CLIs only list. Branch names are used for joining only and
// never appear in a PR row (D-PRIVACY). STDLIB ONLY.
import { spawnSync } from 'node:child_process';
import { mineIds } from '../hooks/telemetry-capture.mjs';
import { parseRemote } from './trackers.mjs';

const MAX_OUT = 1 << 28;
const GH_LIMIT = 2000;
const AZ_TOP = 500;
const AZ_PAGES = 10;

// A failure-tolerant git call: `{ok, out}`; stderr is never read or forwarded.
function git(repo, args, env) {
  const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000, maxBuffer: MAX_OUT });
  return { ok: r.status === 0 && typeof r.stdout === 'string', out: typeof r.stdout === 'string' ? r.stdout : '' };
}

// The base, with the full ref used internally (`refs/remotes/origin/main`) beside the short one the report prints.
function base(repo, env) {
  const shallow = git(repo, ['rev-parse', '--is-shallow-repository'], env).out.trim() === 'true';
  const head = git(repo, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], env);
  const target = head.ok ? head.out.trim() : '';
  if (target.startsWith('refs/remotes/origin/') && git(repo, ['rev-parse', '-q', '--verify', `${target}^{commit}`], env).ok) {
    return { ref: target.slice('refs/remotes/'.length), name: target.slice('refs/remotes/origin/'.length), full: target, shallow };
  }
  for (const b of ['main', 'master']) {
    if (git(repo, ['rev-parse', '-q', '--verify', `refs/heads/${b}^{commit}`], env).ok) return { ref: b, name: b, full: `refs/heads/${b}`, shallow };
  }
  return { ref: null, name: null, full: null, shallow };
}

/**
 * The base branch merged work is read from: the target of `refs/remotes/origin/HEAD`, else local `main`, else
 * `master`. A local ref, never fetched. `{ref, name, shallow}`: `ref` is what to print (`origin/main`, `main`), `name`
 * the bare branch name the CLIs select by; both null when there is no base.
 */
export function defaultBranch(repo, env = process.env) {
  const { ref, name, shallow } = base(repo, env);
  return { ref, name, shallow };
}

const MERGE_PR = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/;
const MERGE_BRANCH = /^Merge branch '([^']+)'/;
const ADO = /^Merged PR (\d+):/;
const SQUASH = /\(#(\d+)\)\s*$/;

const idsOf = (settings, branch, subject, body) => mineIds(settings, [branch, subject, body].filter(Boolean), { branch });

// One merge item from a first-parent commit, or null when the subject is not a merge marker its parentage allows.
function toItem(commit, at, parents, subject, body, settings, baseName) {
  const two = parents.length >= 2;
  let pr = null;
  let branch = null;
  let m;
  if (two && (m = MERGE_PR.exec(subject))) { pr = +m[1]; branch = m[2]; }
  else if (two && (m = MERGE_BRANCH.exec(subject))) {
    branch = m[1];
    if (branch === baseName) return null; // the base merged into itself (a pull), not merged work
  } else if ((m = ADO.exec(subject))) pr = +m[1];
  else if (parents.length === 1 && (m = SQUASH.exec(subject))) pr = +m[1];
  else return null;
  return { commit, at, pr, branch, ids: idsOf(settings, branch, subject, body), source: 'git' };
}

// Run a listing CLI: `{rows}` or `{reason}`. The child's stderr is never read; the reason names only the failure class.
function listCli(repo, cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000, maxBuffer: MAX_OUT });
  if (r.error) return { reason: r.error.code === 'ENOENT' ? `${cmd} not found` : `${cmd} failed: ${r.error.code ?? 'error'}` };
  if (r.status !== 0) return { reason: `${cmd} failed: exit ${r.status ?? r.signal}` };
  try {
    const rows = JSON.parse(r.stdout);
    if (!Array.isArray(rows)) throw new Error('not an array');
    return { rows };
  } catch { return { reason: `${cmd} returned malformed output` }; }
}

const str = (v) => (typeof v === 'string' && v ? v : null);
const prNum = (v) => (Number.isInteger(v) && v > 0 ? v : null);

// `{rows: [{pr, branch, mergedAt, oid}], partial?}` from gh, or `{reason}`.
function ghPrs(repo, remote, baseName, env) {
  if (remote.host !== 'github') return { reason: 'origin is not a GitHub remote' };
  const r = listCli(repo, 'gh', ['pr', 'list', '--repo', `${remote.owner}/${remote.repo}`, '--base', baseName, '--state', 'merged',
    '--limit', String(GH_LIMIT), '--json', 'number,headRefName,mergedAt,mergeCommit'], env);
  if (r.reason) return r;
  return {
    rows: r.rows.map((x) => ({ pr: prNum(x?.number), branch: str(x?.headRefName), mergedAt: str(x?.mergedAt), oid: str(x?.mergeCommit?.oid) })),
    ...(r.rows.length >= GH_LIMIT ? { partial: `limit ${GH_LIMIT}` } : {}),
  };
}

// `{rows, partial?}` from az, paged by `--top 500 --skip n` until a short page, at most 10 pages; or `{reason}`.
function azPrs(repo, remote, baseName, env) {
  if (remote.host !== 'ado') return { reason: 'origin is not an Azure DevOps remote' };
  const rows = [];
  for (let page = 0; page < AZ_PAGES; page++) {
    const r = listCli(repo, 'az', ['repos', 'pr', 'list', '--organization', remote.orgUrl, '--project', remote.project, '--repository', remote.repo,
      '--target-branch', `refs/heads/${baseName}`, '--status', 'completed', '--top', String(AZ_TOP), '--skip', String(page * AZ_TOP), '-o', 'json'], env);
    if (r.reason) return r;
    for (const x of r.rows) {
      const ref = str(x?.sourceRefName);
      rows.push({ pr: prNum(x?.pullRequestId), branch: ref ? ref.replace(/^refs\/heads\//, '') : null, mergedAt: str(x?.closedDate), oid: str(x?.lastMergeCommit?.commitId) });
    }
    if (r.rows.length < AZ_TOP) return { rows };
  }
  return { rows, partial: `page cap ${AZ_PAGES} × ${AZ_TOP}` };
}

/**
 * Merged work on the base branch (D-DELIVERY), read-only and with no window filtering (the report filters by `at`).
 *
 * `prs`: `'auto'` (gh on a GitHub origin, az on an Azure DevOps origin, else none), `'gh'`, `'az'` or `'none'`.
 * Returns `{items, prs, coverage, reason?}`:
 *  - `items`: `MergeItem = {commit, at, pr, branch, ids, source}` sorted by `at`; `source` is `'git'` for a first-parent
 *    merge marker, `'cli'` for a CLI PR whose merge commit is reachable from the base but which no git item names (a
 *    rebase merge). Enrichment fills a git item's missing `branch` from its PR, and its ids are then mined again.
 *  - `prs`: `'gh'`, `'az'`, or `'git-only'` with `reason` saying why (CLI off, absent, failing, or no matching remote).
 *  - `coverage`: `'complete'` or `'partial (<why>)'` (a CLI cap, shallow history).
 * `branch` is internal (joining only) and must never be printed.
 */
export function mergedWork(repo, { settings, prs = 'auto', env = process.env } = {}) {
  const b = base(repo, env);
  const partial = b.shallow ? ['shallow history'] : [];
  const result = (items, mode, reason) => ({
    items: items.sort((x, y) => num(instant(x.at)) - num(instant(y.at)) || (x.commit < y.commit ? -1 : x.commit > y.commit ? 1 : 0)),
    prs: mode, coverage: partial.length ? `partial (${partial.join(', ')})` : 'complete', ...(reason ? { reason } : {}),
  });
  if (!b.full) return result([], 'git-only', 'no base branch (origin/HEAD, main or master)');

  const items = [];
  const log = git(repo, ['log', '--first-parent', b.full, '--format=%H%x1f%cI%x1f%P%x1f%s%x1f%b%x1e'], env).out;
  for (const rec of log.split('\x1e')) {
    const f = rec.replace(/^\n/, '').split('\x1f');
    if (f.length < 5 || !f[0]) continue;
    const it = toItem(f[0], f[1], f[2].split(' ').filter(Boolean), f[3], f.slice(4).join('\x1f').trim(), settings, b.name);
    if (it) items.push(it);
  }

  const remote = parseRemote(git(repo, ['remote', 'get-url', 'origin'], env).out.trim());
  const mode = prs === 'auto' ? (remote.host === 'github' ? 'gh' : remote.host === 'ado' ? 'az' : 'none') : prs;
  if (mode === 'none') return result(items, 'git-only', prs === 'auto' ? 'origin is neither GitHub nor Azure DevOps' : 'PR enrichment off (--prs none)');
  if (mode !== 'gh' && mode !== 'az') return result(items, 'git-only', `unknown --prs '${mode}'`);
  const listed = mode === 'gh' ? ghPrs(repo, remote, b.name, env) : azPrs(repo, remote, b.name, env);
  if (listed.reason) return result(items, 'git-only', listed.reason);
  if (listed.partial) partial.push(listed.partial);

  // PRs are keyed by number within this one repo and base (the selectors above).
  const byNumber = new Map();
  for (const row of listed.rows) if (row.pr !== null && !byNumber.has(row.pr)) byNumber.set(row.pr, row);
  const named = new Set();
  for (const it of items) {
    if (it.pr === null) continue;
    named.add(it.pr);
    const row = byNumber.get(it.pr);
    if (row?.branch && !it.branch) {
      const { subject, body } = message(repo, it.commit, env);
      it.branch = row.branch;
      it.ids = idsOf(settings, it.branch, subject, body);
    }
  }
  const commits = new Set(items.map((i) => i.commit));
  const candidates = [...byNumber.values()].filter((r) => !named.has(r.pr) && r.oid && !commits.has(r.oid));
  if (candidates.length) {
    const reachable = new Set(git(repo, ['rev-list', b.full], env).out.split('\n').filter(Boolean));
    for (const r of candidates) {
      if (!reachable.has(r.oid)) continue;
      const { subject, body, at } = message(repo, r.oid, env);
      items.push({ commit: r.oid, at: r.mergedAt ?? at, pr: r.pr, branch: r.branch, ids: idsOf(settings, r.branch, subject, body), source: 'cli' });
    }
  }
  return result(items, mode);
}

function message(repo, commit, env) {
  const [subject = '', at = '', ...body] = git(repo, ['log', '-1', '--format=%s%x1f%cI%x1f%b', commit], env).out.split('\x1f');
  return { subject, at, body: body.join('\x1f').trim() };
}

/** D-PRICED: a line is priced when its costUsd is a number (a measured 0 included); every other line is tokens-only. */
export const isPriced = (line) => typeof line?.costUsd === 'number';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const quad = (t) => num(t?.input) + num(t?.output) + num(t?.cacheRead) + num(t?.cacheWrite);
// A line's tokens: the session's own, plus its dispatches' unless the session total is inclusive of them (spec 3.2.1).
const lineTokens = (l) => quad(l.tokens) + (l.tokensBasis === 'inclusive' ? 0 : (l.subagents ?? []).reduce((a, s) => a + quad(s?.tokens), 0));
const instant = (s) => (typeof s === 'string' ? Date.parse(s) : NaN);

const bucket = () => ({ sessions: 0, shared: 0, costUsd: 0, priced: 0, tokensOnly: 0, activeMin: 0, tokens: 0 });
// Accumulate `share` of the line into `b` (batch-cost's addTo pattern): sums scale by share, counts count the line.
function addTo(b, l, share) {
  b.sessions++;
  if (share < 1) b.shared++;
  if (isPriced(l)) { b.costUsd += l.costUsd * share; b.priced++; } else b.tokensOnly++;
  b.activeMin += num(l.activeMin) * share;
  b.tokens += lineTokens(l) * share;
}

const ticketsOf = (l) => [...new Set((Array.isArray(l.cases) ? l.cases : Array.isArray(l.scope?.cases) ? l.scope.cases : []).filter((c) => typeof c === 'string' && c))];
// A PR-view row key: the PR number, or `merge:<12 hex>` for a merge commit without one (a `Merge branch` merge).
const rowKey = (it) => (it.pr !== null && it.pr !== undefined ? String(it.pr) : `merge:${String(it.commit).slice(0, 12)}`);

/**
 * Join ledger lines (already deduplicated and windowed) to merged work (D-JOIN), conserving each line's cost in both
 * views by even splits (D-ALLOC).
 *
 *  - `tickets`: `{[id]: {sessions, shared, costUsd, priced, tokensOnly, activeMin, tokens, firstAt, lastAt, prs[], mergedAt}}`
 *    for every ticket a line names; a line naming k tickets gives each 1/k. `prs` are the PR numbers of the items
 *    naming the ticket; `mergedAt` the earliest such item's `at`, or null (in progress).
 *  - `prs`: an object keyed by PR number as a string (or `merge:<12 hex>` for a merge with no PR number), each row
 *    `{pr, mergedAt, ids[], sessions, shared, costUsd, priced, tokensOnly, activeMin, tokens}` — never a branch. Every
 *    merged item has a row, spend or not. A line goes by branch to the first PR on its branch merged at or after the
 *    line ended (or to `unmerged` when it ended after the last), else by id to each of the n PRs naming one of its
 *    tickets (1/n), else to `unattributed.prs`.
 *  - `unattributed: {tickets, prs}` and `unmerged` are buckets of the row counters.
 *  - `totals: {sessions, costUsd, priced, tokensOnly, activeMin, mergedPrs, ticketsWithSpend}`, from the lines once.
 *  - `trace: {tickets, prs, totals, conserved}`: the two view sums beside `totals.costUsd`, conserved to 1e-9.
 * A line with an unreadable `endedAt` goes to the first merge on its branch.
 */
export function joinDelivery(lines, items) {
  const prs = {};
  const byBranch = new Map();
  const naming = new Map(); // ticket id → row keys of the items naming it
  const sorted = [...items].sort((a, b) => num(instant(a.at)) - num(instant(b.at)));
  for (const it of sorted) {
    const key = rowKey(it);
    const row = prs[key] ??= { pr: it.pr ?? null, mergedAt: it.at ?? null, ids: [], ...bucket() };
    if (it.at && (!row.mergedAt || instant(it.at) < instant(row.mergedAt))) row.mergedAt = it.at;
    row.ids = [...new Set([...row.ids, ...(it.ids ?? [])])].sort();
    if (it.branch) {
      if (!byBranch.has(it.branch)) byBranch.set(it.branch, []);
      byBranch.get(it.branch).push({ key, at: instant(it.at) });
    }
    for (const id of it.ids ?? []) {
      if (!naming.has(id)) naming.set(id, new Map());
      const m = naming.get(id);
      if (!m.has(key) || instant(it.at) < instant(m.get(key).at)) m.set(key, { pr: it.pr ?? null, at: it.at });
    }
  }

  const tickets = {};
  const unattributed = { tickets: bucket(), prs: bucket() };
  const unmerged = bucket();
  const totals = { sessions: 0, costUsd: 0, priced: 0, tokensOnly: 0, activeMin: 0, mergedPrs: Object.keys(prs).filter((k) => prs[k].pr !== null).length, ticketsWithSpend: 0 };

  for (const l of lines) {
    totals.sessions++;
    if (isPriced(l)) { totals.costUsd += l.costUsd; totals.priced++; } else totals.tokensOnly++;
    totals.activeMin += num(l.activeMin);

    const ts = ticketsOf(l);
    if (!ts.length) addTo(unattributed.tickets, l, 1);
    for (const id of ts) {
      const named = [...(naming.get(id)?.values() ?? [])];
      const t = tickets[id] ??= {
        ...bucket(), firstAt: null, lastAt: null,
        prs: [...new Set(named.map((x) => x.pr).filter((p) => p !== null))].sort((a, b) => a - b),
        mergedAt: named.map((x) => x.at).filter(Boolean).sort((a, b) => instant(a) - instant(b))[0] ?? null,
      };
      addTo(t, l, 1 / ts.length);
      const first = l.startedAt ?? l.endedAt ?? null;
      if (first && (!t.firstAt || instant(first) < instant(t.firstAt))) t.firstAt = first;
      if (l.endedAt && (!t.lastAt || instant(l.endedAt) > instant(t.lastAt))) t.lastAt = l.endedAt;
    }

    const onBranch = l.branch ? byBranch.get(l.branch) : undefined;
    if (onBranch) {
      const ended = instant(l.endedAt);
      const hit = Number.isFinite(ended) ? onBranch.find((x) => x.at >= ended) : onBranch[0];
      if (hit) addTo(prs[hit.key], l, 1); else addTo(unmerged, l, 1);
      continue;
    }
    const keys = [...new Set(ts.flatMap((id) => [...(naming.get(id)?.keys() ?? [])]))];
    if (keys.length) for (const k of keys) addTo(prs[k], l, 1 / keys.length);
    else addTo(unattributed.prs, l, 1);
  }
  totals.ticketsWithSpend = Object.keys(tickets).length;

  const sum = (rows) => rows.reduce((a, r) => a + r.costUsd, 0);
  const tSum = sum(Object.values(tickets)) + unattributed.tickets.costUsd;
  const pSum = sum(Object.values(prs)) + unmerged.costUsd + unattributed.prs.costUsd;
  const trace = { tickets: tSum, prs: pSum, totals: totals.costUsd, conserved: Math.abs(tSum - totals.costUsd) < 1e-9 && Math.abs(pSum - totals.costUsd) < 1e-9 };
  return { tickets, prs, unattributed, unmerged, totals, trace };
}
