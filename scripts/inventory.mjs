#!/usr/bin/env node
// B0 inventory (spec §14.3, Plan 2): every domain-coupled site in the reference,
// each assigned to engine-config | ta-extension | retired. The gate fails on any
// unassigned, stale or invalid assignment, and on any engine-side site (every tokenomics/ module
// outside ENGINE_SCAN_SKIP) missing from docs/inventory/engine-allowlist.json or over/under its count.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refDir } from './vendor-reference.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OWNERS = new Set(['engine-config', 'ta-extension', 'retired']);

export const CATEGORIES = [
  ['path-automation', /['"`][^'"`]*automation[^'"`]*['"`]/],
  ['intent-default', /intent\s*(\?\?|\|\||=)\s*['"]automation['"]/],
  ['delivered-vocab', /['"](delivered|defect-found|automated|merged-sanctioned-red)['"]|defect-found|merged-sanctioned-red|not-started|infra-stalled/],
  ['case-id-miner', /extractCaseIds|\[A-Z\]\[A-Z0-9\]|CASE_ID|caseIds?\s*=/],
  // receipts: report.json, workflow return receipts (unit_ids / case_id), the
  // stop gate's receipt lookup, receipt findings, bare-wave-name batch resolve
  ['receipt-reader', /report\.json|loadReceipts|receiptCaseIds|receiptPathFor|_returns|returns\/|\bunit_ids\b|\bcase_id\b|\.findings\b|\.endsWith\(`\/\$\{scope\.batch\}`\)|startsWith\('_'\)/],
  ['gate-records', /gate-runs|gateRuns|GateRuns|gate\??\.verdict|gate\??\.runs|\breceipt\.gate\b|gateDrift|outcomeDrift|crossCheck|declaredOutcomesFor/],
  // stage words in strings, in regex literals (`/\btriage\b|…/`), the stage
  // vocabulary the classifiers use, and the classifier identifiers themselves
  ['stage-words', /(['"`/][^'"`/]*\b(triage|analyst|reviewer|implementer|scout)\b[^'"`/]*['"`/])|\\b(triage|analyst|implement|review|combined|carve|merge)|hardening gate|mini-gate|gate for batch|fix round|report writer|write the report|diagnostician|stabiliz|\b(OVERHEAD_STAGE|FIX_STAGE|STAGE_KIND|STAGE_MARKER|STAGE_HEAD|stageKindOf|stageHead|byStage|fixRounds|isFix|rework)\b|fix-round|\bclassify\(/],
  ['sizing', /\.agents\/estimation|['"]estimation['"]|sizing|story_points|bySize|MIN_CLASS_N/i],
  // quoted wording, or markup text on a line inside a multi-line template literal
  ['qa-wording', /['"`][^'"`]*(delivered \(automated\)|\bcases?\b)[^'"`]*['"`]|<(t[hd]|h[1-6]|p)\b[^>]*>[^<]*\bcases?\b/i],
  // the word batch/batches as rendered wording — never `.batch` / `${batch}`
  // property access, `--batch` flags, `batch-cost`/`batch-report` names or identifiers
  ['group-wording', /['"`][^'"`]*(?<![\w.{]|--)(?!(?<=['"])batch['"])batch(es)?(?![\w}]|-(cost|report|tokenomics)\b)[^'"`]*['"`]|<(t[hd]|h[1-6]|p)\b[^>]*>[^<]*(?<![\w.{]|--)(?!(?<=['"])batch['"])batch(es)?(?![\w}]|-(cost|report|tokenomics)\b)/i],
  ['export-qa', /scenarios_|work_item_level|factory-profile/],
  ['env-var', /TOKENOMICS_[A-Z_]+/],
];

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

export function scanSource(file, text) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    if (isComment(raw)) return;
    const snippet = raw.trim();
    for (const [category, re] of CATEGORIES) {
      if (re.test(raw)) out.push({ id: `${file}:${category}:${sha(snippet)}`, file, line: i + 1, category, snippet: snippet.slice(0, 160) });
    }
  });
  // identical snippets in one file (same category) share one site id — one assignment — but are counted,
  // so a second copy of an allowlisted engine line is an overcount instead of hiding behind the first
  const byId = new Map();
  for (const s of out) { const k = byId.get(s.id); if (k) k.count++; else byId.set(s.id, { ...s, count: 1 }); }
  return [...byId.values()];
}

export function scanReference(refRoot) {
  const sites = [];
  for (const dir of ['hooks', 'scripts']) {
    for (const f of readdirSync(join(refRoot, dir)).sort()) {
      if (!f.endsWith('.mjs') || f.endsWith('.test.mjs')) continue;
      sites.push(...scanSource(`${dir}/${f}`, readFileSync(join(refRoot, dir, f), 'utf8')));
    }
  }
  return sites;
}

export const ENGINE_SCAN_SKIP = new Set(['extensions', 'kit', 'fixtures', 'spec', 'templates', 'references']);
/** Every executable engine module, recursively; skip-listed top-level dirs are TA-owned, contract-tier or data. */
export function scanEngine(root) {
  const sites = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!(rel === '' && ENGINE_SCAN_SKIP.has(e.name)) && e.name !== 'node_modules') walk(join(dir, e.name), r); }
      else if (e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs')) sites.push(...scanSource(r, readFileSync(join(dir, e.name), 'utf8')));
    }
  };
  walk(root, '');
  return sites;
}

export function checkAssignments(sites, assignments) {
  const ids = new Set(sites.map((s) => s.id));
  const unassigned = sites.filter((s) => !assignments[s.id]);
  const stale = Object.keys(assignments).filter((id) => !ids.has(id)).sort();
  const invalid = [];
  for (const [id, a] of Object.entries(assignments)) {
    if (!ids.has(id)) continue;
    if (!OWNERS.has(a?.owner)) invalid.push({ id, problem: `owner must be one of ${[...OWNERS].join(', ')}` });
    else if (typeof a.target !== 'string' || !a.target.trim()) invalid.push({ id, problem: 'target required' });
    else if (a.owner === 'retired' && !a.target.startsWith('retired:')) invalid.push({ id, problem: "retired target must start with 'retired:'" });
  }
  return { unassigned, stale, invalid };
}

// Engine-side leak gate (Plan 2 final review, recursive in Plan 3): the same scanner over every engine
// module (`scanEngine`). Every engine site must be allowlisted with a kind and a reason (not-lifted ids
// recorded in ENGINE-B1.md, env-var reads, extension call sites, known false positives, named residue,
// TA_DEFAULTS literals in engine/config.mjs), and its occurrence count must equal the entry's `count`
// (default 1); a new unlisted site or an extra copy is a TA literal that leaked back — the gate fails.
export const ENGINE_KINDS = new Set(['not-lifted', 'env-var', 'extension-call', 'false-positive', 'residue', 'ta-default']);

export function checkEngineAllowlist(sites, allowlist) {
  const ids = new Set(sites.map((s) => s.id));
  const unlisted = sites.filter((s) => !allowlist[s.id]);
  const stale = Object.keys(allowlist).filter((id) => !ids.has(id)).sort();
  const invalid = [];
  for (const [id, a] of Object.entries(allowlist)) {
    if (!ENGINE_KINDS.has(a?.kind)) invalid.push({ id, problem: `kind must be one of ${[...ENGINE_KINDS].join(', ')}` });
    else if (typeof a.reason !== 'string' || a.reason.trim().length < 40) invalid.push({ id, problem: 'reason (>= 40 chars) required' });
    else if (a.count !== undefined && !(Number.isInteger(a.count) && a.count >= 2)) invalid.push({ id, problem: 'count must be an integer >= 2 when given' });
  }
  const overcount = []; const undercount = [];
  for (const s of sites) {
    const a = allowlist[s.id];
    if (!a) continue;
    const allowed = a.count ?? 1;
    if (s.count > allowed) overcount.push({ id: s.id, count: s.count, allowed });
    else if (s.count < allowed) undercount.push({ id: s.id, count: s.count, allowed });
  }
  return { unlisted, stale, invalid, overcount, undercount };
}

function renderMarkdown(sites, assignments) {
  const by = (o) => sites.filter((s) => assignments[s.id]?.owner === o);
  const row = (s) => `| \`${s.file}:${s.line}\` | ${s.category} | \`${s.snippet.replace(/\|/g, '\\|').slice(0, 90)}\` | ${assignments[s.id]?.target ?? '—'} |`;
  const table = (list) => `| site | category | snippet | target |\n|---|---|---|---|\n${list.map(row).join('\n')}`;
  return `# B0 inventory — reference 49577c7\n\nGenerated by \`node scripts/inventory.mjs --write\`. Sites: ${sites.length}.\n\n## engine-config (${by('engine-config').length})\n\n${table(by('engine-config'))}\n\n## ta-extension (${by('ta-extension').length})\n\n${table(by('ta-extension'))}\n\n## retired (${by('retired').length})\n\n${table(by('retired'))}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sites = scanReference(refDir('49577c7'));
  const dir = join(ROOT, 'docs/inventory');
  mkdirSync(dir, { recursive: true });
  const aPath = join(dir, 'b0-assignments.json');
  const assignments = existsSync(aPath) ? JSON.parse(readFileSync(aPath, 'utf8')) : {};
  if (process.argv.includes('--write')) {
    writeFileSync(join(dir, 'b0-candidates.json'), `${JSON.stringify(sites, null, 2)}\n`);
    writeFileSync(join(dir, 'B0-INVENTORY.md'), renderMarkdown(sites, assignments));
  }
  const r = checkAssignments(sites, assignments);
  process.stderr.write(`sites ${sites.length}, unassigned ${r.unassigned.length}, stale ${r.stale.length}, invalid ${r.invalid.length}\n`);
  const ei = process.argv.indexOf('--engine-root'); // tests point the engine scan at a planted copy
  const engineSites = scanEngine(ei > 0 ? process.argv[ei + 1] : join(ROOT, 'tokenomics'));
  const allowlist = JSON.parse(readFileSync(join(dir, 'engine-allowlist.json'), 'utf8'));
  const e = checkEngineAllowlist(engineSites, allowlist);
  process.stderr.write(`engine sites ${engineSites.length}, unlisted ${e.unlisted.length}, stale ${e.stale.length}, invalid ${e.invalid.length}, overcount ${e.overcount.length}, undercount ${e.undercount.length}\n`);
  for (const s of e.unlisted) process.stderr.write(`  unlisted engine site ${s.id} (${s.file}:${s.line}): ${s.snippet}\n`);
  for (const id of e.stale) process.stderr.write(`  stale allowlist entry ${id}\n`);
  for (const x of e.invalid) process.stderr.write(`  invalid allowlist entry ${x.id}: ${x.problem}\n`);
  for (const x of e.overcount) process.stderr.write(`  overcount engine site ${x.id}: ${x.count} copies, allowlisted ${x.allowed}\n`);
  for (const x of e.undercount) process.stderr.write(`  undercount engine site ${x.id}: ${x.count} copies, allowlisted ${x.allowed}\n`);
  const bad = r.unassigned.length || r.stale.length || r.invalid.length || e.unlisted.length || e.stale.length || e.invalid.length || e.overcount.length || e.undercount.length;
  process.exitCode = bad ? 1 : 0;
}
