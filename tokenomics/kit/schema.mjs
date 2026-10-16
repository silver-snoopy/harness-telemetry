import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./schemas/', import.meta.url));

export function loadSchemas() {
  return Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => [f, JSON.parse(readFileSync(join(DIR, f), 'utf8'))]));
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number') ;

export function validate(schema, value, { schemas = {}, root = schema, path = '$' } = {}) {
  const errs = [];
  const err = (message) => errs.push({ path, message });
  if (schema.$ref) {
    const ref = schema.$ref;
    const target = ref.startsWith('#/$defs/') ? root.$defs?.[ref.slice(8)] : schemas[ref];
    if (!target) { err(`unresolved $ref ${ref}`); return errs; }
    return validate(target, value, { schemas, root: ref.startsWith('#') ? root : target, path });
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) { err(`expected ${types.join('|')}, got ${typeOf(value)}`); return errs; }
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) err(`expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) err(`not in enum ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) err(`below minimum ${schema.minimum}`);
  if (typeof value === 'string') {
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) err(`longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) err(`does not match ${schema.pattern}`);
  }
  if (schema.anyOf && !schema.anyOf.some((s) => validate(s, value, { schemas, root, path }).length === 0)) err('matches no anyOf branch');
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, { schemas, root, path: `${path}[${i}]` })));
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) err(`missing required ${k}`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errs.push(...validate(props[k], v, { schemas, root, path: `${path}.${k}` }));
      else if (schema.additionalProperties === false) err(`unexpected property ${k}`);
      else if (typeof schema.additionalProperties === 'object') errs.push(...validate(schema.additionalProperties, v, { schemas, root, path: `${path}.${k}` }));
    }
  }
  return errs;
}
