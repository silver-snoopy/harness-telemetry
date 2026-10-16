// The test-automation (TA) extension (spec §14.3): every behaviour the B0
// inventory assigned `ta-extension`, moved verbatim out of the engine
// (reference 49577c7) behind the seven hooks. Each hook takes (input, ctx),
// ctx = { repo, settings, phase?, … }; a `phase` selects which of the hook's
// reference sites a call serves (ENGINE-B1.md "Extension API" lists them all).
// Paths derive from ctx.settings — never a hard-coded copy of the TA layout.
// STDLIB ONLY.
import { readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { words, telemetryDir, receiptsRoot, TA_DEFAULTS } from '../engine/config.mjs';
import { migrationOn } from '../engine/migrations.mjs';
import { byName } from '../engine/order.mjs';
import { scrubStrings } from '../engine/scrub.mjs';

/** Extension API 2 (frozen, D3): the engine rejects any other value. */
export const extensionApi = 2;

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// --- classifyDispatch: the TA stage classifier (batch-cost join + its renders) ---
// Batch-level stages: work that serves the WHOLE batch. Everything else that
// names a case id is that case's own work (analyst/combined/implement/review/
// fix/carve/merge are all per-unit stages in the pipeline).
const OVERHEAD_STAGE = /\btriage\b|hardening gate|mini-gate|gate for batch|^gate[:\s]|report writer|write the report|^report[:\s]|diagnostician|stabiliz\w+ (?:diagnos|round)/i;
const FIX_STAGE = /^fix[:\s]|fix round/i;
/**
 * Stage words are matched against the label's HEAD, never the whole thing.
 * `deriveLabel` slices from the dispatch's own stage marker, so its stage is
 * always at the front — while the rest of the text routinely MENTIONS other
 * stages. Field case: every reviewer prompt says "(do not execute the spec;
 * the hardening gate does that)", so matching anywhere booked all six
 * reviewers as gate overhead — $4.31 taken off the cases and added to the
 * gate, in a real batch report.
 */
const STAGE_HEAD = 48;
const stageHead = (label) => String(label || '').slice(0, STAGE_HEAD);

// Overhead stage kinds — the split a lead actually asks about ("what did the
// gate cost"). `other` catches unnamed stage work.
const STAGE_KIND = [
  ['triage', /\btriage\b/i],
  ['gate', /hardening gate|mini-gate|gate for batch|^gate[:\s]/i],
  ['report', /report writer|write the report|^report[:\s]/i],
];
const stageKindOf = (label) => (STAGE_KIND.find(([, re]) => re.test(stageHead(label)))?.[0] ?? 'other');
/** Per-group classifier state (the byStage split + the rework bill), kept on the engine's `ctx.acc`. */
const stageState = ({ acc, emptyBucket }) => {
  acc.byStage ??= { triage: emptyBucket(), gate: emptyBucket(), report: emptyBucket(), other: emptyBucket() };
  acc.rework ??= emptyBucket();
  return acc;
};

/**
 * label → 'direct' | the overhead stage name (spec §14.3). Phases:
 *   (none)        label → 'direct' or its overhead stage kind (triage/gate/report/other)
 *   'stage-names' → the named overhead stages, for the engine's overhead wording
 *   'case-init'   → extra per-case bucket fields ({ fixRounds })
 *   'direct'      a direct dispatch landed on ctx.rows (share ctx.share): rework + fix rounds
 *   'overhead'    an overhead dispatch: its byStage bucket
 *   'case-out'    input = a case bucket → fields for the case's `direct` row
 *   'overhead-out' → { byStage } for cost.overhead;  'group-out' → { rework } for cost
 *   'render-md' / 'render-html' / 'render-tok-md' / 'render-tok-html'  (ctx.part) → report fragments
 */
export function classifyDispatch(label, ctx = {}) {
  const { phase } = ctx;
  if (!phase) return OVERHEAD_STAGE.test(stageHead(label)) ? stageKindOf(label) : 'direct';
  if (phase === 'stage-names') return ['triage', 'gate', 'report'];
  if (phase === 'case-init') return { fixRounds: 0 };
  if (phase === 'direct') {
    const { rework } = stageState(ctx);
    const isFix = FIX_STAGE.test(stageHead(label));
    if (isFix) ctx.addTo(rework, ctx.m, ctx.w);
    for (const row of ctx.rows) if (isFix) row.fixRounds += ctx.share;
    return undefined;
  }
  if (phase === 'overhead') { ctx.addTo(stageState(ctx).byStage[stageKindOf(label)], ctx.m, ctx.w); return undefined; }
  if (phase === 'case-out') return { fixRounds: Math.round(label.fixRounds * 100) / 100 };
  if (phase === 'overhead-out') {
    const { byStage } = stageState(ctx);
    return { byStage: Object.fromEntries(Object.entries(byStage).filter(([, b]) => b.dispatches > 0).map(([k, b]) => [k, ctx.bucketOut(b)])) };
  }
  if (phase === 'group-out') {
    const { rework } = stageState(ctx);
    const vocab = words(ctx.settings);
    return rework.dispatches > 0 ? {
      rework: { ...ctx.bucketOut(rework), note: `fix-round dispatches — the ${vocab.group}'s rework bill (already inside per-${vocab.item} direct; shown here as its own lever)` },
    } : {};
  }
  return renderClassified(label, ctx);
}

// Minutes of a cost.json bucket. With the engine's null-unobservable migration (B2 item 4, O1) a bucket carries
// `unmeasured` counts and a sum no measured value reached is null: '—' plus "n unmeasured", never `null`.
// Without the field the text is the reference's `${activeMin}m`. With the engine's active-minutes migration (B2 item 7)
// a stage / rework bucket's minutes are not allocated at dispatch grain: null with no count, rendered '—'.
const minsText = (b) => {
  const n = b?.unmeasured?.activeMin;
  if (!b?.unmeasured) return b?.activeMin === null ? '—' : `${b?.activeMin}m`;
  return `${b.activeMin == null ? '—' : `${b.activeMin}m`}${n ? ` (${n} unmeasured)` : ''}`;   // the engine's count format
};

/** Report fragments for the classifier's output (fix rounds, byStage, rework); input = the cost.json object. */
function renderClassified(c, { phase, part, settings, usd, statCell, esc, fmtInt, rowFor, row }) {
  const w = words(settings);
  if (phase === 'render-md') {
    if (part === 'what') return `fix rounds: ${c.cases.reduce((n, x) => n + x.direct.fixRounds, 0)}`;
    if (part === 'cost') {
      const out = [];
      const bs = c.overhead.byStage;
      if (bs && Object.keys(bs).length) out.push(`  - by stage: lead ${usd(c.overhead.lead.costUsd)}${Object.entries(bs).map(([k, b]) => ` · ${k} ${usd(b.costUsd)} (${minsText(b)})`).join('')}`);
      if (c.rework) out.push(`- Rework (fix rounds — already inside per-${w.item} direct): ${usd(c.rework.costUsd)}  ·  ${c.rework.dispatches} dispatch(es)  ·  ${minsText(c.rework)}`);
      return out;
    }
    if (part === 'case-head') return ['fix rounds'];
    if (part === 'case-cells') return [`${c.direct.fixRounds}`];   // input = the case row
  }
  if (phase === 'render-html') {
    if (part === 'case') return c.direct.fixRounds ? `${c.direct.fixRounds} fix` : 'no fix';   // input = the case row
    if (part === 'delivery-cells') return [statCell('Fix rounds', fmtInt(c.cases.reduce((n, x) => n + x.direct.fixRounds, 0)))];
    if (part === 'cost-cell') return c.rework ? statCell('Rework', usd(c.rework.costUsd)) : undefined;
    if (part === 'cost-callout') return c.overhead.byStage && Object.keys(c.overhead.byStage).length ? `by stage: lead ${usd(c.overhead.lead.costUsd)}${Object.entries(c.overhead.byStage).map(([k, b]) => ` · ${esc(k)} ${usd(b.costUsd)}`).join('')}` : null;
  }
  // B2 null-unobservable: a stage whose tokens are all unmeasured (tok null, unmeasured.tokens > 0) stays listed
  const stages = Object.entries(c.overhead?.byStage ?? {}).filter(([, b]) => b.tok || b.unmeasured?.tokens);
  if (phase === 'render-tok-md' && stages.length) {
    const out = ['## By stage (overhead)', '', '| stage | cost | real work | cache write | cache read | hit rate |', '|---|---|---|---|---|---|'];
    for (const [k, b] of stages) out.push(rowFor(k, b));
    out.push('');
    return out;
  }
  if (phase === 'render-tok-html') return stages.length ? `<section class="panel"><h2>By stage (overhead)</h2>${stages.map(([k, b]) => row(k, b)).join('')}</section>` : '';
  return undefined;
}

// --- labelFrom: dispatch label windows (capture) ------------------------------
// Task-tool dispatches have a real `description`. Workflow-tool sub-agents get
// no description (meta carries only agentType) and their first user message
// opens with a shared boilerplate preamble — so slice from the first stage
// marker instead, which is where the ids live ("analyst:", "Implementer slot —
// fix round 2 for TC-101…", "Hardening gate for batch …").
const STAGE_MARKER = /\b(triage|analyst|implement\w*|combined|review\w*|fix round|carve|merge|hardening gate|mini-gate|gate for batch|report writer|write the report|diagnostician|stabiliz\w+)\b/i;
/** Raw dispatch input { description, firstText } → label string (spec §14.3). */
export function labelFrom({ description, firstText } = {}) {
  const d = String(description || '').trim();
  if (d) return d.slice(0, 160);
  const t = String(firstText || '');
  const m = STAGE_MARKER.exec(t);
  if (m) return t.slice(m.index, m.index + 160).replace(/\s+/g, ' ').trim();
  return t.slice(0, 160).replace(/\s+/g, ' ').trim();
}

// --- receiptIds: workflow return receipts (capture) ---------------------------
// The workflow-return hook persists every workflow agent's STRUCTURED return
// to .agents/telemetry/automation/returns/<runId>/<agentId>.json (legacy
// .agents/automation/_returns/). The batch workflow's worker schemas echo the
// unit's case ids (`unit_ids`; analyst-shaped returns carry cases[].case_id,
// triage units[].ids) — a parameter ROUND-TRIP from the workflow args, so
// attribution reads them first and falls back to scope-gated prompt mining
// only where no receipt exists (hand dispatches, other hosts, a stop the
// return hook missed, or the return hook racing this one on the same event).
/** dispatch { id } → its receipt's structured ids, or null (spec §14.3). */
export function receiptIds({ id: agentId } = {}, { repo, settings = TA_DEFAULTS, fs = { readdirSync } } = {}) {
  if (!agentId) return null;
  const bases = [
    join(telemetryDir(repo, settings), 'returns'),
    join(receiptsRoot(repo, settings), '_returns'),
  ];
  for (const base of bases) {
    let runs; try { runs = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    // capture-robustness (item 14): search run directories in sorted order, not the listing's
    if (migrationOn('capture-robustness')) runs = [...runs].sort(byName);
    for (const r of runs) {
      if (!r.isDirectory()) continue;
      const f = join(base, r.name, `${agentId}.json`);
      if (!existsSync(f)) continue;
      let j; try { j = safeParse(readFileSync(f, 'utf8')); } catch { return null; }
      const res = j?.result;
      if (!res || typeof res !== 'object') return null;
      const ids = Array.isArray(res.unit_ids) ? res.unit_ids
        : Array.isArray(res.cases) ? res.cases.map((c) => c?.case_id).filter(Boolean)
          : Array.isArray(res.units) ? res.units.flatMap((u) => (Array.isArray(u?.ids) ? u.ids : []))
            : null;
      if (!ids || !ids.length) return null;
      return [...new Set(ids.map(String))].sort();
    }
  }
  return null;
}

// --- enrichGroup: gate records + reconciliation, findings, predicted size -----
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// records (script gate verdicts + declared session outcomes)
/**
 * gate-case.mjs appends one line per verdict — chronological by construction.
 * Two locations: the batch dir (legacy + post-fold home) and the telemetry
 * write-side (`telemetry/gate-runs/<slug>.jsonl`, where mid-run appends land
 * so they never dirty the main tree). Read both, dedup exact lines (a fold
 * copies, it doesn't move atomically), keep chronological order by `at`.
 */
function loadGateRuns(dir, { repo = null, slug = null, settings = TA_DEFAULTS } = {}) {
  const files = [dir && join(dir, 'gate-runs.jsonl')];
  if (repo && slug) files.push(join(telemetryDir(repo, settings), 'gate-runs', `${slug}.jsonl`));
  const seen = new Set();
  const out = [];
  for (const p of files) {
    if (!p || !existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
      if (seen.has(line)) continue;
      seen.add(line);
      const rec = safeParse(line);
      if (rec) out.push(rec);
    }
  }
  return out.sort((a, z) => String(a.at ?? '').localeCompare(String(z.at ?? '')));
}

/** Latest declared outcome per receipt case id, across the batch's scopes. */
function declaredOutcomesFor(receipt, slug, scopes) {
  const ids = new Set((receipt.cases ?? []).map((c) => c.id).filter(Boolean));
  const names = new Set([receipt.batch, slug, String(slug).split('/').pop()].filter(Boolean).map((s) => s.toLowerCase()));
  const matching = scopes
    .filter((s) => (s.batch && names.has(String(s.batch).toLowerCase())) || (s.cases ?? []).some((id) => ids.has(id)))
    .sort((a, z) => String(a.updatedAt ?? '').localeCompare(String(z.updatedAt ?? '')));
  const out = {};
  for (const s of matching) {
    for (const [id, o] of Object.entries(s.outcomes ?? {})) {
      if (ids.has(id)) out[id] = o?.outcome ?? o; // latest updatedAt wins
    }
  }
  return out;
}

/**
 * The receipt vs the records. Drift is THE signal the write-back failure class
 * produces: a gate re-run green whose verdict never reached report.json
 * (measured: 38/69 delivered cases scored unproven), or a session that
 * declared a case automated while the receipt still says blocked/not-run.
 * The records never overwrite the receipt — they make the gap visible.
 */
function crossCheck(receipt, gateRuns, declared) {
  const latest = gateRuns.length ? gateRuns[gateRuns.length - 1] : null;
  const receiptVerdict = receipt.gate?.verdict ?? null;
  const gateDrift = latest && latest.verdict !== receiptVerdict
    ? { receipt: receiptVerdict, recorded: latest.verdict, at: latest.at ?? null }
    : null;
  const outcomeDrift = [];
  for (const c of receipt.cases ?? []) {
    const d = declared[c.id];
    if (d && d !== (c.outcome ?? null)) outcomeDrift.push({ id: c.id, receipt: c.outcome ?? null, declared: d });
  }
  return { gateDrift, outcomeDrift };
}

// sizing join (automation-scoping)
// PRE-RUN predicted size (score-cases.mjs --json under .agents/estimation/)
// joined to POST-RUN actuals, so a case can be judged against the cross-batch
// history OF ITS OWN SIZE CLASS. Deviations are computed on TOKENS and TIME,
// never on per-case dollars — the scoping skill's own validation (89 blind
// cases) measured ~zero rank correlation for per-case $ (Spearman 0.015); a
// flag here is an ANALYSIS POINTER (estimate drift? execution smell? mis-sized
// case?), not a verdict, and it doubles as calibration health: size classes
// whose histories don't separate are Mode 4 material.
function loadSizings(repo) {
  const out = new Map();
  const dir = join(repo, '.agents', 'estimation');
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const j = safeParse(readFileSync(join(dir, e.name), 'utf8'));
    const rows = Array.isArray(j?.cases) ? j.cases : Array.isArray(j) ? j : null;
    if (!rows) continue;
    for (const r of rows) {
      const id = r?.id ?? r?.case_id;
      const size = typeof r?.size === 'string' ? r.size : r?.size?.size;
      if (!id || !size) continue;
      // Later files win (a re-scored scope supersedes) — Map.set overwrites.
      out.set(String(id), {
        size: String(size),
        sp: num(r.sp ?? r.size?.sp) || null,
        estMin: num(r.estimated_active_minutes ?? r.est_min) || null,
        src: e.name,
      });
    }
  }
  return out;
}

const percentileOf = (sorted, v) => (sorted.length ? Math.round((100 * sorted.filter((x) => x <= v).length) / sorted.length) : null);
const pctVal = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

/** Cross-batch actuals per size class: sorted real-work-token and active-min arrays. */
function sizeBaselines(repo, { excludeSlug = null } = {}, settings = TA_DEFAULTS) {
  const buckets = {};
  // A group's cost.json is read from its reports dir first (reports-location: .agents/telemetry/<dir>/reports/<slug>),
  // then the receipt tree, so relocated and tree-era files are both seen and a group counts once.
  const seen = new Set();
  const walk = (d, rel) => {
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && e.name !== 'telemetry') walk(full, [...rel, e.name]);
      else if (e.name === 'cost.json') {
        const key = rel.join('/');
        if (seen.has(key)) continue;
        seen.add(key);
        const c = safeParse(readFileSync(full, 'utf8'));
        if (!c?.cases || (excludeSlug && c.batch === excludeSlug)) continue;
        for (const x of c.cases) {
          const size = x?.sizing?.size;
          if (!size || !x.direct) continue;
          const rw = x.direct.tok ? num(x.direct.tok.input) + num(x.direct.tok.output) : null;
          const b = (buckets[size] ??= { tok: [], min: [] });
          if (rw != null && rw > 0) b.tok.push(rw);
          if (num(x.direct.activeMin) > 0) b.min.push(num(x.direct.activeMin));
        }
      }
    }
  };
  if (settings.reports?.location === 'telemetry') walk(join(telemetryDir(repo, settings), 'reports'), []);
  walk(receiptsRoot(repo, settings), []);
  for (const b of Object.values(buckets)) { b.tok.sort((a, z) => a - z); b.min.sort((a, z) => a - z); }
  return buckets;
}

