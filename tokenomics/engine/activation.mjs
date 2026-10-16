// The activation gate (Plan 5 D-ACT, spec §14.2 / §18.5, owner Q3). A copied engine is inert until the repo's
// `.agents/tokenomics/settings.json` records `"engine": "<the copy's ENGINE.json engine>"` (D-REC, written last by
// install-hooks), and an installed copy refuses TOKENOMICS_MIGRATIONS outright: the production switch set is {} and
// the migration lever is the harness's, never production's.
//
//   source  — ENGINE.json absent, or `installed` null: the source checkout and reference-era copies. Never gated.
//   active  — an installed copy whose activation record names its engine version.
//   inert   — an installed copy with no activation, another version's activation (an interrupted upgrade), or an
//             unreadable ENGINE.json (a present but unreadable manifest is never `source`).
//   refused — an installed copy run with TOKENOMICS_MIGRATIONS set to any non-empty value (empty is unset, R11).
//             Every other entry refuses too: enabledMigrations throws in an installed copy (R12).
//
// Every writer entry point calls `gateOrExplain` first; only `source` and `active` proceed. The gate never throws:
// settings.json is read raw (not through loadSettings, which throws on a bad file or a bad migration variable), and
// a hook must never fail the host. STDLIB ONLY.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationOn, REFUSED_MESSAGE } from './migrations.mjs';

