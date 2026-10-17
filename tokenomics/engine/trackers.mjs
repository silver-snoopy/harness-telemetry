// Work-item tracker presets (Plan 7, D-PRESETS): `ids.rules` entries for Jira, GitHub and Azure DevOps.
// A rule normalises a match to a prefixed id (`jira:PAY-1`, `gh:42`, `ado:123`). Pure; no I/O.
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
    { tracker: 'github', pattern: '(?<![A-Za-z0-9&])#(\\d+)\\b', normalize: 'gh:$1' },
    { tracker: 'github', pattern: '\\bGH-(\\d+)\\b', normalize: 'gh:$1' },
    ...(branchRule ? [{ tracker: 'github', pattern: '(?:^|/)(\\d+)-(?=[A-Za-z])', normalize: 'gh:$1', source: 'branch' }] : []),
  ],
  ado: ({ branchRule = false } = {}) => [
    { tracker: 'ado', pattern: '(?<![A-Za-z0-9])AB#(\\d+)\\b', normalize: 'ado:$1' },
    ...(branchRule ? [{ tracker: 'ado', pattern: '(?:^|/)(\\d{3,7})-(?=[A-Za-z])', normalize: 'ado:$1', source: 'branch' }] : []),
  ],
});

export const presetRules = (tracker, opts) => {
  const p = Object.hasOwn(PRESETS, tracker) ? PRESETS[tracker] : null;
  if (!p) throw new Error(`unknown tracker '${tracker}' (jira, github, ado)`);
  return p(opts);
};
