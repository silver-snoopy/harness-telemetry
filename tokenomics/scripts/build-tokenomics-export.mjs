#!/usr/bin/env node
// build-tokenomics-export.mjs — the hyperfactory tokenomics dataset emitter.
//
// Spec: the ai-hyperfactory-tokenomics guide, schema 1.0. A submission is ONE
// role-fabric: { schema_version, segment{…}, runs[…] } — the segment header
// once, then ONE ROW PER WORK-ITEM. Our work-item is the batch (a suite of
// cases, level 'feature'), and rows are the telemetry cohort — reconstructed
// from the pipeline's own cost.json, the precedent the dataset's first real
// submission set (its `T-WI-###` cohort: sessions → work-items, programmatic).
//
//   node build-tokenomics-export.mjs [repo] --batch <slug> [--stdout]   append one row
//   node build-tokenomics-export.mjs [repo] --submission [--anon]       build datasets/<factory-id>/
//   node build-tokenomics-export.mjs --compare <a.cost.json> <b.cost.json> [--repo <root>]  # --repo: that repo's vocabulary
//
// The close sweep calls the append automatically (work-scope.mjs § close), so
// a project with a factory profile accumulates a submission-ready runs.json
// batch by batch — compliance is a side effect of closing, not a chore.
//
// IDENTITY IS PROJECT-LOCAL, NEVER BUNDLED. The segment header comes from a
// hand-authored .agents/telemetry/automation/factory-profile.json (template:
// ../templates/factory-profile.template.json — scout's seeding Step 6.7 copies
// it). The factory ships plumbing only; no organisation identifiers.
//
// DOLLAR HONESTY. Every figure is carried from cost.json (measured values
// only). Fields the pipeline cannot measure are null and named in the §7
// checklist — defaults-and-flags, never silent guessing. The one computed
// convenience is cache_read_share_pct (a COST share, per the spec): derived
// from the token quad at PUBLIC LIST RATIOS (in 1× / out 5× / write 1.25× /
// read 0.1×) and labelled so in notes — canonical re-pricing is central.
//
// STDLIB ONLY. Read-only except the export-dir writes.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSettings, telemetryDir, receiptsRoot, TA_DEFAULTS, words } from '../engine/config.mjs';
import { hook, loadExtension } from '../engine/extension.mjs';
import { updateBatchCosts, loadReceipts } from './batch-cost.mjs';
import { migrationOn } from '../engine/migrations.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { engineRootOf, entryPointsOn, gateCli } from '../engine/activation.mjs';
import { scrubSet, scrubStrings } from '../engine/scrub.mjs';
import { revisionFooter } from './team-report.mjs';
import { stampRevision } from '../engine/manifest.mjs';

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
const round = (v, p = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** p) / 10 ** p : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Public list-price ratios relative to input — Sonnet-class; used ONLY for
// the cache-read COST-share convenience field.
const PRICE_RATIO = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };
export function costWeightedCacheShare(q) {
  if (!q) return null;
  const total = num(q.input) * PRICE_RATIO.input + num(q.output) * PRICE_RATIO.output
    + num(q.cacheWrite) * PRICE_RATIO.cacheWrite + num(q.cacheRead) * PRICE_RATIO.cacheRead;
  return total ? round((num(q.cacheRead) * PRICE_RATIO.cacheRead / total) * 100, 1) : null;
}

// §3.1 spine, Effort row: XS < ½ day · S ~1 day · M 2–3 days · L 4–5 days ·
// XL > 1 sprint. Band edges split the gaps.
export function effortDaysToSize(d) {
  if (d == null || !Number.isFinite(d)) return null;
  return d < 0.5 ? 'XS' : d <= 1.5 ? 'S' : d <= 3.5 ? 'M' : d <= 7.5 ? 'L' : 'XL';
}

const SEGMENT_DOMAIN_KEYS = ['stop', 'owner_group', 'work_item_level', 'factory_type'];
const fromProfile = (profile, keys) => Object.fromEntries(keys.filter((k) => profile[k] != null).map((k) => [k, profile[k]]));

