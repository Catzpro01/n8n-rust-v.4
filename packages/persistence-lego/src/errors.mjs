/**
 * Minimal twin of @n8n/errors UnexpectedError — same precedent as
 * packages/execution-data-lego/src/application-error.mjs (Task-412).
 * Surface parity only: name, message, extra.
 */
export class UnexpectedError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = 'UnexpectedError';
		if (options.extra) this.extra = options.extra;
		if (options.cause) this.cause = options.cause;
	}
}
