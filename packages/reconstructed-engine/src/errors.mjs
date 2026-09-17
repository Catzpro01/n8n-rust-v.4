/**
 * Errors — reconstructed 1:1 from the pinned reference (n8n 2.9.4).
 *
 * Provenance:
 *   packages/@n8n/errors/src/application.error.ts:12-40      ApplicationError
 *   packages/workflow/src/errors/abstract/execution-base.error.ts:14-50  ExecutionBaseError
 *   packages/workflow/src/errors/abstract/node.error.ts:33-207           NodeError (incl. COMMON_ERRORS)
 *   packages/workflow/src/errors/node-operation.error.ts:11-60           NodeOperationError
 *   packages/workflow/src/errors/expression.error.ts:30-70               ExpressionError
 *   packages/workflow/src/errors/workflow-operation.error.ts:8-24        WorkflowOperationError
 *
 * Deliberate, declared deviation (see manifest/port-surface.json → `deviations`):
 * `ApplicationError.tags.packageName`. The reference derives it from
 * `callsites()[2].getFileName()` and matches `/packages\/([^/]+)\//`. In this
 * reconstruction the same regex is applied to the *nearest* stack frame instead
 * of a callsite object, because `callsites` is not part of the pinned runtime.
 * The field is reporting-only (no branch in the reference reads it back), and
 * test/02-errors.test.mjs pins `tags.packageName` to `undefined` for every
 * error raised from this package, so no behaviour can hide behind it.
 */

import { bindApplicationError, jsonParse } from './utils.mjs';

/** packages/@n8n/errors/src/application.error.ts:12 */
export class ApplicationError extends Error {
	// @n8n/errors compiles with `useDefineForClassFields: false`, so the reference's
	// *declarations* of `extra`/`packageName` are erased: only `level`, `tags` and
	// `extra` end up as own properties (assigned in the ctor), and `packageName`
	// exists solely as `tags.packageName`. Declaring the fields here instead would
	// put a `packageName: undefined` own key on every error in the process.
	level;
	tags;
	extra;

	constructor(message, { level, tags = {}, extra, ...rest } = {}) {
		super(message, rest);
		this.level = level ?? 'error';
		this.tags = tags;
		this.extra = extra;

		const frame = (this.stack ?? '').split('\n')[3] ?? '';
		const match = /packages\/([^/]+)\//.exec(frame);
		if (match) this.tags.packageName = match[1];
	}
}

/** packages/workflow/src/errors/abstract/execution-base.error.ts:14 */
export class ExecutionBaseError extends ApplicationError {
	// Declaration ORDER matters: n8n-workflow compiles with
	// `useDefineForClassFields: true`, so each of these becomes an own property
	// (`undefined` where unassigned) in this exact order — and `Object.keys(error)`
	// is observable in `toJSON`/logging output.
	description = undefined;
	cause = undefined;
	errorResponse = undefined;
	timestamp;
	context = {};
	lineNumber = undefined;
	functionality = 'regular';

	constructor(message, options = {}) {
		super(message, options);

		this.name = this.constructor.name;
		this.timestamp = Date.now();

		const { cause, errorResponse } = options;
		if (cause instanceof ExecutionBaseError) {
			this.context = cause.context;
		} else if (cause && !(cause instanceof Error)) {
			this.cause = cause;
		}

		if (errorResponse) this.errorResponse = errorResponse;
	}

	toJSON() {
		return {
			message: this.message,
			lineNumber: this.lineNumber,
			timestamp: this.timestamp,
			name: this.name,
			description: this.description,
			context: this.context,
			cause: this.cause,
		};
	}
}

/** packages/workflow/src/errors/abstract/node.error.ts:8-31 */
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
	EAI_AGAIN: 'The DNS server returned an error, perhaps the server is offline',
	ENOENT: 'The file or directory does not exist',
	EISDIR: 'The file path was expected but the given path is a directory',
	ENOTDIR: 'The directory path was expected but the given path is a file',
	EACCES: 'Forbidden by access permissions, make sure you have the right permissions',
	EEXIST: 'The file or directory already exists',
	EPERM: 'Operation not permitted, make sure you have the right permissions',
	// other errors
	GETADDRINFO: 'The server closed the connection unexpectedly',
};

const isTraversableObject = (value) => typeof value === 'object' && value !== null;

/** packages/workflow/src/errors/abstract/node.error.ts:33 */
export class NodeError extends ExecutionBaseError {
	// `readonly node` in the reference is a TS parameter property, which the emit
	// places BEFORE the `messages` field initialiser — so `node` is defined first.
	node = undefined;
	messages = [];

	constructor(node, error) {
		const isError = error instanceof Error;
		const message = isError ? error.message : '';
		const options = isError ? { cause: error } : { errorResponse: error };
		super(message, options);

		this.node = node;

		if (error instanceof NodeError) {
			this.tags.reWrapped = true;
		}
	}

