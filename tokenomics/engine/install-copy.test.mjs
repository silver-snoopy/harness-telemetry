// install copy (Plan 5 Task 3). Hermetic: the package's published files (npm pack --dry-run) are copied to a temp dir,
// installed from there, and the temp package is deleted before the installed copy is exercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../../scripts/engine-manifest.mjs';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const tmp = (p) => mkdtempSync(join(tmpdir(), `tokenomics-icopy-${p}-`));

let publishedList = null;
function published() {
  if (!publishedList) {
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--offline'], {
      cwd: REPO, encoding: 'utf8',
      env: { ...process.env, npm_config_cache: tmp('npmcache'), npm_config_update_notifier: 'false' },
    });
    assert.equal(r.status, 0, r.stderr);
    publishedList = JSON.parse(r.stdout)[0].files.map((f) => f.path);
  }
  return publishedList;
}

function makePackage() {
  const pkg = tmp('pkg');
  for (const rel of published()) {
    mkdirSync(dirname(join(pkg, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(pkg, rel));
  }
  return pkg;
}

const cli = (pkg, args, opts = {}) => spawnSync(process.execPath, [join(pkg, 'bin', 'harness-telemetry.mjs'), ...args], { encoding: 'utf8', ...opts });
const tree = (root) => {
  const out = {};
  const walk = (d, p) => { for (const e of readdirSync(d, { withFileTypes: true })) { const rel = p ? `${p}/${e.name}` : e.name; if (e.isDirectory()) walk(join(d, e.name), rel); else out[rel] = readFileSync(join(d, e.name), 'utf8'); } };
  walk(root, '');
  return out;
};

test('package.json files lists nothing missing (no LICENSE entry without a file)', () => {
  const pj = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  for (const f of pj.files) if (!f.startsWith('!') && !f.endsWith('/')) assert.ok(existsSync(join(REPO, f)), f);
});

test('(a)(b)(h) copy = baseline + ENGINE.json with installed; never activates; runs with the package deleted', () => {
  const pkg = makePackage();
  const repo = tmp('repo');
  const r = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(r.status, 0, r.stderr);
  const baseline = JSON.parse(readFileSync(join(pkg, 'tokenomics', 'ENGINE.json'), 'utf8'));
  rmSync(pkg, { recursive: true, force: true });
  const dest = join(repo, '.claude', 'skills', 'tokenomics');
  const files = Object.keys(tree(dest)).sort();
  assert.deepEqual(files, [...Object.keys(baseline.files), 'ENGINE.json'].sort());
  const eng = JSON.parse(readFileSync(join(dest, 'ENGINE.json'), 'utf8'));
  assert.equal(eng.installed.target, 'claude');
  assert.equal(eng.installed.from, 'unknown');
  assert.match(eng.installed.at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(eng.files, baseline.files);
  // never activates: nothing but the skill dir exists in the repo
  assert.deepEqual(readdirSync(repo).sort(), ['.claude']);
  assert.deepEqual(readdirSync(join(repo, '.claude')), ['skills']);
  // every entry runs from the copy alone, with no missing-module failure
  for (const rel of files.filter((f) => /^(hooks|scripts)\/[^/]+\.mjs$/.test(f) && f !== 'hooks/otel-sink.mjs')) { // otel-sink is a server: imported below, not run
    const e = spawnSync(process.execPath, [join(dest, rel), '--help'], { encoding: 'utf8', input: '', timeout: 20000, cwd: repo });
    // a standalone copy ships no extension (spec §14.1), so "cannot load extension" is expected and is not an engine miss
    const out = `${e.stderr}${e.stdout}`.split('\n').filter((l) => !/cannot load extension/.test(l)).join('\n');
    assert.doesNotMatch(out, /ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError/, `${rel}\n${out}`);
    assert.notEqual(e.signal, 'SIGTERM', `${rel} hung`);
    // T3-1: the entries whose --help / no-op run is clean must also exit 0 (the rest exit 1 or 2 for a missing extension, receipts or activation)
    if (/^hooks\/(scope-hook|telemetry-capture)\.mjs$|^scripts\/otel-report\.mjs$/.test(rel)) assert.equal(e.status, 0, `${rel}: ${e.stderr}`);
  }
  const imp = files.filter((f) => /^(engine|kit)\/[^/]+\.mjs$|^hooks\/otel-sink\.mjs$/.test(f)).map((f) => `await import(${JSON.stringify(join(dest, f))});`).join('\n');
  const e = spawnSync(process.execPath, ['--input-type=module', '-e', imp], { encoding: 'utf8', cwd: repo });
  assert.equal(e.status, 0, e.stderr);
});

test('copilot target lands under .github/skills/tokenomics', () => {
  const pkg = makePackage(); const repo = tmp('repo');
  assert.equal(cli(pkg, ['install', 'tokenomics', '--target', 'copilot', '--repo', repo]).status, 0);
  assert.ok(existsSync(join(repo, '.github', 'skills', 'tokenomics', 'ENGINE.json')));
});

test('(c) tokenomics-port exits 2 with the C1 message', () => {
  const r = cli(REPO, ['install', 'tokenomics-port', '--target', 'claude']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /the tokenomics-port skill ships in milestone C1/);
});

test('(d) unknown or missing target exits 2 with usage', () => {
  for (const args of [['install', 'tokenomics'], ['install', 'tokenomics', '--target', 'vim'], ['install', '--target', 'claude'], ['install', 'nope', '--target', 'claude']]) {
    const r = cli(REPO, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage: harness-telemetry install/);
  }
});

test('(e) --symlink is rejected; a symlink destination is refused', () => {
  const pkg = makePackage(); const repo = tmp('repo');
  const r = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--symlink', '--repo', repo]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /symlink installs are rejected until the immutable revision cache \(spec §18\.6\)/);
  const real = tmp('real');
  mkdirSync(join(repo, '.claude', 'skills'), { recursive: true });
  symlinkSync(real, join(repo, '.claude', 'skills', 'tokenomics'));
  const r2 = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /symlink/);
  assert.deepEqual(readdirSync(real), []);
});

function bump(pkg, version) {
  writeFileSync(join(pkg, 'tokenomics', 'SKILL.md'), `${readFileSync(join(pkg, 'tokenomics', 'SKILL.md'), 'utf8')}\nupgrade ${version}\n`);
  writeFileSync(join(pkg, 'tokenomics', 'ENGINE.json'), `${JSON.stringify(buildManifest(pkg, { engine: version }), null, 2)}\n`);
}

test('(f) upgrade replaces engine files only; local edits and strays refuse unless --force', () => {
  const pkg = makePackage(); const repo = tmp('repo');
  assert.equal(cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]).status, 0);
  const glue = { '.agents/tokenomics/settings.json': '{"engine":"0.4.0"}\n', '.claude/settings.json': '{"hooks":{}}\n', '.claude/skills/other/x.md': 'x\n' };
  for (const [p, c] of Object.entries(glue)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), c); }
  bump(pkg, '0.4.1');
  const r = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^upgraded:/);
  const dest = join(repo, '.claude', 'skills', 'tokenomics');
  assert.equal(JSON.parse(readFileSync(join(dest, 'ENGINE.json'), 'utf8')).engine, '0.4.1');
  assert.match(readFileSync(join(dest, 'SKILL.md'), 'utf8'), /upgrade 0\.4\.1/);
  for (const [p, c] of Object.entries(glue)) assert.equal(readFileSync(join(repo, p), 'utf8'), c, p);
  assert.deepEqual(readdirSync(join(repo, '.claude', 'skills')).sort(), ['other', 'tokenomics']);

  bump(pkg, '0.4.2');
  writeFileSync(join(dest, 'engine', 'order.mjs'), '// local edit\n');
  writeFileSync(join(dest, 'stray.txt'), 'mine\n');
  const before = tree(dest);
  const r2 = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /engine\/order\.mjs: locally modified/);
  assert.match(r2.stderr, /stray\.txt: unexpected file/);
  assert.deepEqual(tree(dest), before);
  assert.deepEqual(readdirSync(join(repo, '.claude', 'skills')).sort(), ['other', 'tokenomics']); // no temp leftovers
  const r3 = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo, '--force']);
  assert.equal(r3.status, 0, r3.stderr);
  assert.ok(!existsSync(join(dest, 'stray.txt')));
  assert.equal(JSON.parse(readFileSync(join(dest, 'ENGINE.json'), 'utf8')).engine, '0.4.2');
});

