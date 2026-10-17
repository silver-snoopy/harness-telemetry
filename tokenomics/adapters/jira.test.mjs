// Jira receipt adapter (Plan 7 Task 7): the D-TESTKIT server in a child process, a hermetic env, one child per run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSchemas } from '../kit/schema.mjs';
import { sandboxEnv, startServer, assertNoSentinels, SENTINEL } from '../fixtures/trackers/harness.mjs';
import { endpointOf } from './jira.mjs';

const ADAPTER = fileURLToPath(new URL('./jira.mjs', import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'ht-jira-'));
after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
const schemas = loadSchemas();
let n = 0;
const outputs = [];
const CLOUD = { kind: 'jira', url: 'https://acme.atlassian.net' };
const SERVER = { kind: 'jira', url: 'https://jira.example.com/jira', server: true };
const CREDS = { JIRA_EMAIL: SENTINEL.EMAIL, JIRA_API_TOKEN: SENTINEL.TOKEN };
const PAT = { JIRA_PAT: SENTINEL.PAT };
const basic = `Basic ${Buffer.from(`${SENTINEL.EMAIL}:${SENTINEL.TOKEN}`).toString('base64')}`;
const done = (resolutiondate = null, extra = {}) => ({ status: { name: 'Fin', statusCategory: { key: 'done' } }, issuetype: { name: 'Story' }, resolutiondate, ...extra });

// Routes source. mode 'all': every key in the JQL is answered Done. `items` overrides per key; `omit` leaves keys out;
// `extra` adds unrequested keys; `pageSize` (cloud) splits the first chunk into short pages with opaque tokens;
// `repeatToken` answers the same token forever; `dc` answers startAt/total pagination.
const routesSource = ({ items = {}, omit = [], extra = [], pageSize = 0, repeatToken = false, dc = false, total } = {}) => `
const items = ${JSON.stringify(items)};
const omit = ${JSON.stringify(omit)};
const extra = ${JSON.stringify(extra)};
const priv = { summary: 'PRIVATE_TITLE', assignee: { displayName: 'PRIVATE_PERSON' }, reporter: { displayName: 'PRIVATE_PERSON' } };
const mk = (key) => ({ key, self: 'https://x/PRIVATE_URL', fields: { status: { name: 'Fin', statusCategory: { key: 'done' } }, issuetype: { name: 'Story' }, resolutiondate: null, ...(items[key] ?? {}), ...priv } });
export default (req, body) => {
  const b = JSON.parse(body);
  const keys = /\\(([^)]*)\\)/.exec(b.jql)[1].split(',').filter((k) => !omit.includes(k));
  if (${dc}) {
    const all = keys.map(mk);
    const t = ${total === undefined ? 'all.length' : total};
    const page = all.slice(b.startAt, b.startAt + ${pageSize || 100});
    return { status: 200, json: { startAt: b.startAt, maxResults: b.maxResults, total: t, issues: page } };
  }
  const issues = keys.map(mk).concat(extra.map(mk));
  if (${pageSize}) {
    const start = b.nextPageToken ? Number(b.nextPageToken.slice(4)) : 0;
    const page = issues.slice(start, start + ${pageSize});
    const last = start + ${pageSize} >= issues.length;
    return { status: 200, json: { issues: page, ...(last ? { isLast: true } : { isLast: false, nextPageToken: ${repeatToken} ? 'tok-a' : 'tok-' + (start + ${pageSize}) }) } };
  }
  return { status: 200, json: { issues, isLast: true } };
};
`;

