import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEEP_PATTERNS } from '../scripts/sanitize.mjs';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const files = [];
const walk = (p) => { for (const e of readdirSync(p)) { const q = join(p, e); if (statSync(q).isDirectory()) walk(q); else if (q !== SELF) files.push(q); } };
walk(ROOT);

test('no raw-freeze paths, home paths or emails in corpus', () => {
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /harness-telemetry-corpus-raw/, f);
    assert.doesNotMatch(t, /\/Users\/|\/home\/[a-z]/, f);
    assert.doesNotMatch(t, /[A-Za-z0-9._%+-]@(?!example\.invalid)[A-Za-z0-9.-]+\.[a-z]{2,}/, f);
  }
});

test('no owner identity strings anywhere in the corpus (contents or file names)', () => {
  const ident = /daniel|sallai|aquanautica|epam/i;
  for (const f of files) {
    const rel = relative(ROOT, f);
    assert.doesNotMatch(rel, ident, `file name: ${rel}`);
    const t = readFileSync(f, 'utf8');
    const m = ident.exec(t);
    assert.equal(m, null, `${rel}: identity string at offset ${m?.index}`);
  }
});

test('no sentence-like text survives in inputs (every input string is masked or an id)', () => {
  for (const f of files.filter((x) => x.includes('/inputs/'))) {
    for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      assert.doesNotMatch(l, /\b(the|and|please|should|because)\b/i, `${f}: ${l.slice(0, 80)}`);
    }
  }
});

const inputsFiles = files.filter((x) => x.includes(`${sep}inputs${sep}`));

test('leaked strings found in review never reappear anywhere in corpus', () => {
  // Fragments are joined so this file does not itself contain the leaked strings.
  const leaked = new RegExp(['Tokenomics ' + 'viewer', 'campaign-board ' + 'ledger', 'dm' + '-kb', 'solo' + '-b9', 'mods-for-' + 'sdlc-skills'].join('|'), 'i');
  for (const f of files) {
    assert.doesNotMatch(relative(ROOT, f), leaked);
    assert.doesNotMatch(readFileSync(f, 'utf8'), leaked, relative(ROOT, f));
  }
});

// Mirrors scripts/build-case.mjs safePath: every component under inputs/ is id-shaped, fixed, or renamed.
const SAFE = [/^[0-9a-f-]{8,}(\.[a-z]+)*$/, /^agent-[A-Za-z0-9]+(\.meta\.json|\.jsonl)$/, /^wf_[0-9a-f-]+(\.json)?$/, /^toolu_[A-Za-z0-9]+\.txt$/,
  /^b[a-z0-9]{8}\.txt$/, /^hook-[0-9a-f-]+-\d+-additionalContext\.txt$/, /^(subagents|workflows|scripts|tool-results|journal\.jsonl|inputs|claude)$/, /^n[0-9a-f]{8}(\.[A-Za-z0-9]+)?$/];
test('every path component under inputs/ is id-shaped, a fixed dir name, or hashed', () => {
  for (const f of inputsFiles.filter((x) => x.includes(`${sep}real-`))) {
    for (const c of relative(ROOT, f).split(sep).slice(2)) { // cases/<id>/ are ours
      if (c === 'inputs') continue;
      assert.ok(SAFE.some((re) => re.test(c)), `${relative(ROOT, f)}: ${c}`);
    }
  }
});

test('every string under a kept key in inputs matches that key pattern (gitBranch and cwd exempt)', () => {
  const walkValue = (v, where, parent, inTools, inInput) => {
    if (Array.isArray(v)) return v.forEach((x) => walkValue(x, where, parent, false, inInput));
    if (v && typeof v === 'object') {
      const toolCtx = v.type === 'tool_use';
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string' && !inInput && k in KEEP_PATTERNS) {
          const masked = /^[x\s]+$/.test(x); // sanitiser output for a value that failed the pattern
          if (!masked) assert.match(x, KEEP_PATTERNS[k], `${where}: ${k}=${x.slice(0, 60)}`);
          if (k === 'name') assert.ok(masked || toolCtx || parent === 'tools', `${where}: name outside tool_use: ${x.slice(0, 60)}`);
        }
        if (x && typeof x === 'object') walkValue(x, where, k === 'tools' ? 'tools' : null, false, inInput || k === 'input');
      }
    }
  };
  for (const f of inputsFiles) {
    const where = relative(ROOT, f);
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.jsonl')) {
      for (const l of text.split('\n').filter(Boolean)) { try { walkValue(JSON.parse(l), where, null, false, false); } catch (e) { if (e.name === 'AssertionError') throw e; } }
    } else if (f.endsWith('.json')) {
      walkValue(JSON.parse(text), where, null, false, false);
    }
  }
});
