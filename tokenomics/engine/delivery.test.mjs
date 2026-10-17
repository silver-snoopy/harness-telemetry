import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultBranch, mergedWork, joinDelivery, isPriced } from './delivery.mjs';
import { presetRules } from './trackers.mjs';
import { TA_DEFAULTS } from './config.mjs';
import { sandboxEnv, fakeCli, readArgv } from '../fixtures/trackers/harness.mjs';

const settings = { ...TA_DEFAULTS, ids: { ...TA_DEFAULTS.ids, rules: presetRules('jira', { keys: ['PAY', 'WEB'] }) } };

const sandbox = mkdtempSync(join(tmpdir(), 'ht-dlv-'));
after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
let n = 0;

// A fresh repo under its own sandbox: `g(...)` runs git there and returns trimmed stdout; `commit(msg)` an empty commit.
function makeRepo({ origin = null } = {}) {
  const tmp = join(sandbox, `r${n++}`);
  mkdirSync(join(tmp, 'home'), { recursive: true });
  writeFileSync(join(tmp, 'gitconfig'), '[init]\n\tdefaultBranch = main\n[user]\n\tname = T\n\temail = t@example.invalid\n');
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  const env = sandboxEnv(tmp, { bin });
  const repo = join(tmp, 'p');
  mkdirSync(repo);
  const g = (...a) => { const r = spawnSync('git', a, { cwd: repo, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = (msg) => { g('commit', '-q', '--allow-empty', '-m', msg); return g('rev-parse', 'HEAD'); };
  g('init', '-q');
  commit('init');
  if (origin) g('remote', 'add', 'origin', origin);
  return { tmp, bin, env, repo, g, commit, argvLog: join(tmp, 'argv.jsonl') };
}
const byPr = (items, pr) => items.filter((i) => i.pr === pr);

test('defaultBranch: origin/HEAD, else main, else master; shallow flag', () => {
  const a = makeRepo();
  assert.deepEqual(defaultBranch(a.repo, a.env), { ref: 'main', name: 'main', shallow: false });
  a.g('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
  a.g('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
  assert.deepEqual(defaultBranch(a.repo, a.env), { ref: 'origin/trunk', name: 'trunk', shallow: false });
  const b = makeRepo();
  b.g('branch', '-m', 'main', 'master');
  assert.deepEqual(defaultBranch(b.repo, b.env), { ref: 'master', name: 'master', shallow: false });
  b.g('branch', '-m', 'master', 'other');
  assert.deepEqual(defaultBranch(b.repo, b.env), { ref: null, name: null, shallow: false });
  assert.deepEqual(mergedWork(b.repo, { settings, prs: 'none', env: b.env }).items, []);
});

test('(a) a real two-parent merge gives pr and branch; a one-parent commit with the same subject is skipped', () => {
  const r = makeRepo();
  r.g('checkout', '-q', '-b', 'feat/PAY-1-login');
  r.commit('work');
  r.g('checkout', '-q', 'main');
  r.commit('main moves');
  r.g('merge', '-q', '--no-ff', 'feat/PAY-1-login', '-m', 'Merge pull request #7 from o/feat/PAY-1-login');
  const merge = r.g('rev-parse', 'HEAD');
  const fake = r.commit('Merge pull request #7 from o/feat/PAY-1-login');
  const w = mergedWork(r.repo, { settings, prs: 'none', env: r.env });
  assert.equal(w.prs, 'git-only');
  const seven = byPr(w.items, 7);
  assert.equal(seven.length, 1);
  assert.equal(seven[0].commit, merge);
  assert.notEqual(seven[0].commit, fake);
  assert.deepEqual({ ...seven[0], commit: undefined, at: undefined },
    { commit: undefined, at: undefined, pr: 7, branch: 'feat/PAY-1-login', ids: ['jira:PAY-1'], source: 'git' });
  assert.match(seven[0].at, /^\d{4}-\d\d-\d\dT/);
  // Merge branch: two parents gives the branch; a merge of the base into itself is not merged work.
  r.g('checkout', '-q', '-b', 'feat/WEB-5-x');
  r.commit('w');
  r.g('checkout', '-q', 'main');
  r.commit('m');
  r.g('merge', '-q', '--no-ff', 'feat/WEB-5-x', '-m', "Merge branch 'feat/WEB-5-x'");
  const w2 = mergedWork(r.repo, { settings, prs: 'none', env: r.env });
  const mb = w2.items.find((i) => i.branch === 'feat/WEB-5-x');
  assert.deepEqual([mb.pr, mb.ids, mb.source], [null, ['jira:WEB-5'], 'git']);
});

test('(b) squash only: git-only without gh; a fake gh fills the branch and the ids, with explicit selectors', () => {
  const r = makeRepo({ origin: 'https://github.com/o/r.git' });
  const sq = r.commit('add login (#9)');
  // No gh at all: PATH without the node dir (git lives in /usr/bin), and nothing named gh on it.
  const noGh = { ...r.env, PATH: [r.bin, '/usr/bin', '/bin'].join(':') };
  for (const d of noGh.PATH.split(':')) assert.ok(!existsSync(join(d, 'gh')), `gh found in ${d}`);
  const w = mergedWork(r.repo, { settings, prs: 'auto', env: noGh });
  assert.equal(w.prs, 'git-only');
  assert.match(w.reason, /gh/);
  const nine = byPr(w.items, 9);
  assert.deepEqual([nine.length, nine[0].commit, nine[0].branch, nine[0].ids, nine[0].source], [1, sq, null, [], 'git']);

  fakeCli(r.bin, 'gh', { argvLog: r.argvLog, stdout: JSON.stringify([{ number: 9, headRefName: 'feat/PAY-3-x', mergedAt: '2026-01-01T00:00:00Z', mergeCommit: { oid: sq } }]) });
  const e = mergedWork(r.repo, { settings, prs: 'auto', env: r.env });
  assert.equal(e.prs, 'gh');
  assert.equal(e.coverage, 'complete');
  assert.equal(e.reason, undefined);
  const nine2 = byPr(e.items, 9);
  assert.deepEqual([nine2.length, nine2[0].branch, nine2[0].ids, nine2[0].source], [1, 'feat/PAY-3-x', ['jira:PAY-3'], 'git']);
  const argv = readArgv(r.argvLog);
  assert.equal(argv.length, 1);
  const a = argv[0].join(' ');
  assert.match(a, /^pr list /);
  assert.match(a, /--repo o\/r/);
  assert.match(a, /--base main/);
  assert.match(a, /--state merged --limit 2000 --json number,headRefName,mergedAt,mergeCommit/);
  assert.doesNotMatch(a, /title/);

  // gh failing is git-only with the reason; the exit code is named, stderr never forwarded.
  fakeCli(r.bin, 'gh', { stdout: 'nope', code: 4 });
  const f = mergedWork(r.repo, { settings, prs: 'gh', env: r.env });
  assert.deepEqual([f.prs, f.reason], ['git-only', 'gh failed: exit 4']);
  fakeCli(r.bin, 'gh', { stdout: 'not json' });
  assert.match(mergedWork(r.repo, { settings, prs: 'gh', env: r.env }).reason, /malformed/);
});

test('(c) ADO subjects, rebase merges from the CLI, and the 2000-row cap', () => {
  const r = makeRepo({ origin: 'https://github.com/o/r.git' });
  r.commit('Merged PR 31: add PAY-8 thing');
  const rebased = r.commit('plain rebased commit');
  const w = mergedWork(r.repo, { settings, prs: 'none', env: r.env });
  assert.deepEqual(byPr(w.items, 31).map((i) => [i.branch, i.ids, i.source]), [[null, ['jira:PAY-8'], 'git']]);
  assert.equal(w.items.length, 1, 'the unmarked commit is skipped without the CLI');

  const rows = [
    { number: 40, headRefName: 'feat/PAY-4-r', mergedAt: '2026-02-02T00:00:00Z', mergeCommit: { oid: rebased } },
    { number: 41, headRefName: 'feat/PAY-6-gone', mergedAt: '2026-02-03T00:00:00Z', mergeCommit: { oid: 'f'.repeat(40) } },
    { number: 42, headRefName: 'feat/x', mergedAt: '2026-02-04T00:00:00Z', mergeCommit: null },
  ];
  fakeCli(r.bin, 'gh', { stdout: JSON.stringify(rows) });
  const e = mergedWork(r.repo, { settings, prs: 'gh', env: r.env });
  assert.equal(e.coverage, 'complete');
  assert.deepEqual(byPr(e.items, 40), [{ commit: rebased, at: '2026-02-02T00:00:00Z', pr: 40, branch: 'feat/PAY-4-r', ids: ['jira:PAY-4'], source: 'cli' }]);
  assert.deepEqual([byPr(e.items, 41).length, byPr(e.items, 42).length], [0, 0], 'unreachable or missing merge commits are not merged work');

  const many = Array.from({ length: 2000 }, (_, i) => ({ number: 1000 + i, headRefName: 'b', mergedAt: '2026-01-01T00:00:00Z', mergeCommit: { oid: 'e'.repeat(40) } }));
  fakeCli(r.bin, 'gh', { stdout: JSON.stringify(many) });
  const p = mergedWork(r.repo, { settings, prs: 'gh', env: r.env });
  assert.deepEqual([p.prs, p.coverage], ['gh', 'partial (limit 2000)']);
});

test('(c) az enrichment: explicit selectors, paging until a short page', () => {
  const r = makeRepo({ origin: 'https://dev.azure.com/org1/proj1/_git/repo1' });
  const sq = r.commit('Merged PR 31: add a thing');
  const page1 = Array.from({ length: 500 }, (_, i) => ({ pullRequestId: 5000 + i, sourceRefName: 'refs/heads/z', closedDate: '2026-01-01T00:00:00Z', lastMergeCommit: { commitId: 'e'.repeat(40) } }));
  const page2 = [{ pullRequestId: 31, sourceRefName: 'refs/heads/feat/PAY-5-a', closedDate: '2026-01-02T00:00:00Z', lastMergeCommit: { commitId: sq } }];
  fakeCli(r.bin, 'az', { argvLog: r.argvLog, stdout: `(argv) => JSON.stringify(argv[argv.indexOf('--skip') + 1] === '0' ? ${JSON.stringify(page1)} : ${JSON.stringify(page2)})` });
  const e = mergedWork(r.repo, { settings, prs: 'auto', env: r.env });
  assert.deepEqual([e.prs, e.coverage], ['az', 'complete']);
  assert.deepEqual(byPr(e.items, 31).map((i) => [i.branch, i.ids]), [['feat/PAY-5-a', ['jira:PAY-5']]]);
  const argv = readArgv(r.argvLog).map((a) => a.join(' '));
  assert.equal(argv.length, 2);
  assert.match(argv[0], /^repos pr list --organization https:\/\/dev\.azure\.com\/org1 --project proj1 --repository repo1 --target-branch refs\/heads\/main --status completed --top 500 --skip 0 -o json$/);
  assert.match(argv[1], /--skip 500 /);

  fakeCli(r.bin, 'az', { stdout: JSON.stringify(page1) });
  const p = mergedWork(r.repo, { settings, prs: 'az', env: r.env });
  assert.deepEqual([p.prs, p.coverage], ['az', 'partial (page cap 10 × 500)']);
  // --prs gh on an ADO remote has no GitHub repo to select: git-only with the reason.
  const g = mergedWork(r.repo, { settings, prs: 'gh', env: r.env });
  assert.deepEqual([g.prs, g.reason], ['git-only', 'origin is not a GitHub remote']);
});

// ---- the join ----
const line = (o) => ({ costUsd: 0, activeMin: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, startedAt: '2026-03-01T00:00:00Z', endedAt: '2026-03-01T01:00:00Z', ...o });
const item = (o) => ({ commit: 'c'.repeat(40), at: '2026-03-01T00:00:00Z', pr: null, branch: null, ids: [], source: 'git', ...o });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('isPriced: a number, 0 included; null and missing are tokens-only', () => {
  assert.equal(isPriced({ costUsd: 0 }), true);
  assert.equal(isPriced({ costUsd: 1.5 }), true);
  assert.equal(isPriced({ costUsd: null }), false);
  assert.equal(isPriced({}), false);
});

test('(d) conservation: even ticket splits, reused branches, unmerged and unattributed', () => {
  const items = [
    item({ pr: 1, branch: 'b', at: '2026-03-01T00:30:00Z', commit: '1'.repeat(40) }),
    item({ pr: 2, branch: 'b', at: '2026-03-02T00:00:00Z', commit: '2'.repeat(40), ids: ['jira:PAY-1', 'jira:WEB-2'] }),
  ];
  const lines = [
    line({ costUsd: 10, activeMin: 30, tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }, cases: ['jira:PAY-1', 'jira:WEB-2', 'jira:PAY-1'], branch: 'b' }),
    line({ costUsd: null, activeMin: 4, cases: ['jira:PAY-1'], branch: 'b' }),
    line({ costUsd: 0, scope: { cases: ['jira:PAY-1'] }, branch: 'b' }),
    line({ costUsd: 3, cases: ['jira:PAY-9'], branch: 'b', endedAt: '2026-03-05T00:00:00Z' }),
    line({ costUsd: 2, cases: [], branch: 'main' }),
  ];
  const j = joinDelivery(lines, items, { base: 'main' });
  const pay1 = j.tickets['jira:PAY-1'];
  const web2 = j.tickets['jira:WEB-2'];
  close(pay1.costUsd, 5); close(web2.costUsd, 5);
  assert.deepEqual([pay1.sessions, pay1.shared, pay1.priced, pay1.tokensOnly], [3, 1, 2, 1]);
  assert.deepEqual([web2.sessions, web2.shared, web2.priced, web2.tokensOnly], [1, 1, 1, 0]);
  close(pay1.activeMin, 15 + 4); close(pay1.tokens, 50);
  assert.deepEqual([pay1.prs, pay1.mergedAt, pay1.firstAt, pay1.lastAt], [[2], '2026-03-02T00:00:00Z', '2026-03-01T00:00:00Z', '2026-03-01T01:00:00Z']);
  // Branch reuse: the $10 line ended after #1 merged and before #2 did, so #2 alone gets it.
  close(j.prs['1'].costUsd, 0);
  close(j.prs['2'].costUsd, 10);
  assert.deepEqual([j.prs['2'].sessions, j.prs['2'].priced, j.prs['2'].tokensOnly, j.prs['2'].pr], [3, 2, 1, 2]);
  assert.deepEqual(j.prs['2'].ids, ['jira:PAY-1', 'jira:WEB-2']);
  // Never merged: PAY-9 spend ended after the last merge on b, so it is in progress; the ticket keeps its spend.
  close(j.unmerged.costUsd, 3);
  assert.deepEqual([j.tickets['jira:PAY-9'].mergedAt, j.tickets['jira:PAY-9'].prs], [null, []]);
  close(j.tickets['jira:PAY-9'].costUsd, 3);
  // No ids on main: unattributed in both views.
  close(j.unattributed.tickets.costUsd, 2); close(j.unattributed.prs.costUsd, 2);
  assert.equal(j.unattributed.tickets.sessions, 1);
  // Totals and trace.
  assert.deepEqual({ ...j.totals, costUsd: undefined, activeMin: undefined },
    { sessions: 5, costUsd: undefined, priced: 4, tokensOnly: 1, activeMin: undefined, mergedPrs: 2, ticketsWithSpend: 3 });
  close(j.totals.costUsd, 15);
  close(j.trace.tickets, j.totals.costUsd);
  close(j.trace.prs, j.totals.costUsd);
  assert.equal(j.trace.conserved, true);
});

test('(d) the brief scenario alone: one $10 line, two tickets, two PRs on one branch', () => {
  const items = [item({ pr: 1, branch: 'b', at: '2026-03-01T00:30:00Z' }), item({ pr: 2, branch: 'b', at: '2026-03-02T00:00:00Z' })];
  const j = joinDelivery([line({ costUsd: 10, cases: ['jira:PAY-1', 'jira:WEB-2'], branch: 'b' })], items);
  assert.deepEqual([j.tickets['jira:PAY-1'].costUsd, j.tickets['jira:WEB-2'].costUsd, j.tickets['jira:PAY-1'].shared], [5, 5, 1]);
  assert.deepEqual([j.prs['1'].costUsd, j.prs['2'].costUsd, j.prs['2'].shared], [0, 10, 0]);
  assert.deepEqual([j.trace.tickets, j.trace.prs, j.totals.costUsd], [10, 10, 10]);
});

test('(e) a branchless squash naming the ticket gets the line by id, split across n such PRs', () => {
  // merged after the line ended (R7: by id only a merge at or after endedAt shipped the line)
  const items = [item({ pr: 9, ids: ['jira:PAY-3'], at: '2026-03-02T00:00:00Z' }), item({ pr: 5, ids: ['jira:PAY-3', 'jira:WEB-1'], commit: 'd'.repeat(40), at: '2026-03-02T00:00:00Z' })];
  const j = joinDelivery([line({ costUsd: 8, cases: ['jira:PAY-3'], branch: 'whatever' })], items);
  close(j.prs['9'].costUsd, 4); close(j.prs['5'].costUsd, 4);
  assert.equal(j.prs['9'].shared, 1);
  const one = joinDelivery([line({ costUsd: 8, cases: ['jira:PAY-3'], branch: 'whatever' })], [items[0]]);
  close(one.prs['9'].costUsd, 8);
  assert.equal(one.trace.conserved, true);
  // A branch-less merge commit (Merge branch, no PR number) is still a PR-view row, keyed by its commit.
  const mb = joinDelivery([line({ costUsd: 1, cases: [], branch: 'x', endedAt: '2026-02-01T00:00:00Z' })], [item({ branch: 'x', commit: 'a'.repeat(40) })]);
  assert.deepEqual(Object.keys(mb.prs), [`merge:${'a'.repeat(12)}`]);
  assert.equal(mb.prs[`merge:${'a'.repeat(12)}`].pr, null);
  close(mb.prs[`merge:${'a'.repeat(12)}`].costUsd, 1);
});

test('R7: by id, a merge before the line ended never receives it; the line is in progress; no endedAt matches any', () => {
  // PAY-1 merged on day 1 via squash (#5); a line naming it on a new branch ends on day 3 with no new merge.
  const items = [item({ pr: 5, ids: ['jira:PAY-1'], at: '2026-03-01T12:00:00Z' })];
  const late = line({ costUsd: 3, cases: ['jira:PAY-1'], branch: 'feat/PAY-1-again', startedAt: '2026-03-03T00:00:00Z', endedAt: '2026-03-03T01:00:00Z' });
  const j = joinDelivery([late], items, { base: 'main' });
  assert.deepEqual([j.prs['5'].sessions, j.prs['5'].costUsd], [0, 0]);
  assert.deepEqual([j.unmerged.sessions, j.unmerged.costUsd], [1, 3]);
  assert.equal(j.trace.conserved, true);
  close(j.tickets['jira:PAY-1'].costUsd, 3);
  // a merge at exactly endedAt still ships it; with several naming merges only the ones at or after endedAt share it
  const at = joinDelivery([late], [...items, item({ pr: 6, ids: ['jira:PAY-1'], at: '2026-03-03T01:00:00Z', commit: 'e'.repeat(40) }),
    item({ pr: 8, ids: ['jira:PAY-1'], at: '2026-03-04T00:00:00Z', commit: 'f'.repeat(40) })], { base: 'main' });
  assert.deepEqual([at.prs['5'].costUsd, at.prs['6'].costUsd, at.prs['8'].costUsd, at.unmerged.sessions], [0, 1.5, 1.5, 0]);
  assert.equal(at.trace.conserved, true);
  // a line without a readable endedAt keeps matching any naming merge
  const undated = joinDelivery([{ ...late, endedAt: undefined }], items, { base: 'main' });
  close(undated.prs['5'].costUsd, 3);
  assert.equal(undated.trace.conserved, true);
});

test('R4: no PR match is in progress (unmerged) unless the line is ticketless on the base branch or branchless', () => {
  const items = [item({ pr: 1, branch: 'b', ids: ['jira:PAY-1'] })];
  const lines = [
    line({ costUsd: 1, cases: [], branch: 'feat/never-merged' }),
    line({ costUsd: 2, cases: [], branch: 'main' }),
    line({ costUsd: 4, cases: ['jira:PAY-7'], branch: 'main' }),
    line({ costUsd: 8, cases: [] }),
  ];
  const j = joinDelivery(lines, items, { base: 'main' });
  close(j.unmerged.costUsd, 1 + 4);
  assert.equal(j.unmerged.sessions, 2);
  close(j.unattributed.prs.costUsd, 2 + 8);
  assert.equal(j.unattributed.prs.sessions, 2);
  assert.equal(j.trace.conserved, true);
  close(j.trace.prs, 15);
  // Without a base, only a branchless ticketless line is unattributed; the ticketless line on main is unmerged.
  const k = joinDelivery(lines, items);
  close(k.unmerged.costUsd, 1 + 2 + 4);
  close(k.unattributed.prs.costUsd, 8);
  assert.equal(k.trace.conserved, true);
});

test('(f) privacy: PR rows carry no branch', () => {
  const items = [item({ pr: 3, branch: 'feat/PRIVATE_BRANCH', ids: ['jira:PAY-1'] })];
  const j = joinDelivery([line({ costUsd: 1, cases: ['jira:PAY-1'], branch: 'feat/PRIVATE_BRANCH', endedAt: '2026-02-01T00:00:00Z' })], items);
  for (const row of Object.values(j.prs)) assert.ok(!('branch' in row));
  assert.doesNotMatch(JSON.stringify(j.prs), /PRIVATE_BRANCH/);
  assert.doesNotMatch(JSON.stringify(j), /PRIVATE_BRANCH/);
});
