import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excludes, gate, branchGate, blockId, branchScope, weakFnExclusions, fnsContaining } from './coverage.mjs';

const uncovered = ['hooks/otel-sink.mjs#(never loaded)@0', 'scripts/a.mjs#f@100', 'scripts/a.mjs#(anonymous)@200', 'scripts/b.mjs#g@5'];

test('excludes: whole file, function name, and function name at an offset', () => {
  assert.ok(excludes({ file: 'hooks/otel-sink.mjs', fn: '*' }, uncovered[0]));
  assert.ok(excludes({ file: 'scripts/a.mjs', fn: 'f' }, 'scripts/a.mjs#f@100'));
  assert.ok(excludes({ file: 'scripts/a.mjs', fn: 'f', offset: 100 }, 'scripts/a.mjs#f@100'));
  assert.ok(!excludes({ file: 'scripts/a.mjs', fn: 'f', offset: 101 }, 'scripts/a.mjs#f@100'));
  assert.ok(!excludes({ file: 'scripts/a.mjs', fn: 'fo' }, 'scripts/a.mjs#f@100'));
  assert.ok(!excludes({ file: 'scripts/a', fn: '*' }, 'scripts/a.mjs#f@100'));
});

test('gate: open functions and stale exclusions are both reported', () => {
  const ex = [
    { file: 'hooks/otel-sink.mjs', fn: '*' },
    { file: 'scripts/a.mjs', fn: 'f', offset: 100 },
    { file: 'scripts/a.mjs', fn: '(anonymous)', offset: 999 }, // stale: offset matches nothing
    { file: 'scripts/gone.mjs', fn: '*' }, // stale: file has nothing uncovered
  ];
  const { open, stale } = gate(uncovered, ex);
  assert.deepEqual(open, ['scripts/a.mjs#(anonymous)@200', 'scripts/b.mjs#g@5']);
  assert.deepEqual(stale.map((e) => `${e.file}#${e.fn}`), ['scripts/a.mjs#(anonymous)', 'scripts/gone.mjs#*']);
});

test('gate: a clean run has neither open nor stale', () => {
  const ex = [{ file: 'hooks/otel-sink.mjs', fn: '*' }, { file: 'scripts/a.mjs', fn: '*' }, { file: 'scripts/b.mjs', fn: 'g' }];
  assert.deepEqual(gate(uncovered, ex), { open: [], stale: [] });
});

test('blockId is stable and line-based', () => {
  const src = 'a\nif (x) {\n  y();\n}\n';
  const off = src.indexOf('{');
  const b = blockId('f.mjs', src, off);
  assert.match(b.id, /^f\.mjs:2:8:[0-9a-f]{8}$/);
  assert.equal(b.line, 2);
  assert.equal(b.col, 8);
});

test('branchGate: open, stale, weak, over budget', () => {
  const dead = [{ id: 'f.mjs:2:8:aaaaaaaa', file: 'f.mjs' }, { id: 'f.mjs:9:1:bbbbbbbb', file: 'f.mjs' }];
  const ex = [
    { id: 'f.mjs:9:1:bbbbbbbb', kind: 'unreachable', reason: 'short' },
    { id: 'f.mjs:99:1:cccccccc', kind: 'approved-reachable', reason: 'x'.repeat(50) },
  ];
  const r = branchGate(dead, ex, { 'f.mjs': 5 });
  assert.deepEqual(r.open, ['f.mjs:2:8:aaaaaaaa']);
  assert.equal(r.stale.length, 1);
  assert.equal(r.weak.length, 1);
  assert.deepEqual(r.overBudget, [{ file: 'f.mjs', excluded: 1, waived: 0, total: 5 }]); // 1/5 = 20% > 15%
});

test('unreachable needs a line citation even when long', () => {
  const dead = [{ id: 'f.mjs:3:1:dddddddd', file: 'f.mjs' }];
  const r = branchGate(dead, [{ id: 'f.mjs:3:1:dddddddd', kind: 'unreachable', reason: 'this branch can never run because the caller always passes a value' }], { 'f.mjs': 100 });
  assert.equal(r.weak.length, 1);
});

