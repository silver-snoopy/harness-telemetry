// Keys whose string value is structural. A value is kept ONLY if it also matches the key's
// pattern; anything else is masked like free text (so a free-text `name` cannot ride along).
const ID = /^[A-Za-z0-9_.:-]+$/;
export const KEEP_PATTERNS = {
  id: ID, uuid: ID, parentUuid: ID, sessionId: ID, requestId: ID, agentId: ID, tool_use_id: ID, messageId: ID,
  type: /^[a-z_.-]+$/, role: /^[a-z_-]+$/, speed: /^[a-z_-]+$/,
  model: /^(<synthetic>|[A-Za-z0-9._-]+)$/, // `<synthetic>` is Claude's own marker for locally-generated turns
  version: /^[A-Za-z0-9._-]+$/,
  agentType: /^[A-Za-z0-9:_.-]+$/, subagent_type: /^[A-Za-z0-9:_.-]+$/, skill: /^[A-Za-z0-9:_.-]+$/, agentSetting: /^[A-Za-z0-9:_.-]+$/,
  timestamp: /^[0-9TZ:.+-]+$/,
  name: /^(mcp__)?[A-Za-z0-9_-]+(__[A-Za-z0-9_.-]+)*$/,
};
// Kept verbatim by ruling: the git branch (cwd is rewritten to {repo} by the case builder).
const VERBATIM_KEYS = new Set(['gitBranch', 'cwd']);

/** True when `value` under `key` may stay verbatim. `name` additionally needs a tool_use object or a `tools` element. */
export function keepString(key, value, { toolContext = false } = {}) {
  if (VERBATIM_KEYS.has(key)) return true;
  const re = KEEP_PATTERNS[key];
  if (!re || !re.test(value)) return false;
  return key === 'name' ? toolContext : true;
}

// Inside any object reached through a key named `input`, only these keys keep their string value.
const INPUT_KEEP_KEYS = new Set(['subagent_type', 'skill']);

// Works per UTF-16 code unit so that `length` and `indexOf` offsets agree.
// Every non-whitespace unit (including each half of a surrogate pair and every
// character of an absolute path) becomes `x`. A leading `<` of the original
// text is kept so skip rules still apply.
export function sanitizeText(text, keepIds) {
  if (typeof text !== 'string' || !text) return text;
  const chars = text.split('').map((c, i) => ((i === 0 && c === '<') || /\s/.test(c) ? c : 'x'));
  for (const id of keepIds) {
    if (typeof id !== 'string' || id.length === 0) continue;
    let i = text.indexOf(id);
    while (i !== -1) {
      const j = i + id.length;
      // Only at word boundaries: an id inside an unrelated word (`main` in `domain`) stays masked.
      if ((i === 0 || /\W/.test(text[i - 1])) && (j >= text.length || /\W/.test(text[j]))) {
        for (let k = 0; k < id.length; k++) chars[i + k] = id[k];
        // The adjacent non-word character stays too: the miner's \b boundaries must still see the id.
        if (i > 0) chars[i - 1] = text[i - 1];
        if (j < text.length) chars[j] = text[j];
      }
      i = text.indexOf(id, i + 1);
    }
  }
  return chars.join('');
}

// Object KEYS can carry free text (e.g. a question → answer map). Schema keys are
// short identifiers and stay; anything else (spaces, punctuation, long text) is masked
// like a string. Residual risk: a bare one-word key survives.
const SCHEMA_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
function maskKey(k, keepIds) {
  if (SCHEMA_KEY.test(k)) return k;
  return sanitizeText(k, keepIds);
}
// Masking can make two keys equal; keep both entries (same length) by varying leading characters.
function uniqueKey(k, used) {
  let out = k;
  for (let n = 1; used.has(out) && n < 36 ** Math.min(k.length, 4); n++) {
    const tag = n.toString(36).padStart(Math.min(k.length, 4), '0');
    out = tag + k.slice(tag.length);
  }
  if (used.has(out)) throw new Error(`sanitize: cannot keep masked key distinct (${k.length} chars)`);
  used.add(out);
  return out;
}

export function sanitizeValue(v, keepIds, key = null, inInput = false, ctx = {}) {
  if (Array.isArray(v)) return v.map((x) => sanitizeValue(x, keepIds, null, inInput, { inTools: key === 'tools' }));
  if (v && typeof v === 'object') {
    const used = new Set();
    const toolContext = v.type === 'tool_use' || ctx.inTools === true;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [uniqueKey(maskKey(k, keepIds), used), sanitizeValue(x, keepIds, k, inInput || k === 'input', { toolContext })]));
  }
  if (typeof v === 'string') {
    if (inInput) return key && INPUT_KEEP_KEYS.has(key) && keepString(key, v) ? v : sanitizeText(v, keepIds);
    if (key && keepString(key, v, { toolContext: ctx.toolContext })) return v;
    return sanitizeText(v, keepIds);
  }
  return v;
}

export const sanitizeRecord = (rec, { keepIds }) => sanitizeValue(rec, keepIds);
export const sanitizeCopilotEvent = (ev, { keepIds }) => sanitizeValue(ev, keepIds);
