/**
 * Error model of the Node LEGO — the validation boundary only.
 *
 * Reconstruction target (n8n 2.9.4):
 *   reference/n8n/packages/workflow/src/errors/abstract/execution-base.error.ts (name/level/tags/extra/timestamp)
 *   reference/n8n/packages/workflow/src/errors/abstract/node.error.ts           (node, messages, COMMON_ERRORS)
 *   reference/n8n/packages/workflow/src/errors/node-operation.error.ts           (constructor + options)
 *
 * Scope: `validateNodeParameters` and the `assertParamIs*` helpers are the only
 * Node-Model surface that raises; the reference raises a `NodeOperationError`
 * there (parameter-type-validation.ts L13-25). The full error hierarchy is NOT
 * part of the Node Model — see ISSUE-024: `packages/execution-engine/src/errors.mjs`
 * carries the same reconstruction and the two must merge once the orchestrator
 * composes packages. Field parity with the reference is pinned by
 * `tools/node-lego-differential.mjs` (N09/N10) and, behaviourally,
 * `tools/error-surface-differential.mjs` (TASK-EERR-01, ISSUE-024).
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

/**
 * Mirrors `NodeError` + `NodeOperationError` (node.error.ts L37-171,
 * node-operation.error.ts L9-47) — 1:1, TASK-EERR-01 / ISSUE-024.
 *
 * Reference quirks pinned here (line cites = node-operation.error.ts unless noted):
 * - reflection: re-wrapping a `NodeOperationError` returns the SAME instance (L16-18);
 *   note the published n8n-workflow@2.9.1 build predates this guard (observed delta,
 *   source-pinned by the error-surface differential S6);
 * - a string `error` is wrapped in an `ApplicationError` at `level ?? 'warning'` (L19-21),
 *   and `NodeError` keeps it as `cause` (node.error.ts L41-44);
 * - default `level` is **'warning'**, not 'error' (L33);
 * - `options.message` overrides the message (L30);
 * - `description` falls back to the inner error's `description` (L40) and collapses to
 *   `undefined` when it equals the message (L41-43);
 * - `context` is always `{ …, runIndex, itemIndex, metadata }` (L37-39; lane option
 *   `options.context` is merged for compatibility — the reference option set is
 *   message/description/runIndex/itemIndex/level/messageMapping/functionality/type/metadata,
 *   node-api.error.ts L24-36);
 * - `functionality` defaults to `'regular'` (execution-base.error.ts L31);
 * - the message is post-processed through `COMMON_ERRORS` (L44-46 → node.error.ts
 *   L137-166): a message containing e.g. `ETIMEDOUT` is REPLACED by the descriptive
 *   text and the original is preserved in `messages`.
 *
 * Documented boundary (external `@n8n/errors` surface): the published build's
 * `tags`/`extra` come from that package (observed `{packageName}`; the 2.9.4 `NodeError`
 * passes none) — this lane keeps the classic surface `tags.node` / `extra.nodeName`.
 */
export class NodeOperationError extends ApplicationError {
	constructor(node, error, options = {}) {
		// L16-18: reflection
		if (error instanceof NodeOperationError) {
			return error;
		}

		// L19-21: wrap string errors (level default mirrors L20)
		if (typeof error === 'string') {
			error = new ApplicationError(error, { level: options.level ?? 'warning' });
		}

		// NodeError ctor (node.error.ts L38-44): message from the Error; non-Error payloads
		// ride as `errorResponse` in the reference (plain objects carry no message here —
		// reference behaviour). NOTE: `ExecutionBaseError` L47-51 assigns `this.cause` ONLY
		// for non-Error causes, so an Error cause is deliberately NOT observable — matching
		// the published build (error-surface differential S3).
		const isError = error instanceof Error;
		super(isError ? error.message : '');

		this.name = 'NodeOperationError';
		this.timestamp = options.timestamp ?? Date.now(); // execution-base.error.ts L39
		this.level = options.level ?? 'warning'; // L33
		this.tags = { node: node?.type, ...(options.tags ?? {}) }; // documented boundary (see above)
		this.extra = { nodeName: node?.name, ...(options.extra ?? {}) }; // documented boundary (see above)
		this.node = node; // node.error.ts L38
		this.messages = []; // node.error.ts L39

		if (error instanceof NodeOperationError && error.messages?.length) {
			// L25-27: preserve inner messages
			error.messages.forEach((message) => this.messages.push(message));
		}

		if (options.message) this.message = options.message; // L30
		this.functionality = options.functionality ?? 'regular'; // L34-35 + execution-base.error.ts L31
		if (options.type) this.type = options.type; // L36-37

		if (options.description) this.description = options.description; // L39
		else if (typeof error?.description === 'string') this.description = error.description; // L40

		this.context = {
			...(options.context ?? {}),
			runIndex: options.runIndex, // L37-39 (reference reads these options, not options.context)
			itemIndex: options.itemIndex,
			metadata: options.metadata,
		};

		if (this.message === this.description) {
			this.description = undefined; // L41-43
		}

		// L44-46 → node.error.ts L137-166
		[this.message, this.messages] = setDescriptiveErrorMessage(
			this.message,
			this.messages,
			undefined,
			options.messageMapping,
		);
	}
}

/**
 * Mirrors the reference's `OperationalError` (`errors/base/operational.error.ts` + `base.error.ts`)
 * in the subset the node-reference parser raises. Same pinned quirk as `ApplicationError`:
 * `name` stays `'Error'`; the level defaults to `'warning'` (an OperationalError signals a
 * transient/expected condition, not a failure), `tags` default to `{}` and `extra` is passed
 * through. Used by `extractReferencesInNodeExpressions` for its three input-invariant throws
 * and the Split Out expression rejection (DELTA-02 boundary-local error model).
 */
export class OperationalError extends Error {
	constructor(message, options = {}) {
		const { level, tags = {}, extra, ...rest } = options;
		super(message, rest);
		this.level = level ?? 'warning';
		this.tags = tags;
		this.extra = extra;
	}
}
