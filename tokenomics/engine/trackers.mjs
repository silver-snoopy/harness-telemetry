// Work-item tracker presets (Plan 7, D-PRESETS): `ids.rules` entries for Jira, GitHub and Azure DevOps.
// A rule normalises a match to a prefixed id (`jira:PAY-1`, `gh:42`, `ado:123`). The presets are pure; `detectTrackers`
// (D-DETECT) reads the repository's remote, commits and branch names through git, read-only. STDLIB ONLY.
import { spawnSync } from 'node:child_process';
import { TA_DEFAULTS } from './config.mjs';
const KEY = /^[A-Z][A-Z0-9]+$/;

export const PRESETS = Object.freeze({
  jira: ({ keys = [] } = {}) => {
    const bad = keys.find((k) => typeof k !== 'string' || !KEY.test(k));
    if (bad !== undefined) throw new Error(`jira key '${bad}' must match ${KEY.source}`);
    const ks = [...new Set(keys)];
    if (!ks.length) throw new Error('jira preset needs project keys (e.g. PAY, WEB)');
    return [{ tracker: 'jira', pattern: `\\b(${ks.join('|')})-(\\d+)\\b(?!-\\d)`, normalize: 'jira:$1-$2' }];
  },
  github: ({ branchRule = false } = {}) => [
    { tracker: 'github', pattern: '(?<![A-Za-z0-9&])#([1-9]\\d*)\\b', normalize: 'gh:$1' },
    { tracker: 'github', pattern: '\\bGH-(\\d+)\\b', normalize: 'gh:$1' },
    ...(branchRule ? [{ tracker: 'github', pattern: '(?:^|/)(\\d+)-(?=[A-Za-z]{2})', normalize: 'gh:$1', source: 'branch' }] : []),
  ],
  ado: ({ branchRule = false } = {}) => [
    { tracker: 'ado', pattern: '(?<![A-Za-z0-9])AB#(\\d+)\\b', normalize: 'ado:$1' },
    ...(branchRule ? [{ tracker: 'ado', pattern: '(?:^|/)(\\d{3,7})-(?=[A-Za-z]{2})', normalize: 'ado:$1', source: 'branch' }] : []),
  ],
});

export const presetRules = (tracker, opts) => {
  const p = Object.hasOwn(PRESETS, tracker) ? PRESETS[tracker] : null;
  if (!p) throw new Error(`unknown tracker '${tracker}' (jira, github, ado)`);
  return p(opts);
};

const NONE = Object.freeze({ host: null });
const pathParts = (p) => p.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });

/**
 * Parse a git remote URL by exact host: `{host: 'github', owner, repo}`, `{host: 'ado', org, project, repo, orgUrl}`, or
 * `{host: null}` for anything else, look-alike hosts such as `github.com.evil.io` included. Handles https, ssh:// and
 * the scp-like `user@host:path` form.
 */
export function parseRemote(url) {
  if (typeof url !== 'string' || !url.trim()) return NONE;
  const u = url.trim();
  let hostname;
  let parts;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(u);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    try { const x = new URL(u); hostname = x.hostname.toLowerCase(); parts = pathParts(x.pathname); } catch { return NONE; }
  } else if (scp) {
    hostname = scp[1].toLowerCase();
    parts = pathParts(scp[2]);
  } else return NONE;
  const strip = (r) => r.replace(/\.git$/, '');
  if (hostname === 'github.com') {
    return parts.length >= 2 ? { host: 'github', owner: parts[0], repo: strip(parts[1]) } : NONE;
  }
  if (hostname === 'dev.azure.com' || hostname === 'ssh.dev.azure.com') {
    // https: /org/project/_git/repo; ssh: /v3/org/project/repo
    const p = hostname === 'ssh.dev.azure.com' ? (parts[0] === 'v3' ? parts.slice(1) : []) : (parts[2] === '_git' ? [parts[0], parts[1], parts[3]] : []);
    return p.length >= 3 && p.every(Boolean) ? { host: 'ado', org: p[0], project: p[1], repo: strip(p[2]), orgUrl: `https://dev.azure.com/${encodeURIComponent(p[0])}` } : NONE;
  }
  const vs = /^([a-z0-9-]+)\.visualstudio\.com$/.exec(hostname);
  if (hostname === 'vs-ssh.visualstudio.com') {
    return parts[0] === 'v3' && parts.length >= 4 ? { host: 'ado', org: parts[1], project: parts[2], repo: strip(parts[3]), orgUrl: `https://${parts[1]}.visualstudio.com` } : NONE;
  }
  if (vs) {
    const i = parts.indexOf('_git');
    return i >= 1 && parts[i + 1] ? { host: 'ado', org: vs[1], project: parts[i - 1], repo: strip(parts[i + 1]), orgUrl: `https://${vs[1]}.visualstudio.com` } : NONE;
  }
  return NONE;
}