test('branchScope: files with a whole-file function exclusion are out of scope', () => {
  const dead = [{ id: 'hooks/otel-sink.mjs:1:1:aa', file: 'hooks/otel-sink.mjs', inFns: [] }, { id: 'scripts/a.mjs:1:1:bb', file: 'scripts/a.mjs', inFns: [] }];
  const r = branchScope(dead, [{ file: 'hooks/otel-sink.mjs', fn: '*', wholeFile: true }]);
  assert.deepEqual(r.scoped.map((b) => b.id), ['scripts/a.mjs:1:1:bb']);
  assert.deepEqual(r.skippedFiles, ['hooks/otel-sink.mjs']);
  // a `*` exclusion without `wholeFile: true` takes no file out of the branch gate (and is weak)
  assert.deepEqual(branchScope(dead, [{ file: 'hooks/otel-sink.mjs', fn: '*' }]).skippedFiles, []);
});

test('branchScope: a dead block inside a function-excluded function is covered by that exclusion', () => {
  const dead = [
    { id: 'scripts/a.mjs:5:1:aa', file: 'scripts/a.mjs', inFns: ['scripts/a.mjs#f@100'] },
    { id: 'scripts/a.mjs:9:1:bb', file: 'scripts/a.mjs', inFns: ['scripts/a.mjs#g@200'] },
    { id: 'scripts/a.mjs:12:1:cc', file: 'scripts/a.mjs', inFns: [] },
  ];
  const r = branchScope(dead, [{ file: 'scripts/a.mjs', fn: 'f', offset: 100 }]);
  assert.deepEqual(r.byFunction.map((b) => b.id), ['scripts/a.mjs:5:1:aa']);
  assert.deepEqual(r.scoped.map((b) => b.id), ['scripts/a.mjs:9:1:bb', 'scripts/a.mjs:12:1:cc']);
});

test('weakFnExclusions: branch reason rules apply to function exclusions; whole-file needs wholeFile: true', () => {
  const long = 'x'.repeat(45);
  const ok = [
    { file: 'a.mjs', fn: '*', wholeFile: true, kind: 'approved-reachable', reason: long },
    { file: 'a.mjs', fn: 'f', kind: 'approved-reachable', reason: long },
    { file: 'a.mjs', fn: 'f', kind: 'unreachable', reason: 'the only caller (scripts/a.mjs:12) always passes it, never undefined' },
  ];
  assert.deepEqual(weakFnExclusions(ok, { pinned: new Set(['a.mjs']) }), []);
  const weak = [
    { file: 'a.mjs', fn: 'g', kind: 'approved-reachable', reason: 'too short' },
    { file: 'a.mjs', fn: 'h', kind: 'unreachable', reason: 'every caller passes an explicit value, so this default never runs' },
    { file: 'a.mjs', fn: '*', kind: 'approved-reachable', reason: long }, // single-entry whole-file bypass
    { file: 'a.mjs', fn: 'k', wholeFile: true, kind: 'approved-reachable', reason: long },
  ];
  assert.deepEqual(weakFnExclusions(weak, { pinned: new Set(['a.mjs']) }), weak);
});

test('fnsContaining (measure inFns): the uncovered functions whose range holds the offset, same file only', () => {
  const fnEnds = new Map([
    ['a.mjs#outer@0', ['a.mjs', 0, 100]],
    ['a.mjs#inner@10', ['a.mjs', 10, 40]],
    ['a.mjs#later@100', ['a.mjs', 100, 200]],
    ['b.mjs#other@0', ['b.mjs', 0, 500]],
  ]);
  const uncovered = ['a.mjs#outer@0', 'a.mjs#inner@10', 'a.mjs#later@100', 'b.mjs#other@0', 'a.mjs#(never loaded)@0'];
  assert.deepEqual(fnsContaining(uncovered, fnEnds, 'a.mjs', 20), ['a.mjs#outer@0', 'a.mjs#inner@10']);
  assert.deepEqual(fnsContaining(uncovered, fnEnds, 'a.mjs', 40), ['a.mjs#outer@0']); // end is exclusive
  assert.deepEqual(fnsContaining(uncovered, fnEnds, 'a.mjs', 100), ['a.mjs#later@100']);
  assert.deepEqual(fnsContaining(uncovered.filter((k) => k !== 'a.mjs#outer@0'), fnEnds, 'a.mjs', 50), []); // covered fns are not listed
  assert.deepEqual(fnsContaining(uncovered, fnEnds, 'c.mjs', 5), []);
});

import { KINDS, citationProblems, exclusionProblems, pinProblems, duplicateFnExclusions } from './coverage.mjs';

const fakeRef = (f) => ({ 'scripts/a.mjs': 'l1\nl2\nl3\n', 'hooks/h.mjs': 'x\n' })[f] ?? null;

