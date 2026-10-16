import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check } from './check.mjs';
import { readReceipts } from './receipts.mjs';

const FX = fileURLToPath(new URL('../fixtures/', import.meta.url));

test('valid port fixture: exit 0, no error', () => {
  const r = check(join(FX, 'port/valid/basic'), { mode: 'port' });
  assert.equal(r.exit, 0, JSON.stringify(r.findings));
});

for (const rule of readdirSync(join(FX, 'port/invalid'))) {
  test(`single-fault fixture "${rule}" reports its rule`, () => {
    const r = check(join(FX, 'port/invalid', rule), { mode: 'port' });
    assert.ok(r.findings.some((f) => f.rule === rule), `${rule}: ${JSON.stringify(r.findings)}`);
    assert.equal(r.exit, 1);
  });
}

test('mode is required', () => {
  assert.throws(() => check(join(FX, 'port/valid/basic'), {}), /mode/);
});

test('reference fixtures read with zero error in reference mode', () => {
  for (const sha of ['49577c7', 'fa0a6fb', 'd9eac08']) {
    const r = check(join(FX, 'reference', sha, '.agents/telemetry'), { mode: 'reference' });
    assert.equal(r.findings.filter((f) => f.class === 'error').length, 0, `${sha}: ${JSON.stringify(r.findings)}`);
  }
});

test('mixed mode: writer lines strict, others permissive', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-mixed-'));
  mkdirSync(join(d, 'automation'));
  writeFileSync(join(d, 'automation/usage-x.jsonl'), '{"v":1,"host":"claude","id":"old","tokens":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}\n{"v":1,"writer":"tokenomics-engine@1.0.0","host":"claude","id":"new"}\n');
  const r = check(d, { mode: 'mixed' });
  assert.ok(r.findings.some((f) => f.rule === 'schema' && /usage-x/.test(f.file) && f.line === 2));
  assert.ok(!r.findings.some((f) => f.class === 'error' && f.line === 1));
});

test('ledgers without module.json are a manifest-missing error', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-nomod-'));
  mkdirSync(join(d, 'stories'));
  const line = readFileSync(join(FX, 'port/valid/basic/automation/usage-corpus.jsonl'), 'utf8');
  writeFileSync(join(d, 'stories/usage-x.jsonl'), line);
  const r = check(d, { mode: 'port' });
  assert.ok(r.findings.some((f) => f.rule === 'manifest-missing' && f.class === 'error'), JSON.stringify(r.findings));
  assert.equal(r.exit, 1);
});

test('receipts: a failing command is unavailable, never an empty success', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ht-rc-'));
  const r = readReceipts({ repo, manifest: { receipts: { source: 'command', deliveredOutcomes: ['delivered'] } }, runReceipts: true,
    settings: { receipts: { command: [process.execPath, '-e', 'process.exit(3)'], timeoutSec: 5 } } });
  assert.equal(r.available, false);
  assert.ok(r.findings.some((f) => f.rule === 'receipts-unavailable'));
});

