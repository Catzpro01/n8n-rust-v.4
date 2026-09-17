/**
 * 1:1 ports of `packages/cli/src/errors/response-errors/**` (n8n 2.9.4).
 *
 * A-01  `ResponseError` hardcodes `this.name = 'ResponseError'` — so
 *       `error.name` is **always** 'ResponseError', even for every subclass.
 *       Discriminate with `instanceof` or `errorCode`, never with `name`.
 * A-02  `level` is derived from the HTTP status band: 4xx → 'warning',
 *       502–504 → 'info', everything else (incl. 500, 501) → 'error'.
 * A-03  `errorCode` defaults to `httpStatusCode`, and TypeScript default
 *       parameters fire on an explicit `undefined` too — so `BadRequestError(m)`
 *       (which forwards `undefined`) yields **400**, not undefined. Only an
 *       explicitly falsy code (e.g. `0`) survives, which is what makes the
 *       envelope fall back to `code: 0` (see A-04 in response-helper.mjs).
 */

export class ResponseError extends Error {
	constructor(message, httpStatusCode, errorCode = httpStatusCode, hint = undefined, cause) {
		super(message, { cause });
		this.name = 'ResponseError'; // A-01
		this.httpStatusCode = httpStatusCode;
		this.errorCode = errorCode;
		this.hint = hint;

		if (httpStatusCode >= 400 && httpStatusCode < 500) {
			this.level = 'warning'; // A-02
		} else if (httpStatusCode >= 502 && httpStatusCode <= 504) {
			this.level = 'info';
		} else {
			this.level = 'error';
		}
	}
}

export class UnauthenticatedError extends ResponseError {
	constructor(message = 'Unauthenticated', hint) {
		super(message, 401, 401, hint);
	}
}

export class BadRequestError extends ResponseError {
	constructor(message, errorCode) {
		super(message, 400, errorCode); // A-03: errorCode may be undefined
	}
}

export class NotFoundError extends ResponseError {
	constructor(message, hint = undefined) {
		super(message, 404, 404, hint);
	}

	/** Asserts the value exists, throwing a NotFoundError when it does not. */
	static isDefinedAndNotNull(value, message, hint) {
		if (value === undefined || value === null) throw new NotFoundError(message, hint);
	}
}

export class ConflictError extends ResponseError {
	constructor(message, hint = undefined) {
		super(message, 409, 409, hint);
	}
}

export class ForbiddenError extends ResponseError {
	constructor(message = 'Forbidden', hint) {
		super(message, 403, 403, hint);
	}
}

export class UnprocessableRequestError extends ResponseError {
	constructor(message, hint = undefined) {
		super(message, 422, 422, hint);
	}
}

export class TooManyRequestsError extends ResponseError {
	constructor(message, hint = undefined) {
		super(message, 429, 429, hint);
	}
}

export class ContentTooLargeError extends ResponseError {
	constructor(message, hint = undefined) {
		super(message, 413, 413, hint);
	}
}

export class NotImplementedError extends ResponseError {
	constructor(message, hint = undefined) {
		super(message, 501, 501, hint);
	}
}

export class ServiceUnavailableError extends ResponseError {
	constructor(message, errorCode = 503) {
		super(message, 503, errorCode);
	}
}

export class InternalServerError extends ResponseError {
	constructor(message, cause) {
		super(message ? message : 'Internal Server Error', 500, 500, undefined, cause);
	}
}

/**
 * Stand-in for `n8n-workflow`'s `NodeApiError`.
 *
 * Only the behaviour `sendErrorResponse` depends on is reproduced: the error
 * carries **enumerable own properties** that are merged over the envelope
 * (`Object.assign(response, error)`). The real class also carries node,
 * workflow, description, … — none of which the response core reads.
 */
export class NodeApiError extends Error {
	constructor(message, extra = {}) {
		super(message);
		this.name = 'NodeApiError';
		Object.assign(this, extra);
	}
}