const MIN_CLASS_N = 5;   // below this, history can't support a percentile verdict

/** Pure enrichment: stamps cases[].sizing and returns the batch-level rollup (or null). */
function applySizing(casesOut, sizings, baselines) {
  if (!sizings?.size) return null;
  const bySize = {};
  const flagged = [];
  let sized = 0;
  for (const c of casesOut) {
    const s = sizings.get(c.id);
    if (!s) continue;
    sized++;
    const rw = c.direct.tok ? num(c.direct.tok.input) + num(c.direct.tok.output) : null;
    // active-minutes: a null direct minute without an unmeasured count is not allocated at this grain — no per-case
    // actual (no percentile, hiMin cannot fire). The batch-grain actual then sums the row's loaded minutes (group
    // time ÷ items, a labelled allocation); an unmeasured loaded minute stays unmeasured, never 0.
    const sessionGrain = c.direct.activeMin === null && !c.direct.unmeasured?.activeMin;
    const min = sessionGrain ? null : num(c.direct.activeMin);
    const actual = sessionGrain ? (c.loaded?.activeMin ?? null) : min;
    const dev = { size: s.size, sp: s.sp, estMin: s.estMin, src: s.src };
    const hist = baselines?.[s.size];
    const n = Math.min(hist?.tok.length ?? 0, hist?.min.length ?? 0) || Math.max(hist?.tok.length ?? 0, hist?.min.length ?? 0);
    if (hist && n >= MIN_CLASS_N) {
      const medTok = pctVal(hist.tok, 50); const p90Tok = pctVal(hist.tok, 90);
      const medMin = pctVal(hist.min, 50); const p90Min = pctVal(hist.min, 90);
      dev.baseline = { n, medianTok: medTok, p90Tok, medianMin: medMin, p90Min };
      if (rw != null) dev.tokPercentile = percentileOf(hist.tok, rw);
      if (min > 0) dev.minPercentile = percentileOf(hist.min, min);
      const hiTok = rw != null && medTok && rw >= p90Tok && rw >= 1.5 * medTok;
      const hiMin = min > 0 && medMin && min >= p90Min && min >= 1.5 * medMin;
      const loTok = rw != null && medTok && rw <= pctVal(hist.tok, 10) && rw <= 0.5 * medTok;
      if (hiTok || hiMin) dev.flag = 'above-p90';
      else if (loTok) dev.flag = 'below-p10';
      if (dev.flag) {
        flagged.push({
          id: c.id, size: s.size, flag: dev.flag,
          detail: dev.flag === 'above-p90'
            ? `real-work ${rw?.toLocaleString?.() ?? rw} tok (p${dev.tokPercentile ?? '—'})${min == null ? '' : ` / ${min}m (p${dev.minPercentile ?? '—'})`} vs ${s.size}-class median ${medTok?.toLocaleString?.() ?? medTok} tok${min == null ? '' : ` / ${medMin}m`} — review: estimate drift, execution smell, or a mis-sized case`
            : `real-work ${rw?.toLocaleString?.() ?? rw} tok ≤ p10 of ${s.size}-class — suspiciously cheap: verify coverage was not shortcut`,
        });
      }
    } else {
      dev.note = `insufficient ${s.size}-class history (n=${n ?? 0} < ${MIN_CLASS_N}) — no deviation verdict`;
    }
    c.sizing = dev;
    const agg = (bySize[s.size] ??= { cases: 0, sp: 0, estMin: 0, actualMin: 0, actualTok: 0 });
    agg.cases++; agg.sp += num(s.sp); agg.estMin += num(s.estMin); agg.actualMin = agg.actualMin == null || actual == null ? null : agg.actualMin + actual; agg.actualTok += num(rw);
    if (sessionGrain) {
      agg.actualMinBasis = 'allocated';
      if (actual == null && c.loaded?.unmeasured?.activeMin) agg.actualMinUnmeasured = (agg.actualMinUnmeasured ?? 0) + 1;
    }
  }
  if (!sized) return null;
  const estTotal = Object.values(bySize).reduce((a, b) => a + b.estMin, 0);
  // an unmeasured (null) actual leaves the batch-grain comparison out rather than under-counting it
  const actTotal = Object.values(bySize).some((b) => b.actualMin == null) ? 0 : Object.values(bySize).reduce((a, b) => a + b.actualMin, 0);
  const allocated = Object.values(bySize).some((b) => b.actualMinBasis === 'allocated');
  return {
    note: 'pre-run predicted size (automation-scoping) joined to actuals. Deviations are tokens/time vs the size-class CROSS-BATCH history — analysis pointers, never per-case dollar verdicts (scoping doctrine: per-case $ rank-correlates ~zero with actuals; only batch totals are quotable). Flags feed Mode 4 calibration.',
    sized, bySize,
    ...(estTotal && actTotal ? { estVsActualMin: { est: Math.round(estTotal), actual: Math.round(actTotal), ratio: Math.round((actTotal / estTotal) * 100) / 100, ...(allocated ? { basis: 'allocated' } : {}) } } : {}),
    flagged,
  };
}