test('(g) re-copying the same version is unchanged and writes nothing', () => {
  const pkg = makePackage(); const repo = tmp('repo');
  assert.equal(cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]).status, 0);
  const dest = join(repo, '.claude', 'skills', 'tokenomics');
  const old = new Date(2020, 0, 1);
  for (const rel of Object.keys(tree(dest))) utimesSync(join(dest, rel), old, old);
  const before = tree(dest);
  const r = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^unchanged:/);
  assert.deepEqual(tree(dest), before);
  for (const rel of Object.keys(before)) assert.equal(statSync(join(dest, rel)).mtimeMs, old.getTime(), rel);
});

// --- fix wave lane C: M6, M7, T3-4, T3-7 ---------------------------------------------------------------------------

test('(M6) the upgrade swap leaves no skill-looking sibling; stale dot-prefixed leftovers of a crash are cleared', () => {
  const pkg = makePackage(); const repo = tmp('repo');
  assert.equal(cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]).status, 0);
  const skills = join(repo, '.claude', 'skills');
  // what a crash mid-swap would leave: each holds a SKILL.md a host could discover as a duplicate skill
  for (const n of ['.tokenomics.tmp-111', '.tokenomics.old-222']) { mkdirSync(join(skills, n), { recursive: true }); writeFileSync(join(skills, n, 'SKILL.md'), 'stale\n'); }
  bump(pkg, '0.4.1');
  const r = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(skills).sort(), ['tokenomics'], 'no temp, aside or stale sibling remains');
});

