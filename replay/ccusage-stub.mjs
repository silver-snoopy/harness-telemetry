#!/usr/bin/env node
// TOKENOMICS_CCUSAGE_BIN double: serves frozen ccusage outputs keyed by the
// staged transcripts' content, or records them once (HT_PRICING_MODE=record).
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export const encodeProjectPath = (p) => p.replace(/[/\\:._ ]/g, '-');
export function pricingKey(configDir, sandboxRoot = process.env.HT_SANDBOX_ROOT ?? null) {
  const root = join(configDir, 'projects');
  const norm = (s) => {
    if (!sandboxRoot) return s;
    return s.split(sandboxRoot).join('<ROOT>').split(encodeProjectPath(sandboxRoot)).join('<ROOTKEY>');
  };
  const parts = walk(root).map((p) => {
    const rel = norm(relative(root, p).split(sep).slice(1).join('/')); // drop f<i>/
    const content = norm(readFileSync(p, 'utf8'));
    return `${rel}\0${createHash('sha256').update(content).digest('hex')}`;
  }).sort();
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export function main(env = process.env, argv = process.argv.slice(2)) {
  const dir = env.HT_PRICING_DIR;
  if (!dir || !env.CLAUDE_CONFIG_DIR) { process.stderr.write('ccusage-stub: HT_PRICING_DIR and CLAUDE_CONFIG_DIR required\n'); return 4; }
  const file = join(dir, `${pricingKey(env.CLAUDE_CONFIG_DIR)}.json`);
  if (env.HT_PRICING_MODE === 'record') {
    if (!env.HT_REAL_NPX) { process.stderr.write('ccusage-stub: HT_REAL_NPX required in record mode\n'); return 4; }
    const out = execFileSync(env.HT_REAL_NPX, ['--yes', `ccusage@${env.HT_CCUSAGE_VERSION || 'latest'}`, ...argv], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, out);
    process.stdout.write(out);
    return 0;
  }
  if (!existsSync(file)) { process.stderr.write(`ccusage-stub: no recorded response ${file}\n`); return 3; }
  process.stdout.write(readFileSync(file, 'utf8'));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
