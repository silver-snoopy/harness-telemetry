// B2 behaviour migrations (spec 14.8). Each lands behind its id, in landing order (docs/b2/MIGRATION-MAP.md §4),
// which is also the composition order (the declared-diff harness reads declarers in this order). Items 22-24
// (report-conflicts, role-dollars, report-revision) are spec-required slots beyond the 14.8 list and land alone;
// the optional items 12-21 land as three groups, amending 14.8's "each lands alone" for them (owner Q1b):
// entry-points (12, 13), capture-robustness (14-17, 21), report-robustness (18-20). A group's `item` is its
// lowest item number; its registry entry lists them all in `items`. TOKENOMICS_MIGRATIONS selects them:
// unset = every landed migration; `none` = none (the B1 extraction — also the B4 rescue release's writer,
// spec 18.5); `a,b` = exactly those. It is the harness/rescue lever; the production switch set is {} (owner
// Q3). STDLIB ONLY.
import { readFileSync } from 'node:fs';

export const MIGRATIONS = Object.freeze([
  ['exact-ids', 1], ['anon-complete', 5], ['fold-flags', 6], ['null-unobservable', 4],
  ['copilot-inclusive', 3], ['shared-allocation', 2], ['active-minutes', 7], ['report-windows', 8],
  ['scope-resolution', 9], ['reports-location', 10], ['writer', 11],
  ['report-conflicts', 22], ['role-dollars', 23], ['report-revision', 24],
  ['entry-points', 12], ['capture-robustness', 14], ['report-robustness', 18],
].map(([id, item]) => Object.freeze({ id, item, landed: id === 'exact-ids' || id === 'anon-complete' || id === 'fold-flags' || id === 'null-unobservable' || id === 'copilot-inclusive' || id === 'shared-allocation' || id === 'active-minutes' || id === 'report-windows' || id === 'scope-resolution' || id === 'reports-location' || id === 'writer' || id === 'report-conflicts' || id === 'role-dollars' || id === 'report-revision' || id === 'entry-points' || id === 'capture-robustness' || id === 'report-robustness' })));

// Whether this engine is an installed copy (Plan 5 D-INST: ENGINE.json beside engine/ has `installed` set). Read
// once per process. Only an ABSENT manifest (ENOENT: a reference-era copy) is not installed; a present manifest that
// cannot be read or parsed is an installed copy (fail closed, as the activation gate treats it): the production
// switch set is {} and a damaged manifest must not reopen the lever (Codex B3-06).
let installedCopy;
function isInstalledCopy() {
  if (installedCopy === undefined) {
    let raw = null;
    try { raw = readFileSync(new URL('../ENGINE.json', import.meta.url), 'utf8'); } catch (e) { installedCopy = e?.code !== 'ENOENT'; }
    if (raw !== null) {
      try {
        const doc = JSON.parse(raw);
        installedCopy = !(doc && typeof doc === 'object' && !Array.isArray(doc)) || (doc.installed !== null && doc.installed !== undefined);
      } catch { installedCopy = true; }
    }
  }
  return installedCopy;
}

export const REFUSED_MESSAGE = 'tokenomics: refused — TOKENOMICS_MIGRATIONS is set in an installed engine (production switch set is {}; unset it)';

// Production switch enforcement (B3, owner Q3, spec §18.5; ruling R12): the production switch set is {}, so an
// installed copy refuses a non-empty variable at every entry, here, where every migration read passes. The source
// checkout (`installed: null`) keeps the harness lever. Empty or whitespace-only is unset (R11).
export function enabledMigrations(env = process.env) {
  const raw = env.TOKENOMICS_MIGRATIONS;
  const landed = MIGRATIONS.filter((m) => m.landed).map((m) => m.id);
  if (raw === undefined || raw.trim() === '') return new Set(landed);
  if (isInstalledCopy()) throw new Error(REFUSED_MESSAGE);
  if (raw.trim() === 'none') return new Set();
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    const m = MIGRATIONS.find((x) => x.id === id);
    if (!m) throw new Error(`tokenomics: unknown migration '${id}' in TOKENOMICS_MIGRATIONS`);
    if (!m.landed) throw new Error(`tokenomics: migration '${id}' has not landed`);
  }
  return new Set(ids);
}

export const migrationOn = (id, env = process.env) => enabledMigrations(env).has(id);
