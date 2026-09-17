import { ResponseError } from './errors.mjs';

/**
 * Formats a successful API response into the uniform `{ data }` envelope.
 */
export function formatSuccessResponse(data, raw = false, statusCode = 200) {
	if (raw) {
		return {
			status: statusCode,
			body: data,
		};
	}
	return {
		status: statusCode,
		body: {
			data,
		},
	};
}

/**
 * Checks if error is a ResponseError or has response-error shape.
 */
export function isResponseError(error) {
	if (!error || typeof error !== 'object') return false;
	if (error instanceof ResponseError) return true;
	return (
		'httpStatusCode' in error &&
		typeof error.httpStatusCode === 'number' &&
		'errorCode' in error &&
		typeof error.errorCode === 'number'
	);
}

/**
 * Formats an error into n8n 2.9.4 REST error format `{ code, message, hint?, meta? }`.
 */
export function formatErrorResponse(error) {
	let httpStatusCode = 500;
	const body = {
		code: 0,
		message: error?.message ?? 'Unknown error',
	};

	if (isResponseError(error)) {
		httpStatusCode = error.httpStatusCode;
		body.code = error.errorCode !== undefined ? error.errorCode : error.httpStatusCode;
		if (error.hint) body.hint = error.hint;
		if (error.meta) body.meta = error.meta;
	}

	return {
		status: httpStatusCode,
		body,
	};
}

/**
 * Formats unauthenticated error from AuthService middleware (bypasses {code,message} envelope).
 */
export function formatUnauthenticatedResponse(message = 'Unauthorized') {
	return {
		status: 401,
		body: {
			status: 'error',
			message,
		},
	};
}

/**
 * Formats Public API error (message-only format).
 */
export function formatPublicApiError(message, status = 401) {
	return {
		status,
		body: {
			message,
		},
	};
}
