// Engine settings (spec §14.4): `.agents/tokenomics/settings.json` deep-merged
// over TA_DEFAULTS. Every default is copied byte-for-byte from the reference
// (49577c7) literal it replaced, so an absent settings file reproduces the
// reference output exactly (B1 pure extraction). STDLIB ONLY.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { enabledMigrations, migrationOn } from './migrations.mjs';

const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
};

// The reference-era settings literal. TA_DEFAULTS is the B2 settings contract: since B2 closed it has no
// `ratioIntents` (map §4 step 19, D1: the ratio intents come from each line's manifest revision). B1_DEFAULTS is
// a frozen copy of the reference literal, `ratioIntents` included, that the migrations-off path merges over and
// validates against forever (map D1, obligation O8).
const b1Literal = () => ({
  dir: 'automation',
  receipts: { root: '.agents/automation', file: 'report.json', deliveredOutcomes: ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red'] },
  intents: { default: 'automation' },
  ratioIntents: ['automation'],
  // telemetry-capture.mjs CASE_ID_RE / CASE_ID_MAX / CASE_ID_STOP (regex source copied; matched with flags + 'g')
  ids: {
    patterns: ['\\b[A-Z][A-Z0-9]{1,9}-[A-Z]?\\d{1,6}\\b(?!-\\d)'],
    flags: '',
    max: 50,
    stoplist: ['ISO', 'SHA', 'UTF', 'GPT', 'RFC', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'AES', 'MD', 'CVE', 'OAUTH', 'IPV', 'ERR'],
  },
  vocabulary: { item: 'case', group: 'batch', delivered: 'delivered (automated)' },
  paths: { factoryProfile: 'factory-profile.json' },
  reports: { location: 'tree' },
  extension: './extensions/test-automation.mjs',
});

const { ratioIntents: _b1RatioIntents, ...b2Contract } = b1Literal();
export const TA_DEFAULTS = deepFreeze(b2Contract);
/** Frozen B1 defaults behind `!migrationOn('report-windows')`: `settings.ratioIntents` is honoured only there (D1). */
export const B1_DEFAULTS = deepFreeze(b1Literal());
/** The B1 reading of `settings.ratioIntents` (migrations-off paths only): a Settings built on the B2 contract
 * (`TA_DEFAULTS`, which has no key since B2 closed) takes the frozen B1 default, exactly what `loadSettings`
 * merges in under `none` (D1, O8). */
export const b1RatioIntents = (s) => s?.ratioIntents ?? B1_DEFAULTS.ratioIntents;

const invalid = (reason) => new Error(`tokenomics: invalid .agents/tokenomics/settings.json: ${reason}`);
const isWord = (v) => typeof v === 'string' && v.trim() !== '';

/** Reject a merged Settings the engine cannot run with — at load, never deep inside a hook. The B1 rules
 * (`ratioIntents` required); `validateB2Settings` drops that rule, because with `report-windows` the ratio
 * intents come from each line's manifest revision, never from settings (map D1). */
export function validateSettings(s, { telemetryReports = false } = {}) { return checkSettings(s, { ratioIntents: true, telemetryReports }); }

/** The B2 settings rules: the B1 rules without `ratioIntents` (an ignored key under `report-windows`, D1). */
export function validateB2Settings(s, { telemetryReports = false } = {}) { return checkSettings(s, { ratioIntents: false, telemetryReports }); }

function checkSettings(s, rules) {
  if (!isWord(s.dir)) throw invalid('dir must be a non-empty string');
  if (!isObj(s.receipts)) throw invalid('receipts must be an object');
  if (!isWord(s.receipts.root)) throw invalid('receipts.root must be a non-empty string');
  if (!isWord(s.receipts.file)) throw invalid('receipts.file must be a non-empty string');
  if (!Array.isArray(s.receipts.deliveredOutcomes) || !s.receipts.deliveredOutcomes.every(isWord)) throw invalid('receipts.deliveredOutcomes must be an array of non-empty strings');
  if (!isObj(s.intents) || !isWord(s.intents.default)) throw invalid('intents.default must be a non-empty string');
  if (!isObj(s.paths) || !isWord(s.paths.factoryProfile)) throw invalid('paths.factoryProfile must be a non-empty string');
  if (!isObj(s.reports)) throw invalid('reports.location must be set (reports must be an object)');
  // reports-location (B2 item 10) also accepts 'telemetry'; without it only B1's 'tree'.
  if (s.reports.location !== 'tree' && !(rules.telemetryReports && s.reports.location === 'telemetry')) throw invalid(`unsupported reports.location '${s.reports.location}' (${rules.telemetryReports ? "supported: 'tree', 'telemetry'" : "B1 supports 'tree'"})`);
  if (rules.ratioIntents && (!Array.isArray(s.ratioIntents) || !s.ratioIntents.length || !s.ratioIntents.every(isWord))) throw invalid('ratioIntents must be a non-empty array of strings');
  const { patterns, flags = '', max, stoplist } = s.ids ?? {};
  if (typeof flags !== 'string' || flags.includes('g')) throw invalid(`ids.flags must be a string without 'g' (the miner adds it), got ${JSON.stringify(flags)}`);
  if (!Array.isArray(patterns) || !patterns.length) throw invalid('ids.patterns must be a non-empty array of regex sources');
  for (const src of patterns) {
    if (typeof src !== 'string') throw invalid(`ids.patterns entry ${JSON.stringify(src)} is not a string`);
    try { new RegExp(src, `${flags}g`); } catch (e) { throw invalid(`ids.patterns entry ${JSON.stringify(src)}: ${e.message}`); }
  }
  if (!Number.isInteger(max) || max < 1) throw invalid('ids.max must be a positive integer');
  if (!Array.isArray(stoplist) || !stoplist.every((x) => typeof x === 'string')) throw invalid('ids.stoplist must be an array of strings');
  if (s.ids.rules !== undefined) checkIdRules(s.ids.rules);
  if (!isWord(s.vocabulary?.item) || !isWord(s.vocabulary?.group)) throw invalid('vocabulary.item and vocabulary.group must be non-empty strings');
  if (!isWord(s.vocabulary.delivered)) throw invalid('vocabulary.delivered must be a non-empty string');
  if (s.extension !== null && !isWord(s.extension)) throw invalid('extension must be a module path string or null');
  return s;
}

/** Validate `ids.rules` (Plan 7 D-RULES): load time only, never in a hook. Errors name the rule's index. */
function checkIdRules(rules) {
  if (!Array.isArray(rules)) throw invalid('ids.rules must be an array');
  rules.forEach((r, i) => {
    const at = `ids.rules[${i}]`;
    if (!isObj(r)) throw invalid(`${at} must be an object`);
    if (typeof r.pattern !== 'string') throw invalid(`${at}.pattern must be a string`);
    const flags = r.flags ?? '';
    if (typeof flags !== 'string' || flags.includes('g')) throw invalid(`${at}.flags must be a string without 'g' (the miner adds it), got ${JSON.stringify(flags)}`);
    try { new RegExp(r.pattern, `${flags}g`); } catch (e) { throw invalid(`${at}.pattern ${JSON.stringify(r.pattern)}: ${e.message}`); }
    if (typeof r.normalize !== 'string' || !/^[a-z][a-z0-9]*:/.test(r.normalize)) throw invalid(`${at}.normalize must be a string starting with a lowercase prefix and ':' (e.g. 'gh:$1')`);
    const groups = new RegExp(`${r.pattern}|`, flags).exec('').length - 1;
    if (/\$(?![1-9](?!\d))/.test(r.normalize)) throw invalid(`${at}.normalize may use only the placeholders $1-$9, got ${JSON.stringify(r.normalize)}`);
    for (const m of r.normalize.matchAll(/\$([1-9])/g)) if (+m[1] > groups) throw invalid(`${at}.normalize uses $${m[1]} but the pattern has ${groups} capture group(s)`);
    if (r.source !== undefined && r.source !== 'any' && r.source !== 'branch') throw invalid(`${at}.source must be 'any' or 'branch', got ${JSON.stringify(r.source)}`);
  });
}

// Every entry point loads settings, so a bad migration variable fails here instead of silently running the default.
// Without `report-windows` (`none`, or any set lacking it) settings merge over the frozen B1_DEFAULTS and take the
// B1 rules, so `none` keeps reading `settings.ratioIntents` after B2 closes (D1, O8).
export function loadSettings(repo, env = process.env) {
  enabledMigrations(env);
  const b1 = !migrationOn('report-windows', env);
  const base = b1 ? B1_DEFAULTS : TA_DEFAULTS;
  const p = join(repo, '.agents', 'tokenomics', 'settings.json');
  if (!existsSync(p)) return base;
  let doc;
  try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw invalid(e.message); }
  if (!isObj(doc)) throw invalid('not an object');
  // A present file never inherits the TA extension silently: it names its extension (a path, relative to
  // the repo root — spec §14.4) or opts out with null. Only the absent-file TA default resolves in the engine.
  if (!('extension' in doc)) throw invalid('extension must be set explicitly (path or null)');
  const rl = migrationOn('reports-location', env);
  const merged = merge(base, doc);
  // Q13b: a present file that omits reports.location relocates, unless the effective extension is test-automation.
  if (rl && (doc.reports === undefined || (isObj(doc.reports) && !('location' in doc.reports)))) merged.reports = { ...merged.reports, location: effectiveReportsLocation(doc, true) };
  return deepFreeze(b1 ? validateSettings(merged, { telemetryReports: rl }) : validateB2Settings(merged, { telemetryReports: rl }));
}

