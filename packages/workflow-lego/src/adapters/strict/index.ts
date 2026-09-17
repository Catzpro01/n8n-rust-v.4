/**
 * Port adapter — `strict` mode.
 *
 * Standalone implementations with NO reference runtime and NO third-party
 * runtime dependencies. Used to prove the LEGO has no hidden coupling to n8n:
 *
 *  - `tools/workflow-port-surface.mjs` shows exactly which symbols are needed
 *  - the model loads with only this file on the module graph
 *  - its port-independent outputs (structure, adjacency, traversal, diff,
 *    checksum) must be identical to reference mode
 *
 * Where a port stands in for a peer LEGO (node model, node rename, nodes
 * reference, expression runtime) the implementation is deliberately a
 * documented pass-through: those responsibilities belong to other LEGOs and
 * are exercised in reference mode.
 */
import { createHash } from 'node:crypto';
import type { IDataObject, IObservableObject, NodeParameterValueType, INode } from '../../ports/vocabulary';
import type { WorkflowLegoPorts } from '../../ports/contracts';
import {
	DEFAULT_TIMEZONE,
	MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
	NODE_CONNECTION_TYPES,
	NODES_WITH_RENAMABLE_CONTENT,
	NODES_WITH_RENAMABLE_FORM_HTML_CONTENT,
	NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT,
	STARTING_NODE_TYPES,
} from '../../kernel/snapshots';

interface ErrorOptionsLike {
	tags?: Record<string, string>;
	extra?: unknown;
	level?: string;
	description?: string;
}

/** Shared shape of the strict error kernel (mirrors n8n's error classes). */
abstract class LegoError extends Error {
	tags?: Record<string, string>;
	extra?: unknown;
	level = 'error';
	description?: string;
	constructor(name: string, message: string, options?: unknown) {
		super(message);
		this.name = name;
		const opts = (options ?? {}) as ErrorOptionsLike;
		this.tags = opts.tags;
		this.extra = opts.extra;
		this.description = opts.description;
		if (opts.level) this.level = opts.level;
	}
}

class ApplicationError extends LegoError {
	constructor(message: string, options?: unknown) {
		super('ApplicationError', message, options);
	}
}

class UserError extends LegoError {
	constructor(message: string, options?: unknown) {
		super('UserError', message, options);
	}
}

/** Minimal observable object: marks `__dataChanged` on mutation, like the reference. */
function create(
	target: IDataObject,
	parent?: IObservableObject,
	options?: { ignoreEmptyOnFirstChild?: boolean },
	depth = 0,
): IDataObject {
	for (const key in target) {
		if (typeof target[key] === 'object' && target[key] !== null) {
			target[key] = create(target[key] as IDataObject, (parent || target) as IObservableObject, options, depth + 1);
		}
	}
	Object.defineProperty(target, '__dataChanged', { value: false, writable: true });
	return new Proxy(target, {
		deleteProperty(t, name) {
			if (parent === undefined) (t as IObservableObject).__dataChanged = true;
			else parent.__dataChanged = true;
			return Reflect.deleteProperty(t, name);
		},
		get(t, name, receiver) {
			return Reflect.get(t, name, receiver);
		},
		has(t, key) {
			return Reflect.has(t, key);
		},
		set(t, name, value) {
			if (parent === undefined) {
				const ignoreEmpty =
					options?.ignoreEmptyOnFirstChild === true &&
					depth === 0 &&
					t[name.toString()] === undefined &&
					typeof value === 'object' &&
					value !== null &&
					Object.keys(value).length === 0;
				if (!ignoreEmpty) (t as IObservableObject).__dataChanged = true;
			} else {
				parent.__dataChanged = true;
			}
			return Reflect.set(t, name, value);
		},
	});
}

/** `jssha`-compatible subset used by workflow-checksum's non-WebCrypto fallback. */
class StrictJsSHA {
	#hash = createHash('sha256');
	#text = '';
	constructor(variant: string, inputType: string, options?: { encoding?: string }) {
		if (variant !== 'SHA-256' || inputType !== 'TEXT') {
			throw new Error(`strict checksum port only implements SHA-256/TEXT (got ${variant}/${inputType})`);
		}
		void options;
	}
	update(input: string) {
		this.#text += input;
	}
	getHash(format: string) {
		if (format !== 'HEX') throw new Error(`strict checksum port only implements HEX (got ${format})`);
		return createHash('sha256').update(this.#text, 'utf8').digest('hex');
	}
}

/** Stand-in for the expression runtime (peer LEGO / runtime concern). */
class StrictExpression {
	workflow?: unknown;
	constructor(workflow?: unknown) {
		this.workflow = workflow;
	}
	getSimpleParameterValue(): unknown {
		return undefined;
	}
}

export const ports: WorkflowLegoPorts = {
	vocabulary: {
		NodeConnectionTypes: NODE_CONNECTION_TYPES,
	},
	constants: {
		STARTING_NODE_TYPES,
		MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE,
		NODES_WITH_RENAMABLE_CONTENT,
		NODES_WITH_RENAMABLE_FORM_HTML_CONTENT,
		NODES_WITH_RENAMEABLE_TOPLEVEL_HTML_CONTENT,
	},
	errors: {
		ApplicationError,
		UserError,
	},
	utils: {
		dedupe: <T>(arr: T[]): T[] => [...new Set(arr)],
		isObject: (value: unknown): value is Record<string, unknown> => {
			if (value === null || typeof value !== 'object') return false;
			if (Array.isArray(value)) return false;
			if (Object.prototype.toString.call(value) !== '[object Object]') return false;
			return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
		},
	},
	observableObject: { create },
	config: {
		getGlobalState: () => ({
			defaultTimezone: process.env.LEGO_DEFAULT_TIMEZONE ?? DEFAULT_TIMEZONE,
		}),
	},
	nodeModel: {
		// strict mode: deliberately different to prove port is used — adds __strict marker
		getNodeParameters: (_properties, nodeValues) => {
			const base = nodeValues ?? {};
			if (typeof base === 'object' && base !== null) {
				return { ...(base as object), __strictMode: true } as any;
			}
			return { __strictMode: true, value: base } as any;
		},
		// stand-in: dynamic output resolution needs the expression runtime
		getNodeOutputs: () => [],
	},
	nodeRename: {
		// pass-through: form-field renaming is the Node Model LEGO's job (LEGO 02)
		renameFormFields: (_node: INode, _rename: (v: NodeParameterValueType) => NodeParameterValueType) => undefined,
	},
	nodeReference: {
		// pass-through: access-pattern rewriting is the Node Model LEGO's job (LEGO 02)
		applyAccessPatterns: (value: NodeParameterValueType) => value,
	},
	expressionRuntime: {
		Expression: StrictExpression,
	},
	checksumDigest: {
		jsSHA: StrictJsSHA,
	},
};

export default ports;