test('receipts: commands do not run without --run-receipts', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ht-rc-'));
  const marker = join(repo, 'ran');
  const args = { repo, manifest: { receipts: { source: 'command', deliveredOutcomes: [] } },
    settings: { receipts: { command: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'1')`], timeoutSec: 5 } } };
  const r = readReceipts(args);
  assert.equal(r.available, false);
  assert.ok(r.findings.some((f) => f.rule === 'receipts-not-run' && f.class === 'unverified'));
  assert.equal(existsSync(marker), false, 'the receipts command ran without --run-receipts');
  // control: the same command does write the marker when running is allowed
  readReceipts({ ...args, runReceipts: true });
  assert.equal(existsSync(marker), true, 'control: the command writes the marker when run');
});

test('receipts: --receipts-file is validated against the envelope', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-rf-'));
  writeFileSync(join(d, 'r.json'), JSON.stringify({ schema: 1, complete: true, receipts: [{ group: 'g', cases: [{ id: 'a', outcome: 'delivered' }] }] }));
  const r = readReceipts({ repo: d, manifest: { receipts: { source: 'command', deliveredOutcomes: ['delivered'] } }, receiptsFile: join(d, 'r.json') });
  assert.equal(r.available, true);
  assert.equal(r.receipts.length, 1);
});

test('receipts files: absent root is unavailable, malformed files are reported', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ht-rfiles-'));
  const manifest = { receipts: { source: 'files', root: 'rc', file: 'report.json', deliveredOutcomes: [] } };
  const a = readReceipts({ repo, manifest });
  assert.equal(a.available, false);
  assert.ok(a.findings.some((f) => f.rule === 'receipts-unavailable' && f.class === 'unverified'));
  mkdirSync(join(repo, 'rc/g1'), { recursive: true });
  mkdirSync(join(repo, 'rc/g2'), { recursive: true });
  writeFileSync(join(repo, 'rc/g1/report.json'), '{nope');
  writeFileSync(join(repo, 'rc/g2/report.json'), '{"x":1}');
  const b = readReceipts({ repo, manifest });
  assert.equal(b.available, true);
  assert.equal(b.receipts.length, 0);
  assert.equal(b.findings.filter((f) => f.rule === 'receipt-malformed').length, 2);
});

test('profile receipts without --repo is reported, not skipped', () => {
  const r = check(join(FX, 'port/valid/basic'), { mode: 'port', profiles: ['core', 'receipts'] });
  assert.ok(r.findings.some((f) => f.rule === 'receipts-not-checked' && f.class === 'unverified'));
});

test('CLI: --receipts-file implies the receipts profile', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-cli-'));
  writeFileSync(join(d, 'bad.json'), '{"schema":1');
  // The CLI runs in a child: stubbing this process's stdout would swallow Node 18's per-file test report.
  const bin = new URL('../../bin/harness-telemetry.mjs', import.meta.url).href;
  const { stdout: out } = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { main } = await import(${JSON.stringify(bin)}); process.exitCode = await main(process.argv.slice(1));`,
    '--', 'check', join(FX, 'port/invalid/conflict'), '--mode', 'port', '--repo', d, '--receipts-file', join(d, 'bad.json'), '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.ok(parsed.findings.some((f) => f.rule === 'receipts-unavailable'), out);
});

test('non-object JSON lines are json-parse errors, not crashes', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-nonobj-'));
  mkdirSync(join(d, 'automation'));
  writeFileSync(join(d, 'automation/module.json'), readFileSync(join(FX, 'port/valid/basic/automation/module.json')));
  writeFileSync(join(d, 'automation/usage-x.jsonl'), '5\n[]\n');
  const r = check(d, { mode: 'port' });
  assert.equal(r.findings.filter((f) => f.rule === 'json-parse').length, 2, JSON.stringify(r.findings));
  assert.equal(r.exit, 1);
});

test('an empty telemetry dir is unverified no-ledgers, never a silent pass', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-empty-'));
  for (const mode of ['port', 'reference', 'mixed']) {
    const r = check(d, { mode });
    assert.ok(r.findings.some((f) => f.class === 'unverified' && f.rule === 'no-ledgers'), `${mode}: ${JSON.stringify(r.findings)}`);
  }
});

test('a module with no ledgers is unverified no-ledgers', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-noledger-'));
  mkdirSync(join(d, 'automation'));
  writeFileSync(join(d, 'automation/module.json'), readFileSync(join(FX, 'port/valid/basic/automation/module.json')));
  const r = check(d, { mode: 'port' });
  const f = r.findings.find((x) => x.rule === 'no-ledgers');
  assert.ok(f, JSON.stringify(r.findings));
  assert.equal(f.class, 'unverified');
  assert.equal(f.file, join(d, 'automation'));
  // a module that has a ledger does not get the finding
  assert.ok(!check(join(FX, 'port/valid/basic'), { mode: 'port' }).findings.some((x) => x.rule === 'no-ledgers'));
});

test('unknown profiles are rejected; CLI exits 2 with a message', async () => {
  assert.throws(() => check(join(FX, 'port/valid/basic'), { mode: 'port', profiles: ['core', 'scopes'] }), /unknown profile scopes/);
  const { COMMANDS } = await import('../../bin/harness-telemetry.mjs');
  const errs = [];
  const code = await COMMANDS.check([join(FX, 'port/valid/basic'), '--mode', 'port', '--profile', 'core,bogus'], { err: (s) => errs.push(s) });
  assert.equal(code, 2);
  assert.match(errs.join('\n'), /unknown profile bogus/);
});

