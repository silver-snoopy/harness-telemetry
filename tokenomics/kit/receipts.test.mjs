// The receipt reader (spec §5.6) and the command runner extracted from it (Plan 7 Task 4, D-RECEIPTS): readReceipts
// keeps today's return values exactly; runReceiptCommand adds `complete` and `reason` and passes the given env.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReceipts, runReceiptCommand } from './receipts.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'ht-rcpt-'));
after(() => rmSync(sandbox, { recursive: true, force: true }));
let n = 0;
const dir = () => { const d = join(sandbox, `d${n++}`); mkdirSync(d); return d; };

const cmdManifest = { receipts: { source: 'command', deliveredOutcomes: ['delivered'] } };
const print = (doc) => [process.execPath, '-e', `process.stdout.write(${JSON.stringify(typeof doc === 'string' ? doc : JSON.stringify(doc))})`];
const settingsFor = (command) => ({ receipts: { command, timeoutSec: 10 } });
const f = (cls, rule, message, file = null) => ({ class: cls, rule, file, line: null, message });
const ENVELOPE = { schema: 1, complete: true, receipts: [{ group: 'jira:PAY', source: 'jira', cases: [{ id: 'jira:PAY-1', outcome: 'delivered', at: '2026-10-02T00:00:00Z' }] }] };

test('readReceipts: the command branch returns exactly what it returned before the extraction', () => {
  const repo = dir();
  const run = (command) => readReceipts({ repo, manifest: cmdManifest, runReceipts: true, settings: settingsFor(command) });
  assert.deepEqual(run(print(ENVELOPE)), { receipts: ENVELOPE.receipts, findings: [], available: true });
  assert.deepEqual(run(print({ ...ENVELOPE, complete: false })),
    { receipts: ENVELOPE.receipts, findings: [f('unverified', 'receipts-incomplete', 'adapter reported complete:false')], available: true });
  assert.deepEqual(run([process.execPath, '-e', 'process.exit(1)']),
    { receipts: [], findings: [f('unverified', 'receipts-unavailable', 'command failed: exit 1')], available: false });
  assert.deepEqual(run(print('not json')),
    { receipts: [], findings: [f('unverified', 'receipts-unavailable', 'malformed output: $ not JSON')], available: false });
  assert.deepEqual(run(print({ schema: 1, complete: true })),
    { receipts: [], findings: [f('unverified', 'receipts-unavailable', 'malformed output: $ missing required receipts')], available: false });
  assert.deepEqual(readReceipts({ repo, manifest: cmdManifest, runReceipts: true, settings: { receipts: {} } }),
    { receipts: [], findings: [f('error', 'receipts-unavailable', 'no receipts.command in .agents/tokenomics/settings.json')], available: false });
  assert.deepEqual(readReceipts({ repo, manifest: cmdManifest, settings: settingsFor(print(ENVELOPE)) }),
    { receipts: [], findings: [f('unverified', 'receipts-not-run', 'command receipts need --run-receipts or --receipts-file')], available: false });
  assert.deepEqual(readReceipts({ repo, manifest: null }), { receipts: [], findings: [], available: false });
  const file = join(repo, 'r.json');
  writeFileSync(file, JSON.stringify({ ...ENVELOPE, complete: false }));
  assert.deepEqual(readReceipts({ repo, manifest: cmdManifest, receiptsFile: file }),
    { receipts: ENVELOPE.receipts, findings: [f('unverified', 'receipts-incomplete', 'adapter reported complete:false')], available: true });
});

test('readReceipts: the files branch is unchanged', () => {
  const repo = dir();
  const manifest = { receipts: { source: 'files', root: 'rc', file: 'report.json', deliveredOutcomes: [] } };
  assert.deepEqual(readReceipts({ repo, manifest }),
    { receipts: [], findings: [f('unverified', 'receipts-unavailable', 'receipts root not found', join(repo, 'rc'))], available: false });
  mkdirSync(join(repo, 'rc', 'g1'), { recursive: true });
  writeFileSync(join(repo, 'rc', 'g1', 'report.json'), JSON.stringify({ revision: 'r1', cases: [{ id: 'A-1', outcome: 'delivered' }] }));
  assert.deepEqual(readReceipts({ repo, manifest }),
    { receipts: [{ group: 'g1', revision: 'r1', cases: [{ id: 'A-1', outcome: 'delivered' }], source: 'rc/g1/report.json' }], findings: [], available: true });
});

