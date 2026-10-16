// Scope records (B2 item 9 `scope-resolution`; spec §3.6, §14.11; owner Q12). Records live at
// scopes/<host>/<session>.json; a legacy flat scopes/<session>.json is still read. A pending record
// (`work-scope open --session auto`) is stamped with its host when one is known (`--host` or the environment) by
// living in that host's directory, scopes/<host>/pending-<stamp>.json, and only that host's sessions claim it
// (review round 1, M4; the scope schema allows no `host` field); a host-less one stays flat, scopes/pending-<stamp>.json,
// and any host's session may claim it. Shared by the capture (telemetry-capture.mjs re-exports resolveScope), work-scope.mjs
// and scope-hook.mjs; it imports nothing from them, so no import cycle reaches an entry point's top-level await.
// STDLIB ONLY.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, rmSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { migrationOn } from './migrations.mjs';

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

export const SCOPE_HOSTS = ['claude', 'copilot', 'copilot-vscode'];
/**
 * The `--host` default (owner Q12a; controller ruling on review round 1 I1): `copilot` when `COPILOT_CLI=1` (set
 * explicitly on every Copilot hook process by install-hooks, so it wins over an inherited Claude variable), else
 * `claude` when `CLAUDE_SESSION_ID`/`CLAUDE_PROJECT_DIR` is set, else none.
 */
export function hostFromEnv(env = process.env) {
  if (env.COPILOT_CLI === '1') return 'copilot';
  return env.CLAUDE_SESSION_ID || env.CLAUDE_PROJECT_DIR ? 'claude' : null;
}
const PENDING_WINDOW_MS = 5 * 60 * 1000;
/** Atomic write (review round 1, M2): a temp file renamed into place, so a crash never leaves a truncated record. */
const writeScopeFile = (path, obj) => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, path);
};
/** A regular file's parsed JSON, else null (missing, vanished, a directory, a symlink, unreadable or unparsable). */
const readRegular = (path) => {
  try { return lstatSync(path).isFile() ? safeParse(readFileSync(path, 'utf8')) : null; } catch { return null; }
};

/**
 * Where a session's records sit, relative to scopes/: one per host directory holding `<id>.json`, then the legacy
 * flat record. More than one place is ambiguous (§14.11) — never merged. `path` is the session's own record:
 * `<host>/<id>.json`; else the flat record when it is the only one; with `host` null, the only record anywhere.
 */
export function locateScope(telemetryDir, host, sessionId) {
  const dir = join(telemetryDir, 'scopes');
  const locs = [];
  for (const h of SCOPE_HOSTS) if (existsSync(join(dir, h, `${sessionId}.json`))) locs.push(`${h}/${sessionId}.json`);
  if (existsSync(join(dir, `${sessionId}.json`))) locs.push(`${sessionId}.json`);
  let rel = null;
  if (host && locs.includes(`${host}/${sessionId}.json`)) rel = `${host}/${sessionId}.json`;
  else if (locs.length === 1 && (!host || locs[0] === `${sessionId}.json`)) rel = locs[0];
  // review round 1 (I1): the id's only record is another host's — reported, never a silent "no scope"
  const misfiled = host && !rel && locs.length === 1 ? locs : [];
  return { path: rel && join(dir, rel), ambiguous: locs.length > 1 ? locs : [], misfiled };
}

/**
 * The record a claim writes (controller ruling on Q12c): the pending record's declaration (intent, batch, cases,
 * role, source) wins; outcomes merge — the pending record's first, then the displaced record's for ids it lacks;
 * `closedAt` is kept when either has it; `claimedFrom` names the pending record.
 */
function mergeClaim(pending, own, sessionId) {
  const merged = { ...pending, session: sessionId };
  delete merged.claimedFrom;
  if (own) {
    const outcomes = { ...(pending.outcomes ?? {}) };
    for (const [id, o] of Object.entries(own.outcomes ?? {})) if (!Object.prototype.hasOwnProperty.call(outcomes, id)) outcomes[id] = o;
    if (Object.keys(outcomes).length) merged.outcomes = outcomes;
    const closedAt = pending.closedAt ?? own.closedAt;
    if (closedAt) merged.closedAt = closedAt;
  }
  merged.claimedFrom = pending.session;
  return merged;
}

/**
 * Complete a claim a crash interrupted (owner Q12c): `<host>/<id>.json.claim` holds the renamed pending record, so no
 * second session can own it; write the merged record (unless it was already written) and remove the claim file.
 */
function completeClaim(telemetryDir, host, sessionId) {
  const dir = join(telemetryDir, 'scopes');
  const claim = join(dir, host, `${sessionId}.json.claim`);
  if (!existsSync(claim)) return;
  const pending = safeParse(readFileSync(claim, 'utf8'));
  if (!pending) return; // an unreadable claim file is left for the operator, never discarded
  const target = join(dir, host, `${sessionId}.json`);
  // the own record as the live path finds it — host-qualified, or the legacy flat one (review round 1, M1)
  const { path } = locateScope(telemetryDir, host, sessionId);
  const own = path ? safeParse(readFileSync(path, 'utf8')) : null;
  if (own?.claimedFrom !== pending.session) {   // else the merged record was written before the crash: never re-merge
    writeScopeFile(target, mergeClaim(pending, own, sessionId));
    if (path && path !== target) rmSync(path, { force: true }); // the displaced flat record is merged in
  }
  unlinkSync(claim);
}

