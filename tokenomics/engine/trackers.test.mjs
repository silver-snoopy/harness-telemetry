import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESETS, presetRules, parseRemote, detectTrackers } from './trackers.mjs';
import { sandboxEnv } from '../fixtures/trackers/harness.mjs';
import { TA_DEFAULTS } from './config.mjs';
import { mineIds } from '../hooks/telemetry-capture.mjs';

const withRules = (rules, extra = {}) => ({ ...TA_DEFAULTS, ids: { ...TA_DEFAULTS.ids, ...extra, rules } });

test('jira preset: keys only, normalised, no raw duplicates, chains rejected', () => {
  const s = withRules(presetRules('jira', { keys: ['PAY', 'WEB'] }));
  assert.deepEqual(mineIds(s, ['fix PAY-12 and WEB-3, not SHA-256 or ISO-8601']), ['jira:PAY-12', 'jira:WEB-3']);
  assert.deepEqual(mineIds(s, ['PAY-12-34']), []);
  assert.throws(() => presetRules('jira', { keys: ['123'] }), /'123'/);
  assert.throws(() => presetRules('jira', { keys: ['pay'] }), /'pay'/);
  assert.throws(() => presetRules('jira', { keys: [] }), /project keys/);
  assert.throws(() => presetRules('nope'), /unknown tracker 'nope'/);
  assert.throws(() => presetRules('toString'), /unknown tracker/);
  assert.ok(Object.isFrozen(PRESETS));
});

test('github preset with branch rule', () => {
  const s = withRules(presetRules('github', { branchRule: true }));
  assert.deepEqual(mineIds(s, ['Merge pull request #42 from o/feat']), ['gh:42']);
  for (const t of ['abc#42', 'AB#42', '&#42;']) assert.deepEqual(mineIds(s, [t]), [], t);
  assert.deepEqual(mineIds(s, ['x'], { branch: 'feat/57-login' }), ['gh:57']);
  assert.deepEqual(mineIds(s, ['feat/57-login']), [], 'branch text as prompt text is not matched by the branch rule');
  assert.deepEqual(mineIds(s, ['x'], { branch: 'release/2024-10' }), []);
  assert.deepEqual(mineIds(s, ['x'], { branch: 'hotfix/2026-01-x' }), []);
  assert.deepEqual(mineIds(s, ['see GH-9']), ['gh:9']);
  // R15: no #0 or leading-zero ids; a branch rule needs two letters after the dash, so a date-like name mines nothing
  for (const t of ['#0 x', 'see #07']) assert.deepEqual(mineIds(s, [t]), [], t);
  assert.deepEqual(mineIds(s, ['x'], { branch: 'release/2026-q3' }), []);
  assert.deepEqual(mineIds(s, ['x'], { branch: 'feat/57-x' }), []);
  assert.deepEqual(mineIds(s, ['x'], { branch: '57-login' }), ['gh:57']);
  assert.equal(presetRules('github')[0].pattern, '(?<![A-Za-z0-9&])#([1-9]\\d*)\\b');
});

test('ado preset with branch rule', () => {
  const s = withRules(presetRules('ado', { branchRule: true }));
  assert.deepEqual(mineIds(s, ['AB#12345 fix']), ['ado:12345']);
  assert.deepEqual(mineIds(s, ['x'], { branch: 'users/x/23456-fix' }), ['ado:23456']);
  assert.deepEqual(mineIds(s, ['x'], { branch: 'release/2026-q3' }), [], 'R15: a date is not a work item');
  assert.deepEqual(mineIds(s, ['x'], { branch: 'users/x/2345-v2' }), []);
});

test('inertness: rules absent and rules:[] give identical output; max caps the union', () => {
  const none = { ...TA_DEFAULTS };
  const empty = withRules([]);
  const table = ['', 'TC-101', 'SHA-256 ISO-8601', 'RUN-2026-08-17-001', 'a TC-1 b TC-2 c', '#42', 'AB#9 SCRUM-T101',
    'feat/57-login', 'ELITEA-2083 on branch tests/batch-chat-2083', 'PAY-1 PAY-2 PAY-3 PAY-4', 'gh:42', 'x'.repeat(50),
    'TC-9 TC-8 TC-7 TC-6 TC-5 TC-4 TC-3 TC-2 TC-1 TC-0 TC-11 TC-12', 'ABC-123, DEF-456', 'v2-3', 'A-1', 'foo\nBAR-7\nbaz', 'MIX-1 #2', 'ID-5-6', 'ok'];
  assert.equal(table.length, 20);
  for (const t of table) assert.deepEqual(mineIds(empty, [t]), mineIds(none, [t]), t);
  const capped = withRules(presetRules('jira', { keys: ['PAY'] }), { max: 2 });
  assert.deepEqual(mineIds(capped, ['PAY-1 PAY-2 PAY-3']), ['jira:PAY-1', 'jira:PAY-2']);
});

