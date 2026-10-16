import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCase } from '../replay/runner.mjs';
import { refDir } from './vendor-reference.mjs';
import { rewriteCwd, stripLine, safePath } from './build-case.mjs';

const CASES = fileURLToPath(new URL('../corpus/cases/', import.meta.url));

test('rewriteCwd rewrites cwd at any depth', () => {
  const r = rewriteCwd({ cwd: '/a/b', x: [{ y: { cwd: '/c' } }], n: 1 });
  assert.deepEqual(r, { cwd: '{repo}', x: [{ y: { cwd: '{repo}' } }], n: 1 });
});

test('stripLine drops text-derived fields and subagent labels only', () => {
  const l = stripLine({ prompts: 1, dispatched: 2, title: 't', tokens: 5, subagents: [{ label: 'x', cases: ['a'], tokens: 1 }] });
  assert.deepEqual(l, { tokens: 5, subagents: [{ cases: ['a'], tokens: 1 }] });
});

test('safePath keeps id-shaped names and hashes anything that can carry text', () => {
  assert.equal(safePath('e199df71-fb25-4903-909c-eeeac5d881e3/subagents/workflows/wf_aa318084-620/agent-a1b2.meta.json'),
    'e199df71-fb25-4903-909c-eeeac5d881e3/subagents/workflows/wf_aa318084-620/agent-a1b2.meta.json');
  const p = safePath('abcdef12-0000/workflows/scripts/my-private-title-wf_1.js');
  assert.match(p, /^abcdef12-0000\/workflows\/scripts\/n[0-9a-f]{8}\.js$/);
  assert.equal(p, safePath('abcdef12-0000/workflows/scripts/my-private-title-wf_1.js'));
});

const dirBytes = (p) => readdirSync(p, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? dirBytes(join(p, e.name)) : statSync(join(p, e.name)).size), 0);
const real = readdirSync(CASES).filter((d) => d.startsWith('real-'));

test('real corpus stays inside the size caps (10 MB per case, 40 MB total)', () => {
  let total = 0;
  for (const c of real) {
    const n = dirBytes(join(CASES, c, 'inputs'));
    assert.ok(n <= 10_000_000, `${c}: ${n}`);
    total += n;
  }
  assert.ok(total <= 40_000_000, `total ${total}`);
});

for (const c of real) {
  test(`${c}: sanitised replay equals the raw-capture facts recorded at build time`, async () => {
    const dir = join(CASES, c);
    const facts = join(dir, 'raw-facts.json');
    assert.ok(existsSync(facts));
    const r = await runCase(dir, refDir('49577c7'));
    const key = Object.keys(r.files).find((k) => /usage-.*\.jsonl$/.test(k));
    const got = r.files[key].trim().split('\n').map((l) => stripLine(JSON.parse(l)));
    assert.deepEqual(got, JSON.parse(readFileSync(facts, 'utf8')));
  });
}
