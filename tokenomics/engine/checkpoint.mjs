// The verified checkpoint taken before activation (Plan 5 D-CKPT, spec §18.5). STDLIB ONLY.
//
//   - Store. Every durable file under .agents/telemetry/ (tracked, modified or untracked) is committed on the store's
//     history: the `telemetry` branch of the submodule, or for the plain-folder form the orphan ref
//     refs/tokenomics/store of the main repository. Working state is left out (B3 final review I1): transient markers
//     (.pending-*, .nagged-*, .unclosed-*, spec §2), the paths substrate.mjs WORKING_STATE names (`<module>/live/**`),
//     and in the submodule form every untracked path the store's own ignore rules exclude. A path tracked in the
//     parent commit is always kept. The tree is built with plumbing through a temporary GIT_INDEX_FILE, so the
//     operator's index is never read for writing or touched.
//   - Main tree. .checkpoints/pre-engine-<v>/checkpoint.json records {version, at, mainTreeCommit, copied,
//     localCopies}. Each file in scope (.agents/tokenomics/** plus the caller's wrapper paths) that is tracked and
//     clean is named by mainTreeCommit; each one that is uncommitted or untracked is copied under
//     .checkpoints/pre-engine-<v>/main-tree/ (`copied`), except a local-only one — ignored by the main repo, or named
//     `*.local.json` (B3 final review I2) — which never enters the store's (pushed) history: it is copied to
//     <git-common-dir>/tokenomics/pre-engine-<v>/main-tree/, beside the bundle (`localCopies`).
//     In the submodule form the record and the copies are also written into the store's checkout (it is the
//     writer's tree, and the parent ignores it), so that checkout stays equal to its branch. In the plain-folder form
//     they exist only in the commit: the main working tree is never written.
//   - Tag and bundle. The commit is tagged pre-engine-<v> in the store's repository, and a bundle of that tag is
//     written to <git-common-dir>/tokenomics/pre-engine-<v>.bundle and checked with `git bundle verify`.
//   - Re-run. An existing tag is reused only when its bundle verifies and holds the tagged commit, and its tree holds
//     the checkpoint record (else checkpoint-foreign-tag). The tag is never moved: a missing or bad bundle is a
//     CheckpointError naming the remedy. A failure before the branch moves removes the record directory it created.
//   - Offline. No fetch, no push: every call is local plumbing.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isWorkingState } from './substrate.mjs';

export class CheckpointError extends Error {
  constructor(code, detail) {
    super(`tokenomics: ${code}: ${detail}`);
    this.name = 'CheckpointError';
    this.code = code;
  }
}

const STORE_DIR = '.agents/telemetry';
const SCOPE_DIR = '.agents/tokenomics';
const STORE_REF = { submodule: 'refs/heads/telemetry', 'plain-folder': 'refs/tokenomics/store' };
const MARKER = /^\.(pending|nagged|unclosed)-/;
const FALLBACK_ID = [['user.name', 'tokenomics'], ['user.email', 'tokenomics@localhost']];
const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];

/**
 * Take (or reuse) the verified checkpoint for `version`.
 * @param {string} repo the main repository's working tree
 * @param {object} _settings the engine settings (the store location is fixed by spec §2, so unused today)
 * @param {{version: string, form: 'submodule'|'plain-folder', wrappers?: string[], env?: object}} opts
 * @returns {{tag: string, commit: string, bundle: string, reused: boolean, copied: string[], localCopies: string[]}}
 */