// Set = non-empty after trimming: empty or whitespace-only is unset, as in enabledMigrations (R11).
const migrationsSet = (env) => { const raw = env.TOKENOMICS_MIGRATIONS; return raw !== undefined && raw.trim() !== ''; };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** The engine root (`tokenomics/`, or an installed copy's skill directory) of an entry module: its realpath, two
 * levels up (`<root>/hooks/x.mjs`, `<root>/scripts/x.mjs`). */
export function engineRootOf(importMetaUrl) {
  const file = fileURLToPath(importMetaUrl);
  let real = file;
  try { real = realpathSync(file); } catch { /* unresolvable: the path as given */ }
  return dirname(dirname(real));
}

const rootPath = (engineRoot) => (typeof engineRoot === 'string' ? engineRoot : fileURLToPath(engineRoot));

// ENGINE.json as { absent } | { doc } | { unreadable }. Only a missing file is `absent`.
function readManifest(root) {
  let raw;
  try { raw = readFileSync(join(root, 'ENGINE.json'), 'utf8'); } catch (e) { return e?.code === 'ENOENT' ? { absent: true } : { unreadable: true }; }
  try {
    const doc = JSON.parse(raw);
    return isObj(doc) ? { doc } : { unreadable: true };
  } catch { return { unreadable: true }; }
}

export function activationState(engineRoot, repo, env = process.env) {
  const root = rootPath(engineRoot);
  const m = readManifest(root);
  if (m.absent) return { state: 'source', engine: null, recorded: null, reason: 'no engine manifest' };
  if (m.unreadable) return { state: 'inert', engine: null, recorded: null, reason: 'engine manifest unreadable' };
  const { doc } = m;
  if (doc.installed === null || doc.installed === undefined) {
    return { state: 'source', engine: typeof doc.engine === 'string' ? doc.engine : null, recorded: null, reason: 'source checkout' };
  }
  const engine = typeof doc.engine === 'string' && doc.engine ? doc.engine : null;
  // Q3: the production switch set is {} — an installed copy refuses the variable whatever its value.
  if (migrationsSet(env)) {
    return { state: 'refused', engine, recorded: null, reason: 'TOKENOMICS_MIGRATIONS is set in an installed engine' };
  }
  if (!engine) return { state: 'inert', engine: null, recorded: null, reason: 'engine manifest unreadable' };
  let settings;
  try { settings = JSON.parse(readFileSync(join(repo, '.agents', 'tokenomics', 'settings.json'), 'utf8')); }
  catch (e) {
    if (e?.code === 'ENOENT') return { state: 'inert', engine, recorded: null, reason: 'not activated' };
    return { state: 'inert', engine, recorded: null, reason: 'settings.json unreadable' };
  }
  const recorded = isObj(settings) && typeof settings.engine === 'string' ? settings.engine : null;
  if (recorded === engine) return { state: 'active', engine, recorded, reason: 'activated' };
  return { state: 'inert', engine, recorded, reason: recorded === null ? 'not activated' : 'activation names another engine version' };
}

// How to name the skill directory in a remedy: relative to the repo when it lies inside it.
function skillPath(root, repo) {
  try {
    let base = repo;
    try { base = realpathSync(repo); } catch { /* as given */ }
    const rel = relative(base, root);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
  } catch { /* fall through */ }
  return root;
}

function hostHint(root) {
  const m = readManifest(root);
  const target = m.doc?.installed?.target;
  return target === 'claude' ? 'claude' : target === 'copilot' ? '<copilot-cli|vscode>' : '<claude|copilot-cli|vscode>';
}

/** The one stderr line an inert or refused entry prints (cause and remedy), or null for `source` / `active`. */
export function explain(st, engineRoot, repo) {
  if (st.state === 'source' || st.state === 'active') return null;
  if (st.state === 'refused') return REFUSED_MESSAGE;
  const root = rootPath(engineRoot);
  if (st.reason === 'engine manifest unreadable') {
    return `tokenomics: inactive — engine manifest unreadable (${join(root, 'ENGINE.json')}; reinstall: harness-telemetry install tokenomics --target <claude|copilot>)`;
  }
  const run = `run: node ${join(skillPath(root, repo), 'scripts', 'install-hooks.mjs')} --host ${hostHint(root)}`;
  if (st.reason === 'settings.json unreadable') return `tokenomics: inactive — engine ${st.engine} copied but .agents/tokenomics/settings.json is unreadable (fix it, then ${run})`;
  if (st.recorded !== null) return `tokenomics: inactive — engine ${st.engine} copied but activation records engine ${st.recorded} (${run})`;
  return `tokenomics: inactive — engine ${st.engine} copied but not activated (${run})`;
}

/** True for `source` and `active`; otherwise one stderr line naming the cause and the remedy, then false. Never
 * throws: a gate failure must not fail the host. */
export function gateOrExplain(engineRoot, repo, env = process.env) {
  try {
    const st = activationState(engineRoot, repo, env);
    const line = explain(st, engineRoot, repo);
    if (line === null) return true;
    try { process.stderr.write(`${line}\n`); } catch { /* stderr gone — still inert */ }
    return false;
  } catch (e) {
    try { process.stderr.write(`tokenomics: inactive — activation check failed (${e?.message ?? e})\n`); } catch { /* ignore */ }
    return false;
  }
}

/** The `entry-points` switch as an entry's main guard reads it at import. In a gated copy (installed or with an
 * unreadable manifest) run with TOKENOMICS_MIGRATIONS set, the variable is never parsed — it may name no migration and would throw before the
 * gate could explain — and the landed guard (realpath main check, drained exit) is used. Elsewhere: migrationOn. */
export function entryPointsOn(engineRoot, env = process.env) {
  if (migrationsSet(env)) {
    const m = readManifest(rootPath(engineRoot));
    if (m.unreadable || (m.doc && m.doc.installed !== null && m.doc.installed !== undefined)) return true;
  }
  return migrationOn('entry-points', env);
}

/** The gate for a report or export CLI run as an entry (R19). Always refuses an installed copy run with
 * TOKENOMICS_MIGRATIONS set (R12); an inert copy is refused only when the run `writes` (under `.agents/` or into a
 * receipts directory): read-only runs stay available. Prints the one explanation line to stderr and returns false to
 * refuse (the entry exits 1 and writes nothing); true for `source`, `active`, and read-only runs of an inert copy.
 * Call it before the settings load: loadSettings throws the refusal as a stack trace. Never throws. */
export function gateCli(engineRoot, repo, { writes = true } = {}, env = process.env) {
  try {
    const st = activationState(engineRoot, repo, env);
    if (st.state === 'source' || st.state === 'active') return true;
    if (st.state === 'inert' && !writes) return true;
    const line = explain(st, engineRoot, repo);
    try { process.stderr.write(`${line}\n`); } catch { /* stderr gone */ }
    return false;
  } catch (e) {
    try { process.stderr.write(`tokenomics: inactive — activation check failed (${e?.message ?? e})\n`); } catch { /* ignore */ }
    return false;
  }
}
