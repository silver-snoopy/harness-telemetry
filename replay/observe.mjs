// Replay observation boundary (Codex P2-12): what changed anywhere in the sandbox, and stable diagnostics.
import { readdirSync, readFileSync, lstatSync, readlinkSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const isGitDir = (p) => { try { return statSync(join(p, 'HEAD')).isFile() && statSync(join(p, 'objects')).isDirectory(); } catch { return false; } };
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Environment for read-only git plumbing: no inherited GIT_* (GIT_DIR, GIT_WORK_TREE, …), no system/global/XDG config. */
const gitEnv = (home) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'XDG_CONFIG_HOME'));
  return { ...env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
};

/**
 * One `ls-tree -z` record (`<mode> <type> <id>\t<path>`) with its path made safe for the line-oriented summary
 * (Codex B3-01, R20): a path holding a control character (any byte below 0x20) or a backslash is written as a JSON
 * string literal, so it can never span lines or forge a second record. Any other path is left exactly as it is.
 */
const escapeTreePath = (rec) => {
  const i = rec.indexOf('\t');
  const path = rec.slice(i + 1);
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x1f\\]/.test(path) ? `${rec.slice(0, i + 1)}${JSON.stringify(path)}` : rec;
};

/**
 * A git directory's normalised summary (Codex P3-03), from read-only plumbing (`git --git-dir=<p>`), sorted lines:
 * `HEAD <symbolic-ref target | detached>`; per ref from `for-each-ref` (loose and packed): `ref <name> <rev-list --count>`
 * and one `tree <name> <mode> <type> <blob id>\t<path>` line per `ls-tree -r -z` entry (NUL-separated, so a path is exact, never C-quoted; a path with a control character or backslash is then written as a JSON string literal, Codex B3-01) of its tip. The repository's own
 * commit ids and dates are not included, so the summary is the same whenever branch names, commit counts and tip
 * trees agree. Limits (Codex P3P-04): blob ids are raw committed content (never scrubbed); a detached HEAD
 * contributes only `detached`; a gitlink (submodule) entry carries its commit id; git must be on PATH.
 * A ref whose count or tree git cannot read contributes `ref <name> unavailable` and the rest stands.
 * Blob ids are git's own object-format hashes (SHA-1 in the corpus's repos; a SHA-256 repository would digest differently).
 * Not observed: commit messages, authors, dates and ids, the index, reflogs, hooks, config. `null` when the summary
 * as a whole cannot be taken (HEAD or the ref listing fails).
 */
