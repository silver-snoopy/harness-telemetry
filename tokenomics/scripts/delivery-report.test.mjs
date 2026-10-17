// delivery-report (Plan 7 Task 4): cost per ticket and per merged PR over the delivery join, with tracker status
// through the §5.6 receipt command. Every run is a child with a hermetic env (D-TESTKIT); the receipt command is the
// real node fetching from the fixture server, itself a child process.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetRules } from '../engine/trackers.mjs';
import { installCopy } from '../engine/install-copy.mjs';
import { sandboxEnv, startServer, assertNoSentinels } from '../fixtures/trackers/harness.mjs';

const SCRIPT = fileURLToPath(new URL('./delivery-report.mjs', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../..', import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'ht-dr-'));
after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));

// --- the fixture repo ------------------------------------------------------------------------------------------------
const tmp = join(sandbox, 'fx');
mkdirSync(join(tmp, 'home'), { recursive: true });
writeFileSync(join(tmp, 'gitconfig'), '[init]\n\tdefaultBranch = main\n[user]\n\tname = T\n\temail = t@example.invalid\n');
const env = sandboxEnv(tmp, { bin: join(tmp, 'bin') });
const repo = join(tmp, 'p');
mkdirSync(repo);
const g = (args, at) => {
  const r = spawnSync('git', args, { cwd: repo, env: at ? { ...env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
g(['init', '-q']);
g(['commit', '-q', '--allow-empty', '-m', 'init'], '2026-09-01T00:00:00Z');
const mergeFrom = (branch, subject, at) => {
  g(['checkout', '-q', '-b', branch]);
  g(['commit', '-q', '--allow-empty', '-m', 'work'], at);
  g(['checkout', '-q', 'main']);
  g(['commit', '-q', '--allow-empty', '-m', 'main moves'], at);
  g(['merge', '-q', '--no-ff', branch, '-m', subject], at);
};
mergeFrom('feat/PAY-5-old', 'Merge pull request #5 from o/feat/PAY-5-old', '2026-09-20T12:00:00Z'); // outside the window
mergeFrom('PRIVATE_BRANCH/PAY-1-x', 'Merge pull request #7 from o/PRIVATE_BRANCH/PAY-1-x', '2026-10-02T12:00:00Z');
g(['commit', '-q', '--allow-empty', '-m', 'fix WEB-2 thing (#9)'], '2026-10-02T15:00:00Z');
mergeFrom('feat/WEB-3', "Merge branch 'feat/WEB-3'", '2026-10-02T16:00:00Z');
mergeFrom('feat/PAY-6-late', 'Merge pull request #11 from o/feat/PAY-6-late', '2026-10-05T12:00:00Z'); // after the 10-03 window

const line = (o) => ({ v: 1, host: 'claude', capturedAt: o.endedAt, ...o });
const LINES = [
  // ended 10-02 00:01Z, started 10-01 23:59Z: in the 10-02 window (the window is on endedAt)
  line({ id: 's1', startedAt: '2026-10-01T23:59:00Z', endedAt: '2026-10-02T00:01:00Z', branch: 'PRIVATE_BRANCH/PAY-1-x', cases: ['jira:PAY-1'], costUsd: 2, activeMin: 10 }),
  line({ id: 's2', startedAt: '2026-10-02T08:00:00Z', endedAt: '2026-10-02T09:00:00Z', cases: ['jira:PAY-1', 'jira:WEB-2'], costUsd: 3, activeMin: 30 }),
  line({ id: 's3', startedAt: '2026-10-02T09:30:00Z', endedAt: '2026-10-02T10:00:00Z', branch: 'main', cases: [], costUsd: 1, activeMin: 5 }),
  line({ id: 's4', startedAt: '2026-10-02T10:30:00Z', endedAt: '2026-10-02T11:00:00Z', branch: 'feat/PAY-4-y', cases: ['jira:PAY-4'], activeMin: 7 }),
  // a conflict: the same host:id at the same rank with different costs
  line({ id: 's5', endedAt: '2026-10-02T13:00:00Z', cases: ['jira:PAY-1'], costUsd: 1 }),
  line({ id: 's5', endedAt: '2026-10-02T13:00:00Z', cases: ['jira:PAY-1'], costUsd: 5 }),
  line({ id: 's7', endedAt: '2026-09-15T10:00:00Z', cases: ['jira:PAY-1'], costUsd: 100 }), // before the window
  line({ id: 's8', endedAt: '2026-10-03T00:00:00Z', cases: ['jira:PAY-1'], costUsd: 50 }), // at until: excluded
  // in the 10-03 window, on a branch merged after it (R5: the spend goes to #11, not to unmerged)
  line({ id: 's9', endedAt: '2026-10-03T05:00:00Z', branch: 'feat/PAY-6-late', cases: ['jira:PAY-6'], costUsd: 1 }),
];
mkdirSync(join(repo, '.agents', 'telemetry', 'automation'), { recursive: true });
writeFileSync(join(repo, '.agents', 'telemetry', 'automation', 'usage-x.jsonl'), `${LINES.map((l) => JSON.stringify(l)).join('\n')}\n`);

const settings = (command) => {
  mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({
    extension: null,
    ids: { rules: presetRules('jira', { keys: ['PAY', 'WEB'] }) },
    receipts: { deliveredOutcomes: ['delivered'], ...(command ? { command, timeoutSec: 20 } : {}) },
  }));
};
const WINDOW = ['--since', '2026-10-02', '--until', '2026-10-03', '--prs', 'none'];
const outputs = []; // every stdout, stderr and --out file, for the privacy check
const report = (args, { cwd = repo, script = SCRIPT, e = env } = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, env: e, encoding: 'utf8', timeout: 60000 });
  outputs.push(r.stdout, r.stderr);
  return r;
};

// --- the receipt server (a child process) and the command that reads it --------------------------------------------
const PRIVATE = { title: 'PRIVATE_TITLE', assignee: 'PRIVATE_PERSON' };
const ENVELOPE = {
  schema: 1, complete: true,
  receipts: [{ group: 'jira:PAY', source: 'jira', cases: [
    // the later `at` wins although it is read first
    { id: 'jira:PAY-1', outcome: 'delivered', at: '2026-10-02T13:00:00Z', type: 'Story', points: 3, sprint: { name: 'S1', owner: 'PRIVATE_PERSON' }, ...PRIVATE },
    { id: 'jira:PAY-1', outcome: 'open', at: '2026-10-01T00:00:00Z', type: 'Story', points: 3, sprint: { name: 'S1', owner: 'PRIVATE_PERSON' }, ...PRIVATE },
    { id: 'jira:WEB-2', outcome: 'delivered', at: '2026-10-02T16:00:00Z', type: 'Bug', points: 1, sprint: { owner: 'PRIVATE_PERSON' }, ...PRIVATE },
  ] }],
};
const ROUTES = join(sandbox, 'routes.mjs');
writeFileSync(ROUTES, `const ok = ${JSON.stringify(ENVELOPE)};
const pay4 = { id: 'jira:PAY-4', outcome: 'delivered', at: '2026-10-02T17:00:00Z', type: 'Task' };
export default (req) => req.url === '/partial' ? { json: { ...ok, complete: false } }
  : req.url === '/tokens' ? { json: { ...ok, receipts: [{ ...ok.receipts[0], cases: [...ok.receipts[0].cases, pay4] }] } }
  : req.url === '/malformed' ? { json: { schema: 2, complete: true, receipts: [] } } : { json: ok };\n`);
const FETCH = join(sandbox, 'fetch-receipts.mjs');
writeFileSync(FETCH, "const r = await fetch(process.argv[2]); process.stdout.write(await r.text());\n");
let server;
before(async () => { server = await startServer(ROUTES, { dir: join(sandbox, 'srv') }); });
after(async () => { await server?.stop(); });
const fetchCmd = (path) => [process.execPath, FETCH, `${server.url}${path}`];

// The Markdown table under `## <title>`: rows of cells, header first.
const table = (md, title) => {
  const lines = md.split('\n');
  const at = lines.indexOf(`## ${title}`);
  assert.ok(at >= 0, `no section ${title}:\n${md}`);
  const rows = [];
  for (const l of lines.slice(at + 1)) {
    if (l.startsWith('## ')) break;
    if (l.startsWith('|') && !/^\|[-| ]+\|$/.test(l)) rows.push(l.slice(1, -1).split('|').map((c) => c.trim()));
  }
  return rows;
};
const dollars = (s) => { const m = /\$(\d+\.\d\d)/.exec(s); return m ? +m[1] : 0; };
const col = (rows, name) => { const i = rows[0].indexOf(name); assert.ok(i >= 0, `no column ${name}`); return rows.slice(1).map((r) => r[i]); };

test('(a) Markdown: header, totals, by ticket, by PR and notes; ticket costs plus unattributed equal the spend', () => {
  settings(null);
  const r = report(WINDOW);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const md = r.stdout;
  assert.match(md, /^base: main \(local, not fetched\)$/m);
  assert.match(md, /^prs: git-only \(PR enrichment off \(--prs none\)\)$/m);
  assert.match(md, /^coverage: complete$/m);
  assert.match(md, /^window: 2026-10-02T00:00:00\.000Z → 2026-10-03T00:00:00\.000Z$/m);
  assert.match(md, /^tracker: not configured \(setup --tracker …\)$/m);
  assert.match(md, /^conflicts: 1 \(/m);

  assert.match(md, /^- spend: \$6\.00 over 4 sessions$/m);
  assert.match(md, /^- priced \/ tokens-only: 3 \/ 1$/m);
  assert.match(md, /^- merged PRs: 2$/m);
  assert.match(md, /^- tickets with spend: 3$/m);
  assert.match(md, /^- unattributed \(no ticket\): \$1\.00 \(1 session\)$/m);
  assert.match(md, /^- unattributed \(no PR, on the base\): \$1\.00 \(1 session\)$/m);
  assert.match(md, /^- in progress \(unmerged\): \$0\.00 \(1 session, 1 tokens-only\)$/m);

  const tickets = table(md, 'By ticket');
  assert.deepEqual(tickets[0], ['ticket', 'sessions', 'cost', 'active min', 'PRs', 'state']);
  assert.deepEqual(tickets.slice(1), [
    ['jira:PAY-1', '2 (1 shared)', '$3.50', '25', '#7', 'merged 2026-10-02'],
    ['jira:WEB-2', '1 (1 shared)', '$1.50', '15', '#9', 'merged 2026-10-02'],
    ['jira:PAY-4', '1', '— (tokens-only)', '7', '—', 'in progress'],
  ]);
  const spend = dollars(/^- spend: (.*)$/m.exec(md)[1]);
  const unattributed = dollars(/^- unattributed \(no ticket\): (.*)$/m.exec(md)[1]);
  const sum = col(tickets, 'cost').reduce((a, c) => a + dollars(c), 0) + unattributed;
  assert.equal(Math.round(sum * 100), Math.round(spend * 100));

  const prs = table(md, 'By PR');
  assert.deepEqual(prs[0], ['PR', 'ids', 'cost', 'sessions', 'merged']);
  assert.deepEqual(prs.slice(1), [
    ['#7', 'jira:PAY-1', '$3.50', '2 (1 shared)', '2026-10-02'],
    ['#9', 'jira:WEB-2', '$1.50', '1 (1 shared)', '2026-10-02'],
    ['—', 'jira:WEB-3', '$0.00', '0', '2026-10-02'],
  ]);
  const notes = md.slice(md.indexOf('## Notes'));
  for (const limit of [/reverted PR still counts as merged/, /squash commit with `\(#N\)`/, /git-only rebase merge is invisible/, /single recorded branch/]) assert.match(notes, limit);
});

test('(b) --json: the join plus base, PR source, coverage and receipts; window on endedAt; conflicts excluded; merges windowed', () => {
  settings(null);
  const r = report([...WINDOW, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  for (const k of ['tickets', 'prs', 'unattributed', 'unmerged', 'totals', 'trace', 'base', 'prsSource', 'coverage', 'receipts']) assert.ok(k in j, k);
  assert.deepEqual(j.base, { ref: 'main', shallow: false });
  assert.deepEqual([j.prsSource, j.coverage], ['git-only', 'complete']);
  assert.equal(j.trace.conserved, true);
  assert.deepEqual(j.totals, { sessions: 4, costUsd: 6, priced: 3, tokensOnly: 1, activeMin: 52, mergedPrs: 2, ticketsWithSpend: 3 });
  // s1 started 10-01 23:59Z and ended 10-02 00:01Z: in; s8 ended exactly at until: out; s7 before since: out
  assert.equal(j.tickets['jira:PAY-1'].sessions, 2);
  assert.equal(j.tickets['jira:PAY-1'].costUsd, 3.5);
  assert.deepEqual([j.conflicts, j.undated], [1, 0]);
  // PR #5 merged 09-20 is outside the window; the merge with no PR number is keyed merge:<hex>
  assert.deepEqual(Object.keys(j.prs).filter((k) => !k.startsWith('merge:')).sort(), ['7', '9']);
  assert.equal(Object.keys(j.prs).length, 3);
  // one shape per receipts state, with or without --receipts
  const NOT_CONFIGURED = { status: 'not configured', reason: 'not configured', complete: false };
  assert.deepEqual(j.receipts, NOT_CONFIGURED);
  assert.deepEqual(JSON.parse(report([...WINDOW, '--json', '--receipts']).stdout).receipts, NOT_CONFIGURED);
  // without the window flags, everything is in (since = the earliest endedAt), and #5 is back
  const all = JSON.parse(report(['--prs', 'none', '--json']).stdout);
  assert.ok('5' in all.prs);
  assert.equal(all.totals.costUsd, 157);
  // a bad date is refused
  const bad = report(['--since', 'Oct 1']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--since/);
  assert.equal(report(['--prs', 'svn']).status, 2);
});

test('(c) --receipts: status columns, the later receipt wins, unknown ids, by type and by sprint, the membership metric', () => {
  settings(fetchCmd('/ok'));
  const r = report([...WINDOW, '--receipts']);
  assert.equal(r.status, 0, r.stderr);
  const md = r.stdout;
  assert.match(md, /^tracker: available$/m);
  const tickets = table(md, 'By ticket');
  assert.deepEqual(tickets[0], ['ticket', 'sessions', 'cost', 'active min', 'PRs', 'state', 'status', 'type', 'points', 'sprint']);
  assert.deepEqual(tickets.slice(1).map((x) => x.slice(6)), [['delivered', 'Story', '3', 'S1'], ['delivered', 'Bug', '1', '—'], ['unknown', '—', '—', '—']]);
  assert.deepEqual(table(md, 'By type').slice(1), [['Story', '1', '$3.50'], ['Bug', '1', '$1.50']]);
  assert.deepEqual(table(md, 'By sprint').slice(1), [['S1', '1', '$3.50'], ['—', '1', '$1.50']]);
  assert.match(md, /^cost per delivered ticket: \$2\.50 over 2 delivered — membership metric \(split shares\), not the §5\.5 ratio\nnote: a delivered ticket whose sessions are all tokens-only counts in the denominator at \$0 \(0 here\)$/m);
  const j = JSON.parse(report([...WINDOW, '--receipts', '--json']).stdout);
  assert.deepEqual(j.receipts.tickets['jira:PAY-1'], { status: 'delivered', outcome: 'delivered', type: 'Story', points: 3, sprint: 'S1' });
  assert.deepEqual(j.receipts.tickets['jira:WEB-2'], { status: 'delivered', outcome: 'delivered', type: 'Bug', points: 1, sprint: null });
  assert.deepEqual(j.receipts.tickets['jira:PAY-4'], { status: 'unknown', outcome: null, type: null, points: null, sprint: null });
  assert.deepEqual([j.receipts.status, j.receipts.complete, j.receipts.delivered, j.receipts.costPerDelivered], ['available', true, 2, 2.5]);
  // a delivered ticket that is entirely tokens-only counts at $0 in the denominator, and the report says so
  settings(fetchCmd('/tokens'));
  const tk = report([...WINDOW, '--receipts']).stdout;
  assert.match(tk, /^cost per delivered ticket: \$1\.67 over 3 delivered — /m);
  assert.match(tk, /^note: a delivered ticket whose sessions are all tokens-only counts in the denominator at \$0 \(1 here\)$/m);
  assert.match(tk.slice(tk.indexOf('## Notes')), /tokens-only counts in the cost-per-delivered denominator at \$0/);
  assert.match(tk.slice(tk.indexOf('## Notes')), /rounded to the cent/);
});

test('(c) --receipts: partial, failing, malformed, unconfigured, and not run without the flag', () => {
  settings(fetchCmd('/partial'));
  const p = report([...WINDOW, '--receipts']).stdout;
  assert.match(p, /^tracker: available \(partial: adapter reported complete:false\)$/m);
  assert.match(p, /^cost per delivered ticket: .* not the §5\.5 ratio \(partial: adapter reported complete:false\)$/m);

  settings([process.execPath, '-e', 'process.exit(1)']);
  const f = report([...WINDOW, '--receipts']);
  assert.equal(f.status, 0, f.stderr);
  assert.match(f.stdout, /^tracker: unavailable \(command failed: exit 1\)$/m);
  assert.doesNotMatch(f.stdout, /^cost per delivered ticket:|^- delivered tickets|^note: a delivered|^## By type|^## By sprint|\| delivered \|/m);
  assert.match(f.stdout, /^- spend: \$6\.00 over 4 sessions$/m, 'the git-derived report stands');
  assert.deepEqual(table(f.stdout, 'By ticket')[0], ['ticket', 'sessions', 'cost', 'active min', 'PRs', 'state']);

  // R16: the real Jira adapter with no tracker url says why, through its fixed failure line
  settings([process.execPath, join(PACKAGE, 'tokenomics', 'adapters', 'jira.mjs')]);
  const nourl = report([...WINDOW, '--receipts']);
  assert.match(nourl.stdout, /^tracker: unavailable \(command failed: exit 2 — jira: config \(url\)\)$/m);

  // a spawn error prints its code only, never the command path (here under a sentinel directory)
  settings([join(sandbox, 'PRIVATE_PERSON', 'no-such-bin')]);
  const enoent = report([...WINDOW, '--receipts']);
  const enoentJson = report([...WINDOW, '--receipts', '--json']);
  assert.match(enoent.stdout, /^tracker: unavailable \(command failed: ENOENT\)$/m);
  assert.deepEqual(JSON.parse(enoentJson.stdout).receipts, { status: 'unavailable', reason: 'command failed: ENOENT', complete: false });
  assertNoSentinels([enoent.stdout, enoent.stderr, enoentJson.stdout, enoentJson.stderr]);

  settings(fetchCmd('/malformed'));
  assert.match(report([...WINDOW, '--receipts']).stdout, /^tracker: unavailable \(malformed output: \$\.schema expected const 1\)$/m);

  settings(null);
  assert.match(report([...WINDOW, '--receipts']).stdout, /^tracker: not configured \(setup --tracker …\)$/m);

  const marker = join(sandbox, 'ran');
  settings([process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '1')`]);
  const n = report(WINDOW);
  assert.equal(existsSync(marker), false, 'the receipt command ran without --receipts');
  assert.match(n.stdout, /^tracker: configured, not run \(pass --receipts\)$/m);
  report([...WINDOW, '--receipts']);
  assert.equal(existsSync(marker), true, 'control: --receipts runs it');
});

test('(d) the gate: an inert installed copy refuses --out before the settings load; stdout stays available', () => {
  const t2 = join(sandbox, 'gate');
  mkdirSync(join(t2, 'home'), { recursive: true });
  writeFileSync(join(t2, 'gitconfig'), '[init]\n\tdefaultBranch = main\n[user]\n\tname = T\n\temail = t@example.invalid\n');
  const e2 = sandboxEnv(t2, {});
  const consumer = join(t2, 'repo');
  mkdirSync(consumer);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: consumer, env: e2 }).status, 0);
  const { dest } = installCopy({ packageRoot: PACKAGE, repo: consumer, target: 'claude' });
  const script = join(dest, 'scripts', 'delivery-report.mjs');
  const out = join(t2, 'report.md');

  const ro = report([], { cwd: consumer, script, e: e2 });
  assert.equal(ro.status, 0, ro.stderr);
  assert.match(ro.stdout, /^## Totals$/m);

  mkdirSync(join(consumer, '.agents', 'tokenomics'), { recursive: true });
  writeFileSync(join(consumer, '.agents', 'tokenomics', 'settings.json'), '{ nope');
  const w = report(['--out', out], { cwd: consumer, script, e: e2 });
  assert.equal(w.status, 1);
  assert.match(w.stderr, /^tokenomics: inactive — engine .* copied but \.agents\/tokenomics\/settings\.json is unreadable/);
  assert.equal(w.stderr.trim().split('\n').length, 1, w.stderr);
  assert.equal(w.stdout, '');
  assert.equal(existsSync(out), false);
});

test('(e) privacy: no title, person or branch in the Markdown, the JSON, the --out file or stderr', () => {
  settings(fetchCmd('/ok'));
  const out = join(sandbox, 'out.md');
  const md = report([...WINDOW, '--receipts']);
  const json = report([...WINDOW, '--receipts', '--json']);
  const file = report([...WINDOW, '--receipts', '--out', out]);
  assert.equal(file.status, 0, file.stderr);
  assert.equal(file.stdout, '');
  const written = readFileSync(out, 'utf8');
  assert.equal(written, md.stdout);
  assert.match(json.stdout, /"sprint": "S1"/);
  assertNoSentinels([...outputs, written]);
  assert.doesNotMatch([...outputs, written].join('\n'), /feat\/WEB-3|feat\/PAY-4-y|PAY-5-old|PAY-6-late/);
});

test('(R5) the window filters lines only: in-window spend goes to the merge that shipped it, even after --until', () => {
  settings(null);
  const args = ['--since', '2026-10-03', '--until', '2026-10-04', '--prs', 'none'];
  const j = JSON.parse(report([...args, '--json']).stdout);
  // s9 goes by branch to #11, merged 10-05 after the window; s8 (at since, PAY-1, no branch) ended after #7 merged
  // (10-02), so #7 did not ship it (R7): it is in progress
  assert.deepEqual(Object.keys(j.prs).sort(), ['11'], 'PRs merged in the window plus PRs receiving its spend');
  assert.deepEqual([j.prs['11'].sessions, j.prs['11'].costUsd], [1, 1]);
  assert.match(j.prs['11'].mergedAt, /^2026-10-05T12:00:00/);
  assert.deepEqual([j.unmerged.sessions, j.unmerged.costUsd], [1, 50]);
  assert.equal(j.totals.mergedPrs, 1);
  assert.equal(j.trace.conserved, true);
  assert.deepEqual(j.tickets['jira:PAY-6'].prs, [11]);
  const md = report(args).stdout;
  assert.deepEqual(table(md, 'By PR').slice(1), [['#11', 'jira:PAY-6', '$1.00', '1', '2026-10-05']]);
  assert.match(md, /^- merged PRs: 1$/m);
  assert.match(md, /^- in progress \(unmerged\): \$50\.00 \(1 session\)$/m);
  assert.match(md, /merge that shipped it even when that merge lies outside the window/);
  assertNoSentinels([md]);
});

test('(R14) a historical unprefixed ledger id joins the ruled ticket; the ledger file is never rewritten', () => {
  settings(null);
  const extra = join(repo, '.agents', 'telemetry', 'automation', 'usage-legacy.jsonl');
  const text = `${JSON.stringify(line({ id: 's10', endedAt: '2026-10-02T09:30:00Z', cases: ['PAY-1', 'jira:PAY-1'], costUsd: 4 }))}\n`;
  writeFileSync(extra, text);
  try {
    const r = report([...WINDOW, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal('PAY-1' in j.tickets, false);
    assert.equal(j.tickets['jira:PAY-1'].sessions, 3);
    assert.equal(j.tickets['jira:PAY-1'].costUsd, 7.5);
    assert.equal(j.trace.conserved, true);
    assert.equal(readFileSync(extra, 'utf8'), text);
  } finally { rmSync(extra, { force: true }); }
});
