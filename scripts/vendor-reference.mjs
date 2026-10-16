#!/usr/bin/env node
// Extract read-only reference snapshots of sdlc-skills' tokenomics skill.
// The skill moved between bundles/ and factories/ over time, so each sha's
// path is discovered with `git ls-tree`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SNAPSHOTS = ['49577c7', 'fa0a6fb', 'd9eac08'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const refDir = (sha) => join(ROOT, 'reference', sha);

const CANDIDATES = ['bundles/test-automation/skills/tokenomics', 'factories/test-automation/skills/tokenomics'];

function git(repo, ...args) { return execFileSync('git', ['-C', repo, ...args], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }); }

export function vendor(sdlcRepo) {
  const prov = {};
  for (const sha of SNAPSHOTS) {
    const src = CANDIDATES.find((p) => git(sdlcRepo, 'ls-tree', '-d', sha, p).length > 0);
    if (!src) throw new Error(`no tokenomics dir at ${sha}`);
    const files = git(sdlcRepo, 'ls-tree', '-r', '--name-only', sha, src).toString('utf8').split('\n').filter(Boolean);
    rmSync(refDir(sha), { recursive: true, force: true });
    prov[sha] = { sourcePath: src, files: {} };
    for (const f of files) {
      const rel = f.slice(src.length + 1);
      const buf = git(sdlcRepo, 'show', `${sha}:${f}`);
      mkdirSync(dirname(join(refDir(sha), rel)), { recursive: true });
      writeFileSync(join(refDir(sha), rel), buf);
      prov[sha].files[rel] = createHash('sha256').update(buf).digest('hex');
    }
  }
  writeFileSync(join(ROOT, 'reference', 'PROVENANCE.json'), `${JSON.stringify(prov, null, 2)}\n`);
  return prov;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.argv[2] || join(homedir(), 'dev', 'sdlc-skills');
  const prov = vendor(repo);
  for (const [sha, p] of Object.entries(prov)) process.stderr.write(`${sha}: ${Object.keys(p.files).length} files from ${p.sourcePath}\n`);
}