/**
 * group cost → extra fields (spec §14.3). Phases (input → output):
 *   'case'     receipt case → fields of its cost row ({ findings })
 *   'records'  receipt (ctx.slug/dir/scopes) → { gate, records? } — gate runs, declared outcomes, drift
 *   'sizing'   the cost rows (stamped in place) (ctx.slug) → { sizing? } — predicted size vs history
 *   'match'    a group's cost (ctx.scope) → does it serve the scope's declared batch?
 *   'by-group' a group's cost → team-report byBatch fields ({ gate, drift })
 *   'delivered-note' { outcomes } → the delivered-outcome prose inside cost.json's totalPerDelivered note
 *   'render-md' / 'render-html' / 'render-tok-md' (ctx.part) → report fragments
 */
export function enrichGroup(group, ctx = {}) {
  if (ctx.phase === 'delivered-note') return 'delivered/defect-found; legacy automated/merged-sanctioned-red';
  const { repo = null, settings = TA_DEFAULTS, phase } = ctx;
  if (phase === 'case') {
    const c = group;
    return { findings: Array.isArray(c.findings) ? c.findings.length : 0 };
  }
  if (phase === 'records') {
    const receipt = group;
    const { slug, dir = null, scopes = [] } = ctx;
    // Records vs receipt: script-authored gate verdicts + declared outcomes.
    const gateRuns = loadGateRuns(dir, { repo, slug, settings });
    const declared = declaredOutcomesFor(receipt, slug, scopes);
    const { gateDrift, outcomeDrift } = crossCheck(receipt, gateRuns, declared);
    const latestGate = gateRuns.length ? gateRuns[gateRuns.length - 1] : null;
    return {
      gate: receipt.gate ?? null,
      ...(gateRuns.length || Object.keys(declared).length ? {
        records: {
          note: 'script-authored gate verdicts (gate-runs.jsonl) + declared session outcomes (work-scope) vs the receipt — drift means report.json needs a write-back, records never overwrite it',
          ...(latestGate ? { gateRuns: { count: gateRuns.length, latest: { verdict: latestGate.verdict, at: latestGate.at ?? null, consecutiveGreen: latestGate.consecutiveGreen ?? 0 } } } : {}),
          ...(Object.keys(declared).length ? { declaredOutcomes: declared } : {}),
          ...(gateDrift ? { gateDrift } : {}),
          ...(outcomeDrift.length ? { outcomeDrift } : {}),
        },
      } : {}),
    };
  }
  if (phase === 'sizing') {
    const casesOut = group;
    // Sizing join: predicted size (if the scoping skill scored this scope) +
    // deviation vs the size class's cross-batch history. Baselines exclude this
    // batch so a first close never compares a case against itself.
    // No scoping ran → loadSizings is empty → skip entirely (incl. the history
    // walk): cost.json carries no `sizing` key and every renderer degrades to
    // the exact pre-sizing output.
    const sizings0 = repo ? loadSizings(repo) : null;
    const sizingRollup = sizings0?.size ? applySizing(casesOut, sizings0, sizeBaselines(repo, { excludeSlug: ctx.slug }, settings)) : null;
    return sizingRollup ? { sizing: sizingRollup } : {};
  }
  // The declared batch may be a top slug, a nested wave's full path, or just
  // the wave's own name — resolve all three (close and the live page alike).
  if (phase === 'match') return group.batch === ctx.scope.batch || group.batch.endsWith(`/${ctx.scope.batch}`);
  if (phase === 'by-group') {
    const c = group;
    return {
      gate: c.gate?.verdict ?? null,
      drift: !!(c.records?.gateDrift || c.records?.outcomeDrift?.length),
    };
  }
  return renderEnriched(group, ctx);
}

