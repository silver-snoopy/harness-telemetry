// module-manifest.mjs — the module's manifest, written on activation (Plan 5 D-MAN, spec §14.4).
//
// `<telemetry dir>/module.json` is the current manifest; `<telemetry dir>/manifests/<N>.json` is revision N's archive,
// the same document, retained forever (readers bind every stamped line to its revision's archive, map D1/Q11b).
//   - neither exists: revision 1 is written to both;
//   - module.json exists: it is never rewritten. Its archive is written if missing (the same bytes). A difference from
//     settings is returned as `mismatch` and left alone, unless `update` is set: then revision N+1 is written to its
//     archive and to module.json;
//   - archives without a module.json, or a module.json that is unreadable or fails the kit schema: refused.
// Every document written is validated against `kit/schemas/module.json` first. STDLIB ONLY.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSchemas, validate } from '../kit/schema.mjs';
import { canonical } from '../kit/canonical.mjs';

export class ModuleManifestError extends Error {
  constructor(code, message) {
    super(`tokenomics: ${code}: ${message}`);
    this.name = 'ModuleManifestError';
    this.code = code;
  }
}

/** The D-MAN document for `settings` at `revision`. */
export function manifestFromSettings(settings, revision) {
  const r = settings.receipts;
  return {
    module: 'tokenomics',
    schema_version: '1',
    domain: settings.dir,
    manifestRevision: revision,
    receipts: { source: 'files', root: r.root, file: r.file, deliveredOutcomes: [...r.deliveredOutcomes] },
    ratioIntents: [settings.intents.default],
  };
}

// The compared fields, named as a mismatch reports them. manifestRevision is the document's identity, not content.
const FIELDS = [
  ['module', (d) => d.module], ['schema_version', (d) => d.schema_version], ['domain', (d) => d.domain],
  ['receipts.source', (d) => d.receipts?.source], ['receipts.root', (d) => d.receipts?.root],
  ['receipts.file', (d) => d.receipts?.file], ['receipts.deliveredOutcomes', (d) => d.receipts?.deliveredOutcomes],
  ['ratioIntents', (d) => d.ratioIntents],
];
const differences = (a, b) => FIELDS.filter(([, get]) => canonical(get(a) ?? null) !== canonical(get(b) ?? null)).map(([name]) => name);

const text = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

function checked(doc, what) {
  const schemas = loadSchemas();
  const errs = validate(schemas['module.json'], doc, { schemas });
  if (errs.length) throw new ModuleManifestError('manifest-invalid', `${what} fails kit/schemas/module.json: ${errs.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return doc;
}

// Write-then-rename, so a reader never sees half a manifest.
function put(path, body) {
  const partial = `${path}.partial-${process.pid}`;
  try {
    writeFileSync(partial, body);
    renameSync(partial, path);
  } catch (e) { rmSync(partial, { force: true }); throw e; }
}

/**
 * Ensure the module manifest of `telemetryDir` for `settings`.
 * @returns {{revision: number, written: boolean, mismatch: string[]}}
 */
export function ensureModuleManifest(telemetryDir, settings, { update = false } = {}) {
  const current = join(telemetryDir, 'module.json');
  const archives = join(telemetryDir, 'manifests');
  const archive = (n) => join(archives, `${n}.json`);

  if (!existsSync(current)) {
    const present = existsSync(archives) ? readdirSync(archives).filter((n) => n.endsWith('.json')) : [];
    if (present.length) {
      throw new ModuleManifestError('manifest-current-missing', `${archives} holds ${present.sort().join(', ')} but ${current} is missing; restore module.json from the latest archive (it is never recreated as revision 1)`);
    }
    const body = text(checked(manifestFromSettings(settings, 1), 'the revision 1 manifest'));
    mkdirSync(archives, { recursive: true });
    put(archive(1), body);
    put(current, body);
    return { revision: 1, written: true, mismatch: [] };
  }

  let raw;
  let doc;
  try { raw = readFileSync(current, 'utf8'); doc = JSON.parse(raw); } catch (e) {
    throw new ModuleManifestError('manifest-unreadable', `${current} cannot be read: ${e.message}; fix or restore it from ${archives}`);
  }
  checked(doc, current);
  const n = doc.manifestRevision;
  let written = false;
  if (!existsSync(archive(n))) {
    mkdirSync(archives, { recursive: true });
    put(archive(n), raw); // the archive IS the current document, byte for byte
    written = true;
  }
  const mismatch = differences(doc, manifestFromSettings(settings, n));
  if (!mismatch.length || !update) return { revision: n, written, mismatch };

  const next = n + 1;
  if (existsSync(archive(next))) {
    throw new ModuleManifestError('manifest-archive-exists', `${archive(next)} already exists while module.json is revision ${n}; an archive is never rewritten — move it aside or restore module.json from it`);
  }
  const body = text(checked(manifestFromSettings(settings, next), `the revision ${next} manifest`));
  put(archive(next), body);
  put(current, body);
  return { revision: next, written: true, mismatch };
}
