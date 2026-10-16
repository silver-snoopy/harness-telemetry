import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

export const IMPLIED_MANIFEST = Object.freeze({
  module: 'tokenomics', schema_version: '1.0', domain: 'test-automation', manifestRevision: 1,
  receipts: { source: 'files', root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red'] },
  ratioIntents: ['automation'],
});

const isLedger = (n) => /^usage(-.+)?\.jsonl$/.test(n);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function readLedger(file) {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return raw.split('\n').map((r, i) => ({ raw: r, n: i + 1 })).filter((x) => x.raw.trim())
    .map((x) => { let line = null; try { line = JSON.parse(x.raw); } catch { /* kept raw */ } return { ...x, line }; });
}

function readModule(dir, { implied }) {
  const names = readdirSync(dir).sort();
  const ledgers = names.filter(isLedger).map((n) => ({ file: join(dir, n), lines: readLedger(join(dir, n)) }));
  const sdir = join(dir, 'scopes');
  const scopes = [];
  // A `scopes` that is not a directory is a finding (check.mjs: scopes-not-directory), never a throw (owner Q2, R10).
  const scopesBlocked = existsSync(sdir) && !statSync(sdir).isDirectory();
  if (existsSync(sdir) && !scopesBlocked) {
    const walk = (p) => { for (const e of readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const q = join(p, e.name);
      if (e.isDirectory()) walk(q); else if (e.name.endsWith('.json') && !e.name.startsWith('.')) scopes.push({ file: q, scope: readJson(q) });
    } };
    walk(sdir);
  }
  const manifest = existsSync(join(dir, 'module.json')) ? readJson(join(dir, 'module.json')) : (implied ? IMPLIED_MANIFEST : null);
  return { dir, name: basename(dir), manifest, implied: !existsSync(join(dir, 'module.json')) && implied, ledgers, scopes, scopesBlocked };
}

export function loadTelemetry(root) {
  if (existsSync(join(root, 'module.json'))) return { modules: [readModule(root, { implied: false })], unrecognized: [] };
  if (basename(root) === 'automation') return { modules: [readModule(root, { implied: true })], unrecognized: [] };
  const modules = [];
  const unrecognized = [];
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const d = join(root, e.name);
    if (existsSync(join(d, 'module.json'))) modules.push(readModule(d, { implied: false }));
    else if (e.name === 'automation') modules.push(readModule(d, { implied: true }));
    else {
      // Ledgers in a directory we cannot classify: surface them rather than drop the spend silently.
      const ledgers = readdirSync(d).filter(isLedger).sort();
      if (ledgers.length) unrecognized.push({ dir: d, ledgers });
    }
  }
  if (entries.some((e) => e.isFile() && isLedger(e.name))) {
    const flat = readModule(root, { implied: true }); // flat-era layout (spec §7.1)
    flat.name = '(flat)';
    modules.push(flat);
  }
  return { modules, unrecognized };
}
