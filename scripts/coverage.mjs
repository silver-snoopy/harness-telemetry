#!/usr/bin/env node
// Coverage gate (spec 18.3): replay every corpus case against the reference with
// V8 coverage on the child processes; fail if an uncovered function/branch range
// is not listed in corpus/coverage/exclusions.json.
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCase } from '../replay/runner.mjs';
import { refDir } from './vendor-reference.mjs';
import { expectedExits } from '../replay/exits.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REF = refDir('49577c7');

export async function measure() {
  const out = mkdtempSync(join(tmpdir(), 'ht-cov-'));
  process.env.NODE_V8_COVERAGE = out;
  const cases = join(ROOT, 'corpus/cases');
  const replayProblems = [];
  try {
    for (const c of readdirSync(cases)) {
      if (!existsSync(join(cases, c, 'replay.json'))) continue;
      if (JSON.parse(readFileSync(join(cases, c, 'replay.json'), 'utf8')).implOnly === 'engine') continue; // engine-only: coverage measures the reference
      const m = JSON.parse(readFileSync(join(cases, c, 'replay.json'), 'utf8'));
      const r = await runCase(join(cases, c), REF);
      replayProblems.push(...exitProblems(c, r.exits, expectedExits(join(cases, c), m)));
    }
  } finally {
    delete process.env.NODE_V8_COVERAGE;
  }
  const base = pathToFileURL(REF).href;
  const hits = new Map(); // function ranges: `${file}#${fn}@${offset}` -> max count over all processes
  const paint = new Map(); // file -> Int32Array of max-over-processes execution count per source char
  const blockRanges = new Map(); // file -> [{start,end}] every branch-block range seen
  const fnEnds = new Map(); // function key -> [file, start, end]
  const seenFiles = new Set();
  for (const f of readdirSync(out)) {
    const doc = JSON.parse(readFileSync(join(out, f), 'utf8'));
    for (const s of doc.result) {
      if (!s.url.startsWith(base)) continue;
      const file = s.url.slice(base.length + 1);
      seenFiles.add(file);
      const size = readFileSync(join(REF, file), 'utf8').length;
      if (!paint.has(file)) { paint.set(file, new Int32Array(size)); blockRanges.set(file, new Map()); }
      // V8 ranges nest (inner overrides outer): paint outer-to-inner into this process's own array, then max-merge.
      const mine = new Int32Array(size).fill(-1);
      const all = s.functions.flatMap((fn) => fn.ranges.map((r, i) => ({ fn, r, i })));
      all.sort((a, b) => a.r.startOffset - b.r.startOffset || b.r.endOffset - a.r.endOffset);
      for (const { fn, r, i } of all) {
        if (i === 0) { const k = `${file}#${fn.functionName || '(anonymous)'}@${r.startOffset}`; hits.set(k, Math.max(hits.get(k) ?? 0, r.count)); fnEnds.set(k, [file, r.startOffset, r.endOffset]); }
        else blockRanges.get(file).set(`${r.startOffset}-${r.endOffset}`, [r.startOffset, r.endOffset]);
        mine.fill(r.count, r.startOffset, Math.min(r.endOffset, size));
      }
      const merged = paint.get(file);
      for (let c = 0; c < size; c++) if (mine[c] > merged[c]) merged[c] = mine[c];
    }
  }
  rmSync(out, { recursive: true, force: true });
  // A branch block counts as uncovered only if NO process executed any character of it.
  const blocks = {};
  const deadRanges = [];
  for (const [file, ranges] of blockRanges) {
    const merged = paint.get(file);
    const dead = [...ranges.values()].filter(([a, b]) => { for (let c = a; c < b; c++) if (merged[c] > 0) return false; return true; });
    blocks[file] = { total: ranges.size, uncovered: dead.length };
    const src = readFileSync(join(REF, file), 'utf8');
    for (const [a] of dead) deadRanges.push({ ...blockId(file, src, a), start: a });
  }
  // Reference modules no replayed process ever loaded: every function in them is uncovered.
  for (const dir of ['hooks', 'scripts']) {
    for (const f of readdirSync(join(REF, dir))) {
      if (!f.endsWith('.mjs') || f.endsWith('.test.mjs') || seenFiles.has(`${dir}/${f}`)) continue;
      hits.set(`${dir}/${f}#(never loaded)@0`, 0);
      blocks[`${dir}/${f}`] = { total: 0, uncovered: 0 };
      seenFiles.add(`${dir}/${f}`);
    }
  }
  const uncovered = [...hits].filter(([, n]) => n === 0).map(([k]) => k).sort();
  // Each dead block records the uncovered functions whose range contains it (for function-exclusion coverage).
  const deadBlocks = deadRanges.map(({ start, ...b }) => ({ ...b, inFns: fnsContaining(uncovered, fnEnds, b.file, start) }));
  const blockTotals = Object.fromEntries(Object.entries(blocks).map(([f, v]) => [f, v.total]));
  return { uncovered, total: hits.size, blocks, files: [...seenFiles].sort(), deadBlocks, blockTotals, fnRanges: fnEnds, replayProblems };
}

