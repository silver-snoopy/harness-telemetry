#!/usr/bin/env node
// harness-telemetry CLI — subcommands are registered by the modules that own them.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrationOn } from '../tokenomics/engine/migrations.mjs';
import { isMain, exitAfterDrain } from '../tokenomics/engine/entry.mjs';

export const COMMANDS = {};

export async function main(argv = process.argv.slice(2), io = { err: (s) => process.stderr.write(`${s}\n`) }) {
  const [name, ...rest] = argv;
  const cmd = COMMANDS[name];
  if (!cmd) {
    io.err(`usage: harness-telemetry <command> [args]\ncommands: ${Object.keys(COMMANDS).sort().join(', ') || '(none yet)'}`);
    return 2;
  }
  return cmd(rest, io);
}

COMMANDS.replay = async ([caseDir, implDir, ...rest]) => {
  const { runCase } = await import('../replay/runner.mjs');
  const r = await runCase(caseDir, implDir, { pricingMode: rest.includes('--record') ? 'record' : 'replay' });
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  return r.exits.every((c) => c === 0) ? 0 : 1;
};

COMMANDS.check = async (args, io) => {
  const { check } = await import('../tokenomics/kit/check.mjs');
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const dir = args.find((a, i) => !a.startsWith('--') && !['--mode', '--profile', '--repo', '--receipts-file'].includes(args[i - 1]));
  const profiles = (opt('--profile') ?? 'core').split(',');
  if ((args.includes('--run-receipts') || opt('--receipts-file')) && !profiles.includes('receipts')) profiles.push('receipts');
  let r;
  try {
    r = check(dir, { mode: opt('--mode'), profiles, repo: opt('--repo'),
      receiptsFile: opt('--receipts-file'), runReceipts: args.includes('--run-receipts') });
  } catch (e) { io.err(e.message); return 2; }
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  else for (const f of r.findings) process.stdout.write(`${f.class}\t${f.rule}\t${f.file ?? ''}${f.line ? `:${f.line}` : ''}\t${f.message}\n`);
  return r.exit;
};

COMMANDS.aggregate = async (args, io) => {
  const { aggregate } = await import('../tokenomics/kit/aggregate.mjs');
  const inputs = []; let since = null; let until = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') { const [mode, ...p] = (args[++i] ?? '').split(':'); inputs.push({ mode, path: p.join(':') }); }
    else if (args[i] === '--since') since = args[++i];
    else if (args[i] === '--until') until = args[++i];
  }
  try { process.stdout.write(`${JSON.stringify(aggregate(inputs, { since, until }), null, 2)}\n`); return 0; }
  catch (e) { io.err(e.message); return 2; }
};

COMMANDS.install = async (args, io) => {
  const usage = 'usage: harness-telemetry install <tokenomics|tokenomics-port> --target <claude|copilot|copilot-cli> [--repo <dir>] [--force]';
  if (args.includes('--symlink')) { io.err('symlink installs are rejected until the immutable revision cache (spec §18.6)'); return 2; }
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const repoAt = args.indexOf('--repo');
  if (repoAt >= 0 && (!args[repoAt + 1] || args[repoAt + 1].startsWith('--'))) { io.err(`--repo needs a directory\n${usage}`); return 2; }
  const skill = args.find((a, i) => !a.startsWith('--') && !['--target', '--repo'].includes(args[i - 1]));
  if (skill === 'tokenomics-port') { io.err('the tokenomics-port skill ships in milestone C1'); return 2; }
  const target = opt('--target') === 'copilot-cli' ? 'copilot' : opt('--target'); // the activation name of the same host
  if (skill !== 'tokenomics' || !['claude', 'copilot'].includes(target)) { io.err(usage); return 2; }
  const { installCopy, InstallError } = await import('../tokenomics/engine/install-copy.mjs');
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  try {
    const r = installCopy({ packageRoot, repo: opt('--repo') ?? process.cwd(), target, skill, from: gitDescribe(packageRoot), force: args.includes('--force') });
    process.stdout.write(`${r.status}: ${r.dest} (${r.files} files); not activated (the install copy never activates, spec §14.2)\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof InstallError)) { io.err(`install failed: ${String(e?.message ?? e).split('\n')[0]}`); return 1; }
    io.err(e.message);
    return e.code === 'usage' ? 2 : 1;
  }
};

function gitDescribe(packageRoot) {
  const git = (...a) => spawnSync('git', ['-C', packageRoot, ...a], { encoding: 'utf8' });
  try {
    const top = git('rev-parse', '--show-toplevel');
    if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(packageRoot)) return 'unknown';
    const d = git('describe', '--tags', '--always');
    return d.status === 0 && d.stdout.trim() ? d.stdout.trim() : 'unknown';
  } catch { return 'unknown'; }
}

const entryOn = migrationOn('entry-points'); // items 12/13: realpath main guard, exit after stdio drains
if (entryOn ? isMain(import.meta.url) : (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().then((code) => (entryOn ? exitAfterDrain(code) : process.exit(code)));
}
