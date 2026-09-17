/**
 * lodash-lite — the dependency-free replacements for the two lodash helpers the Node
 * Model reference imports (`lodash/get`, `lodash/isEqual`; `deepCopy` is the reference's
 * own `utils.ts` helper and is reconstructed verbatim in `deep-copy.mjs`).
 *
 * This is an explicit, documented delta (`README.md` §Deltas): the reference imports
 * lodash; a LEGO package must stay dependency-free (gate `N01`), so the subset the
 * Node Model actually exercises is reimplemented and pinned by tests.
 */

/**
 * `get(object, path, defaultValue)` for the path forms node parameters can use:
 * dotted segments, bracketed indexes (`a[0].b`), quoted segments (`a["b"]`),
 * leading `$` in data-proxy paths, and array indexes on arrays.
 */
export function get(object, path, defaultValue) {
	if (object == null) return defaultValue;
	const segments = toPath(path);
	let current = object;

	for (const segment of segments) {
		if (current == null) return defaultValue;
		if (typeof current !== 'object' && typeof current !== 'string') return defaultValue;
		if (!(segment in Object(current))) return defaultValue;
		current = current[segment];
	}

	return current === undefined ? defaultValue : current;
}

/** Splits `a.b[0].c` / `a["b"].c` into `['a','b','0','c']`. */
export function toPath(path) {
	if (Array.isArray(path)) return path.map(String);
	if (typeof path !== 'string') return [String(path)];

	const segments = [];

	for (const match of path.matchAll(/[^.[\]]+|\[(?:(\d+)|"([^"]*)"|'([^']*)')\]/g)) {
		const raw = match[0];
		if (raw.startsWith('[')) {
			segments.push(match[1] ?? match[2] ?? match[3] ?? '');
		} else {
			segments.push(raw);
		}
	}

	return segments;
}

/** `isEqual(a, b)` over JSON-shaped values (objects, arrays, primitives, Date). */
export function isEqual(a, b) {
	if (a === b) return true;
	if (a instanceof Date || b instanceof Date) {
		return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
	}
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;

	if (Array.isArray(a)) {
		if (a.length !== b.length) return false;
		return a.every((entry, index) => isEqual(entry, b[index]));
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;

	return aKeys.every((key) => Object.hasOwn(b, key) && isEqual(a[key], b[key]));
}

/**
 * lodash `isObject` — the reference's `type-validation.ts` uses it for the `object` field
 * type check. Same verdicts: objects, arrays and functions are objects, `null` is not.
 */
export function isObject(value) {
	return value !== null && (typeof value === 'object' || typeof value === 'function');
}

/**
 * lodash `escapeRegExp` — escapes the regexp special characters in a string
 * (`^$.*+?()[]{}|`). Used by the node-reference parser to build its name alternation.
 */
export function escapeRegExp(string) {
	return string.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * lodash `mapValues` — returns a new object with the same keys and every value passed through
 * `iteratee(value, key, object)`. Like lodash, the result is always a plain object (an array
 * input produces numeric string keys) and inherited properties are ignored.
 */
export function mapValues(object, iteratee) {
	const result = {};
	for (const key of Object.keys(object)) {
		result[key] = iteratee(object[key], key, object);
	}
	return result;
}

/**
 * lodash `cloneDeep` — the deep clone `node-reference-parser-utils.ts` imports. This is NOT the
 * same helper as `utils.deepCopy` (`./deep-copy.mjs`): upstream `deepCopy` is `toJSON`-first and
 * turns a `Date` into a string, while lodash's `cloneDeep` preserves `Date`, `RegExp`, `Map` and
 * `Set` instances and their prototypes. The parser needs lodash's semantics, so both exist here,
 * each used by the call sites the reference uses it at.
 */
export function cloneDeep(value, seen = new WeakMap()) {
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return seen.get(value);

	let copy;
	if (value instanceof Date) {
		copy = new Date(value.getTime());
	} else if (value instanceof RegExp) {
		copy = new RegExp(value.source, value.flags);
	} else if (value instanceof Map) {
		copy = new Map();
		seen.set(value, copy);
		for (const [key, entryValue] of value) copy.set(cloneDeep(key, seen), cloneDeep(entryValue, seen));
		return copy;
	} else if (value instanceof Set) {
		copy = new Set();
		seen.set(value, copy);
		for (const entry of value) copy.add(cloneDeep(entry, seen));
		return copy;
	} else if (Array.isArray(value)) {
		copy = new Array(value.length);
	} else {
		// plain objects and class instances keep their prototype, like lodash
		copy = Object.create(Object.getPrototypeOf(value));
	}

	seen.set(value, copy);
	for (const key of Object.keys(value)) {
		copy[key] = cloneDeep(value[key], seen);
	}
	return copy;
}

/**
 * `isPlainObject` — the subset of lodash's predicate `merge` needs: an object whose prototype is
 * `Object.prototype` or `null`. Dates, RegExps, Maps, Sets, class instances and functions are
 * objects but not *plain* objects, and `merge` treats the two classes differently.
 */
function isPlainObject(value) {
	if (value === null || typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * lodash `keysIn` — own **and inherited enumerable** string keys. `merge` walks sources with
 * `keysIn`, which is observable: merging an object created with a prototype copies the inherited
 * enumerable properties too (`merge({}, Object.create({ inherited: 1 }))` keeps `inherited`).
 */
function keysIn(value) {
	const keys = [];
	for (const key in value) keys.push(key);
	return keys;
}

/**
 * Deep-copies the part of a source `merge` attaches to a key whose destination value is not a
 * container. Pinned reference behaviour (corpus differential vs `lodash/merge` 4.17.21):
 * - plain objects and arrays are cloned **deeply** (no nested container is shared),
 * - everything else (Date, RegExp, Map, Set, functions, class instances) is attached **by
 *   reference** — observable, and the reference's own call site behaves that way.
 */
function cloneMergeSource(value, stack) {
	if (Array.isArray(value)) {
		if (stack.has(value)) return stack.get(value);
		const copy = [];
		stack.set(value, copy);
		for (let index = 0; index < value.length; index++) {
			if (index in value) copy[index] = cloneMergeSource(value[index], stack);
		}
		stack.delete(value); // ancestor chain, not a cache: shared (non-cyclic) refs clone twice
		return copy;
	}

	if (isPlainObject(value)) {
		if (stack.has(value)) return stack.get(value);
		// lodash's `initCloneObject` keeps the source's prototype (a null-prototype source stays
		// null-prototype, a plain object gets `Object.prototype`)
		const copy = Object.create(Object.getPrototypeOf(value));
		stack.set(value, copy);
		for (const key of keysIn(value)) {
			if (key === '__proto__') continue;
			copy[key] = cloneMergeSource(value[key], stack);
		}
		stack.delete(value); // see above: keeps cycles safe without collapsing shared references
		return copy;
	}

	return value;
}

/**
 * Merges one source into `dest` in place — the recursive core of `merge`, mirroring lodash's
 * `baseMerge`/`baseMergeDeep` decision tree:
 * - `undefined` source values never overwrite; they only materialise a missing key;
 * - array source: merged **by index** into an array destination (`[1, 2, 3]` + `['x']` is
 *   `['x', 2, 3]`), otherwise deep-cloned in;
 * - plain-object source: merged into an object destination — unless that destination is a function
 *   or not an object, in which case a fresh object is built (this is what keeps
 *   `merge({}, {}, { constructor: … })` from touching `Object` itself);
 * - any other object source (Date, Map, Set, RegExp, class instance): attached by reference;
 * - primitive/`null` sources and functions are assigned as-is; a string source is merged
 *   index-wise (`'ab'` -> `{ 0: 'a', 1: 'b' }`); `null`/`undefined`/`number`/`boolean` sources are
 *   no-ops; `__proto__` keys are skipped (lodash's prototype-pollution guard).
 */
function mergeSource(dest, src, stack) {
	if (src === null || src === undefined || dest === src) return dest;
	const type = typeof src;
	if (type !== 'object' && type !== 'string' && type !== 'function') return dest;

	for (const key of keysIn(src)) {
		if (key === '__proto__') continue;

		const srcValue = src[key];
		const destValue = dest[key];

		if (srcValue === undefined) {
			if (!(key in dest)) dest[key] = undefined;
			continue;
		}

		if (Array.isArray(srcValue)) {
			if (Array.isArray(destValue)) mergeSource(destValue, srcValue, stack);
			else dest[key] = cloneMergeSource(srcValue, stack);
			continue;
		}

		if (isPlainObject(srcValue)) {
			if (destValue !== null && typeof destValue === 'object' && typeof destValue !== 'function') {
				mergeSource(destValue, srcValue, stack);
			} else {
				dest[key] = cloneMergeSource(srcValue, stack);
			}
			continue;
		}

		dest[key] = srcValue;
	}

	return dest;
}

/**
 * lodash `merge` — the recursive merge `utils.ts:323` uses to fold a node property's
 * `displayOptions` together with the caller's. This is the DELTA-01 lodash subset, validated by
 * the corpus differential against the real `lodash/merge` bundled with `workflow-lego` (E01: the
 * real lodash is an oracle, never a runtime dependency).
 *
 * The **target is mutated** and returned (`merge({}, a, b)` is the reference's immutable-looking
 * idiom) and sources are not mutated — except where a source object is attached by reference
 * (non-plain objects), which is lodash behaviour and pinned in `test/utils.test.mjs`.
 */
export function merge(object, ...sources) {
	for (const source of sources) mergeSource(object, source, new WeakMap());
	return object;
}
