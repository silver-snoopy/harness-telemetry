#!/usr/bin/env node
// Declared-diff harness (spec 12 B2, 18.2): each behaviour migration's output diff must equal exactly
// its declared diff. The registry (corpus/migrations/<id>/migration.json) declares, per case, the paths a
// migration changes or removes (and the exits it changes); the after-content is stored as complete files
// under corpus/migrations/<id>/expected/<case>/, so the oracle is a byte comparison. Four modes:
//   none        every case equals its baseline (expected/49577c7, or expected/engine for approved
//               engine-only cases) — the B1 extraction, also the B4 rescue release's writer (spec 18.5);
//   only:<id>   per landed migration: declared cases equal baseline + declared diff, others the baseline;
//   default     TOKENOMICS_MIGRATIONS unset (the genuine default, Codex P3-04): every case equals the
//               composition of the landed migrations' declarations (composeExpected), plus the case's
//               interaction declaration, if any;
//   all         the explicit comma list of landed ids (only when one has landed), same expectation.
// The cumulative expectation is computed from reviewed declarations, never recorded from the implementation
// under test (Codex P3-01): bytes no single declaration predicts enter only through an explicit, reasoned
// interaction declaration (corpus/migrations/_interactions/<case>/interaction.json), reviewed with
// `show-interaction`. A landed migration declares every one of its beforeCases unless beforeCasesWaived gives
// a reason.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCase } from '../replay/runner.mjs';
import { fileMap, sortFiles, readText } from '../replay/collect.mjs';
import { expectedExits } from '../replay/exits.mjs';
import { engineOnlyProblems, approvedEngineOnly } from './engine-only.mjs';
import { MIGRATIONS } from '../tokenomics/engine/migrations.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULTS = {
  implDir: join(ROOT, 'tokenomics'),
  casesDir: join(ROOT, 'corpus/cases'),
  registryDir: join(ROOT, 'corpus/migrations'),
  migrations: MIGRATIONS,
};