test('exclusion kinds are an exact enum', () => {
  assert.deepEqual(KINDS, ['approved-reachable', 'unreachable', 'failure-only']);
  const p = exclusionProblems({ id: 'scripts/a.mjs:1:1:aaaaaaaa', kind: 'unreachble', reason: 'x'.repeat(50) + ' a.mjs:2' }, { level: 'branch', pinned: new Set(), readRef: fakeRef });
  assert.ok(p.some((s) => s.startsWith('unknown kind')), JSON.stringify(p));
});

test('citations must resolve to a real reference line', () => {
  assert.deepEqual(citationProblems('guarded at a.mjs:3 and scripts/a.mjs:2', fakeRef), []);
  assert.deepEqual(citationProblems('see a.mjs:9', fakeRef), ['bad citation a.mjs:9']);
  assert.deepEqual(citationProblems('see nope.mjs:1', fakeRef), ['bad citation nope.mjs:1']);
  assert.deepEqual(citationProblems('ratio 1:2 is not a citation', fakeRef), []);
});

test('unreachable needs a .mjs:line citation, not any colon-digits', () => {
  const p = exclusionProblems({ id: 'scripts/a.mjs:1:1:aaaaaaaa', kind: 'unreachable', reason: 'the ratio is always 1:2 so this branch can never be taken at all' }, { level: 'branch', pinned: new Set(), readRef: fakeRef });
  assert.ok(p.includes('no file:line citation'), JSON.stringify(p));
});

test('whole-file scope must be pinned', () => {
  const e = { file: 'scripts/a.mjs', fn: '*', wholeFile: true, kind: 'approved-reachable', reason: 'x'.repeat(50) };
  assert.ok(exclusionProblems(e, { level: 'function', pinned: new Set(), readRef: fakeRef }).includes('whole-file scope not pinned'));
  assert.deepEqual(exclusionProblems(e, { level: 'function', pinned: new Set(['scripts/a.mjs']), readRef: fakeRef }), []);
});

test('function waivers count against the branch budget; duplicates are reported', () => {
  const dead = Array.from({ length: 3 }, (_, i) => ({ id: `scripts/a.mjs:${i + 1}:1:0000000${i}`, file: 'scripts/a.mjs' }));
  const r = branchGate(dead, [], { 'scripts/a.mjs': 100 }, { waived: { 'scripts/a.mjs': 20 } });
  assert.deepEqual(r.overBudget, [{ file: 'scripts/a.mjs', excluded: 0, waived: 20, total: 100 }]);
  const ex = [{ id: dead[0].id, kind: 'failure-only', reason: 'covered by case fault-x, V8 cannot attribute the catch here' }];
  const d = branchGate(dead, [...ex, ...ex], { 'scripts/a.mjs': 100 });
  assert.deepEqual(d.duplicate, [dead[0].id]);
});

import { readFileSync, existsSync } from 'node:fs';
import { refDir } from './vendor-reference.mjs';

test('every committed exclusion is valid against the real reference', () => {
  const REF = refDir('49577c7');
  const readRef = (f) => (existsSync(`${REF}/${f}`) ? readFileSync(`${REF}/${f}`, 'utf8') : null);
  const pinned = new Set(JSON.parse(readFileSync(new URL('../corpus/coverage/whole-file-scope.json', import.meta.url), 'utf8')).map((p) => p.file));
  const fnEx = JSON.parse(readFileSync(new URL('../corpus/coverage/exclusions.json', import.meta.url), 'utf8'));
  const brEx = JSON.parse(readFileSync(new URL('../corpus/coverage/branch-exclusions.json', import.meta.url), 'utf8'));
  const pins = JSON.parse(readFileSync(new URL('../corpus/coverage/whole-file-scope.json', import.meta.url), 'utf8'));
  assert.deepEqual(pinProblems(pins, { readRef, ex: fnEx }), []);
  assert.deepEqual(duplicateFnExclusions(fnEx), []);
  const bad = [
    ...fnEx.map((e) => [`${e.file}#${e.fn}`, exclusionProblems(e, { level: 'function', pinned, readRef })]),
    ...brEx.map((e) => [e.id, exclusionProblems(e, { level: 'branch', pinned, readRef })]),
  ].filter(([, p]) => p.length);
  assert.deepEqual(bad, []);
});

test('citations reject line 0 and .. paths', () => {
  assert.deepEqual(citationProblems('see a.mjs:0', fakeRef), ['bad citation a.mjs:0']);
  assert.deepEqual(citationProblems('see ../scripts/a.mjs:1', fakeRef), ['bad citation ../scripts/a.mjs:1']);
});

