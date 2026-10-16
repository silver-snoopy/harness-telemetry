#!/usr/bin/env node
// scope-hook.mjs — the Claude Code hook moments that make the work-scope
// contract self-enforcing (see scripts/work-scope.mjs for the record itself).
//
//   --announce       SessionStart (sync): print ONE context line carrying the
//                    session id + how to declare scope — the model cannot name
//                    its scope file without the id, and injection is the only
//                    reliable delivery. On resume/clear it prints the existing
//                    scope digest instead, so an in-flight batch survives
//                    context resets. Also sweeps stale marker files.
//   --mark-dispatch  PreToolUse, matcher "Agent|Workflow" (async): touch a
//                    marker meaning "this session dispatched work". Matcher
//                    covers BOTH dispatch styles — sequential Agent-tool calls
//                    AND a Workflow-tool run (whose inner agents never pass
//                    through the Agent tool).
//   --gate           Stop (sync): if work was dispatched but no scope exists,
//                    block the turn end ONCE with instructions. A one-time nag:
//                    marker files (.nagged-<sid>) and the payload's own
//                    stop_hook_active flag both prevent loops. Sessions that
//                    never dispatch are never bothered.
//
// THREE RULES, same as workflow-return.mjs: never write stdout except the
// documented output; never exit non-zero; never block the host on stdin (the
// runtime can leave hook stdin open — bounded read, field-verified).
//
// Copilot CLI has the same three moments (hooks-reference: `sessionStart`
// injects additionalContext, `subagentStart` fires per dispatch, `agentStop`
// blocks with the same decision/reason shape) — only the OUTPUT ENCODING
// differs: Copilot parses hook stdout as JSON, Claude's SessionStart injects
// raw text. `--json` selects the Copilot encoding; the decision logic is one
// code path. Payloads differ only in casing (sessionId vs session_id — both
// read). `open --session auto` remains the fallback for anything older.
// STDLIB ONLY.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSettings, telemetryDir, B1_DEFAULTS, b1RatioIntents, words } from '../engine/config.mjs';
import { hook, loadExtension } from '../engine/extension.mjs';
import { migrationOn } from '../engine/migrations.mjs';
import { isMain, exitAfterDrain } from '../engine/entry.mjs';
import { engineRootOf, entryPointsOn, gateOrExplain } from '../engine/activation.mjs';
import { recordFired } from '../engine/probe.mjs';
import { currentManifest } from '../engine/manifest.mjs';
import { hostFromEnv, locateScope } from '../engine/scopes.mjs';

const ENGINE_ROOT = engineRootOf(import.meta.url);

const MARKER_TTL_DAYS = 7;
/**
 * SUGGESTED intents, not a validated enum — `intent` stays an open string so a
 * project (or another factory: manual-qa) can label work its own way. The
 * suggestion exists so sessions don't all collapse into "other", which tells
 * you nothing about where the money went. Only the ratio intents feed the
 * cost-per-case figures (the current manifest's under report-windows, `ratioIntentsOf`;
 * else `b1RatioIntents(settings)`); every other label simply reports its own spend.
 */
const OTHER_INTENTS = ['manual-testing', 'investigation', 'framework', 'onboarding', 'docs', 'other'];
/** Suggested labels: the ratio intent(s) first, then the open-ended rest. */
export const suggestedIntents = (settings, ratioIntents = b1RatioIntents(settings)) => [...ratioIntents, ...OTHER_INTENTS];
/** The B1 suggestion list (`B1_DEFAULTS`' ratio intents first), kept as an export; the hook itself suggests from
 * `ratioIntentsOf(repo, settings)`, so under report-windows its list follows the current manifest. */
export const INTENTS = suggestedIntents(B1_DEFAULTS);
/** The ratio intents a new line will be read with: the current manifest's under report-windows (map D1; the implied
 * manifest without a module.json, possibly an empty set), else `settings.ratioIntents` (B1). */
export function ratioIntentsOf(repo, settings) {
  if (!migrationOn('report-windows')) return b1RatioIntents(settings);
  const ri = currentManifest(telemetryDir(repo, settings)).ratioIntents;
  return Array.isArray(ri) ? ri : [];
}
/** The intent the ask names for group work: the first ratio intent, or the default intent when the manifest names
 * none — then the ask never claims that it feeds the ratio (review M4). */
const groupIntent = (ri, settings) => ri[0] ?? settings.intents.default;

/** The scopes root: the flat record (reference) and the hook's marker files live here. */
export function scopesDir(repo, settings = loadSettings(repo)) { return join(telemetryDir(repo, settings), 'scopes'); }
const safeSid = (id) => String(id || '').replace(/[^A-Za-z0-9._-]/g, '');
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
/** The session's declared record: under scope-resolution `<host>/<sid>.json`, else the legacy flat record when it is
 * the only one (§14.11; the host defaults from the environment, owner Q12a); the flat record otherwise. */