// active-minutes: a batch-grain actual summed from loaded minutes is an allocation, labelled; an unmeasured one shows its count.
const allocNote = (e) => (e.basis === 'allocated' ? ' (allocated: batch time ÷ cases)' : '');
const actualMinText = (b) => (b.actualMin ?? `—${b.actualMinUnmeasured ? ` (${b.actualMinUnmeasured} unmeasured)` : ''}`);

/** Report fragments for the enriched fields (gate + drift, findings, sizing); input = the cost.json object. */
function renderEnriched(c, { phase, part, cost, statCell, esc, fmtInt }) {
  if (phase === 'render-md') {
    if (part === 'what-lines') {
      const out = [];
      if (c.gate) out.push(`- Gate: ${c.gate.verdict}${c.gate.runs ? ` (${c.gate.runs} runs)` : ''}`);
      if (c.records?.gateRuns) out.push(`- Gate record (script-authored): ${c.records.gateRuns.latest.verdict} at ${c.records.gateRuns.latest.at ?? '?'} (${c.records.gateRuns.count} run record(s))`);
      if (c.records?.gateDrift) out.push(`- ⚠️ **GATE DRIFT**: receipt says \`${c.records.gateDrift.receipt ?? 'not-run'}\` but the recorded verdict is \`${c.records.gateDrift.recorded}\` — write the verdict back into report.json`);
      if (c.records?.outcomeDrift?.length) out.push(`- ⚠️ **OUTCOME DRIFT** (${c.records.outcomeDrift.length}): ${c.records.outcomeDrift.map((d) => `${d.id} receipt=${d.receipt ?? '—'} declared=${d.declared}`).join('; ')} — reconcile report.json`);
      return out;
    }
    if (part === 'by-group-head') return ['gate', 'drift'];          // team-report period rollup, By-group table
    if (part === 'by-group-cells') return [c.gate ?? '—', c.drift ? '⚠️' : '—']; // input = a byBatch row
    if (part === 'what') return `Findings reported: ${c.cases.reduce((n, x) => n + x.findings, 0)}`;
    if (part === 'case-lead') return c.sizing ? ['size'] : [];   // no scoping ran -> no size column at all
    if (part === 'case-tail') return ['findings'];
    if (part === 'case-lead-cells') {                              // input = the case row, ctx.cost = the group
      const x = c;
      const sz = (y) => (y.sizing ? `${y.sizing.size}${y.sizing.flag ? ' ⚠' : ''}` : '—');
      return cost.sizing ? [sz(x)] : [];
    }
    if (part === 'case-tail-cells') return [c.findings];          // input = the case row
    if (part === 'sections') {
      const out = [];
      if (c.sizing) {
        out.push('', '## By size — predicted (automation-scoping) vs actual', '');
        out.push('| size | cases | ΣSP | est min | actual min | actual rw tok |', '|---|---|---|---|---|---|');
        for (const [k, b] of Object.entries(c.sizing.bySize)) out.push(`| ${k} | ${b.cases} | ${b.sp || '—'} | ${b.estMin || '—'} | ${actualMinText(b)} | ${b.actualTok.toLocaleString()} |`);
        if (c.sizing.estVsActualMin) out.push('', `**Estimate vs actual (batch grain): ${c.sizing.estVsActualMin.est}m predicted / ${c.sizing.estVsActualMin.actual}m actual${allocNote(c.sizing.estVsActualMin)} — ×${c.sizing.estVsActualMin.ratio}.** Batch grain only: per-case dollars rank-correlate ~zero with predictions (scoping doctrine) — deviations below are tokens/time analysis pointers.`);
        // a blank line before the flags when no comparison line separates them from the table (session grain)
        if (!c.sizing.estVsActualMin && c.sizing.flagged.length && Object.values(c.sizing.bySize).some((b) => b.actualMinBasis)) out.push('');
        for (const f of c.sizing.flagged) out.push(`- ⚠ **${f.id}** (${f.size}, ${f.flag}): ${f.detail}`);
      }
      return out;
    }
  }
  if (phase === 'render-html') {
    const x = c;   // the case row, for the bar parts
    if (part === 'by-group-head') return ['gate', 'drift'];
    if (part === 'by-group-cells') return [esc(c.gate ?? '—'), c.drift ? '⚠️' : '—'];   // input = a byBatch row
    if (part === 'case-pre') return x.sizing ? `size ${esc(x.sizing.size)}${x.sizing.flag ? ' ⚠' : ''} · ` : '';
    if (part === 'case-post') return x.findings ? ` · ${x.findings} finding${x.findings > 1 ? 's' : ''}` : '';
    if (part === 'delivery-lead') return [statCell(`Gate${c.gate?.runs ? ` <span class="stat-sub">(${c.gate.runs} runs)</span>` : ''}`, c.gate ? esc(c.gate.verdict) : 'n/a')];
    if (part === 'delivery-tail') return [statCell('Findings', fmtInt(c.cases.reduce((n, x) => n + x.findings, 0)))];
    if (part === 'gate-drift') return c.records?.gateDrift ? `<p class="callout-warn">⚠ GATE DRIFT — receipt says '${esc(c.records.gateDrift.receipt ?? 'not-run')}' but the recorded verdict is '${esc(c.records.gateDrift.recorded)}' (${esc(c.records.gateDrift.at ?? '?')}): write the verdict back into report.json</p>` : '';
    if (part === 'outcome-drift') return c.records?.outcomeDrift?.length ? `<p class="callout-warn">⚠ OUTCOME DRIFT — ${c.records.outcomeDrift.map((d) => `${esc(d.id)}: receipt=${esc(d.receipt ?? '—')} declared=${esc(d.declared)}`).join('; ')} — reconcile report.json</p>` : '';
    if (part === 'sections') return c.sizing ? `<section class="panel"><h2>By size — predicted vs actual</h2>
  <p class="panel-sub">Pre-run size (automation-scoping) against actuals${c.sizing.estVsActualMin ? ` · batch grain: ${c.sizing.estVsActualMin.est}m predicted / ${c.sizing.estVsActualMin.actual}m actual${allocNote(c.sizing.estVsActualMin)} (×${c.sizing.estVsActualMin.ratio})` : ''}. Deviations are tokens/time analysis pointers — never per-case dollar verdicts.</p>
  <table><tr><th>size</th><th>cases</th><th>ΣSP</th><th>est min</th><th>actual min</th><th>actual rw tok</th></tr>
  ${Object.entries(c.sizing.bySize).map(([k, b]) => `<tr><td>${esc(k)}</td><td>${b.cases}</td><td>${b.sp || '—'}</td><td>${b.estMin || '—'}</td><td>${actualMinText(b)}</td><td>${b.actualTok.toLocaleString()}</td></tr>`).join('')}</table>
  ${c.sizing.flagged.map((f) => `<p class="callout-warn">⚠ ${esc(f.id)} (${esc(f.size)}, ${esc(f.flag)}): ${esc(f.detail)}</p>`).join('')}</section>` : '';
  }
  if (phase === 'render-tok-md' && c.sizing?.flagged?.length) {
    const out = ['## Size-class deviations (analysis pointers)', ''];
    for (const f of c.sizing.flagged) out.push(`- ⚠ **${f.id}** (${f.size}, ${f.flag}): ${f.detail}`);
    out.push('');
    return out;
  }
  return undefined;
}

