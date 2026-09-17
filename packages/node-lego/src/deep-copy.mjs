/**
 * `deepCopy` — verbatim reconstruction of `utils.ts` L53-87 (n8n 2.9.4).
 *
 * This is the copy used by the Node Model (`getNodeOutputs`, `getNodeParameters`),
 * NOT `lodash/cloneDeep`. Behaviour that matters and is pinned by the differential:
 *   * primitives, `null` and functions are returned as-is;
 *   * any object with a `toJSON` method is replaced by `source.toJSON()` (so a `Date`
 *     parameter becomes its ISO string);
 *   * cycles are handled through the `WeakMap`; keys are copied with `hasOwnProperty`;
 *   * the clone is a plain object (prototype of a literal), arrays stay arrays.
 *
 * DELTA-01 note: `node-helpers.ts` imports only `lodash/get` and `lodash/isEqual`;
 * `deepCopy` comes from this module in the reference too, so there is no lodash delta here.
 */

export const deepCopy = (source, hash = new WeakMap(), path = '') => {
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
};