async function setup({ routes, tracker = CLOUD, env: extra = {}, ids = [] } = {}) {
  const tmp = join(sandbox, `t${n++}`);
  const repo = join(tmp, 'repo');
  const bin = join(tmp, 'bin');
  mkdirSync(join(tmp, 'home'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(tmp, 'gitconfig'), '[init]\n\tdefaultBranch = main\n');
  const env = { ...sandboxEnv(tmp, { bin }), ...extra };
  if (tracker) {
    mkdirSync(join(repo, '.agents', 'tokenomics'), { recursive: true });
    writeFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), JSON.stringify({ extension: null, tracker }));
  }
  if (ids.length) writeFileSync(join(repo, 'usage-x.jsonl'), `${ids.map((id, i) => JSON.stringify({ v: 1, host: 'claude', id: `s${i}`, capturedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:00:00Z', cases: [id] })).join('\n')}\n`);
  let srv;
  if (routes) {
    const rp = join(tmp, 'routes.mjs');
    writeFileSync(rp, routesSource(routes));
    srv = await startServer(rp, { dir: tmp });
  }
  return { repo, env, srv };
}
const run = (s, args = []) => {
  const r = spawnSync(process.execPath, [ADAPTER, ...args, '--repo', s.repo, ...(s.srv ? ['--base-url', s.srv.url] : [])], { env: s.env, encoding: 'utf8', timeout: 60000 });
  outputs.push(r.stdout, r.stderr);
  return r;
};
const cases = (r) => JSON.parse(r.stdout).receipts[0].cases;
const reqs = (s) => s.srv.log().map((l) => ({ ...l, json: JSON.parse(l.body) }));
const keyList = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `PAY-${a + i}`);
const jiraIds = (keys) => keys.map((k) => `jira:${k}`).join(',');
const keysOf = (q) => /\(([^)]*)\)/.exec(q.json.jql)[1].split(',');

after(() => assertNoSentinels(outputs));

test('cloud: request shape, done category is delivered with resolutiondate, sprint is the last element, no customfield unless configured', async () => {
  const s = await setup({ env: CREDS, routes: { items: {
    'PAY-1': done('2026-03-01T10:00:00.000+0000'),
    'PAY-2': done(null),
    'PAY-3': { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, issuetype: { name: 'Bug' }, resolutiondate: '2026-03-05T00:00:00Z' },
  } } });
  try {
    const r = run(s, ['--ids', 'jira:PAY-1,jira:PAY-2,jira:PAY-3']);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.deepEqual(validate(schemas['receipts-envelope.json'], doc, { schemas }), []);
    assert.equal(doc.complete, true);
    assert.equal(doc.receipts[0].group, 'jira:acme.atlassian.net');
    assert.equal(doc.receipts[0].source, 'jira');
    assert.deepEqual(cases(r), [
      { id: 'jira:PAY-1', outcome: 'delivered', at: '2026-03-01T10:00:00.000+0000', atSource: 'resolutiondate', type: 'Story' },
      { id: 'jira:PAY-2', outcome: 'delivered', type: 'Story' },
      { id: 'jira:PAY-3', outcome: 'indeterminate', type: 'Bug' },
    ]);
    const [q] = reqs(s);
    assert.equal(q.method, 'POST');
    assert.equal(q.path, '/rest/api/3/search/jql');
    assert.deepEqual(q.json, { jql: 'key in (PAY-1,PAY-2,PAY-3)', fields: ['status', 'issuetype', 'resolutiondate'], maxResults: 100 });
    assert.equal(q.headers.authorization, basic);
    assert.ok(!q.body.includes('customfield_'));
  } finally { await s.srv.stop(); }
});

