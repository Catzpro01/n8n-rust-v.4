/**
 * Expression LEGO — copy-on-write views for scripting nodes.
 * 1:1 behavioral port of n8n-workflow 2.9.4 src/augment-object.ts (invariant E15):
 * expressions inside scripting nodes receive read-through / copy-on-write views
 * so they can never mutate stored execution data.
 */

const isPlainObject = (v) =>
	typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

function augmentRaw(value) {
	if (Array.isArray(value)) return augmentArray(value);
	if (isPlainObject(value)) return augmentObject(value);
	return value;
}

export function augmentObject(target) {
	const writes = new Map();
	return new Proxy(target, {
		has: (t, name) => writes.has(name) || Reflect.has(t, name),
		ownKeys: (t) => {
			const keys = new Set(Reflect.ownKeys(t));
			for (const k of writes.keys()) keys.add(k);
			return [...keys];
		},
		getOwnPropertyDescriptor: (t, name) => {
			if (writes.has(name)) {
				return { configurable: true, enumerable: true, value: writes.get(name) };
			}
			return Reflect.getOwnPropertyDescriptor(t, name);
		},
		get: (t, name) => {
			if (writes.has(name)) return writes.get(name);
			return augmentRaw(Reflect.get(t, name));
		},
		set: (t, name, value) => {
			// copy-on-write: the stored execution data is never mutated
			writes.set(name, value);
			return true;
		},
		deleteProperty: (t, name) => {
			writes.set(name, undefined);
			return true;
		},
	});
}

export function augmentArray(target) {
	const writes = new Map();
	return new Proxy(target, {
		has: (t, name) => writes.has(name) || Reflect.has(t, name),
		ownKeys: (t) => {
			const keys = new Set(Reflect.ownKeys(t));
			for (const k of writes.keys()) keys.add(k);
			return [...keys].sort((a, b) => (typeof a === 'string' ? 1 : typeof b === 'string' ? -1 : a - b));
		},
		get: (t, name) => {
			if (writes.has(name)) return writes.get(name);
			return augmentRaw(Reflect.get(t, name));
		},
		set: (t, name, value) => {
			writes.set(name, value);
			return true;
		},
	});
}
