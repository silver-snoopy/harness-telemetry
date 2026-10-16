// The engine's version, as the `writer` stamp names it (B2 item 11; map D4; owner Q14). The source is ENGINE.json's
// `engine`, beside engine/ (B3; package.json's `version` is kept equal by a test). TOKENOMICS_ENGINE_VERSION_PIN
// overrides it: the replay harness sets it on every event (replay/runner.mjs) so a release bump never churns the
// goldens. A copy without ENGINE.json reads '0.0.0+unknown' — a named unknown, never a guessed version. STDLIB ONLY.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_ROOT = new URL('..', import.meta.url);

// ENGINE.json parsed, or null when absent, unreadable or not an object.
export function readEngineJson(engineRoot = ENGINE_ROOT) {
  try {
    const root = typeof engineRoot === 'string' ? engineRoot : fileURLToPath(engineRoot);
    const doc = JSON.parse(readFileSync(join(root, 'ENGINE.json'), 'utf8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
  } catch { return null; }
}

export function engineVersion(env = process.env) {
  if (env.TOKENOMICS_ENGINE_VERSION_PIN) return env.TOKENOMICS_ENGINE_VERSION_PIN;
  const v = readEngineJson()?.engine;
  return typeof v === 'string' && v ? v : '0.0.0+unknown';
}

export const writerId = (env = process.env) => `tokenomics-engine@${engineVersion(env)}`;
