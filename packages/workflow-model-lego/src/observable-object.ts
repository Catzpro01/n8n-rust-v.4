import type { IDataObject, IObservableObject } from './interfaces';

/**
 * 1:1 reconstruction of `reference/n8n/packages/workflow/src/observable-object.ts`
 * (n8n 2.9.4, 75 lines).
 *
 * `Workflow` wraps `staticData` in this proxy so the execution layer can tell whether a node
 * mutated it. Two behaviours are observable and reproduced exactly:
 *
 * - `__dataChanged` is installed with `Object.defineProperty(..., { value: false, writable: true })`
 *   — i.e. **non-enumerable**, so `JSON.stringify(staticData)` does not include it. That is why the
 *   `toJSON` fixtures can compare `staticData` as plain data;
 * - child objects are wrapped recursively at creation time, and the `ignoreEmptyOnFirstChild`
 *   option suppresses the dirty flag when an *empty object* is assigned to a previously-undefined
 *   key at depth 0 (`Workflow` passes that option for `staticData`).
 */

interface IObservableOptions {
	ignoreEmptyOnFirstChild?: boolean;
}

export function create(
	target: IDataObject,
	parent?: IObservableObject,
	option?: IObservableOptions,
	depth?: number,
): IDataObject {
	depth = depth || 0;

	// Make all the children of target also observable

	for (const key in target) {
		if (typeof target[key] === 'object' && target[key] !== null) {
			target[key] = create(
				target[key] as IDataObject,
				(parent || target) as IObservableObject,
				option,
				depth + 1,
			);
		}
	}

	Object.defineProperty(target, '__dataChanged', {
		value: false,
		writable: true,
	});
	return new Proxy(target, {
		deleteProperty(target, name) {
			if (parent === undefined) {
				// If no parent is given mark current data as changed
				(target as IObservableObject).__dataChanged = true;
			} else {
				// If parent is given mark the parent data as changed
				parent.__dataChanged = true;
			}
			return Reflect.deleteProperty(target, name);
		},
		get(target, name, receiver) {
			return Reflect.get(target, name, receiver);
		},
		has(target, key) {
			return Reflect.has(target, key);
		},
		set(target, name, value) {
			if (parent === undefined) {
				// If no parent is given mark current data as changed
				if (
					option !== undefined &&
					option.ignoreEmptyOnFirstChild === true &&
					depth === 0 &&
					target[name.toString()] === undefined &&
					typeof value === 'object' &&
					Object.keys(value as object).length === 0
				) {
					// Intentionally empty — the reference has this empty branch.
				} else {
					(target as IObservableObject).__dataChanged = true;
				}
			} else {
				// If parent is given mark the parent data as changed
				parent.__dataChanged = true;
			}
			return Reflect.set(target, name, value);
		},
	});
}

/** Namespace-shaped re-export, matching the reference's `ObservableObject.create(...)` call site. */
export const ObservableObject = { create };
