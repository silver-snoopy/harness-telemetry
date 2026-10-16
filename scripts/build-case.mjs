#!/usr/bin/env node
// Reduce a frozen real Claude session to a sanitised replay case, and pin the
// capture facts of the RAW session so the sanitised case can be proven equivalent.
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, existsSync, rmSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sanitizeValue, sanitizeText } from './sanitize.mjs';
import { refDir } from './vendor-reference.mjs';
import { runCase } from '../replay/runner.mjs';

const CASES = fileURLToPath(new URL('../corpus/cases/', import.meta.url));
const REF = '49577c7';
// Text-derived fields excluded from the raw-vs-sanitised comparison (R4).
export const IGNORED_TOP = new Set(['prompts', 'dispatched', 'title']);
export const stripLine = (l) => {
  const o = Object.fromEntries(Object.entries(l).filter(([k]) => !IGNORED_TOP.has(k)));
  if (Array.isArray(o.subagents)) o.subagents = o.subagents.map(({ label, ...rest }) => rest);
  return o;
};

async function miner() {
  const m = await import(pathToFileURL(join(refDir(REF), 'hooks/telemetry-capture.mjs')).href);
  return m.extractCaseIds;
}

/** Every file under the session (main transcript first, then the whole <sessionId>/ tree), as paths relative to the project dir. */
export function sessionFiles(rawProjectDir, sessionId, exclude = []) {
  const out = [`${sessionId}.jsonl`];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(relative(rawProjectDir, p));
    }
  };
  const sub = join(rawProjectDir, sessionId);
  if (existsSync(sub)) walk(sub);
  return out.filter((rel) => !exclude.some((x) => rel.includes(x)));
}

// Path components that carry no content: ids, fixed directory names, random tool-result names.
const SAFE_COMPONENT = [
  /^[0-9a-f-]{8,}(\.[a-z]+)*$/, /^agent-[A-Za-z0-9]+(\.meta\.json|\.jsonl)$/, /^wf_[0-9a-f-]+(\.json)?$/,
  /^toolu_[A-Za-z0-9]+\.txt$/, /^b[a-z0-9]{8}\.txt$/, /^hook-[0-9a-f-]+-\d+-additionalContext\.txt$/,
  /^(subagents|workflows|scripts|tool-results|journal\.jsonl)$/,
];
/** Any other file/dir name may carry text (a workflow title, a project name): hash it, keep the extension. */
export function safeComponent(c) {
  if (SAFE_COMPONENT.some((re) => re.test(c))) return c;
  return `n${createHash('sha256').update(c).digest('hex').slice(0, 8)}${extname(c)}`;
}
export const safePath = (rel) => rel.split(/[\\/]/).map(safeComponent).join('/');

const isText = (buf) => !buf.includes(0) && !buf.toString('utf8').includes('�');

/** Rewrite every `cwd` string at any depth to {repo}. */
export function rewriteCwd(v) {
  if (Array.isArray(v)) return v.map(rewriteCwd);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'cwd' && typeof x === 'string' ? '{repo}' : rewriteCwd(x)]));
  return v;
}

const jsonlLines = (text) => text.split('\n').filter(Boolean);

/** Returns the sanitised bytes for one file, or null when it is binary. */
export function sanitizeFile(buf, rel, extractCaseIds, repoBranch) {
  if (!isText(buf)) return null;
  const text = buf.toString('utf8');
  // Only ids the miner finds are kept; the branch itself is not (gitBranch is kept verbatim as a field).
  const keepIds = [...new Set(extractCaseIds(text, repoBranch))].sort((a, b) => b.length - a.length);
  if (rel.endsWith('.jsonl')) {
    return `${jsonlLines(text).map((l) => {
      try { return JSON.stringify(rewriteCwd(sanitizeValue(JSON.parse(l), keepIds))); } catch { return sanitizeText(l, keepIds); }
    }).join('\n')}\n`;
  }
  if (rel.endsWith('.json')) {
    try { return `${JSON.stringify(rewriteCwd(sanitizeValue(JSON.parse(text), keepIds)), null, 2)}\n`; } catch { return sanitizeText(text, keepIds); }
  }
  return sanitizeText(text, keepIds);
}