test('pass-through of already-normalised ids; mixed rules; multi-digit group', () => {
  const s = withRules([...presetRules('jira', { keys: ['PAY'] }), ...presetRules('github')]);
  assert.deepEqual(mineIds(s, ['gh:42', 'jira:PAY-12']), ['gh:42', 'jira:PAY-12']);
  assert.deepEqual(mineIds(s, ['PAY-1 (#7)']), ['gh:7', 'jira:PAY-1']);
  // a legacy id beside a rule match in the same text survives; only the overlapping legacy match is dropped
  assert.deepEqual(mineIds(s, ['PAY-1 and TC-9']), ['TC-9', 'jira:PAY-1']);
  const t = withRules([{ pattern: '(a)(b)?', normalize: 'x:$1$2' }]);
  assert.deepEqual(mineIds(t, ['a']), ['x:a']);
  const u = withRules([{ pattern: '(a)(b)', normalize: 'x:$2' }, { pattern: 'c(d)?', normalize: 'y:$1' }]);
  assert.deepEqual(mineIds(u, ['cc']), [], 'an empty group yields no id');
});

// ---- detection (Task 2) ----
const sandbox = mkdtempSync(join(tmpdir(), 'ht-trk-'));
after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
let n = 0;
// A repo with `msgs` as commit subjects (after one 'init'), optional origin and extra branches. Document count =
// commits + deduplicated branch names: 1 + msgs.length commits, plus 'main' and each branch.
function repoWith({ msgs = [], origin = null, branches = [] } = {}) {
  const tmp = join(sandbox, `r${n++}`);
  mkdirSync(join(tmp, 'home'), { recursive: true });
  writeFileSync(join(tmp, 'gitconfig'), '[init]\n\tdefaultBranch = main\n[user]\n\tname = T\n\temail = t@example.invalid\n');
  const env = sandboxEnv(tmp, {});
  const repo = join(tmp, 'p');
  mkdirSync(repo);
  const g = (...a) => { const r = spawnSync('git', a, { cwd: repo, env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  g('init', '-q');
  g('commit', '-q', '--allow-empty', '-m', 'init');
  for (const m of msgs) g('commit', '-q', '--allow-empty', '-m', m);
  for (const b of branches) g('branch', b);
  if (origin) g('remote', 'add', 'origin', origin);
  return { repo, env };
}
const rep = (m, k) => Array.from({ length: k }, () => m);

test('parseRemote: github and ado in every url form; look-alikes give no host', () => {
  for (const u of ['https://github.com/o/r.git', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r']) {
    assert.deepEqual(parseRemote(u), { host: 'github', owner: 'o', repo: 'r' }, u);
  }
  const ado = { host: 'ado', org: 'acme', project: 'proj', repo: 'app' };
  assert.deepEqual(parseRemote('https://dev.azure.com/acme/proj/_git/app'), { ...ado, orgUrl: 'https://dev.azure.com/acme' });
  assert.deepEqual(parseRemote('https://acme@dev.azure.com/acme/proj/_git/app'), { ...ado, orgUrl: 'https://dev.azure.com/acme' });
  assert.deepEqual(parseRemote('git@ssh.dev.azure.com:v3/acme/proj/app'), { ...ado, orgUrl: 'https://dev.azure.com/acme' });
  assert.deepEqual(parseRemote('https://acme.visualstudio.com/proj/_git/app'), { ...ado, orgUrl: 'https://acme.visualstudio.com' });
  assert.deepEqual(parseRemote('acme@vs-ssh.visualstudio.com:v3/acme/proj/app'), { ...ado, orgUrl: 'https://acme.visualstudio.com' });
  for (const u of ['https://github.com.evil.io/o/r', 'https://evil.io/github.com/o/r', 'git@notgithub.com:o/r', '', null, 'garbage']) {
    assert.deepEqual(parseRemote(u), { host: null }, String(u));
  }
});

test('detect jira: stoplisted and rare prefixes are dropped; keys by frequency', () => {
  const { repo, env } = repoWith({ msgs: [...rep('PAY-1 pay thing', 8), ...rep('WEB-2 web thing', 6), ...rep('bump SHA-256', 6), ...rep('UTF-8 fix', 6), 'RUN-2026 notes'] });
  const d = detectTrackers(repo, { env });
  assert.equal(d.host, null);
  assert.equal(d.trackers.length, 1);
  assert.equal(d.trackers[0].tracker, 'jira');
  assert.deepEqual(d.trackers[0].keys, ['PAY', 'WEB']);
  assert.match(d.trackers[0].why, /14 of \d+/);
  assert.equal(d.receipts, 'jira');
});

test('detect jira thresholds: 4 documents no; 5 of 60 (8%) no; 6 of 60 (10%) yes; one commit counts once', () => {
  const jira = (r) => detectTrackers(r.repo, { env: r.env }).trackers.find((t) => t.tracker === 'jira');
  assert.equal(jira(repoWith({ msgs: rep('PAY-1 x', 4) })), undefined, '4 documents');
  // total documents = (1 init + msgs) commits + the 'main' branch = 60
  assert.equal(jira(repoWith({ msgs: [...rep('PAY-1 x', 5), ...rep('filler', 53)] })), undefined, '5 of 60');
  assert.deepEqual(jira(repoWith({ msgs: [...rep('PAY-1 x', 6), ...rep('filler', 52)] })).keys, ['PAY'], '6 of 60');
  assert.equal(jira(repoWith({ msgs: [...rep('PAY-1 PAY-2 PAY-3 in one', 4), 'x'] })), undefined, 'one commit, one count');
});

test('detect jira counts branch names, deduplicated across local and origin copies', () => {
  const { repo, env } = repoWith({ msgs: ['a', 'b', 'c', 'd'], branches: ['PAY-9-x'] });
  assert.equal(detectTrackers(repo, { env }).trackers.length, 0, 'one branch document is below 5');
});

test('detect ado: ado origin plus AB# commits names both; AB# on a github origin is not a #N count', () => {
  const a = repoWith({ origin: 'https://dev.azure.com/acme/proj/_git/app', msgs: rep('AB#1 fix', 3) });
  const d = detectTrackers(a.repo, { env: a.env });
  assert.equal(d.host, 'ado');
  assert.deepEqual(d.trackers.map((t) => t.tracker), ['ado']);
  assert.match(d.trackers[0].why, /Azure DevOps remote/);
  assert.match(d.trackers[0].why, /AB# in 3 of \d+/);
  // R15: beside another tracker, a github host alone adds no #N rules; AB# is not a #N document
  const g = repoWith({ origin: 'https://github.com/o/r.git', msgs: rep('AB#1 fix', 3) });
  const e = detectTrackers(g.repo, { env: g.env });
  assert.deepEqual(e.trackers.map((t) => t.tracker), ['ado']);
  assert.equal(e.receipts, 'ado');
});

test('detect jira and github: github host plus Jira keys; receipts from jira', () => {
  const { repo, env } = repoWith({ origin: 'git@github.com:o/r.git', msgs: [...rep('PAY-1 thing (#7)', 6), 'x'] });
  const d = detectTrackers(repo, { env });
  assert.deepEqual(d.trackers.map((t) => t.tracker), ['jira', 'github']);
  assert.match(d.trackers[1].why, /github\.com remote.*#N in 6 of \d+/);
  assert.equal(d.receipts, 'jira');
  // R15: beside Jira, github needs #N in at least 3 documents, not the host alone
  const two = repoWith({ origin: 'git@github.com:o/r.git', msgs: [...rep('PAY-1 thing', 5), 'fix #7', 'fix #8', 'x'] });
  assert.deepEqual(detectTrackers(two.repo, { env: two.env }).trackers.map((t) => t.tracker), ['jira']);
  const three = repoWith({ origin: 'git@github.com:o/r.git', msgs: [...rep('PAY-1 thing', 5), 'fix #7', 'fix #8', 'fix #9', 'x'] });
  assert.deepEqual(detectTrackers(three.repo, { env: three.env }).trackers.map((t) => t.tracker), ['jira', 'github']);
});

test('detect: no history, no remote gives nothing; a bare github remote gives github; an unrelated remote gives nothing', () => {
  const none = repoWith();
  assert.deepEqual(detectTrackers(none.repo, { env: none.env }), { trackers: [], host: null, receipts: null });
  const gh = repoWith({ origin: 'https://github.com/o/r' });
  assert.deepEqual(detectTrackers(gh.repo, { env: gh.env }).trackers.map((t) => t.tracker), ['github']);
  const other = repoWith({ origin: 'https://git.example.invalid/o/r' });
  assert.deepEqual(detectTrackers(other.repo, { env: other.env }).trackers, []);
  const empty = join(sandbox, 'emptyrepo');
  mkdirSync(empty);
  spawnSync('git', ['init', '-q'], { cwd: empty, env: none.env });
  assert.deepEqual(detectTrackers(empty, { env: none.env }), { trackers: [], host: null, receipts: null });
});
