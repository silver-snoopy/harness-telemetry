// Azure DevOps Boards receipt adapter (Plan 7 Task 6): the D-TESTKIT server in a child process, a fake az on PATH,
// a hermetic env, one child per run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSchemas } from '../kit/schema.mjs';
import { sandboxEnv, fakeCli, readArgv, startServer, assertNoSentinels, SENTINEL } from '../fixtures/trackers/harness.mjs';
import { endpointOf } from './azure-devops.mjs';

const ADAPTER = fileURLToPath(new URL('./azure-devops.mjs', import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'ht-ado-'));
after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
const schemas = loadSchemas();
let n = 0;
const outputs = [];
const F = { state: 'System.State', type: 'System.WorkItemType', points: 'Microsoft.VSTS.Scheduling.StoryPoints', sprint: 'System.IterationPath', closed: 'Microsoft.VSTS.Common.ClosedDate' };

// Routes source: items {id: fields}; `omit` ids are unknown to the server; `failCall` makes that (1-based) call answer
// 500 with a body carrying the PAT sentinel; every item also carries a private title and person. Like the real API
// (errorPolicy defaults to Fail), a batch naming an unknown id answers 404 unless the body says errorPolicy 'Omit',
// which answers null in that id's place.
const routesSource = ({ items = {}, omit = [], failCall = 0, all = false } = {}) => `
let calls = 0;
const items = ${JSON.stringify(items)};
const omit = ${JSON.stringify(omit)};
export default (req, body) => {
  calls++;
  if (${failCall} && calls === ${failCall}) return { status: 500, json: { error: '${SENTINEL.PAT} ${Buffer.from(`:${SENTINEL.PAT}`).toString('base64')}' } };
  const { ids, errorPolicy } = JSON.parse(body);
  if (errorPolicy !== 'Omit' && ids.some((i) => omit.includes(i))) return { status: 404, json: { message: 'TF401232: Work item does not exist' } };
  const value = ids.map((id) => omit.includes(id) ? null : ({ id, rev: 3, url: 'https://x/PRIVATE_URL',
    fields: { ...(${all} ? { 'System.State': 'Done' } : {}), ...(items[id] ?? {}), 'System.Title': 'PRIVATE_TITLE', 'System.AssignedTo': { displayName: 'PRIVATE_PERSON' } } }));
  return { status: 200, json: { count: value.length, value } };
};
`;

async function setup({ routes, tracker = { kind: 'ado', url: 'https://dev.azure.com/acme', project: 'Proj' }, origin, az, env: extra = {}, ids = [] } = {}) {
  const tmp = join(sandbox, `t${n++}`);
  const repo = join(tmp, 'repo');
  const bin = join(tmp, 'bin');
  mkdirSync(join(tmp, 'home'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(tmp, 'gitconfig'), '[init]\n\tdefaultBranch = main\n');
  const env = { ...sandboxEnv(tmp, { bin }), ...extra };
  const git = (...a) => assert.equal(spawnSync('git', a, { cwd: repo, env }).status, 0);
  git('init', '-q');
  if (origin) git('remote', 'add', 'origin', origin);
  if (tracker) {
    mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
    writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ extension: null, tracker }));
  }
  if (ids.length) writeFileSync(join(repo, 'usage-x.jsonl'), `${ids.map((id, i) => JSON.stringify({ v: 1, host: 'claude', id: `s${i}`, capturedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:00:00Z', cases: [id] })).join('\n')}\n`);
  const azLog = join(tmp, 'az.log');
  if (az !== undefined) fakeCli(bin, 'az', { stdout: az, argvLog: azLog });
  let srv;
  if (routes) {
    const rp = join(tmp, 'routes.mjs');
    writeFileSync(rp, routesSource(routes));
    srv = await startServer(rp, { dir: tmp });
  }
  return { repo, env, srv, azCalls: () => readArgv(azLog) };
}
const run = (s, args = []) => {
  const r = spawnSync(process.execPath, [ADAPTER, ...args, '--repo', s.repo, ...(s.srv ? ['--base-url', s.srv.url] : [])], { env: s.env, encoding: 'utf8', timeout: 60000 });
  outputs.push(r.stdout, r.stderr);
  return r;
};
const PAT = { AZURE_DEVOPS_EXT_PAT: SENTINEL.PAT };
const cases = (r) => JSON.parse(r.stdout).receipts[0].cases;
const reqs = (s) => s.srv.log().map((l) => ({ ...l, json: JSON.parse(l.body) }));