/** Coverage over a replay that did not finish as designed is not evidence (Codex P2 §5): compare exits. */
export function exitProblems(caseName, exits, want) {
  const out = [];
  if (exits.length !== want.length) out.push(`${caseName}: ${exits.length} exit(s), expected ${want.length}`);
  exits.forEach((code, i) => { if (i < want.length && code !== want[i]) out.push(`${caseName}: exit ${i}=${code}, expected ${want[i]}`); });
  return out;
}

/** The uncovered function keys whose range (`fnEnds`: key -> [file, start, end)) contains offset `start` of `file`. */
export const fnsContaining = (uncovered, fnEnds, file, start) =>
  uncovered.filter((k) => { const r = fnEnds.get(k); return !!r && r[0] === file && start >= r[1] && start < r[2]; });

/** Whole-file function scope: `*`, or the `(never loaded)` key measure() emits for a module no process loaded. */
export const isWholeFileFn = (e) => e.fn === '*' || e.fn === '(never loaded)';

/** Does exclusion `e` cover the uncovered-function key `k` (`<file>#<fn>@<offset>`)? */
export const excludes = (e, k) => (e.fn === '*' ? k.startsWith(`${e.file}#`) : k.startsWith(`${e.file}#${e.fn}@`) && (e.offset == null || k.endsWith(`@${e.offset}`)));

/** Gate verdict: uncovered keys no exclusion lists, and exclusions that list no uncovered key (stale). */
export function gate(uncovered, ex) {
  const open = uncovered.filter((k) => !ex.some((e) => excludes(e, k)));
  const stale = ex.filter((e) => !uncovered.some((k) => excludes(e, k)));
  return { open, stale };
}

export function blockId(file, src, start) {
  const before = src.slice(0, start);
  const line = before.split('\n').length;
  const col = start - before.lastIndexOf('\n');
  const snippet = src.slice(start, (src.indexOf('\n', start) + 1 || src.length + 1) - 1).trim().slice(0, 60);
  return { id: `${file}:${line}:${col}:${createHash('sha1').update(snippet).digest('hex').slice(0, 8)}`, file, line, col, snippet };
}

export const KINDS = ['approved-reachable', 'unreachable', 'failure-only'];

/** Every `<path>.mjs:<line>` in `reason` must name a reference file (as given, hooks/<base>, scripts/<base>) with at least that many lines. */
export function citationProblems(reason, readRef) {
  const out = [];
  for (const [cite, path, line] of String(reason ?? '').matchAll(/([\w./-]+\.mjs):(\d+)/g)) {
    const base = path.split('/').pop();
    if (Number(line) < 1 || path.split('/').includes('..')) { out.push(`bad citation ${cite}`); continue; }
    const src = [path, `hooks/${base}`, `scripts/${base}`].map((f) => readRef(f)).find((t) => t != null);
    if (src == null || Number(line) > src.replace(/\n$/, '').split('\n').length) out.push(`bad citation ${cite}`);
  }
  return out;
}

