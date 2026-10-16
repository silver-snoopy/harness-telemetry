// substrate.mjs — the shared telemetry store, created and verified first (D-SUB, spec §2, §14.2).
//
// Submodule form: `.agents/telemetry` is a checkout of THIS repository's orphan `telemetry` branch
// (`.gitmodules` url `./`, branch `telemetry`, `ignore = all`), materialised. Verify checks all four
// through git. The plain-folder form is never chosen silently: it is honoured when settings record
// it, or taken when the operator passes `--plain-folder` after the submodule form failed. When
// `settings.substrate.required === "submodule"` nothing but a verified submodule is accepted.
// Every throw is a SubstrateError carrying a `code` and a `remedy` line.
//
// STDLIB ONLY.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const SUBSTRATE_PATH = '.agents/telemetry';
export const SUBSTRATE_BRANCH = 'telemetry';
const KEY = `submodule.${SUBSTRATE_PATH}`;
const ID = ['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry'];

/** Transient working state, never committed even to the telemetry branch (spec §2): store-relative gitignore
 * patterns. The store's seeded `.gitignore` and the checkpoint's working-state filter both derive from this list. */
export const WORKING_STATE = Object.freeze(['*/live/', '*/scopes/.pending-*', '*/scopes/.nagged-*', '*/scopes/.unclosed-*']);
export const INNER_GITIGNORE = WORKING_STATE.map((p) => `${p}\n`).join('');
// `*` is one path segment's worth of characters; a trailing `/` names a directory (everything below it).
const WORKING_STATE_RE = WORKING_STATE.map((g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}${g.endsWith('/') ? '' : '$'}`));
/** A store-relative (posix) path that WORKING_STATE names. */
export const isWorkingState = (rel) => WORKING_STATE_RE.some((re) => re.test(rel));
const DEFAULT_README = `# Telemetry (machine-written)

Shared telemetry store: one subfolder per module. Hooks write here and commit to the
\`telemetry\` branch of this repository, never to the main branch. Do not edit by hand.

Empty after a clone? Run \`git submodule update --init\`.
`;

export class SubstrateError extends Error {
  constructor(code, message, remedy, problems = []) {
    super(`${message}\n  remedy: ${remedy}`);
    this.name = 'SubstrateError';
    this.code = code;
    this.remedy = remedy;
    this.problems = problems;
  }
}

const firstLine = (err) => String(err?.stderr || err?.message || err).trim().split('\n').filter(Boolean).pop() ?? String(err);

function gitIn(repo, env) {
  return (args, { cwd = repo, timeout = 20000 } = {}) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim();
}
const tryGit = (git, args, o) => { try { return git(args, o); } catch { return null; } };
const isRepo = (git) => tryGit(git, ['rev-parse', '--git-dir']) !== null;
const gitmodules = (git, key) => tryGit(git, ['config', '-f', '.gitmodules', '--get', `${KEY}.${key}`]);
const registered = (git) => gitmodules(git, 'path') !== null || gitmodules(git, 'url') !== null;

/** Stage the store pointer: the main repo's gitlink names the store checkout's HEAD. Written with update-index, never
 * `git add`, because newer git (t2206) skips a `submodule.<name>.ignore = all` path in `git add` unless forced, which
 * would leave the pointer at the clone-time commit. */
export function stageStorePointer(repo, { env = process.env } = {}) {
  const git = gitIn(repo, env);
  const head = git(['rev-parse', 'HEAD'], { cwd: join(repo, ...SUBSTRATE_PATH.split('/')) });
  git(['update-index', '--add', '--cacheinfo', `160000,${head},${SUBSTRATE_PATH}`]);
}

/**
 * Check the substrate through git. Submodule form: url `./`, branch `telemetry` (in `.gitmodules`
 * and in the checkout; a detached pointer on the telemetry history is fine), `ignore = all`,
 * materialised. No submodule: the plain-folder form, which must be recorded in settings.
 */
export function verifySubstrate(repo, settings = {}, { env = process.env } = {}) {
  const git = gitIn(repo, env);
  if (!isRepo(git)) return { ok: false, form: null, problems: [`no git repository at ${repo} (run \`git init\`; no verified checkpoint is possible without git)`] };
  const dir = join(repo, SUBSTRATE_PATH);
  if (!registered(git) && !existsSync(join(dir, '.git'))) {
    const recorded = settings?.substrate?.form === 'plain-folder';
    return recorded ? { ok: true, form: 'plain-folder', problems: [] }
      : { ok: false, form: 'plain-folder', problems: [`plain folder not recorded: ${SUBSTRATE_PATH} is not a submodule and settings.substrate.form is not "plain-folder" (re-run install-hooks to create the submodule, or pass --plain-folder)`] };
  }
  const problems = [];
  const url = gitmodules(git, 'url');
  if (url !== './') problems.push(`url is ${JSON.stringify(url)}, not "./" (set \`git config -f .gitmodules ${KEY}.url ./\`)`);
  const branch = gitmodules(git, 'branch');
  if (branch !== SUBSTRATE_BRANCH) problems.push(`wrong branch: .gitmodules branch is ${JSON.stringify(branch)}, not "${SUBSTRATE_BRANCH}" (set \`git config -f .gitmodules ${KEY}.branch ${SUBSTRATE_BRANCH}\`)`);
  const ignore = gitmodules(git, 'ignore');
  if (ignore !== 'all') problems.push(`ignore is ${JSON.stringify(ignore)}, not "all" (set \`git config -f .gitmodules ${KEY}.ignore all\`)`);
  const status = tryGit(git, ['submodule', 'status', '--', SUBSTRATE_PATH]);
  const materialised = existsSync(join(dir, '.git')) && !!status && !status.startsWith('-');
  if (!materialised) {
    problems.push(`not materialised: ${SUBSTRATE_PATH} has no checkout (run \`git submodule update --init -- ${SUBSTRATE_PATH}\`)`);
  } else {
    const current = tryGit(git, ['branch', '--show-current'], { cwd: dir });
    if (current && current !== SUBSTRATE_BRANCH) {
      problems.push(`wrong branch: the checkout is on ${JSON.stringify(current)}, not "${SUBSTRATE_BRANCH}" (run \`git -C ${SUBSTRATE_PATH} checkout ${SUBSTRATE_BRANCH}\`)`);
    } else if (!current) {
      const onHistory = [`refs/heads/${SUBSTRATE_BRANCH}`, `refs/remotes/origin/${SUBSTRATE_BRANCH}`]
        .some((ref) => tryGit(git, ['merge-base', '--is-ancestor', 'HEAD', ref], { cwd: dir }) !== null);
      if (!onHistory) problems.push(`wrong branch: the detached checkout is not on the "${SUBSTRATE_BRANCH}" history (run \`git -C ${SUBSTRATE_PATH} checkout ${SUBSTRATE_BRANCH}\`)`);
    }
  }
  const left = stranded(repo);
  if (left.length) problems.push(`interim files stranded in ${STASH}/ (${left.join(', ')}): they are outside the store and its checkpoint (merge each into ${SUBSTRATE_PATH}/, delete it from the stash, and re-run install-hooks)`);
  return { ok: problems.length === 0, form: 'submodule', problems };
}

/**
 * Create (or materialise) and verify the substrate. Returns `{ form, created }`; a fresh submodule
 * also carries `migrate: true` when an earlier era's committed telemetry had its index entries
 * removed (staged, for the operator's one review commit). A plain-folder result after a failure
 * carries the `cause`. `seed` maps file names to the contents written into a new checkout when absent.
 */
export function ensureSubstrate(repo, settings = {}, { plainFolder = false, env = process.env, seed = {} } = {}) {
  const git = gitIn(repo, env);
  if (!isRepo(git)) throw new SubstrateError('no-git', `substrate: ${repo} is not a git repository`, 'run `git init` (and commit) first; activation needs git for a verified checkpoint');
  const required = settings?.substrate?.required === 'submodule';
  const dir = join(repo, SUBSTRATE_PATH);
  const fail = (cause, problems = []) => {
    if (required) throw new SubstrateError('submodule-required', `substrate: the submodule form could not be verified: ${cause}`, 'fix the cause and re-run; settings.substrate.required is "submodule", so the plain-folder form is not allowed', problems);
    // A plain folder over a registered (or materialised) submodule contradicts the git state: never accepted.
    if (plainFolder && (registered(git) || existsSync(join(dir, '.git')))) {
      throw new SubstrateError('submodule-registered', `substrate: ${SUBSTRATE_PATH} is a registered submodule that fails verification: ${cause}`,
        `repair the submodule (e.g. \`git config -f .gitmodules ${KEY}.ignore all\`) and re-run, or deregister it (\`git submodule deinit -f -- ${SUBSTRATE_PATH}\`, \`git rm --cached ${SUBSTRATE_PATH}\` and remove its .gitmodules entry) before choosing the plain folder`, problems);
    }
    if (plainFolder) return { form: 'plain-folder', created: false, cause };
    throw new SubstrateError('submodule-failed', `substrate: the submodule form could not be verified: ${cause}`, 'fix the cause and re-run, or re-run with --plain-folder to use the plain-folder form (it writes the main tree)', problems);
  };
  const checked = (result) => {
    const v = verifySubstrate(repo, settings, { env });
    return v.ok && v.form === 'submodule' ? result : fail(v.problems.join('; '), v.problems);
  };

  if (existsSync(join(dir, '.git'))) {
    try { attachBranch(git, dir); } catch (err) { return fail(firstLine(err)); }
    // An earlier run left interim files in the stash (a conflict): merge again; refuse while any remain.
    if (existsSync(join(repo, STASH))) {
      const left = mergeInterim(join(repo, STASH), dir);
      if (left.length) throw interimConflict(left);
    }
    return checked({ form: 'submodule', created: false });
  }
  if (!registered(git) && settings?.substrate?.form === 'plain-folder') {
    return required ? fail('settings record the plain-folder form') : { form: 'plain-folder', created: false };
  }
  if (existsSync(dir) && !statSync(dir).isDirectory()) return fail(`${SUBSTRATE_PATH} exists and is not a directory`);

  // Interim files (a plain-dir phase) move aside before the checkout and MUST move back on any exit, file by file
  // (Codex B3-02): a conflict stays in the stash and refuses the run, so no durable file is ever left out unseen.
  const stash = `${dir}.pre-submodule`;
  let stashed = false;
  let conflicts = [];
  const restore = () => {
    if (!stashed || !existsSync(stash)) return;
    mkdirSync(dir, { recursive: true });
    conflicts = mergeInterim(stash, dir);
    stashed = false;
  };
  let migrate = false;
  // A failed run leaves the operator's index and .gitmodules exactly as it found them (Codex B3-08, final review
  // T11-2): the original index entries (every stage) and .gitmodules bytes are saved before anything changes.
  const raw = (args, input) => execFileSync('git', args, { cwd: repo, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
  const OWN = ['.gitmodules', SUBSTRATE_PATH];
  const origIndex = raw(['ls-files', '-s', '-z', '--', ...OWN]).split('\0').filter(Boolean);
  const gmPath = join(repo, '.gitmodules');
  const origGitmodules = existsSync(gmPath) ? readFileSync(gmPath) : null;
  const under = (paths) => (rec) => { const p = rec.slice(rec.indexOf('\t') + 1); return paths.some((q) => p === q || p.startsWith(`${q}/`)); };
  const restoreIndex = (paths) => {
    const now = raw(['ls-files', '-z', '--', ...paths]).split('\0').filter(Boolean);
    if (now.length) raw(['update-index', '-z', '--force-remove', '--stdin'], now.map((p) => `${p}\0`).join(''));
    const back = origIndex.filter(under(paths));
    if (back.length) raw(['update-index', '-z', '--index-info'], back.map((r) => `${r}\0`).join(''));
  };
  if (existsSync(stash) && existsSync(dir) && readdirSync(dir).length > 0) {
    throw new SubstrateError('interim-conflict', `substrate: both ${SUBSTRATE_PATH}/ and ${STASH}/ hold files, and ${SUBSTRATE_PATH} is not a checkout`,
      `merge ${STASH}/ into ${SUBSTRATE_PATH}/ by hand (or move one aside), then re-run; nothing was changed`);
  }
  let registering = false; // `submodule add` was started by this run
  let restoredInTry = false;
  try {
    if (existsSync(stash)) stashed = true; // an earlier run's leftovers: merged back below like a fresh stash
    else if (existsSync(dir) && readdirSync(dir).length > 0) { renameSync(dir, stash); stashed = true; }
    const fresh = !registered(git);
    if (!fresh) {
      // Cloned without --recurse-submodules: the branch exists; materialise, never recreate.
      git(['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--', SUBSTRATE_PATH]);
      attachBranch(git, dir); // detached at the pointer: a local telemetry branch first (Codex B3-07)
    } else {
      if (tryGit(git, ['rev-parse', '--verify', '-q', `refs/heads/${SUBSTRATE_BRANCH}`]) === null) {
        if (tryGit(git, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${SUBSTRATE_BRANCH}`]) !== null) {
          git(['branch', SUBSTRATE_BRANCH, `origin/${SUBSTRATE_BRANCH}`]);
        } else {
          // Plumbing only (the main tree never moves); the identity is explicit so no global one is needed.
          const tree = git(['hash-object', '-t', 'tree', '/dev/null']);
          const commit = git([...ID, 'commit-tree', tree, '-m', 'telemetry: root']);
          git(['update-ref', `refs/heads/${SUBSTRATE_BRANCH}`, commit]);
        }
      }
      // An earlier era committed telemetry to main; `submodule add` refuses a tracked path, so the
      // index entries go first (files stay on disk, in the stash; the operator's commit records it).
      if (git(['ls-files', '--', SUBSTRATE_PATH])) { git(['rm', '-r', '-q', '--cached', '--', SUBSTRATE_PATH]); migrate = true; }
      tryGit(git, ['push', 'origin', `refs/heads/${SUBSTRATE_BRANCH}:refs/heads/${SUBSTRATE_BRANCH}`]); // best-effort
      // The checkout is cloned from THIS repository by its path, never from `./`: a relative URL resolves against
      // `origin`, so with an unreachable remote (offline) the clone would fail. .gitmodules then records `./`
      // (spec §2) and `sync` re-points the registered URL; nothing is fetched.
      registering = true;
      git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '--force', '-b', SUBSTRATE_BRANCH, '--', git(['rev-parse', '--show-toplevel']), SUBSTRATE_PATH]);
      git(['config', '-f', '.gitmodules', `${KEY}.url`, './']);
      git(['submodule', 'sync', '-q', '--', SUBSTRATE_PATH]);
      git(['config', '-f', '.gitmodules', `${KEY}.ignore`, 'all']);
      git(['add', '.gitmodules']);
    }
    restore();
    restoredInTry = true;
    if (fresh) {
      const files = { 'README.md': DEFAULT_README, '.gitignore': INNER_GITIGNORE, ...seed };
      for (const [name, body] of Object.entries(files)) if (!existsSync(join(dir, name))) writeFileSync(join(dir, name), body);
    }
    // Unconditional when anything is pending (seed or restored interim files): an untracked file is
    // a dirty checkout, and the pointer must name the commit that holds it.
    git(['add', '-A'], { cwd: dir });
    if (git(['status', '--porcelain'], { cwd: dir })) {
      if (git(['branch', '--show-current'], { cwd: dir }) !== SUBSTRATE_BRANCH) {
        // An existing local branch is never reset backward; only a missing one is created at HEAD.
        const hasLocal = tryGit(git, ['rev-parse', '--verify', '-q', `refs/heads/${SUBSTRATE_BRANCH}`], { cwd: dir }) !== null;
        git(hasLocal ? ['checkout', '-q', SUBSTRATE_BRANCH] : ['checkout', '-q', '-b', SUBSTRATE_BRANCH], { cwd: dir });
      }
      git([...ID, 'commit', '-q', '-m', 'telemetry: seed'], { cwd: dir });
      tryGit(git, ['push', 'origin', `HEAD:${SUBSTRATE_BRANCH}`], { cwd: dir }); // best-effort
      stageStorePointer(repo, { env });
    } else if (fresh) {
      stageStorePointer(repo, { env });
    }
  } catch (err) {
    try {
      if (registering && !restoredInTry) {
        // The registration this run started is rolled back (T11-2): the half-made checkout (a clone of the branch,
        // nothing else: interim files are still in the stash), the .git/config entry, .gitmodules (which may hold
        // the absolute clone URL) byte for byte, and the index entries of .gitmodules and the store path.
        rmSync(dir, { recursive: true, force: true });
        tryGit(git, ['config', '--remove-section', KEY]);
        if (origGitmodules === null) rmSync(gmPath, { force: true }); else writeFileSync(gmPath, origGitmodules);
        restoreIndex(OWN);
      } else if (migrate) {
        // Undo the staged migration with the exact entries saved above, never a reset to HEAD (Codex B3-08).
        restoreIndex([SUBSTRATE_PATH]);
      }
    } catch { /* best effort: the files never left the disk */ }
    migrate = false;
    try { restore(); } catch { /* the stash dir is left in place, data preserved */ }
    return fail(firstLine(err));
  }
  if (conflicts.length) throw interimConflict(conflicts);
  return checked(migrate ? { form: 'submodule', created: true, migrate } : { form: 'submodule', created: true });
}

/**
 * A materialised but detached store checkout with no local `telemetry` branch (a clone made without
 * --recurse-submodules, or `submodule update --init`) gets one before verification and the checkpoint, which commits
 * on `refs/heads/telemetry` (Codex B3-07). History is never rewound: the branch is created at `origin/telemetry`
 * (tracking it) when HEAD is on that history, or at HEAD when HEAD is ahead of it; then it is checked out, a
 * fast-forward of the worktree that carries local changes (a conflicting change makes git refuse, and the caller
 * fails with git's message). A checkout already on a branch, a local branch that already exists, a missing
 * `origin/telemetry`, or a HEAD that diverged from it are left alone for verifySubstrate to judge.
 */
function attachBranch(git, dir) {
  const t = (args) => tryGit(git, args, { cwd: dir });
  if (t(['symbolic-ref', '-q', 'HEAD']) !== null) return;
  const has = (ref) => t(['rev-parse', '--verify', '-q', `${ref}^{commit}`]) !== null;
  const ancestor = (a, b) => t(['merge-base', '--is-ancestor', a, b]) !== null;
  const remote = `refs/remotes/origin/${SUBSTRATE_BRANCH}`;
  if (has(`refs/heads/${SUBSTRATE_BRANCH}`) || !has(remote)) return;
  if (ancestor('HEAD', remote)) {
    git(['branch', '-q', '--track', SUBSTRATE_BRANCH, `origin/${SUBSTRATE_BRANCH}`], { cwd: dir });
  } else if (ancestor(remote, 'HEAD')) {
    git(['branch', '-q', SUBSTRATE_BRANCH, 'HEAD'], { cwd: dir });
    git(['branch', '-q', `--set-upstream-to=origin/${SUBSTRATE_BRANCH}`, SUBSTRATE_BRANCH], { cwd: dir });
  } else return;
  git(['checkout', '-q', SUBSTRATE_BRANCH], { cwd: dir });
}

const STASH = `${SUBSTRATE_PATH}.pre-submodule`;
const interimConflict = (paths) => new SubstrateError('interim-conflict',
  `substrate: ${paths.length} interim telemetry file${paths.length === 1 ? '' : 's'} differ${paths.length === 1 ? 's' : ''} from the store's copy and stay in ${STASH}/: ${paths.join(', ')}`,
  `merge each one into ${SUBSTRATE_PATH}/<same path> by hand, delete it from ${STASH}/, and re-run; nothing was lost and activation was not recorded`);

const isPrefix = (prefix, buf) => buf.length >= prefix.length && buf.subarray(0, prefix.length).equals(prefix);
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };

/**
 * Move every file of `src` (the interim stash) into `dest` (the store checkout), file by file. A path absent from
 * `dest` is moved. Two regular files: identical bytes, or `dest` already holding every byte of `src` as a prefix, drop
 * the stash copy; `src` extending `dest` (an append-only ledger written on during the interim) replaces it. Anything
 * else is a conflict, left in `src`. Empty stash directories are removed. Returns the conflicting posix paths.
 */
function mergeInterim(src, dest) {
  const conflicts = [];
  const walk = (rel) => {
    const s = rel ? join(src, ...rel.split('/')) : src;
    const d = rel ? join(dest, ...rel.split('/')) : dest;
    for (const name of readdirSync(s).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const sp = join(s, name);
      const dp = join(d, name);
      const ss = lstatSync(sp);
      const ds = lstatOrNull(dp);
      if (!rel && name === '.git') { conflicts.push(r); continue; }
      if (!ds) { mkdirSync(d, { recursive: true }); renameSync(sp, dp); continue; }
      if (ss.isDirectory() && ds.isDirectory()) { walk(r); continue; }
      if (ss.isFile() && ds.isFile()) {
        const a = readFileSync(sp);
        const b = readFileSync(dp);
        if (isPrefix(a, b)) { rmSync(sp); continue; }
        if (isPrefix(b, a)) { renameSync(sp, dp); continue; }
      }
      conflicts.push(r);
    }
    if (readdirSync(s).length === 0) rmSync(s, { recursive: true, force: true });
  };
  walk('');
  return conflicts;
}

/** Interim files still in the stash (posix paths, sorted). */
function stranded(repo) {
  const root = join(repo, STASH);
  const out = [];
  const walk = (abs, rel) => {
    let names;
    try { names = readdirSync(abs); } catch { return; }
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatOrNull(join(abs, name));
      if (st?.isDirectory()) walk(join(abs, name), r); else out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
}