test('cloud: configured custom fields are requested and projected; the sprint is the last array element name', async () => {
  const tracker = { ...CLOUD, fields: { points: 'customfield_10016', sprint: 'customfield_10020' } };
  const s = await setup({ env: CREDS, tracker, routes: { items: {
    'PAY-1': done('2026-03-01T00:00:00Z', { customfield_10016: 5, customfield_10020: [{ name: 'Sprint 1', id: 1 }, { name: 'Sprint 2', id: 2 }] }),
    'PAY-2': done(null, { customfield_10016: 'five', customfield_10020: [] }),
  } } });
  try {
    const r = run(s, ['--ids', 'jira:PAY-1,jira:PAY-2']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(cases(r), [
      { id: 'jira:PAY-1', outcome: 'delivered', at: '2026-03-01T00:00:00Z', atSource: 'resolutiondate', type: 'Story', points: 5, sprint: 'Sprint 2' },
      { id: 'jira:PAY-2', outcome: 'delivered', type: 'Story' },
    ]);
    assert.deepEqual(reqs(s)[0].json.fields, ['status', 'issuetype', 'resolutiondate', 'customfield_10016', 'customfield_10020']);
  } finally { await s.srv.stop(); }
  for (const bad of [{ fields: { points: 'summary' } }, { fields: { sprint: 'customfield_1,assignee' } }, { server: 'yes' }]) {
    const b = await setup({ env: CREDS, tracker: { ...CLOUD, ...bad }, routes: {} });
    try {
      const r = run(b, ['--ids', 'jira:PAY-1']);
      assert.equal(r.status, 2, JSON.stringify(bad));
      assert.match(r.stderr.trimEnd(), /^jira: config \(/);
      assert.equal(b.srv.log().length, 0);
    } finally { await b.srv.stop(); }
  }
});

test('server/DC: /rest/api/2/search with Bearer PAT, startAt paging until total', async () => {
  const s = await setup({ env: PAT, tracker: SERVER, routes: { dc: true, pageSize: 40 } });
  try {
    const r = run(s, ['--ids', jiraIds(keyList(1, 90))]);
    assert.equal(r.status, 0, r.stderr);
    const q = reqs(s);
    assert.deepEqual(q.map((x) => x.json.startAt), [0, 40, 80]);
    assert.equal(q[0].path, '/rest/api/2/search');
    assert.deepEqual(q[0].json, { jql: `key in (${keyList(1, 90).join(',')})`, fields: ['status', 'issuetype', 'resolutiondate'], startAt: 0, maxResults: 100 });
    assert.equal(q[0].headers.authorization, `Bearer ${SENTINEL.PAT}`);
    assert.equal(cases(r).length, 90);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.complete, true);
    assert.equal(doc.receipts[0].group, 'jira:jira.example.com');
  } finally { await s.srv.stop(); }
  // a page that is empty before total is reached stops with complete:false
  const short = await setup({ env: PAT, tracker: SERVER, routes: { dc: true, total: 500 } });
  try {
    const r = run(short, ['--ids', jiraIds(keyList(1, 5))]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).complete, false);
    assert.equal(reqs(short).length, 2);
  } finally { await short.srv.stop(); }
});

test('pagination: 230 keys are three JQL chunks; a short non-final cloud page continues with the token and the same JQL', async () => {
  const s = await setup({ env: CREDS, routes: { pageSize: 60 } });
  try {
    const r = run(s, ['--ids', jiraIds(keyList(1, 230))]);
    assert.equal(r.status, 0, r.stderr);
    const q = reqs(s);
    assert.deepEqual(keysOf(q[0]).length, 100);
    // chunk 1: 100 keys served as 60 + 40
    assert.equal(q[0].json.nextPageToken, undefined);
    assert.equal(q[1].json.nextPageToken, 'tok-60');
    assert.equal(q[1].json.jql, q[0].json.jql);
    const jqls = [...new Set(q.map((x) => x.json.jql))];
    assert.deepEqual(jqls.map((j) => /\(([^)]*)\)/.exec(j)[1].split(',').length), [100, 100, 30]);
    assert.equal(cases(r).length, 230);
    assert.equal(JSON.parse(r.stdout).complete, true);
  } finally { await s.srv.stop(); }
});

test('pagination: a repeated token and --max-pages 1 stop with complete:false', async () => {
  const rep = await setup({ env: CREDS, routes: { pageSize: 2, repeatToken: true } });
  try {
    const r = run(rep, ['--ids', jiraIds(keyList(1, 6))]);
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.complete, false);
    assert.ok(reqs(rep).length <= 3);
  } finally { await rep.srv.stop(); }
  const cap = await setup({ env: CREDS, routes: { pageSize: 2 } });
  try {
    const r = run(cap, ['--ids', jiraIds(keyList(1, 6)), '--max-pages', '1']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(reqs(cap).length, 1);
    assert.equal(JSON.parse(r.stdout).complete, false);
    assert.equal(cases(r).length, 2);
  } finally { await cap.srv.stop(); }
});

test('ids: injection and lowercase are skipped, counted and never sent; leading zeros refused; none valid means no request', async () => {
  const s = await setup({ env: CREDS, routes: {} });
  try {
    const r = run(s, ['--ids', 'jira:PAY-1) OR 1=1,jira:pay-1,jira:PAY-01,jira:PAY-0,gh:5,jira:PAY-2']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /skipped 5 invalid ids/);
    const q = reqs(s);
    assert.equal(q.length, 1);
    assert.equal(q[0].json.jql, 'key in (PAY-2)');
    assert.ok(!q[0].body.includes('OR 1=1'));
    const none = run(s, ['--ids', 'jira:PAY-1) OR 1=1,jira:pay-1']);
    assert.deepEqual(JSON.parse(none.stdout), { schema: 1, complete: true, receipts: [] });
    assert.equal(reqs(s).length, 1);
  } finally { await s.srv.stop(); }
  const l = await setup({ env: CREDS, routes: {}, ids: ['jira:PAY-7', 'jira:bad', 'gh:1'] });
  try {
    const r = run(l);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(cases(r).map((c) => c.id), ['jira:PAY-7']);
  } finally { await l.srv.stop(); }
});