export function buildSegment(profile, cost, ext = null) {
  return {
    factory_id: profile.factory_id ?? null,
    factory_name: profile.factory_name ?? null,
    // The segment's domain identity (stop / owner_group / work_item_level / factory_type): the
    // extension's defaults (TA: the QA factory's), else only what the profile states.
    ...(hook(ext, 'exportRow', cost, { profile, phase: 'segment' }) ?? fromProfile(profile, SEGMENT_DOMAIN_KEYS)),
    ...(profile.factory_domain ? { factory_domain: profile.factory_domain } : {}),
    agent_tool: profile.agent_tool ?? (cost ? cost.sources.hosts.join('+') : null),
    default_method: profile.default_method ?? 'metered',
    scope: profile.scope ?? { includes_subagents: true, includes_retries: true, includes_abandoned_runs: false },
    currency: profile.currency ?? 'USD',
    efficiency_techniques: profile.efficiency_techniques ?? [],
    pipeline: profile.pipeline ?? [],
    ...(profile.submitted_by ? { submitted_by: profile.submitted_by } : {}),
    ...(profile.submitted_date ? { submitted_date: profile.submitted_date } : {}),
  };
}

/** One dataset row: the engine's measured fields, the extension's domain fields (exportRow phases)
 * spliced in at their dataset positions. */
export function buildRunRow(cost, profile = {}, ext = null, settings = TA_DEFAULTS) {
  const t = cost.totals;
  const q = t.tokensSplit ?? null;
  const dom = (phase, extra = {}) => hook(ext, 'exportRow', cost, { profile, settings, phase, ...extra });
  // effort_days comes from the extension (TA: scoping SP); size_tshirt derives from it per the §3.1 spine.
  const effortDays = dom('effort') ?? null;
  const byModel = t.tokensByModel ?? null;
  const primary = byModel
    ? Object.entries(byModel).sort((a, b) => num(b[1].output) - num(a[1].output))[0]?.[0] ?? cost.sources.models[0] ?? null
    : cost.sources.models[0] ?? null;
  const engineNotes = {
    attribution: cost.totals.tokensAttribution ? [`TOKEN ATTRIBUTION ${cost.totals.tokensAttribution.toUpperCase()}: ${cost.totals.unattributedUnits} unit(s) reported no usage — totals are a floor.`] : [],
    cacheShare: 'cache_read_share_pct computed from the token quad at public list ratios (in 1x / out 5x / write 1.25x / read 0.1x).',
    // an unverified receipt delivers nothing (report-windows, B2-05): the row's 0 is disclosed, never read as measured (O1)
    findings: cost.findings?.length ? [`UNVERIFIED RECEIPT: ${cost.findings.join('; ')} — delivered counts read 0.`] : [],
  };
  return {
    // Telemetry-cohort prefix per the dataset's first submission's precedent;
    // a real tracker ref (batch args → report.json work_item_ref) replaces it.
    work_item_ref: cost.workItemRef ?? `T-${cost.batch}`,
    ...(dom('item') ?? fromProfile(profile, ['work_item_level'])),
    maturity: profile.maturity ?? 'pilot',
    ...(effortDays != null ? { size_tshirt: effortDaysToSize(effortDays), effort_days: effortDays } : {}),
    sessions: cost.sources.sessions,
    turns: t.turns ?? null,
    subagent_dispatches: t.dispatches,
    orchestrator_cost_pct: typeof cost.overhead?.lead?.costUsd === 'number' && t.costUsd
      ? round((cost.overhead.lead.costUsd / t.costUsd) * 100, 1)
      : (t.dispatches ? null : 100),
    tokens: q ? { input: q.input, output: q.output, cache_read: q.cacheRead, cache_create: q.cacheWrite } : null,
    primary_model: primary,
    models_used: cost.sources.models,
    ...(byModel ? {
      tokens_by_model: Object.fromEntries(Object.entries(byModel).map(([m, v]) => [m,
        { input: num(v.input), output: num(v.output), cache_read: num(v.cacheRead), cache_create: num(v.cacheWrite) }])),
    } : {}),
    cost_api_equivalent_usd: t.costUsd,
    cache_read_share_pct: costWeightedCacheShare(q),
    ...(dom('scenarios') ?? {}),
    ...(profile.env_setup ? { env_setup: profile.env_setup } : {}),
    ...(dom('size') ?? {}),
    ...(cost.totals.tokensAttribution ? { _tokens_attribution: cost.totals.tokensAttribution } : {}),
    notes: (dom('notes', { engineNotes }) ?? [...engineNotes.attribution, ...engineNotes.findings, engineNotes.cacheShare]).join(' '),
  };
}

