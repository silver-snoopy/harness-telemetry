// Tests for the engine version source (map D4, owner Q14; B2 item 11 `writer`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineVersion, writerId, readEngineJson } from './version.mjs';

// The version source is ENGINE.json (B3, owner Q14).
const ENGINE = { version: JSON.parse(readFileSync(new URL('../ENGINE.json', import.meta.url), 'utf8')).engine };

test('engineVersion: pin, ENGINE.json, missing file → 0.0.0+unknown', async () => {
  assert.equal(engineVersion({ TOKENOMICS_ENGINE_VERSION_PIN: '1.2.0' }), '1.2.0');
  assert.equal(engineVersion({}), ENGINE.version, 'no pin: ENGINE.json version');
  assert.equal(engineVersion({ TOKENOMICS_ENGINE_VERSION_PIN: '' }), ENGINE.version, 'an empty pin is no pin');
  assert.equal(writerId({ TOKENOMICS_ENGINE_VERSION_PIN: '1.2.0' }), 'tokenomics-engine@1.2.0');
  assert.equal(writerId({}), `tokenomics-engine@${ENGINE.version}`);
  // A copy without ENGINE.json beside engine/ reads the named unknown.
  const root = mkdtempSync(join(tmpdir(), 'ht-version-'));
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  const copy = join(root, 'a', 'b', 'version.mjs');
  copyFileSync(fileURLToPath(new URL('./version.mjs', import.meta.url)), copy);
  const m = await import(pathToFileURL(copy).href);
  assert.equal(m.engineVersion({}), '0.0.0+unknown');
  assert.equal(m.writerId({}), 'tokenomics-engine@0.0.0+unknown');
  assert.equal(m.engineVersion({ TOKENOMICS_ENGINE_VERSION_PIN: '0.0.0-replay' }), '0.0.0-replay');
});

test('readEngineJson: parsed object, or null when absent or unreadable', () => {
  const engineRoot = fileURLToPath(new URL('..', import.meta.url));
  assert.equal(readEngineJson(engineRoot).engine, ENGINE.version);
  const root = mkdtempSync(join(tmpdir(), 'ht-version-ej-'));
  assert.equal(readEngineJson(root), null);
  writeFileSync(join(root, 'ENGINE.json'), '{nope');
  assert.equal(readEngineJson(root), null);
});
