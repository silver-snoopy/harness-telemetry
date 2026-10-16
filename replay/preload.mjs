// Loaded with NODE_OPTIONS=--import=… into every replayed node process.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
// Freezes wall-clock and entropy so a replay is byte-reproducible.
// Every Date.now()/new Date() within one event returns exactly HT_NOW (no tick):
// elapsed-time arithmetic inside an event is 0, timestamps carry HT_NOW verbatim.
const now0 = Date.parse(process.env.HT_NOW ?? '');
if (!Number.isNaN(now0)) {
  const frozenNow = () => now0;
  const RealDate = Date;
  function FrozenDate(...args) {
    if (!new.target) return new RealDate(frozenNow()).toString();
    return args.length === 0 ? new RealDate(frozenNow()) : new RealDate(...args);
  }
  FrozenDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(FrozenDate, RealDate); // Date.parse / Date.UTC inherited
  FrozenDate.now = () => frozenNow();
  Object.defineProperty(FrozenDate, 'name', { value: 'Date' });
  globalThis.Date = FrozenDate;
}
// Blocking stdio: Node documents pipes and sockets as asynchronous on POSIX and synchronous on Windows (files are
// synchronous on both), so output is lost if process.exit() runs before an asynchronous write completes (seen as
// truncation at the pipe buffer on macOS). Blocking stdio makes every replayed write complete first.
process.stdout._handle?.setBlocking?.(true);
process.stderr._handle?.setBlocking?.(true);
// Opt-in (event env HT_PLATFORM): replay a platform-only branch (e.g. a darwin path probe) on any host.
if (process.env.HT_PLATFORM) Object.defineProperty(process, 'platform', { value: process.env.HT_PLATFORM, configurable: true, enumerable: true });
const seed0 = Number.parseInt(process.env.HT_SEED ?? '', 10);
if (Number.isFinite(seed0)) {
  let a = seed0 >>> 0;
  Math.random = () => { // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// No network inside a replay (ruling F3): every outbound path throws. Inert outside replay (HT_NOW unset).
if (!Number.isNaN(now0)) {
  const blocked = () => { throw new Error('network disabled in replay'); };
  globalThis.fetch = blocked;
  for (const mod of [http, https]) { mod.request = blocked; mod.get = blocked; }
  net.connect = blocked; net.createConnection = blocked;
  tls.connect = blocked;
  syncBuiltinESMExports(); // `import { request } from 'node:http'` sees the patched bindings too
}

// Deterministic directory listings (final review F3, map §3 R13): in a replay every readdir — sync, callback and
// promise forms, names or Dirents — returns its entries sorted by name in UTF-16 code-unit order, so a golden
// never depends on the host filesystem or libuv's listing order. Buffer encodings are left as is.
if (!Number.isNaN(now0)) {
  const nameOf = (e) => (typeof e === 'string' ? e : e?.name);
  const byName = (a, b) => { const x = nameOf(a); const y = nameOf(b); return x < y ? -1 : x > y ? 1 : 0; };
  const sorted = (r) => (Array.isArray(r) && r.every((e) => typeof nameOf(e) === 'string') ? r.sort(byName) : r);
  const { readdirSync, readdir } = fs;
  const pReaddir = fs.promises.readdir;
  fs.readdirSync = function readdirSync_(...args) { return sorted(readdirSync.apply(this, args)); };
  fs.readdir = function readdir_(...args) {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') args[args.length - 1] = (err, r) => cb(err, err ? r : sorted(r));
    return readdir.apply(this, args);
  };
  fs.promises.readdir = async function readdir__(...args) { return sorted(await pReaddir.apply(this, args)); };
  for (const [f, name] of [[fs.readdirSync, 'readdirSync'], [fs.readdir, 'readdir'], [fs.promises.readdir, 'readdir']]) Object.defineProperty(f, 'name', { value: name });
  syncBuiltinESMExports(); // named imports from node:fs and node:fs/promises see the wrappers
}
