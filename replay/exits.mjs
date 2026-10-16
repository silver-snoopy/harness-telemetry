import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The exit codes a case expects: assert.json `exits` (one per event) when declared, else all zeros. */
export function expectedExits(caseDir, manifest) {
  const p = join(caseDir, 'assert.json');
  const declared = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).exits : undefined;
  return declared ?? manifest.events.map(() => 0);
}
