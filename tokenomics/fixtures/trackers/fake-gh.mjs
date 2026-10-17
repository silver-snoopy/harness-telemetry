// A fake `gh` for the GitHub adapter tests (Plan 7 Task 5). Test-only; excluded from ENGINE.json like the other fixtures.
// `fakeGhSource(cfg)` returns the JavaScript body for harness.fakeBin('gh'). It answers `gh api graphql -f query=…`
// the way GitHub does for `repository { i<N>: issueOrPullRequest(number: N) { __typename … on Issue { … } } }`, and
// REFUSES (exit 3) a query that is not that shape: a PR-shaped `issue(number:)` lookup must not validate.
//   cfg.nodes  {[n]: node|null}   what each number resolves to (absent = null)
//   cfg.mode   'garbage' (exit 1, not JSON) | 'extra' (NOT_FOUND on a non-null alias) | 'mixed' (NOT_FOUND plus FORBIDDEN, data present) | 'ok' | 'unauth' (exit 4) | 'errors' (HTTP 200 + errors[]) | 'notfound' (NOT_FOUND errors per null alias)
//   cfg.log    path: appended one JSON line per call {argv, aliases}
// Every answer also carries PRIVATE_TITLE / PRIVATE_PERSON so a leak is caught by assertNoSentinels.
export function fakeGhSource({ nodes = {}, mode = 'ok', log, dumpEnv = false } = {}) {
  return `
const fs = require('fs');
const cfg = ${JSON.stringify({ nodes, mode, log, dumpEnv })};
const argv = process.argv.slice(2);
const q = (argv.find((a) => a.startsWith('query=')) || '').slice(6);
const aliases = [...q.matchAll(/\\bi(\\d+):issueOrPullRequest\\(number:(\\d+)\\)/g)].map((m) => Number(m[2]));
if (cfg.log) fs.appendFileSync(cfg.log, JSON.stringify(Object.assign({ argv, aliases }, cfg.dumpEnv ? { envKeys: Object.keys(process.env) } : {})) + '\\n');
if (cfg.mode === 'unauth') { process.stderr.write('gh: To get started with GitHub CLI, please run: gh auth login PRIVATE_PERSON\\n'); process.exit(4); }
const shapeOk = argv[0] === 'api' && argv[1] === 'graphql' && q.includes('issueOrPullRequest') && q.includes('__typename')
  && /\\.\\.\\. on Issue\\s*\\{[^}]*stateReason/.test(q) && !/\\bissue\\(number/.test(q) && aliases.length > 0;
if (!shapeOk) { process.stderr.write('fake gh: unexpected query shape\\n'); process.exit(3); }
if (cfg.mode === 'errors') { process.stdout.write(JSON.stringify({ data: null, errors: [{ message: 'boom PRIVATE_TITLE', type: 'SOMETHING' }] })); process.exit(0); }
const repository = {}; const errors = [];
aliases.forEach((n, i) => {
  const node = cfg.nodes[n] === undefined ? null : cfg.nodes[n];
  repository['i' + n] = node;
  if (node === null && (cfg.mode === 'notfound' || cfg.mode === 'mixed')) errors.push({ type: 'NOT_FOUND', path: ['repository', 'i' + n], message: 'Could not resolve PRIVATE_TITLE' });
});
if (cfg.mode === 'garbage') { process.stdout.write('PRIVATE_TITLE not json'); process.exit(1); }
if (cfg.mode === 'extra') {
  const k = Object.keys(repository)[0];
  errors.push({ type: 'NOT_FOUND', path: ['repository', k], message: 'x' }); // NOT_FOUND on an alias that is NOT null
}
if (cfg.mode === 'mixed') errors.push({ type: 'FORBIDDEN', path: ['repository'], message: 'PRIVATE_TITLE' });
process.stdout.write(JSON.stringify(Object.assign({ data: { repository } }, errors.length ? { errors } : {})));
process.exit(errors.length ? 1 : 0); // real gh exits 1 whenever the response has errors
`;
}

const issue = (extra) => ({ __typename: 'Issue', title: 'PRIVATE_TITLE', author: { login: 'PRIVATE_PERSON' }, labels: { nodes: [] }, ...extra });
/** The D-ADAPTERS fixture set: 1 completed, 2 open, 3 not planned, 4 duplicate, 5 pull request, 6 missing. */
export const STANDARD_NODES = {
  1: issue({ state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-03-01T10:00:00Z', labels: { nodes: [{ name: 'wontfix' }, { name: 'enhancement' }, { name: 'bug' }] } }),
  2: issue({ state: 'OPEN', stateReason: null, closedAt: null }),
  3: issue({ state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-03-02T10:00:00Z' }),
  4: issue({ state: 'CLOSED', stateReason: 'DUPLICATE', closedAt: '2026-03-03T10:00:00Z' }),
  5: { __typename: 'PullRequest', title: 'PRIVATE_TITLE', author: { login: 'PRIVATE_PERSON' } },
};
export { issue };