// --- onClose: close-time folding + reconciliation output (work-scope close) ----
/**
 * At close, the telemetry-side verdicts move home: appended into the batch
 * dir's gate-runs.jsonl (skipping lines already there), telemetry file
 * removed. After this the record ships WITH the batch — one committed file,
 * no second source. Safe to call when there is nothing to fold.
 */
function foldGateRuns(repo, slug, dir, settings = TA_DEFAULTS) {
  const src = join(telemetryDir(repo, settings), 'gate-runs', `${slug}.jsonl`);
  if (!existsSync(src)) return 0;
  const dst = join(dir, 'gate-runs.jsonl');
  const have = new Set(existsSync(dst) ? readFileSync(dst, 'utf8').split('\n').filter(Boolean) : []);
  const fresh = readFileSync(src, 'utf8').split('\n').filter(Boolean).filter((l) => !have.has(l));
  if (fresh.length) {
    mkdirSync(dir, { recursive: true });
    appendFileSync(dst, `${fresh.join('\n')}\n`);
  }
  rmSync(src, { force: true });
  return fresh.length;
}

/**
 * Close-time side effects (spec §14.3) — TA only. Phases:
 *   (none)       a closed group's cost (ctx.dir = its reports dir) → fold the mid-run gate verdicts home
 *                (gate verdicts written to the telemetry side mid-run move home now, so the closed batch
 *                ships one committed gate-runs.jsonl); returns the number of lines folded
 *   'report'     a rendered group's cost → print receipt-vs-records drift while it is still actionable
 *   'no-receipt' the closing scope → recovery advice for a missing receipt (text)
 */
