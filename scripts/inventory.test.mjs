import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, checkAssignments, scanReference, scanEngine, checkEngineAllowlist } from './inventory.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refDir } from './vendor-reference.mjs';

const planted = [
  "const dir = join(repo, '.agents', 'telemetry', 'automation');",
  "intent: intent ?? prev.intent ?? 'automation',",
  "const DELIVERED = ['delivered', 'defect-found'];",
  "export function extractCaseIds(...texts) {",
  "const p = join(dir, 'report.json');",
  "const g = foldGateRuns(repo, slug);",
  "if (/triage|reviewer/.test(label)) return 'triage';",
  "const v = join(repo, '.agents/estimation', slug);",
  "out.push(`delivered (automated): ${n}`);",
  "row.scenarios_automated = n;",
  "if (env.TOKENOMICS_NO_SYNC === '1') return;",
].join('\n');

test('every category fires on its planted line', () => {
  const cats = new Set(scanSource('x.mjs', planted).map((s) => s.category));
  for (const c of ['path-automation', 'intent-default', 'delivered-vocab', 'case-id-miner', 'receipt-reader', 'gate-records', 'stage-words', 'sizing', 'qa-wording', 'export-qa', 'env-var']) {
    assert.ok(cats.has(c), `category ${c} did not fire`);
  }
});

test('ids are line-independent and stable', () => {
  const a = scanSource('x.mjs', planted);
  const b = scanSource('x.mjs', `// shifted\n\n${planted}`);
  assert.deepEqual(a.map((s) => s.id).sort(), b.map((s) => s.id).sort());
  assert.notDeepEqual(a.map((s) => s.line), b.map((s) => s.line));
});

test('comments are not sites', () => {
  assert.equal(scanSource('x.mjs', "// see report.json and 'automation' here").length, 0);
});

test('assignment gate reports unassigned, stale and invalid', () => {
  const sites = scanSource('x.mjs', planted);
  const assignments = Object.fromEntries(sites.slice(1).map((s) => [s.id, { owner: 'engine-config', target: 'k' }]));
  assignments['x.mjs:path-automation:deadbeef00'] = { owner: 'engine-config', target: 'k' };
  assignments[sites[1].id] = { owner: 'nobody', target: '' };
  const r = checkAssignments(sites, assignments);
  assert.equal(r.unassigned.length, 1);
  assert.deepEqual(r.stale, ['x.mjs:path-automation:deadbeef00']);
  assert.equal(r.invalid.length, 1);
});

test('the real reference yields a non-trivial inventory', () => {
  const sites = scanReference(refDir('49577c7'));
  assert.ok(sites.length >= 60, `only ${sites.length} sites`);
  assert.ok(sites.every((s) => !s.file.endsWith('.test.mjs')));
});

test('previously-missed reference patterns are sites', () => {
  // real lines from reference/49577c7 the first scanner let through
  const missed = [
    ['const OVERHEAD_STAGE = /\\btriage\\b|hardening gate|mini-gate|gate for batch|^gate[:\\s]|report writer|write the report|^report[:\\s]|diagnostician|stabiliz\\w+ (?:diagnos|round)/i;', 'stage-words'],
    ['const FIX_STAGE = /^fix[:\\s]|fix round/i;', 'stage-words'],
    ['const STAGE_KIND = [', 'stage-words'],
    ["  ['gate', /hardening gate|mini-gate|gate for batch|^gate[:\\s]/i],", 'stage-words'],
    ["  ['report', /report writer|write the report|^report[:\\s]/i],", 'stage-words'],
    ["const stageKindOf = (label) => (STAGE_KIND.find(([, re]) => re.test(stageHead(label)))?.[0] ?? 'other');", 'stage-words'],
    ["const stageHead = (label) => String(label || '').slice(0, STAGE_HEAD);", 'stage-words'],
    ['export function classify(label, ids, declared = []) {', 'stage-words'],
    ['const isFix = FIX_STAGE.test(stageHead(s.label));', 'stage-words'],
    ['const m = STAGE_MARKER.exec(t);', 'stage-words'],
    ['export function loadSizings(repo) {', 'sizing'],
    ["const dir = join(repo, '.agents', 'estimation');", 'sizing'],
    ['export function loadGateRuns(dir, { repo = null, slug = null } = {}) {', 'gate-records'],
    ['const receiptVerdict = receipt.gate?.verdict ?? null;', 'gate-records'],
    ['return { gateDrift, outcomeDrift };', 'gate-records'],
    ['export function declaredOutcomesFor(receipt, slug, scopes) {', 'gate-records'],
    ['const ids = Array.isArray(res.unit_ids) ? res.unit_ids', 'receipt-reader'],
    [': Array.isArray(res.cases) ? res.cases.map((c) => c?.case_id).filter(Boolean)', 'receipt-reader'],
    ['export function receiptPathFor(repo, batch) {', 'receipt-reader'],
    ['findings: Array.isArray(c.findings) ? c.findings.length : 0,', 'receipt-reader'],
    ['.filter((c) => c.batch === scope.batch || c.batch.endsWith(`/${scope.batch}`));', 'receipt-reader'],
  ];
  for (const [line, category] of missed) {
    const cats = scanSource('x.mjs', line).map((s) => s.category);
    assert.ok(cats.includes(category), `${category} did not fire on: ${line}`);
  }
});

