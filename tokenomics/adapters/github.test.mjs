// GitHub Issues receipt adapter (Plan 7 Task 5): a fake `gh` on PATH, a hermetic env, one child per run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSchemas } from '../kit/schema.mjs';
import { sandboxEnv, fakeBin, assertNoSentinels } from '../fixtures/trackers/harness.mjs';
import { fakeGhSource, STANDARD_NODES, issue } from '../fixtures/trackers/fake-gh.mjs';

const ADAPTER = fileURLToPath(new URL('./github.mjs', import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'ht-gh-'));
after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
const schemas = loadSchemas();
let n = 0;
const outputs = [];

// A fresh repo dir (with a ledger naming `ids`, an optional origin) and a fresh bin with the fake gh.
function setup({ ids = [], origin = 'https://github.com/o/r.git', project, gh = {}, noGh = false } = {}) {
  const tmp = join(sandbox, `t${n++}`);
  const repo = join(tmp, 'repo');
  const bin = join(tmp, 'bin');
  mkdirSync(join(tmp, 'home'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(tmp, 'gitconfig'), '[init]\n\tdefaultBranch = main\n');
  const env = sandboxEnv(tmp, { bin });
  const git = (...a) => assert.equal(spawnSync('git', a, { cwd: repo, env }).status, 0);
  git('init', '-q');
  if (origin) git('remote', 'add', 'origin', origin);
  const lines = ids.map((id, i) => ({ v: 1, host: 'claude', id: `s${i}`, capturedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:00:00Z', cases: [id] }));
  if (lines.length) writeFileSync(join(repo, 'usage-x.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  if (project) {
    mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
    writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ extension: null, tracker: { kind: 'github', project } }));
  }
  const log = join(tmp, 'gh.log');
  if (!noGh) fakeBin(bin, 'gh', fakeGhSource({ nodes: STANDARD_NODES, log, ...gh }));
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { repo, env, calls };
}
const run = (s, args = []) => {
  const r = spawnSync(process.execPath, [ADAPTER, ...args, '--repo', s.repo], { env: s.env, encoding: 'utf8', timeout: 60000 });
  outputs.push(r.stdout, r.stderr);
  return r;
};
const cases = (r) => JSON.parse(r.stdout).receipts[0].cases;

test('outcomes: delivered / open / closed-not_planned / closed-duplicate / pull-request / missing, validated', () => {
  const s = setup();
  const r = run(s, ['--ids', 'gh:1,gh:2,gh:3,gh:4,gh:5,gh:6']);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(validate(schemas['receipts-envelope.json'], doc, { schemas }), []);
  assert.equal(doc.complete, false); // 6 is missing
  assert.equal(doc.receipts[0].group, 'gh:o/r');
  assert.equal(doc.receipts[0].source, 'github');
  assert.deepEqual(cases(r), [
    { id: 'gh:1', outcome: 'delivered', at: '2026-03-01T10:00:00Z', atSource: 'closedAt', type: 'enhancement' },
    { id: 'gh:2', outcome: 'open' },
    { id: 'gh:3', outcome: 'closed-not_planned' },
    { id: 'gh:4', outcome: 'closed-duplicate' },
    { id: 'gh:5', outcome: 'pull-request' },
    { id: 'gh:6', outcome: 'missing' },
  ]);
  const [call] = s.calls();
  assert.deepEqual(call.argv.slice(0, 2), ['api', 'graphql']);
});

test('complete:true when every requested id resolves', () => {
  const r = run(setup(), ['--ids', 'gh:1,gh:2']);
  assert.equal(JSON.parse(r.stdout).complete, true);
});

test('NOT_FOUND errors on null aliases are missing, not a failure; any other error fails', () => {
  const r = run(setup({ gh: { mode: 'notfound' } }), ['--ids', 'gh:2,gh:6']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(cases(r).map((c) => c.outcome), ['open', 'missing']);
  assert.equal(JSON.parse(r.stdout).complete, false);
});

test('partial-error branches: garbage on exit 1, NOT_FOUND on a non-null alias, a mixed error set all fail cleanly', () => {
  for (const mode of ['garbage', 'extra', 'mixed']) {
    const r = run(setup({ gh: { mode } }), ['--ids', 'gh:2,gh:6']);
    assert.equal(r.status, 1, `${mode}: ${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.match(r.stderr.trimEnd(), mode === 'garbage' ? /^github: cli \(1\)$/ : /^github: graphql \(errors\)$/);
    assertNoSentinels([r.stderr]);
  }
});

test('leading zeros are invalid ids: gh:007 never aliases gh:7', () => {
  const s = setup({ ids: ['gh:007', 'gh:2', 'gh:0'] });
  const r = run(s);
  assert.deepEqual(cases(r).map((c) => c.id), ['gh:2']);
  assert.match(r.stderr, /skipped 2 invalid ids/);
  assert.deepEqual(s.calls()[0].aliases, [2]);
});

test('Jira/ADO credentials are not passed to gh', () => {
  const s = setup({ gh: { dumpEnv: true } });
  s.env.JIRA_API_TOKEN = 'SENTINEL-TOKEN-7f3a'; s.env.AZURE_DEVOPS_EXT_PAT = 'SENTINEL-PAT-7f3a';
  const r = run(s, ['--ids', 'gh:2']);
  assert.equal(r.status, 0, r.stderr);
  const seen = s.calls()[0].envKeys;
  assert.ok(Array.isArray(seen) && seen.includes('PATH'));
  assert.ok(!seen.includes('JIRA_API_TOKEN') && !seen.includes('AZURE_DEVOPS_EXT_PAT'));
});

test('ids default to every gh: id in the ledger; an invalid id is skipped and counted on stderr', () => {
  const s = setup({ ids: ['gh:2', 'gh:1', 'jira:PAY-1', 'gh:abc', 'gh:2', 'gh:1234567890'] });
  const r = run(s);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(cases(r).map((c) => c.id), ['gh:1', 'gh:2']);
  assert.match(r.stderr, /github: skipped 2 invalid ids/);
  assert.equal(r.stderr.trim().split('\n').length, 1);
});

test('no valid id: complete:true, no receipts, gh never called', () => {
  const s = setup({ ids: ['jira:PAY-1', 'gh:abc'] });
  const r = run(s);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { schema: 1, complete: true, receipts: [] });
  assert.equal(s.calls().length, 0);
});

test('failures: gh missing, gh unauthenticated, HTTP 200 with errors[] -> exit 1 and one stderr line', () => {
  const cases3 = [
    [setup({ noGh: true }), /^github: cli \(missing\)$/],
    [setup({ gh: { mode: 'unauth' } }), /^github: auth \(4\)$/],
    [setup({ gh: { mode: 'errors' } }), /^github: graphql \(errors\)$/],
  ];
  for (const [s, re] of cases3) {
    const r = run(s, ['--ids', 'gh:1']);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr.trimEnd(), re);
    assert.equal(r.stderr.trimEnd().split('\n').length, 1);
  }
});

test('no repository to ask: exit 1 config, nothing guessed', () => {
  const r = run(setup({ origin: null }), ['--ids', 'gh:1']);
  assert.equal(r.status, 1);
  assert.match(r.stderr.trimEnd(), /^github: config \(repository\)$/);
});

test('settings.tracker.project (owner/repo) beats the origin', () => {
  const s = setup({ project: 'a/b' });
  const r = run(s, ['--ids', 'gh:2']);
  assert.equal(JSON.parse(r.stdout).receipts[0].group, 'gh:a/b');
  assert.match(s.calls()[0].argv.join(' '), /owner:"a",name:"b"/);
  // exactly owner/repo: anything else is a config failure (exit 2), and gh is never asked
  for (const project of ['a/b/c', 'a', 'a/', '/b']) {
    const x = setup({ project });
    const bad = run(x, ['--ids', 'gh:2']);
    assert.equal(bad.status, 2, project);
    assert.equal(bad.stderr.trimEnd(), 'github: config (project)');
    assert.equal(x.calls().length, 0);
  }
});

test('type is the first of bug/feature/enhancement among the labels; other labels never appear', () => {
  const nodes = {
    1: issue({ state: 'CLOSED', stateReason: 'COMPLETED', closedAt: 'x', labels: { nodes: [{ name: 'PRIVATE_TITLE-label' }, { name: 'Feature' }, { name: 'bug' }] } }),
    2: issue({ state: 'OPEN', labels: { nodes: [{ name: 'docs' }, { name: 'p1' }] } }),
  };
  const r = run(setup({ gh: { nodes } }), ['--ids', 'gh:1,gh:2']);
  const cs = cases(r);
  assert.equal(cs[0].type, 'feature');
  assert.ok(!('type' in cs[1]));
  assert.ok(!r.stdout.includes('docs') && !r.stdout.includes('p1'));
});

test('150 ids make two gh calls with 100 and 50 aliases', () => {
  const ids = Array.from({ length: 150 }, (_, i) => `gh:${i + 1}`);
  const s = setup();
  const r = run(s, ['--ids', ids.join(',')]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(s.calls().map((c) => c.aliases.length), [100, 50]);
  assert.equal(cases(r).length, 150);
});

test('privacy: titles and people the API returns never reach any output', () => {
  const s = setup({ ids: ['gh:1', 'gh:5'] });
  const r = run(s);
  assert.equal(r.status, 0);
  assertNoSentinels([r.stdout, r.stderr, ...s.calls().map((c) => c.argv)]);
  const bad = run(setup({ gh: { mode: 'errors' } }), ['--ids', 'gh:1']);
  const bad2 = run(setup({ gh: { mode: 'unauth' } }), ['--ids', 'gh:1']);
  assertNoSentinels([bad.stdout, bad.stderr, bad2.stdout, bad2.stderr]);
});

test('bad usage exits 2', () => {
  const r = spawnSync(process.execPath, [ADAPTER, '--nope'], { env: setup().env, encoding: 'utf8' });
  assert.equal(r.status, 2);
});

after(() => assertNoSentinels(outputs));