function readScope(repo, settings, sid, host) {
  return readScopeAt(repo, settings, sid, host).scope;
}
/** readScope plus the id's record locations when they are ambiguous (scope-resolution; review round 1, M5). */
function readScopeAt(repo, settings, sid, host) {
  if (!migrationOn('scope-resolution')) return { scope: readJson(join(scopesDir(repo, settings), `${sid}.json`)), ambiguous: [] };
  try {
    const { path, ambiguous } = locateScope(telemetryDir(repo, settings), host, sid);
    return { scope: path ? readJson(path) : null, ambiguous };
  } catch { return { scope: null, ambiguous: [] }; }
}
/** ` --host <h>` for the suggested `open` when the host is known (scope-resolution; review round 1, I1/M3). */
const hostFlag = (host) => (migrationOn('scope-resolution') && host ? ` --host ${host}` : '');

/** The installed skill's scripts/work-scope.mjs, repo-relative when inside. */
export function scopeScriptPath(repo, scriptUrl = import.meta.url) {
  const abs = join(dirname(dirname(fileURLToPath(scriptUrl))), 'scripts', 'work-scope.mjs');
  const rel = relative(repo, abs);
  return rel.startsWith('..') ? abs : rel.split('\\').join('/');
}

/** One context line. Scope exists → digest (resume/clear survival); none → the ask. */
export function announceLine(repo, sessionId, scriptUrl = import.meta.url, settings = loadSettings(repo), host = hostFromEnv()) {
  const sid = safeSid(sessionId);
  if (!sid) return null;
  const w = words(settings);
  const ri = ratioIntentsOf(repo, settings);
  const scope = readScope(repo, settings, sid, host);
  if (scope) {
    return `tokenomics scope [session ${sid}]: ${scope.intent}${scope.batch ? ` / ${w.group} ${scope.batch}` : ''} — ${scope.cases.length} ${w.item}(s)`
      + `${scope.outcomes ? `, ${Object.keys(scope.outcomes).length} outcome(s)` : ''}${scope.closedAt ? ' (closed)' : ''}. Update via \`node ${scopeScriptPath(repo, scriptUrl)}\`.`;
  }
  return `tokenomics [session ${sid}]: declare what this session is for — `
    + `\`node ${scopeScriptPath(repo, scriptUrl)} open --session ${sid}${hostFlag(host)} --intent <intent> [--batch <slug> --cases <ID,ID,…>]\`. `
    + `${w.Group} work: \`--intent ${groupIntent(ri, settings)}\` WITH ${w.group} + ${w.items} (${ri.length ? 'only this intent feeds' : 'the current manifest names no ratio intent, so no intent feeds'} cost-per-${w.item}). Anything else: pick the honest label — `
    + `${suggestedIntents(settings, ri).filter((i) => !ri.includes(i)).join(', ')} — or your own; no ${w.group}/${w.items} needed. Then record results as they become true: `
    + `\`… outcome --session ${sid} <ID>=<outcome>\`.`;
}

export function markDispatch(repo, sessionId, settings = loadSettings(repo)) {
  const sid = safeSid(sessionId);
  if (!sid) return null;
  const dir = scopesDir(repo, settings);
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, `.pending-${sid}`);
  writeFileSync(marker, '');
  return marker;
}

/**
 * Stop decision — TWO one-time nudges, both host- and mode-independent (they
 * only read files, so they hold for a Workflow run, a sequential dispatch loop,
 * Claude or Copilot):
 *
 *   1. work was dispatched and NO scope was declared      → declare it
 *   2. the extension's second gate (stopGateCheck — TA: the batch has a
 *      receipt but the scope is still open → run `close`, which records
 *      outcomes, renders the batch report and cross-checks the receipt)
 *
 * (2) exists because a lead reliably does the git half of closing and then
 * writes its own summary in chat — measured on a real batch: scope declared,
 * outcomes recorded, merged, cleaned up… and no report, because nothing asked.
 * Declaring got done precisely because (1) asked.
 *
 * Returns the hook-output object, or null for "say nothing, allow the stop".
 */