/** The RAW counterpart: identical tree, only `cwd` rewritten (so the sandbox repo path agrees). Binary files skipped as in the case. */
function rawFile(buf, rel) {
  if (!isText(buf)) return null;
  const text = buf.toString('utf8');
  if (rel.endsWith('.jsonl')) {
    return `${jsonlLines(text).map((l) => { try { return JSON.stringify(rewriteCwd(JSON.parse(l))); } catch { return l; } }).join('\n')}\n`;
  }
  if (rel.endsWith('.json')) { try { return `${JSON.stringify(rewriteCwd(JSON.parse(text)), null, 2)}\n`; } catch { return text; } }
  return text;
}

function manifestFor({ caseId, repoBranch, sessionId, at, stores }) {
  return {
    id: caseId, seed: 1, identity: { gitUser: 'corpus', gitEmail: 'corpus@example.invalid' },
    repo: { path: 'repo', branch: repoBranch, files: {} }, stores,
    events: [{ at, run: 'hooks/telemetry-capture.mjs', args: ['--transcript', `{home}/.claude/projects/{repoKey}/${sessionId}.jsonl`, '--session', sessionId], stdin: null, env: {} }],
    outputs: ['.agents/telemetry', '.agents/automation'],
  };
}

function stage(rawProjectDir, files, transform, outRoot) {
  const stores = []; const skipped = []; let bytes = 0;
  for (const rel of files) {
    const src = join(rawProjectDir, rel);
    const out = transform(readFileSync(src), rel);
    if (out === null) { skipped.push(rel); continue; }
    const posix = safePath(rel);
    const dest = join(outRoot, posix);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out);
    bytes += Buffer.byteLength(out);
    stores.push({ from: `inputs/claude/${posix}`, to: `home/.claude/projects/{repoKey}/${posix}`, mtime: new Date(statSync(src).mtimeMs).toISOString(), template: true });
  }
  return { stores, skipped, bytes };
}

export async function buildCase({ rawProjectDir, sessionId, caseId, repoBranch, at, exclude = [] }) {
  const extractCaseIds = await miner();
  const dir = join(CASES, caseId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (!SAFE_COMPONENT[0].test(sessionId)) throw new Error('session id is not id-shaped');
  const files = sessionFiles(rawProjectDir, sessionId, exclude);
  const { stores, skipped, bytes } = stage(rawProjectDir, files, (b, rel) => sanitizeFile(b, rel, extractCaseIds, repoBranch), join(dir, 'inputs/claude'));
  writeFileSync(join(dir, 'replay.json'), `${JSON.stringify(manifestFor({ caseId, repoBranch, sessionId, at, stores }), null, 2)}\n`);
  return { dir, files: stores.length, skipped, bytes };
}

/** Capture the RAW session once with the reference to pin the facts sanitising must preserve. */
export async function recordRawFacts(caseDir, rawProjectDir, sessionId, exclude = []) {
  const tmp = mkdtempSync(join(tmpdir(), 'ht-rawprobe-'));
  try {
    cpManifest(caseDir, tmp);
    stage(rawProjectDir, sessionFiles(rawProjectDir, sessionId, exclude), rawFile, join(tmp, 'inputs/claude'));
    const r = await runCase(tmp, refDir(REF), { pricingMode: 'record' });
    if (r.exits.some((c) => c !== 0)) throw new Error(`raw probe exits ${r.exits}`);
    const key = Object.keys(r.files).find((k) => /usage-.*\.jsonl$/.test(k));
    const facts = r.files[key].trim().split('\n').map((l) => stripLine(JSON.parse(l)));
    writeFileSync(join(caseDir, 'raw-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
    // Pricing recorded against RAW bytes is keyed differently; freeze pricing for the sanitised content separately.
    const s = await runCase(caseDir, refDir(REF), { pricingMode: 'record' });
    if (s.exits.some((c) => c !== 0)) throw new Error(`sanitised record exits ${s.exits}`);
    return facts;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function cpManifest(caseDir, tmp) {
  copyFileSync(join(caseDir, 'replay.json'), join(tmp, 'replay.json'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rawProjectDir, sessionId, caseId, repoBranch, at, ...exclude] = process.argv.slice(2);
  const built = await buildCase({ rawProjectDir, sessionId, caseId, repoBranch, at, exclude });
  const facts = await recordRawFacts(built.dir, rawProjectDir, sessionId, exclude);
  process.stderr.write(`built ${caseId}: ${built.files} files, ${built.bytes} bytes, ${facts[0]?.subagents?.length ?? 0} subagents, skipped binary: ${JSON.stringify(built.skipped)}\n`);
}