	/** packages/workflow/src/errors/abstract/node.error.ts:63 */
	findProperty(jsonError, potentialKeys, traversalKeys = []) {
		for (const key of potentialKeys) {
			let value = jsonError[key];
			if (value) {
				if (typeof value === 'string') {
					try {
						value = jsonParse(value);
					} catch {
						return value;
					}
					if (typeof value === 'string') return value;
				}
				if (typeof value === 'number') return value.toString();
				if (Array.isArray(value)) {
					const resolvedErrors = value
						.map((entry) => {
							if (typeof entry === 'string') return entry;
							if (typeof entry === 'number') return entry.toString();
							if (isTraversableObject(entry)) {
								return this.findProperty(entry, potentialKeys);
							}
							return null;
						})
						.filter((errorValue) => errorValue !== null);

					if (resolvedErrors.length === 0) {
						return null;
					}
					return resolvedErrors.join(' | ');
				}
				if (isTraversableObject(value)) {
					const property = this.findProperty(value, potentialKeys);
					if (property) {
						return property;
					}
				}
			}
		}

		for (const key of traversalKeys) {
			const value = jsonError[key];
			if (isTraversableObject(value)) {
				const property = this.findProperty(value, potentialKeys, traversalKeys);
				if (property) {
					return property;
				}
			}
		}

		return null;
	}

	/** packages/workflow/src/errors/abstract/node.error.ts:132 */
	addToMessages(message) {
		if (message && !this.messages.includes(message)) {
			this.messages.push(message);
		}
	}

	/** packages/workflow/src/errors/abstract/node.error.ts:143 */
	setDescriptiveErrorMessage(message, messages, code, messageMapping) {
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

		if (code && typeof code === 'string' && COMMON_ERRORS[code.toUpperCase()]) {
			newMessage = COMMON_ERRORS[code];
			messages.push(message);
			return [newMessage, messages];
		}

		for (const [errorCode, errorDescriptiveMessage] of Object.entries(COMMON_ERRORS)) {
			if ((message || '').toUpperCase().includes(errorCode.toUpperCase())) {
				newMessage = errorDescriptiveMessage;
				messages.push(message);
				break;
			}
		}

		return [newMessage, messages];
	}
}

/** packages/workflow/src/errors/node-operation.error.ts:11 */
export class NodeOperationError extends NodeError {
	type = undefined;

	constructor(node, error, options = {}) {
		// Reference quirk preserved verbatim: a NodeOperationError passed in is
		// returned as-is instead of being re-wrapped (node-operation.error.ts:19-21).
		if (error instanceof NodeOperationError) {
			return error;
		}

		let normalized = error;
		if (typeof error === 'string') {
			normalized = new ApplicationError(error, { level: options.level ?? 'warning' });
		}

		super(node, normalized);

		if (normalized instanceof NodeError && normalized?.messages?.length) {
			normalized.messages.forEach((message) => this.addToMessages(message));
		}

		if (options.message) this.message = options.message;
		this.level = options.level ?? 'warning';
		if (options.functionality) this.functionality = options.functionality;
		if (options.type) this.type = options.type;

		if (options.description) this.description = options.description;
		else if ('description' in normalized && typeof normalized.description === 'string') {
			this.description = normalized.description;
		}

		this.context.runIndex = options.runIndex;
		this.context.itemIndex = options.itemIndex;
		this.context.metadata = options.metadata;

		if (this.message === this.description) {
			this.description = undefined;
		}

		[this.message, this.messages] = this.setDescriptiveErrorMessage(
			this.message,
			this.messages,
			undefined,
			options.messageMapping,
		);
	}
}

/** packages/workflow/src/errors/expression.error.ts:30 */
export class ExpressionError extends ExecutionBaseError {
	constructor(message, options) {
		super(message, { cause: options?.cause, level: 'warning' });

		if (options?.description !== undefined) {
			this.description = options.description;
		}

		const allowedKeys = [
			'causeDetailed',
			'descriptionTemplate',
			'descriptionKey',
			'itemIndex',
			'messageTemplate',
			'nodeCause',
			'parameter',
			'runIndex',
			'type',
		];

		if (options !== undefined) {
			if (options.functionality !== undefined) {
				this.functionality = options.functionality;
			}

			for (const key of Object.keys(options)) {
				if (allowedKeys.includes(key)) {
					this.context[key] = options[key];
				}
			}
		}
	}
}

/**
 * packages/workflow/src/errors/workflow-operation.error.ts:8-24
 *
 * The 2.9.x signature is `(message, node?, description?)`, NOT the older
 * `(message, error, options)` some earlier n8n had: the second positional argument
 * IS the node. A port that reads it as an options bag ends up with `node: undefined`
 * and the options object in `cause`, which is exactly the sort of inert-field drift
 * CROSS-AGENT-ISSUES ISSUE-016 is about — so test/02 pins it against the live class.
 */
export class WorkflowOperationError extends ExecutionBaseError {
	node = undefined;
	timestamp;

	constructor(message, node, description) {
		// `{ cause: undefined }` rather than `{}`: the reference passes the object
		// through to `Error`, which then defines `cause` as an own key.
		super(message, { cause: undefined });
		this.level = 'warning';
		this.name = this.constructor.name;
		if (description) this.description = description;
		this.node = node;
		this.timestamp = Date.now();
	}
}
