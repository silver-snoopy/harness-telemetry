import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadTelemetry } from './load.mjs';
import { loadSchemas, validate } from './schema.mjs';
import { lineFindings } from './invariants.mjs';
import { dedup } from './identity.mjs';
import { finding, exitCode } from './findings.mjs';
import { readReceipts } from './receipts.mjs';
import { HOSTS } from './registry.mjs';

/**
 * Scope ids with records in more than one place — two host directories, or a legacy flat record beside a
 * host-qualified one (spec §14.11: reported as ambiguous, never merged; owner Q12b: also a kit finding).
 */
function ambiguousScopes(m) {
  const sdir = join(m.dir, 'scopes');
  const byId = new Map();
  for (const { file } of m.scopes) {
    const parts = relative(sdir, file).split(sep);
    if (parts.length > 2 || (parts.length === 2 && !Object.hasOwn(HOSTS, parts[0]))) continue;
    const id = parts[parts.length - 1].slice(0, -'.json'.length);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(parts.join('/'));
  }
  const out = [];
  for (const [id, locs] of [...byId].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (locs.length < 2) continue;
    const sorted = [...locs.filter((l) => l.includes('/')).sort(), ...locs.filter((l) => !l.includes('/'))];
    out.push(finding('limitation', 'ambiguous-scope', { file: sdir }, `${id}: records at ${sorted.join(', ')} are never merged`));
  }
  return out;
}

/**
 * Ledger sessions whose only scope record sits under another host's directory: the capture never stamps it on this
 * host's line (spec §14.11 host-qualified; review round 1 I1, O1 — reported, never silent).
 */
function misfiledScopes(m) {
  const sdir = join(m.dir, 'scopes');
  const out = [];
  const seen = new Set();
  const has = (rel) => m.scopes.some((s) => relative(sdir, s.file).split(sep).join('/') === rel);
  for (const lg of m.ledgers) for (const x of lg.lines) {
    const { host, id } = x.line && typeof x.line === 'object' ? x.line : {};
    if (typeof host !== 'string' || typeof id !== 'string' || seen.has(`${host}:${id}`)) continue;
    seen.add(`${host}:${id}`);
    if (has(`${host}/${id}.json`) || has(`${id}.json`)) continue;
    const others = Object.keys(HOSTS).filter((h) => h !== host && has(`${h}/${id}.json`));
    if (others.length === 1) out.push(finding('limitation', 'scope-host-mismatch', { file: lg.file, n: x.n }, `${host}:${id}: the only scope record is ${others[0]}/${id}.json (another host's) — never stamped on this host's line`));
  }
  return out;
}

export const PROFILES = ['core', 'scope', 'receipts'];

export function check(dir, { mode, profiles = ['core'], repo = null, receiptsFile = null, runReceipts = false } = {}) {
  if (!['port', 'reference', 'mixed'].includes(mode)) throw new Error('check: --mode port|reference|mixed is required');
  const badProfiles = profiles.filter((p) => !PROFILES.includes(p));
  if (badProfiles.length) throw new Error(`check: unknown profile ${badProfiles.join(', ')} (known: ${PROFILES.join(', ')})`);
  const schemas = loadSchemas();
  const findings = [];
  const { modules, unrecognized } = loadTelemetry(dir);
  // spec §1.2: ledgers with no module.json are absent evidence, never a silent pass
  for (const u of unrecognized) findings.push(finding('error', 'manifest-missing', { file: u.dir }, 'ledgers without module.json: ' + u.ledgers.join(', ')));
  // spec §1.2: nothing to read is absent evidence, never a silent pass.
  if (modules.length === 0 && unrecognized.length === 0) findings.push(finding('unverified', 'no-ledgers', { file: dir }, 'no telemetry module or ledger found'));
  const entries = [];
  for (const m of modules) {
    if (m.ledgers.length === 0) findings.push(finding('unverified', 'no-ledgers', { file: m.dir }, 'module has no usage ledgers'));
    if (m.scopesBlocked) findings.push(finding('error', 'scopes-not-directory', { file: join(m.dir, 'scopes') }, 'scopes exists but is not a directory — no scope record can be read'));
    if (!m.manifest) findings.push(finding('error', 'manifest-missing', { file: m.dir }, 'module without module.json'));
    else if (!m.implied) for (const e of validate(schemas['module.json'], m.manifest, { schemas })) findings.push(finding('error', 'manifest', { file: join(m.dir, 'module.json') }, `${e.path}: ${e.message}`));
    for (const lg of m.ledgers) for (const x of lg.lines) {
      const where = { file: lg.file, n: x.n };
      if (!x.line) { findings.push(finding('error', 'json-parse', where, 'not JSON')); continue; }
      if (typeof x.line !== 'object' || Array.isArray(x.line)) { findings.push(finding('error', 'json-parse', where, 'not a JSON object')); continue; }
      findings.push(...lineFindings(x.line, where, { mode, schemas }));
      entries.push({ line: x.line, file: lg.file, n: x.n });
    }
    if (profiles.includes('scope')) for (const s of m.scopes) {
      for (const e of validate(schemas['scope.json'], s.scope ?? {}, { schemas })) findings.push(finding(mode === 'reference' ? 'limitation' : 'error', 'scope', { file: s.file }, `${e.path}: ${e.message}`));
    }
    if (profiles.includes('scope')) findings.push(...ambiguousScopes(m), ...misfiledScopes(m));
    if (profiles.includes('receipts') && !repo) {
      findings.push(finding('unverified', 'receipts-not-checked', {}, 'profile receipts needs --repo'));
    } else if (profiles.includes('receipts')) {
      const settingsPath = join(repo, '.agents/tokenomics/settings.json');
      const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
      findings.push(...readReceipts({ repo, manifest: m.manifest, mode, receiptsFile, runReceipts, settings }).findings);
    }
  }
  const { conflicts, ownership } = dedup(entries);
  for (const c of conflicts) findings.push(finding('conflict', 'conflict', { file: c.entries[0].file, n: c.entries[0].n }, `${c.key}: ${c.entries.length} payloads at equal rank`));
  for (const o of ownership) findings.push(finding('limitation', 'ownership', {}, `${o.key}: repos ${o.repos} users ${o.users}`));
  return { findings, exit: exitCode(findings, mode) };
}
