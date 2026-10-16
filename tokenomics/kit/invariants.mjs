import { validate } from './schema.mjs';
import { HOSTS, COST_SOURCES } from './registry.mjs';
import { finding } from './findings.mjs';

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CATS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function lineFindings(line, where, { mode, schemas }) {
  const out = [];
  const strict = mode === 'port' || (mode === 'mixed' && 'writer' in line);
  if (mode === 'port' && !('writer' in line)) out.push(finding('error', 'writer-missing', where, 'port mode requires writer'));
  const schema = schemas[strict ? 'ledger-line.port.json' : 'ledger-line.reference.json'];
  for (const e of validate(schema, line, { schemas })) {
    if (e.message === 'missing required writer') continue; // reported as writer-missing
    out.push(finding('error', 'schema', where, `${e.path}: ${e.message}`));
  }
  if (!HOSTS[line.host]) out.push(finding(strict ? 'error' : 'limitation', 'unknown-host', where, `host ${line.host}`));
  if (line.costSource !== undefined && !COST_SOURCES.includes(line.costSource)) {
    out.push(finding(strict ? 'error' : 'limitation', 'unknown-cost-source', where, `costSource ${line.costSource}`));
  }
  if ('costUsd' in line && 'costSource' in line && ((line.costUsd === null) !== (line.costSource === 'none'))) {
    out.push(finding('error', 'cost-source-mismatch', where, 'costSource "none" iff costUsd null'));
  }
  if (strict) {
    for (const k of ['models', 'cases', 'skills']) {
      const a = line[k];
      if (!Array.isArray(a)) continue;
      if (new Set(a).size !== a.length) out.push(finding('error', 'duplicate-array', where, k));
      else if (a.some((x, i) => i > 0 && a[i - 1] > x)) out.push(finding('error', 'unsorted-array', where, k));
    }
    for (const k of ['capturedAt', 'startedAt', 'endedAt']) {
      if (typeof line[k] === 'string' && !TS.test(line[k])) out.push(finding('error', 'timestamp-form', where, k));
    }
    if (line.tokensBasis === 'inclusive' && line.tokens) {
      for (const c of CATS) {
        const subs = (line.subagents ?? []).map((s) => s.tokens?.[c]);
        if (subs.some((x) => typeof x !== 'number')) { out.push(finding('unverified', 'inclusive-overflow', where, `${c}: a dispatch is unmeasured`)); continue; }
        const sum = subs.reduce((a, b) => a + b, 0);
        if (sum > line.tokens[c]) out.push(finding('error', 'inclusive-overflow', where, `${c}: dispatches ${sum} > session ${line.tokens[c]}`));
      }
    }
  }
  // spec §7.3: an unknown version has no supported interpretation, so nothing on it is verified.
  if (mode !== 'port' && line.v !== 1) out.push(finding('unverified', 'unknown-version', where, `v ${JSON.stringify(line.v)}`));
  // spec §7.4: reference-era (writer-less) lines carry known provenance limitations, per record.
  if (mode !== 'port' && !('writer' in line)) {
    if (line.host === 'copilot') out.push(finding('limitation', 'reference-copilot-tokens', where, 'Copilot category split not measured; session input netted by dispatch totals'));
    if (line.host === 'copilot-vscode') out.push(finding('limitation', 'reference-vscode-counters', where, 'VS Code usage/toolCalls/skills/elapsedMs written as 0 when unobservable'));
    if (line.foldedFromLive) out.push(finding('limitation', 'reference-folded', where, `foldedFromLive ${line.foldedFromLive}: folded dispatch metadata lost`));
    if (isObj(line.tokens) && CATS.every((c) => line.tokens[c] === 0)) out.push(finding('limitation', 'zero-for-unmeasured', where, 'all-zero token quad may be unmeasured usage written as 0'));
  }
  if (line.prompts || line.dispatched) out.push(finding('unverified', 'prompts-unverified', where, 'capturePrompts history is not snapshotted'));
  return out;
}
