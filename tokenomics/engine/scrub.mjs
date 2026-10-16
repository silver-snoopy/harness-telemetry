// scrub.mjs — the anon-complete scrub set and scrubber (B2 item 5, owner Q9). Pure; no engine imports, so the
// TA extension can use it without a cycle through the export script (which re-exports both).
const ANON = 'anonymised';
const isTok = (c) => c !== undefined && /[A-Za-z0-9_-]/.test(c);

/** The scrub set (B2 anon-complete, owner Q9): every supplied identifier of the submission, collected across
 * ALL rows and the document before anything is replaced: `work_item_ref` and `work_item_brief` values (at any
 * depth), plus `extraFromExt` (the extension's group slugs and receipt paths). Longest members first. */
export function scrubSet(doc, rows = doc?.runs ?? [], extraFromExt = []) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v) out.add(v); };
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) { if (k === 'work_item_ref' || k === 'work_item_brief') add(x); walk(x); }
    }
  };
  walk(doc); walk(rows);
  for (const x of extraFromExt ?? []) add(x);
  return [...out].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

function scrubString(text, members) {
  let out = ''; let i = 0;
  while (i < text.length) {
    const m = isTok(text[i - 1]) ? undefined : members.find((k) => text.startsWith(k, i) && !isTok(text[i + k.length]));
    if (m) { out += ANON; i += m.length; } else { out += text[i]; i += 1; }
  }
  return out;
}

/** A deep copy of `value` where every string has every member of `set` replaced by `anonymised`, matched as a
 * whole token or whole path segment (boundary class [A-Za-z0-9_-], as `namesToken`), longest members first.
 * `opts.keyDepth` (default: keys untouched) also scrubs object KEYS, by the same rules, at object depth >=
 * keyDepth (the root object is depth 0), so structural keys of the document and of a row are never renamed.
 * Collision policy: keys that scrub to the same text are never merged; an untouched key keeps its name, and a
 * changed key becomes `anonymised`, then `anonymised-2`, `anonymised-3`... in insertion order (deterministic).
 * `opts.keepKeys` (a Set): schema keys that are never renamed at any depth (their values are still scrubbed), so an
 * over-broad member (a nested slug's last segment such as `output`) cannot corrupt the document schema. */
export function scrubStrings(value, set, opts = {}) {
  const members = [...new Set(set ?? [])].filter((k) => typeof k === 'string' && k).sort((a, b) => b.length - a.length);
  const keyDepth = opts.keyDepth ?? Infinity;
  const keep = opts.keepKeys ?? new Set();
  const go = (v, depth) => {
    if (typeof v === 'string') return members.length ? scrubString(v, members) : v;
    if (Array.isArray(v)) return v.map((x) => go(x, depth));
    if (v && typeof v === 'object') {
      const entries = Object.entries(v);
      const names = entries.map(([k]) => (depth >= keyDepth && members.length && !keep.has(k) ? scrubString(k, members) : k));
      const taken = new Set(entries.filter(([k], i) => names[i] === k).map(([k]) => k));
      const out = {};
      entries.forEach(([k, x], i) => {
        let name = names[i];
        if (name !== k) { for (let n = 2; taken.has(name); n += 1) name = `${names[i]}-${n}`; taken.add(name); }
        Object.defineProperty(out, name, { value: go(x, depth + 1), enumerable: true, writable: true, configurable: true });
      });
      return out;
    }
    return v;
  };
  return go(value, 0);
}
