/**
 * Error model of the reconstructed execution engine.
 *
 * Reconstruction target: n8n 2.9.4
 *   reference/n8n/packages/workflow/src/errors/*.ts
 *   reference/n8n/packages/core/src/execution-engine/workflow-execute.ts (error capture)
 *
 * Scope: the classes needed by the execute loop to (a) stop an execution,
 * (b) continue on fail, (c) split the error output. UI-only fields
 * (`severity`, i18n keys) are preserved when supplied but are not invented when
 * absent — EXCEPTION (TASK-EERR-01 / ISSUE-024): `NodeOperationError` is a 1:1
 * port of the reference constructor and therefore DOES default
 * `functionality = 'regular'` (execution-base.error.ts L31) and `level = 'warning'`
 * (node-operation.error.ts L33), exactly like upstream.
 */

/** `COMMON_ERRORS` — node.error.ts L12-47 (verbatim strings). */
const COMMON_ERRORS = {
	// nodeJS errors
	ECONNREFUSED: 'The service refused the connection - perhaps it is offline',
	ECONNRESET:
		'The connection to the server was closed unexpectedly, perhaps it is offline. You can retry the request immediately or wait and retry later.',
	ENOTFOUND:
		'The connection cannot be established, this usually occurs due to an incorrect host (domain) value',
	ETIMEDOUT:
		"The connection timed out, consider setting the 'Retry on Fail' option in the node settings",
	ERRADDRINUSE:
		'The port is already occupied by some other application, if possible change the port or kill the application that is using it',
	EADDRNOTAVAIL: 'The address is not available, ensure that you have the right IP address',
	ECONNABORTED: 'The connection was aborted, perhaps the server is offline',
	EHOSTUNREACH: 'The host is unreachable, perhaps the server is offline',
	EAI_AGAIN: 'The DNS server returned the DNS server not available error',
	ENOENT: 'The file or directory does not exist',
	EISDIR: 'The file path was expected but the given path is a directory',
	ENOTDIR: 'The directory path was expected but the given path is a directory',
	EACCES: 'Forbidden by access permissions, make sure you have the right permissions',
	EEXIST: 'The file or directory already exists',
	EPERM: 'Operation not permitted, make sure you have the right permissions',
	// other errors
	GETADDRINFO: 'The server closed the connection unexpectedly',
};

/**
 * `NodeError.setDescriptiveErrorMessage` — node.error.ts L137-166 (the `code` branch is
 * kept: NodeOperationError always passes `code = undefined`, but the helper is shared).
 */
function setDescriptiveErrorMessage(message, messages, code, messageMapping) {
	let newMessage = message;

	if (messageMapping) {
		for (const [mapKey, mapMessage] of Object.entries(messageMapping)) {
			if ((message || '').toUpperCase().includes(mapKey.toUpperCase())) {
				newMessage = mapMessage;
				messages.push(message);
				break;
			}
		}
		if (newMessage !== message) {
			return [newMessage, messages];
		}
	}

	// if code is provided and it is in the list of common errors set the message and return early
	if (code && typeof code === 'string' && COMMON_ERRORS[code.toUpperCase()]) {
		newMessage = COMMON_ERRORS[code];
		messages.push(message);
		return [newMessage, messages];
	}

	// check if message contains any of the common errors and set the message and description
	for (const [errorCode, errorDescriptiveMessage] of Object.entries(COMMON_ERRORS)) {
		if ((message || '').toUpperCase().includes(errorCode.toUpperCase())) {
			newMessage = errorDescriptiveMessage;
			messages.push(message);
			break;
		}
	}

	return [newMessage, messages];
}

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

/** Base operational error class — mirrors `OperationalError` (reference/n8n/packages/workflow/src/errors/base/operational.error.ts). */
export class OperationalError extends ApplicationError {
	constructor(message, options = {}) {
		super(message, options);
		this.name = 'OperationalError';
	}
}

/** Error thrown when an execution is already resuming — mirrors `ExecutionAlreadyResumingError`. */
export class ExecutionAlreadyResumingError extends OperationalError {
	constructor(executionId) {
		super('Execution is already being resumed by another process', { extra: { executionId } });
		this.name = 'ExecutionAlreadyResumingError';
		this.executionId = executionId;
	}
}

/** Error thrown when BullMQ stalled jobs exceed limit — mirrors `MaxStalledCountError`. */
export class MaxStalledCountError extends OperationalError {
	constructor(cause) {
		super(
			'This execution failed to be processed too many times and will no longer retry. To allow this execution to complete, please break down your workflow or scale up your workers or adjust your worker settings.',
			{
				level: 'warning',
				cause,
			},
		);
		this.name = 'MaxStalledCountError';
	}
}