export function onClose(group, ctx = {}) {
  const { repo, settings = TA_DEFAULTS, phase } = ctx;
  if (!phase) return foldGateRuns(repo, group.batch, ctx.dir, settings);
  if (phase === 'report') {
    const cost = group;
    const r = cost.records;
    if (r?.gateDrift) process.stderr.write(`work-scope: ⚠ GATE DRIFT on ${cost.batch} — receipt '${r.gateDrift.receipt ?? 'not-run'}' vs recorded '${r.gateDrift.recorded}': write the verdict back into report.json BEFORE walking away\n`);
    if (r?.outcomeDrift?.length) process.stderr.write(`work-scope: ⚠ OUTCOME DRIFT on ${cost.batch} (${r.outcomeDrift.map((d) => `${d.id}: receipt=${d.receipt ?? '—'} declared=${d.declared}`).join('; ')}) — reconcile report.json\n`);
    return undefined;
  }
  // The receipt is written by an AGENT (the workflow's report writer, or the
  // lead on a sequential run) — so it can simply be absent: an interrupted run,
  // a dead writer, a loop that never reached its end.
  if (phase === 'no-receipt') {
    return '  The receipt is an agent write; an interrupted run leaves none. Rebuild it from what IS on disk — gate-runs.jsonl (script-authored verdicts),\n'
      + `  .agents/telemetry/${settings.dir}/returns/ (per-dispatch returns; legacy _returns/), the run journal and git — see the orchestration playbook § Interruption and resumption,\n`;
  }
  return undefined;
}