const isTaExtension = (ext) => typeof ext === 'string' && /(^|[\\/])test-automation(\.mjs)?$/.test(ext);

/** The reports location a settings document yields (owner Q13b). `doc` is the settings file as written (null when
 * there is none), `present` whether the file exists: the explicit value wins; else 'tree' for no file or an
 * effective test-automation extension (spec 14.8 item 10, "TA keeps its in-tree layout"); else 'telemetry'. */
export function effectiveReportsLocation(doc, present) {
  const explicit = doc?.reports?.location;
  if (explicit !== undefined) return explicit;
  if (!present || !doc || isTaExtension(doc.extension)) return 'tree';
  return 'telemetry';
}

/** The module's telemetry directory: `.agents/telemetry/<dir>`, or `<TOKENOMICS_STATE_DIR>/telemetry/<dir>` while a
 * probe runs (D-PROBE), so the ledger, scopes and markers of a probe session never touch the repo's store. Every
 * scope, marker and ledger path is built from this one function. Unset or empty: the repo path, unchanged. */
export const telemetryDir = (repo, s, env = process.env) => (env.TOKENOMICS_STATE_DIR
  ? join(env.TOKENOMICS_STATE_DIR, 'telemetry', s.dir)
  : join(repo, '.agents', 'telemetry', s.dir));
