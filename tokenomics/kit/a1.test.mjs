import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSchemas } from './schema.mjs';

const FX = fileURLToPath(new URL('../fixtures/', import.meta.url));
const schemas = loadSchemas();
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('port fixtures validate against the port schema', () => {
  for (const l of lines(join(FX, 'port/valid/basic/automation/usage-corpus.jsonl'))) {
    assert.deepEqual(validate(schemas['ledger-line.port.json'], l, { schemas }), []);
  }
  assert.deepEqual(validate(schemas['module.json'], JSON.parse(readFileSync(join(FX, 'port/valid/basic/automation/module.json'), 'utf8')), { schemas }), []);
});

test('reference fixtures at every pinned sha validate against the reading schema', () => {
  for (const sha of ['49577c7', 'fa0a6fb', 'd9eac08']) {
    const dir = join(FX, 'reference', sha);
    assert.ok(existsSync(dir), sha);
    const ledgers = [];
    const walk = (p) => { for (const e of readdirSync(p, { withFileTypes: true })) { const q = join(p, e.name); if (e.isDirectory()) walk(q); else if (/usage.*\.jsonl$/.test(e.name)) ledgers.push(q); } };
    walk(dir);
    assert.ok(ledgers.length > 0, `${sha} has a ledger`);
    for (const f of ledgers) for (const l of lines(f)) assert.deepEqual(validate(schemas['ledger-line.reference.json'], l, { schemas }), [], `${sha} ${f}`);
  }
});
