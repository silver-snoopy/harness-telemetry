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

test('provenance: a git checkout gives git describe; an npx github: install gives the resolved commit; otherwise name@version, never unknown', async () => {
  const { provenance } = await import('./harness-telemetry.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'ht-prov-'));
  try {
    // the layout npx leaves: <npx dir>/node_modules/harness-telemetry + <npx dir>/node_modules/.package-lock.json
    const pkg = join(root, 'node_modules', 'harness-telemetry');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'harness-telemetry', version: '9.8.7' }));
    assert.equal(provenance(pkg), 'harness-telemetry@9.8.7', 'no lockfile: name@version');
    writeFileSync(join(root, 'node_modules', '.package-lock.json'), JSON.stringify({ packages: { 'node_modules/harness-telemetry': {
      version: '9.8.7', resolved: 'git+ssh://git@github.com/silver-snoopy/harness-telemetry.git#369bea8cbf5efa377c3e5ac12b5f87e71761fe36' } } }));
    assert.equal(provenance(pkg), 'github:silver-snoopy/harness-telemetry#369bea8');
    writeFileSync(join(root, 'node_modules', '.package-lock.json'), JSON.stringify({ packages: { 'node_modules/harness-telemetry': {
      version: '9.8.7', resolved: 'https://registry.npmjs.org/harness-telemetry/-/harness-telemetry-9.8.7.tgz' } } }));
    assert.equal(provenance(pkg), 'harness-telemetry@9.8.7', 'a registry tarball: name@version');
    assert.equal(provenance(join(root, 'nowhere')), 'unknown', 'only an unreadable package is unknown');
  } finally { rmSync(root, { recursive: true, force: true }); }
  const { fileURLToPath } = await import('node:url');
  assert.match(provenance(fileURLToPath(new URL('..', import.meta.url))), /^(v\d|[0-9a-f]{7})/, 'this checkout: git describe');
});