export function gitDirSummary(p, { home = tmpdir() } = {}) {
  const env = gitEnv(home);
  const git = (...args) => execFileSync('git', [`--git-dir=${p}`, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  try {
    let head;
    try { head = git('symbolic-ref', '-q', 'HEAD').trim(); } catch (e) { if (e.status === 1) head = 'detached'; else throw e; }
    const lines = [`HEAD ${head}`];
    for (const ref of git('for-each-ref', '--format=%(refname)').split('\n').filter(Boolean)) {
      // Degrade per ref: a ref git cannot count or list (e.g. a tag of a blob) contributes one `unavailable` line.
      try {
        const count = git('rev-list', '--count', ref).trim();
        const trees = git('ls-tree', '-r', '-z', ref).split('\0').filter(Boolean).map(escapeTreePath);
        lines.push(`ref ${ref} ${count}`, ...trees.map((t) => `tree ${ref} ${t}`));
      } catch { lines.push(`ref ${ref} unavailable`); }
    }
    return lines.sort(byName).join('\n');
  } catch { return null; }
}


/** The scrub collision message (Codex B2-01): two raw paths, one recorded key. */
export const scrubCollisionMessage = (key, a, b) => `scrub collision: sandbox paths ${JSON.stringify(a)} and ${JSON.stringify(b)} both record as ${JSON.stringify(key)}`;
const scrubCollision = (key, a, b) => { throw new Error(scrubCollisionMessage(key, a, b)); };

/**
 * Map of every entry under `root` (relative `/` paths) to a content fingerprint:
 * `f:<sha>` file, `l:<target>` symlink, `u` unreadable, `g:<sha>` a git directory collapsed to one entry
 * (the sha of `gitDirSummary`). A directory that looks like a git dir (HEAD + objects/) but whose summary git
 * cannot take is not collapsed: it is walked as ordinary files, so its contents stay visible.
 * `skip(rel)` hides an entry and its whole subtree (it sees the raw path). `normalise(buf, rel)` (optional) maps a file's
 * bytes before hashing, e.g. the runner's sandbox scrub, so a digest does not depend on where the sandbox lives.
 * `scrub(str)` (optional) maps each recorded path and symlink target, field by field, before `treeChanges` serialises
 * them (Codex P3P-02): JSON escaping never hides a sandbox path from the scrub. `gitHome` is the HOME for git.
 * Two distinct raw paths that scrub to one key are a collision (Codex B2-01): `onCollision(key, firstRaw, raw)` is
 * called and the first entry kept; the default throws `scrub collision: …`. Never a silent overwrite.
 */
export function snapshotTree(root, { skip, normalise, scrub = (x) => x, gitHome, onCollision = scrubCollision } = {}) {
  const out = new Map();
  const rawOf = new Map(); // scrubbed key -> the raw path that recorded it
  const set = (rel, v) => {
    const key = scrub(rel);
    if (rawOf.has(key)) { onCollision(key, rawOf.get(key), rel); return; }
    rawOf.set(key, rel);
    out.set(key, v);
  };
  const walk = (abs, rel) => {
    let ents;
    try { ents = readdirSync(abs, { withFileTypes: true }); } catch { if (rel) set(`${rel}/`, 'u'); return; }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      const p = join(abs, e.name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) set(r, `l:${scrub(readlinkSync(p))}`);
      else if (st.isDirectory()) {
        const summary = isGitDir(p) ? gitDirSummary(p, { home: gitHome }) : null;
        if (summary !== null) set(`${r}/`, `g:${sha(summary)}`);
        else walk(p, r);
      } else if (st.isFile()) { try { const b = readFileSync(p); set(r, `f:${sha(normalise ? normalise(b, r) : b)}`); } catch { set(r, 'u'); } }
    }
  };
  if (existsSync(root)) walk(root, '');
  return out;
}

/**
 * Final-state path changes between two snapshots, sorted by path, with content digests (Codex P3-03). Each record
 * is one JSON array (Codex P3P-02): `["A",<path>,<digest>]`, `["M",<path>,<old>,<new>]`, `["D",<path>,<old>]`.
 * A digest is the snapshot value. `JSON.stringify` escapes newlines, quotes and other control characters in a path
 * or link target, so a record never spans lines and one entry can never read as two. Scrub the fields before
 * this (`snapshotTree`'s `scrub`), not the serialised text.
 * Not observed: transient writes undone within the run, modes, mtimes, empty directories, and in a git dir anything
 * beyond `gitDirSummary` (commit ids, dates, messages, index, reflogs).
 */
export function treeChanges(before, after) {
  const lines = [];
  for (const [k, v] of after) {
    if (!before.has(k)) lines.push([k, ['A', k, v]]);
    else if (before.get(k) !== v) lines.push([k, ['M', k, before.get(k), v]]);
  }
  for (const [k, v] of before) if (!after.has(k)) lines.push([k, ['D', k, v]]);
  return lines.sort((a, b) => byName(a[0], b[0])).map(([, rec]) => JSON.stringify(rec));
}

const CARET = /^\s*\^+\s*$/;
const LOCATION = /^(file:\/\/|\/|<IMPL>|[A-Za-z]:\\).*:\d+$/;
// A V8 stack frame: `at [fn (]<location>:<line>:<col>[)]` with a file:, node:, absolute or drive-letter
// location, `at [fn (]<anonymous>[)]`, or `at async Promise.all (index N)`; the location forms may carry V8's `async ` prefix. Anything else stays text.
const FRAME = /^\s+at (?:async )?(?:(?:.+ \()?(?:file:|node:|\/|<IMPL>|[A-Za-z]:\\).*:\d+:\d+\)?|(?:.+ \()?<anonymous>\)?|async Promise\.\w+ \(index \d+\))$/;
const NODE_TRAILER = /^Node\.js v\d+(?:\.\d+)*\s*$/;

/** Drop Node warnings and the uncaught-exception source excerpt; on stderr also collapse each run of stack
 * frames to one `    at <frame>` line and drop the `Node.js v…` trailer: host/Node-version independent text.
 * stdout keeps its indented "at …" lines (a report may legitimately print them). */
export function normalizeDiagnostics(text, { stream = 'stdout' } = {}) {
  const stderr = stream === 'stderr';
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\(node:\d+\) \w*Warning: /.test(l)) { if (/^\(Use `node --trace-/.test(lines[i + 1] ?? '')) i++; continue; }
    if (LOCATION.test(l) && CARET.test(lines[i + 2] ?? '')) { out.push('<uncaught-at>'); i += 2; continue; }
    if (stderr && NODE_TRAILER.test(l)) continue;
    if (stderr && FRAME.test(l)) { if (out[out.length - 1] !== '    at <frame>' || !FRAME.test(lines[i - 1] ?? '')) out.push('    at <frame>'); continue; }
    out.push(l);
  }
  return out.join('\n');
}
