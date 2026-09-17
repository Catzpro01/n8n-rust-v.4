export class ResponseError extends Error {
	constructor(message, httpStatusCode, errorCode = httpStatusCode, hint = undefined, cause = undefined) {
		super(message, { cause });
		this.name = this.constructor.name;
		this.httpStatusCode = httpStatusCode;
		this.errorCode = errorCode;
		this.hint = hint;
	}
}

export class BadRequestError extends ResponseError {
	constructor(message, errorCode = 400, hint = undefined) {
		super(message, 400, errorCode, hint);
	}
}

export class UnauthenticatedError extends ResponseError {
	constructor(message = 'Unauthorized', errorCode = 401, hint = undefined) {
		super(message, 401, errorCode, hint);
	}
}

export class ForbiddenError extends ResponseError {
	constructor(message = 'Forbidden', errorCode = 403, hint = undefined) {
		super(message, 403, errorCode, hint);
	}
}

export class NotFoundError extends ResponseError {
	constructor(message = 'Not Found', errorCode = 404, hint = undefined) {
		super(message, 404, errorCode, hint);
	}
}

export class ConflictError extends ResponseError {
	constructor(message = 'Conflict', errorCode = 409, hint = undefined) {
		super(message, 409, errorCode, hint);
	}
}

export class UnprocessableRequestError extends ResponseError {
	constructor(message = 'Unprocessable Entity', errorCode = 422, hint = undefined) {
		super(message, 422, errorCode, hint);
	}
}

export class ServiceUnavailableError extends ResponseError {
	constructor(message = 'Service Unavailable', errorCode = 503, hint = undefined) {
		super(message, 503, errorCode, hint);
	}
}

export class InternalServerError extends ResponseError {
	constructor(message = 'Internal Server Error', errorCode = 0, hint = undefined) {
		super(message, 500, errorCode, hint);
	}
}

export class WorkflowValidationError extends BadRequestError {
	constructor(message) {
		super(message, 400);
		this.meta = { validationError: true };
	}
}
