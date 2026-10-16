import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, loadSchemas } from './schema.mjs';

test('type, required, additionalProperties', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'integer', minimum: 0 } }, additionalProperties: false };
  assert.deepEqual(validate(s, { a: 1 }), []);
  assert.equal(validate(s, {}).length, 1);
  assert.equal(validate(s, { a: -1 }).length, 1);
  assert.equal(validate(s, { a: 1.5 }).length, 1);
  assert.equal(validate(s, { a: 1, b: 2 }).length, 1);
});

test('null unions, enum, const, pattern, maxLength, items', () => {
  assert.deepEqual(validate({ type: ['string', 'null'] }, null), []);
  assert.equal(validate({ enum: ['x'] }, 'y').length, 1);
  assert.equal(validate({ const: 1 }, 2).length, 1);
  assert.equal(validate({ type: 'string', pattern: 'Z$' }, '2026-01-01T00:00:00').length, 1);
  assert.equal(validate({ type: 'string', maxLength: 2 }, 'abc').length, 1);
  assert.equal(validate({ type: 'array', items: { type: 'string' } }, ['a', 1]).length, 1);
});

test('$ref across files and #/$defs', () => {
  const schemas = { 'q.json': { type: 'object', required: ['n'] } };
  assert.equal(validate({ $ref: 'q.json' }, {}, { schemas }).length, 1);
  assert.deepEqual(validate({ $defs: { n: { type: 'number' } }, $ref: '#/$defs/n' }, 3), []);
});

test('the shipped schemas parse and reference each other', () => {
  const all = loadSchemas();
  for (const name of ['ledger-line.port.json', 'ledger-line.reference.json', 'dispatch.json', 'scope.json', 'config.json', 'module.json', 'receipts-envelope.json']) assert.ok(all[name], name);
});