/**
 * Mirrors `NodeOperationError` (packages/workflow/src/errors/node-operation.error.ts)
 * — 1:1, TASK-EERR-01 / ISSUE-024. `node` is required exactly like upstream; `error`
 * may be a string or an Error.
 *
 * Reference quirks pinned here (line cites = node-operation.error.ts unless noted):
 * - reflection: re-wrapping a `NodeOperationError` returns the SAME instance (L16-18);
 *   within this lane `NodeApiError` is a subtype, so it reflects identically. The
 *   published n8n-workflow@2.9.1 build predates this guard (observed delta; the 2.9.4
 *   source is the reconstruction target);
 * - a string `error` is wrapped in an `ApplicationError` at `level ?? 'warning'` (L19-21)
 *   and kept as `cause` (node.error.ts L41-44);
 * - default `level` is **'warning'** (L33);
 * - `options.message` overrides the message (L30);
 * - `description` falls back to the inner error's `description` (L40) and collapses to
 *   `undefined` when it equals the message (L41-43);
 * - `context` is always `{ runIndex, itemIndex, metadata }` from the reference options
 *   (L37-39; node-api.error.ts L24-36 defines the option set);
 * - `functionality` defaults to `'regular'` (execution-base.error.ts L31) — this
 *   supersedes the earlier "not invented when absent" note for THIS class (the note
 *   remains true for the engine-internal classes below);
 * - the message is post-processed through `COMMON_ERRORS` (L44-46 → node.error.ts
 *   L137-166): a message containing e.g. `ETIMEDOUT` is REPLACED by the descriptive
 *   text and the original is preserved in `messages`.
 *
 * Documented boundary (external `@n8n/errors` surface): the published build's
 * `tags`/`extra` come from that package — this lane keeps the classic surface
 * `tags.node` / `extra.nodeName`.
 */
export class NodeOperationError extends ApplicationError {
	constructor(node, error, options = {}) {
		// L16-18: reflection
		if (error instanceof NodeOperationError) {
			return error;
		}

		// L19-21: wrap string errors
		if (typeof error === 'string') {
			error = new ApplicationError(error, { level: options.level ?? 'warning' });
		}

		// NodeError ctor (node.error.ts L38-44): message from the Error, Error kept as cause
		const isError = error instanceof Error;
		const message = isError ? error.message : '';

		super(message, {
			level: options.level ?? 'warning', // L33
			tags: { node: node.type, ...(options.tags ?? {}) }, // documented boundary (see above)
			extra: { nodeName: node.name, ...(options.extra ?? {}) }, // documented boundary (see above)
			// NOTE: no `cause` — ExecutionBaseError L47-51 assigns `this.cause` ONLY for
			// non-Error causes, so an Error cause is deliberately not observable (the
			// published build agrees; error-surface differential S3).
			timestamp: options.timestamp, // execution-base.error.ts L39 (base defaults Date.now())
		});

		this.name = 'NodeOperationError';
		this.node = node;
		this.messages = []; // node.error.ts L39

		if (error instanceof NodeOperationError && error.messages?.length) {
			// L25-27: preserve inner messages
			error.messages.forEach((m) => this.messages.push(m));
		}

		if (options.message) this.message = options.message; // L30
		this.functionality = options.functionality ?? 'regular'; // L34-35 + execution-base.error.ts L31
		if (options.type) this.type = options.type; // L36-37

		if (options.description) this.description = options.description; // L39
		else if (typeof error?.description === 'string') this.description = error.description; // L40

		this.context = {
			...(options.context ?? {}),
			runIndex: options.runIndex, // L37-39
			itemIndex: options.itemIndex,
			metadata: options.metadata,
		};

		if (this.message === this.description) {
			this.description = undefined; // L41-43
		}

		// L44-46 → node.error.ts L137-166 (COMMON_ERRORS post-processing)
		[this.message, this.messages] = setDescriptiveErrorMessage(
			this.message,
			this.messages,
			undefined,
			options.messageMapping,
		);

		if (isError && error.stack) {
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

/** Error thrown when an execution is not found in active executions — mirrors `ExecutionNotFoundError`. */
export class ExecutionNotFoundError extends UnexpectedError {
	constructor(executionId) {
		super('No active execution found', { extra: { executionId } });
		this.name = 'ExecutionNotFoundError';
		this.executionId = executionId;
	}
}

/** Base execution cancellation error — mirrors `ExecutionCancelledError`. */
export class ExecutionCancelledError extends ApplicationError {
	constructor(executionId, reason = 'manual') {
		super('The execution was cancelled', {
			level: 'warning',
			extra: { executionId },
		});
		this.name = 'ExecutionCancelledError';
		this.executionId = executionId;
		this.reason = reason;
	}
}

/** Manual execution cancellation error — mirrors `ManualExecutionCancelledError`. */
export class ManualExecutionCancelledError extends ExecutionCancelledError {
	constructor(executionId) {
		super(executionId, 'manual');
		this.name = 'ManualExecutionCancelledError';
		this.message = 'The execution was cancelled manually';
	}
}

/** Timeout execution cancellation error — mirrors `TimeoutExecutionCancelledError`. */
export class TimeoutExecutionCancelledError extends ExecutionCancelledError {
	constructor(executionId) {
		super(executionId, 'timeout');
		this.name = 'TimeoutExecutionCancelledError';
		this.message = 'The execution was cancelled because it timed out';
	}
}

/** System shutdown cancellation error — mirrors `SystemShutdownExecutionCancelledError`. */
export class SystemShutdownExecutionCancelledError extends ExecutionCancelledError {
	constructor(executionId) {
		super(executionId, 'shutdown');
		this.name = 'SystemShutdownExecutionCancelledError';
		this.message = 'The execution was cancelled because the system is shutting down';
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
