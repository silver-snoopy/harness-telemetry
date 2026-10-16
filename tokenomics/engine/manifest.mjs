// The manifest reader (map D1, obligation O4; spec §3.1, §14.4, §7.1). A record is read by the manifest revision
// it was written under, never by whichever manifest is current:
//   - no `manifestRevision` key (every reference-era and B1-era record) → the implied legacy manifest (the kit's
//     IMPLIED_MANIFEST: TA ratioIntents, TA delivered outcomes, files receipts whose mtime may serve as their
//     `revision`, owner Q10c). Never the current module.json, never manifests/1.json (owner Q11a);
//   - `manifestRevision: N` → `<dir>/manifests/N.json`. N = 1 with neither module.json nor manifests/ is the
//     implied manifest (the revision `writer` stamps for it, map D4);
//   - `manifestRevision: null` (a `writer` line stamped under a present but unusable module.json) → unverified,
//     with the finding `manifest-revision-unknown`; never the implied manifest (review round 1, I1);
//   - a missing (or unreadable) archive → unverified, with the finding `manifest-archive-missing: revision N`.
//     The current module.json is never substituted, even when it declares revision N (owner Q11b).
// STDLIB ONLY.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { IMPLIED_MANIFEST } from '../kit/load.mjs';
import { migrationOn } from './migrations.mjs';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** The binding a manifest document gives a record. `referenceEra`: a files receipt's mtime may serve as its revision. */
function binding(revision, m, { referenceEra }) {
  const r = isObj(m.receipts) ? m.receipts : {};
  return {
    revision,
    ratioIntents: strings(m.ratioIntents),
    deliveredOutcomes: strings(r.deliveredOutcomes),
    receiptPolicy: { source: r.source ?? 'files', ...(r.root ? { root: r.root } : {}), ...(r.file ? { file: r.file } : {}), referenceEra },
    verified: true,
  };
}
const IMPLIED = () => binding(IMPLIED_MANIFEST.manifestRevision, IMPLIED_MANIFEST, { referenceEra: true });

/** D1's reading rule for one record (a ledger line or a receipt) of the telemetry directory `telemetryDir`. */
export function manifestFor(telemetryDir, line) {
  const n = line?.manifestRevision;
  if (n === undefined) return IMPLIED();
  // An explicit null is a writer line stamped under a present but unusable module.json (map D4, review round 1 I1):
  // a fresh line whose revision is unknown — unverified, never the implied legacy manifest (Q11b).
  if (n === null) return { revision: null, ratioIntents: [], deliveredOutcomes: [], receiptPolicy: null, verified: false, finding: 'manifest-revision-unknown' };
  const unverified = { revision: n, ratioIntents: [], deliveredOutcomes: [], receiptPolicy: null, verified: false, finding: `manifest-archive-missing: revision ${n}` };
  if (!Number.isInteger(n) || n < 1 || !telemetryDir) return unverified;
  if (n === 1 && !existsSync(join(telemetryDir, 'module.json')) && !existsSync(join(telemetryDir, 'manifests'))) {
    return binding(1, IMPLIED_MANIFEST, { referenceEra: false });   // stamped: never reference-era
  }
  const m = readJson(join(telemetryDir, 'manifests', `${n}.json`));
  return isObj(m) ? binding(n, m, { referenceEra: false }) : unverified;
}

/**
 * The delivered-outcome vocabulary of one receipt (D1 for receipts, controller ruling I1; Codex B2-05). Every reader
 * of delivery — the period denominator (`loadCases`), the group cost (`batch-cost`), the period report's by-group
 * rows and its delivered-only per-case statistics — resolves a receipt through this one rule, so one report never
 * contradicts itself and a settings change never reinterprets a stamped receipt:
 *   - with `report-windows` (the migration that owns D1) and a receipt stamped with a non-null `manifestRevision`:
 *     that revision's archive (`manifestFor`); a missing archive delivers nothing and returns
 *     its `finding` (owner Q11b: unverified, never the current settings);
 *   - otherwise (a revisionless receipt — every §5.1 receipt — or migrations off, the B1 extraction): the receipt
 *     policy that discovered it, `settings.receipts.deliveredOutcomes`.
 * A receipt whose `manifestRevision` is explicitly `null` currently reads as revisionless (the settings policy),
 * unlike a ledger line, where null is unverified (`manifest-revision-unknown`). Receipts are never engine-written;
 * the C1 command-receipt contract must define what a null revision means (parked to C1, Plan 4 final review).
 * Returns `{ deliveredOutcomes, stamped, finding? }`.
 */
export function receiptDelivery(telemetryDir, receipt, settings) {
  const n = receipt?.manifestRevision;
  if (n === undefined || n === null || !migrationOn('report-windows')) {
    return { deliveredOutcomes: settings.receipts.deliveredOutcomes, stamped: false };
  }
  const b = manifestFor(telemetryDir, receipt);
  return b.verified ? { deliveredOutcomes: b.deliveredOutcomes, stamped: true } : { deliveredOutcomes: [], stamped: true, finding: b.finding };
}

/** The current manifest: `<dir>/module.json`, else the implied manifest (revision 1). */
export function currentManifest(telemetryDir) {
  const m = telemetryDir ? readJson(join(telemetryDir, 'module.json')) : null;
  if (isObj(m)) return { revision: m.manifestRevision, ...m };
  return { revision: IMPLIED_MANIFEST.manifestRevision, ...IMPLIED_MANIFEST };
}

/**
 * The `manifestRevision` a measurement line is stamped with (B2 item 11, map D4): module.json absent → 1 (the implied
 * TA manifest); present with an integer `manifestRevision` ≥ 1 → it; present but unusable (unreadable, unparseable,
 * not an object, or no integer revision) → null, the unknown, read back as unverified (review round 1, I1).
 */
export function stampRevision(telemetryDir) {
  const p = telemetryDir ? join(telemetryDir, 'module.json') : null;
  if (!p || !existsSync(p)) return IMPLIED_MANIFEST.manifestRevision;
  const m = readJson(p);
  const n = isObj(m) ? m.manifestRevision : undefined;
  return Number.isInteger(n) && n >= 1 ? n : null;
}
