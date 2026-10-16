import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTelemetry } from './load.mjs';

function tree(files) {
  const d = mkdtempSync(join(tmpdir(), 'ht-load-'));
  for (const [rel, c] of Object.entries(files)) { mkdirSync(join(d, rel, '..'), { recursive: true }); writeFileSync(join(d, rel), c); }
  return d;
}

test('automation/ without module.json gets the implied manifest', () => {
  const d = tree({ 'automation/usage-a.jsonl': '{"v":1,"host":"claude","id":"x"}\n' });
  const { modules } = loadTelemetry(d);
  assert.equal(modules.length, 1);
  assert.equal(modules[0].implied, true);
  assert.equal(modules[0].manifest.domain, 'test-automation');
  assert.equal(modules[0].ledgers[0].lines[0].line.id, 'x');
});

test('flat-era root and usage.jsonl are read; a bad JSON line is kept as raw', () => {
  const d = tree({ 'usage.jsonl': '{"v":1,"host":"claude","id":"y"}\nnot json\n', 'config.json': '{}' });
  const { modules } = loadTelemetry(d);
  const lines = modules.flatMap((m) => m.ledgers.flatMap((l) => l.lines));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].line, null);
  assert.equal(lines[1].raw, 'not json');
});

test('module dirs declare themselves with module.json', () => {
  const d = tree({ 'stories/module.json': '{"module":"tokenomics","schema_version":"1.0","domain":"x","manifestRevision":1}', 'stories/usage-u.jsonl': '' });
  assert.equal(loadTelemetry(d).modules[0].name, 'stories');
  assert.equal(loadTelemetry(d).modules[0].implied, false);
});

test('a directory with usage ledgers but no module.json and not automation is reported as unrecognized', () => {
  const d = tree({ 'mystery/usage-z.jsonl': '{"v":1,"host":"claude","id":"z"}\n', 'mystery/usage-a.jsonl': '', 'stories/module.json': '{"module":"tokenomics"}', 'stories/usage-u.jsonl': '' });
  const r = loadTelemetry(d);
  assert.equal(r.modules.length, 1);
  assert.equal(r.modules[0].name, 'stories');
  assert.equal(r.unrecognized.length, 1);
  assert.equal(r.unrecognized[0].dir, join(d, 'mystery'));
  assert.deepEqual(r.unrecognized[0].ledgers, ['usage-a.jsonl', 'usage-z.jsonl']);
});

test('scopes path is a file → a scopesBlocked module and a scopes-not-directory finding, no throw (owner Q2, R10)', async () => {
  const d = tree({ 'automation/usage-a.jsonl': '{"v":1,"host":"claude","id":"x"}\n', 'automation/scopes': 'not a directory' });
  const { modules } = loadTelemetry(d);
  assert.equal(modules[0].scopesBlocked, true);
  assert.deepEqual(modules[0].scopes, []);
  assert.equal(modules[0].ledgers[0].lines[0].line.id, 'x', 'ledgers still read');
  const { check } = await import('./check.mjs');
  const f = check(d, { mode: 'reference' }).findings.filter((x) => x.rule === 'scopes-not-directory');
  assert.equal(f.length, 1);
  assert.equal(f[0].class, 'error');
  assert.match(f[0].file, /scopes$/);
});
