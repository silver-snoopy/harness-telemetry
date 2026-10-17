#!/usr/bin/env node
// jira.mjs — Jira receipt adapter (Plan 7 layer 3, D-ADAPTERS). Read-only.
//
//   node jira.mjs [--ids jira:PAY-1,jira:PAY-2] [--repo <path>] [--base-url <loopback url>] [--max-pages N]
//
// Prints the spec §5.6 envelope for the keys (default: every `jira:` id in the repo's ledger). Settings:
// `tracker: {kind:'jira', url:'https://<site>.atlassian.net', fields?:{points?, sprint?}, server?:false}`.
//   Cloud   JIRA_EMAIL + JIRA_API_TOKEN (Basic): POST /rest/api/3/issue/bulkfetch {issueIdsOrKeys (at most 100),
//           fields}, one call per 100 keys. A key that does not exist or is not visible is simply not returned, and a
//           retriable failure is listed in `issueErrors`; either is a missing key (complete:false), never a failed call.
//   Server  `server:true`, JIRA_PAT (Bearer): POST /rest/api/2/search {jql, fields, startAt, maxResults,
//           validateQuery:false} until total; the DC API types it as a boolean, and `false` keeps one unknown key from failing
//           the whole query (the unknown key is just not returned).
// `--max-pages` caps the number of requests either way.
// Cloud credentials only go to https *.atlassian.net; Server/DC is self-hosted, so any https host named by the
// settings url is allowed there. Either may go to a loopback test server named by --base-url /
// TOKENOMICS_TRACKER_BASE_URL (http only for loopback).
//
// Server JQL is `key in (K1,K2,…)` over validated keys only (at most 100 per query); nothing else is ever
// interpolated, and there is no unbounded fallback. Delivered = `status.statusCategory.key == 'done'`; `at` is `resolutiondate`, only
// for a delivered issue and only when present.
//
// PRIVACY: only status category, issue type, resolution date and the two configured custom fields are requested and
// projected; summaries, people, comments, URLs and bodies never leave this file. Failures are one
// `jira: <class> (<code>)` line. STDLIB ONLY.
import { pathToFileURL } from 'node:url';
import { loadSettings } from '../engine/config.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { AdapterFailure, parseArgs, selectIds, idsFromLedger, envelope, projectCase, reportFailure, batches, baseUrl, baseUrlOverride, httpJson } from './common.mjs';

const ADAPTER = 'jira';
const SOURCE = 'jira';
const PREFIX = 'jira:';
// no leading zero in the issue number: `PAY-01` and `PAY-1` must not be two aliases for one issue
const ID = /^[A-Z][A-Z0-9]+-[1-9]\d*$/;
const PER_QUERY = 100;
const CUSTOM = /^customfield_\d{1,9}$/;
const BASE_FIELDS = ['status', 'issuetype', 'resolutiondate'];
const CLOUD_HELP = 'set JIRA_EMAIL and JIRA_API_TOKEN';
const SERVER_HELP = 'set JIRA_PAT';
const USAGE = 'usage: jira.mjs [--ids jira:PAY-1,jira:PAY-2] [--repo <path>] [--base-url <loopback url>] [--max-pages N]';
const config = (code) => new AdapterFailure('config', code, 2);

/**
 * Where to POST, and what the group is called: `{url, host, server}`. Cloud: `settings.tracker.url` must be https on
 * `<site>.atlassian.net` (no port, no credentials), because the credential goes there. Server/DC: https on any host
 * (self-hosted), the path kept as the context path. An override (--base-url or TOKENOMICS_TRACKER_BASE_URL) is the
 * server root, https or loopback http. Throws a config failure (exit 2).
 */
export function endpointOf(settings, override) {
  const t = settings?.tracker ?? {};
  if (t.server !== undefined && typeof t.server !== 'boolean') throw config('server');
  const server = t.server === true;
  let u;
  try { u = new URL(t.url); } catch { throw config('url'); }
  if (u.username || u.password || u.protocol !== 'https:') throw config('url');
  const host = u.hostname.toLowerCase();
  if (!server && (u.port || !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(host))) throw config('url');
  const api = server ? 'rest/api/2/search' : 'rest/api/3/issue/bulkfetch';
  const root = override === undefined
    ? baseUrl(server ? `https://${u.host}${u.pathname}` : `https://${host}`)
    : baseUrl(undefined, override);
  return { url: `${root}/${api}`, host: u.host.toLowerCase(), server };
}

