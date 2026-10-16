// Engine-only cases (Codex P2-08): `replay.json` `implOnly: "engine"` exempts a case from every
// reference consumer, so the set is pinned in corpus/engine-only.json — each with a reason — and
// checked both ways. An engine-only case may not carry a reference golden.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const approvedEngineOnly = (approvals) => Object.keys(approvals).sort();

export function engineOnlyProblems(casesDir, approvals) {
  const out = [];
  const dirs = readdirSync(casesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const c of dirs) {
    const p = join(casesDir, c, 'replay.json');
    if (!existsSync(p)) continue;
    const { implOnly } = JSON.parse(readFileSync(p, 'utf8'));
    if (implOnly === undefined) { if (c in approvals) out.push(`${c}: approved in corpus/engine-only.json but replay.json has no implOnly "engine"`); continue; }
    if (implOnly !== 'engine') { out.push(`${c}: unknown implOnly ${JSON.stringify(implOnly)}`); continue; }
    if (!(c in approvals)) out.push(`${c}: implOnly "engine" but not approved in corpus/engine-only.json`);
    if (existsSync(join(casesDir, c, 'expected', '49577c7'))) out.push(`${c}: implOnly "engine" case must not carry expected/49577c7`);
  }
  for (const [c, a] of Object.entries(approvals)) {
    if (!dirs.includes(c)) out.push(`${c}: approved in corpus/engine-only.json but no such case`);
    if (typeof a?.reason !== 'string' || a.reason.trim().length < 40) out.push(`${c}: reason must be at least 40 characters`);
  }
  return out;
}
