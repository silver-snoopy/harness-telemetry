// Shared helpers for the receipt adapters (Plan 7 layer 3, D-ADAPTERS). An adapter is read-only: it asks a tracker
// for the status of the ids the ledger names and prints the spec §5.6 envelope on stdout. STDLIB ONLY.
//
// PRIVACY: a case is built from an explicit projection (projectCase) and nothing else; a failure is one line
// `<adapter>: <class> (<status or code>)` that never carries a body, header, URL query, token or CLI stderr.
import { resolve } from 'node:path';
import { loadLines } from '../scripts/team-report.mjs';

/** The credential env names an adapter may read (never settings, never argv). Jira/ADO use them in Tasks 6 and 7. */
export const CREDENTIAL_ENV = Object.freeze(['AZURE_DEVOPS_EXT_PAT', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PAT']);

/** A classed failure. `cls` and `code` are short tokens; `exit` is 1 (the tracker failed) or 2 (bad usage/config). */
export class AdapterFailure extends Error {
  constructor(cls, code, exit = 1) {
    super(`${cls} (${code})`);
    this.cls = cls;
    this.code = code;
    this.exit = exit;
  }
}

/** Throw an AdapterFailure; the CLI entry's top-level handler (reportFailure) prints it, so library code never exits. */
export function fail(adapter, cls, code, exit = 1) {
  void adapter;
  throw new AdapterFailure(cls, code, exit);
}

/** Print the one failure line and return the exit code. Anything that is not an AdapterFailure is `internal (error)`. */
export function reportFailure(adapter, e, write = (s) => process.stderr.write(s)) {
  const known = e instanceof AdapterFailure;
  write(`${adapter}: ${known ? e.cls : 'internal'} (${known ? e.code : 'error'})\n`);
  return known ? e.exit : 1;
}

const SAFE_CODE = /^[A-Za-z0-9_-]{1,40}$/;
const safeCode = (c, dflt) => (typeof c === 'string' && SAFE_CODE.test(c) ? c : dflt);

/** `{ids?, repo, baseUrl?, maxPages}` from argv, or `{error}` for an unknown flag or a bad value. */
export function parseArgs(argv) {
  const out = { ids: undefined, repo: process.cwd(), baseUrl: undefined, maxPages: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!['--ids', '--repo', '--base-url', '--max-pages'].includes(a)) return { error: `unknown flag ${a}` };
    if (i + 1 >= argv.length) return { error: `${a} needs a value` };
    const v = argv[++i];
    if (a === '--ids') out.ids = v.split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--repo') out.repo = resolve(v);
    else if (a === '--base-url') out.baseUrl = v;
    else {
      if (!/^[1-9]\d{0,3}$/.test(v)) return { error: '--max-pages must be a positive integer' };
      out.maxPages = Number(v);
    }
  }
  return out;
}

/** Validate `raw` ids: strip the exact `prefix`, keep those matching `re`. `{ids (unique, sorted), invalid (distinct)}`. */
export function selectIds(raw, prefix, re) {
  const ok = new Set();
  const bad = new Set();
  for (const r of raw) {
    const id = typeof r === 'string' && r.startsWith(prefix) ? r.slice(prefix.length) : null;
    if (id !== null && re.test(id)) ok.add(id);
    else bad.add(typeof r === 'string' ? r : `\0${typeof r}`);
  }
  return { ids: [...ok].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), invalid: bad.size };
}

/** Every id carrying `prefix` in the repo's ledger (team-report's loadLines: `cases` or `scope.cases`), validated. */
export function idsFromLedger(repo, settings, prefix, re) {
  const named = new Set();
  for (const l of loadLines([repo], settings)) {
    const cs = Array.isArray(l.cases) ? l.cases : Array.isArray(l.scope?.cases) ? l.scope.cases : [];
    for (const c of cs) if (typeof c === 'string' && c.startsWith(prefix)) named.add(c);
  }
  return selectIds([...named], prefix, re);
}

/** The §5.6 envelope. No cases means no receipt group at all. */
export function envelope(group, source, cases, complete) {
  return { schema: 1, complete: Boolean(complete), receipts: cases.length ? [{ group, source, cases }] : [] };
}

const str64 = (v) => (typeof v === 'string' && v ? v.slice(0, 64) : undefined);
const isoish = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : undefined);

/** The D-ADAPTERS projection: `{id, outcome, at?, atSource?, type?, points?, sprint?}` and nothing else. */
export function projectCase(raw) {
  const out = { id: String(raw.id).slice(0, 64), outcome: String(raw.outcome).slice(0, 64) };
  const at = isoish(raw.at);
  if (at) { out.at = at; const s = str64(raw.atSource); if (s) out.atSource = s; }
  const type = str64(raw.type);
  if (type) out.type = type;
  if (typeof raw.points === 'number' && Number.isFinite(raw.points)) out.points = raw.points;
  const sprint = str64(raw.sprint);
  if (sprint) out.sprint = sprint;
  return out;
}

/** `arr` in consecutive chunks of at most `n`. */
export function batches(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The tracker base URL, without a trailing slash. `override` (--base-url or TOKENOMICS_TRACKER_BASE_URL, the engine's
 * test lever) wins over `configured`. https always; http only for a loopback host. No embedded credentials. Refusal is
 * a config failure (exit 2).
 */
export function baseUrl(configured, override) {
  const raw = override ?? configured;
  const refuse = () => { throw new AdapterFailure('config', 'base-url', 2); };
  if (typeof raw !== 'string' || !raw) refuse();
  let u;
  try { u = new URL(raw); } catch { refuse(); }
  if (u.username || u.password) refuse();
  if (u.protocol === 'http:' ? !LOOPBACK.has(u.hostname) : u.protocol !== 'https:') refuse();
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

/** The env override for baseUrl (engine-owned test lever, allowlisted). */
export const baseUrlOverride = (cli) => cli ?? (process.env.TOKENOMICS_TRACKER_BASE_URL || undefined);

/**
 * Fetch JSON. Throws an AdapterFailure `{cls, code}` and never the response body: `http` (status), `timeout`,
 * `network` (the error's code), `parse` (not JSON). `body` may be an object (sent as JSON).
 */
export async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 30000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new AdapterFailure('timeout', 'timeout');
    throw new AdapterFailure('network', safeCode(e?.cause?.code, 'fetch'));
  }
  if (!res.ok) { try { await res.body?.cancel(); } catch { /* the body is never read */ } throw new AdapterFailure('http', res.status); }
  let text;
  try { text = await res.text(); } catch (e) { throw new AdapterFailure(e?.name === 'TimeoutError' ? 'timeout' : 'network', e?.name === 'TimeoutError' ? 'timeout' : 'body'); }
  try { return JSON.parse(text); } catch { throw new AdapterFailure('parse', 'json'); }
}

/** `process.env` without the tracker credentials: the environment for any child an adapter spawns (least privilege). */
export const scrubbedEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !CREDENTIAL_ENV.includes(k)));
