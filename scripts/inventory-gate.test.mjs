import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, appendFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanReference, scanEngine, checkAssignments, scanSource, checkEngineAllowlist } from './inventory.mjs';
import { refDir } from './vendor-reference.mjs';

const HOOKS = ['labelFrom', 'receiptIds', 'classifyDispatch', 'enrichGroup', 'onClose', 'stopGateCheck', 'exportRow'];
const CONFIG = /^(dir|receipts\.(root|file|deliveredOutcomes)|intents\.default|ratioIntents|ids\.(patterns|max|stoplist)|vocabulary\.(item|group|delivered)|env\.[A-Z_]+|paths\.[a-zA-Z]+|reports\.location)$/;

test('B0 gate: every inventory site is assigned, none stale or invalid', () => {
  const sites = scanReference(refDir('49577c7'));
  const assignments = JSON.parse(readFileSync(new URL('../docs/inventory/b0-assignments.json', import.meta.url), 'utf8'));
  const r = checkAssignments(sites, assignments);
  assert.deepEqual(r.unassigned.map((s) => s.id), []);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.invalid, []);
});

test('targets use the fixed vocabularies', () => {
  const assignments = JSON.parse(readFileSync(new URL('../docs/inventory/b0-assignments.json', import.meta.url), 'utf8'));
  for (const [id, a] of Object.entries(assignments)) {
    if (a.owner === 'ta-extension') assert.ok(HOOKS.includes(a.target), `${id}: unknown hook ${a.target}`);
    if (a.owner === 'engine-config') assert.match(a.target, CONFIG, `${id}: unknown config key ${a.target}`);
  }
});

// Engine-side leak gate: the scanner over the engine copy, against docs/inventory/engine-allowlist.json.

const ENGINE = fileURLToPath(new URL('../tokenomics', import.meta.url));
const allowlist = () => JSON.parse(readFileSync(new URL('../docs/inventory/engine-allowlist.json', import.meta.url), 'utf8'));

test('engine gate: every engine site is allowlisted with a kind and a reason, none stale', () => {
  const r = checkEngineAllowlist(scanEngine(ENGINE), allowlist());
  assert.deepEqual(r.unlisted.map((s) => s.id), []);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.invalid, []);
  assert.deepEqual(r.overcount, []);
  assert.deepEqual(r.undercount, []);
});

test('engine gate: a count that is not an integer >= 2 is invalid', () => {
  const [site] = scanSource('hooks/h.mjs', "const a = 'automation';\n");
  const reason = 'r'.repeat(40);
  for (const count of [1, 0, 2.5, '2']) {
    assert.deepEqual(checkEngineAllowlist([site], { [site.id]: { kind: 'residue', reason, count } }).invalid,
      [{ id: site.id, problem: 'count must be an integer >= 2 when given' }], `count ${JSON.stringify(count)}`);
  }
});

test('engine gate: a planted TA literal is an unlisted site; a weak entry is invalid', () => {
  const sites = scanEngine(ENGINE);
  // the pre-fix team-report line (other-batch) and a raw TA path
  const leak = scanSource('scripts/team-report.mjs', [
    "if (x) out.push(`_${n} session(s) also served other ${w.groups}${f ? `; ${f} other-batch dispatch(es) excluded` : ''}._`);",
    "const p = join(repo, '.agents', 'automation', slug);",
  ].join('\n'));
  assert.ok(leak.some((s) => s.category === 'group-wording') && leak.some((s) => s.category === 'path-automation'));
  const r = checkEngineAllowlist([...sites, ...leak], allowlist());
  assert.deepEqual(r.unlisted.map((s) => s.id).sort(), leak.map((s) => s.id).sort());
  const weak = checkEngineAllowlist(leak, Object.fromEntries(leak.map((s, i) => [s.id, i ? { kind: 'false-positive', reason: 'short' } : { kind: 'whatever', reason: 'x'.repeat(50) }])));
  assert.equal(weak.invalid.length, 2);
});

test('inventory CLI exit code: 0 on the engine, 1 on an engine copy with a planted leak', () => {
  const cli = fileURLToPath(new URL('./inventory.mjs', import.meta.url));
  const ok = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /engine sites \d+, unlisted 0, stale 0, invalid 0, overcount 0, undercount 0/);
  const copy = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ht-inv-'));
    for (const d of ['adapters', 'engine', 'hooks', 'scripts']) cpSync(join(ENGINE, d), join(dir, d), { recursive: true });
    return dir;
  };
  const run = (dir) => spawnSync(process.execPath, [cli, '--engine-root', dir], { encoding: 'utf8' });
  const lit = "export const d = join(repo, '.agents', 'automation');\n";
  const dirs = [];
  try {
    // a TA literal in the TA extension's own home is not an engine site
    const ext = copy(); dirs.push(ext);
    mkdirSync(join(ext, 'extensions'));
    writeFileSync(join(ext, 'extensions', 'x.mjs'), lit);
    const quiet = run(ext);
    assert.equal(quiet.status, 0, quiet.stderr);
    // a leak appended to a top-level engine script
    const top = copy(); dirs.push(top);
    appendFileSync(join(top, 'scripts', 'team-report.mjs'), "\nexport const leaked = `${n} other-batch dispatch(es) excluded`;\n");
    const bad = run(top);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unlisted 1,/);
    assert.match(bad.stderr, /unlisted engine site scripts\/team-report\.mjs:group-wording:/);
    // the same TA literal in a nested engine module
    const nested = copy(); dirs.push(nested);
    mkdirSync(join(nested, 'engine', 'sub'));
    writeFileSync(join(nested, 'engine', 'sub', 'x.mjs'), lit);
    const deep = run(nested);
    assert.equal(deep.status, 1);
    assert.match(deep.stderr, /unlisted 1,/);
    assert.match(deep.stderr, /unlisted engine site engine\/sub\/x\.mjs:path-automation:/);
    // a second copy of an allowlisted line
    const dup = copy(); dirs.push(dup);
    appendFileSync(join(dup, 'engine', 'config.mjs'), "\nconst again = {\n  dir: 'automation',\n};\n");
    const twice = run(dup);
    assert.equal(twice.status, 1);
    assert.match(twice.stderr, /unlisted 0, stale 0, invalid 0, overcount 1, undercount 0/);
    assert.match(twice.stderr, /overcount engine site engine\/config\.mjs:path-automation:b34b4492c7: 2 copies, allowlisted 1/);
  } finally { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
});
