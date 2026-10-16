// Non-default settings through lifted sites (Task 9 fix round 1): the corpus only ever
// replays TA_DEFAULTS, so these direct calls are what proves the lifts actually read settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { TA_DEFAULTS, telemetryDir } from './config.mjs';
import { enabledMigrations } from './migrations.mjs';
import { mineIds, extractCaseIds } from '../hooks/telemetry-capture.mjs';
import { buildBatchCost } from '../scripts/batch-cost.mjs';
import { renderBatchMarkdown, renderBatchHtml } from '../scripts/team-report.mjs';

const foreign = {
  ...TA_DEFAULTS,
  dir: 'stories',
  vocabulary: { ...TA_DEFAULTS.vocabulary, item: 'story', group: 'sprint' },
  ids: { patterns: ['\\b[A-Z]+-\\d+\\b', '#\\d+\\b'], flags: '', max: 50, stoplist: ['ISO'] },
};
// TA wording that must not survive a foreign vocabulary; artifact file names are identifiers, not wording.
const taWording = (text) => text.replace(/batch-(tokenomics|report|cost)/g, '').match(/\b(cases?|batch(es)?)\b/gi);

test('batch renderers speak the configured vocabulary', () => {
  const c = buildBatchCost('sprint-7', { cases: [{ id: 'ST-1', outcome: 'delivered' }, { id: 'ST-2', outcome: 'blocked' }] }, [], { settings: foreign });
  assert.match(c.stats.note, /per-story measured/);
  const md = renderBatchMarkdown(c, foreign);
  assert.match(md, /^# Sprint cost — sprint-7/);
  assert.match(md, /- Stories: 2/);
  // active-minutes (B2 item 7) replaces the per-item minute breakdown with its session-grain label, same vocabulary
  assert.match(md, enabledMigrations().has('active-minutes') ? /\(session grain — not split per story, stage or dispatch\)/ : /\(stories 0m/);
  assert.match(md, /\| story \| outcome \|/);
  assert.equal(taWording(md), null, md);
  const html = renderBatchHtml(c, foreign);
  assert.match(html, /<h1>Sprint cost — sprint-7<\/h1>/);
  assert.match(html, /Delivered \/ stories/);
  assert.equal(taWording(html), null);
  // the TA default still renders the reference words
  assert.match(renderBatchMarkdown(buildBatchCost('b', { cases: [{ id: 'X-1' }] }, [])), /^# Batch cost — b[\s\S]*- Cases: 1/);
});

test('mineIds runs every configured pattern with the stoplist and the cap', () => {
  const text = 'ISO-9001 FOO-1 #12 BAR-2 BAZ-3';
  assert.deepEqual(mineIds(foreign, [text]), ['#12', 'BAR-2', 'BAZ-3', 'FOO-1']);
  assert.deepEqual(mineIds({ ...foreign, ids: { ...foreign.ids, max: 3 } }, [text]), ['BAR-2', 'BAZ-3', 'FOO-1']);
  assert.deepEqual(extractCaseIds(text), ['BAR-2', 'BAZ-3', 'FOO-1'], 'TA miner: stoplist ISO, no #-ids');
});

test('telemetryDir follows settings.dir', () => {
  assert.equal(telemetryDir('/r', foreign), join('/r', '.agents', 'telemetry', 'stories'));
  assert.equal(telemetryDir('/r', TA_DEFAULTS), join('/r', '.agents', 'telemetry', 'automation'));
});