test('pinProblems: reason, unique file, file exists, backed by a whole-file exclusion', () => {
  const ex = [{ file: 'scripts/a.mjs', fn: '*', wholeFile: true }];
  const good = { file: 'scripts/a.mjs', reason: 'x'.repeat(45) };
  assert.deepEqual(pinProblems([good], { readRef: fakeRef, ex }), []);
  assert.deepEqual(pinProblems([{ ...good, reason: 'short' }], { readRef: fakeRef, ex })[0].problems, ['reason < 40 chars']);
  assert.ok(pinProblems([good, good], { readRef: fakeRef, ex })[0].problems.includes('duplicate file'));
  assert.deepEqual(pinProblems([{ ...good, file: 'scripts/zz.mjs' }], { readRef: fakeRef, ex: [{ file: 'scripts/zz.mjs', fn: '*', wholeFile: true }] })[0].problems, ['file not in reference']);
  assert.deepEqual(pinProblems([good], { readRef: fakeRef, ex: [] })[0].problems, ['stale pin: no whole-file exclusion']);
});

test('duplicateFnExclusions: same file+fn+offset', () => {
  const a = { file: 'a.mjs', fn: 'f', offset: 1 };
  assert.deepEqual(duplicateFnExclusions([a, { ...a, offset: 2 }, { ...a }]), ['a.mjs#f@1']);
});

import { branchPointWeight, functionWaivers, isWholeFileFn } from './coverage.mjs';

test('branchPointWeight: lexical branch points, skipping strings, templates and comments', () => {
  const four = 'function g(a, b) { if (a) return 1; const c = b ?? 2; return a && c ? 3 : 4; }';
  assert.equal(branchPointWeight(four, 0, four.length), 4); // if, ??, &&, ?:
  assert.equal(branchPointWeight('(x) => x', 0, 8), 0);
  const opt = '(e) => { log(e?.message ?? e); }';
  assert.equal(branchPointWeight(opt, 0, opt.length), 1); // ?. is not a branch, ?? is
  const noisy = "x => { // if else while\n /* case for */ const s = 'if || &&'; const t = \"? :\"; return `do ${a || b} catch`; }";
  assert.equal(branchPointWeight(noisy, 0, noisy.length), 1); // only the || inside ${}
  const kw = 'for (;;) { while (x) { do {} while (y) } switch (z) { case 1: break; case 2: } try {} catch {} if (q) {} else {} }';
  assert.equal(branchPointWeight(kw, 0, kw.length), 9); // for while do while case case catch if else (switch/try/break are not counted)
  assert.equal(branchPointWeight('notif(ifs, forx, elsewhere)', 0, 27), 0); // whole words only
  assert.equal(branchPointWeight('aaa if (x) {} bbb', 4, 13), 1); // only [start, end)
});

test('functionWaivers: an excluded uncalled 4-branch function costs its weight; nested ranges count once', () => {
  const src = 'const pad = 1;\nfunction g(a, b) { if (a) return 1; const c = b ?? 2; return a && c ? 3 : 4; }\n';
  const start = src.indexOf('function g');
  const fnRanges = new Map([['scripts/a.mjs#g@' + start, ['scripts/a.mjs', start, src.length - 1]], ['scripts/a.mjs#h@' + (start + 19), ['scripts/a.mjs', start + 19, start + 40]]]);
  const uncovered = [...fnRanges.keys()];
  const readSrc = (f) => (f === 'scripts/a.mjs' ? src : null);
  assert.deepEqual(functionWaivers(uncovered, fnRanges, [{ file: 'scripts/a.mjs', fn: 'g' }], readSrc), { 'scripts/a.mjs': 4 });
  // excluding the outer and a nested function does not double count the nested range
  assert.deepEqual(functionWaivers(uncovered, fnRanges, [{ file: 'scripts/a.mjs', fn: 'g' }, { file: 'scripts/a.mjs', fn: 'h' }], readSrc), { 'scripts/a.mjs': 4 });
  // whole-file exclusions take the file out of the branch gate entirely, so they carry no weight here
  assert.deepEqual(functionWaivers(uncovered, fnRanges, [{ file: 'scripts/a.mjs', fn: '*', wholeFile: true }], readSrc), {});
  // and the weight reaches the 15% budget: ≈ 4 waived out of 100 blocks
  const r = branchGate([], [], { 'scripts/a.mjs': 100 }, { waived: functionWaivers(uncovered, fnRanges, [{ file: 'scripts/a.mjs', fn: 'g' }], readSrc) });
  assert.deepEqual(r.overBudget, []);
  assert.equal(functionWaivers(uncovered, fnRanges, [{ file: 'scripts/a.mjs', fn: 'g' }], readSrc)['scripts/a.mjs'], 4);
});

