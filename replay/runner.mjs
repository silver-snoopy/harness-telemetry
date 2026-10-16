import { readFileSync, realpathSync, mkdirSync, symlinkSync, lstatSync } from 'node:fs';
import { join, resolve, isAbsolute, posix, basename } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { buildSandbox, expand, makeScrub, symlinkProblems, insideSandbox, removeSandbox, SCRUB_TOKENS } from './sandbox.mjs';
import { snapshotTree, treeChanges, normalizeDiagnostics, scrubCollisionMessage } from './observe.mjs';
import { collect, decodeText, fileMap, sortFiles } from './collect.mjs';

// A file: URL, not a path: NODE_OPTIONS splits on whitespace, and a checkout path may contain spaces.
const PRELOAD = new URL('./preload.mjs', import.meta.url).href;

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;
const isIso = (s) => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s))
  && new Date(Date.parse(s)).toISOString().slice(0, 19) === s.slice(0, 19); // rejects 2026-02-30 rolling over

const REQUIREMENTS = new Set(['non-root']);

/** Top-level names the replay's own observations live under (event streams, sandbox changes). A selected output
 * may not use them: a real file there would share a key with a synthetic observation (Codex B2-02). */
export const RESERVED_ROOTS = ['__events__', '__sandbox__'];
const reservedRoot = (path) => RESERVED_ROOTS.includes(path.split('/')[0]);

/** The manifest's `requires` entries this process cannot satisfy (`uid` = process.getuid?.()). */
export function unmetRequirements(m, { uid } = {}) {
  return (m.requires ?? []).filter((r) => r === 'non-root' && uid === 0);
}

/** Throw a clear error before anything runs if a replay manifest is malformed. */
export function validateManifest(m, where = 'replay.json') {
  const errs = [];
  if (!m || typeof m !== 'object') throw new Error(`${where}: not a JSON object`);
  if (!Array.isArray(m.events) || m.events.length === 0) errs.push('events: must be a non-empty array');
  else m.events.forEach((ev, i) => {
    if (!ev || typeof ev !== 'object') { errs.push(`events[${i}]: not an object`); return; }
    if (!isIso(ev.at)) errs.push(`events[${i}].at: ${JSON.stringify(ev.at)} is not a valid ISO UTC timestamp (YYYY-MM-DDTHH:MM:SS[.mmm]Z)`);
    if (typeof ev.run !== 'string' || !ev.run) errs.push(`events[${i}].run: must be a non-empty string`);
    if (!Array.isArray(ev.args) || ev.args.some((a) => typeof a !== 'string')) errs.push(`events[${i}].args: must be an array of strings`);
    if (ev.via !== undefined && ev.via !== 'symlink') errs.push(`events[${i}].via: ${JSON.stringify(ev.via)} — only "symlink" is supported`);
  });
  if (m.requires !== undefined) {
    if (!Array.isArray(m.requires)) errs.push('requires: must be an array');
    else m.requires.forEach((r, i) => { if (!REQUIREMENTS.has(r)) errs.push(`requires[${i}]: unknown requirement ${JSON.stringify(r)}`); });
  }
  if (m.untracked !== undefined) {
    if (!Array.isArray(m.untracked)) errs.push('untracked: must be an array');
    else m.untracked.forEach((u, i) => {
      if (!u || typeof u !== 'object') { errs.push(`untracked[${i}]: needs {path, reason}`); return; }
      if (typeof u.path !== 'string' || !u.path || isAbsolute(u.path) || !insideSandbox(u.path)) errs.push(`untracked[${i}].path: ${JSON.stringify(u.path)} must be a relative path inside the sandbox`);
      if (typeof u.reason !== 'string' || u.reason.length < 40) errs.push(`untracked[${i}].reason: must be a string of at least 40 characters`);
    });
  }
  if (m.outputs !== undefined) {
    if (!Array.isArray(m.outputs)) errs.push('outputs: must be an array');
    else m.outputs.forEach((o, i) => {
      if (typeof o !== 'string') errs.push(`outputs[${i}]: must be a string`);
      else if (reservedRoot(posix.normalize(o))) errs.push(`outputs[${i}]: ${JSON.stringify(o)} is reserved for the replay's own observations (${RESERVED_ROOTS.join(', ')})`);
    });
  }
  errs.push(...symlinkProblems(m.symlinks));
  if (errs.length) throw new Error(`${where}: invalid replay manifest\n  ${errs.join('\n  ')}`);
  return m;
}