test('runReceiptCommand: complete, partial, failing, malformed and unconfigured results', () => {
  const repo = dir();
  const run = (command) => runReceiptCommand(repo, settingsFor(command), { env: process.env });
  assert.deepEqual(run(print(ENVELOPE)), { available: true, complete: true, receipts: ENVELOPE.receipts, findings: [], reason: null, safeReason: null });
  assert.deepEqual(run(print({ ...ENVELOPE, complete: false })), { available: true, complete: false, receipts: ENVELOPE.receipts,
    findings: [f('unverified', 'receipts-incomplete', 'adapter reported complete:false')], reason: null, safeReason: null });
  assert.deepEqual(run([process.execPath, '-e', 'process.exit(1)']), { available: false, complete: false, receipts: [],
    findings: [f('unverified', 'receipts-unavailable', 'command failed: exit 1')], reason: 'command failed: exit 1', safeReason: 'command failed: exit 1' });
  assert.deepEqual(run(print('{"schema":2,"complete":true,"receipts":[]}')).reason, 'malformed output: $.schema expected const 1');
  assert.equal(run(print('nope')).reason, 'malformed output: $ not JSON');
  // a spawn error: `reason` (and the finding readReceipts reports) keep the error message; `safeReason` names the code only
  const missing = run([join(repo, 'PRIVATE_PERSON', 'no-such-command')]);
  assert.match(missing.reason, /^command failed: .*PRIVATE_PERSON.*ENOENT/);
  assert.equal(missing.findings[0].message, missing.reason);
  assert.equal(missing.safeReason, 'command failed: ENOENT');
  const slow = runReceiptCommand(repo, { receipts: { command: [process.execPath, '-e', 'setTimeout(() => {}, 5000)'], timeoutSec: 0.2 } }, { env: process.env });
  assert.equal(slow.safeReason, 'command failed: ETIMEDOUT');
  assert.equal(readReceipts({ repo, manifest: cmdManifest, runReceipts: true, settings: settingsFor([join(repo, 'PRIVATE_PERSON', 'x')]) }).findings[0].message,
    `command failed: spawnSync ${join(repo, 'PRIVATE_PERSON', 'x')} ENOENT`);
  const none = runReceiptCommand(repo, { receipts: {} }, { env: process.env });
  assert.deepEqual([none.available, none.complete, none.reason, none.safeReason], [false, false, 'not configured', 'not configured']);
  assert.deepEqual(runReceiptCommand(repo, null, {}).reason, 'not configured');
});

test('runReceiptCommand: the given env reaches the command; cwd is the repo; child stderr is never forwarded', () => {
  const repo = dir();
  const js = "process.stderr.write('CHILD-STDERR'); process.stdout.write(JSON.stringify({schema:1,complete:true,receipts:[{group:process.env.RC_MARK,source:process.cwd(),cases:[]}]}))";
  const r = runReceiptCommand(repo, settingsFor([process.execPath, '-e', js]), { env: { PATH: process.env.PATH, RC_MARK: 'env-passed' } });
  assert.equal(r.available, true);
  assert.equal(r.receipts[0].group, 'env-passed');
  assert.equal(r.receipts[0].source.endsWith(repo.split('/').pop()), true);
  assert.doesNotMatch(JSON.stringify(r), /CHILD-STDERR/);
});

test('R16: safeReason names an adapter failure line of the fixed shape; anything else is never shown; readReceipts unchanged', () => {
  const repo = dir();
  const fails = (stderr, code = 2) => [process.execPath, '-e', `process.stderr.write(${JSON.stringify(stderr)}); process.exit(${code})`];
  const r = runReceiptCommand(repo, settingsFor(fails('jira: skipped 1 invalid ids\njira: config (url)\n')), { env: process.env });
  assert.equal(r.safeReason, 'command failed: exit 2 — jira: config (url)');
  assert.equal(r.reason, 'command failed: exit 2');
  assert.deepEqual(r.findings, [f('unverified', 'receipts-unavailable', 'command failed: exit 2')]);
  assert.equal(runReceiptCommand(repo, settingsFor(fails('azure-devops: http (500)\n', 1)), { env: process.env }).safeReason, 'command failed: exit 1 — azure-devops: http (500)');
  // every shipped adapter's real failure lines (codes up to 40 chars) still read
  for (const l of ['jira: auth (set JIRA_EMAIL and JIRA_API_TOKEN)', 'jira: auth (set JIRA_PAT)', 'azure-devops: auth (set AZURE_DEVOPS_EXT_PAT or run az login)', 'github: http (404)', 'github: graphql (errors)']) {
    assert.equal(runReceiptCommand(repo, settingsFor(fails(`${l}\n`)), { env: process.env }).safeReason, `command failed: exit 2 — ${l}`, l);
  }
  for (const bad of ['Error: /home/PRIVATE_PERSON/x failed', 'jira: auth (token=PRIVATE/abc)', 'jira: config (url)\nstack at /PRIVATE_PERSON', 'JIRA: config (url)', `jira: http (${'x'.repeat(41)})`, `x: auth (${'a'.repeat(41)})`, 'custom: auth (abc)', `x: auth (${'a'.repeat(45)})`]) {
    const x = runReceiptCommand(repo, settingsFor(fails(bad)), { env: process.env });
    assert.equal(x.safeReason, 'command failed: exit 2', bad);
  }
  // a signal-killed child: the safe line names the signal; reason (and the finding) stay as they were
  const k = runReceiptCommand(repo, settingsFor([process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')"]), { env: process.env });
  assert.equal(k.safeReason, 'command failed: signal SIGTERM');
  assert.equal(k.reason, 'command failed: exit null');
  // readReceipts output is byte for byte what it was
  const rr = readReceipts({ repo, manifest: cmdManifest, runReceipts: true, settings: settingsFor(fails('jira: config (url)\n')) });
  assert.deepEqual(rr, { receipts: [], findings: [f('unverified', 'receipts-unavailable', 'command failed: exit 2')], available: false });
});
