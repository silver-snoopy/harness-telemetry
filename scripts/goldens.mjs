#!/usr/bin/env node
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCase } from '../replay/runner.mjs';
import { expectedExits } from '../replay/exits.mjs';

export async function writeGoldens(caseDir, implName, implDir, { outDir = join(caseDir, 'expected', implName) } = {}) {
  const r = await runCase(caseDir, implDir);
  const want = expectedExits(caseDir, JSON.parse(readFileSync(join(caseDir, 'replay.json'), 'utf8'))); // declared in assert.json `exits`, else all zeros
  if (r.exits.length !== want.length || r.exits.some((c, i) => c !== want[i])) throw new Error(`${caseDir} under ${implName}: exits ${r.exits}, expected ${want}`);
  rmSync(outDir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(r.files)) {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), content);
  }
  return Object.keys(r.files);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [caseDir, implName, implDir, outDir] = process.argv.slice(2);
  writeGoldens(caseDir, implName, implDir, outDir ? { outDir } : {}).then((f) => process.stderr.write(`${f.length} file(s)\n`));
}
