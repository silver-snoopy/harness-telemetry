import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validate, loadSchemas } from './schema.mjs';
import { finding } from './findings.mjs';

const MAX_OUT = 20 * 1024 * 1024;

function fromFiles(repo, rc, mode, findings) {
  const root = join(repo, rc.root);
  const out = [];
  if (!existsSync(root)) { findings.push(finding('unverified', 'receipts-unavailable', { file: root }, 'receipts root not found')); return null; }
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === rc.file) {
        let doc = null; try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { /* skipped below */ }
        if (!doc || !Array.isArray(doc.cases)) { findings.push(finding('unverified', 'receipt-malformed', { file: p }, 'receipt file is not JSON or lacks cases[]')); continue; }
        out.push({ group: relative(root, dir).split(sep).join('/'), ...doc,
          ...(mode === 'reference' && !doc.revision ? { revision: new Date(statSync(p).mtimeMs).toISOString() } : {}),
          source: relative(repo, p).split(sep).join('/') });
      }
    }
  };
  walk(root);
  return out;
}

// Parse and validate a §5.6 envelope: `{doc}` or `{reason}` ('malformed output: <path> <msg>').
function parseEnvelope(text, schemas) {
  let doc; try { doc = JSON.parse(text); } catch { doc = null; }
  const errs = doc ? validate(schemas['receipts-envelope.json'], doc, { schemas }) : [{ path: '$', message: 'not JSON' }];
  return errs.length ? { reason: `malformed output: ${errs[0].path} ${errs[0].message}` } : { doc };
}
const incomplete = () => finding('unverified', 'receipts-incomplete', {}, 'adapter reported complete:false');

/**
 * Run `settings.receipts.command` (spec §5.6, Plan 7 D-RECEIPTS) and read its envelope:
 * `{available, complete, receipts, findings, reason, safeReason}`. `complete` is `doc.complete === true`; `reason` is
 * `'not configured'`, `'command failed: exit N'`, `'command failed: <error>'`, `'malformed output: <path> <msg>'`, or
 * null when available. `safeReason` is `reason` with a spawn error named by its code only
 * (`'command failed: ENOENT'`): an error message carries the command path, which reports must not print. Spawned shell-free in `repo` with `env`, `receipts.timeoutSec` (default 60) and the output cap;
 * the child's stderr is never forwarded.
 */
export function runReceiptCommand(repo, settings, { env } = {}) {
  const findings = [];
  const unavailable = (reason, safeReason = reason) => ({ available: false, complete: false, receipts: [], findings, reason, safeReason });
  const cmd = settings?.receipts?.command;
  if (!Array.isArray(cmd) || !cmd.length) {
    findings.push(finding('error', 'receipts-unavailable', {}, 'no receipts.command in .agents/tokenomics/settings.json'));
    return unavailable('not configured');
  }
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: repo, env, encoding: 'utf8', shell: false,
    timeout: (settings.receipts.timeoutSec ?? 60) * 1000, maxBuffer: MAX_OUT });
  if (r.status !== 0 || r.error) {
    const reason = `command failed: ${r.error?.message ?? `exit ${r.status}`}`;
    findings.push(finding('unverified', 'receipts-unavailable', {}, reason));
    return unavailable(reason, r.error ? `command failed: ${r.error.code ?? 'error'}` : reason);
  }
  const { doc, reason } = parseEnvelope(r.stdout, loadSchemas());
  if (reason) { findings.push(finding('unverified', 'receipts-unavailable', {}, reason)); return unavailable(reason); }
  if (!doc.complete) findings.push(incomplete());
  return { available: true, complete: doc.complete === true, receipts: doc.receipts, findings, reason: null, safeReason: null };
}

export function readReceipts({ repo, manifest, mode = 'port', receiptsFile = null, runReceipts = false, settings = null }) {
  const rc = manifest?.receipts;
  const findings = [];
  if (!rc) return { receipts: [], findings, available: false };
  if (rc.source === 'files') {
    const receipts = fromFiles(repo, rc, mode, findings);
    return { receipts: receipts ?? [], findings, available: receipts !== null };
  }
  if (runReceipts && !receiptsFile) {
    const r = runReceiptCommand(repo, settings, { env: process.env });
    return { receipts: r.receipts, findings: r.findings, available: r.available };
  }
  if (!receiptsFile) {
    findings.push(finding('unverified', 'receipts-not-run', {}, 'command receipts need --run-receipts or --receipts-file'));
    return { receipts: [], findings, available: false };
  }
  const { doc, reason } = parseEnvelope(readFileSync(receiptsFile, 'utf8'), loadSchemas());
  if (reason) {
    findings.push(finding('unverified', 'receipts-unavailable', {}, reason));
    return { receipts: [], findings, available: false };
  }
  if (!doc.complete) findings.push(incomplete());
  return { receipts: doc.receipts, findings, available: true };
}