/** Rule violations of one exclusion entry (`level` selects the function- or branch-level shape). Empty = valid. */
export function exclusionProblems(e, { level, pinned = new Set(), readRef = null }) {
  const reason = String(e.reason ?? '');
  const out = [];
  if (!KINDS.includes(e.kind)) out.push(`unknown kind ${e.kind}`);
  if (reason.length < 40) out.push('reason < 40 chars');
  if (e.kind === 'unreachable' && !/[\w./-]+\.mjs:\d+/.test(reason)) out.push('no file:line citation');
  if (readRef) out.push(...citationProblems(reason, readRef));
  if (level === 'function') {
    if (!e.file) out.push('file required');
    if (!e.fn) out.push('fn required');
    if (isWholeFileFn(e) !== (e.wholeFile === true)) out.push('wholeFile must be true iff fn is "*" or "(never loaded)"');
    if (isWholeFileFn(e) && !pinned.has(e.file)) out.push('whole-file scope not pinned');
  } else if (!e.id) out.push('id required');
  return out;
}

export function branchGate(deadBlocks, exclusions, totals, { waived = {}, readRef = null } = {}) {
  const ids = new Set(deadBlocks.map((b) => b.id));
  const exIds = new Set(exclusions.map((e) => e.id));
  const open = deadBlocks.map((b) => b.id).filter((id) => !exIds.has(id)).sort();
  const stale = exclusions.filter((e) => !ids.has(e.id));
  const weak = exclusions.filter((e) => ids.has(e.id) && exclusionProblems(e, { level: 'branch', readRef }).length);
  const seen = new Set();
  const duplicate = [...new Set(exclusions.map((e) => e.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false))))];
  const perFile = {};
  for (const e of exclusions) if (ids.has(e.id)) { const f = e.id.split(':')[0]; perFile[f] = (perFile[f] ?? 0) + 1; }
  const overBudget = [...new Set([...Object.keys(perFile), ...Object.keys(waived)])]
    .map((file) => ({ file, excluded: perFile[file] ?? 0, waived: waived[file] ?? 0, total: totals[file] }))
    .filter((o) => (o.excluded + o.waived) / (o.total || 1) > 0.15);
  return { open, stale, weak, duplicate, overBudget };
}

const BRANCH_WORDS = new Set(['if', 'else', 'case', 'catch', 'for', 'while', 'do']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/**
 * Lexical branch-point count of `src[start, end)`: the keywords if/else/case/catch/for/while/do (whole
 * words), and the operators `??`, `||`, `&&` (also their `=` forms) and a ternary `?` (not `?.`, not `??`).
 * Strings, comments and template text are skipped; `${...}` expressions inside templates are scanned.
 * Approximation (one small scanner, not a parser): `else if` counts twice, a `do ... while` loop counts
 * twice, and switch/default/try/finally count nothing.
 * Regex literal bodies are skipped. After a value token (identifier, number, `)`, `]`, string, template) a `/` is division.
 */
export function branchPointWeight(src, start, end) {
  let n = 0;
  const braces = []; // per open `{`: true when it is a template `${` (its `}` resumes template text)
  const isId = (c) => /[\w$]/.test(c);
  let i = start;
  let prev = ''; // last significant token: a word, or a punctuator character; ')' also stands for any value token
  const regexAllowed = () => (prev === '' ? true : /^[\w$]+$/.test(prev) ? REGEX_AFTER_WORD.has(prev) : !(prev === ')' || prev === ']'));
  const template = () => { // i is just past a backtick or a closing `${...}`; skip text up to the next `${` or closing backtick
    while (i < end) {
      if (src[i] === '\\') i += 2;
      else if (src[i] === '`') { i++; return; }
      else if (src[i] === '$' && src[i + 1] === '{') { braces.push(true); i += 2; return; }
      else i++;
    }
  };
  const regex = () => { // i at the opening '/'
    i++;
    let cls = false;
    while (i < end && src[i] !== '\n') {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (cls) { if (ch === ']') cls = false; } else if (ch === '[') cls = true; else if (ch === '/') { i++; break; }
      i++;
    }
    while (i < end && /[A-Za-z]/.test(src[i])) i++;
  };
  while (i < end) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < end && src[i] !== '\n') i++; }
    else if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 || j + 2 > end ? end : j + 2; }
    else if (c === '/' && regexAllowed()) { regex(); prev = ')'; }
    else if (c === "'" || c === '"') { i++; while (i < end && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1; i++; prev = ')'; }
    else if (c === '`') { i++; template(); prev = ')'; }
    else if (c === '{') { braces.push(false); i++; prev = '{'; }
    else if (c === '}') { i++; if (braces.pop()) { template(); prev = ')'; } else prev = '}'; }
    else if ((c === '?' && d === '?') || (c === '|' && d === '|') || (c === '&' && d === '&')) { n++; i += 2; prev = c; }
    else if (c === '?') { if (d !== '.' || /\d/.test(src[i + 2] ?? '')) n++; i++; prev = '?'; }
    else if (isId(c) && !isId(src[i - 1] ?? '')) {
      let j = i;
      while (j < end && isId(src[j])) j++;
      const word = src.slice(i, j);
      if (BRANCH_WORDS.has(word) && !isId(src[j] ?? '')) n++;
      prev = word;
      i = j;
    } else { if (!/\s/.test(c)) prev = c; i++; }
  }
  return n;
}

