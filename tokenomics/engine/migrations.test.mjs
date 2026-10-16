import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, enabledMigrations, migrationOn } from './migrations.mjs';

// Landing order (map §4) is the composition order: declarersOf follows MIGRATIONS. A grouped entry's item is its
// lowest item number (entry-points 12-13, capture-robustness 14-17 and 21, report-robustness 18-20; owner Q1b).
const ORDER = [
  ['exact-ids', 1], ['anon-complete', 5], ['fold-flags', 6], ['null-unobservable', 4],
  ['copilot-inclusive', 3], ['shared-allocation', 2], ['active-minutes', 7], ['report-windows', 8],
  ['scope-resolution', 9], ['reports-location', 10], ['writer', 11],
  ['report-conflicts', 22], ['role-dollars', 23], ['report-revision', 24],
  ['entry-points', 12], ['capture-robustness', 14], ['report-robustness', 18],
];

test('the seventeen B2 migrations, in landing order, landing as a prefix', () => {
  assert.deepEqual(MIGRATIONS.map((m) => m.id), ORDER.map(([id]) => id));
  assert.deepEqual(MIGRATIONS.map((m) => m.item), ORDER.map(([, item]) => item));
  // Migrations land in order: the landed ones are a prefix of the registry (Plan 4 lands one per task).
  const firstUnlanded = MIGRATIONS.findIndex((m) => !m.landed);
  assert.ok(firstUnlanded === -1 || MIGRATIONS.slice(firstUnlanded).every((m) => !m.landed));
  assert.equal(MIGRATIONS[0].landed, true, 'exact-ids has landed');
});
test('default = landed set; none = empty', () => {
  const landed = MIGRATIONS.filter((m) => m.landed).map((m) => m.id);
  assert.deepEqual([...enabledMigrations({})], landed);
  assert.deepEqual([...enabledMigrations({ TOKENOMICS_MIGRATIONS: '' })], landed);
  assert.deepEqual([...enabledMigrations({ TOKENOMICS_MIGRATIONS: 'none' })], []);
  assert.equal(migrationOn('writer', { TOKENOMICS_MIGRATIONS: 'none' }), false);
});
test('unknown or unlanded ids throw', () => {
  assert.throws(() => enabledMigrations({ TOKENOMICS_MIGRATIONS: 'nope' }), /unknown migration 'nope'/);
  const unlanded = MIGRATIONS.find((m) => !m.landed);
  if (unlanded) assert.throws(() => enabledMigrations({ TOKENOMICS_MIGRATIONS: unlanded.id }), new RegExp(`migration '${unlanded.id}' has not landed`));
});