// §7 self-validation — defaults-and-flags, never silent. The engine checks the
// fields it measures; the extension's checks over its domain fields (TA: QA
// segment, sizing, scenarios, factory-profile.json) join at their §7 slots.
export function checklist(segment, row, ext = null) {
  const missing = []; const defaulted = [];
  const domain = (slot) => {
    const r = hook(ext, 'exportRow', row, { segment, phase: 'checklist', slot });
    if (r) { missing.push(...(r.missing ?? [])); defaulted.push(...(r.defaulted ?? [])); }
  };
  for (const f of ['factory_id', 'factory_name', 'agent_tool']) if (!segment[f]) missing.push(`segment.${f}`);
  domain('segment');
  for (const f of ['work_item_ref', 'work_item_brief']) if (!row[f]) missing.push(f);
  domain('effort');
  if (!row.size_tshirt) missing.push('size_tshirt (derives from effort_days)');
  domain('profile');
  if (!row.tokens || ['input', 'output', 'cache_read', 'cache_create'].some((k) => row.tokens[k] == null)) missing.push('tokens (4 totals)');
  if (!row.primary_model || !row.models_used?.length) missing.push('primary_model/models_used');
  if (!(row.cost_api_equivalent_usd > 0)) missing.push('cost_api_equivalent_usd > 0');
  if (!(row.cache_read_share_pct >= 0 && row.cache_read_share_pct <= 100)) missing.push('cache_read_share_pct in [0,100]');
  domain('row');
  if ((row.models_used?.length ?? 0) > 1 && !row.tokens_by_model) missing.push('tokens_by_model (required: models_used > 1; re-run close with current capture hooks)');
  if (row._tokens_attribution) missing.push(`tokens attribution '${row._tokens_attribution}' — some dispatches reported no usage (gateway pass-through gap); token totals and cost are a FLOOR, not a bill`);
  return { missing, defaulted };
}

// --- the accumulating dataset -------------------------------------------------
export function exportPath(repo, settings = loadSettings(repo)) { return join(telemetryDir(repo, settings), 'export', 'runs.json'); }