export function gateDecision(repo, payload, scriptUrl = import.meta.url, settings = loadSettings(repo), ext = null, host = hostFromEnv()) {
  const sid = safeSid(payload?.session_id ?? payload?.sessionId);
  if (!sid) return null;
  if (payload?.stop_hook_active) return null;              // we already blocked this chain
  const dir = scopesDir(repo, settings);
  const w = words(settings);
  const { scope, ambiguous } = readScopeAt(repo, settings, sid, host);
  const askedOnce = (kind) => {
    const marker = join(dir, `.${kind}-${sid}`);
    if (existsSync(marker)) return true;
    try { writeFileSync(marker, ''); return false; } catch { return true; } // can't record → don't loop
  };

  if (!scope) {
    if (!existsSync(join(dir, `.pending-${sid}`))) return null;  // no work dispatched
    if (askedOnce('nagged')) return null;
    // scope-resolution (review round 1, M5): records in more than one place are not "no scope" — say so, and never
    // suggest an `open` that would add another location
    if (ambiguous.length) {
      return {
        decision: 'block',
        reason: `This session's scope is ambiguous: ${sid} has records at ${ambiguous.join(', ')} (under ${scopesDir(repo, settings)}), `
          + `${host ? `none of them this host's (${host}) — ` : ''}they are never merged, so none is stamped on its ledger line. `
          + 'Keep the one record that is this session\'s, under its host\'s directory, and remove the others. Then finish your reply.',
      };
    }
    const ri = ratioIntentsOf(repo, settings);
    return {
      decision: 'block',
      reason: `This session dispatched work but declared no scope. Run \`node ${scopeScriptPath(repo, scriptUrl)} open --session ${sid}${hostFlag(host)} `
        + `--intent ${groupIntent(ri, settings)} --batch <slug> --cases <ID,ID,…>\` for ${w.group} work — or, for anything else, the same command with the honest label and no ${w.group}/${w.items} `
        + `(${suggestedIntents(settings, ri).filter((i) => !ri.includes(i)).join(' / ')}, or your own). Then finish your reply.`,
    };
  }

  // The extension's second gate (TA: the batch wrote its receipt, the scope is still open → close).
  return hook(ext, 'stopGateCheck', scope, { repo, settings, sid, askedOnce, scriptPath: scopeScriptPath(repo, scriptUrl) }) ?? null;
}

/** Markers from sessions that died before cleanup — swept on announce. */
export function sweepMarkers(repo, { ttlDays = MARKER_TTL_DAYS, now = Date.now() } = {}, settings = loadSettings(repo)) {
  const dir = scopesDir(repo, settings);
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!/^\.(pending|nagged|unclosed)-/.test(name)) continue;
    try {
      if (now - statSync(join(dir, name)).mtimeMs > ttlDays * 86_400_000) {
        rmSync(join(dir, name));
        removed++;
      }
    } catch { /* raced away — fine */ }
  }
  return removed;
}

/** Bounded stdin read — the runtime can leave hook stdin open (field-verified). */
export function readStdinBounded(ms = 2000) {
  return new Promise((resolveP) => {
    let buf = '';
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolveP(buf); } };
    const timer = setTimeout(finish, ms);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => {
        buf += d;
        try { JSON.parse(buf); finish(); } catch { /* incomplete — keep reading */ }
      });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch { finish(); }
  });
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let payload = null;
  try { payload = JSON.parse(await readStdinBounded()); } catch { /* not JSON — every mode tolerates it */ }
  // D-PROBE: the fired record comes first, before the gate — an inert hook still proves it fired. It follows the stdin
  // read only so that it can carry the host's event name and the session id (R21, R22).
  recordFired('scope-hook', argv, env, payload);
  // Copilot delivers the workspace in the payload; Claude in the env.
  const repo = payload?.cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (!gateOrExplain(ENGINE_ROOT, repo, env)) return; // activation (D-ACT): inert or refused reads and writes nothing
  // Invalid settings / an unloadable extension: name the error on stderr and still exit 0 (a hook never
  // breaks the host). Only the load phase reports; later failures stay silent as in the reference.
  let settings, ext;
  try { settings = loadSettings(repo); ext = await loadExtension(settings, repo); }
  catch (e) { process.stderr.write(`${e.message}\n`); return; }
  const sid = payload?.session_id ?? payload?.sessionId ?? null;
  const asJson = argv.includes('--json'); // Copilot parses stdout as JSON; Claude injects raw text

  if (argv.includes('--announce')) {
    sweepMarkers(repo, {}, settings);
    const line = announceLine(repo, sid, undefined, settings, hostFromEnv(env));
    if (line) process.stdout.write(asJson ? JSON.stringify({ additionalContext: line }) : `${line}\n`);
    return;
  }
  if (argv.includes('--mark-dispatch')) {
    markDispatch(repo, sid, settings);
    return;
  }
  if (argv.includes('--gate')) {
    const out = gateDecision(repo, payload, undefined, settings, ext, hostFromEnv(env));
    if (out) process.stdout.write(JSON.stringify(out)); // decision/reason — same shape both hosts
    return;
  }
}

const entryOn = entryPointsOn(ENGINE_ROOT); // items 12/13: realpath main guard, exit after stdio drains (a refused copy never parses the variable)
const exit_ = entryOn ? exitAfterDrain : (c) => process.exit(c);
if (entryOn ? isMain(import.meta.url) : (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().then(() => exit_(0), () => exit_(0)); // a telemetry hook never breaks the host
}
