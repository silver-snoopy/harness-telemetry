// Extension loader (spec §14.3): the TA behaviour the engine does not own lives
// in an optional extension module named by settings.extension (null = none). A
// settings file's relative path resolves against the repo root (spec §14.4); only
// the built-in TA default (no settings file) resolves against the engine root. Every hook is optional; the engine never calls a
// missing one — each call site supplies its own engine default via `??`.
// STDLIB ONLY.
import { appendFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TA_DEFAULTS, B1_DEFAULTS } from './config.mjs';

/** Extension API 2, frozen after the last B2 migration (decision D3, Plan 4 Task 21); C1 targets it. An
 * incompatible change to a call's parts, input, ctx or return contract is API 3. ENGINE-B1.md "Extension API"
 * is the contract. The check is strict and does not consult TOKENOMICS_MIGRATIONS (API 1 modules are rejected). */
export const EXTENSION_API = 2;

/** The documented extension calls (ENGINE-B1.md's API 2 contract table mirrors this list; a test keeps them equal,
 * and keeps each call's documented `part` set equal to the parts the corpus trace records), as the hook trace writes
 * them: `name` for the phase-less spec §14.3 call, `name:phase` otherwise. */
export const HOOK_CALLS = Object.freeze([
  'classifyDispatch', 'classifyDispatch:stage-names', 'classifyDispatch:case-init', 'classifyDispatch:direct',
  'classifyDispatch:overhead', 'classifyDispatch:case-out', 'classifyDispatch:overhead-out', 'classifyDispatch:group-out',
  'classifyDispatch:render-md', 'classifyDispatch:render-html', 'classifyDispatch:render-tok-md', 'classifyDispatch:render-tok-html',
  'labelFrom',
  'receiptIds',
  'enrichGroup:case', 'enrichGroup:records', 'enrichGroup:sizing', 'enrichGroup:match', 'enrichGroup:by-group', 'enrichGroup:delivered-note',
  'enrichGroup:render-md', 'enrichGroup:render-html', 'enrichGroup:render-tok-md',
  'onClose', 'onClose:report', 'onClose:no-receipt',
  'stopGateCheck',
  'exportRow:segment', 'exportRow:item', 'exportRow:scenarios', 'exportRow:size', 'exportRow:effort', 'exportRow:notes',
  'exportRow:checklist', 'exportRow:anonymize', 'exportRow:submission', 'exportRow:compare', 'exportRow:no-profile',
]);

/** Documented calls the corpus replay never reaches, each with the reason (corpus/engine.test.mjs asserts every
 * other HOOK_CALLS entry is called on the corpus, and that these are not — reach one and it must leave this list).
 * Empty since plan-2-patch Task 4: the export CLI cases (`cov-export-*`, `fault-export-usage`) reach the last four
 * (`exportRow` `anonymize`, `submission`, `compare`, `no-profile`). */
export const CORPUS_UNREACHED = Object.freeze({});
/** The engine root (`tokenomics/`), against which the built-in TA default extension resolves. */
export const ENGINE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The extension module's file path, or null when `settings.extension` is null. `repo` is the root a
 * settings-supplied relative path resolves against; the untouched TA default (`settings === TA_DEFAULTS` or `B1_DEFAULTS`,
 * i.e. no settings file) resolves against `engineRoot`. */
export function extensionPath(settings, repo, engineRoot = ENGINE_ROOT) {
  if (!settings.extension) return null;
  if (isAbsolute(settings.extension)) return settings.extension;
  const base = settings === TA_DEFAULTS || settings === B1_DEFAULTS ? engineRoot : repo;
  if (!base) throw new Error('tokenomics: loadExtension needs the repo root to resolve a settings extension path');
  return join(base, settings.extension);
}

export async function loadExtension(settings, repo, engineRoot = ENGINE_ROOT) {
  const p = extensionPath(settings, repo, engineRoot);
  if (p === null) return null;
  let mod;
  try { mod = await import(pathToFileURL(p).href); } catch (e) { throw new Error(`tokenomics: cannot load extension ${p}: ${e.code ?? e.message}`); }
  if (mod.extensionApi !== EXTENSION_API) throw new Error('tokenomics: extension API mismatch');
  return mod;
}

const thenable = (v) => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
const promiseReported = new Set();

/** Call `ext[name](...args)` when the extension has that hook, else `undefined`.
 * Hooks are synchronous (API 2): a thenable result throws `tokenomics: extension hook <name> returned a Promise
 * (hooks are synchronous)` (code `ERR_EXTENSION_ASYNC_HOOK`) instead of being spread or concatenated by the call
 * site. Several reference call sites are best-effort and swallow a throw (close's `onClose`, the capture's sweep),
 * so the message also goes to stderr, once per hook name per process, and the Promise's own rejection is handled.
 * HT_EXT_TRACE_FILE (replay tooling) records every hook actually called, one `name:phase#part` per line
 * (`phase` = the ctx argument's `phase`, the bare `name` for a phase-less call; `#part` = `ctx.part`, or `ctx.slot`
 * for `exportRow:checklist`, only when present). */
export function hook(ext, name, ...args) {
  if (!ext || typeof ext[name] !== 'function') return undefined;
  if (process.env.HT_EXT_TRACE_FILE) {
    const phase = args[1]?.phase;
    const part = args[1]?.part ?? args[1]?.slot;
    try { appendFileSync(process.env.HT_EXT_TRACE_FILE, `${phase ? `${name}:${phase}` : name}${part ? `#${part}` : ''}\n`); } catch { /* tracing is tooling: never break a hook call */ }
  }
  const out = ext[name](...args);
  if (!thenable(out)) return out;
  const message = `tokenomics: extension hook ${name} returned a Promise (hooks are synchronous)`;
  try { Promise.resolve(out).catch(() => {}); } catch { /* a hostile thenable: the named error below still stands */ }
  if (!promiseReported.has(name)) {
    promiseReported.add(name);
    try { process.stderr.write(`${message}\n`); } catch { /* reporting must never mask the throw */ }
  }
  throw Object.assign(new Error(message), { code: 'ERR_EXTENSION_ASYNC_HOOK' });
}
