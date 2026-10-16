import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, utimesSync, copyFileSync, chmodSync, realpathSync, symlinkSync, lstatSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename, delimiter, resolve, isAbsolute, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pricingKey, encodeProjectPath } from './ccusage-stub.mjs';

export { encodeProjectPath };

/** `{impl}` (the implementation root) is available only where the runner supplies it. */
export function expand(s, ctx) {
  if (ctx.impl) s = s.replaceAll('{impl}', ctx.impl);
  return s.replaceAll('{home}', ctx.home).replaceAll('{repo}', ctx.repo).replaceAll('{repoKey}', encodeProjectPath(ctx.repo));
}

/** Every token makeScrub writes (and the runner's `<IMPL>`): a raw sandbox path containing one literally is
 * ambiguous with a scrubbed one (Codex B2-01). */
export const SCRUB_TOKENS = ['<REPOKEY>', '<ROOTKEY>', '<REPO>', '<HOME>', '<ROOT>', '<IMPL>'];

/** Replace sandbox-specific paths with stable tokens. Encoded keys first, then literal paths. */
export function makeScrub(sb) {
  return (s) => s
    .replaceAll(encodeProjectPath(sb.repo), '<REPOKEY>')
    .replaceAll(encodeProjectPath(sb.root), '<ROOTKEY>')
    .replaceAll(sb.repo, '<REPO>')
    .replaceAll(sb.home, '<HOME>')
    .replaceAll(sb.root, '<ROOT>');
}

/** True when a relative path stays strictly inside the sandbox root (not the root itself, never `..`). */
export function insideSandbox(rel) {
  const r = relative('/sandbox', resolve('/sandbox', rel));
  return Boolean(r) && !r.startsWith('..') && !isAbsolute(r);
}

/**
 * Manifest `symlinks: [{ path, target }]`: `path` is relative to the sandbox root, `target` is the link text.
 * A relative target may dangle (that is the point: existsSync false, write ENOENT), but it must not resolve
 * outside the sandbox; absolute targets are refused.
 */
export function symlinkProblems(symlinks, where = 'symlinks') {
  const errs = [];
  if (symlinks === undefined) return errs;
  if (!Array.isArray(symlinks)) return [`${where}: must be an array`];
  symlinks.forEach((l, i) => {
    if (!l || typeof l.path !== 'string' || typeof l.target !== 'string' || !l.path || !l.target) { errs.push(`${where}[${i}]: needs string path and target`); return; }
    if (isAbsolute(l.path) || !insideSandbox(l.path)) errs.push(`${where}[${i}].path: ${JSON.stringify(l.path)} must stay inside the sandbox`);
    else if (isAbsolute(l.target) || !insideSandbox(join(dirname(l.path), l.target))) errs.push(`${where}[${i}].target: ${JSON.stringify(l.target)} must be relative and stay inside the sandbox`);
  });
  return errs;
}

export function buildSandbox(caseDirIn, m) {
  const caseDir = resolve(caseDirIn);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ht-sandbox-')));
  try {
    return buildInto(root, caseDir, m);
  } catch (e) {
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
}

function buildInto(root, caseDir, m) {
  const home = join(root, 'home');
  const repo = join(root, m.repo.path);
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  // No network: a fake npx that fails loudly shadows the real one.
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npx'), '#!/bin/sh\necho "npx disabled in replay" >&2\nexit 97\n');
  chmodSync(join(bin, 'npx'), 0o755);
  const ctx = { home, repo };
  // Built from scratch: a host GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE (e.g. tests run from a git hook)
  // must never redirect the sandbox's init/config/commit into another repository.
  const gitEnv = {
    PATH: process.env.PATH, HOME: home,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore', env: gitEnv });
  g('init', '-q', '-b', m.repo.branch);
  g('config', 'user.name', m.identity.gitUser);
  g('config', 'user.email', m.identity.gitEmail);
  // Manifest order is mtime order, 1 ms apart and in the recent past: a writer that orders files by mtime (the
  // reference's receipt loader) then sees the same order on every filesystem, never a same-tick tie (coarse on Linux).
  const files = Object.entries(m.repo.files ?? {});
  const t0 = Date.now() - files.length;
  files.forEach(([rel, content], i) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), content);
    const t = new Date(t0 + i);
    utimesSync(join(repo, rel), t, t);
  });
  writeFileSync(join(repo, '.keep'), '');
  g('add', '-A');
  g('commit', '-q', '-m', 'seed');
  for (const s of m.stores ?? []) {
    const to = join(root, expand(s.to, ctx));
    mkdirSync(dirname(to), { recursive: true });
    const raw = readFileSync(join(caseDir, s.from), 'utf8');
    writeFileSync(to, s.template ? expand(raw, ctx) : raw);
    if (s.mtime) { const t = new Date(s.mtime); utimesSync(to, t, t); }
  }
  for (const l of m.symlinks ?? []) {
    const at = join(root, l.path);
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(l.target, at);
  }
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: home, TZ: 'UTC', LANG: 'C', LC_ALL: 'C',
    TOKENOMICS_NO_SYNC: '1', TOKENOMICS_NO_SINK: '1', TOKENOMICS_NO_BATCH_COST: '1',
    TOKENOMICS_CCUSAGE_BIN: fileURLToPath(new URL('./ccusage-stub.mjs', import.meta.url)),
    HT_PRICING_DIR: join(caseDir, 'pricing'),
    HT_SANDBOX_ROOT: root,
    CLAUDE_PROJECT_DIR: repo,
    GIT_CONFIG_NOSYSTEM: '1',
  };
  return { root, home, repo, env, ctx };
}

/** Stage a case's Claude transcripts the way meterSession does and return the pricing key. */
export async function stagePricingProbe(caseDirIn) {
  const caseDir = resolve(caseDirIn);
  const m = JSON.parse(readFileSync(join(caseDir, 'replay.json'), 'utf8'));
  const sb = buildSandbox(caseDir, m);
  const stage = mkdtempSync(join(tmpdir(), 'ht-stage-'));
  const files = (m.stores ?? []).filter((s) => s.to.includes('.claude/projects/')).map((s) => join(sb.root, expand(s.to, sb.ctx)));
  files.forEach((f, i) => { const d = join(stage, 'projects', `f${i}`); mkdirSync(d, { recursive: true }); copyFileSync(f, join(d, basename(f))); });
  return pricingKey(stage, sb.root);
}

/** Remove a sandbox even when a fault case left directories without write/exec permission. */
export function removeSandbox(root) {
  const open = (p) => {
    let st; try { st = lstatSync(p); } catch { return; }
    if (!st.isDirectory()) return;
    try { chmodSync(p, 0o700); } catch { /* best effort */ }
    let ents = []; try { ents = readdirSync(p); } catch { return; }
    for (const e of ents) open(join(p, e));
  };
  open(root);
  rmSync(root, { recursive: true, force: true });
}
