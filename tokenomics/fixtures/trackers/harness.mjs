// Test kit for the work-item tracker tests (Plan 7, D-TESTKIT). Test-only; excluded from ENGINE.json like the other
// fixtures. STDLIB ONLY.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** CLIs a test must never reach for real, on any OS: GitHub's Ubuntu runners ship gh in /usr/bin. */
export const HIDDEN_CLIS = Object.freeze(['gh', 'az', 'claude', 'copilot']);
const SYSTEM_DIRS = ['/usr/bin', '/bin'];

/**
 * Build `<parent>/tools`: a symlink `node` to `node` (default process.execPath) plus a symlink to every entry of
 * `sources` (default /usr/bin and /bin; the first dir wins a duplicate name, so /bin -> /usr/bin adds nothing), except
 * HIDDEN_CLIS. Returns the directory; the same directory is returned for the same parent and sources, built once.
 */
const toolsDirs = new Map();
export function buildToolsDir(parent, { sources = SYSTEM_DIRS, node = process.execPath } = {}) {
  const dir = join(parent, 'tools');
  const key = `${dir}\0${sources.join('\0')}\0${node}`;
  if (toolsDirs.has(key)) return dir;
  mkdirSync(dir, { recursive: true });
  const seen = new Set(HIDDEN_CLIS);
  const link = (name, target) => { seen.add(name); symlinkSync(target, join(dir, name)); };
  link('node', node);
  for (const src of sources) {
    let names;
    try { names = readdirSync(src); } catch { continue; }
    for (const name of names) if (!seen.has(name)) link(name, join(src, name));
  }
  toolsDirs.set(key, true);
  return dir;
}

/**
 * A fresh, hermetic child environment: a new object, never a spread of process.env. PATH is the fake bin, then a tools
 * dir under `tmp` (node and the system tools, never gh/az/claude/copilot; see buildToolsDir). HOME, COPILOT_HOME and
 * the tool config dirs live under `tmp`; git reads only `tmp/gitconfig`. No credentials: tests that need them add
 * dummy sentinel values themselves.
 */
export function sandboxEnv(tmp, { bin } = {}) {
  return {
    PATH: [bin, buildToolsDir(tmp)].filter(Boolean).join(':'),
    HOME: join(tmp, 'home'),
    COPILOT_HOME: join(tmp, 'home', '.copilot'),
    XDG_CONFIG_HOME: join(tmp, 'xdg'),
    GH_CONFIG_DIR: join(tmp, 'gh'),
    AZURE_CONFIG_DIR: join(tmp, 'az'),
    GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GH_PROMPT_DISABLED: '1',
    NO_COLOR: '1',
  };
}

/** Write an executable `bin/<name>` whose body is the JavaScript `js`, run by the real node (process.execPath). */
export function fakeBin(bin, name, js) {
  mkdirSync(bin, { recursive: true });
  const path = join(bin, name);
  writeFileSync(path, `#!${process.execPath}\n${js}\n`, { mode: 0o755 });
  return path;
}

/**
 * A fake CLI `bin/<name>`: appends its argv (one JSON array per call) to `argvLog`, prints `stdout`, exits `code`.
 * `stdout` may be a function source `(argv) => string` (as a string starting with `(`) for argv-dependent answers.
 */
export function fakeCli(bin, name, { stdout = '', code = 0, argvLog } = {}) {
  const answer = typeof stdout === 'string' && stdout.startsWith('(') ? stdout : JSON.stringify(String(stdout));
  return fakeBin(bin, name, [
    "const fs = require('fs');",
    'const argv = process.argv.slice(2);',
    argvLog ? `fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(argv) + '\\n');` : '',
    `const a = ${answer};`,
    "process.stdout.write(typeof a === 'function' ? String(a(argv)) : a);",
    `process.exitCode = ${Number(code)};`,
  ].join('\n'));
}

/** The argv arrays a fakeCli recorded, in call order. */
export const readArgv = (argvLog) => (existsSync(argvLog) ? readFileSync(argvLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));

/**
 * Spawn `node server.mjs <routesModule> <dir>/requests.jsonl` as a CHILD process (never in-process, so a synchronous
 * spawnSync receipt runner cannot deadlock against it). Resolves `{url, logPath, log(), stop()}` once the child prints
 * its port. `log()` returns the recorded requests `{method, path, headers, body}`; `stop()` kills the child.
 */
export function startServer(routesModule, { dir } = {}) {
  const d = dir ?? mkdtempSync(join(tmpdir(), 'ht-srv-'));
  mkdirSync(d, { recursive: true });
  const logPath = join(d, 'requests.jsonl');
  const child = spawn(process.execPath, [SERVER, resolve(routesModule), logPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((res) => child.once('exit', res));
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; };
  return new Promise((res, rej) => {
    let buf = '';
    let err = '';
    let settled = false;
    const onData = (c) => {
      buf += c;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      settle();
      let port;
      try { ({ port } = JSON.parse(buf.slice(0, nl))); } catch { port = undefined; }
      if (!Number.isInteger(port)) { stop().then(() => rej(new Error(`server: bad ready line ${JSON.stringify(buf.slice(0, nl).slice(0, 80))}`))); return; }
      res({
        url: `http://127.0.0.1:${port}`,
        logPath,
        log: () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
        stop,
      });
    };
    const onExit = (code, signal) => { if (settle()) rej(new Error(`server exited before ready (${code ?? signal}): ${err.trim().split('\n')[0] ?? ''}`)); };
    const onError = (e) => { if (settle()) { stop().then(() => rej(e)); } };
    // Settle once: after the ready line (or a failure) no handler runs again.
    function settle() {
      if (settled) return false;
      settled = true;
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      child.stdout.resume();
      return true;
    }
    child.stderr.on('data', (c) => { if (!settled) err += c; });
    child.on('error', onError);
    child.on('exit', onExit);
    child.stdout.on('data', onData);
  });
}

// The D-TESTKIT sentinels: dummy credentials tests may put in a sandbox env, and private strings fixtures may embed.
export const SENTINEL = Object.freeze({
  PAT: 'SENTINEL-PAT-7f3a',
  EMAIL: 'sentinel-7f3a@example.invalid',
  TOKEN: 'SENTINEL-TOKEN-7f3a',
});
const b64 = (s) => Buffer.from(s).toString('base64');
export const SENTINELS = Object.freeze([
  SENTINEL.PAT, b64(`:${SENTINEL.PAT}`), SENTINEL.TOKEN, b64(`${SENTINEL.EMAIL}:${SENTINEL.TOKEN}`),
  'PRIVATE_TITLE', 'PRIVATE_PERSON', 'PRIVATE_BRANCH',
]);

/** Throw naming the first sentinel found in any of `strings` (stdout, stderr, written files, recorded argv). */
export function assertNoSentinels(strings) {
  strings.forEach((s, i) => {
    const text = typeof s === 'string' ? s : JSON.stringify(s);
    for (const x of SENTINELS) if (text?.includes(x)) throw new Error(`sentinel '${x}' leaked in input ${i}`);
  });
}