export function appendRun(repo, cost, profile, settings = loadSettings(repo), ext = null) {
  const segment = buildSegment(profile, cost, ext);
  const row = buildRunRow(cost, profile, ext, settings);
  const path = exportPath(repo, settings);
  const doc = (existsSync(path) && safeParse(readFileSync(path, 'utf8'))) || { schema_version: profile.schema_version ?? '1.0', segment, runs: [] };
  doc.schema_version = profile.schema_version ?? doc.schema_version ?? '1.0';
  doc.segment = segment;                         // header always tracks the profile
  // report-revision (spec 14.4, map O6): the export document records the manifest revision it was written under,
  // right after schema_version; a re-append refreshes it. Rows are unchanged (the dataset schema is external).
  if (migrationOn('report-revision')) {
    const { schema_version: sv, manifestRevision: _old, ...rest } = doc;
    for (const k of Object.keys(doc)) delete doc[k];
    Object.assign(doc, { schema_version: sv, manifestRevision: stampRevision(telemetryDir(repo, settings)), ...rest });
  }
  // Upsert by work_item_ref: a re-closed batch REPLACES its row (latest wins),
  // it never duplicates — cost.json is a pure recompute and so is this.
  const i = doc.runs.findIndex((r) => r.work_item_ref === row.work_item_ref);
  const replaced = i !== -1;
  if (replaced) doc.runs[i] = row; else doc.runs.push(row);
  mkdirSync(join(telemetryDir(repo, settings), 'export'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  return { path, row, segment, replaced, checks: checklist(segment, row, ext) };
}

// --- submission folder --------------------------------------------------------
const ANON = 'anonymised';
export { scrubSet, scrubStrings };

/** The engine's own supplied identifiers (O9, independent of any extension): for every group receipt the project
 * holds, its slug (and a nested slug's last segment), its receipt-file, cost.json and group-directory paths. */
export function receiptIdentifiers(repo, settings = TA_DEFAULTS) {
  if (!repo) return [];
  const out = [];
  for (const { slug } of loadReceipts(repo, {}, settings)) {
    const base = `${settings.receipts.root}/${slug}`;
    out.push(slug, slug.split('/').pop(), base, `${base}/${settings.receipts.file}`, `${base}/cost.json`);
    // reports-location: the relocated reports dir and its cost.json (the receipt-tree paths above stay supplied)
    if (settings.reports?.location === 'telemetry') { const rel = `.agents/telemetry/${settings.dir}/reports/${slug}`; out.push(rel, `${rel}/cost.json`); }
  }
  return out;
}

export function anonymizeDoc(doc, ext = null, settings = TA_DEFAULTS, repo = null) {
  const out = JSON.parse(JSON.stringify(doc));
  if (!migrationOn('anon-complete')) {
    out.runs = out.runs.map((r, i) => ({
      ...r,
      work_item_ref: `T-WI-${String(i + 1).padStart(3, '0')}`,
      ...(hook(ext, 'exportRow', r, { phase: 'anonymize' }) ?? {}),
    }));
    return out;
  }
  // The extension scrubs its own domain fields; a `scrub` key in its result lists the identifiers it knows.
  const extra = receiptIdentifiers(repo, settings);
  const rows = out.runs.map((r) => {
    const { scrub, ...domain } = hook(ext, 'exportRow', r, { phase: 'anonymize', settings }) ?? {};
    if (Array.isArray(scrub)) extra.push(...scrub);
    return { ...r, ...domain };
  });
  const set = scrubSet(doc, doc.runs, extra);
  const scrubbed = scrubStrings({ ...out, runs: rows }, set, { keyDepth: 2, keepKeys: ROW_SCHEMA_KEYS });
  scrubbed.runs = scrubbed.runs.map((r, i) => ({ ...r, work_item_ref: `T-WI-${String(i + 1).padStart(3, '0')}` }));
  Object.defineProperty(scrubbed, ANON_SET, { value: set, enumerable: false });
  return scrubbed;
}
const ANON_SET = Symbol('scrub-set');
// The keys buildRunRow writes inside `tokens` and `tokens_by_model.<m>`: dataset schema, never renamed by the key scrub.
const ROW_SCHEMA_KEYS = new Set(['input', 'output', 'cache_read', 'cache_create']);

export function writeSubmission(repo, { anon = false } = {}, settings = loadSettings(repo), ext = null) {
  const path = exportPath(repo, settings);
  const doc = existsSync(path) && safeParse(readFileSync(path, 'utf8'));
  if (!doc?.runs?.length) return { error: `no accumulated runs at ${path} — close a ${words(settings).group} first (or run --batch <slug>)` };
  const finalDoc = anon ? anonymizeDoc(doc, ext, settings, repo) : doc;
  // report-revision: the accumulated document's own field, refreshed (the submission is written now), after schema_version.
  if (migrationOn('report-revision')) {
    const { schema_version: sv, manifestRevision: _old, ...rest } = finalDoc;
    for (const k of Object.keys(finalDoc)) delete finalDoc[k];
    Object.assign(finalDoc, { schema_version: sv, manifestRevision: stampRevision(telemetryDir(repo, settings)), ...rest });
  }
  const id = finalDoc.segment.factory_id ?? 'UNSET-factory-id';
  const dir = join(telemetryDir(repo, settings), 'export', 'datasets', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'runs.json'), `${JSON.stringify(finalDoc, null, 2)}\n`);
  const rows = finalDoc.runs;
  const sum = (f) => rows.reduce((a, r) => a + num(r[f]), 0);
  const tok = rows.reduce((a, r) => { for (const k of ['input', 'output', 'cache_read', 'cache_create']) a[k] += num(r.tokens?.[k]); return a; }, { input: 0, output: 0, cache_read: 0, cache_create: 0 });
  // null-unobservable (O1, B2-06): a row whose cost / tokens / turns is null on the row itself contributes nothing and is
  // counted; an aggregate no row measured is null and renders '—', never a zero. Decided by the row fields (O10).
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const unm = (pred) => rows.filter((r) => !pred(r)).length;
  const nu = migrationOn('null-unobservable') && rows.some((r) => r.cost_api_equivalent_usd == null || r.tokens == null || r.turns == null);
  const unCost = unm((r) => isNum(r.cost_api_equivalent_usd));
  const unTok = unm((r) => r.tokens != null);
  const unTurns = unm((r) => isNum(r.turns));
  const note = (n, word) => (n ? ` (${n} ${word})` : '');
  const costCell = () => {
    if (unCost === rows.length) return `— (${unCost} unpriced)`;
    const t = round(sum('cost_api_equivalent_usd'));
    return `${t == null && migrationOn('report-robustness') ? 'n/a' : `$${t}`}${note(unCost, 'unpriced')}`;
  };
  const tokCell = () => (unTok === rows.length ? `— (${unTok} unmeasured)`
    : `${['input', 'output', 'cache_read', 'cache_create'].map((k) => tok[k].toLocaleString()).join(' / ')}${note(unTok, 'unmeasured')}`);
  const turnsCell = () => (unTurns === rows.length ? `— (${unTurns} unmeasured)` : `${sum('turns')}${note(unTurns, 'unmeasured')}`);
  const allChecks = rows.map((r) => checklist(finalDoc.segment, r, ext));
  const sub = (part) => hook(ext, 'exportRow', finalDoc, { settings, phase: 'submission', part }) ?? [];
  const part = (name, dflt) => hook(ext, 'exportRow', finalDoc, { settings, phase: 'submission', part: name }) ?? dflt;
  // engine default (no extension part): stop / owner_group are the profile's own identity — present values only, never `undefined`
  const sg = finalDoc.segment;
  const { stop, owner_group: owner } = sg;
  const ident = [['Stop', stop], ['owner', owner]].filter(([, v]) => v != null);
  const identLabel = ident.map(([k]) => k).join(' · ');
  const md = [
    `# Submission — ${id}${part('title-suffix', [stop != null ? ` (\`${stop}\` stop)` : '']).join('')}`, '',
    ...sub('intro'),
    '## Factory', '',
    '| | |', '|---|---|',
    `| **Factory** | \`${id}\` |`,
    ...part('identity-row', ident.length ? [`| **${identLabel.charAt(0).toUpperCase()}${identLabel.slice(1)}** | ${ident.map(([, v]) => `\`${v}\``).join(' · ')} |`] : []),
    ...sub('factory-rows'),
    ...(migrationOn('report-robustness') ? [
      // submission-identity (item 20): an incomplete segment shows a dash, never `undefined`; a missing scope or technique list does not throw.
      `| **Agent / tool** | ${sg.agent_tool != null ? `\`${sg.agent_tool}\`` : '—'} |`,
      `| **Method · scope** | ${sg.default_method != null ? `\`${sg.default_method}\`` : '—'} · subagents ${sg.scope?.includes_subagents ? '✓' : '✗'}, retries ${sg.scope?.includes_retries ? '✓' : '✗'}, abandoned ${sg.scope?.includes_abandoned_runs ? '✓' : '✗'} |`,
      `| **Techniques** | ${(Array.isArray(sg.efficiency_techniques) ? sg.efficiency_techniques : []).join(' · ') || '—'} |`,
      `| **Pipeline** | ${Array.isArray(sg.pipeline) ? sg.pipeline.join(' → ') || '—' : (sg.pipeline ?? '—')} |`, '',
    ] : [
    `| **Agent / tool** | \`${finalDoc.segment.agent_tool}\` |`,
    `| **Method · scope** | \`${finalDoc.segment.default_method}\` · subagents ${finalDoc.segment.scope.includes_subagents ? '✓' : '✗'}, retries ${finalDoc.segment.scope.includes_retries ? '✓' : '✗'}, abandoned ${finalDoc.segment.scope.includes_abandoned_runs ? '✓' : '✗'} |`,
    `| **Techniques** | ${finalDoc.segment.efficiency_techniques.join(' · ') || '—'} |`,
    `| **Pipeline** | ${Array.isArray(finalDoc.segment.pipeline) ? finalDoc.segment.pipeline.join(' → ') : finalDoc.segment.pipeline} |`, '',
    ]),
    `## Aggregate summary — ${rows.length} work-item(s)`, '',
    '| Metric | Value |', '|---|---|',
    `| Total cost (API-equivalent) | ${nu ? costCell() : (() => { const t = round(sum('cost_api_equivalent_usd')); return t == null && migrationOn('report-robustness') ? 'n/a' : `$${t}`; })()} |`,
    ...sub('summary-rows'),
    `| Tokens (in / out / cache-read / cache-create) | ${nu ? tokCell() : `${tok.input.toLocaleString()} / ${tok.output.toLocaleString()} / ${tok.cache_read.toLocaleString()} / ${tok.cache_create.toLocaleString()}`} |`,
    `| Sessions / dispatches / turns | ${sum('sessions')} / ${round(sum('subagent_dispatches'))} / ${nu ? turnsCell() : sum('turns')} |`, '',
    '## §7 checklist status', '',
    ...(allChecks.every((c) => !c.missing.length)
      ? ['All rows pass the self-validation checklist.']
      : allChecks.flatMap((c, i) => c.missing.map((m) => `- ❌ row ${i + 1} (\`${rows[i].work_item_ref}\`): ${m}`))),
    '',
    '_Free-form technique/savings notes: fill in what you measured (the guide\'s `measured_savings`) before opening the PR._', '',
  ].join('\n');
  // anon-complete: the same guarantee over submission.md (the generated T-WI-n refs are not identifiers)
  const gen = new Set(rows.map((r) => r.work_item_ref));
  const body = anon && migrationOn('anon-complete') ? scrubStrings(md, (finalDoc[ANON_SET] ?? []).filter((k) => !gen.has(k))) : md;
  // report-revision: the footer follows the scrub, so a supplied identifier can never rewrite the number.
  writeFileSync(join(dir, 'submission.md'), 'manifestRevision' in finalDoc ? `${body}\n${revisionFooter(finalDoc)}\n` : body);
  return { dir, rows: rows.length, anon, incomplete: allChecks.filter((c) => c.missing.length).length };
}