test('review-round reference patterns are sites; group wording skips properties, flags and names', () => {
  const missed = [
    ['gate: receipt.gate ?? null,', 'gate-records'],
    ["out.push('## Cases (from the pipeline\\'s own receipts)', '');", 'qa-wording'],
    ['<table><tr><th>size</th><th>cases</th><th>ΣSP</th><th>est min</th></tr>', 'qa-wording'],
    ['<p class="panel-sub">Batch overhead is NOT in these bars. Clustered cases are an even split.</p>', 'qa-wording'],
    ['${rep.perCase?.length ? `<section class="panel"><h2>Per case — cost.json rows across batches (delivered first)</h2>', 'qa-wording'],
    ["? { costUsd: 1, note: 'whole batch incl. overhead ÷ delivered (delivered/defect-found; legacy automated/merged-sanctioned-red)' } : null,", 'delivered-vocab'],
    ["const notStarted = num(cost.outcomes?.['not-started']) + num(cost.outcomes?.['infra-stalled']);", 'delivered-vocab'],
    ["out.push('| batch | cases | delivered | total |', '|---|---|---|---|');", 'group-wording'],
    ["out.push('## Per case — every batch\\'s cost.json rows (delivered first)', '');", 'group-wording'],
    ["return `scope: ${scope.intent}${scope.batch ? ` / batch ${scope.batch}` : ''}`;", 'group-wording'],
    ["note: 'batch-level work (lead thread, triage, gate, report) — shown once',", 'group-wording'],
    ['<table><tr><th>batch</th><th>cases</th></tr>', 'group-wording'],
    ['const rework = emptyBucket();', 'stage-words'],
    ["rework: { note: 'fix-round dispatches' },", 'stage-words'],
    ['const MIN_CLASS_N = 5;', 'sizing'],
    ["if (entry.name === 'telemetry' || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;", 'receipt-reader'],
  ];
  for (const [line, category] of missed) {
    const cats = scanSource('x.mjs', line).map((s) => s.category);
    assert.ok(cats.includes(category), `${category} did not fire on: ${line}`);
  }
  const notGroup = [
    'const cost = updateBatchCosts(repo, { batch: scope.batch });',
    "const { updateBatchCosts } = await import('../scripts/batch-cost.mjs');",
    "const i = argv.indexOf('--batch');",
    "if (flags.get('batch')) {",
    "writeFileSync(join(dir, 'batch-report.html'), html);",
    'const p = `${scope.batch}/x`;',
  ];
  for (const line of notGroup) {
    assert.ok(!scanSource('x.mjs', line).some((s) => s.category === 'group-wording'), `group-wording fired on: ${line}`);
  }
});

test('scanSource counts identical lines instead of hiding them', () => {
  const s = scanSource('x.mjs', "const a = 'automation';\nconst a = 'automation';\n");
  assert.equal(s.length, 1);
  assert.equal(s[0].count, 2);
});

test('scanEngine walks nested engine dirs and skips extensions/ and kit/', () => {
  const root = mkdtempSync(join(tmpdir(), 'ht-inv-'));
  const lit = "export const d = 'automation';\n";
  for (const rel of ['engine/sub/x.mjs', 'hooks/h.mjs', 'extensions/t.mjs', 'kit/k.mjs', 'engine/x.test.mjs']) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), lit);
  }
  const files = [...new Set(scanEngine(root).map((s) => s.file))].sort();
  assert.deepEqual(files, ['engine/sub/x.mjs', 'hooks/h.mjs']);
});

test('checkEngineAllowlist: a second copy of an allowlisted line is an overcount', () => {
  const [site] = scanSource('hooks/h.mjs', "const a = 'automation';\nconst a = 'automation';\n");
  const reason = 'r'.repeat(40);
  assert.deepEqual(checkEngineAllowlist([site], { [site.id]: { kind: 'residue', reason } }).overcount, [{ id: site.id, count: 2, allowed: 1 }]);
  assert.deepEqual(checkEngineAllowlist([site], { [site.id]: { kind: 'residue', reason, count: 2 } }).overcount, []);
  assert.deepEqual(checkEngineAllowlist([site], { [site.id]: { kind: 'residue', reason, count: 3 } }).undercount, [{ id: site.id, count: 2, allowed: 3 }]);
});
