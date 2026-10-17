#!/usr/bin/env node
// azure-devops.mjs — Azure DevOps Boards receipt adapter (Plan 7 layer 3, D-ADAPTERS). Read-only.
//
//   node azure-devops.mjs [--ids ado:1,ado:2] [--repo <path>] [--base-url <loopback url>]
//
// Prints the spec §5.6 envelope for the ids (default: every `ado:` id in the repo's ledger) from one POST per 200 ids to
// `<org url>/_apis/wit/workitemsbatch?api-version=7.1` with `errorPolicy: 'Omit'`, so an id the server cannot return is
// a null entry (missing, complete:false) instead of a failed batch. Credentials: AZURE_DEVOPS_EXT_PAT (Basic `:PAT`), else the
// `az` login (`az account get-access-token`, stdout captured, used only in the Bearer header, never in argv). When a
// PAT is set `az` is never called. The credential only goes to dev.azure.com or *.visualstudio.com over https, or to a
// loopback test server named by --base-url / TOKENOMICS_TRACKER_BASE_URL.
//
// Delivery policy (P7-11): `doneStates` (default Done, Closed, Completed) is delivered; `Resolved` is reported raw
// because it is not a completed category. `at` is ClosedDate, only for a delivered item and only when present.
//
// PRIVACY: only the five configured fields are requested and projected (state, type, points, iteration path's last
// segment, closed date); titles, people, URLs and bodies never leave this file. Failures are one
// `azure-devops: <class> (<code>)` line. STDLIB ONLY.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadSettings } from '../engine/config.mjs';
import { parseRemote } from '../engine/trackers.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { scrubbedEnv, AdapterFailure, parseArgs, selectIds, idsFromLedger, envelope, projectCase, reportFailure, batches, baseUrl, baseUrlOverride, httpJson } from './common.mjs';

const ADAPTER = 'azure-devops';
const SOURCE = 'ado';
const PREFIX = 'ado:';
// no leading zeros: `ado:007` and `ado:7` must not be two aliases for one work item
const ID = /^[1-9]\d{0,8}$/;
const PER_CALL = 200;
const RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
const DEFAULT_DONE = ['Done', 'Closed', 'Completed'];
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,99}$/;
const SEGMENT = /^[^\0-\x1f/\\?#%]{1,100}$/;
const AUTH_HELP = 'set AZURE_DEVOPS_EXT_PAT or run az login';
const USAGE = 'usage: azure-devops.mjs [--ids ado:1,ado:2] [--repo <path>] [--base-url <loopback url>]';
const API = '_apis/wit/workitemsbatch?api-version=7.1';
const config = (code) => new AdapterFailure('config', code, 2);

const isAdoHost = (h) => h === 'dev.azure.com' || /^[a-z0-9-]+\.visualstudio\.com$/.test(h);

/**
 * Where to POST, and what the group is called: `{url, org, project}`. The org URL is `settings.tracker.url`, else the
 * origin remote's `orgUrl` (`https://dev.azure.com/<org>` or `https://<org>.visualstudio.com`); the project is
 * `settings.tracker.project`, else the remote's. Without an override the org URL must be https on an Azure DevOps host
 * (the credential goes there); an override (--base-url or TOKENOMICS_TRACKER_BASE_URL) is a server root, https or
 * loopback http, and the request path is then `/<org>/_apis/...`. Throws a config failure (exit 2).
 */
export function endpointOf(settings, remote, override) {
  const t = settings?.tracker ?? {};
  const orgUrl = typeof t.url === 'string' && t.url ? t.url : remote?.orgUrl;
  let u;
  try { u = new URL(orgUrl); } catch { throw config('organization'); }
  if (u.username || u.password) throw config('organization');
  const host = u.hostname.toLowerCase();
  const first = u.pathname.split('/').filter(Boolean)[0];
  const org = host === 'dev.azure.com' ? first : host.endsWith('.visualstudio.com') ? host.split('.')[0] : undefined;
  if (u.protocol !== 'https:' || !isAdoHost(host) || !org || !SEGMENT.test(org)) throw config('organization');
  const projectRaw = typeof t.project === 'string' && t.project ? t.project : remote?.project;
  const project = typeof projectRaw === 'string' && SEGMENT.test(projectRaw) ? projectRaw : undefined;
  const root = override === undefined
    ? baseUrl(host === 'dev.azure.com' ? `https://${host}/${encodeURIComponent(org)}` : `https://${host}`)
    : `${baseUrl(undefined, override)}/${encodeURIComponent(org)}`;
  return { url: `${root}/${API}`, org, project };
}

function settingsOf(t) {
  const fields = { points: 'Microsoft.VSTS.Scheduling.StoryPoints', sprint: 'System.IterationPath' };
  for (const k of ['points', 'sprint']) {
    const v = t?.fields?.[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !FIELD_NAME.test(v)) throw config('fields');
    fields[k] = v;
  }
  let done = DEFAULT_DONE;
  if (t?.doneStates !== undefined) {
    if (!Array.isArray(t.doneStates) || !t.doneStates.length || t.doneStates.some((s) => typeof s !== 'string' || !s)) throw config('doneStates');
    done = t.doneStates;
  }
  return { fields, done };
}

// PAT from the env, else a token from the az login (captured stdout). Either failure is the same one-line hint.
function authHeader() {
  const pat = process.env.AZURE_DEVOPS_EXT_PAT;
  if (pat) return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
  const r = spawnSync('az', ['account', 'get-access-token', '--resource', RESOURCE, '--query', 'accessToken', '-o', 'tsv'],
    { env: scrubbedEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
  const token = r.status === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : '';
  if (!token || /\s/.test(token)) throw new AdapterFailure('auth', AUTH_HELP);
  return `Bearer ${token}`;
}

function remoteOf(repo) {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repo, env: scrubbedEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });
  return r.status === 0 ? parseRemote(r.stdout.trim()) : { host: null };
}

const lastSegment = (v) => (typeof v === 'string' ? v.split('\\').filter(Boolean).pop() : undefined);

function caseOf(id, fields, cfg) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const state = typeof f['System.State'] === 'string' && f['System.State'] ? f['System.State'] : 'unknown';
  const out = {
    id: `${PREFIX}${id}`,
    outcome: cfg.done.includes(state) ? 'delivered' : state,
    type: f['System.WorkItemType'],
    points: f[cfg.fields.points],
    sprint: lastSegment(f[cfg.fields.sprint]),
  };
  // the close time dates the delivery only: a ClosedDate on an item that is not in a done state (reopened) is not evidence
  if (out.outcome === 'delivered' && typeof f['Microsoft.VSTS.Common.ClosedDate'] === 'string') { out.at = f['Microsoft.VSTS.Common.ClosedDate']; out.atSource = 'ClosedDate'; }
  return out;
}

