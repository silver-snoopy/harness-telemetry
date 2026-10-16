// The B2 migration registry (spec 14.8, 18.2): one corpus/migrations/<id>/migration.json per MIGRATIONS id,
// valid against the corpus, each naming the existing cases that show its before-behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, registryProblems } from '../scripts/migrations.mjs';
import { MIGRATIONS } from '../tokenomics/engine/migrations.mjs';

const REGISTRY = fileURLToPath(new URL('./migrations', import.meta.url));
const CASES = fileURLToPath(new URL('./cases', import.meta.url));

test('the registry matches MIGRATIONS and the corpus, interaction declarations included', () => {
  const { entries, interactions, problems } = loadRegistry(REGISTRY);
  assert.deepEqual(problems, []);
  assert.deepEqual(registryProblems(entries, MIGRATIONS, CASES, interactions), []);
});

test('_interactions holds the format README and is never read as a migration entry', () => {
  assert.ok(existsSync(join(REGISTRY, '_interactions', 'README.md')));
  const { entries, interactions } = loadRegistry(REGISTRY);
  assert.ok(!entries.has('_interactions'));
  // Every interaction names only landed migrations; nothing has landed yet, so none may exist.
  if (!MIGRATIONS.some((m) => m.landed)) assert.equal(interactions.size, 0);
});

test('every registry entry names at least one before-case', () => {
  const { entries } = loadRegistry(REGISTRY);
  assert.equal(entries.size, MIGRATIONS.length);
  for (const [id, e] of entries) assert.ok(e.beforeCases.length > 0, `${id}: no beforeCases`);
});

// Owner Q1: items 22-24 land alone; 12-21 land as three groups (amending spec 14.8 "each lands alone").
const GROUPS = {
  'entry-points': { items: [12, 13], beforeCases: ['before-entry-symlink'] },
  'capture-robustness': { items: [14, 15, 16, 17, 21], beforeCases: ['cov-capture-vscode-edges', 'cov-capture-dispatch-edges', 'cov-copilot-dispatch'] },
  'report-robustness': { items: [18, 19, 20], beforeCases: ['fault-batch-cost-empty-repo', 'cov-team-report-batches', 'cov-export-submission-edges'] },
};
const SINGLES = {
  'report-conflicts': ['cov-team-report-rollup'],
  'role-dollars': ['cov-dispatch-batch'],
  'report-revision': ['cov-team-report-rollup', 'cov-dispatch-batch'],
};

test('every MIGRATIONS id has a registry entry; the groups carry their items and real before-cases', () => {
  const { entries } = loadRegistry(REGISTRY);
  for (const m of MIGRATIONS) assert.ok(entries.has(m.id), `${m.id}: no registry entry`);
  for (const [id, g] of Object.entries(GROUPS)) {
    const e = entries.get(id);
    assert.deepEqual(e.items, g.items, `${id}: items`);
    assert.equal(e.item, Math.min(...g.items), `${id}: item is the group's lowest`);
    assert.deepEqual(e.beforeCases, g.beforeCases, `${id}: beforeCases`);
    assert.equal(e.beforeCasesWaived, undefined, `${id}: P3P-06, no waiver`);
  }
  for (const [id, before] of Object.entries(SINGLES)) {
    assert.equal(entries.get(id).items, undefined, `${id}: lands alone`);
    assert.deepEqual(entries.get(id).beforeCases, before, `${id}: beforeCases`);
  }
});

// The B2 migration map (docs/b2/MIGRATION-MAP.md) names before-cases in §2 "Before-cases" fields and in the
// §3 defect table. Plan 3 Task 10 built every case the map marked `NEW:`; none may remain, every named case
// must exist, and every before-* case must be wired into a registry entry or the defect table.
const MAP = fileURLToPath(new URL('../docs/b2/MIGRATION-MAP.md', import.meta.url));
const CASE_NAME = /`((?:seed|cov|fault|foreign|real|before)-[a-z0-9-]+)`/g;

/** { beforeFields: string[], defectCells: string[] } — the map text that names before-cases. */
function mapBeforeCaseText(md) {
  const s2 = md.slice(md.indexOf('\n## 2.'), md.indexOf('\n## 3.'));
  const s3 = md.slice(md.indexOf('\n## 3.'), md.indexOf('\n## 4.'));
  // A "Before-cases" field runs from its bold label to the next bold label at a line start.
  const beforeFields = [...s2.matchAll(/\*\*Before-cases:\*\*([\s\S]*?)(?=\n\*\*)/g)].map((m) => m[1]);
  // §3 rows: | # | finding | citation | before-case | owner |
  const defectCells = s3.split('\n').filter((l) => /^\| R\d+ \|/.test(l)).map((l) => l.split(' | ')[3]);
  return { beforeFields, defectCells };
}
const namesIn = (texts) => [...new Set(texts.flatMap((t) => [...t.matchAll(CASE_NAME)].map((m) => m[1])))];

test('mapBeforeCaseText: reads the Before-cases fields of §2 and the before-case column of §3', () => {
  const md = '# x\n\n## 2. Per\n\n**Spec:** `seed-a`\n\n**Before-cases:** `seed-b`; `before-c`\nmore `cov-d`.\n\n**Declared diff shape:** `seed-e`\n\n'
    + '## 3. Defects\n\n| # | finding | citation | before-case | owner |\n|---|---|---|---|---|\n| R1 | f `seed-x` | c | `fault-y` | o |\n\n## 4. Order\n';
  const { beforeFields, defectCells } = mapBeforeCaseText(md);
  assert.deepEqual(namesIn(beforeFields), ['seed-b', 'before-c', 'cov-d']);
  assert.deepEqual(namesIn(defectCells), ['fault-y']);
});

test('the migration map names only existing before-cases and no NEW: marker remains', () => {
  const md = readFileSync(MAP, 'utf8');
  const { beforeFields, defectCells } = mapBeforeCaseText(md);
  // §2 specifies the eleven spec 14.8 items; items 12-24 are specified by their §3 rows (R8, R11-R22).
  assert.equal(beforeFields.length, MIGRATIONS.filter((m) => m.item <= 11).length, 'one Before-cases field per spec item');
  assert.ok(defectCells.length >= 20, `§3 rows parsed: ${defectCells.length}`);
  for (const t of [...beforeFields, ...defectCells]) assert.doesNotMatch(t, /NEW:/);
  const named = namesIn([...beforeFields, ...defectCells]);
  for (const c of named) assert.ok(existsSync(join(CASES, c, 'replay.json')), `the map names missing case ${c}`);
});

test('every before-case of items 12-24 is named in the map\'s §3 defect table', () => {
  const { entries } = loadRegistry(REGISTRY);
  const inDefects = new Set(namesIn(mapBeforeCaseText(readFileSync(MAP, 'utf8')).defectCells));
  for (const m of MIGRATIONS.filter((x) => x.item > 11)) for (const c of entries.get(m.id).beforeCases) assert.ok(inDefects.has(c), `${m.id}: ${c} not in the §3 table`);
});

test('every before-* case is in a registry entry\'s beforeCases or in the map\'s defect table', () => {
  const { entries } = loadRegistry(REGISTRY);
  const registered = new Set([...entries.values()].flatMap((e) => e.beforeCases));
  const inDefects = new Set(namesIn(mapBeforeCaseText(readFileSync(MAP, 'utf8')).defectCells));
  const before = readdirSync(CASES).filter((d) => d.startsWith('before-'));
  assert.ok(before.length >= 9, `before-* cases: ${before}`);
  for (const c of before) assert.ok(registered.has(c) || inDefects.has(c), `${c}: in no beforeCases and not in the §3 table`);
});