const GOLD = (c) => fileURLToPath(new URL(`../../corpus/cases/${c}/expected/49577c7/.agents/telemetry`, import.meta.url));
for (const [c, rule] of [['seed-copilot-no-usage', 'reference-copilot-tokens'], ['seed-copilot-no-usage', 'zero-for-unmeasured'],
  ['seed-vscode-no-credits', 'reference-vscode-counters'], ['seed-claude-folded', 'reference-folded']]) {
  test(`reference mode: ${c} golden reports limitation ${rule} (spec §7.4)`, () => {
    const r = check(GOLD(c), { mode: 'reference' });
    assert.ok(r.findings.some((f) => f.class === 'limitation' && f.rule === rule), JSON.stringify(r.findings));
    assert.equal(r.exit, 0);
  });
}

test('reference §7.4 limitations are not raised for writer lines or in port mode', () => {
  const r = check(join(FX, 'port/valid/basic'), { mode: 'port' });
  assert.ok(!r.findings.some((f) => /^reference-|zero-for-unmeasured/.test(f.rule)), JSON.stringify(r.findings));
});

test('unknown v in reference and mixed mode is unverified unknown-version (spec §7.3)', () => {
  const d = mkdtempSync(join(tmpdir(), 'ht-v2-'));
  mkdirSync(join(d, 'automation'));
  writeFileSync(join(d, 'automation/usage-x.jsonl'), '{"v":2,"host":"claude","id":"a","costUsd":1,"costSource":"ccusage-metered"}\n{"v":1,"host":"claude","id":"b"}\n');
  for (const mode of ['reference', 'mixed']) {
    const r = check(d, { mode });
    const hits = r.findings.filter((f) => f.rule === 'unknown-version');
    assert.equal(hits.length, 1, `${mode}: ${JSON.stringify(r.findings)}`);
    assert.equal(hits[0].class, 'unverified');
    assert.equal(hits[0].line, 1);
  }
});

// B2 item 9 scope-resolution (owner Q12b): an id with records under more than one host is ambiguous — a kit finding
test('scope profile: a session id with records in more than one place is an ambiguous-scope finding', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'kit-amb-')), 'automation');
  const put = (rel) => {
    mkdirSync(join(dir, 'scopes', rel, '..'), { recursive: true });
    writeFileSync(join(dir, 'scopes', rel), JSON.stringify({ v: 1, session: 'x', intent: 'i', cases: [], declaredAt: 'T', updatedAt: 'T' }));
  };
  put('claude/a.json'); put('copilot/a.json'); put('b.json'); put('claude/b.json'); put('claude/c.json'); put('pending-p.json');
  const amb = check(dir, { mode: 'port', profiles: ['core', 'scope'] }).findings.filter((f) => f.rule === 'ambiguous-scope');
  assert.deepEqual(amb.map((f) => f.message), [
    'a: records at claude/a.json, copilot/a.json are never merged',
    'b: records at claude/b.json, b.json are never merged',
  ]);
  assert.ok(amb.every((f) => f.class === 'limitation'));
  assert.ok(!check(dir, { mode: 'port' }).findings.some((f) => f.rule === 'ambiguous-scope'), 'scope records are read under the scope profile');
});

// scope-resolution review round 1 (I1): a line whose session's only record is under another host is a finding
test('scope profile: a ledger session whose only scope record is another host\'s is a scope-host-mismatch finding', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'kit-mis-')), 'automation');
  mkdirSync(join(dir, 'scopes', 'claude'), { recursive: true });
  writeFileSync(join(dir, 'scopes', 'claude', 'c1.json'), JSON.stringify({ v: 1, session: 'c1', intent: 'i', cases: [], declaredAt: 'T', updatedAt: 'T' }));
  writeFileSync(join(dir, 'usage-x.jsonl'), `${JSON.stringify({ v: 1, host: 'copilot', id: 'c1' })}\n${JSON.stringify({ v: 1, host: 'claude', id: 'c1' })}\n`);
  const f = check(dir, { mode: 'reference', profiles: ['core', 'scope'] }).findings.filter((x) => x.rule === 'scope-host-mismatch');
  assert.deepEqual(f.map((x) => x.message), ['copilot:c1: the only scope record is claude/c1.json (another host\'s) — never stamped on this host\'s line']);
  assert.equal(f[0].class, 'limitation');
});