// --- stopGateCheck: the second stop gate (scope hook) --------------------------
/** The batch's receipt, wherever the pipeline put it (flat, or a campaign wave). */
function receiptPathFor(repo, batch, settings = TA_DEFAULTS) {
  const root = receiptsRoot(repo, settings);
  const direct = join(root, ...String(batch).split('/'), settings.receipts.file);
  if (existsSync(direct)) return direct;
  let names;
  try { names = readdirSync(root); } catch { return null; }
  for (const n of names) {                                  // <campaign>/<wave>/<receipts.file>
    const nested = join(root, n, String(batch), settings.receipts.file);
    if (existsSync(nested)) return nested;
  }
  return null;
}

/**
 * The declared scope → null | the hook-output block (spec §14.3). The batch has
 * a receipt but the scope is still open → run `close` (records outcomes,
 * renders the batch report, cross-checks the receipt) — asked ONCE
 * (ctx.askedOnce('unclosed')). A lead reliably does the git half of closing
 * and then writes its own summary in chat — measured on a real batch: scope
 * declared, outcomes recorded, merged, cleaned up… and no report, because
 * nothing asked. ctx = { repo, settings, sid, askedOnce, scriptPath }.
 */
export function stopGateCheck(scope, { repo, settings = TA_DEFAULTS, sid, askedOnce, scriptPath } = {}) {
  if (scope.batch && !scope.closedAt && receiptPathFor(repo, scope.batch, settings) && !askedOnce('unclosed')) {
    return {
      decision: 'block',
      reason: `Batch '${scope.batch}' has written its receipt but this session's scope is still open — the batch report does not exist yet. `
        + `Record any outcome you have not yet recorded (\`node ${scriptPath} outcome --session ${sid} <ID>=<outcome>\`), then run `
        + `\`node ${scriptPath} close --session ${sid}\` — it captures this session's spend, renders ${settings.receipts.root}/${scope.batch}/batch-report.md + .html, `
        + `and cross-checks the receipt against the recorded gate verdicts (a DRIFT warning means report.json still needs its write-back). Then finish your reply.`,
    };
  }
  return null;
}

// --- exportRow: the QA dataset row (hyperfactory export, A5) ------------------
const round = (v, p = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** p) / 10 ** p : null);
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL'];

/** The QA facts a dataset row derives from one batch's cost.json. */
function rowFacts(cost) {
  const sz = cost.sizing ?? null;
  // effort: scoping SP claims 1 SP = 1 hour of CONVENTIONAL engineer effort,
  // so SP/8 ≈ person-days-no-AI — derived, and flagged as such in notes.
  const caseSp = sz ? Object.values(sz.bySize).reduce((a, b) => a + num(b.sp), 0) : null;
  const effortDays = caseSp ? round(caseSp / 8, 1) : null;
  const dominantSize = sz
    ? Object.entries(sz.bySize).sort((a, b) => b[1].cases - a[1].cases || SIZE_ORDER.indexOf(b[0]) - SIZE_ORDER.indexOf(a[0]))[0]?.[0] ?? null
    : null;
  const maxSize = sz
    ? [...SIZE_ORDER].reverse().find((k) => sz.bySize[k]) ?? null
    : null;
  const notStarted = num(cost.outcomes?.['not-started']) + num(cost.outcomes?.['infra-stalled']);
  const authored = cost.cases.length - notStarted;
  return { caseSp, effortDays, dominantSize, maxSize, authored };
}

// §7 self-validation — defaults-and-flags, never silent: the QA checks, each at its
// slot in the engine's §7 order (ctx.slot); the engine checks the fields it measures.
function checklist(segment, row, slot) {
  const missing = []; const defaulted = [];
  if (slot === 'segment' && (!segment.stop || !segment.owner_group || !segment.work_item_level)) missing.push('segment.stop/owner_group/work_item_level');
  if (slot === 'effort' && row.effort_days == null) missing.push('effort_days (run the intake sizing pass)');
  if (slot === 'profile' && row.maturity === 'pilot' && !('maturity' in (segment._profileKeys ?? {}))) defaulted.push('maturity=pilot (set it in factory-profile.json)');
  if (slot === 'row') {
    for (const f of ['scenarios_authored', 'scenarios_automated', 'scenarios_executed']) if (row[f] == null) missing.push(f);
    if (!row.scenario_complexity) missing.push('scenario_complexity (from sizing verdicts)');
    if (!row.env_setup) missing.push('env_setup (set it in factory-profile.json: trivial|single-fixture|multi-fixture|external-deps|full-env)');
  }
  return { missing, defaulted };
}


/**
 * Group (cost.json) → the QA dataset's domain fields (spec §14.3). Phases:
 *   'segment' → segment domain identity (stop / owner_group / work_item_level / factory_type);  'item' / 'scenarios' / 'size' → row fields at their dataset positions
 *   'effort'  → effort_days (number | null; the engine derives size_tshirt from it)
 *   'notes'   → the row's notes list (ctx.engineNotes = the engine's own notes)
 *   'checklist' (input = row, ctx.segment, ctx.slot) → the QA §7 { missing, defaulted } at that slot
 *   'anonymize' (input = row) → the anonymised domain fields
 *   'submission' (input = the export doc, ctx.part) → submission.md lines
 *   'compare' (input = cost a, ctx.other = cost b, ctx.row) → --compare rows
 *   'no-profile' → the hint appended to the missing-profile warning
 */