export async function run({ ids, repo, baseUrl: cliBase }) {
  const settings = loadSettings(repo);
  const sel = ids === undefined ? idsFromLedger(repo, settings, PREFIX, ID) : selectIds(ids, PREFIX, ID);
  if (sel.invalid) process.stderr.write(`${ADAPTER}: skipped ${sel.invalid} invalid ids\n`);
  if (!sel.ids.length) return envelope('', SOURCE, [], true);
  const cfg = settingsOf(settings?.tracker);
  const remote = typeof settings?.tracker?.url === 'string' && settings.tracker.url && settings.tracker.project ? null : remoteOf(repo);
  const ep = endpointOf(settings, remote, baseUrlOverride(cliBase));
  const authorization = authHeader();
  const requested = new Set(sel.ids.map(Number));
  const byId = new Map();
  let complete = true;
  const fieldList = ['System.State', 'System.WorkItemType', cfg.fields.points, cfg.fields.sprint, 'Microsoft.VSTS.Common.ClosedDate'];
  for (const chunk of batches(sel.ids.map(Number), PER_CALL)) {
    // errorPolicy 'Omit' (R12): the API's default, Fail, rejects the whole batch for one deleted, missing or foreign id;
    // with Omit that id's entry is null, which is a missing item (complete:false) like any id left unanswered
    const doc = await httpJson(ep.url, { method: 'POST', headers: { authorization }, body: { ids: chunk, fields: fieldList, errorPolicy: 'Omit' } });
    if (!doc || !Array.isArray(doc.value)) throw new AdapterFailure('parse', 'shape');
    for (const item of doc.value) if (item && typeof item === 'object' && requested.has(item.id) && !byId.has(item.id)) byId.set(item.id, item.fields);
    for (const n of chunk) if (!byId.has(n)) complete = false;
  }
  const cases = [...byId.keys()].sort((a, b) => a - b).map((n) => projectCase(caseOf(n, byId.get(n), cfg)));
  return envelope(`${PREFIX}${ep.org}${ep.project ? `/${ep.project}` : ''}`, SOURCE, cases, complete);
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
