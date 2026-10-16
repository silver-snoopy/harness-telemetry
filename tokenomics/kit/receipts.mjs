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

export function readReceipts({ repo, manifest, mode = 'port', receiptsFile = null, runReceipts = false, settings = null }) {
  const rc = manifest?.receipts;
  const findings = [];
  if (!rc) return { receipts: [], findings, available: false };
  if (rc.source === 'files') {
    const receipts = fromFiles(repo, rc, mode, findings);
    return { receipts: receipts ?? [], findings, available: receipts !== null };
  }
  const schemas = loadSchemas();
  let text = null;
  if (receiptsFile) text = readFileSync(receiptsFile, 'utf8');
  else if (runReceipts) {
    const cmd = settings?.receipts?.command;
    if (!Array.isArray(cmd) || !cmd.length) {
      findings.push(finding('error', 'receipts-unavailable', {}, 'no receipts.command in .agents/tokenomics/settings.json'));
      return { receipts: [], findings, available: false };
    }
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: repo, encoding: 'utf8', shell: false,
      timeout: (settings.receipts.timeoutSec ?? 60) * 1000, maxBuffer: MAX_OUT });
    if (r.status !== 0 || r.error) {
      findings.push(finding('unverified', 'receipts-unavailable', {}, `command failed: ${r.error?.message ?? `exit ${r.status}`}`));
      return { receipts: [], findings, available: false };
    }
    text = r.stdout;
  } else {
    findings.push(finding('unverified', 'receipts-not-run', {}, 'command receipts need --run-receipts or --receipts-file'));
    return { receipts: [], findings, available: false };
  }
  let doc; try { doc = JSON.parse(text); } catch { doc = null; }
  const errs = doc ? validate(schemas['receipts-envelope.json'], doc, { schemas }) : [{ path: '$', message: 'not JSON' }];
  if (errs.length) {
    findings.push(finding('unverified', 'receipts-unavailable', {}, `malformed output: ${errs[0].path} ${errs[0].message}`));
    return { receipts: [], findings, available: false };
  }
  if (!doc.complete) findings.push(finding('unverified', 'receipts-incomplete', {}, 'adapter reported complete:false'));
  return { receipts: doc.receipts, findings, available: true };
}