const lstatSafe = (p) => { try { return lstatSync(p); } catch { return null; } };

export async function runCase(caseDirIn, implDirIn, { pricingMode = 'replay', keep = false, extraEnv = {} } = {}) {
  const caseDir = resolve(caseDirIn);
  // realpath: an implementation's `import.meta.url === pathToFileURL(argv[1])` main guard
  // silently skips main() when argv[1] goes through a symlink (e.g. macOS /tmp, /var).
  const implDir = realpathSync(resolve(implDirIn));
  const m = validateManifest(JSON.parse(readFileSync(join(caseDir, 'replay.json'), 'utf8')), join(caseDir, 'replay.json'));
  const unmet = unmetRequirements(m, { uid: process.getuid?.() });
  if (unmet.includes('non-root')) throw new Error(`${caseDir}: requires a non-root user — chmod faults have no effect for root`);
  // Resolve the real npx from the ORIGINAL PATH before the sandbox shadows it.
  const realNpx = pricingMode === 'record' ? execFileSync('which', ['npx'], { encoding: 'utf8' }).trim() : null;
  const sb = buildSandbox(caseDir, m);
  // Output may quote the implementation's own absolute path (e.g. a printed `node <impl>/scripts/x.mjs` hint): tokenise it too, so goldens do not depend on where the checkout lives.
  const scrubSandbox = makeScrub(sb);
  const scrub = (s) => scrubSandbox(s).replaceAll(implDir, '<IMPL>');
  const ctx = { ...sb.ctx, impl: implDir };
  const exits = [];
  // Observation integrity problems (Codex B2-01…03): collected through the run, then refused as one error, so a
  // replay never returns an observation that aliases two different outputs.
  const problems = [];
  const stdouts = Object.create(null); // every non-empty event stream (explicit captureStdout/captureStderr: always written) and __sandbox__/changes.txt
  // Observation boundary: final-state path changes (with content digests) in the sandbox outside the declared outputs, `untracked` paths and .git dirs.
  const outRoots = m.outputs.map((o) => `${m.repo.path}/${o}`.replace(/\/+$/, ''));
  // Normalised as validation resolves them: `repo/./x/` and `repo//x` must match `repo/x`.
  const untracked = (m.untracked ?? []).map((u) => posix.normalize(u.path).replace(/\/+$/, ''));
  const under = (rel, roots) => roots.some((r) => rel === r || rel.startsWith(`${r}/`));
  const skip = (rel) => under(rel, outRoots) || under(rel, untracked) || rel === `${m.repo.path}/.git` || rel.endsWith('/.git');
  // f: digests hash the scrubbed text (a file quoting the sandbox path digests the same wherever the sandbox lives);
  // bytes that are not valid UTF-8 are hashed raw, not lossily decoded.
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); // ignoreBOM: keep a leading BOM in the text, so it is hashed
  // B3 park 238: raw text holding a scrub token reads like a scrubbed sandbox path, so a stream or a hashed file
  // that contains one is a replay problem (one message per subject: the tree is snapshotted twice).
  const tokenProblems = (text, subject) => {
    for (const t of SCRUB_TOKENS) {
      if (!text.includes(t)) continue;
      const msg = `${subject}: content contains scrub token ${t}: it would read as a scrubbed sandbox path`;
      if (!problems.includes(msg)) problems.push(msg);
    }
  };
  const normalise = (b, rel) => { let t; try { t = utf8.decode(b); } catch { return b; } tokenProblems(t, JSON.stringify(rel)); return Buffer.from(scrub(t), 'utf8'); };
  // scrub: each path and link target is scrubbed as a field before treeChanges serialises it (Codex P3P-02).
  // A raw path or link target that already contains a scrub token reads like a scrubbed sandbox path: refused,
  // as is any pair of raw paths that scrub to one key (Codex B2-01).
  const scrubPath = (raw) => {
    for (const t of SCRUB_TOKENS) if (raw.includes(t)) problems.push(`sandbox path or link target ${JSON.stringify(raw)} contains the scrub token ${t}: it would read as a scrubbed sandbox path`);
    return scrub(raw);
  };
  const onCollision = (key, a, b) => problems.push(scrubCollisionMessage(key, a, b));
  const snap = () => snapshotTree(sb.root, { skip, normalise, scrub: scrubPath, gitHome: sb.home, onCollision });
  try {
    const before = snap();
    m.events.forEach((ev, i) => {
      const env = {
        ...sb.env, ...ev.env, ...extraEnv, // extraEnv: tooling-only variables (e.g. HT_EXT_TRACE_FILE)
        ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}),
        NODE_OPTIONS: `--import=${PRELOAD}`,
        HT_NOW: ev.at, HT_SEED: String((m.seed ?? 1) * 1000 + i),
        HT_PRICING_MODE: pricingMode,
        // B2 item 11 (owner Q14): the writer stamp's version is pinned, so a release bump never churns the goldens.
        TOKENOMICS_ENGINE_VERSION_PIN: '0.0.0-replay',
      };
      if (realNpx) env.HT_REAL_NPX = realNpx;
      for (const [k, v] of Object.entries(env)) if (v === null) delete env[k]; // `"env": {"X": null}` unsets X (default-fallback branches)
      const args = ev.args.map((a) => expand(a, ctx));
      // via "symlink": run the script through <root>/links/<basename>, as an install with symlinked hooks does (map §3 R8).
      let script = join(implDir, ev.run);
      if (ev.via === 'symlink') {
        const link = join(sb.root, 'links', basename(ev.run));
        mkdirSync(join(sb.root, 'links'), { recursive: true });
        if (!lstatSafe(link)) symlinkSync(script, link);
        script = link;
      }
      const r = spawnSync(process.execPath, [script, ...args], {
        cwd: sb.repo, env, input: ev.stdin ? expand(JSON.stringify(ev.stdin), ctx) : '', timeout: 120000,
      });
      exits.push(r.status);
      // Streams are read as bytes and decoded strictly (Codex B2-03): a stream that is not valid UTF-8 is a problem.
      const text = (buf, name) => { try { return buf ? decodeText(buf, `__events__/${i}.${name}`) : ''; } catch (err) { problems.push(err.message); return ''; } };
      const stdout = text(r.stdout, 'stdout');
      const stderr = text(r.stderr, 'stderr');
      tokenProblems(stdout, `__events__/${i}.stdout`); tokenProblems(stderr, `__events__/${i}.stderr`);
      const so = scrub(normalizeDiagnostics(stdout, { stream: 'stdout' }));
      const se = scrub(normalizeDiagnostics(stderr, { stream: 'stderr' }));
      // An explicit captureStdout keeps raw stdout (existing goldens stay byte-identical).
      if (ev.captureStdout || so) stdouts[`__events__/${i}.stdout`] = ev.captureStdout ? scrub(stdout) : so;
      if (ev.captureStderr || se) stdouts[`__events__/${i}.stderr`] = se;
      if (r.status !== 0 && process.env.HT_DEBUG) process.stderr.write(`event ${i}: ${stderr}\n`);
    });
    const changes = treeChanges(before, snap());
    if (changes.length) stdouts['__sandbox__/changes.txt'] = `${changes.join('\n')}\n`; // fields already scrubbed in snap()
    // Null-prototype file maps throughout (Codex P3P-01): a `__proto__` output is an ordinary own key.
    const outputs = collect(sb.repo, m.outputs, scrub, { problems });
    // Disjoint namespaces (Codex B2-02): a real file under a reserved root (reachable through an output such as
    // `.`) would share a key with a synthetic observation; refused, never merged or overwritten.
    for (const k of Object.keys(outputs)) if (reservedRoot(k)) problems.push(`${k} is a real file in the replay's reserved namespace (${RESERVED_ROOTS.map((r) => `${r}/`).join(', ')})`);
    if (problems.length) throw new Error(`replay observation refused (${caseDir}):\n  ${problems.join('\n  ')}`);
    const files = sortFiles(fileMap([...Object.entries(outputs), ...Object.entries(stdouts)]));
    return { files, exits };
  } finally {
    if (!keep) removeSandbox(sb.root);
  }
}
