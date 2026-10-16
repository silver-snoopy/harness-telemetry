#!/usr/bin/env node
// Differential gate (spec §18.2): replay every corpus case against an
// implementation and compare with the reference goldens, both directions, byte for byte.
import { readdirSync, readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCase } from '../replay/runner.mjs';
import { expectedExits } from '../replay/exits.mjs';
import { engineOnlyProblems } from './engine-only.mjs';
import { compareFiles, goldenFiles } from './migrations.mjs';

export { compareFiles, goldenFiles };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ENGINE = join(ROOT, 'tokenomics');
const CASES = join(ROOT, 'corpus/cases');

/** `traceHooks`: every event also gets HT_EXT_TRACE_FILE=<a temp file outside the sandbox> — the
 * engine's hook() appends each extension hook it calls — and the result is `{ results, hooks }`
 * (the called hook names, in call order). diffImpl owns the trace file: it is read and its temp
 * dir removed before returning, even when a replay throws. `migrations` is passed to every replay as
 * TOKENOMICS_MIGRATIONS; the default `none` is the B1 extraction the reference goldens describe. */
export async function diffImpl(implDir, { cases = null, traceHooks = false, migrations = 'none' } = {}) {
  // Every case directory is diffed (spec 18.2). Only replay.json "implOnly": "engine" cases are
  // exempt (no reference golden exists for them), and that set is pinned in corpus/engine-only.json
  // (engineOnlyProblems rows below); any other missing input is a reported problem.
  const list = cases ?? readdirSync(CASES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const results = [];
  const approvals = JSON.parse(readFileSync(join(ROOT, 'corpus/engine-only.json'), 'utf8'));
  for (const p of engineOnlyProblems(CASES, approvals)) results.push({ case: '(engine-only)', problems: [p] });
  const traceDir = traceHooks ? mkdtempSync(join(tmpdir(), 'ht-ext-trace-')) : null;
  const traceFile = traceDir && join(traceDir, 'hooks.txt');
  if (traceFile) writeFileSync(traceFile, '');
  const extraEnv = { TOKENOMICS_MIGRATIONS: migrations, ...(traceFile ? { HT_EXT_TRACE_FILE: traceFile } : {}) };
  try {
  for (const c of list) {
    const dir = join(CASES, c);
    const replayPath = join(dir, 'replay.json');
    if (!existsSync(replayPath)) { results.push({ case: c, problems: ['no replay.json'] }); continue; }
    const manifest = JSON.parse(readFileSync(replayPath, 'utf8'));
    if (manifest.implOnly === 'engine') continue;
    const goldDir = join(dir, 'expected/49577c7');
    if (!existsSync(goldDir)) { results.push({ case: c, problems: ['no golden'] }); continue; }
    const want = expectedExits(dir, manifest);
    // A golden or replay refused under the byte/namespace/scrub policy (Codex B2-01…03) is this case's problem.
    let problems;
    try { const gold = goldenFiles(goldDir); const r = await runCase(dir, implDir, { extraEnv }); problems = compareFiles(gold, r.files, want, r.exits); } catch (err) { problems = [err.message]; }
    results.push({ case: c, problems });
  }
  return traceFile ? { results, hooks: readFileSync(traceFile, 'utf8').split('\n').filter(Boolean) } : results;
  } finally {
    if (traceDir) rmSync(traceDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await diffImpl(process.argv[2] ?? ENGINE);
  const bad = r.filter((x) => x.problems.length);
  for (const b of bad) process.stderr.write(`${b.case}: ${b.problems.join(', ')}\n`);
  process.stderr.write(`cases ${r.length}, differing ${bad.length}\n`);
  process.exitCode = bad.length ? 1 : 0;
}