/**
 * The scope a capture stamps for `host:sessionId` (§14.11). Precedence among initial declarations: (1) the session's
 * own record with `source: "handoff"`, (2) a pending record claimed by time window (`declaredAt` within 5 minutes of
 * [startedAt, endedAt ?? now], closest to the start — the reference window), (3) the session's own other record. A
 * record already claimed is kept. Claims are single-owner and crash-recoverable: rename the pending record to
 * `<host>/<id>.json.claim`, write the merged record, remove the claim file. Candidates are the host-less pending
 * records and this host's own (M4); an unreadable, vanished, symlinked or directory entry is skipped (review round 1,
 * I2). An unreadable store resolves to no scope (R9). `ambiguous` lists the record locations when the id has records
 * in more than one place; `misfiled` the location when its only record is another host's (I1).
 */
export function resolveScope(telemetryDir, host, sessionId, startedAtMs, { endedAtMs = null, now = Date.now() } = {}) {
  const dir = join(telemetryDir, 'scopes');
  const done = (scope) => {
    let ambiguous = [], misfiled = [];
    try { ({ ambiguous, misfiled } = locateScope(telemetryDir, host, sessionId)); } catch { /* unreadable — nothing to report */ }
    return { scope, ambiguous, ...(scope?.claimedFrom ? { claimedFrom: scope.claimedFrom } : {}), ...(!scope && misfiled.length ? { misfiled } : {}) };
  };
  try {
    if (host) completeClaim(telemetryDir, host, sessionId);
    const { path } = locateScope(telemetryDir, host, sessionId);
    const own = path ? safeParse(readFileSync(path, 'utf8')) : null;
    if (path && !own) return done(null); // an unreadable own record: no scope, never claimed over (the reference)
    if (own && (own.source === 'handoff' || own.claimedFrom)) return done(own);
    if (!host || !startedAtMs || !existsSync(dir)) return done(own);
    const lo = startedAtMs - PENDING_WINDOW_MS;
    const hi = (endedAtMs ?? now) + PENDING_WINDOW_MS;
    let best = null;
    for (const d of [dir, join(dir, host)]) {
      let names;
      try { names = readdirSync(d); } catch { if (d === dir) throw new Error('unreadable scopes store'); continue; }
      for (const name of names) {
        if (!name.startsWith('pending-') || !name.endsWith('.json')) continue;
        const s = readRegular(join(d, name));
        const at = s?.declaredAt ? Date.parse(s.declaredAt) : NaN;
        if (Number.isNaN(at) || at < lo || at > hi) continue;
        if (!best || Math.abs(at - startedAtMs) < Math.abs(best.at - startedAtMs)) best = { from: join(d, name), s, at };
      }
    }
    if (!best) return done(own);
    const claim = join(dir, host, `${sessionId}.json.claim`);
    try {
      mkdirSync(join(dir, host), { recursive: true });
      renameSync(best.from, claim);
    } catch { return done(own); } // raced (another capture owns it) or unwritable — the pending record stays
    const merged = mergeClaim(best.s, own, sessionId);
    try {
      writeScopeFile(join(dir, host, `${sessionId}.json`), merged);
      // a displaced legacy flat record is merged in; removing it keeps the id unambiguous
      if (path && path !== join(dir, host, `${sessionId}.json`)) rmSync(path, { force: true });
      unlinkSync(claim);
    } catch { /* the claim file survives: the next resolution completes it */ }
    return done(merged);
  } catch { return { scope: null, ambiguous: [] }; } // R9: an unreadable store is "no scope"; the line is still written
}

/**
 * The record a pending handle names after the capture claimed it: the one whose `claimedFrom` is the handle (a claim
 * a crash interrupted is completed first). Null when none.
 */
export function claimedScopePath(telemetryDir, handle) {
  const dir = join(telemetryDir, 'scopes');
  const list = (h) => { try { return readdirSync(join(dir, h)).sort(); } catch { return null; } };
  for (const h of SCOPE_HOSTS) {
    let names = list(h);
    if (!names) continue;
    const claims = names.filter((x) => x.endsWith('.json.claim') && readRegular(join(dir, h, x))?.session === handle);
    for (const n of claims) resolveScope(telemetryDir, h, n.slice(0, -'.json.claim'.length), null);
    if (claims.length) names = list(h) ?? [];
    for (const n of names.filter((x) => x.endsWith('.json'))) {
      if (!n.startsWith('pending-') && readRegular(join(dir, h, n))?.claimedFrom === handle) return join(dir, h, n);
    }
  }
  return null;
}

/** Where a pending handle's own (unclaimed) record sits: the flat one, else a host directory's. Null when none. */
export function pendingScopePath(telemetryDir, handle) {
  const dir = join(telemetryDir, 'scopes');
  for (const p of [join(dir, `${handle}.json`), ...SCOPE_HOSTS.map((h) => join(dir, h, `${handle}.json`))]) if (existsSync(p)) return p;
  return null;
}

/** The compact form a ledger line carries (never the timestamps — dedup noise). Shared by the capture and `work-scope restamp`. */
export function scopeForLine(scope, env = process.env) {
  if (!scope) return null;
  return {
    intent: scope.intent ?? 'undeclared',
    ...(scope.batch ? { batch: scope.batch } : {}),
    cases: scope.cases ?? [],
    ...(scope.outcomes ? { outcomes: Object.fromEntries(Object.entries(scope.outcomes).map(([id, o]) => [id, o?.outcome ?? o])) } : {}),
    // scope-resolution: the declaring orchestrator's role, stamped at capture (§3.2, §14.11)
    ...(migrationOn('scope-resolution', env) && typeof scope.role === 'string' ? { role: scope.role } : {}),
  };
}