// --- compare: two cost.json files side by side --------------------------------
const fmt = (v, f = (x) => x) => (v == null ? 'n/a' : f(v));
const usd = (v) => fmt(v, (x) => `$${x.toFixed(2)}`);
export function renderCompare(a, b, settings = TA_DEFAULTS, ext = null) {
  const w = words(settings);
  const row = (label, fa, fb) => `| ${label} | ${fa} | ${fb} |`;
  const s4 = (st, f) => (st ? `${f(st.avg)} / ${f(st.median)} / ${f(st.min)}–${f(st.max)}` : 'n/a');
  return [
    `| metric | ${a.batch} | ${b.batch} |`, '|---|---|---|',
    row(`${w.items} / delivered`, `${a.cases.length} / ${a.delivered}`, `${b.cases.length} / ${b.delivered}`),
    row('total cost', usd(a.totals.costUsd), usd(b.totals.costUsd)),
    row('per delivered (incl. overhead)', usd(a.averages.totalPerDelivered?.costUsd), usd(b.averages.totalPerDelivered?.costUsd)),
    row(`avg direct per ${w.item}`, usd(a.averages.directPerCase?.costUsd), usd(b.averages.directPerCase?.costUsd)),
    row('direct cost avg/median/min–max', s4(a.stats.directCostUsd, (x) => `$${x.toFixed(2)}`), s4(b.stats.directCostUsd, (x) => `$${x.toFixed(2)}`)),
    row('overhead share', fmt(a.overhead.sharePct, (x) => `${x}%`), fmt(b.overhead.sharePct, (x) => `${x}%`)),
    row('active hours', fmt(a.totals.activeMin, (x) => (x / 60).toFixed(1)), fmt(b.totals.activeMin, (x) => (x / 60).toFixed(1))),
    ...(hook(ext, 'exportRow', a, { settings, phase: 'compare', other: b, row }) ?? []),
    row('sessions / dispatches', `${a.sources.sessions} / ${a.totals.dispatches}`, `${b.sources.sessions} / ${b.totals.dispatches}`),
  ].join('\n');
}

