// Plan 3 Task 5: every entry point given invalid settings puts the named settings error on stderr.
// Each runs in a child process (stubbing this process's stdout would swallow Node 18's test report).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MSG = 'tokenomics: invalid .agents/tokenomics/settings.json: dir must be a non-empty string';

// An explicit child env: only what node, git and the entry points need. Inheriting process.env would let a
// shell exporting TOKENOMICS_* (e.g. TOKENOMICS_MIGRATIONS) change what this test exercises.
const PASS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'USERPROFILE', 'NODE_V8_COVERAGE'];
const childEnv = (repo) => ({ ...Object.fromEntries(PASS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), CLAUDE_PROJECT_DIR: repo });

const badRepo = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ht-entry-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: d });
  mkdirSync(join(d, '.agents/tokenomics'), { recursive: true });
  writeFileSync(join(d, '.agents/tokenomics/settings.json'), JSON.stringify({ extension: null, dir: '' }));
  return d;
};

for (const [entry, args, input] of [
  ['scripts/work-scope.mjs', () => ['status', '--session', 's'], ''],
  ['scripts/team-report.mjs', (repo) => [repo], ''],
  ['scripts/batch-cost.mjs', () => ['--batch', 'b'], ''],
  ['hooks/scope-hook.mjs', () => ['--announce'], '{}'],
  ['hooks/telemetry-capture.mjs', () => [], '{}'],
  ['scripts/build-tokenomics-export.mjs', () => ['--batch', 'b', '--stdout'], ''],
]) {
  test(`${entry} with invalid settings names the error on stderr`, (t) => {
    const repo = badRepo(t);
    const r = spawnSync(process.execPath, [join(ROOT, entry), ...args(repo)], {
      cwd: repo, input, encoding: 'utf8', timeout: 20000, env: childEnv(repo),
    });
    assert.ok(r.stderr.includes(MSG), `${entry} exit ${r.status} signal ${r.signal}; stderr: ${JSON.stringify(r.stderr)}`);
  });
}

test('the child env carries no TOKENOMICS_* variable whatever the parent exports', () => {
  const r = spawnSync(process.execPath, ['-e', 'console.log(Object.keys(process.env).filter((k) => k.startsWith("TOKENOMICS_")).join(","))'], {
    encoding: 'utf8', env: { ...childEnv('/x') },
  });
  assert.equal(r.stdout.trim(), '');
  assert.ok(!Object.keys(childEnv('/x')).some((k) => k.startsWith('TOKENOMICS_')));
});