/**
 * Budget weight of function exclusions (Final ruling): V8 reports no inner block ranges for a function
 * that never ran, so each uncovered function a non-whole-file exclusion covers is charged its
 * branchPointWeight. Ranges are unioned per file first, so a nested excluded function counts once.
 * Whole-file scope (`*` / `(never loaded)`) is out of the branch gate entirely and carries no weight.
 * Returns { file: weight } for files with a non-zero weight.
 */
export function functionWaivers(uncovered, fnRanges, fnExclusions, readSrc) {
  const fnEx = fnExclusions.filter((e) => !isWholeFileFn(e));
  const byFile = new Map();
  for (const k of uncovered) {
    const r = fnRanges.get(k);
    if (!r || !fnEx.some((e) => excludes(e, k))) continue;
    if (!byFile.has(r[0])) byFile.set(r[0], []);
    byFile.get(r[0]).push([r[1], r[2]]);
  }
  const out = {};
  for (const [file, ranges] of byFile) {
    const src = readSrc(file);
    if (src == null) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    let w = 0;
    let [a, b] = ranges[0];
    for (const [x, y] of ranges.slice(1)) { if (x < b) b = Math.max(b, y); else { w += branchPointWeight(src, a, b); [a, b] = [x, y]; } }
    w += branchPointWeight(src, a, b);
    if (w) out[file] = w;
  }
  return out;
}

/**
 * Function exclusions get the branch reason rules plus the function-level shape rules (see exclusionProblems);
 * a whole-file `fn: "*"` must say `"wholeFile": true` and be pinned in whole-file-scope.json. Weak entries
 * fail the gate — a function-level exclusion cannot be a cheaper way around the branch gate.
 */
export function weakFnExclusions(ex, { pinned = new Set(), readRef = null } = {}) {
  return ex.filter((e) => exclusionProblems(e, { level: 'function', pinned, readRef }).length);
}

/** Same file+fn+offset listed more than once in the function exclusions. */
export function duplicateFnExclusions(ex) {
  const seen = new Set();
  const dup = new Set();
  for (const e of ex) { const k = `${e.file}#${e.fn}@${e.offset ?? ''}`; if (seen.has(k)) dup.add(k); seen.add(k); }
  return [...dup];
}

