#!/usr/bin/env node
// github.mjs — GitHub Issues receipt adapter (Plan 7 layer 3, D-ADAPTERS). Read-only.
//
//   node github.mjs [--ids gh:1,gh:2] [--repo <path>]
//
// Prints the spec §5.6 envelope for the ids (default: every `gh:` id in the repo's ledger). Credentials are gh's own
// login (`gh api graphql`); this file reads none and passes none in argv. The query holds only validated integers and
// an owner/repo checked against a strict pattern. `issueOrPullRequest` is the union lookup: a pull request number is
// not an issue, and `stateReason` belongs to Issue only.
//
// PRIVACY: titles, authors, URLs, label names other than bug/feature/enhancement never leave this file; failures are
// one `github: <class> (<code>)` line. STDLIB ONLY.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadSettings } from '../engine/config.mjs';
import { parseRemote } from '../engine/trackers.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { CREDENTIAL_ENV, AdapterFailure, parseArgs, selectIds, idsFromLedger, envelope, projectCase, reportFailure, batches } from './common.mjs';

const ADAPTER = 'github';
const PREFIX = 'gh:';
// no leading zeros: `gh:007` and `gh:7` must not be two aliases for one number
const ID = /^[1-9]\d{0,8}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const TYPES = ['bug', 'feature', 'enhancement'];
const PER_CALL = 100;
const USAGE = 'usage: github.mjs [--ids gh:1,gh:2] [--repo <path>]';

function repoOf(repo, settings) {
  let owner; let name;
  const project = settings?.tracker?.project;
  if (typeof project === 'string' && project) [owner, name] = project.split('/');
  else {
    const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repo, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });
    const p = r.status === 0 ? parseRemote(r.stdout.trim()) : { host: null };
    if (p.host === 'github') ({ owner, repo: name } = p);
  }
  if (!NAME.test(owner ?? '') || !NAME.test(name ?? '')) throw new AdapterFailure('config', 'repository');
  return { owner, name };
}

const queryOf = ({ owner, name }, nums) =>
  `query{repository(owner:"${owner}",name:"${name}"){${nums.map((n) => `i${n}:issueOrPullRequest(number:${n}){__typename ... on Issue{state stateReason closedAt labels(first:20){nodes{name}}}}`).join(' ')}}}`;

// One gh call. Returns the repository object. Real gh exits 1 whenever the response has `errors` (partial data
// included) and still prints the JSON body, so a nonzero exit is judged by that body: a number GitHub cannot resolve
// answers null with a NOT_FOUND error on its own alias, which is `missing`. Any other error, or no GraphQL JSON, fails.
function ask(repoRef, nums) {
  // least privilege: the Jira/ADO credentials never reach gh
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !CREDENTIAL_ENV.includes(k)));
  const r = spawnSync('gh', ['api', 'graphql', '-f', `query=${queryOf(repoRef, nums)}`], { env, encoding: 'utf8', timeout: 30000, maxBuffer: 1 << 26 });
  if (r.error) {
    const code = r.error.code;
    throw new AdapterFailure(code === 'ETIMEDOUT' ? 'timeout' : 'cli', code === 'ENOENT' ? 'missing' : code === 'ETIMEDOUT' ? 'timeout' : 'spawn');
  }
  if (r.status === 4) throw new AdapterFailure('auth', 4);
  let doc;
  try { doc = JSON.parse(r.stdout); } catch { doc = undefined; }
  const isGraphql = doc !== null && typeof doc === 'object' && !Array.isArray(doc) && ('data' in doc || 'errors' in doc);
  if (r.status !== 0 && !isGraphql) throw new AdapterFailure('cli', Number.isInteger(r.status) ? r.status : 'signal');
  if (!isGraphql) throw new AdapterFailure('parse', 'json');
  const repository = doc.data?.repository;
  const errors = doc.errors;
  if (errors !== undefined) {
    const clean = Array.isArray(errors) && errors.length > 0 && repository && typeof repository === 'object'
      && errors.every((e) => e && e.type === 'NOT_FOUND' && Array.isArray(e.path) && e.path[0] === 'repository'
        && typeof e.path[1] === 'string' && repository[e.path[1]] === null);
    if (!clean) throw new AdapterFailure('graphql', 'errors');
  } else if (r.status !== 0) throw new AdapterFailure('cli', Number.isInteger(r.status) ? r.status : 'signal');
  if (!repository || typeof repository !== 'object') throw new AdapterFailure('graphql', 'shape');
  return repository;
}

/** The outcome of one resolved node: a projected case, or null when `node` is null (missing). */
function caseOf(n, node) {
  const id = `${PREFIX}${n}`;
  if (node === null || node === undefined) return { id, outcome: 'missing' };
  if (node.__typename === 'PullRequest') return { id, outcome: 'pull-request' };
  if (node.__typename !== 'Issue') return { id, outcome: 'missing' };
  const label = (node.labels?.nodes ?? []).map((x) => (typeof x?.name === 'string' ? x.name.toLowerCase() : '')).find((x) => TYPES.includes(x));
  const type = label || undefined;
  if (node.state === 'OPEN') return { id, outcome: 'open', type };
  if (node.state !== 'CLOSED') return { id, outcome: 'open', type };
  const reason = typeof node.stateReason === 'string' && /^[A-Z_]{1,30}$/.test(node.stateReason) ? node.stateReason : null;
  if (reason === 'COMPLETED') return { id, outcome: 'delivered', at: node.closedAt, atSource: 'closedAt', type };
  return { id, outcome: `closed-${reason ? reason.toLowerCase() : 'unspecified'}`, type };
}

export function run({ ids, repo }) {
  const settings = loadSettings(repo);
  const sel = ids === undefined ? idsFromLedger(repo, settings, PREFIX, ID) : selectIds(ids, PREFIX, ID);
  if (sel.invalid) process.stderr.write(`${ADAPTER}: skipped ${sel.invalid} invalid ids\n`);
  if (!sel.ids.length) return envelope('', ADAPTER, [], true);
  const ref = repoOf(repo, settings);
  const cases = [];
  let complete = true;
  for (const chunk of batches(sel.ids.map(Number), PER_CALL)) {
    const repository = ask(ref, chunk);
    for (const n of chunk) {
      const c = caseOf(n, repository[`i${n}`]);
      if (c.outcome === 'missing') complete = false;
      cases.push(projectCase(c));
    }
  }
  return envelope(`${PREFIX}${ref.owner}/${ref.name}`, ADAPTER, cases, complete);
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) { process.stderr.write(`${ADAPTER}: ${args.error}\n${USAGE}\n`); return 2; }
  try {
    process.stdout.write(`${JSON.stringify(run(args))}\n`);
    return 0;
  } catch (e) {
    return reportFailure(ADAPTER, e);
  }
}

if (isMain(import.meta.url) || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  await exitAfterDrain(main());
}
