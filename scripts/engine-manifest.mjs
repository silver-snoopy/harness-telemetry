#!/usr/bin/env node
// Writes and checks tokenomics/ENGINE.json: the engine version and the sha256 baseline of every installable file
// (Plan 5 D-ENG). The baseline is every file under tokenomics/ except ENGINE.json, *.test.mjs, fixtures/**,
// extensions/** and ENGINE-B1.md. The source checkout's ENGINE.json always has `installed: null`.
//   node scripts/engine-manifest.mjs            write ENGINE.json (keeps the current `engine`)
//   node scripts/engine-manifest.mjs --check    exit 1 naming each stale, missing or unlisted path
//   --root <dir>                                a repo root other than this one (tests)
// STDLIB ONLY.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const EXTENSION_API = 2;

function excluded(rel) {
  const parts = rel.split('/');
  return rel === 'ENGINE.json' || rel === 'ENGINE-B1.md' || rel.endsWith('.test.mjs') ||
    parts.includes('fixtures') || parts[0] === 'extensions';
}

export function baselineFiles(root) {
  const base = join(root, 'tokenomics');
  const out = [];
  const walk = (dir, prefix) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(join(dir, ent.name), rel);
      else if (ent.isFile() && !excluded(rel)) out.push(rel);
    }
  };
  walk(base, '');
  return out.sort();
}

const sha = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

export function buildManifest(root, { engine }) {
  const files = {};
  for (const rel of baselineFiles(root)) files[rel] = sha(join(root, 'tokenomics', rel));
  return { engine, extensionApi: EXTENSION_API, files, installed: null };
}

// Problems between the committed ENGINE.json and the tree: one line per path.
export function checkManifest(root) {
  const problems = [];
  let committed;
  try {
    committed = JSON.parse(readFileSync(join(root, 'tokenomics', 'ENGINE.json'), 'utf8'));
  } catch (e) {
    return [`ENGINE.json: unreadable (${e.code ?? e.message})`];
  }
  const fresh = buildManifest(root, { engine: committed.engine });
  const listed = committed.files ?? {};
  for (const [rel, h] of Object.entries(fresh.files)) {
    if (!(rel in listed)) problems.push(`${rel}: not in baseline`);
    else if (listed[rel] !== h) problems.push(`${rel}: stale hash`);
  }
  for (const rel of Object.keys(listed)) if (!(rel in fresh.files)) problems.push(`${rel}: missing from the tree`);
  if (committed.installed !== null) problems.push('ENGINE.json: installed must be null in the source tree');
  if (committed.extensionApi !== EXTENSION_API) problems.push(`ENGINE.json: extensionApi must be ${EXTENSION_API}`);
  return problems;
}

function main(argv) {
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? argv[ri + 1] : REPO;
  if (argv.includes('--check')) {
    const problems = checkManifest(root);
    if (problems.length) {
      process.stderr.write(`engine-manifest: ENGINE.json is stale (run node scripts/engine-manifest.mjs)\n${problems.map((p) => `  ${p}\n`).join('')}`);
      return 1;
    }
    process.stdout.write('engine-manifest: ENGINE.json is current\n');
    return 0;
  }
  let engine = '0.4.0';
  try {
    engine = JSON.parse(readFileSync(join(root, 'tokenomics', 'ENGINE.json'), 'utf8')).engine ?? engine;
  } catch (e) {
    if (e.code !== 'ENOENT') { // present but unreadable or unparseable: never invent a version
      process.stderr.write(`engine-manifest: ENGINE.json: unreadable (${e.code ?? e.message}); fix or remove it, nothing written\n`);
      return 1;
    }
    // ENOENT: the first write takes the default
  }
  writeFileSync(join(root, 'tokenomics', 'ENGINE.json'), `${JSON.stringify(buildManifest(root, { engine }), null, 2)}\n`);
  process.stdout.write('engine-manifest: wrote tokenomics/ENGINE.json\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
