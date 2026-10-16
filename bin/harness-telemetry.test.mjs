import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, COMMANDS } from './harness-telemetry.mjs';

test('unknown command exits 2 and lists commands', async () => {
  const lines = [];
  const code = await main(['nope'], { err: (s) => lines.push(s) });
  assert.equal(code, 2);
  assert.match(lines.join('\n'), /usage: harness-telemetry <command>/);
});

test('COMMANDS registers check, aggregate and replay as functions', async () => {
  for (const name of ['check', 'aggregate', 'replay']) assert.equal(typeof COMMANDS[name], 'function', name);
  const lines = [];
  await main(['nope'], { err: (s) => lines.push(s) });
  assert.match(lines.join('\n'), /commands: aggregate, check, install, replay/);
});

test('install accepts --target copilot-cli as the copilot target (the host name used by activation)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, existsSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const bin = new URL('./harness-telemetry.mjs', import.meta.url).pathname;
  const repo = mkdtempSync(join(tmpdir(), 'ht-bin-'));
  try {
    const r = spawnSync(process.execPath, [bin, 'install', 'tokenomics', '--target', 'copilot-cli', '--repo', repo], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const eng = JSON.parse(readFileSync(join(repo, '.github', 'skills', 'tokenomics', 'ENGINE.json'), 'utf8'));
    assert.equal(eng.installed.target, 'copilot');
    assert.ok(existsSync(join(repo, '.github', 'skills', 'tokenomics', 'scripts', 'install-hooks.mjs')));
    assert.equal(spawnSync(process.execPath, [bin, 'install', 'tokenomics', '--target', 'nope', '--repo', repo], { encoding: 'utf8' }).status, 2);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
