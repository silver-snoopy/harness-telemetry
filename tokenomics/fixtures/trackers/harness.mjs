// Test kit for the work-item tracker tests (Plan 7, D-TESTKIT). Test-only; excluded from ENGINE.json like the other
// fixtures. STDLIB ONLY.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A fresh, hermetic child environment: a new object, never a spread of process.env. PATH is the fake bin, the real
 * node's directory, and the system dirs. HOME, COPILOT_HOME and the tool config dirs live under `tmp`; git reads only
 * `tmp/gitconfig`. No credentials: tests that need them add dummy sentinel values themselves.
 */
export function sandboxEnv(tmp, { bin } = {}) {
  return {
    PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].filter(Boolean).join(':'),
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
  return new Promise((res, rej) => {
    let buf = '';
    let err = '';
    child.stderr.on('data', (c) => { err += c; });
    child.once('error', rej);
    child.once('exit', (code) => rej(new Error(`server exited early (${code}): ${err.trim()}`)));
    child.stdout.on('data', (c) => {
      buf += c;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const { port } = JSON.parse(buf.slice(0, nl));
      res({
        url: `http://127.0.0.1:${port}`,
        logPath,
        log: () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
        stop: async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; },
      });
    });
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
