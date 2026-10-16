// Entry-point helpers (B2 items 12 `entry-guard` and 13 `stdout-drain`, group `entry-points`; map R8, R17). STDLIB ONLY.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// True when `importMetaUrl` is the module node was started on. Both sides are realpath-resolved, so a run through a
// symlinked path (sdlc-skills --symlink, macOS /tmp) still counts. Never throws: a missing argv[1] or an unresolvable
// path is "not main".
export function isMain(importMetaUrl, argv1 = process.argv[1]) {
  if (typeof argv1 !== 'string' || !argv1) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(argv1);
  } catch { return false; }
}

const DRAIN_CAP_MS = 10000; // a stalled reader must never hang a hook for ever

// Resolves once every byte already written to `stream` has been handed on. `writableNeedDrain` alone is not enough:
// a pending write below the high-water mark leaves it false and would be lost on process.exit. An empty write's
// callback fires after all earlier writes complete, so it is the flush barrier. A destroyed, closed or erroring
// stream resolves at once; `capMs` bounds a stalled reader.
export function drained(stream, capMs = DRAIN_CAP_MS) {
  return new Promise((resolve) => {
    try {
      if (!stream || stream.destroyed || stream.writableEnded || !(stream.writableNeedDrain || stream.writableLength > 0)) return resolve();
      let timer = null; let settled = false;
      const cleanup = () => { if (timer) clearTimeout(timer); stream.off('error', done); stream.off('close', done); };
      const done = () => { settled = true; cleanup(); resolve(); };
      // Timer and listeners exist only once the flush barrier is accepted; a write that throws leaves nothing behind.
      stream.once('error', done); stream.once('close', done);
      try { stream.write('', done); } catch { cleanup(); return resolve(); }
      if (!settled) timer = setTimeout(done, capMs);
    } catch { resolve(); }
  });
}

// Wait for stdout/stderr to hand their buffered bytes to the OS (Node: a pipe write is asynchronous on POSIX and
// process.exit() may cut it short), then exit with `code`. Documented guarantee only: 'drain' means the stream's
// buffer was flushed to the underlying handle.
export async function exitAfterDrain(code) {
  try { await drained(process.stdout); await drained(process.stderr); } catch { /* exit regardless */ }
  process.exit(code);
}
