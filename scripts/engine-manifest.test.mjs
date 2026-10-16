// Tests for the ENGINE.json hash baseline (Plan 5 D-ENG).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineFiles, buildManifest } from './engine-manifest.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'scripts', 'engine-manifest.mjs');
const check = (root) => spawnSync(process.execPath, [SCRIPT, '--check', '--root', root], { encoding: 'utf8' });

// A copy of the tokenomics subtree plus package.json: the check runs against it, never the real tree.
function copyRoot() {
  const root = mkdtempSync(join(tmpdir(), 'ht-engine-manifest-'));
  cpSync(join(REPO, 'tokenomics'), join(root, 'tokenomics'), { recursive: true });
  cpSync(join(REPO, 'package.json'), join(root, 'package.json'));
  return root;
}

test('--check passes on the committed tree', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('baseline set excludes ENGINE.json, tests, fixtures, extensions and ENGINE-B1.md', () => {
  const files = baselineFiles(REPO);
  assert.deepEqual(files, [...files].sort());
  for (const f of files) {
    assert.ok(!/(^|\/)fixtures\//.test(f) && !f.startsWith('extensions/'), f);
    assert.ok(!f.endsWith('.test.mjs') && f !== 'ENGINE.json' && f !== 'ENGINE-B1.md', f);
  }
  assert.ok(files.includes('engine/version.mjs') && files.includes('SKILL.md'));
});

test('buildManifest has the D-ENG shape with installed: null', () => {
  const m = buildManifest(REPO, { engine: '0.4.0' });
  assert.deepEqual(Object.keys(m), ['engine', 'extensionApi', 'files', 'installed']);
  assert.equal(m.extensionApi, 2);
  assert.equal(m.installed, null);
  assert.match(m.files['engine/version.mjs'], /^sha256:[0-9a-f]{64}$/);
});

test('editing a baseline file fails --check and names it', () => {
  const root = copyRoot();
  try {
    writeFileSync(join(root, 'tokenomics', 'engine', 'version.mjs'), '// edited\n', { flag: 'a' });
    const r = check(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /engine\/version\.mjs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('adding a file outside the baseline exclusions fails: not in baseline', () => {
  const root = copyRoot();
  try {
    writeFileSync(join(root, 'tokenomics', 'engine', 'x.mjs'), 'export {};\n');
    const r = check(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /engine\/x\.mjs.*not in baseline/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing baseline file fails --check', () => {
  const root = copyRoot();
  try {
    rmSync(join(root, 'tokenomics', 'engine', 'version.mjs'));
    const r = check(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /engine\/version\.mjs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('test files, fixtures and extensions changes do not fail --check', () => {
  const root = copyRoot();
  try {
    writeFileSync(join(root, 'tokenomics', 'engine', 'new.test.mjs'), '// t\n');
    mkdirSync(join(root, 'tokenomics', 'fixtures', 'zz'), { recursive: true });
    writeFileSync(join(root, 'tokenomics', 'fixtures', 'zz', 'a.json'), '{}');
    mkdirSync(join(root, 'tokenomics', 'extensions'), { recursive: true });
    writeFileSync(join(root, 'tokenomics', 'extensions', 'e.mjs'), '// e\n');
    writeFileSync(join(root, 'tokenomics', 'ENGINE-B1.md'), 'changed\n');
    const r = check(root);
    assert.equal(r.status, 0, r.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('package.json version equals ENGINE.json engine', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const eng = JSON.parse(readFileSync(join(REPO, 'tokenomics', 'ENGINE.json'), 'utf8'));
  assert.equal(pkg.version, eng.engine);
  assert.equal(eng.installed, null, 'the source tree is never marked installed');
});

// T2-2: write mode never invents the engine version when ENGINE.json is present but unreadable.
test('write mode: a corrupt ENGINE.json exits 1 and is left untouched; an absent one takes the first-write default', () => {
  const root = copyRoot();
  try {
    const file = join(root, 'tokenomics', 'ENGINE.json');
    writeFileSync(file, '{ not json');
    const bad = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stdout);
    assert.match(bad.stderr, /ENGINE\.json: unreadable/);
    assert.equal(readFileSync(file, 'utf8'), '{ not json', 'nothing was written');
    rmSync(file);
    const first = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).engine, '0.4.0');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('npm pack --dry-run ships the baseline and none of the excluded subtrees', () => {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--offline', '--ignore-scripts'],
    { cwd: REPO, encoding: 'utf8', env: { ...process.env, npm_config_cache: mkdtempSync(join(tmpdir(), 'tokenomics-npmcache-')), npm_config_update_notifier: 'false' } });
  assert.equal(r.status, 0, r.stderr);
  const paths = JSON.parse(r.stdout)[0].files.map((f) => f.path);
  const eng = JSON.parse(readFileSync(join(REPO, 'tokenomics', 'ENGINE.json'), 'utf8'));
  for (const f of [...Object.keys(eng.files), 'ENGINE.json']) assert.ok(paths.includes(`tokenomics/${f}`), f);
  assert.ok(paths.includes('bin/harness-telemetry.mjs') && paths.includes('package.json'));
  for (const p of paths) {
    assert.ok(!/^tokenomics\/(fixtures|extensions)\//.test(p) && !p.endsWith('.test.mjs') &&
      p !== 'tokenomics/ENGINE-B1.md', `excluded path shipped: ${p}`);
    assert.ok(!p.startsWith('reference/') && !p.startsWith('corpus/') && !p.startsWith('replay/'), p);
  }
});

test('SKILL.md has the tokenomics frontmatter', () => {
  const t = readFileSync(join(REPO, 'tokenomics', 'SKILL.md'), 'utf8');
  assert.match(t, /^---\nname: tokenomics\ndescription: .+\n---\n/);
  assert.ok(existsSync(join(REPO, 'tokenomics', 'ENGINE.json')));
});