function fieldsOf(t) {
  const out = [...BASE_FIELDS];
  const custom = {};
  for (const k of ['points', 'sprint']) {
    const v = t?.fields?.[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !CUSTOM.test(v)) throw config('fields');
    custom[k] = v;
    out.push(v);
  }
  return { list: out, custom };
}

// Cloud: Basic email:token. Server: Bearer PAT. The header is the only place a credential goes.
function authHeader(server) {
  if (server) {
    const pat = process.env.JIRA_PAT;
    if (!pat) throw new AdapterFailure('auth', SERVER_HELP);
    return `Bearer ${pat}`;
  }
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new AdapterFailure('auth', CLOUD_HELP);
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

function caseOf(key, f, custom) {
  const fields = f && typeof f === 'object' ? f : {};
  const cat = fields.status?.statusCategory?.key;
  const category = typeof cat === 'string' && cat ? cat : 'unknown';
  const sprints = custom.sprint ? fields[custom.sprint] : undefined;
  const lastSprint = Array.isArray(sprints) ? sprints[sprints.length - 1] : undefined;
  const out = {
    id: `${PREFIX}${key}`,
    outcome: category === 'done' ? 'delivered' : category,
    type: fields.issuetype?.name,
    points: custom.points ? fields[custom.points] : undefined,
    sprint: lastSprint && typeof lastSprint === 'object' ? lastSprint.name : undefined,
  };
  // the resolution time dates the delivery only: a resolutiondate on an issue that is not done (reopened) is not evidence
  if (out.outcome === 'delivered' && typeof fields.resolutiondate === 'string') { out.at = fields.resolutiondate; out.atSource = 'resolutiondate'; }
  return out;
}

export async function run({ ids, repo, baseUrl: cliBase, maxPages }) {
  const settings = loadSettings(repo);
  const sel = ids === undefined ? idsFromLedger(repo, settings, PREFIX, ID) : selectIds(ids, PREFIX, ID);
  if (sel.invalid) process.stderr.write(`${ADAPTER}: skipped ${sel.invalid} invalid ids\n`);
  if (!sel.ids.length) return envelope('', SOURCE, [], true);
  const { list, custom } = fieldsOf(settings?.tracker);
  const ep = endpointOf(settings, baseUrlOverride(cliBase));
  const authorization = authHeader(ep.server);
  const requested = new Set(sel.ids);
  const byKey = new Map();
  let pages = 0;
  let complete = true;
  const call = async (body) => {
    pages++;
    const doc = await httpJson(ep.url, { method: 'POST', headers: { authorization }, body });
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.issues)) throw new AdapterFailure('parse', 'shape');
    return doc;
  };
  // adds the requested, not yet seen issues of a page (a moved issue answered under its new key is not requested)
  const take = (issues) => {
    for (const it of issues) if (it && typeof it.key === 'string' && requested.has(it.key) && !byKey.has(it.key)) byKey.set(it.key, it.fields);
  };
  for (const chunk of batches(sel.ids, PER_QUERY)) {
    if (ep.server) {
      const jql = `key in (${chunk.join(',')})`;
      let startAt = 0;
      for (;;) {
        if (pages >= maxPages) { complete = false; break; }
        const doc = await call({ jql, fields: list, startAt, maxResults: PER_QUERY, validateQuery: false });
        if (!Number.isInteger(doc.total) || doc.total < 0) throw new AdapterFailure('parse', 'shape');
        take(doc.issues);
        startAt += doc.issues.length;
        if (startAt >= doc.total) break;
        if (!doc.issues.length) { complete = false; break; }
      }
    } else {
      if (pages >= maxPages) { complete = false; break; }
      const doc = await call({ issueIdsOrKeys: chunk, fields: list });
      // issueErrors name issues by id, not key: any entry means an issue of this chunk is not answered
      if (doc.issueErrors !== undefined && !Array.isArray(doc.issueErrors)) throw new AdapterFailure('parse', 'shape');
      if (doc.issueErrors?.length) complete = false;
      take(doc.issues);
    }
  }
  for (const k of sel.ids) if (!byKey.has(k)) complete = false;
  const order = [...byKey.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const cases = order.map((k) => projectCase(caseOf(k, byKey.get(k), custom)));
  return envelope(`${PREFIX}${ep.host}`, SOURCE, cases, complete);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) { process.stderr.write(`${ADAPTER}: ${args.error}\n${USAGE}\n`); return 2; }
  try {
    process.stdout.write(`${JSON.stringify(await run(args))}\n`);
    return 0;
  } catch (e) {
    return reportFailure(ADAPTER, e);
  }
}

if (isMain(import.meta.url) || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  await exitAfterDrain(await main());
}
