import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as ta from '../extensions/test-automation.mjs';
import { TA_DEFAULTS } from '../engine/config.mjs';
import { anonymizeDoc, scrubSet, scrubStrings, writeSubmission, exportPath, appendRun } from './build-tokenomics-export.mjs';

// B2 anon-complete: every test here sets the migration through `under`.
const under = (mig, fn) => {
  const was = process.env.TOKENOMICS_MIGRATIONS;
  process.env.TOKENOMICS_MIGRATIONS = mig;
  try { return fn(); } finally { if (was === undefined) delete process.env.TOKENOMICS_MIGRATIONS; else process.env.TOKENOMICS_MIGRATIONS = was; }
};
const ON = 'anon-complete';
const row = (slug, ref, extra = {}) => ({
  work_item_ref: ref, work_item_brief: `Brief for ${slug}`, tokens: { input: 1, output: 1, cache_read: 1, cache_create: 1 },
  primary_model: 'claude-b1x', models_used: ['claude-b1x'], cost_api_equivalent_usd: 1, cache_read_share_pct: 5, size_tshirt: 'S',
  notes: `Telemetry cohort: reconstructed from .agents/automation/${slug}/cost.json (v1); batch slug '${slug}'.`, ...extra,
});
const segment = { factory_id: 'fx', factory_name: 'F', agent_tool: 'x', default_method: 'metered', scope: {}, efficiency_techniques: [], pipeline: [] };
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.push(k); strings(x, out); }); // keys too (B2-09)
  return out;
};
const hasTok = (text, k) => new RegExp(`(?<![A-Za-z0-9_-])${k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(text);
const withRepo = (doc, fn) => {
  const repo = mkdtempSync(join(tmpdir(), 'anon-'));
  try {
    const p = exportPath(repo); mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    return fn(repo);
  } finally { rmSync(repo, { recursive: true, force: true }); }
};

test('anonymised doc contains no supplied identifier in any string (doc and submission.md)', () => {
  const doc = { schema_version: '1.0', segment, runs: [row('alpha', 'PROJ-1'), row('beta', 'PROJ-2')] };
  under(ON, () => withRepo(doc, (repo) => {
    const res = writeSubmission(repo, { anon: true }, undefined, ta);
    const out = JSON.parse(readFileSync(join(res.dir, 'runs.json'), 'utf8'));
    const md = readFileSync(join(res.dir, 'submission.md'), 'utf8');
    const set = ['alpha', 'beta', 'PROJ-1', 'PROJ-2', '.agents/automation/alpha/report.json', 'Brief for alpha', 'Brief for beta'];
    for (const s of [...strings(out), md]) for (const k of set) assert.ok(!hasTok(s, k), `${k} survives in ${s}`);
    assert.match(out.runs[0].notes, /\.agents\/automation\/anonymised\/cost\.json/);
  }));
});

test('cross-row: row A\'s note names row B\'s slug and work_item_ref -> both scrubbed', () => {
  const a = row('alpha', 'PROJ-1', { notes: 'see beta and PROJ-2 for the rest' });
  const doc = { schema_version: '1.0', segment, runs: [a, row('beta', 'PROJ-2')] };
  const out = under(ON, () => anonymizeDoc(doc, ta));
  assert.equal(out.runs[0].notes, 'see anonymised and anonymised for the rest');
  assert.equal(out.runs[0].work_item_ref, 'T-WI-001');
  assert.equal(out.runs[1].work_item_ref, 'T-WI-002');
});

test('nested and extension-returned string fields scrubbed', () => {
  const doc = { schema_version: '1.0', segment, runs: [row('alpha', 'PROJ-1', { extra: { deep: [{ x: 'on alpha now' }] } })] };
  const ext = { extensionApi: 2, exportRow: (r, ctx) => (ctx.phase === 'anonymize' ? { fromExt: { s: ['gamma-1 / alpha'] }, scrub: ['gamma-1', 'alpha'] } : null) };
  const out = under(ON, () => anonymizeDoc(doc, ext));
  assert.equal(out.runs[0].extra.deep[0].x, 'on anonymised now');
  assert.deepEqual(out.runs[0].fromExt.s, ['anonymised / anonymised']);
  assert.equal('scrub' in out.runs[0], false);
});

test('a short slug b1 does not corrupt claude-b1x, sha:ab1 or a model name; path segments match', () => {
  const set = ['b1'];
  assert.equal(scrubStrings('claude-b1x sha:ab1 gpt-4 b1 a/b1/c b1.json', set), 'claude-b1x sha:ab1 gpt-4 anonymised a/anonymised/c anonymised.json');
  assert.deepEqual(scrubSet({ runs: [] }, [{ work_item_ref: 'R', work_item_brief: 'B' }], ['x', '']).sort(), ['B', 'R', 'x']);
  assert.equal(scrubStrings('abc abcd', ['abc', 'abcd']), 'anonymised anonymised', 'longest first');
});

test('anon-complete off: the reference anonymisation is unchanged (notes keep the receipt path)', () => {
  const doc = { schema_version: '1.0', segment, runs: [row('alpha', 'PROJ-1', { notes: 'x alpha' })] };
  const out = under('none', () => anonymizeDoc(doc, ta));
  assert.equal(out.runs[0].notes, 'x alpha');
});

test('engine-only (extension: null): row A names row B\'s slug and cost.json path -> both scrubbed, no row field added', () => {
  const a = row('alpha', 'PROJ-1', { notes: 'compare with beta, see .agents/automation/beta/cost.json and camp/wave-01 / wave-01' });
  const doc = { schema_version: '1.0', segment, runs: [a, row('beta', 'PROJ-2')] };
  const repo = mkdtempSync(join(tmpdir(), 'anon-r-'));
  try {
    for (const g of ['alpha', 'beta', 'camp/wave-01']) {
      mkdirSync(join(repo, '.agents', 'automation', g), { recursive: true });
      writeFileSync(join(repo, '.agents', 'automation', g, 'report.json'), '{"cases":[]}');
    }
    const p = exportPath(repo); mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(doc));
    under(ON, () => {
      const res = writeSubmission(repo, { anon: true }, undefined, null);
      const out = JSON.parse(readFileSync(join(res.dir, 'runs.json'), 'utf8'));
      assert.equal(out.runs[0].notes, 'compare with anonymised, see anonymised and anonymised / anonymised');
      assert.deepEqual(Object.keys(out.runs[0]), Object.keys(doc.runs[0]));
    });
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('reports-location (M2): receiptIdentifiers also supplies the relocated reports dir and its cost.json', async () => {
  const { receiptIdentifiers } = await import('./build-tokenomics-export.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const repo = mkdtempSync(join(tmpdir(), 'rid-'));
  mkdirSync(join(repo, '.agents', 'automation', 'g1'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'automation', 'g1', 'report.json'), JSON.stringify({ batch: 'g1', cases: [] }));
  const tele = { ...TA_DEFAULTS, reports: { location: 'telemetry' } };
  const ids = receiptIdentifiers(repo, tele);
  assert.ok(ids.includes('.agents/telemetry/automation/reports/g1'));
  assert.ok(ids.includes('.agents/telemetry/automation/reports/g1/cost.json'));
  assert.ok(ids.includes('.agents/automation/g1/cost.json'), 'the receipt-tree paths stay supplied');
  assert.ok(!receiptIdentifiers(repo, TA_DEFAULTS).some((x) => x.includes('/reports/')), 'tree adds nothing');
});

// --- B2 item 24: report-revision — the export document records the manifest revision (spec 14.4, map O6) ---
test('report-revision: runs.json (accumulated, submission, anonymised) records manifestRevision after schema_version; submission.md has the footer', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rr-exp-'));
  const tdir = join(repo, '.agents', 'telemetry', 'automation');
  mkdirSync(tdir, { recursive: true });
  const doc = { schema_version: '1.0', segment, runs: [row('alpha', 'PROJ-1')] };
  const p = exportPath(repo); mkdirSync(dirname(p), { recursive: true });
  const reset = () => writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
  const sub = (anon) => {
    const res = writeSubmission(repo, { anon }, TA_DEFAULTS, ta);
    return { json: JSON.parse(readFileSync(join(res.dir, 'runs.json'), 'utf8')), md: readFileSync(join(res.dir, 'submission.md'), 'utf8') };
  };
  try {
    writeFileSync(join(tdir, 'module.json'), JSON.stringify({ manifestRevision: 5 }));
    for (const anon of [false, true]) {
      reset();
      const { json, md } = under('report-revision,anon-complete', () => sub(anon));
      assert.deepEqual(Object.keys(json).slice(0, 2), ['schema_version', 'manifestRevision'], `anon ${anon}`);
      assert.equal(json.manifestRevision, 5);
      assert.match(md, /\nmanifest revision 5\n?$/, 'the footer is not scrubbed or altered by the anonymiser');
    }
    // an unusable module.json -> null, and the footer says unknown
    writeFileSync(join(tdir, 'module.json'), '{oops');
    reset();
    const bad = under('report-revision', () => sub(false));
    assert.equal(bad.json.manifestRevision, null);
    assert.match(bad.md, /manifest revision unknown/);
    // off: reference shape
    reset();
    const off = under('none', () => sub(false));
    assert.ok(!('manifestRevision' in off.json));
    assert.doesNotMatch(off.md, /manifest revision/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('report-revision: appendRun stamps the accumulated doc; a re-append refreshes it and keeps the order', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rr-app-'));
  mkdirSync(join(repo, '.agents', 'telemetry', 'automation'), { recursive: true });
  try {
    const cost = { batch: 'b1', sources: { sessions: 1, models: [], hosts: ['claude'] }, totals: { dispatches: 0, costUsd: 1 } };
    under('report-revision', () => appendRun(repo, cost, {}, TA_DEFAULTS, null));
    const read = () => JSON.parse(readFileSync(exportPath(repo), 'utf8'));
    assert.deepEqual(Object.keys(read()).slice(0, 3), ['schema_version', 'manifestRevision', 'segment']);
    assert.equal(read().manifestRevision, 1, 'implied manifest');
    writeFileSync(join(repo, '.agents', 'telemetry', 'automation', 'module.json'), JSON.stringify({ manifestRevision: 2 }));
    under('report-revision', () => appendRun(repo, cost, {}, TA_DEFAULTS, null));
    assert.equal(read().manifestRevision, 2);
    assert.deepEqual(Object.keys(read()).slice(0, 3), ['schema_version', 'manifestRevision', 'segment']);
    under('none', () => appendRun(repo, cost, {}, TA_DEFAULTS, null));
    assert.equal(read().manifestRevision, 2, 'migrations off leaves an existing doc as it is (pure extraction)');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('report-robustness (item 20): an incomplete segment omits stop / owner, an overflowing sum renders n/a — never undefined or $null; off keeps the reference text', () => {
  const doc = { schema_version: '1.0', segment: { ...segment, factory_id: 'fx', stop: undefined, owner_group: 'QA', work_item_level: undefined }, runs: [row('alpha', 'PROJ-1', { cost_api_equivalent_usd: 1e308 }), row('beta', 'PROJ-2', { cost_api_equivalent_usd: 1e308 })] };
  const md = (mig) => under(mig, () => withRepo(doc, (repo) => {
    const res = writeSubmission(repo, { anon: false }, TA_DEFAULTS, ta);
    return readFileSync(join(res.dir, 'submission.md'), 'utf8');
  }));
  const on = md('report-robustness');
  assert.doesNotMatch(on, /undefined|\$null/);
  assert.match(on, /^# Submission — fx\n/);
  assert.match(on, /\| \*\*Owner\*\* \| `QA` \|/);
  assert.match(on, /Total cost \(API-equivalent\) \| n\/a \|/);
  const off = md('none');
  assert.match(off, /`undefined` stop/);
  assert.match(off, /\$null/);
});

test('report-robustness (item 20, review round 1): a segment with no agent_tool / default_method / pipeline / scope / techniques renders dashes, never undefined, and does not throw', () => {
  const doc = { schema_version: '1.0', segment: { factory_id: 'fx' }, runs: [row('alpha', 'PROJ-1')] };
  const md = (mig) => under(mig, () => withRepo(doc, (repo) => readFileSync(join(writeSubmission(repo, { anon: false }, TA_DEFAULTS, ta).dir, 'submission.md'), 'utf8')));
  const on = md('report-robustness');
  assert.doesNotMatch(on, /undefined|\$null/);
  assert.match(on, /\| \*\*Agent \/ tool\*\* \| — \|/);
  assert.match(on, /\| \*\*Pipeline\*\* \| — \|/);
  assert.throws(() => md('none'), TypeError);
});

// B2-06 (null-unobservable, O1): the real CLI over a null-valued ledger — the submission never turns unknowns into zeros.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('null-unobservable (B2-06): --batch then --submission over an unmeasured ledger prints dashes with unpriced/unmeasured counts, not zeros', () => {
  const q = (n) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0 });
  const base = { v: 1, host: 'copilot', user: 'u', repo: 'r', role: 'lead', cases: ['TC-1'], startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T01:00:00Z', capturedAt: '2026-10-01T01:01:00Z', models: ['model'], toolCalls: null, toolErrors: null, scope: { intent: 'automation', cases: ['TC-1'] }, subagents: [] };
  const unknown = { ...base, id: 's1', tokens: null, tokensByModel: {}, costUsd: null, activeMin: null, wallMin: null, turns: null };
  const measured = { ...base, id: 's2', tokens: q(7), tokensByModel: { model: q(7) }, costUsd: 3, activeMin: 5, wallMin: 5, turns: 4 };
  const zero = { ...base, id: 's3', tokens: q(0), tokensByModel: { model: q(0) }, costUsd: 0, activeMin: 5, wallMin: 5, turns: 0 };
  const script = fileURLToPath(new URL('./build-tokenomics-export.mjs', import.meta.url));
  const render = (lines) => {
    const repo = mkdtempSync(join(tmpdir(), 'unk-'));
    try {
      const w = (rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
      w('.agents/tokenomics/settings.json', JSON.stringify({ extension: null, reports: { location: 'tree' } }));
      w('.agents/telemetry/automation/usage-u.jsonl', lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
      w('.agents/automation/g/report.json', JSON.stringify({ cases: [{ id: 'TC-1', outcome: 'delivered', at: '2026-10-01T01:00:00Z' }] }));
      w('.agents/telemetry/automation/factory-profile.json', JSON.stringify({ factory_id: 'example', factory_name: 'Example' }));
      const env = { ...process.env }; delete env.TOKENOMICS_MIGRATIONS;
      for (const a of [['--batch', 'g'], ['--submission']]) {
        const r = spawnSync(process.execPath, [script, repo, ...a], { encoding: 'utf8', env });
        assert.equal(r.status, 0, r.stderr);
      }
      return readFileSync(join(repo, '.agents/telemetry/automation/export/datasets/example/submission.md'), 'utf8');
    } finally { rmSync(repo, { recursive: true, force: true }); }
  };
  const none = render([unknown]);
  assert.match(none, /Total cost \(API-equivalent\) \| — \(1 unpriced\) \|/);
  assert.match(none, /Tokens \(in \/ out \/ cache-read \/ cache-create\) \| — \(1 unmeasured\) \|/);
  assert.match(none, /turns \| \d+ \/ \d+ \/ — \(1 unmeasured\) \|/);
  assert.doesNotMatch(none, /\$0 \||0 \/ 0 \/ 0 \/ 0/);
  const zeroOnly = render([zero]);
  assert.match(zeroOnly, /Total cost \(API-equivalent\) \| \$0 \|/);
  assert.match(zeroOnly, /\| 0 \/ 0 \/ 0 \/ 0 \|/);
  assert.match(zeroOnly, /\/ 0 \|\n/);
  assert.doesNotMatch(zeroOnly, /unpriced|unmeasured/);
});

test('M3 (Plan 4 final review): an unverified stamped receipt\'s 0 delivered is disclosed in the runs.json row notes (--batch, --submission; engine and TA notes)', () => {
  const script = fileURLToPath(new URL('./build-tokenomics-export.mjs', import.meta.url));
  const man = { module: 'tokenomics', schema_version: '1.0', domain: 'test', manifestRevision: 1, ratioIntents: ['automation'],
    receipts: { source: 'files', root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['delivered'] } };
  for (const settings of [{ extension: null, reports: { location: 'tree' } }, null]) {
    const repo = mkdtempSync(join(tmpdir(), 'm3-'));
    try {
      const w = (rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
      if (settings) { w('.agents/tokenomics/settings.json', JSON.stringify(settings)); w('.agents/telemetry/automation/module.json', JSON.stringify(man)); }
      w('.agents/telemetry/automation/usage-u.jsonl', `${JSON.stringify({ v: 1, host: 'claude', id: 's1', user: 'u', repo: 'r', role: 'lead', cases: ['TC-1'],
        startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T01:00:00Z', capturedAt: '2026-10-01T01:01:00Z', models: ['model'],
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: 1, activeMin: 5, wallMin: 5, turns: 1, toolCalls: 0, toolErrors: 0,
        scope: { intent: 'automation', batch: 'g', cases: ['TC-1'] }, subagents: [] })}\n`);
      w('.agents/automation/g/report.json', JSON.stringify({ manifestRevision: 2, cases: [{ id: 'TC-1', outcome: 'delivered', at: '2026-10-01T01:00:00Z' }] }));
      w('.agents/telemetry/automation/factory-profile.json', JSON.stringify({ factory_id: 'example', factory_name: 'Example' }));
      const env = { ...process.env, TOKENOMICS_NO_CCUSAGE: '1' }; delete env.TOKENOMICS_MIGRATIONS;
      for (const a of [['--batch', 'g'], ['--submission']]) {
        const r = spawnSync(process.execPath, [script, repo, ...a], { encoding: 'utf8', env });
        assert.equal(r.status, 0, r.stderr);
      }
      const cost = JSON.parse(readFileSync(join(repo, '.agents/automation/g/cost.json'), 'utf8'));
      assert.deepEqual(cost.findings, ['manifest-archive-missing: revision 2']);
      const tag = settings ? 'engine notes' : 'TA notes';
      const runs = JSON.parse(readFileSync(join(repo, '.agents/telemetry/automation/export/runs.json'), 'utf8')).runs;
      assert.match(runs[0].notes, /UNVERIFIED RECEIPT: manifest-archive-missing: revision 2 — delivered counts read 0\./, tag);
      const sub = JSON.parse(readFileSync(join(repo, '.agents/telemetry/automation/export/datasets/example/runs.json'), 'utf8')).runs;
      assert.match(sub[0].notes, /UNVERIFIED RECEIPT: manifest-archive-missing: revision 2/, `${tag}: the submission carries it`);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  }
});

test('B2-09: supplied identifiers never survive as object keys in the serialized anonymised runs.json (all rows)', () => {
  const rows = [
    row('alpha', 'PRIVATE-47', { extra: { 'PRIVATE-47': 'k', '/secret/receipt.json': 'p', nested: { 'PROJ-2': 1, alpha: 2 } } }),
    row('beta', 'PROJ-2', { extra: { 'on PROJ-2 now': 1, 'PROJ-2': 2, keep: 3 } }),
  ];
  const doc = { schema_version: '1.0', segment, runs: rows };
  under(ON, () => withRepo(doc, (repo) => {
    const res = writeSubmission(repo, { anon: true }, undefined, ta);
    const text = readFileSync(join(res.dir, 'runs.json'), 'utf8');
    const out = JSON.parse(text);
    for (const k of ['PRIVATE-47', 'PROJ-2', 'alpha', 'beta']) assert.ok(!hasTok(text, k), `${k} survives in serialized runs.json`);
    assert.deepEqual(Object.keys(out.runs[0].extra), ['anonymised', '/secret/receipt.json', 'nested']);
    assert.deepEqual(Object.keys(out.runs[0].extra.nested), ['anonymised', 'anonymised-2']);
    assert.deepEqual(Object.keys(out.runs[1].extra), ['on anonymised now', 'anonymised', 'keep']);
    assert.equal(out.runs[0].extra.nested.anonymised, 1);
    assert.equal(out.runs[0].extra.nested['anonymised-2'], 2, 'colliding keys get distinct deterministic placeholders, none dropped');
    assert.deepEqual(Object.keys(out.runs[0]).slice(0, 2), ['work_item_ref', 'work_item_brief'], 'row field names are never renamed');
  }));
});

test('M2 (Plan 4 final review): a nested slug whose last segment is a token-quad key never renames the dataset schema keys', () => {
  const repo = mkdtempSync(join(tmpdir(), 'm2-'));
  try {
    mkdirSync(join(repo, '.agents/automation/wave/output'), { recursive: true });
    writeFileSync(join(repo, '.agents/automation/wave/output/report.json'), JSON.stringify({ cases: [{ id: 'TC-1', outcome: 'delivered' }] }));
    const quad = { input: 1, output: 2, cache_read: 3, cache_create: 4 };
    const doc = { schema_version: '1.0', segment, runs: [row('wave/output', 'PROJ-1', { tokens: { ...quad }, tokens_by_model: { 'claude-b1x': { ...quad } }, notes: 'the output of wave/output, input and cache_read too' })] };
    const out = under(ON, () => anonymizeDoc(doc, ta, TA_DEFAULTS, repo));
    assert.deepEqual(out.runs[0].tokens, quad, 'tokens keeps its schema keys');
    assert.deepEqual(out.runs[0].tokens_by_model['claude-b1x'], quad, 'tokens_by_model.<m> keeps its schema keys');
    assert.ok(!hasTok(out.runs[0].notes, 'output'), 'values are still scrubbed');
    assert.match(out.runs[0].notes, /anonymised/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
  // the helper: a kept key is never renamed; any other key still is
  assert.deepEqual(scrubStrings({ runs: [{ tokens: { output: 2, PRIV: 1 } }] }, ['output', 'PRIV'], { keyDepth: 2, keepKeys: new Set(['output']) }),
    { runs: [{ tokens: { output: 2, anonymised: 1 } }] });
});

test('B2-09: a slug equal to a structural key name does not rename row fields; migration off leaves keys alone', () => {
  const doc = { schema_version: '1.0', segment, runs: [row('notes', 'PROJ-1', { extra: { notes: 1 } })] };
  const out = under(ON, () => anonymizeDoc(doc, ta));
  assert.ok('notes' in out.runs[0] && 'tokens' in out.runs[0]);
  const off = under('none', () => anonymizeDoc({ ...doc, runs: [row('alpha', 'P-1', { extra: { 'P-1': 1 } })] }, ta));
  assert.ok('P-1' in off.runs[0].extra);
});
