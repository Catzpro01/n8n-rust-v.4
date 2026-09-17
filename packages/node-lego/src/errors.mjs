/**
 * Error model of the Node LEGO — the validation boundary only.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/errors/abstract/execution-base.error.ts (name/level/tags/extra/timestamp)
 *   reference/n8n/packages/workflow/src/errors/abstract/node.error.ts           (node, messages)
 *   reference/n8n/packages/workflow/src/errors/node-operation.error.ts           (constructor + options)
 *
 * Scope: `validateNodeParameters` and the `assertParamIs*` helpers are the only
 * Node-Model surface that raises; the reference raises a `NodeOperationError`
 * there (parameter-type-validation.ts L13-25). The full error hierarchy is NOT
 * part of the Node Model — see ISSUE-024: `packages/execution-engine/src/errors.mjs`
 * carries the same reconstruction and the two must merge once the orchestrator
 * composes packages. Field parity with the reference is pinned by
 * `tools/node-lego-differential.mjs` (N09/N10).
 */

/**
 * Mirrors `ApplicationError` from `@n8n/errors` (the class `node-helpers.ts` imports).
 *
 * Pinned quirk: the reference class does **not** set `name`, so a thrown instance keeps
 * `name === 'Error'` while `level` defaults to `'error'` and `tags`/`extra` are set.
 * `packageName` (the reference derives it from the call site) is not reconstructed —
 * it is environment-dependent and excluded from the differential.
 */
export class ApplicationError extends Error {
	constructor(message, options = {}) {
		const { level, tags = {}, extra, ...rest } = options;
		super(message, rest);
		this.level = level ?? 'error';
		this.tags = tags;
		this.extra = extra;
	}
}

/** Mirrors `NodeError` + `NodeOperationError` in the subset the validation boundary exposes. */
export class NodeOperationError extends Error {
	constructor(node, error, options = {}) {
		const message = typeof error === 'string' ? error : (error?.message ?? 'Unknown error');

		super(message, options.cause !== undefined ? { cause: options.cause } : undefined);

		this.name = 'NodeOperationError';
		this.level = options.level ?? 'error';
		this.tags = { node: node?.type, ...(options.tags ?? {}) };
		this.extra = { nodeName: node?.name, ...(options.extra ?? {}) };
		this.timestamp = options.timestamp ?? Date.now();
		this.node = node;
		this.messages = [];
		this.description = options.description;
		this.context = options.context ?? {};
		this.functionality = options.functionality;
		this.type = options.type;
	}
}
