/**
 * Error model of the reconstructed execution engine.
 *
 * Reconstruction target: n8n 2.9.4
 *   reference/n8n/packages/workflow/src/errors/*.ts
 *   reference/n8n/packages/core/src/execution-engine/workflow-execute.ts (error capture)
 *
 * Scope: the classes needed by the execute loop to (a) stop an execution,
 * (b) continue on fail, (c) split the error output. UI-only fields
 * (`severity`, i18n keys, `functionality`) are preserved when supplied but are
 * not invented when absent.
 */

/** Base class — mirrors `ApplicationError` (packages/workflow/src/errors/application.error.ts). */
export class ApplicationError extends Error {
	constructor(message, options = {}) {
		super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
		this.name = 'ApplicationError';
		this.level = options.level ?? 'error';
		this.tags = options.tags ?? {};
		this.extra = options.extra ?? {};
		this.timestamp = options.timestamp ?? Date.now();
	}

	toJSON() {
		return {
			name: this.name,
			message: this.message,
			level: this.level,
			tags: this.tags,
			extra: this.extra,
			timestamp: this.timestamp,
		};
	}
}

/**
 * Mirrors `NodeOperationError` (packages/workflow/src/errors/node-operation.error.ts).
 * `node` is required exactly like upstream; `error` may be a string or an Error.
 */
export class NodeOperationError extends ApplicationError {
	constructor(node, error, options = {}) {
		const message =
			typeof error === 'string'
				? error
				: (error?.message ?? 'Unknown error');

		super(message, {
			level: options.level ?? 'error',
			tags: { node: node.type, ...(options.tags ?? {}) },
			extra: { nodeName: node.name, ...(options.extra ?? {}) },
			cause: options.cause ?? (error instanceof Error && error.cause instanceof Error ? error.cause : undefined),
			timestamp: options.timestamp,
		});

		this.name = 'NodeOperationError';
		this.node = node;
		this.messages = [];
		this.description = options.description;
		this.context = options.context;
		this.functionality = options.functionality;

		if (error instanceof Error && error.stack) {
			this.stack = `${this.message}\n${error.stack}`;
		} else {
			Error.captureStackTrace?.(this, NodeOperationError);
		}
	}
}

/**
 * Mirrors `NodeApiError` (packages/workflow/src/errors/node-api.error.ts) in the
 * subset the engine needs: HTTP context survives into run data.
 */
export class NodeApiError extends NodeOperationError {
	constructor(node, error, options = {}) {
		const httpCode = options.httpCode ?? error?.httpCode ?? error?.response?.status;
		super(node, error, { ...options, level: options.level ?? 'error' });
		this.name = 'NodeApiError';
		this.httpCode = httpCode ?? null;
		this.errorResponse = options.errorResponse ?? {
			headers: error?.response?.headers ?? {},
			status: httpCode,
			statusText: error?.response?.statusText ?? undefined,
			body: error?.response?.body ?? error?.response?.data ?? undefined,
		};
	}
}

/**
 * Mirrors `WorkflowActivationError`
 * (`packages/workflow/src/errors/workflow-activation.error.ts`): keeps `node` and
 * `workflowId`, re-wraps an `ExecutionBaseError` cause into a plain Error carrying the
 * same name/message/stack, and derives `level` from the message when none is given
 * (timeout/refused/auth failures are warnings, everything else is an error).
 */
export class WorkflowActivationError extends ApplicationError {
	constructor(message, { cause, node, level, workflowId } = {}) {
		let error = cause;
		if (error instanceof ApplicationError) {
			const copy = new Error(error.message);
			copy.constructor = error.constructor;
			copy.name = error.name;
			copy.stack = error.stack;
			error = copy;
		}
		super(message, { cause: error });
		this.name = 'WorkflowActivationError';
		this.node = node;
		this.workflowId = workflowId;
		this.message = message;
		this.level = level ?? deriveActivationLevel(message);
	}
}

/** `WorkflowDeactivationError extends WorkflowActivationError` (workflow-deactivation.error.ts). */
export class WorkflowDeactivationError extends WorkflowActivationError {
	constructor(message, options = {}) {
		super(message, options);
		this.name = 'WorkflowDeactivationError';
	}
}

/** `TriggerCloseError` (trigger-close.error.ts) — carries the node and its level. */
export class TriggerCloseError extends ApplicationError {
	constructor(node, { cause, level } = {}) {
		super('Trigger Close Failed', { cause, extra: { nodeName: node.name } });
		this.name = 'TriggerCloseError';
		this.node = node;
		this.level = level ?? 'error';
	}
}

/** `UserError` (workflow/src/errors/base/user.error.ts) — an actionable, user-facing message. */
export class UserError extends ApplicationError {
	constructor(message, options = {}) {
		super(message, options);
		this.name = 'UserError';
	}
}

/** Reference `WorkflowActivationError.setLevel` (L41-59). */
function deriveActivationLevel(message) {
	const warningPatterns = [
		'etimedout', // Node.js
		'econnrefused', // Node.js
		'eauth', // OAuth
		'temporary authentication failure', // IMAP server
		'invalid credentials',
	];
	const lower = String(message).toLowerCase();
	return warningPatterns.some((pattern) => lower.includes(pattern)) ? 'warning' : 'error';
}

/**
 * Mirrors `UnexpectedError`.
 */
export class UnexpectedError extends ApplicationError {
	constructor(message, options = {}) {
		super(message, options);
		this.name = 'UnexpectedError';
	}
}

/**
 * `ExecutionBaseError` is a plain object in run data (see execution-data contract
 * §1 `error?: ExecutionError`). Spread-safe serialisation, never the class itself.
 */
export function toExecutionError(error) {
	if (error === undefined || error === null) return undefined;
	const source = error instanceof Error ? error : new Error(String(error));
	const serialised = {
		name: source.name,
		message: source.message,
		stack: source.stack,
	};

	for (const key of ['description', 'context', 'httpCode', 'errorResponse', 'level', 'timestamp', 'extra', 'tags', 'node', 'functionality', 'messages']) {
		if (source[key] !== undefined) serialised[key] = source[key];
	}

	return serialised;
}

/**
 * n8n's execute loop treats a *returned* `{ json: { error } }` item as a failed
 * attempt (workflow-execute.ts L1671, `nodeFailed`), which is what drives the
 * retry `while` loop — as opposed to a thrown error, which the `catch` handles.
 */
export function isSoftFailure(nodeSuccessData) {
	return nodeSuccessData?.[0]?.[0]?.json?.error !== undefined;
}

/** Human message of a soft-failure item or thrown error, for `{ json: { error } }`. */
export function errorMessageOf(value) {
	if (value instanceof Error) return value.message;
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && typeof value.message === 'string') return value.message;
	return String(value);
}

/** Convenience for node implementations that want n8n's `ApplicationError` shape. */
export const Errors = { ApplicationError, NodeOperationError, NodeApiError, UnexpectedError };