// A failure-tolerant git read: stdout on success, '' on any failure (no git, not a repo, timeout, no commits).
function gitOut(repo, args, env) {
  const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, maxBuffer: 1 << 28 });
  return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : '';
}

const REMOTE_NAME = { github: 'github.com', ado: 'Azure DevOps' };
const nDocs = (docs, re) => docs.filter((d) => re.test(d)).length;

/**
 * Infer the work-item trackers from the remote and the history (D-DETECT). The sample is the last 300 commits (subject
 * and body, one document each) plus each branch name once (`origin/` stripped, local and remote copies merged); counts
 * are document frequencies. Read-only.
 */
export function detectTrackers(repo, { env = process.env } = {}) {
  const remote = parseRemote(gitOut(repo, ['remote', 'get-url', 'origin'], env).trim());
  const host = remote.host;
  const commits = gitOut(repo, ['log', '-n', '300', '--format=%s%n%b%x1e'], env).split('\x1e').map((c) => c.trim()).filter(Boolean);
  const branches = new Set();
  for (const ref of gitOut(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], env).split('\n').filter(Boolean)) {
    if (ref === 'refs/remotes/origin/HEAD') continue;
    branches.add(ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/origin\//, '').replace(/^refs\/remotes\//, ''));
  }
  const docs = [...commits, ...branches];
  const total = docs.length;
  const trackers = [];

  const stop = new Set(TA_DEFAULTS.ids.stoplist);
  const byPrefix = new Map();
  let withKey = 0;
  for (const d of docs) {
    const seen = new Set([...d.matchAll(/\b([A-Z][A-Z0-9]+)-\d+\b/g)].map((m) => m[1]).filter((p) => !stop.has(p)));
    for (const p of seen) byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  }
  const keys = [...byPrefix].filter(([, c]) => c >= 5 && c * 10 >= total).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p);
  if (keys.length) {
    const re = new RegExp(`\\b(${keys.join('|')})-\\d+\\b`);
    withKey = nDocs(docs, re);
    trackers.push({ tracker: 'jira', keys, why: `${keys.join(', ')} — ${withKey} of ${total} commits and branches` });
  }

  const abN = nDocs(docs, /(?<![A-Za-z0-9])AB#\d+/);
  if (host === 'ado' || abN >= 3) {
    trackers.push({ tracker: 'ado', why: [host === 'ado' ? `${REMOTE_NAME.ado} remote` : null, abN ? `AB# in ${abN} of ${total} commits and branches` : null].filter(Boolean).join(', ') });
  }

  // R15: a github host alone gives github only when no other tracker is found; beside Jira or Azure DevOps it needs #N
  // in at least 3 documents (the host says where the code lives, not where the work items are)
  const hashN = nDocs(docs, /(?<![A-Za-z0-9&])#\d+/);
  if (host === 'github' && (!trackers.length || hashN >= 3)) {
    trackers.push({ tracker: 'github', why: `${REMOTE_NAME.github} remote${hashN ? `, #N in ${hashN} of ${total} commits and branches` : ''}` });
  }

  const receipts = ['jira', 'ado', 'github'].find((t) => trackers.some((x) => x.tracker === t)) ?? null;
  return { trackers, host, receipts };
}

/** The `ids.rules` for the detected (or chosen) trackers; only the tracker matching the remote's host gets a branch rule. */
export function rulesFor(trackers, host) {
  return trackers.flatMap((t) => presetRules(t.tracker, { keys: t.keys, branchRule: (t.tracker === 'github' && host === 'github') || (t.tracker === 'ado' && host === 'ado') }));
}
