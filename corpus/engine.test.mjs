import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffImpl, ENGINE, goldenFiles } from '../scripts/diff-impl.mjs';
import { runCase } from '../replay/runner.mjs';
import { expectedExits } from '../replay/exits.mjs';
import { HOOK_CALLS, CORPUS_UNREACHED } from '../tokenomics/engine/extension.mjs';
import { approvedEngineOnly } from '../scripts/engine-only.mjs';

const CASES = fileURLToPath(new URL('./cases', import.meta.url));
// The engine-only set comes from the pinned approvals (Codex P2-08), not from the implOnly flag itself.
const approvals = JSON.parse(readFileSync(new URL('./engine-only.json', import.meta.url), 'utf8'));

// One traced replay serves both the B1 gate and the TA hook-coverage check (Task 10 Step 4): outputs equal
// the reference goldens while HT_EXT_TRACE_FILE records every extension hook the engine calls.
test('B1 gate: engine output equals the reference goldens for every case, and every TA inventory hook is called', async () => {
  const expected = readdirSync(CASES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((c) => !approvedEngineOnly(approvals).includes(c))
    .sort();
  const { results: all, hooks } = await diffImpl(ENGINE, { traceHooks: true });
  assert.deepEqual(all.filter((x) => x.case === '(engine-only)'), []);
  const r = all.filter((x) => x.case !== '(engine-only)');
  assert.deepEqual(r.map((x) => x.case), expected);
  const bad = r.filter((x) => x.problems.length);
  assert.deepEqual(bad, [], JSON.stringify(bad, null, 2));
  // a trace line is `name:phase` (bare `name` for a phase-less call), `#<part>` appended when ctx carries a part / slot
  const called = new Set(hooks.map((h) => traceEntry(h).call));
  const names = new Set(hooks.map((h) => traceEntry(h).name));
  const a = JSON.parse(readFileSync(new URL('../docs/inventory/b0-assignments.json', import.meta.url), 'utf8'));
  for (const h of new Set(Object.values(a).filter((x) => x.owner === 'ta-extension').map((x) => x.target))) {
    assert.ok(names.has(h), `hook ${h} never called on the corpus`);
  }
  // every documented hook:phase is called, except the explicitly unreached ones (which must stay unreached)
  for (const k of HOOK_CALLS) {
    if (k in CORPUS_UNREACHED) assert.ok(!called.has(k), `${k} is reached now — drop it from CORPUS_UNREACHED`);
    else assert.ok(called.has(k), `documented ${k} never called on the corpus`);
  }
  for (const k of Object.keys(CORPUS_UNREACHED)) assert.ok(HOOK_CALLS.includes(k), `CORPUS_UNREACHED ${k} is not a documented call`);
  assert.deepEqual([...called].filter((k) => !HOOK_CALLS.includes(k)), [], 'undocumented hook:phase called');
  // API 2 (D3): every call's documented part set (ENGINE-B1.md's contract table, the one source) equals the parts the
  // corpus trace records for it — a part the engine passes but the table omits fails, and so does a documented part
  // no corpus case reaches.
  const traced = new Map(HOOK_CALLS.map((k) => [k, new Set()]));
  for (const h of hooks) { const { call, part } = traceEntry(h); if (part) traced.get(call)?.add(part); }
  for (const [k, parts] of apiTable()) {
    assert.deepEqual([...traced.get(k)].sort(), [...parts].sort(), `${k}: documented parts vs the parts the corpus trace records`);
  }
});

/** One hook-trace line `name[:phase][#part]` → `{ name, call, part }` (`call` = `name[:phase]`, as HOOK_CALLS spells it). */
function traceEntry(line) {
  const [call, part = null] = line.split('#');
  return { name: call.split(':')[0], call, part };
}

/** ENGINE-B1.md "Extension API": the API 2 contract table (header `| call | parts | …`) as `Map<call, parts[]>`. A
 * parts cell is `—` (no part) or backticked values; a parenthesis (e.g. `(as ctx.slot)`) is commentary, not a part.
 * Anything else fails loudly: no table, a short row, a call that is not one backticked name, a parts cell that is
 * neither `—` nor backticked values, a duplicate call. */
function parseApiTable(doc) {
  const at = doc.indexOf('### Extension API');
  assert.ok(at >= 0, 'no "### Extension API" section');
  const lines = doc.slice(at).split('\n');
  const start = lines.findIndex((l) => /^\| call \| parts \|/.test(l));
  assert.ok(start >= 0, 'no API 2 contract table (| call | parts | …)');
  assert.match(lines[start + 1] ?? '', /^\|(-+\|)+$/, 'the contract table header has no separator row');
  const rows = [];
  for (const l of lines.slice(start + 2)) { if (!l.startsWith('|')) break; rows.push(l); }
  assert.ok(rows.length, 'the contract table has no rows');
  const table = new Map(rows.map((row) => {
    const cells = row.split('|').map((c) => c.trim());
    assert.equal(cells.length, 8, `contract row must have 6 cells: ${row.slice(0, 80)}`);
    const [, call, parts] = cells;
    assert.match(call, /^`[A-Za-z]+(:[a-z-]+)?`$/, `call cell must be one backticked call: ${call}`);
    const p = parts === '—' ? [] : [...parts.replace(/\([^)]*\)/g, '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.ok(parts === '—' || p.length, `${call}: parts cell must be — or backticked values, got ${JSON.stringify(parts)}`);
    return [call.replace(/`/g, ''), p];
  }));
  assert.equal(table.size, rows.length, 'one row per call (a call is listed twice)');
  return table;
}
const apiTable = () => parseApiTable(readFileSync(new URL('../tokenomics/ENGINE-B1.md', import.meta.url), 'utf8'));

test('the contract-table parser fails loudly on a malformed table (review M1)', () => {
  const doc = (rows, head = '| call | parts | input | ctx | return | migration |\n|---|---|---|---|---|---|') => `### Extension API\n\n${head}\n${rows.join('\n')}\n\nafter`;
  const ok = '| `onClose:report` | — | x | x | x | x |';
  assert.deepEqual([...parseApiTable(doc([ok, '| `a:render-md` | `p`, `q` (as `ctx.slot`) | x | x | x | x |']))], [['onClose:report', []], ['a:render-md', ['p', 'q']]]);
  for (const [bad, why] of [
    [doc([ok, '| `a:b` |  | x | x | x | x |']), /parts cell must be — or backticked values/],
    [doc([ok, '| `a:b` | none | x | x | x | x |']), /parts cell must be — or backticked values/],
    [doc([ok, '| `a:b` | (only `commentary`) | x | x | x | x |']), /parts cell must be — or backticked values/],
    [doc([ok, '| `a:b` | — | x |']), /must have 6 cells/],
    [doc([ok, '| a:b | — | x | x | x | x |']), /one backticked call/],
    [doc([ok, ok]), /listed twice/],
    [doc([]), /no rows/],
    [doc([ok], '| call | parts | input | ctx | return | migration |'), /no separator row/],
    ['# nothing here', /no "### Extension API" section/],
    ['### Extension API\n\n| hook | phase |\n|---|---|', /no API 2 contract table/],
  ]) assert.throws(() => parseApiTable(bad), why);
});

test('trace entries split name, call and part on : and # (review M4)', () => {
  assert.deepEqual(traceEntry('labelFrom'), { name: 'labelFrom', call: 'labelFrom', part: null });
  assert.deepEqual(traceEntry('exportRow:checklist#segment'), { name: 'exportRow', call: 'exportRow:checklist', part: 'segment' });
  assert.deepEqual(traceEntry('labelFrom#x'), { name: 'labelFrom', call: 'labelFrom', part: 'x' }); // a phase-less call with a part
});

// Review M2: the part-set check above runs over the corpus trace, so an unreached call's documented parts would be
// checked against nothing. CORPUS_UNREACHED must stay empty; adding an entry forces a decision on its part check.
test('CORPUS_UNREACHED is empty, so every documented call has its part set checked against the corpus trace', () => {
  assert.deepEqual(Object.keys(CORPUS_UNREACHED), [], 'an unreached call needs its own part check before it may be listed here');
});

test('ENGINE-B1.md "Extension API" API 2 contract table mirrors HOOK_CALLS', () => {
  const table = apiTable();
  assert.deepEqual([...table.keys()].sort(), [...HOOK_CALLS].sort());
});

// implOnly: "engine" cases have no reference golden (e.g. a foreign configuration the reference
// cannot run): they replay against the engine and compare with their engine goldens, both directions.
const engineOnly = approvedEngineOnly(approvals);

test('engine-only cases exist', () => assert.ok(engineOnly.length > 0));

for (const c of engineOnly) {
  test(`engine golden ${c}`, async () => {
    const dir = join(CASES, c);
    const r = await runCase(dir, ENGINE, { extraEnv: { TOKENOMICS_MIGRATIONS: 'none' } });
    assert.deepEqual(r.exits, expectedExits(dir, JSON.parse(readFileSync(join(dir, 'replay.json'), 'utf8'))), `${c} exits`);
    const golden = goldenFiles(join(dir, 'expected', 'engine'));
    assert.deepEqual(Object.keys(r.files).sort(), Object.keys(golden).sort(), `${c}: produced vs engine golden file set`);
    for (const [k, v] of Object.entries(r.files)) assert.equal(v, golden[k], `${c} engine golden ${k}`);
  });
}

// foreign-settings (final fix wave): a foreign settings.json (dir, receipts, ids, vocabulary, extension null)
// renders its own dir and wording and no TA wording or path. The goldens are the engine's output (the
// "engine golden foreign-settings" test above proves the replay still produces them byte for byte).
test('foreign-settings: foreign dir, ids and wording in the outputs; no TA wording or paths', () => {
  const g = goldenFiles(join(CASES, 'foreign-settings', 'expected', 'engine'));
  const paths = Object.keys(g);
  assert.ok(paths.includes('.agents/telemetry/stories/usage-corpus.jsonl'));
  assert.ok(paths.includes('.agents/stories/sp1/cost.json') && paths.includes('.agents/stories/sp1/batch-report.md'));
  assert.deepEqual(JSON.parse(g['.agents/telemetry/stories/usage-corpus.jsonl']).cases, ['issue-101'], 'mined by the foreign ids pattern');
  const report = g['.agents/stories/sp1/batch-report.md'];
  assert.match(report, /^# Sprint cost — sp1$/m);
  assert.match(report, /also served other sprints .*; 1 other-sprint dispatch\(es\) excluded/);
  assert.match(report, /^- Stories: 1 {2}· {2}\*\*delivered: 1\*\* {2}· {2}done 1$/m);
  assert.match(g['__events__/4.stdout'], /^## By sprint$/m);
  assert.match(g['__events__/6.stdout'], /<title>Sprint cost — sp1<\/title>[\s\S]*1 other-sprint dispatch\(es\) excluded/);
  assert.ok(paths.every((p) => !/automation/i.test(p)), 'no TA path');
  for (const [p, v] of Object.entries(g)) {
    assert.doesNotMatch(v, /automation/i, `${p}: TA dir/intent`);
    // ledger/cost keys (`cases`, `batch`) are the schema, not wording: only the JSON string values are checked
    if (/\.jsonl?$/.test(p)) {
      const values = [];
      const walk = (x) => { if (typeof x === 'string') values.push(x); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
      for (const doc of p.endsWith('.jsonl') ? v.split('\n').filter(Boolean) : [v]) walk(JSON.parse(doc)); // .json is one document
      for (const s of values) {
        const text = s.replace(/batch-(report|tokenomics|cost)\b|--(batch|cases)\b/g, '');
        assert.doesNotMatch(text, /\b(cases?|batch(es)?)\b|delivered\/defect-found|merged-sanctioned-red/i, `${p}: TA wording in a JSON value: ${s}`);
      }
      continue;
    }
    // identifiers kept verbatim (ENGINE-B1 vocabulary.group): the report file names and CLI flags
    const text = v.replace(/batch-(report|tokenomics|cost)\b|--(batch|cases)\b/g, '');
    assert.doesNotMatch(text, /\b(cases?|batch(es)?)\b/i, `${p}: TA wording`);
  }
});
