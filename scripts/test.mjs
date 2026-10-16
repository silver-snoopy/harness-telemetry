#!/usr/bin/env node
// Run this repo's own tests. Vendored reference snapshots under reference/
// carry the upstream implementation's tests; they are data and must never run here.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP_DIRS = new Set(['reference', 'node_modules', '.tmp', '.git', '.claude']);

export function findTestFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(p);
      } else if (ent.isFile() && ent.name.endsWith('.test.mjs')) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out.sort();
}

// An empty file list would make `node --test` fall back to its default
// discovery, which runs the vendored reference tests. Refuse instead.
export function testArgs(files) {
  if (files.length === 0) throw new Error('test: no *.test.mjs files found');
  return ['--test', ...files];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = testArgs(findTestFiles(ROOT));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
