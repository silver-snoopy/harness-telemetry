// The `install` copy step (Plan 5 D-INST, spec §14.2 step 1): copies the engine into a consumer repo and marks the
// copy with `installed: {target, from, at}`. It NEVER activates — no settings.json, no host config, no hook wiring.
// The file list is the package's own ENGINE.json baseline (hash-verified), so this module needs nothing outside
// tokenomics/ and the installed copy stays self-contained. The copy is built in a temp sibling directory and renamed
// into place, so an interrupted copy never leaves a half tree. STDLIB ONLY.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const DESTINATIONS = { claude: ['.claude', 'skills', 'tokenomics'], copilot: ['.github', 'skills', 'tokenomics'] };

export class InstallError extends Error {
  constructor(message, code = 'refused') { super(message); this.code = code; }
}

const sha = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(join(dir, ent.name), rel);
      else if (ent.name !== '.DS_Store') out.push(rel); // Finder litter is not an engine file (doctor ignores it too)
    }
  };
  walk(root, '');
  return out.sort();
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function installCopy({ packageRoot, repo, target, skill = 'tokenomics', from = 'unknown', force = false, now = () => new Date().toISOString() }) {
  if (skill !== 'tokenomics') throw new InstallError(`unknown skill '${skill}'`, 'usage');
  if (!DESTINATIONS[target]) throw new InstallError(`unknown target '${target}' (use claude or copilot)`, 'usage');
  const src = join(packageRoot, 'tokenomics');
  const manifest = readJson(join(src, 'ENGINE.json'));
  if (!manifest?.files || !manifest.engine) throw new InstallError(`${src}/ENGINE.json is missing or unreadable; cannot install`);
  const rels = Object.keys(manifest.files).sort();
  const stale = rels.filter((r) => !existsSync(join(src, r)) || sha(join(src, r)) !== manifest.files[r]);
  if (stale.length) throw new InstallError(`the package is stale against its ENGINE.json baseline: ${stale.join(', ')}`);

  const dest = join(resolve(repo), ...DESTINATIONS[target]);
  let existing = null;
  try { existing = lstatSync(dest); } catch { /* absent */ }
  if (existing?.isSymbolicLink()) throw new InstallError(`${dest} is a symlink; refusing to install through it`);
  if (existing && !existing.isDirectory()) throw new InstallError(`${dest} exists and is not a directory`);

  if (existing) {
    const old = readJson(join(dest, 'ENGINE.json'));
    const present = listFiles(dest).filter((r) => r !== 'ENGINE.json');
    const problems = [];
    if (!old?.files) problems.push(`${dest}/ENGINE.json: missing or unreadable (not an installed engine copy)`);
    for (const r of present) {
      if (!old?.files || !(r in old.files)) problems.push(`${r}: unexpected file in the installed copy`);
      else if (sha(join(dest, r)) !== old.files[r]) problems.push(`${r}: locally modified`);
    }
    if (old?.files) for (const r of Object.keys(old.files)) if (!present.includes(r)) problems.push(`${r}: missing from the installed copy`);
    const identical = old?.engine === manifest.engine && old?.installed?.target === target && !problems.length &&
      rels.length === present.length && rels.every((r) => old.files[r] === manifest.files[r]);
    if (identical) return { dest, status: 'unchanged', files: rels.length + 1 };
    if (problems.length && !force) {
      throw new InstallError(`refusing to overwrite ${dest}; resolve or pass --force:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    }
  }

  // Temp and aside siblings are dot-prefixed: each holds a SKILL.md, and a host must never discover one as a duplicate
  // skill. A crash can leave them behind, so the next install clears any stale ones first.
  const parent = dirname(dest);
  const base = `.${basename(dest)}`;
  try {
    for (const n of readdirSync(parent)) if (n.startsWith(`${base}.tmp-`) || n.startsWith(`${base}.old-`)) rmSync(join(parent, n), { recursive: true, force: true });
  } catch { /* parent not created yet */ }
  const tmp = join(parent, `${base}.tmp-${process.pid}`);
  try {
    for (const r of rels) {
      mkdirSync(dirname(join(tmp, r)), { recursive: true });
      copyFileSync(join(src, r), join(tmp, r));
    }
    const doc = { ...manifest, installed: { target, from, at: now() } };
    writeFileSync(join(tmp, 'ENGINE.json'), `${JSON.stringify(doc, null, 2)}\n`);
    mkdirSync(parent, { recursive: true });
    const aside = join(parent, `${base}.old-${process.pid}`);
    if (existing) renameSync(dest, aside);
    try { renameSync(tmp, dest); } catch (e) { if (existing) renameSync(aside, dest); throw e; }
    // The swap is complete: a failure to remove the aside copy is cleanup, not an install failure.
    if (existing) { try { rmSync(aside, { recursive: true, force: true }); } catch { /* the next install clears it */ } }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return { dest, status: existing ? 'upgraded' : 'installed', files: rels.length + 1 };
}