export function exportRow(cost, ctx = {}) {
  const { phase, profile = {}, settings = TA_DEFAULTS } = ctx;
  if (phase === 'segment') {
    return {
      stop: profile.stop ?? 'testing',
      owner_group: profile.owner_group ?? 'QA',
      work_item_level: profile.work_item_level ?? 'feature',
      factory_type: profile.factory_type ?? 'qa',
    };
  }
  if (phase === 'item') {
    return {
      work_item_level: profile.work_item_level ?? 'feature',
      work_item_brief: `Test-automation batch: ${cost.cases.length} TMS case(s) through analyse → implement → review → merge → gate; ${cost.delivered} delivered.`,
    };
  }
  if (phase === 'effort') return rowFacts(cost).effortDays;
  if (phase === 'scenarios') {
    const { authored, maxSize } = rowFacts(cost);
    return {
      scenarios_authored: authored,
      scenarios_automated: cost.delivered,
      scenarios_executed: authored,
      ...(maxSize ? { scenario_complexity: maxSize } : {}),
    };
  }
  if (phase === 'size') {
    const { dominantSize, caseSp } = rowFacts(cost);
    return {
      ...(dominantSize ? { self_size: dominantSize } : {}),
      ...(caseSp ? { story_points: caseSp } : {}),
    };
  }
  if (phase === 'notes') {
    const { caseSp, effortDays } = rowFacts(cost);
    const oc = Object.entries(cost.outcomes ?? {}).map(([k, n]) => `${k} ${n}`).join(', ');
    return [
      `gate ${cost.gate?.verdict ?? 'not-run'}${cost.gate?.runs ? ` (${cost.gate.runs}x)` : ''}; outcomes: ${oc || '—'}.`,
      ...ctx.engineNotes.attribution,
      ...(ctx.engineNotes.findings ?? []),
      `Telemetry cohort: reconstructed from ${settings.receipts.root}/${cost.batch}/cost.json (v${cost.v}); batch slug '${cost.batch}'.`,
      effortDays != null ? `effort_days derived from scoping SP (${caseSp} SP × 1h ÷ 8) — conventional-effort estimate, not a human report.` : 'effort_days unavailable — no scoping verdicts for this batch (run the intake sizing pass).',
      ctx.engineNotes.cacheShare,
      'scenarios_executed = cases the pipeline analysed live and gated (live execution evidence + N-consecutive gate runs; re-runs not multiplied).',
    ];
  }
  if (phase === 'checklist') return checklist(ctx.segment, cost, ctx.slot);
  if (phase === 'anonymize') {
    const r = cost;
    const work_item_brief = `Test-automation batch (${r.scenarios_executed ?? '?'} cases${r.size_tshirt ? `, ${r.size_tshirt}` : ''})`;
    if (migrationOn('anon-complete')) {
      // B2 anon-complete: scrub the group slug wherever the notes carry it (the receipt path included) and
      // name the group's identifiers to the engine, which scrubs them from every other row and string too.
      const notes = r.notes ?? '';
      // the engine enumerates the project's receipts itself (receiptIdentifiers); `scrub` is the TA's addition
      const slugs = [...notes.matchAll(/batch slug '([^']*)'/g)].map((m) => m[1]).filter(Boolean);
      const scrub = slugs;
      return { work_item_brief, notes: scrubStrings(notes, scrub).replace(/batch slug '[^']*'/g, "batch slug 'anonymised'"), scrub };
    }
    return {
      work_item_brief,
      notes: (r.notes ?? '').replace(/batch slug '[^']*'/g, "batch slug 'anonymised'"),
    };
  }
  if (phase === 'submission') {
    const finalDoc = cost;
    const sum = (f) => finalDoc.runs.reduce((a, r) => a + num(r[f]), 0);
    if (ctx.part === 'intro') return ['*Paired with the machine-readable [`runs.json`](./runs.json) (identical numbers). Telemetry cohort: every row is reconstructed from the pipeline\'s own per-batch cost receipts.*', ''];
    if (migrationOn('report-robustness')) {
      // submission-identity (item 20): a segment that lacks a value omits it; never the text `undefined`.
      const { stop, owner_group: owner, work_item_level: level } = finalDoc.segment;
      if (ctx.part === 'title-suffix') return [stop != null ? ` (\`${stop}\` stop)` : ''];
      if (ctx.part === 'identity-row') {
        const have = [['Stop', stop], ['owner', owner]].filter(([, v]) => v != null);
        const label = have.map(([k]) => k).join(' · ');
        return have.length ? [`| **${label.charAt(0).toUpperCase()}${label.slice(1)}** | ${have.map(([, v]) => `\`${v}\``).join(' · ')} |`] : [];
      }
      if (ctx.part === 'factory-rows') return level != null ? [`| **Work-item level** | \`${level}\` |`] : [];
    }
    if (ctx.part === 'title-suffix') return [` (\`${finalDoc.segment.stop}\` stop)`];
    if (ctx.part === 'identity-row') return [`| **Stop · owner** | \`${finalDoc.segment.stop}\` · \`${finalDoc.segment.owner_group}\` |`];
    if (ctx.part === 'factory-rows') return [`| **Work-item level** | \`${finalDoc.segment.work_item_level}\` |`];
    if (ctx.part === 'summary-rows') return [`| Scenarios authored / automated / executed | ${sum('scenarios_authored')} / ${sum('scenarios_automated')} / ${sum('scenarios_executed')} |`];
    return [];
  }
  if (phase === 'compare') {
    const a = cost; const b = ctx.other;
    return [ctx.row('gate', a.gate?.verdict ?? 'n/a', b.gate?.verdict ?? 'n/a')];
  }
  if (phase === 'no-profile') return " (copy the skill's templates/factory-profile.template.json there; seeding Step 6.7 does this)";
  return undefined;
}