export function takeCheckpoint(repo, _settings, { version, form, wrappers = [], env = process.env } = {}) {
  if (!Object.hasOwn(STORE_REF, form)) throw new CheckpointError('checkpoint-bad-form', `form must be 'submodule' or 'plain-folder', got ${JSON.stringify(form)}`);
  const tag = `pre-engine-${version}`;
  if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version) || version.includes('..') || version.endsWith('.') || version.endsWith('.lock')) {
    throw new CheckpointError('checkpoint-bad-version', `version ${JSON.stringify(version)} cannot name the tag pre-engine-<version>`);
  }
  const scopePaths = wrappers.map((w) => checkWrapper(w));

  // An inherited repository-locating variable (a git hook's GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE …) would aim
  // these calls at another repository or index: they are stripped, and only `extraEnv` may set one (T6-4).
  const gitEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !GIT_LOCATION_ENV.includes(k)));
  const run = (cwd, args, { input, extraEnv } = {}) => execFileSync('git', ['--no-optional-locks', ...args], {
    cwd, env: { ...gitEnv, ...extraEnv }, input, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'],
  }).toString();
  const tryRun = (cwd, args) => { try { return run(cwd, args).trim(); } catch { return null; } };

  const top = tryRun(repo, ['rev-parse', '--show-toplevel']);
  if (!top) throw new CheckpointError('checkpoint-no-git', `${repo} is not a git repository; no verified checkpoint is possible`);
  const main = realpathSync(top);
  const storeDir = join(main, ...STORE_DIR.split('/'));
  if (!existsSync(storeDir) || !lstatSync(storeDir).isDirectory()) throw new CheckpointError('checkpoint-no-store', `${STORE_DIR}/ does not exist in ${main}`);
  // The store's repository: the submodule's own, or the main repository for the plain-folder form.
  let storeRepo = main;
  if (form === 'submodule') {
    const storeTop = tryRun(storeDir, ['rev-parse', '--show-toplevel']);
    if (!storeTop || realpathSync(storeTop) !== realpathSync(storeDir)) throw new CheckpointError('checkpoint-no-store', `${STORE_DIR} is not a materialised submodule checkout (run install-hooks to set up the substrate)`);
    storeRepo = storeDir;
    if (tryRun(storeRepo, ['rev-parse', '--verify', '-q', `${STORE_REF.submodule}^{commit}`]) === null) throw new CheckpointError('checkpoint-no-store', `the store submodule has no telemetry branch (${STORE_REF.submodule})`);
  }
  const bundle = join(resolve(main, run(main, ['rev-parse', '--git-common-dir']).trim()), 'tokenomics', `${tag}.bundle`);
  const tagRef = `refs/tags/${tag}`;
  const record = `.checkpoints/${tag}`;

  // Re-run: reuse only a tag whose bundle verifies and carries it; never move it.
  const tagged = tryRun(storeRepo, ['rev-parse', '--verify', '-q', `${tagRef}^{commit}`]);
  if (tagged) {
    const remedy = `restore the bundle to ${bundle}, or delete the tag (git -C ${JSON.stringify(storeRepo)} tag -d ${tag}) to take a fresh checkpoint`;
    if (!existsSync(bundle)) throw new CheckpointError('checkpoint-bundle-missing', `tag ${tag} exists in ${storeRepo} but its bundle ${bundle} is missing; ${remedy}`);
    if (!bundleHolds(run, storeRepo, bundle, tagRef, tagged)) throw new CheckpointError('checkpoint-bundle-invalid', `bundle ${bundle} does not verify or does not hold tag ${tag} at ${tagged}; ${remedy}`);
    // A tag this engine did not take has no record: reusing it would certify a checkpoint that never happened (T6-2).
    let rec;
    try { rec = JSON.parse(run(storeRepo, ['show', `${tagged}:${record}/checkpoint.json`])); } catch { rec = null; }
    if (!rec || typeof rec !== 'object') {
      throw new CheckpointError('checkpoint-foreign-tag', `tag ${tag} in ${storeRepo} holds no readable ${record}/checkpoint.json, so it is not a checkpoint this engine took; delete or rename the tag (git -C ${JSON.stringify(storeRepo)} tag -d ${tag}) and move its bundle ${bundle} aside to take a fresh checkpoint`);
    }
    return { tag, commit: tagged, bundle, reused: true, copied: rec.copied ?? [], localCopies: rec.localCopies ?? [] };
  }
  // Tag absent but bundle present: the bundle may be the last copy of a checkpoint. Write nothing, overwrite nothing.
  if (existsSync(bundle) || isFileOrLink(bundle)) {
    throw new CheckpointError('checkpoint-bundle-orphaned', `bundle ${bundle} exists but tag ${tag} is absent from ${storeRepo}, so it may be the last copy of a checkpoint; nothing was written. Either restore the tag from the bundle (git -C ${JSON.stringify(storeRepo)} fetch ${JSON.stringify(bundle)} ${tagRef}:${tagRef}) or move the bundle aside`);
  }

  // Main tree: name the clean tracked files by commit, copy the rest.
  const mainTreeCommit = tryRun(main, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  const inScope = [...listFiles(main, SCOPE_DIR), ...scopePaths.filter((p) => isFileOrLink(join(main, p)))];
  const clean = cleanTracked(run, main, mainTreeCommit, [...new Set(inScope)]);
  const uncommitted = [...new Set(inScope)].filter((p) => !clean.has(p)).sort();
  // A file the main repo ignores, or a `*.local.json`, is per-user and may hold secrets: it never reaches the store's
  // (pushed) history. It is copied beside the bundle instead, in the local git dir (B3 final review I2, ruling R18).
  const local = localOnly(run, main, uncommitted);
  const copied = uncommitted.filter((p) => !local.has(p));
  const localCopies = uncommitted.filter((p) => local.has(p));
  const localBase = join(dirname(bundle), tag);
  const at = new Date().toISOString();
  const recordJson = `${JSON.stringify({ version, at, mainTreeCommit, copied, localCopies }, null, 2)}\n`;

  // The local copies first, so a tag never exists without them. Tag and bundle are absent here, so anything already
  // at localBase is a leftover of a run that failed before tagging: it is replaced.
  let wroteLocal = false;
  if (localCopies.length) {
    rmSync(localBase, { recursive: true, force: true });
    wroteLocal = true;
    try {
      for (const p of localCopies) copyEntry(join(main, p), join(localBase, 'main-tree', ...p.split('/')));
    } catch (err) {
      rmSync(localBase, { recursive: true, force: true });
      throw new CheckpointError('checkpoint-failed', `the local copies could not be written under ${localBase}: ${String(err?.message ?? err).split('\n')[0]}`);
    }
  }

  // Build the store tree through a temporary index.
  const tmp = mkdtempSync(join(tmpdir(), 'tokenomics-ckpt-'));
  let done = false;
  let refMoved = false;
  // M11: the record directory (and `.checkpoints/` itself) this call creates in the store checkout is removed again
  // on a failure before the branch moves; after that it matches the branch and stays.
  const ckRoot = join(storeDir, '.checkpoints');
  const recordDir = join(storeDir, ...record.split('/'));
  const created = form === 'submodule' ? (existsSync(ckRoot) ? (existsSync(recordDir) ? null : recordDir) : ckRoot) : null;
  try {
    if (form === 'submodule') {
      // The store's checkout is the writer's tree: materialise the record there so it matches the branch.
      mkdirSync(recordDir, { recursive: true });
      writeFileSync(join(recordDir, 'checkpoint.json'), recordJson);
      for (const p of copied) copyEntry(join(main, p), join(recordDir, 'main-tree', ...p.split('/')));
    }
    const ref = STORE_REF[form];
    const parent = tryRun(storeRepo, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
    const entries = snapshot(run, storeRepo, storeDir, durableFiles(run, storeRepo, storeDir, form, parent));
    if (form === 'plain-folder') {
      entries.push({ mode: '100644', sha: hashBuffer(run, storeRepo, recordJson), path: `${record}/checkpoint.json` });
      for (const e of snapshot(run, storeRepo, main, copied)) entries.push({ ...e, path: `${record}/main-tree/${e.path}` });
    }
    const index = { GIT_INDEX_FILE: join(tmp, 'index') };
    const info = entries.map((e) => `${e.mode} ${e.sha}\t${e.path}\0`).join('');
    run(storeRepo, ['update-index', '-z', '--add', '--index-info'], { input: info, extraEnv: index });
    const tree = run(storeRepo, ['write-tree'], { extraEnv: index }).trim();

    const ident = FALLBACK_ID.filter(([k]) => tryRun(storeRepo, ['config', '--get', k]) === null).flatMap(([k, v]) => ['-c', `${k}=${v}`]);
    const commit = run(storeRepo, [...ident, 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `tokenomics: checkpoint ${tag}`]).trim();
    run(storeRepo, ['update-ref', '-m', `tokenomics: checkpoint ${tag}`, ref, commit, parent ?? '']);
    refMoved = true;
    if (form === 'submodule' && tryRun(storeRepo, ['symbolic-ref', '-q', 'HEAD']) === ref) {
      // The store's own index follows its branch; its working files are unchanged. This mixed reset also supersedes
      // anything staged-only in the store (T6-3): a staged version that differs from its working file is not in the
      // commit (the tree is built from the working files) and is dropped from the index. The store is the writer's
      // checkout, so nothing an operator stages there by hand is expected; its working bytes are what the commit holds.
      run(storeRepo, ['reset', '-q']);
    }
    run(storeRepo, ['update-ref', tagRef, commit, '']); // '' = the tag must not exist: it is created, never moved

    // Verify: the tag holds the tree just built, and its bundle verifies and carries it.
    if (run(storeRepo, ['rev-parse', `${tagRef}^{tree}`]).trim() !== tree) throw new CheckpointError('checkpoint-unverified', `tag ${tag} does not hold the tree ${tree}`);
    mkdirSync(dirname(bundle), { recursive: true });
    const partial = `${bundle}.partial`;
    try {
      run(storeRepo, ['bundle', 'create', '-q', partial, tagRef]);
      if (!bundleHolds(run, storeRepo, partial, tagRef, commit)) throw new Error('bundle verify failed');
      renameSync(partial, bundle);
    } catch (err) {
      rmSync(partial, { force: true });
      tryRun(storeRepo, ['update-ref', '-d', tagRef, commit]); // only the tag this call created
      throw new CheckpointError('checkpoint-bundle-invalid', `could not write a verified bundle ${bundle}: ${String(err?.message ?? err).split('\n')[0]}`);
    }
    done = true;
    return { tag, commit, bundle, reused: false, copied, localCopies };
  } catch (err) {
    if (err instanceof CheckpointError) throw err;
    const why = String(err?.stderr?.toString().trim() || err?.message || err).split('\n')[0];
    throw new CheckpointError('checkpoint-failed', `the store could not be committed and tagged: ${why}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (!done && wroteLocal) rmSync(localBase, { recursive: true, force: true });
    if (!done && !refMoved && created) rmSync(created, { recursive: true, force: true });
  }
}

/** The `paths` (repo-relative, in the main tree) that are local-only: named `*.local.json`, or ignored by the main
 * repository's rules (`check-ignore --no-index`, so a tracked file the rules match counts too). One git call. */
function localOnly(run, main, paths) {
  const out = new Set(paths.filter((p) => /\.local\.json$/.test(p)));
  const rest = paths.filter((p) => !out.has(p));
  if (!rest.length) return out;
  let listed = '';
  try { listed = run(main, ['check-ignore', '--no-index', '-z', '--stdin'], { input: rest.map((p) => `${p}\0`).join('') }); } catch (err) {
    if (err?.status !== 1) throw new CheckpointError('checkpoint-failed', `git check-ignore failed: ${String(err?.stderr?.toString().trim() || err?.message || err).split('\n')[0]}`);
  }
  for (const p of listed.split('\0')) if (p) out.add(p);
  return out;
}

function checkWrapper(w) {
  const bad = (why) => new CheckpointError('checkpoint-bad-wrapper', `wrapper path ${JSON.stringify(w)} ${why}`);
  if (typeof w !== 'string' || w === '' || isAbsolute(w) || w.includes('\\')) throw bad('must be a repo-relative path');
  const parts = w.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) throw bad('must not climb or contain empty segments');
  if (w === STORE_DIR || w.startsWith(`${STORE_DIR}/`)) throw bad(`is inside the store (${STORE_DIR}/)`);
  return w;
}

const isFileOrLink = (p) => { try { const s = lstatSync(p); return s.isFile() || s.isSymbolicLink(); } catch { return false; } };

/** Repo-relative (posix) paths of every file and symlink under `root/rel`, skipping any `.git` entry. */
function listFiles(root, rel) {
  const out = [];
  const walk = (r) => {
    const abs = r ? join(root, ...r.split('/')) : root;
    if (!existsSync(abs) || !lstatSync(abs).isDirectory()) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const child = r ? `${r}/${e.name}` : e.name;
      if (e.isDirectory()) walk(child);
      else if (e.isFile() || e.isSymbolicLink()) out.push(child);
    }
  };
  walk(rel);
  return out.sort();
}

/**
 * The store files the checkpoint commits (B3 final review I1): every file under the store, minus working state.
 * Working state is a transient marker (any `.pending-*`, `.nagged-*`, `.unclosed-*` segment), a path WORKING_STATE
 * names (`<module>/live/**`, the scope markers; the plain-folder form's whole rule, since the main repo's ignore rules
 * are not the store's), and in the submodule form every untracked path the store's own ignore rules exclude (a
 * module's `.gitignore` included). A path tracked in the parent commit is never dropped, so a store that already
 * tracks such a file is not turned into deletions.
 */
function durableFiles(run, storeRepo, storeDir, form, parent) {
  const inParent = new Set(parent ? run(storeRepo, ['ls-tree', '-r', '-z', '--name-only', parent]).split('\0').filter(Boolean) : []);
  const ignored = new Set(form === 'submodule'
    ? run(storeDir, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard']).split('\0').filter(Boolean) : []);
  return listFiles(storeDir, '').filter((p) => inParent.has(p)
    || !(p.split('/').some((s) => MARKER.test(s)) || isWorkingState(p) || ignored.has(p)));
}

const modeOf = (abs) => { const s = lstatSync(abs); return s.isSymbolicLink() ? '120000' : (s.mode & 0o111 ? '100755' : '100644'); };

function hashBuffer(run, cwd, buf, write = true) {
  return run(cwd, ['hash-object', ...(write ? ['-w'] : []), '--stdin'], { input: buf }).trim();
}

/** Blob entries for `paths` under `root`, written exactly (no filters) into `repo`'s object store. */
function snapshot(run, repo, root, paths) {
  const abs = (p) => join(root, ...p.split('/'));
  const regular = paths.filter((p) => modeOf(abs(p)) !== '120000');
  if (regular.some((p) => p.includes('\n'))) throw new CheckpointError('checkpoint-unverified', 'a store path contains a newline');
  const shas = regular.length ? run(repo, ['hash-object', '-w', '--no-filters', '--stdin-paths'], { input: regular.map(abs).join('\n') + '\n' }).trim().split('\n') : [];
  const byPath = new Map(regular.map((p, i) => [p, shas[i]]));
  return paths.map((p) => {
    const mode = modeOf(abs(p));
    return { mode, sha: mode === '120000' ? hashBuffer(run, repo, readlinkSync(abs(p))) : byPath.get(p), path: p };
  });
}

/** The paths that are tracked and clean: HEAD, the index and the working file all agree. Read-only (the index is
 * never refreshed); a constant number of git calls whatever the number of paths. */
function cleanTracked(run, main, head, paths) {
  const clean = new Set();
  if (!head || !paths.length) return clean;
  const entries = (args) => {
    const out = new Map();
    for (const rec of run(main, ['--literal-pathspecs', ...args, '--', ...paths]).split('\0')) {
      const tab = rec.indexOf('\t');
      if (tab > 0) out.set(rec.slice(tab + 1), rec.slice(0, tab).split(' '));
    }
    return out;
  };
  const inHead = entries(['ls-tree', '-r', '-z', head]); // path → [mode, type, sha]
  const inIndex = entries(['ls-files', '-s', '-z']); // path → [mode, sha, stage]
  const candidates = paths.filter((p) => {
    const h = inHead.get(p); const i = inIndex.get(p);
    return h && i && i[2] === '0' && h[0] === i[0] && h[2] === i[1] && modeOf(join(main, ...p.split('/'))) === h[0];
  });
  const regular = candidates.filter((p) => inHead.get(p)[0] !== '120000' && !p.includes('\n'));
  const shas = regular.length ? run(main, ['hash-object', '--stdin-paths'], { input: `${regular.join('\n')}\n` }).trim().split('\n') : [];
  regular.forEach((p, k) => { if (shas[k] === inHead.get(p)[2]) clean.add(p); });
  for (const p of candidates.filter((q) => inHead.get(q)[0] === '120000')) {
    if (hashBuffer(run, main, readlinkSync(join(main, ...p.split('/'))), false) === inHead.get(p)[2]) clean.add(p);
  }
  return clean;
}

function copyEntry(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  rmSync(to, { force: true });
  if (lstatSync(from).isSymbolicLink()) { symlinkSync(readlinkSync(from), to); return; }
  writeFileSync(to, readFileSync(from));
  chmodSync(to, statSync(from).mode & 0o777);
}

/** The bundle verifies in `repo` and lists `ref` at `commit`. */
function bundleHolds(run, repo, file, ref, commit) {
  try {
    run(repo, ['bundle', 'verify', '-q', file]);
    return run(repo, ['bundle', 'list-heads', file]).split('\n').some((l) => l.trim() === `${commit} ${ref}`);
  } catch { return false; }
}
