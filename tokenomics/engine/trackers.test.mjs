import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, presetRules } from './trackers.mjs';
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
});

test('ado preset with branch rule', () => {
  const s = withRules(presetRules('ado', { branchRule: true }));
  assert.deepEqual(mineIds(s, ['AB#12345 fix']), ['ado:12345']);
  assert.deepEqual(mineIds(s, ['x'], { branch: 'users/x/23456-fix' }), ['ado:23456']);
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
  const t = withRules([{ pattern: '(a)(b)?', normalize: 'x:$1$2' }]);
  assert.deepEqual(mineIds(t, ['a']), ['x:a']);
  const u = withRules([{ pattern: '(a)(b)', normalize: 'x:$2' }, { pattern: 'c(d)?', normalize: 'y:$1' }]);
  assert.deepEqual(mineIds(u, ['cc']), [], 'an empty group yields no id');
});