after(() => assertNoSentinels(outputs));

test('field mapping: Done / Resolved / Closed(no date), sprint is the last path segment, request is org-scoped', async () => {
  const s = await setup({ env: PAT, routes: { items: {
    1: { [F.state]: 'Done', [F.type]: 'User Story', [F.points]: 5, [F.sprint]: 'Proj\\Release 1\\Sprint 4', [F.closed]: '2026-03-01T10:00:00Z' },
    2: { [F.state]: 'Resolved', [F.type]: 'Bug', [F.closed]: '2026-03-02T10:00:00Z' },
    3: { [F.state]: 'Closed', [F.type]: 'Task' },
    4: { [F.state]: 'Active', [F.closed]: '2026-03-04T10:00:00Z' },
  } } });
  try {
    const r = run(s, ['--ids', 'ado:1,ado:2,ado:3,ado:4']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.deepEqual(validate(schemas['receipts-envelope.json'], doc, { schemas }), []);
    assert.equal(doc.complete, true);
    assert.equal(doc.receipts[0].group, 'ado:acme/Proj');
    assert.equal(doc.receipts[0].source, 'ado');
    assert.deepEqual(cases(r), [
      { id: 'ado:1', outcome: 'delivered', at: '2026-03-01T10:00:00Z', atSource: 'ClosedDate', type: 'User Story', points: 5, sprint: 'Sprint 4' },
      { id: 'ado:2', outcome: 'Resolved', type: 'Bug' },
      { id: 'ado:3', outcome: 'delivered', type: 'Task' },
      { id: 'ado:4', outcome: 'Active' },
    ]);
    const [q] = reqs(s);
    assert.equal(q.method, 'POST');
    assert.equal(q.path, '/acme/_apis/wit/workitemsbatch?api-version=7.1');
    assert.deepEqual(q.json, { ids: [1, 2, 3, 4], fields: Object.values(F), errorPolicy: 'Omit' });
    assert.equal(q.headers.authorization, `Basic ${Buffer.from(`:${SENTINEL.PAT}`).toString('base64')}`);
  } finally { await s.srv.stop(); }
});

test('configuration: doneStates overrides the default, fields.points is honoured and requested', async () => {
  const tracker = { kind: 'ado', url: 'https://dev.azure.com/acme', project: 'Proj', doneStates: ['Resolved'], fields: { points: 'Microsoft.VSTS.Scheduling.Effort' } };
  const s = await setup({ env: PAT, tracker, routes: { items: {
    1: { [F.state]: 'Resolved', 'Microsoft.VSTS.Scheduling.Effort': 3, [F.points]: 99 },
    2: { [F.state]: 'Done' },
  } } });
  try {
    const r = run(s, ['--ids', 'ado:1,ado:2']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(cases(r), [{ id: 'ado:1', outcome: 'delivered', points: 3 }, { id: 'ado:2', outcome: 'Done' }]);
    assert.deepEqual(reqs(s)[0].json.fields, [F.state, F.type, 'Microsoft.VSTS.Scheduling.Effort', F.sprint, F.closed]);
  } finally { await s.srv.stop(); }
});

test('configuration: a malformed field name or doneStates is a config failure (exit 2), nothing is requested', async () => {
  for (const extra of [{ fields: { points: 'X Y; drop' } }, { doneStates: 'Done' }, { doneStates: [] }]) {
    const s = await setup({ env: PAT, tracker: { kind: 'ado', url: 'https://dev.azure.com/acme', project: 'P', ...extra }, routes: {} });
    try {
      const r = run(s, ['--ids', 'ado:1']);
      assert.equal(r.status, 2, JSON.stringify(extra));
      assert.match(r.stderr.trimEnd(), /^azure-devops: config \(/);
      assert.equal(s.srv.log().length, 0);
    } finally { await s.srv.stop(); }
  }
});

test('batching: 250 ids make two requests of 200 and 50; a missing id makes complete:false; a 500 on call 2 exits 1', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `ado:${i + 1}`);
  const s = await setup({ env: PAT, routes: { all: true } });
  try {
    const r = run(s, ['--ids', ids.join(',')]);
    assert.equal(r.status, 0, r.stderr);
    const q = reqs(s);
    assert.equal(q.length, 2);
    assert.deepEqual(q[0].json.ids, Array.from({ length: 200 }, (_, i) => i + 1));
    assert.deepEqual(q[1].json.ids, Array.from({ length: 50 }, (_, i) => i + 201));
    assert.equal(cases(r).length, 250);
    assert.equal(JSON.parse(r.stdout).complete, true);
  } finally { await s.srv.stop(); }
  // R12: one deleted or foreign id in a batch is a null entry (errorPolicy Omit), not a failed batch
  const m = await setup({ env: PAT, routes: { all: true, omit: [2, 230] } });
  try {
    const r = run(m, ['--ids', ['ado:1', 'ado:2', 'ado:3', ...ids.slice(200)].join(',')]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(cases(r).map((c) => c.id), ['ado:1', 'ado:3', ...ids.slice(200).filter((i) => i !== 'ado:230')]);
    assert.equal(JSON.parse(r.stdout).complete, false);
    assert.ok(reqs(m).every((q) => q.json.errorPolicy === 'Omit'));
  } finally { await m.srv.stop(); }
  const f = await setup({ env: PAT, routes: { all: true, failCall: 2 } });
  try {
    const r = run(f, ['--ids', ids.join(',')]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr.trimEnd(), 'azure-devops: http (500)');
  } finally { await f.srv.stop(); }
});

test('invalid ids (leading zero, zero; other prefixes are not ours) are skipped and counted; none valid means complete:true, no request', async () => {
  const s = await setup({ env: PAT, routes: { all: true }, ids: ['ado:007', 'ado:5', 'gh:9', 'ado:0'] });
  try {
    const r = run(s);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(cases(r).map((c) => c.id), ['ado:5']);
    assert.match(r.stderr, /skipped 2 invalid ids/);
    const none = run(s, ['--ids', 'ado:007,x']);
    assert.deepEqual(JSON.parse(none.stdout), { schema: 1, complete: true, receipts: [] });
    assert.equal(reqs(s).length, 1);
  } finally { await s.srv.stop(); }
});

test('no credentials: no PAT and no az exits 1 naming AZURE_DEVOPS_EXT_PAT and az login; nothing is requested', async () => {
  const s = await setup({ routes: {} });
  try {
    const r = run(s, ['--ids', 'ado:1']);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr.trimEnd(), /^azure-devops: auth \(.*AZURE_DEVOPS_EXT_PAT.*az login.*\)$/);
    assert.equal(s.srv.log().length, 0);
  } finally { await s.srv.stop(); }
  const failing = await setup({ routes: {}, az: '' });
  try {
    // an az that prints nothing is no token
    const r = run(failing, ['--ids', 'ado:1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr.trimEnd(), /^azure-devops: auth \(.*az login.*\)$/);
  } finally { await failing.srv.stop(); }
});

test('az token: Bearer from captured stdout, argv holds no token, credentials never reach az; a PAT means az is never called', async () => {
  const s = await setup({ routes: { all: true }, az: 't0k\n', env: { JIRA_API_TOKEN: SENTINEL.TOKEN } });
  try {
    const r = run(s, ['--ids', 'ado:1']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(reqs(s)[0].headers.authorization, 'Bearer t0k');
    assert.deepEqual(s.azCalls(), [['account', 'get-access-token', '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--query', 'accessToken', '-o', 'tsv']]);
    assertNoSentinels([s.azCalls()]);
    assert.ok(!r.stdout.includes('t0k') && !r.stderr.includes('t0k'));
  } finally { await s.srv.stop(); }
  const p = await setup({ routes: { all: true }, az: 't0k', env: PAT });
  try {
    assert.equal(run(p, ['--ids', 'ado:1']).status, 0);
    assert.deepEqual(p.azCalls(), []);
    assert.match(reqs(p)[0].headers.authorization, /^Basic /);
  } finally { await p.srv.stop(); }
});

test('privacy and secrets: titles, people, urls, the PAT and its base64 never reach stdout or stderr; a non-loopback http base url exits 2', async () => {
  const s = await setup({ env: PAT, routes: { all: true, failCall: 2 } });
  try {
    const ok = run(s, ['--ids', 'ado:1']);
    assert.equal(ok.status, 0, ok.stderr);
    assertNoSentinels([ok.stdout, ok.stderr]);
    assert.ok(!ok.stdout.includes('PRIVATE_URL'));
    const bad = run(s, ['--ids', 'ado:1,ado:2']);
    assert.equal(bad.status, 1);
    assertNoSentinels([bad.stdout, bad.stderr]);
  } finally { await s.srv.stop(); }
  const x = await setup({ env: PAT });
  const r = spawnSync(process.execPath, [ADAPTER, '--ids', 'ado:1', '--repo', x.repo, '--base-url', 'http://example.com'], { env: x.env, encoding: 'utf8' });
  outputs.push(r.stdout, r.stderr);
  assert.equal(r.status, 2);
  assert.match(r.stderr.trimEnd(), /^azure-devops: config \(base-url\)$/);
});

test('endpoint derivation: settings url, origin remote, visualstudio.com, an override root, and refusals', () => {
  const dev = { kind: 'ado', url: 'https://dev.azure.com/acme', project: 'P' };
  assert.deepEqual(endpointOf({ tracker: dev }, null, undefined), { url: 'https://dev.azure.com/acme/_apis/wit/workitemsbatch?api-version=7.1', org: 'acme', project: 'P' });
  // the override is a server root: the org segment is added
  assert.equal(endpointOf({ tracker: dev }, null, 'http://127.0.0.1:9').url, 'http://127.0.0.1:9/acme/_apis/wit/workitemsbatch?api-version=7.1');
  // the origin remote fills what settings omit
  const remote = { host: 'ado', org: 'o2', project: 'P2', repo: 'r', orgUrl: 'https://dev.azure.com/o2' };
  assert.deepEqual(endpointOf({ tracker: { kind: 'ado' } }, remote, undefined), { url: 'https://dev.azure.com/o2/_apis/wit/workitemsbatch?api-version=7.1', org: 'o2', project: 'P2' });
  assert.equal(endpointOf({ tracker: { kind: 'ado', project: 'Mine' } }, remote, undefined).project, 'Mine');
  const vs = { host: 'ado', org: 'o3', project: 'P3', repo: 'r', orgUrl: 'https://o3.visualstudio.com' };
  assert.equal(endpointOf({ tracker: {} }, vs, undefined).url, 'https://o3.visualstudio.com/_apis/wit/workitemsbatch?api-version=7.1');
  assert.equal(endpointOf({ tracker: {} }, vs, 'http://localhost:1').url, 'http://localhost:1/o3/_apis/wit/workitemsbatch?api-version=7.1');
  // refusals: no org, a credential destination that is not an Azure DevOps host, plain http, embedded credentials
  const refuses = (t, r, o) => assert.throws(() => endpointOf({ tracker: t }, r, o), (e) => e.cls === 'config' && e.exit === 2);
  refuses({}, null, undefined);
  refuses({ url: 'https://evil.example.com/acme' }, null, undefined);
  refuses({ url: 'https://dev.azure.com.evil.io/acme' }, null, undefined);
  refuses({ url: 'http://dev.azure.com/acme' }, null, undefined);
  refuses({ url: 'https://u:p@dev.azure.com/acme' }, null, undefined);
  refuses(dev, null, 'http://example.com');
});
