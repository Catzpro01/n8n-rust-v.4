const Primitive = String;
const primitive = 'string';
const object = 'object';
const noop = (_key, value) => value;
const primitives = (value) => value instanceof Primitive ? Primitive(value) : value;
const boxStrings = (_key, value) => typeof value === primitive ? new Primitive(value) : value;

/** Dependency-free wire-compatible subset of flatted.stringify. */
export function stringify(value, replacer, space) {
  if (value === null || (typeof value !== object && typeof value !== 'function')) {
    return JSON.stringify([value], null, space);
  }
  const transform = replacer && typeof replacer === object
    ? (key, entry) => key === '' || replacer.includes(key) ? entry : undefined
    : (replacer || noop);
  const known = new Map();
  const input = [];
  const output = [];
  let index = +!value;
  const set = (entry) => {
    const ref = String(input.push(entry) - 1);
    known.set(entry, ref);
    return ref;
  };
  known.set(value, String(index));
  input.push(value);
  do {
    const current = input[index];
    output[index++] = JSON.stringify(current, function replace(key, entry) {
      if (key === '') return entry;
      const next = transform.call(this, key, entry);
      if (next === null) return next;
      if (typeof next === object || typeof next === primitive) return known.get(next) ?? set(next);
      return next;
    }, space);
  } while (index < input.length);
  return `[${output.join(',')}]`;
}

function revive(input, seen, output, transform) {
  const deferred = [];
  for (const key of Object.keys(output)) {
    const value = output[key];
    if (value instanceof Primitive) {
      const target = input[value];
      if (target && typeof target === object && !seen.has(target)) {
        seen.add(target);
        deferred.push({ key, target });
      } else output[key] = transform.call(output, key, target);
    } else output[key] = transform.call(output, key, value);
  }
  for (const { key, target } of deferred) output[key] = transform.call(output, key, revive(input, seen, target, transform));
  return output;
}

export function parse(text, reviver) {
  const transform = reviver || noop;
  const input = JSON.parse(text, boxStrings).map(primitives);
  const value = input[0];
  const result = value && typeof value === object ? revive(input, new Set([value]), value, transform) : value;
  return transform.call({ '': result }, '', result);
}

export class CorruptedExecutionDataError extends Error {
  constructor(cause) {
    super('Execution data is corrupted and could not be parsed', { cause });
    this.name = 'CorruptedExecutionDataError';
  }
}

export function parseExecutionData(text) {
  try { return parse(text); }
  catch (error) { throw new CorruptedExecutionDataError(error); }
}