const caseDirs = (casesDir) => readdirSync(casesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const sameExits = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// File maps are null-prototype objects (fileMap) and every membership test is own-property (Codex P3P-01): any legal
// filename, `__proto__`, `constructor` and `toString` included, is an ordinary path. Registry objects come from
// JSON.parse and keep Object.prototype, so their case lookups are own-property too.
const has = (o, k) => o != null && Object.hasOwn(o, k);
/** The declaration of case `c` in a registry entry, own keys only (`declared.toString` is not a declaration). */
const declOf = (entry, c) => (entry && entry.declared && typeof entry.declared === 'object' && has(entry.declared, c) ? entry.declared[c] : undefined);

/** Every file under `dir` as a null-prototype file map `{ 'a/b.txt': content }` (re-exported by diff-impl.mjs).
 * A stored file that is not valid UTF-8 throws `golden <path> is not valid UTF-8 …` (Codex B2-03). */
export function goldenFiles(dir) {
  const out = fileMap();
  if (!existsSync(dir)) return out;
  const walk = (p) => { for (const e of readdirSync(p)) { const q = join(p, e); if (statSync(q).isDirectory()) walk(q); else { const k = relative(dir, q).split(sep).join('/'); out[k] = readText(q, `golden ${k}`); } } };
  walk(dir);
  return out;
}

/** want vs got, both directions: exit mismatches first (as diff-impl always reported them), then missing, extra, differs. */
export function compareFiles(want, got, wantExits = null, gotExits = null) {
  const out = [];
  if (wantExits && gotExits) {
    gotExits.forEach((code, i) => { if (code !== wantExits[i]) out.push(`exit ${i}=${code}`); });
    if (gotExits.length !== wantExits.length) out.push(`${gotExits.length} exit(s), expected ${wantExits.length}`);
  }
  for (const k of Object.keys(want)) if (!has(got, k)) out.push(`missing ${k}`);
  for (const k of Object.keys(got)) if (!has(want, k)) out.push(`extra ${k}`);
  for (const k of Object.keys(want)) if (has(got, k) && got[k] !== want[k]) out.push(`differs ${k}`);
  return out;
}

const INTERACTIONS = '_interactions';

/** Every `<id>/migration.json` under registryDir, and every `_interactions/<case>/interaction.json` (keyed by
 * case). Each entry and interaction carries a non-enumerable `dir`. */
export function loadRegistry(registryDir) {
  const entries = new Map();
  const interactions = new Map();
  const problems = [];
  if (!existsSync(registryDir)) return { entries, interactions, problems: [`${registryDir}: no registry`] };
  const readJson = (label, p) => {
    let v;
    try { v = JSON.parse(readFileSync(p, 'utf8')); } catch (err) { problems.push(`${label}: ${err.message}`); return null; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { problems.push(`${label} is not an object`); return null; }
    return v;
  };
  for (const name of caseDirs(registryDir)) {
    if (name === INTERACTIONS) continue;
    const p = join(registryDir, name, 'migration.json');
    if (!existsSync(p)) { problems.push(`${name}: no migration.json`); continue; }
    const e = readJson(`${name}: migration.json`, p);
    if (!e) continue;
    if (e.id !== name) { problems.push(`${name}: migration.json id ${JSON.stringify(e.id)} does not match its directory`); continue; }
    Object.defineProperty(e, 'dir', { value: join(registryDir, name), enumerable: false });
    entries.set(name, e);
  }
  const idir = join(registryDir, INTERACTIONS);
  if (existsSync(idir)) for (const c of caseDirs(idir)) {
    const p = join(idir, c, 'interaction.json');
    if (!existsSync(p)) { problems.push(`${INTERACTIONS}/${c}: no interaction.json`); continue; }
    const it = readJson(`${INTERACTIONS}/${c}: interaction.json`, p);
    if (!it) continue;
    if (it.case !== c) { problems.push(`${INTERACTIONS}/${c}: interaction.json case ${JSON.stringify(it.case)} does not match its directory`); continue; }
    Object.defineProperty(it, 'dir', { value: join(idir, c), enumerable: false });
    interactions.set(c, it);
  }
  return { entries, interactions, problems };
}

// Path keys and exit keys (`exit:<i>`) share a namespace in composeExpected, so a path may not look like an exit key.
const isPathList = (v) => Array.isArray(v) && v.every((p) => typeof p === 'string' && p && !isAbsolute(p) && !p.split('/').includes('..') && !/^exit:\d+$/.test(p));

/** Registry problems: every MIGRATIONS id has a valid entry, and every interaction declaration (`interactions`,
 * from loadRegistry) is valid — callers that omit it validate no interactions. */
export function registryProblems(entries, migrations, casesDir, interactions = new Map()) {
  const out = [];
  const known = new Map(migrations.map((m) => [m.id, m]));
  const cases = new Set(caseDirs(casesDir));
  const replayable = (c) => existsSync(join(casesDir, c, 'replay.json'));
  for (const m of migrations) if (!entries.has(m.id)) out.push(`${m.id}: no registry entry`);
  for (const [id, e] of entries) {
    const m = known.get(id);
    if (!m) { out.push(`${id}: unknown migration`); continue; }
    if (e.item !== m.item) out.push(`${id}: item ${e.item} but MIGRATIONS says ${m.item}`);
    for (const k of ['spec', 'summary']) if (typeof e[k] !== 'string' || !e[k].trim()) out.push(`${id}: ${k} must be a non-empty string`);
    // A grouped migration (owner Q1b) lists every item it carries; `item` (its lowest) must be among them.
    if (has(e, 'items') && !(Array.isArray(e.items) && e.items.length && e.items.every(Number.isInteger) && e.items.includes(e.item))) out.push(`${id}: items must be an array of integers that includes item ${e.item}`);
    if (!Array.isArray(e.beforeCases)) out.push(`${id}: beforeCases must be an array`);
    else for (const c of e.beforeCases) {
      if (!cases.has(c)) out.push(`${id}: beforeCases names missing case ${c}`);
      else if (!replayable(c)) out.push(`${id}: beforeCases case ${c} has no replay.json`);
    }
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const waived = e.beforeCasesWaived === undefined ? {} : isObj(e.beforeCasesWaived) ? e.beforeCasesWaived : null;
    if (!waived) out.push(`${id}: beforeCasesWaived must be an object`);
    else for (const [c, why] of Object.entries(waived)) {
      if (!Array.isArray(e.beforeCases) || !e.beforeCases.includes(c)) out.push(`${id}: beforeCasesWaived names ${c}, which is not a before-case`);
      if (typeof why !== 'string' || why.trim().length < 40) out.push(`${id}: beforeCasesWaived ${c} reason must be at least 40 characters`);
    }
    const declared = isObj(e.declared) ? e.declared : null;
    if (!declared) { out.push(`${id}: declared must be an object`); continue; }
    // A landed migration's diff must show on every case written to pin its before-behaviour (or say why not).
    if (m.landed && Array.isArray(e.beforeCases)) for (const c of e.beforeCases) if (!has(declared, c) && !has(waived, c)) out.push(`${id}: before-case ${c} not declared`);
    const names = Object.keys(declared);
    if (m.landed && names.length === 0) out.push(`${id}: landed but declares no case`);
    for (const c of names) {
      const d = declared[c] ?? {};
      if (!m.landed) out.push(`${id}: not landed but declares ${c}`);
      if (!cases.has(c)) out.push(`${id}: declared case ${c} does not exist`);
      else if (!replayable(c)) out.push(`${id}: declared case ${c} has no replay.json`);
      if (typeof d.reason !== 'string' || d.reason.trim().length < 40) out.push(`${id}: ${c} reason must be at least 40 characters`);
      if (!isPathList(d.changed)) { out.push(`${id}: ${c} changed must be a list of relative paths`); continue; }
      if (d.removed !== undefined && !isPathList(d.removed)) out.push(`${id}: ${c} removed must be a list of relative paths`);
      if (d.exits !== undefined && !(Array.isArray(d.exits) && d.exits.every(Number.isInteger))) out.push(`${id}: ${c} exits must be a list of integers`);
      if (!d.changed.length && !d.removed?.length && !d.exits?.length) out.push(`${id}: ${c} declares no change`);
      for (const p of d.changed) if (!existsSync(join(e.dir, 'expected', c, p))) out.push(`${id}: ${c} missing after-file ${p}`);
      for (const p of d.removed ?? []) if (d.changed.includes(p)) out.push(`${id}: ${c} ${p} is both changed and removed`);
    }
  }
  for (const [c, it] of interactions) {
    const L = `${INTERACTIONS}/${c}`;
    if (!cases.has(c)) out.push(`${L}: case ${c} does not exist`);
    else if (!replayable(c)) out.push(`${L}: case ${c} has no replay.json`);
    const ids = Array.isArray(it.migrations) && it.migrations.every((x) => typeof x === 'string') ? it.migrations : null;
    if (!ids || ids.length < 2 || new Set(ids).size !== ids.length) out.push(`${L}: migrations must name at least 2 distinct migrations`);
    for (const id of ids ?? []) {
      const m = known.get(id);
      if (!m) out.push(`${L}: unknown migration ${id}`);
      else if (!m.landed) out.push(`${L}: migration ${id} has not landed`);
    }
    // At least one named migration must declare the case (not all: writer alone cannot declare before-entry-symlink).
    if (ids && !ids.some((id) => known.get(id) && declOf(entries.get(id), c))) out.push(`${L}: interaction names no migration that declares the case`);
    if (typeof it.reason !== 'string' || it.reason.trim().length < 40) out.push(`${L}: reason must be at least 40 characters`);
    if (!isPathList(it.changed)) { out.push(`${L}: changed must be a list of relative paths`); continue; }
    if (it.removed !== undefined && !isPathList(it.removed)) { out.push(`${L}: removed must be a list of relative paths`); continue; }
    if (it.exits !== undefined && !(Array.isArray(it.exits) && it.exits.every(Number.isInteger))) out.push(`${L}: exits must be a list of integers`);
    else if (it.exits && replayable(c)) {
      const want = expectedExits(join(casesDir, c), JSON.parse(readFileSync(join(casesDir, c, 'replay.json'), 'utf8'))).length;
      if (it.exits.length !== want) out.push(`${L}: exits has ${it.exits.length} value(s), the baseline has ${want}`);
    }
    if (!it.changed.length && !it.removed?.length && !it.exits?.length) out.push(`${L}: declares no change`);
    for (const p of it.changed) if (!existsSync(join(it.dir, 'expected', p))) out.push(`${L}: missing after-file ${p}`);
    for (const p of it.removed ?? []) if (it.changed.includes(p)) out.push(`${L}: ${p} is both changed and removed`);
  }
  return out;
}

/** Baseline files + the declared diff. A declared path that would not change the baseline is a vacuous
 * declaration and throws `declares no change: <case> <path>`. */
export function expectedFor(baselineFiles, declaredCase, readDeclared, caseId = '?') {
  const out = fileMap(Object.entries(baselineFiles));
  for (const p of declaredCase.changed ?? []) {
    const v = readDeclared(p);
    if (has(baselineFiles, p) && baselineFiles[p] === v) throw new Error(`declares no change: ${caseId} ${p}`);
    out[p] = v;
  }
  for (const p of declaredCase.removed ?? []) {
    if (!has(baselineFiles, p)) throw new Error(`declares no change: ${caseId} ${p}`);
    delete out[p];
  }
  return sortFiles(out);
}

const goldDir = (casesDir, c, approvals) => join(casesDir, c, 'expected', approvedEngineOnly(approvals).includes(c) ? 'engine' : '49577c7');

/** The case's baseline oracle: files and exits. */
function baseline(casesDir, c, approvals) {
  const dir = join(casesDir, c);
  const manifest = JSON.parse(readFileSync(join(dir, 'replay.json'), 'utf8'));
  const gold = goldDir(casesDir, c, approvals);
  return { dir, exits: expectedExits(dir, manifest), files: existsSync(gold) ? goldenFiles(gold) : null };
}

// After-files are read under the replay byte policy (Codex B2-03): one that is not valid UTF-8 is a problem.
const readerFor = (entry, c) => (p) => readText(join(entry.dir, 'expected', c, p), `${entry.id}: after-file ${c}/${p}`);

/** The landed migrations declaring case `c`, as `{ id, entry, d }`, in registry (MIGRATIONS) order. */
const declarersOf = (landed, entries, c) => landed.filter((m) => declOf(entries.get(m.id), c)).map((m) => ({ id: m.id, entry: entries.get(m.id), d: declOf(entries.get(m.id), c) }));

const NEEDS_INTERACTION = 'needs an interaction declaration';

/** Spec 12 B2, cumulative: the expected default/all output of case `caseId` composed from the reviewed
 * declarations of the landed migrations declaring it (`declarers`, `{ id, entry, d }` in registry order) and
 * the case's interaction declaration (`interaction`, or null). Disjoint declarations compose exactly; a path
 * (or `exit:<i>`) set by two declarers is a conflict that only the interaction can resolve. The interaction is
 * applied last and overrides the composition: it must cover every conflict; it may override a declared key,
 * conflicted or sole-owned, only when its `migrations` names every owner of that key
 * (`<case>: interaction overrides <key> owned by <id> without naming it`); it may declare keys no migration
 * owns; and a key whose bytes (or exit vector) equal what the composition alone gives is vacuous
 * (`interaction declares no change`). A declared change equal to the baseline, or a removal of a path the
 * baseline lacks, is `declares no change`. Returns `{ files, exits, problems, conflicts, owners }` — `files` is
 * the sorted null-prototype file map (fileMap; Codex P3P-01: `__proto__` is an ordinary path), `exits` the
 * per-event exit vector, `problems` a list of strings, `conflicts` is `[{ key, ids }]` (every one also a
 * problem unless the interaction covers it), and `owners` is a `Map` of every path / `exit:<i>` key a declarer
 * set to the ids that set it (conflicted or not). Nothing here reads the implementation's output. */
export function composeExpected(base, declarers, interaction = null, caseId = '?') {
  const files = fileMap(Object.entries(base.files));
  const exits = [...base.exits];
  const problems = [];
  const owners = new Map(); // path or exit:<i> -> ids that set it
  const conflicted = new Set();
  const own = (k, id) => { const ids = owners.get(k); if (ids) { ids.push(id); conflicted.add(k); return false; } owners.set(k, [id]); return true; };
  for (const { id, entry, d } of declarers) {
    const read = entry ? readerFor(entry, caseId) : () => { throw new Error(`${caseId}: ${id} has no registry entry to read after-files from`); };
    for (const p of d.changed ?? []) {
      let v;
      try { v = read(p); } catch (err) { problems.push(err.message); continue; }
      if (has(base.files, p) && base.files[p] === v) problems.push(`declares no change: ${caseId} ${p}`);
      if (own(p, id)) files[p] = v;
    }
    for (const p of d.removed ?? []) {
      if (!has(base.files, p)) problems.push(`declares no change: ${caseId} ${p}`);
      if (own(p, id)) delete files[p];
    }
    if (d.exits === undefined) continue;
    if (d.exits.length !== base.exits.length) { problems.push(`${caseId}: ${id} declares ${d.exits.length} exit(s), the baseline has ${base.exits.length}`); continue; }
    if (sameExits(d.exits, base.exits)) problems.push(`declares no change: ${caseId} exits`);
    d.exits.forEach((x, i) => {
      if (x === base.exits[i]) return;
      const k = `exit:${i}`;
      if (!owners.has(k)) { owners.set(k, [id]); exits[i] = x; return; }
      owners.get(k).push(id); // every non-baseline declarer owns the event's exit
      if (exits[i] !== x) conflicted.add(k); // the same non-baseline value is no conflict
    });
  }
  const covered = new Set();
  if (interaction) {
    const named = new Set(Array.isArray(interaction.migrations) ? interaction.migrations : []);
    // An interaction may override a declared key only when it names every owner of it (conflicted or sole);
    // otherwise a later or unnamed migration's declared change is silently replaced. Unowned keys are free.
    const mustName = (k) => { for (const id of owners.get(k) ?? []) if (!named.has(id)) problems.push(`${caseId}: interaction overrides ${k} owned by ${id} without naming it`); };
    for (const p of interaction.changed ?? []) {
      let v;
      try { v = readText(join(interaction.dir, 'expected', p), `${INTERACTIONS}/${caseId}: after-file ${p}`); } catch (err) { problems.push(err.message); continue; }
      if (!conflicted.has(p) && has(files, p) && files[p] === v) problems.push(`interaction declares no change: ${caseId} ${p}`);
      mustName(p);
      files[p] = v;
      covered.add(p);
    }
    for (const p of interaction.removed ?? []) {
      if (!conflicted.has(p) && !has(files, p)) problems.push(`interaction declares no change: ${caseId} ${p}`);
      mustName(p);
      delete files[p];
      covered.add(p);
    }
    if (interaction.exits !== undefined) {
      if (interaction.exits.length !== base.exits.length) problems.push(`${caseId}: the interaction declares ${interaction.exits.length} exit(s), the baseline has ${base.exits.length}`);
      else {
        // A declared exit vector is whole: it pins (and covers) every event's exit.
        if (![...conflicted].some((k) => k.startsWith('exit:')) && sameExits(interaction.exits, exits)) problems.push(`interaction declares no change: ${caseId} exits`);
        interaction.exits.forEach((x, i) => {
          const k = `exit:${i}`;
          if (x !== exits[i] || conflicted.has(k)) mustName(k);
          exits[i] = x;
          covered.add(k);
        });
      }
    }
  }
  for (const k of conflicted) if (!covered.has(k)) problems.push(`${caseId}: ${k} is declared by ${owners.get(k).join(' and ')} — ${NEEDS_INTERACTION}`);
  return { files: sortFiles(files), exits, problems, conflicts: [...conflicted].map((key) => ({ key, ids: owners.get(key) })), owners };
}

/** Replay with TOKENOMICS_MIGRATIONS = value; `null` unsets it (runner.mjs), so a run never inherits the caller's value. */
const run = (dir, implDir, value) => runCase(dir, implDir, { extraEnv: { TOKENOMICS_MIGRATIONS: value } });
const landedIds = (migrations) => migrations.filter((m) => m.landed).map((m) => m.id);
/** The interaction for `c` when every migration it names is enabled — in default/all, landed. */
const interactionFor = (interactions, migrations, c) => {
  const it = interactions.get(c);
  const on = new Set(landedIds(migrations));
  return it && Array.isArray(it.migrations) && it.migrations.length && it.migrations.every((id) => on.has(id)) ? it : null;
};

export async function checkMigrations({ implDir, casesDir, registryDir, migrations, approvals = {}, only = null }) {
  const results = [];
  const { entries, interactions, problems: loadProblems } = loadRegistry(registryDir);
  const regProblems = [...loadProblems, ...registryProblems(entries, migrations, casesDir, interactions), ...engineOnlyProblems(casesDir, approvals)];
  if (regProblems.length) results.push({ mode: 'registry', case: '(registry)', problems: regProblems });
  const landed = migrations.filter((m) => m.landed && entries.has(m.id));
  const all = landedIds(migrations);
  const cases = caseDirs(casesDir); // a directory without replay.json is a `no replay.json` row in every mode (as diff-impl)
  // default = the variable unset (the engine's own default); all = the explicit landed list, once one has landed.
  const modes = only ? [`only:${only}`] : ['none', ...landed.map((m) => `only:${m.id}`), 'default', ...(all.length ? ['all'] : [])];
  for (const mode of modes) {
    for (const c of cases) {
      if (!existsSync(join(casesDir, c, 'replay.json'))) { results.push({ mode, case: c, problems: ['no replay.json'] }); continue; }
      let base;
      try { base = baseline(casesDir, c, approvals); } catch (err) { results.push({ mode, case: c, problems: [`baseline: ${err.message}`] }); continue; }
      if (!base.files) { results.push({ mode, case: c, problems: ['no golden'] }); continue; }
      let wantFiles = base.files;
      let wantExits = base.exits;
      let value = 'none';
      const problems = [];
      if (mode.startsWith('only:')) {
        const id = mode.slice(5);
        value = id;
        const entry = entries.get(id);
        const d = declOf(entry, c);
        if (d) {
          try { wantFiles = expectedFor(base.files, d, readerFor(entry, c), c); } catch (err) { problems.push(err.message); }
          if (d.exits) { if (sameExits(d.exits, base.exits)) problems.push(`declares no change: ${c} exits`); wantExits = d.exits; }
        }
      } else if (mode === 'default' || mode === 'all') {
        value = mode === 'default' ? null : all.join(',');
        const comp = composeExpected(base, declarersOf(landed, entries, c), interactionFor(interactions, migrations, c), c);
        problems.push(...comp.problems);
        wantFiles = comp.files;
        wantExits = comp.exits;
      }
      if (problems.length) { results.push({ mode, case: c, problems }); continue; }
      // A replay that refuses its observation (Codex B2-01…03) or cannot run is this case's problem in this mode.
      let r;
      try { r = await run(base.dir, implDir, value); } catch (err) { results.push({ mode, case: c, problems: [`replay: ${err.message}`] }); continue; }
      results.push({ mode, case: c, problems: compareFiles(wantFiles, r.files, wantExits, r.exits), files: r.files, exits: r.exits });
    }
  }
  return { results };
}

const landedEntry = (registryDir, migrations, id) => {
  if (!migrations.some((m) => m.id === id && m.landed)) throw new Error(`migrations: '${id}' is not a landed migration`);
  const { entries } = loadRegistry(registryDir);
  const entry = entries.get(id);
  if (!entry) throw new Error(`migrations: no registry entry for '${id}'`);
  return entry;
};
const outsideCases = (casesDir, out) => { if (relative(casesDir, out).split(/[\\/]/)[0] !== '..') throw new Error(`migrations: refusing to write into the cases tree: ${out}`); };

/** `write <id> <case>…`: replay only:<id> and store the files that differ from the baseline as the
 * declared after-files; record changed/removed and the run's complete exit vector (set when it differs from
 * the baseline, dropped when it equals it). Never writes into the cases tree. */
export async function writeDeclared({ implDir, casesDir, registryDir, migrations, approvals = {}, id, cases }) {
  const entry = landedEntry(registryDir, migrations, id);
  for (const c of cases) if (typeof declOf(entry, c)?.reason !== 'string' || !entry.declared[c].reason.trim()) throw new Error(`migrations: no declared reason for ${c} in ${id}/migration.json — write the reason first`);
  const plans = []; // replay every case first: a refused case leaves the registry untouched
  for (const c of cases) {
    const base = baseline(casesDir, c, approvals);
    if (!base.files) throw new Error(`migrations: ${c} has no baseline golden`);
    const r = await run(base.dir, implDir, id);
    if (r.exits.length !== base.exits.length) throw new Error(`${id}: ${c} ran ${r.exits.length} event(s), the baseline has ${base.exits.length}`);
    const changed = Object.keys(r.files).filter((k) => !has(base.files, k) || r.files[k] !== base.files[k]).sort();
    const removed = Object.keys(base.files).filter((k) => !has(r.files, k)).sort();
    if (!changed.length && !removed.length && sameExits(r.exits, base.exits)) throw new Error(`${id}: ${c} shows no difference from its baseline under only:${id}`);
    const out = join(entry.dir, 'expected', c);
    outsideCases(casesDir, out);
    plans.push({ c, r, base, changed, removed, out });
  }
  for (const { c, r, base, changed, removed, out } of plans) {
    rmSync(out, { recursive: true, force: true });
    for (const k of changed) { mkdirSync(dirname(join(out, k)), { recursive: true }); writeFileSync(join(out, k), r.files[k]); }
    const d = { reason: entry.declared[c].reason, changed };
    if (removed.length) d.removed = removed;
    if (!sameExits(r.exits, base.exits)) d.exits = r.exits;
    entry.declared[c] = d;
  }
  writeFileSync(join(entry.dir, 'migration.json'), `${JSON.stringify(entry, null, 2)}\n`);
}

/** `write-interaction <case>`: replay default and record, in the existing interaction.json (case, migrations,
 * reason and the `changed`/`removed`/`exits` keys to pin, written first by hand), the keys where the run differs
 * from the composition of the declarations alone — but ONLY the conflicted keys (which only the interaction can
 * resolve) and the keys the hand-written interaction already lists. Records the run's exit vector when it differs
 * (or an exit conflicts). The whole candidate declaration (keys, bytes and exits) is computed and validated in
 * memory first (Codex P3P-03); only then are the old after-files removed and the new ones written. Refuses,
 * writing nothing, when: the interaction is missing, has no reason or one under 40 characters, names fewer than 2
 * or an unlanded migration; the case has no replay.json or golden; the declarations do not compose; the run's
 * event count differs; a recorded key — conflicted or not — has an owner the interaction does not name
 * (`<case>: interaction overrides <key> owned by <id> without naming it` for a conflicted key, `the run differs
 * at <key>, owned by <id>, which the interaction does not name` for a sole-owned one); the run differs at any
 * other key the interaction does not list (message names each such key); a key the interaction lists (a path in
 * `changed`/`removed`, or `exits`) shows no difference (`<case>: listed key <key> shows no difference in the
 * default run`); or nothing differs. Never writes into the cases tree. */
export async function writeInteraction({ implDir, casesDir, registryDir, migrations, approvals = {}, caseId: c }) {
  const { entries, interactions } = loadRegistry(registryDir);
  const it = interactions.get(c);
  const L = `${INTERACTIONS}/${c}`;
  if (!it) throw new Error(`migrations: no ${L}/interaction.json — write it with case, migrations and reason first`);
  if (typeof it.reason !== 'string' || !it.reason.trim()) throw new Error(`migrations: ${L}/interaction.json has no reason — write the reason first`);
  if (it.reason.trim().length < 40) throw new Error(`migrations: ${L}/interaction.json reason must be at least 40 characters`);
  if (!Array.isArray(it.migrations) || new Set(it.migrations).size < 2) throw new Error(`migrations: ${L}/interaction.json migrations must name at least 2 landed migrations`);
  for (const id of it.migrations) if (!migrations.some((m) => m.id === id && m.landed)) throw new Error(`migrations: ${L}: '${id}' is not a landed migration`);
  if (!existsSync(join(casesDir, c, 'replay.json'))) throw new Error(`migrations: ${c} has no replay.json`);
  const base = baseline(casesDir, c, approvals);
  if (!base.files) throw new Error(`migrations: ${c} has no baseline golden`);
  const landed = migrations.filter((m) => m.landed && entries.has(m.id));
  const comp = composeExpected(base, declarersOf(landed, entries, c), null, c);
  const conflicted = new Set(comp.conflicts.map((x) => x.key));
  const bad = comp.problems.filter((p) => !p.endsWith(NEEDS_INTERACTION));
  if (bad.length) throw new Error(`migrations: ${c}: the declarations do not compose:\n  ${bad.join('\n  ')}`);
  const r = await run(base.dir, implDir, null);
  if (r.exits.length !== base.exits.length) throw new Error(`migrations: ${c} ran ${r.exits.length} event(s), the baseline has ${base.exits.length}`);
  const paths = [...new Set([...Object.keys(comp.files), ...Object.keys(r.files), ...[...conflicted].filter((k) => !k.startsWith('exit:'))])].sort();
  const changed = paths.filter((p) => has(r.files, p) && (conflicted.has(p) || !has(comp.files, p) || comp.files[p] !== r.files[p]));
  const removed = paths.filter((p) => !has(r.files, p) && (conflicted.has(p) || has(comp.files, p)));
  const exits = [...conflicted].some((k) => k.startsWith('exit:')) || !sameExits(r.exits, comp.exits);
  const exitKeys = exits ? r.exits.map((x, i) => `exit:${i}`).filter((k, i) => conflicted.has(k) || r.exits[i] !== comp.exits[i]) : [];
  const keys = [...changed, ...removed, ...exitKeys];
  // Every recorded key overrides the composition, so every one of its owners must be named — conflicted keys
  // included (Codex P3P-03, Reproduction G). A difference on a sole-owned key an unnamed migration owns is that
  // migration's (or a missing name's) problem, not this interaction's.
  const named = new Set(it.migrations);
  const unnamed = (k) => (comp.owners.get(k) ?? []).filter((id) => !named.has(id));
  const refusals = [];
  for (const k of keys) {
    if (!unnamed(k).length) continue;
    if (conflicted.has(k)) for (const id of unnamed(k)) refusals.push(`${c}: interaction overrides ${k} owned by ${id} without naming it`);
    else refusals.push(`${c}: the run differs at ${k}, owned by ${unnamed(k).join(' and ')}, which the interaction does not name`);
  }
  if (refusals.length) throw new Error(`migrations: ${refusals.join('\n')} — nothing written`);
  // Every remaining difference must already be listed by hand: the tool records, it does not discover.
  const listed = new Set([...(it.changed ?? []), ...(it.removed ?? [])]);
  const unlisted = keys.filter((k) => !conflicted.has(k) && !listed.has(k) && !(k.startsWith('exit:') && it.exits !== undefined));
  if (unlisted.length) throw new Error(`migrations: ${[...new Set(unlisted)].map((k) => `${c}: default run differs at ${k}, not listed in the interaction — add it to changed/removed first, then re-run`).join('\n')}`);
  // And every listed key must show a difference: a listed no-op is refused, not silently dropped.
  const recorded = new Set([...changed, ...removed]);
  const noop = [...[...listed].filter((k) => !recorded.has(k)).sort(), ...(it.exits !== undefined && !exits ? ['exits'] : [])];
  if (noop.length) throw new Error(`migrations: ${noop.map((k) => `${c}: listed key ${k} shows no difference in the default run`).join('\n')} — remove it from the interaction, then re-run; nothing written`);
  if (!changed.length && !removed.length && !exits) throw new Error(`migrations: ${c}: the default-mode output equals the composition of its declarations — no interaction recorded`);
  // The complete candidate, in memory, before any filesystem mutation.
  const { changed: _c, removed: _r, exits: _e, ...head } = it;
  const json = { ...head, changed, ...(removed.length ? { removed } : {}), ...(exits ? { exits: r.exits } : {}) };
  const bytes = changed.map((k) => [k, r.files[k]]);
  const out = join(it.dir, 'expected');
  outsideCases(casesDir, out);
  rmSync(out, { recursive: true, force: true });
  for (const [k, v] of bytes) { mkdirSync(dirname(join(out, k)), { recursive: true }); writeFileSync(join(out, k), v); }
  writeFileSync(join(it.dir, 'interaction.json'), `${JSON.stringify(json, null, 2)}\n`);
}

const gitDiff = (a, b) => spawnSync('git', ['diff', '--no-index', '--', a, b], { encoding: 'utf8' }).stdout;

/** `show-interaction <case>`: a reviewable patch per interaction path, from what the declarations alone give
 * (each declarer's after-file, or the baseline when no declarer touches the path) to the interaction's bytes. */
export function showInteraction({ casesDir, registryDir, migrations, approvals = {}, caseId: c }) {
  const { entries, interactions } = loadRegistry(registryDir);
  const it = interactions.get(c);
  if (!it) throw new Error(`migrations: no ${INTERACTIONS}/${c}/interaction.json`);
  const declarers = declarersOf(migrations.filter((m) => m.landed && entries.has(m.id)), entries, c);
  const gold = goldDir(casesDir, c, approvals);
  const sources = (p) => {
    const own = declarers.filter(({ d }) => d.changed?.includes(p) || d.removed?.includes(p));
    if (!own.length) return [existsSync(join(gold, p)) ? join(gold, p) : '/dev/null'];
    return own.map(({ entry, d }) => (d.changed?.includes(p) ? join(entry.dir, 'expected', c, p) : '/dev/null'));
  };
  let text = `## interaction ${c} (${(it.migrations ?? []).join(', ')}): ${it.reason}\n`;
  for (const p of it.changed ?? []) for (const a of sources(p)) text += gitDiff(a, join(it.dir, 'expected', p));
  for (const p of it.removed ?? []) for (const a of sources(p)) if (a !== '/dev/null') text += gitDiff(a, '/dev/null');
  if (it.exits && existsSync(join(casesDir, c, 'replay.json'))) {
    const base = baseline(casesDir, c, approvals);
    text += `exits: ${JSON.stringify(composeExpected({ ...base, files: base.files ?? fileMap() }, declarers, null, c).exits)} → ${JSON.stringify(it.exits)}\n`;
  }
  return text;
}

/** `show <id>`: a reviewable patch per declared path (git diff --no-index baseline → declared). */
export function showDeclared({ casesDir, registryDir, approvals = {}, id }) {
  const entry = loadRegistry(registryDir).entries.get(id);
  if (!entry) throw new Error(`migrations: no registry entry for '${id}'`);
  if (!Object.keys(entry.declared ?? {}).length) return `${id}: declares no case\n`;
  let text = '';
  for (const [c, d] of Object.entries(entry.declared)) {
    const gold = goldDir(casesDir, c, approvals);
    const pairs = [...(d.changed ?? []).map((p) => [join(gold, p), join(entry.dir, 'expected', c, p)]), ...(d.removed ?? []).map((p) => [join(gold, p), '/dev/null'])];
    text += `## ${id} ${c}: ${d.reason}\n`;
    for (const [a, b] of pairs) text += gitDiff(existsSync(a) ? a : '/dev/null', b);
    if (d.exits) {
      const dir = join(casesDir, c);
      const baseExits = existsSync(join(dir, 'replay.json')) ? expectedExits(dir, JSON.parse(readFileSync(join(dir, 'replay.json'), 'utf8'))) : '?';
      text += `exits: ${JSON.stringify(baseExits)} → ${JSON.stringify(d.exits)}\n`;
    }
  }
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const approvals = JSON.parse(readFileSync(join(ROOT, 'corpus/engine-only.json'), 'utf8'));
  const opts = { ...DEFAULTS, approvals };
  const usage = 'usage: migrations.mjs check [--only <id>] | write <id> <case>... | show <id> | write-interaction <case> | show-interaction <case>';
  try {
    if (cmd === 'check') {
      const i = rest.indexOf('--only');
      const only = i >= 0 ? rest[i + 1] : null;
      if (i >= 0 && !MIGRATIONS.some((m) => m.id === only && m.landed)) throw new Error(`migrations: --only needs a landed migration id, got ${JSON.stringify(only)}`);
      const { results } = await checkMigrations({ ...opts, only });
      let n = 0;
      for (const r of results) for (const p of r.problems) { process.stderr.write(`${r.mode} ${r.case}: ${p}\n`); n++; }
      const modes = new Set(results.filter((r) => r.mode !== 'registry').map((r) => r.mode)).size;
      const cases = new Set(results.filter((r) => r.mode !== 'registry').map((r) => r.case)).size;
      process.stderr.write(`modes ${modes}, cases ${cases}, problems ${n}\n`);
      process.exitCode = n ? 1 : 0;
    } else if (cmd === 'write' && rest.length >= 2) {
      await writeDeclared({ ...opts, id: rest[0], cases: rest.slice(1) });
    } else if (cmd === 'show' && rest.length === 1) {
      process.stdout.write(showDeclared({ ...opts, id: rest[0] }));
    } else if (cmd === 'write-interaction' && rest.length === 1) {
      await writeInteraction({ ...opts, caseId: rest[0] });
    } else if (cmd === 'show-interaction' && rest.length === 1) {
      process.stdout.write(showInteraction({ ...opts, caseId: rest[0] }));
    } else {
      process.stderr.write(`${usage}\n`);
      process.exitCode = 2;
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}