/** Rule violations of whole-file-scope.json pins: reason >= 40, unique, file exists in the reference, backed by a `*`/wholeFile exclusion. */
export function pinProblems(pins, { readRef, ex }) {
  const files = pins.map((p) => p.file);
  return pins.map((p) => {
    const problems = [];
    if (String(p.reason ?? '').length < 40) problems.push('reason < 40 chars');
    if (files.indexOf(p.file) !== files.lastIndexOf(p.file)) problems.push('duplicate file');
    if (!p.file || readRef(p.file) == null) problems.push('file not in reference');
    if (!ex.some((e) => e.file === p.file && isWholeFileFn(e) && e.wholeFile === true)) problems.push('stale pin: no whole-file exclusion');
    return { file: p.file, problems };
  }).filter((r) => r.problems.length);
}

/**
 * Ruling P1: split dead blocks into those the branch gate judges and those already covered by a
 * function-level exclusion. Files with a whole-file exclusion are out of scope entirely; a dead block
 * inside an excluded uncovered function is `byFunction` (reported, not open, not in the budget).
 */
export function branchScope(deadBlocks, fnExclusions) {
  const wholeFile = new Set(fnExclusions.filter((e) => isWholeFileFn(e) && e.wholeFile === true).map((e) => e.file));
  const inScope = deadBlocks.filter((b) => !wholeFile.has(b.file));
  const byFunction = inScope.filter((b) => (b.inFns ?? []).some((k) => fnExclusions.some((e) => excludes(e, k))));
  const skip = new Set(byFunction);
  return { scoped: inScope.filter((b) => !skip.has(b)), byFunction, skippedFiles: [...wholeFile].sort() };
}