test('unrequested keys are ignored; a requested key left unanswered makes complete:false', async () => {
  const s = await setup({ env: CREDS, routes: { extra: ['PAY-99'], omit: ['PAY-2'] } });
  try {
    const r = run(s, ['--ids', 'jira:PAY-1,jira:PAY-2']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(cases(r).map((c) => c.id), ['jira:PAY-1']);
    assert.equal(JSON.parse(r.stdout).complete, false);
  } finally { await s.srv.stop(); }
});

test('missing credentials: exit 1 naming the variables, nothing requested', async () => {
  const c = await setup({ routes: {}, env: { JIRA_EMAIL: SENTINEL.EMAIL } });
  try {
    const r = run(c, ['--ids', 'jira:PAY-1']);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr.trimEnd(), /^jira: auth \(.*JIRA_EMAIL.*JIRA_API_TOKEN.*\)$/);
    assert.equal(c.srv.log().length, 0);
  } finally { await c.srv.stop(); }
  const d = await setup({ routes: {}, tracker: SERVER, env: CREDS });
  try {
    const r = run(d, ['--ids', 'jira:PAY-1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr.trimEnd(), /^jira: auth \(.*JIRA_PAT.*\)$/);
    assert.equal(d.srv.log().length, 0);
  } finally { await d.srv.stop(); }
});

test('privacy: titles, people, urls, credentials and their base64 never reach stdout or stderr, even on a failure', async () => {
  const s = await setup({ env: { ...CREDS, ...PAT }, routes: {} });
  try {
    const ok = run(s, ['--ids', 'jira:PAY-1']);
    assert.equal(ok.status, 0, ok.stderr);
    assertNoSentinels([ok.stdout, ok.stderr]);
    assert.ok(!ok.stdout.includes('PRIVATE_URL'));
  } finally { await s.srv.stop(); }
  const x = await setup({ env: CREDS });
  const r = spawnSync(process.execPath, [ADAPTER, '--ids', 'jira:PAY-1', '--repo', x.repo, '--base-url', 'http://example.com'], { env: x.env, encoding: 'utf8' });
  outputs.push(r.stdout, r.stderr);
  assert.equal(r.status, 2);
  assert.match(r.stderr.trimEnd(), /^jira: config \(base-url\)$/);
});

test('endpoint: cloud credentials only go to https *.atlassian.net (or a loopback override); server allows any https host', () => {
  assert.deepEqual(endpointOf({ tracker: CLOUD }, undefined), { url: 'https://acme.atlassian.net/rest/api/3/search/jql', host: 'acme.atlassian.net', server: false });
  assert.equal(endpointOf({ tracker: CLOUD }, 'http://127.0.0.1:9').url, 'http://127.0.0.1:9/rest/api/3/search/jql');
  assert.deepEqual(endpointOf({ tracker: SERVER }, undefined), { url: 'https://jira.example.com/jira/rest/api/2/search', host: 'jira.example.com', server: true });
  assert.equal(endpointOf({ tracker: SERVER }, 'http://localhost:9').url, 'http://localhost:9/rest/api/2/search');
  const refuses = (t, o) => assert.throws(() => endpointOf({ tracker: t }, o), (e) => e.cls === 'config' && e.exit === 2);
  refuses({ kind: 'jira' });
  refuses({ url: 'https://evil.example.com' });
  refuses({ url: 'https://acme.atlassian.net.evil.io' });
  refuses({ url: 'https://atlassian.net' });
  refuses({ url: 'http://acme.atlassian.net' });
  refuses({ url: 'https://u:p@acme.atlassian.net' });
  refuses({ url: 'http://jira.example.com', server: true });
  refuses({ url: 'https://u:p@jira.example.com', server: true });
  refuses(CLOUD, 'http://example.com');
});