test('functionWaivers: a big excluded function pushes a small file over budget', () => {
  const body = Array.from({ length: 30 }, (_, i) => `if (a${i}) x();`).join(' ');
  const src = `function big(a) { ${body} }`;
  const fnRanges = new Map([['scripts/s.mjs#big@0', ['scripts/s.mjs', 0, src.length]]]);
  const waived = functionWaivers(['scripts/s.mjs#big@0'], fnRanges, [{ file: 'scripts/s.mjs', fn: 'big' }], () => src);
  assert.deepEqual(waived, { 'scripts/s.mjs': 30 });
  const r = branchGate([], [], { 'scripts/s.mjs': 40 }, { waived });
  assert.deepEqual(r.overBudget, [{ file: 'scripts/s.mjs', excluded: 0, waived: 30, total: 40 }]);
});

test('(never loaded) is whole-file scope: needs wholeFile: true and a pin, and backs a pin', () => {
  assert.ok(isWholeFileFn({ fn: '*' }) && isWholeFileFn({ fn: '(never loaded)' }) && !isWholeFileFn({ fn: 'f' }));
  const e = { file: 'scripts/a.mjs', fn: '(never loaded)', kind: 'approved-reachable', reason: 'x'.repeat(50) };
  assert.ok(exclusionProblems(e, { level: 'function', pinned: new Set(['scripts/a.mjs']), readRef: fakeRef }).includes('wholeFile must be true iff fn is "*" or "(never loaded)"'));
  assert.ok(exclusionProblems({ ...e, wholeFile: true }, { level: 'function', pinned: new Set(), readRef: fakeRef }).includes('whole-file scope not pinned'));
  assert.deepEqual(exclusionProblems({ ...e, wholeFile: true }, { level: 'function', pinned: new Set(['scripts/a.mjs']), readRef: fakeRef }), []);
  assert.equal(weakFnExclusions([e]).length, 1); // unpinned '(never loaded)' is weak
  const pin = { file: 'scripts/a.mjs', reason: 'x'.repeat(45) };
  assert.deepEqual(pinProblems([pin], { readRef: fakeRef, ex: [{ ...e, wholeFile: true }] }), []);
  const dead = [{ id: 'scripts/a.mjs:1:1:aa', file: 'scripts/a.mjs', inFns: [] }];
  assert.deepEqual(branchScope(dead, [{ ...e, wholeFile: true }]).skippedFiles, ['scripts/a.mjs']);
});

import { exitProblems } from './coverage.mjs'; // branchPointWeight is already imported above

test('exitProblems: match, mismatch, length difference', () => {
  assert.deepEqual(exitProblems('c', [0, 1], [0, 1]), []);
  assert.deepEqual(exitProblems('c', [0, 2], [0, 1]), ['c: exit 1=2, expected 1']);
  assert.deepEqual(exitProblems('c', [0], [0, 0]), ['c: 1 exit(s), expected 2']);
  assert.deepEqual(exitProblems('c', [null], [0]), ['c: exit 0=null, expected 0']);
});

test('branchPointWeight skips regex literal bodies and still sees division', () => {
  const w = (s) => branchPointWeight(s, 0, s.length);
  assert.equal(w('if (a) x = /`/.test(s) ? 1 : 2;'), 2, 'backtick inside a regex');
  assert.equal(w("const r = /\\/\\*/; if (b) {}"), 1, 'escaped /* inside a regex');
  assert.equal(w('const r = /"/; if (b) {}'), 1, 'quote inside a regex');
  assert.equal(w('return /x|y/.test(s) || z'), 1, '| inside a regex is not ||');
  assert.equal(w('ok = /[/]/.test(p) && q'), 1, '/ inside a class');
  assert.equal(w('const q = a / b / c; if (d) {}'), 1, 'division after identifiers');
  assert.equal(w('const q = (a) / 2 ? 1 : 0'), 1, 'division after )');
  assert.equal(w('x = y\n/re/g.test(z) && w'), 1, 'regex after a newline-terminated identifier is treated as division: one && only');
});