const exLabel = (e) => `${e.file}${isWholeFileFn(e) ? ' (whole file)' : `#${e.fn}${e.offset != null ? `@${e.offset}` : ''}`}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { uncovered, total, files, blocks, deadBlocks, blockTotals, fnRanges, replayProblems } = await measure();
  const readRef = (f) => (existsSync(join(REF, f)) ? readFileSync(join(REF, f), 'utf8') : null);
  const pins = JSON.parse(readFileSync(join(ROOT, 'corpus/coverage/whole-file-scope.json'), 'utf8'));
  const pinned = new Set(pins.map((p) => p.file));
  const ex = JSON.parse(readFileSync(join(ROOT, 'corpus/coverage/exclusions.json'), 'utf8'));
  const listed = (k) => ex.some((e) => excludes(e, k));
  const { open, stale } = gate(uncovered, ex);
  const perFile = files.map((f) => {
    const u = uncovered.filter((k) => k.startsWith(`${f}#`));
    return `- ${f}: ${u.length} functions uncovered (${u.filter((k) => !listed(k)).length} open); branch blocks never executed: ${blocks[f].uncovered}/${blocks[f].total}`;
  });
  const bex = JSON.parse(readFileSync(join(ROOT, 'corpus/coverage/branch-exclusions.json'), 'utf8'));
  const { scoped, byFunction, skippedFiles } = branchScope(deadBlocks, ex);
  // Waived = per file, the larger of the dead blocks V8 attributed to excluded functions and their lexical branch weight.
  const fnWeight = functionWaivers(uncovered, fnRanges, ex, readRef);
  const waived = { ...fnWeight };
  const byFnCount = {};
  for (const b of byFunction) byFnCount[b.file] = (byFnCount[b.file] ?? 0) + 1;
  for (const [f, n] of Object.entries(byFnCount)) waived[f] = Math.max(waived[f] ?? 0, n);
  const bg = branchGate(scoped, bex, blockTotals, { waived, readRef });
  const weakFn = weakFnExclusions(ex, { pinned, readRef });
  const dupFn = duplicateFnExclusions(ex);
  const badPins = pinProblems(pins, { readRef, ex });
  const bFiles = files.filter((f) => !skippedFiles.includes(f));
  const branchSection = `## Branch blocks\n\nScope: files without a whole-file function exclusion (skipped: ${skippedFiles.join(', ') || 'none'}). Dead blocks inside a function-level-excluded function (${byFunction.length}) count as covered by that exclusion. Each uncalled function a function exclusion covers is charged its lexical branch-point weight (branchPointWeight); per file the larger of that weight and the covered dead blocks is waived and counts against the 15% budget.\n\n${bFiles.map((f) => {
    const mine = (l) => l.filter((b) => b.file === f);
    const open = bg.open.filter((id) => id.startsWith(`${f}:`));
    const nEx = mine(scoped).filter((b) => bex.some((e) => e.id === b.id)).length;
    return `### ${f}\n\ntotal ${blockTotals[f]}, dead ${mine(deadBlocks).length}, covered by function exclusion ${mine(byFunction).length}, function-exclusion weight ${fnWeight[f] ?? 0}, waived in budget ${waived[f] ?? 0}, excluded ${nEx}, open ${open.length}\n\n${open.map((id) => `- ${id}`).join('\n')}\n`;
  }).join('\n')}\n### Stale / weak / over-budget branch exclusions\n\n${[...bg.stale.map((e) => `- stale ${e.id}`), ...bg.weak.map((e) => `- weak ${e.id}`), ...bg.duplicate.map((id) => `- duplicate ${id}`), ...bg.overBudget.map((o) => `- over budget ${o.file}: ${o.excluded} excluded + ${o.waived} waived / ${o.total}`)].join('\n')}\n`;
  writeFileSync(join(ROOT, 'corpus/coverage/report.md'), `# Reference coverage (49577c7)\n\nGate granularity: function ranges (V8 functions[].ranges[0], max count over all replayed child processes).\nFunctions measured: ${total}; uncovered: ${uncovered.length}; not excluded: ${open.length}\nBranch-block ranges are reported per file below as information only (a block is uncovered when no process executed any of its characters); the gate itself is function-level.\n\n## Per file\n\n${perFile.join('\n')}\n\n## Exclusions (corpus/coverage/exclusions.json)\n\n${ex.map((e) => `- ${exLabel(e)} — ${e.kind}: ${e.reason}`).join('\n')}\n\n## Open (not excluded)\n\n${open.map((k) => `- ${k}`).join('\n')}\n\n## Stale exclusions (match no uncovered function)\n\n${stale.map((e) => `- ${exLabel(e)}`).join('\n')}\n\n## Weak function exclusions (unknown kind, reason < 40 chars, unreachable without a file:line, unresolvable citation, wholeFile mismatch, unpinned whole-file scope)\n\n${weakFn.map((e) => `- ${exLabel(e)}`).join('\n')}\n\n## Duplicate function exclusions\n\n${dupFn.map((k) => `- ${k}`).join('\n')}\n\n## Whole-file pins (corpus/coverage/whole-file-scope.json): ${pins.length}, invalid ${badPins.length}\n\n${badPins.map((b) => `- ${b.file}: ${b.problems.join('; ')}`).join('\n')}\n\n${branchSection}`);
  process.stderr.write(`uncovered ${uncovered.length}, open ${open.length}, stale exclusions ${stale.length}, weak function exclusions ${weakFn.length}\n`);
  process.stderr.write(`whole-file pins ${pins.length}, invalid ${badPins.length}, duplicate function exclusions ${dupFn.length}\n`);
  for (const e of stale) process.stderr.write(`stale exclusion: ${exLabel(e)}\n`);
  for (const e of weakFn) process.stderr.write(`weak function exclusion: ${exLabel(e)}\n`);
  process.stderr.write(`branch open ${bg.open.length}, stale ${bg.stale.length}, weak ${bg.weak.length}, duplicate ${bg.duplicate.length}, over-budget ${bg.overBudget.length}\n`);
  process.stderr.write(`replay problems ${replayProblems.length}\n`);
  for (const p of replayProblems) process.stderr.write(`replay problem: ${p}\n`);
  process.exitCode = replayProblems.length || open.length || stale.length || weakFn.length || dupFn.length || badPins.length || bg.open.length || bg.stale.length || bg.weak.length || bg.duplicate.length || bg.overBudget.length ? 1 : 0;
}
