import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SCRUB_TOKENS } from './sandbox.mjs';

const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/** A file map: a null-prototype object built from `[path, content]` pairs (Codex P3P-01). Every legal filename,
 * `__proto__`, `constructor` and `toString` included, is an ordinary own key; test membership with Object.hasOwn. */
export const fileMap = (entries = []) => {
  const out = Object.create(null);
  for (const [k, v] of entries) out[k] = v;
  return out;
};

/** The file map `m` (any object) as a new file map in path order. */
export const sortFiles = (m) => fileMap(Object.entries(m).sort(byKey));

// Byte policy (Codex B2-03): the oracle compares text, so every observed or stored file and event stream must be
// valid UTF-8. Strict decoding is a bijection between valid byte sequences and strings, so string equality is byte
// equality; bytes that are not valid UTF-8 are refused by name, never replaced with U+FFFD (two different invalid
// bytes would otherwise compare equal). ignoreBOM keeps a leading BOM in the text, as Buffer#toString does.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export const NOT_UTF8 = 'is not valid UTF-8 (the oracle compares text and never decodes bytes lossily)';

/** `buf` as text, or throw `<what> is not valid UTF-8 …` (Codex B2-03). */
export function decodeText(buf, what) {
  try { return strictUtf8.decode(buf); } catch { throw new Error(`${what} ${NOT_UTF8}`); }
}

/** A stored file (golden, after-file) as text under the same byte policy. */
export const readText = (p, what = p) => decodeText(readFileSync(p), what);

/** The selected outputs under `repoDir`, scrubbed. A file that is not valid UTF-8 is a problem pushed to
 * `problems` (or thrown, when no list is given), never lossily decoded (Codex B2-03). */
export function collect(repoDir, outputs, scrub, { problems = null } = {}) {
  const files = Object.create(null);
  const walk = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) { for (const e of readdirSync(p).sort()) { if (e === '.git') continue; walk(join(p, e)); } return; }
    const key = relative(repoDir, p).split(sep).join('/');
    let text;
    try { text = decodeText(readFileSync(p), key); } catch (err) { if (!problems) throw err; problems.push(err.message); return; }
    // B3 park 238: raw content holding a scrub token reads like a scrubbed sandbox path, so it is refused before scrubbing.
    const lit = SCRUB_TOKENS.filter((tok) => text.includes(tok));
    if (lit.length) {
      const msgs = lit.map((tok) => `${key}: content contains scrub token ${tok}: it would read as a scrubbed sandbox path`);
      if (!problems) throw new Error(msgs[0]);
      problems.push(...msgs); return;
    }
    files[key] = scrub(text);
  };
  for (const o of outputs) walk(join(repoDir, o));
  return sortFiles(files);
}