export const receiptsRoot = (repo, s) => join(repo, s.receipts.root);

/** Where a group's rendered reports (and cost.json) go: the receipt directory under 'tree' (B1, TA), or
 * `.agents/telemetry/<dir>/reports/<group path>/` under 'telemetry' (reports-location, Q13a). */
export function groupReportsDir(repo, s, group) {
  if (s.reports.location === 'telemetry') return join(telemetryDir(repo, s), 'reports', ...group.split('/'));
  if (s.reports.location !== 'tree') throw new Error(`tokenomics: unsupported reports.location '${s.reports.location}'`);
  return join(receiptsRoot(repo, s), ...group.split('/'));
}

/** Where a batch's LIVE page goes. Reference layout (and 'tree'): `<telemetry>/reports/<batch with / as ->.html`.
 * Under 'telemetry' (reports-location, Codex B2-10) group directories own `reports/<group path>/`, and a group slug may
 * be any directory name (`foo` and `foo.html` are both valid), so the live pages leave that namespace for
 * `<telemetry>/reports-live/<percent-encoded batch>.html`: no slug can make a `reports-live` sibling of `reports`
 * collide with a group, and the encoding is injective, so `a/b` and `a-b` (which the reference folds together) stay distinct. */
export function liveReportPath(repo, s, batch) {
  const name = String(batch);
  if (s.reports?.location === 'telemetry') return join(telemetryDir(repo, s), 'reports-live', `${encodeURIComponent(name)}.html`);
  return join(telemetryDir(repo, s), 'reports', `${name.replace(/\//g, '-')}.html`);
}

/** The miner's regexes, built from the configured sources (always global). */
export const idPatterns = (s) => s.ids.patterns.map((src) => new RegExp(src, `${s.ids.flags ?? ''}g`));

const ruleCache = new WeakMap(); // settings.ids → compiled rules
const EMPTY_RULES = Object.freeze({ rules: Object.freeze([]), prefixes: new Set() });
/** The compiled `ids.rules` (Plan 7): `{rules: [{re, normalize, source}], prefixes}`, cached per `settings.ids`. */
export function idRules(s) {
  const ids = s.ids;
  if (!Array.isArray(ids?.rules) || !ids.rules.length) return EMPTY_RULES;
  let c = ruleCache.get(ids);
  if (!c) {
    const rules = ids.rules.map((r) => ({ re: new RegExp(r.pattern, `${r.flags ?? ''}g`), normalize: r.normalize, source: r.source ?? 'any' }));
    c = { rules, prefixes: new Set(rules.map((r) => r.normalize.match(/^([a-z][a-z0-9]*):/)[1])) };
    ruleCache.set(ids, c);
  }
  return c;
}

const plural = (w) => (/(s|x|z|ch|sh)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
/** Rendered vocabulary forms derived from the scalar `vocabulary.item` / `vocabulary.group` words. */
export function words(s) {
  const { item, group } = s.vocabulary;
  return {
    item, items: plural(item), Item: cap(item), Items: cap(plural(item)),
    group, groups: plural(group), Group: cap(group), Groups: cap(plural(group)),
  };
}