export function loadProfile(repo, override, settings = loadSettings(repo)) {
  const path = override ?? join(telemetryDir(repo, settings), settings.paths.factoryProfile);
  const profile = existsSync(path) ? (safeParse(readFileSync(path, 'utf8')) ?? {}) : {};
  return { path, profile };
}

function printChecks(checks) {
  for (const m of checks.missing) console.error(`  ❌ MISSING: ${m}`);
  for (const d of checks.defaulted) console.error(`  ⚠️  DEFAULTED: ${d}`);
  if (!checks.missing.length && !checks.defaulted.length) console.error('  ✓ §7 checklist clean');
}

const ENGINE_ROOT = engineRootOf(import.meta.url);

async function main(argv = process.argv.slice(2)) {
  const ci = argv.indexOf('--compare');
  // activation (D-ACT, R19): every mode but the pure two-file --compare writes under .agents/ or the receipts; an
  // inert or refused copy says why, writes nothing and exits 1 (before the settings load, which would throw the refusal)
  {
    const ri = argv.indexOf('--repo');
    const gateRepo = resolve(ci !== -1 ? (ri !== -1 ? argv[ri + 1] ?? '.' : process.cwd())
      : argv.find((a, i) => !a.startsWith('--') && !['--batch', '--profile'].includes(argv[i - 1])) ?? process.cwd());
    if (!gateCli(ENGINE_ROOT, gateRepo, { writes: ci === -1 })) return 1;
  }
  if (ci !== -1) {
    const a = safeParse(readFileSync(argv[ci + 1], 'utf8')); const b = safeParse(readFileSync(argv[ci + 2], 'utf8'));
    if (!a || !b) { console.error('compare: could not parse the two cost.json files'); return 1; }
    // A pure two-file compare: labels use TA vocabulary unless --repo names a repo whose settings to use.
    const ri = argv.indexOf('--repo');
    const cr = ri !== -1 ? resolve(argv[ri + 1]) : null;
    const cs = cr ? loadSettings(cr) : TA_DEFAULTS;
    process.stdout.write(`${renderCompare(a, b, cs, await loadExtension(cs, cr))}\n`);
    return 0;
  }
  const val = (name) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : undefined; };
  const repo = resolve(argv.find((a, i) => !a.startsWith('--') && !['--batch', '--profile'].includes(argv[i - 1])) ?? process.cwd());
  const settings = loadSettings(repo);
  const ext = await loadExtension(settings, repo);
  const { path: profilePath, profile } = loadProfile(repo, val('--profile'), settings);
  if (!profile.factory_id) console.error(`export: no factory profile at ${profilePath} — identity fields will be null${hook(ext, 'exportRow', null, { settings, phase: 'no-profile' }) ?? ''}`);
  if (argv.includes('--submission')) {
    const res = writeSubmission(repo, { anon: argv.includes('--anon') }, settings, ext);
    if (res.error) { console.error(`export: ${res.error}`); return 1; }
    console.error(`export: submission folder at ${res.dir} (${res.rows} row(s)${res.anon ? ', anonymised' : ''}${res.incomplete ? `, ${res.incomplete} row(s) still fail §7 — see submission.md` : ''})`);
    return 0;
  }
  const batch = val('--batch');
  if (!batch) { console.error('usage: build-tokenomics-export.mjs [repo] --batch <slug> [--profile <path>] [--stdout] | --submission [--anon] | --compare <a> <b>'); return 1; }
  const [cost] = updateBatchCosts(repo, { batch, write: true }, settings, ext);
  if (!cost) { console.error(`export: no receipt for ${words(settings).group} '${batch}' under ${receiptsRoot(repo, settings)}`); return 1; }
  const res = appendRun(repo, cost, profile, settings, ext);
  console.error(`export: ${res.replaced ? 'replaced' : 'appended'} row '${res.row.work_item_ref}' in ${res.path}`);
  printChecks(res.checks);
  if (argv.includes('--stdout')) process.stdout.write(`${JSON.stringify(res.row, null, 2)}\n`);
  return 0;
}
const entryOn = entryPointsOn(ENGINE_ROOT); // items 12/13: realpath main guard, exit after stdio drains
if (entryOn ? isMain(import.meta.url) : (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const code = await main();
  if (entryOn) await exitAfterDrain(code); else process.exit(code);
}
