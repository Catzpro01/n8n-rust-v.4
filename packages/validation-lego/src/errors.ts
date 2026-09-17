/**
 * ApplicationError for Validation LEGO.
 *
 * Matches the interface and behavior of `@n8n/errors` ApplicationError,
 * ensuring frozen error messages, constructor name, and error properties
 * match the n8n 2.9.4 runtime expectations.
 */

export interface ApplicationErrorOptions {
	level?: string;
	tags?: Record<string, unknown>;
	extra?: Record<string, unknown>;
	cause?: unknown;
}

export class ApplicationError extends Error {
	level: string;
	tags: Record<string, unknown>;
	extra?: Record<string, unknown>;

	constructor(message: string, options: ApplicationErrorOptions = {}) {
		super(message);
		this.name = 'ApplicationError';
		this.level = options.level ?? 'error';
		this.tags = options.tags ?? {};
		this.extra = options.extra;
		if (options.cause) {
			this.cause = options.cause;
		}
		// Maintain proper prototype chain for instanceof checks
		Object.setPrototypeOf(this, ApplicationError.prototype);
	}
}
