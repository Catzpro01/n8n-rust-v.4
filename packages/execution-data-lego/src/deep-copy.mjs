/**
 * Execution Data LEGO — `deepCopy`.
 *
 * 1:1 port of `packages/workflow/src/utils.ts:53-89` (n8n 2.9.4).
 *
 * FROZEN QUIRKS (reproduced, not fixed):
 *  - DC-1: an object exposing `toJSON()` is replaced by `toJSON()`, NOT cloned
 *          (a `Date` becomes its JSON string). The `path` bookkeeping is
 *          threaded through but unused by the copy itself.
 *  - DC-2: functions are returned by reference.
 *  - DC-3: the clone of a plain object is `Object.create(Object.getPrototypeOf({}))`,
 *          i.e. a nullary `Object.prototype` object, so any custom prototype
 *          of the source is dropped for plain objects while arrays keep `Array`.
 *  - DC-4: cycles are handled through the shared `hash` WeakMap.
 */
export function deepCopy(source, hash = new WeakMap(), path = '') {
	const hasOwnProp = Object.prototype.hasOwnProperty.bind(source);

	// Primitives & Null & Function
	if (typeof source !== 'object' || source === null || typeof source === 'function') {
		return source;
	}

	// Date and other objects with toJSON method
	if (typeof source.toJSON === 'function') {
		return source.toJSON();
	}

	if (hash.has(source)) {
		return hash.get(source);
	}

	// Array
	if (Array.isArray(source)) {
		const clone = [];
		const len = source.length;
		for (let i = 0; i < len; i++) {
			clone[i] = deepCopy(source[i], hash, path + `[${i}]`);
		}
		return clone;
	}

	// Object
	const clone = Object.create(Object.getPrototypeOf({}));
	hash.set(source, clone);
	for (const i in source) {
		if (hasOwnProp(i)) {
			clone[i] = deepCopy(source[i], hash, path + `.${i}`);
		}
	}
	return clone;
}
