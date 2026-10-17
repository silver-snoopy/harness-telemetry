// Test kit for the work-item tracker tests (Plan 7, D-TESTKIT). Test-only; excluded from ENGINE.json like the other
// fixtures. STDLIB ONLY.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