test('(M7) a .DS_Store in the installed copy is ignored: an upgrade proceeds, a same-version re-copy is unchanged', () => {
  const pkg = makePackage(); const repo = tmp('repo');
  assert.equal(cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]).status, 0);
  const dest = join(repo, '.claude', 'skills', 'tokenomics');
  writeFileSync(join(dest, '.DS_Store'), 'finder\n');
  writeFileSync(join(dest, 'engine', '.DS_Store'), 'finder\n');
  const same = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(same.status, 0, same.stderr);
  assert.match(same.stdout, /^unchanged:/);
  bump(pkg, '0.4.1');
  const up = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /^upgraded:/);
});

test('(T3-4) --repo with no value exits 2; a filesystem failure is one line and exit 1, never a stack', () => {
  const pkg = makePackage();
  for (const args of [['install', 'tokenomics', '--target', 'claude', '--repo'], ['install', 'tokenomics', '--target', 'claude', '--repo', '--force']]) {
    const cwd = tmp('cwd');
    const r = cli(pkg, args, { cwd });
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /--repo needs a directory/);
    assert.deepEqual(readdirSync(cwd), [], 'nothing installed into the cwd');
  }
  const notADir = join(tmp('file'), 'plain');
  writeFileSync(notADir, 'x');
  const r = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', notADir]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('(T3-7) an upgrade re-stamps installed; a copy missing a listed file refuses, naming it', () => {
  const pkg = makePackage(); const repo = tmp('repo');
  assert.equal(cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]).status, 0);
  const dest = join(repo, '.claude', 'skills', 'tokenomics');
  const first = JSON.parse(readFileSync(join(dest, 'ENGINE.json'), 'utf8')).installed;
  bump(pkg, '0.4.1');
  assert.equal(cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]).status, 0);
  const second = JSON.parse(readFileSync(join(dest, 'ENGINE.json'), 'utf8')).installed;
  assert.equal(second.target, 'claude');
  assert.match(second.at, /^\d{4}-\d\d-\d\dT/);
  assert.ok(second.at >= first.at, 'installed.at is re-stamped, not carried over');
  rmSync(join(dest, 'engine', 'order.mjs'));
  bump(pkg, '0.4.2');
  const r = cli(pkg, ['install', 'tokenomics', '--target', 'claude', '--repo', repo]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /engine\/order\.mjs: missing from the installed copy/);
});
