// Workforce control plane — JSON Schema (draft 2020-12 subset) validator.
// DEC-0002: the JSON Schema files under docs/engineering-operations/workforce/schemas are the ONE
// canonical definition of object shape. This module only interprets them; it never redefines them.
// Supported keywords (the subset the canonical schemas use, and nothing silently ignored):
// $ref (#/$defs/*), type, enum, const, pattern, minLength, maxLength, minimum, required,
// properties, additionalProperties, items, minItems, maxItems. Any other keyword fails closed.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const WORKFORCE_DOCS = join(REPO_ROOT, 'docs', 'engineering-operations', 'workforce');
export const SCHEMA_DIR = join(WORKFORCE_DOCS, 'schemas');

const KNOWN = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'enum', 'const', 'pattern',
  'minLength', 'maxLength', 'minimum', 'required', 'properties', 'additionalProperties', 'items', 'minItems', 'maxItems']);

export const SCHEMA_FILES = Object.freeze({
  Task: 'task.schema.json',
  Reservation: 'reservation.schema.json',
  AgentState: 'agent-state.schema.json',
  Lease: 'lease.schema.json',
  Evidence: 'evidence.schema.json',
  Decision: 'decision.schema.json',
  MergeQueueItem: 'merge-queue.schema.json',
  Handoff: 'handoff.schema.json',
  Request: 'request.schema.json',
  Approval: 'approval.schema.json',
  JournalEntry: 'journal-entry.schema.json',
  Actor: 'actor.schema.json',
  Command: 'command.schema.json',
  Event: 'event.schema.json',
});

/** The seven primary workforce objects (#263). */
export const CORE_OBJECT_TYPES = Object.freeze(['Task', 'Reservation', 'AgentState', 'Lease', 'Evidence', 'Decision', 'MergeQueueItem']);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some((t) => t === actual || (t === 'number' && actual === 'integer'));
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/$defs/')) throw new Error(`unsupported $ref ${ref}`);
  const target = root.$defs?.[ref.slice('#/$defs/'.length)];
  if (!target) throw new Error(`unresolved $ref ${ref}`);
  return target;
}

function check(root, schema, value, path, errors) {
  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key)) { errors.push(`${path}: schema uses unsupported keyword "${key}" (fail closed)`); return; }
  }
  if (schema.$ref) { check(root, resolveRef(root, schema.$ref), value, path, errors); return; }
  if (schema.type !== undefined && !typeMatches(schema.type, value)) {
    errors.push(`${path}: expected ${JSON.stringify(schema.type)}, got ${typeOf(value)}`);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: "${value}" does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => check(root, schema.items, item, `${path}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) check(root, props[key], child, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown property "${key}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(root, schema.additionalProperties, child, `${path}.${key}`, errors);
    }
  }
}

let cache = null;
export function loadSchemas(dir = SCHEMA_DIR) {
  if (cache && cache.dir === dir) return cache.schemas;
  const schemas = {};
  for (const [type, file] of Object.entries(SCHEMA_FILES)) schemas[type] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const extra = readdirSync(dir).filter((f) => f.endsWith('.schema.json') && !Object.values(SCHEMA_FILES).includes(f));
  if (extra.length) throw new Error(`unregistered schema files: ${extra.join(', ')}`);
  cache = { dir, schemas };
  return schemas;
}

/** Validate `value` against the canonical schema for `type`. Returns an array of error strings. */
export function validate(type, value, schemas = loadSchemas()) {
  const schema = schemas[type];
  if (!schema) return [`no canonical schema for type ${type}`];
  const errors = [];
  check(schema, schema, value, type, errors);
  return errors;
}
