import { Readable } from 'node:stream';

import { NodeApiError, ResponseError } from './errors.mjs';

/** From `n8n-workflow` constants (pinned). */
const FORM_TRIGGER_PATH_IDENTIFIER = 'n8n-form';

/**
 * 1:1 port of `packages/cli/src/response-helper.ts` (n8n 2.9.4).
 *
 * The only delta is injection: upstream reads `inDevelopment` from
 * `@n8n/backend-common` and pulls `Logger` / `ErrorReporter` from the `@n8n/di`
 * container. Here they arrive through the optional `deps` argument, which is
 * what keeps this package dependency-free (same pattern as `deps.cipher` in the
 * credentials LEGO and `deps.CronJob` in the scheduler LEGO).
 *
 * A-04  The envelope always starts as `{ code: 0, message }`; `code` is
 *       overwritten only `if (error.errorCode)` — **truthy**. A
 *       `BadRequestError(message)` has `errorCode === undefined`, so its
 *       response is HTTP 400 with `code: 0`.
 * A-05  A `NodeApiError` is merged over the envelope with `Object.assign`, so
 *       its own enumerable properties can add to (and overwrite) it.
 * A-06  `stacktrace` is added only in development, and only when `error.stack`
 *       exists — production never leaks a stack.
 * A-07  Two form-trigger exceptions bypass JSON entirely and `res.render`
 *       instead: `errorCode === 404` on a form URL, and `errorCode === 409` on
 *       `form-waiting`.
 * A-08  `sendSuccessResponse` pipes a `Readable` **before** it looks at `raw`,
 *       so a stream is never wrapped in `{ data }` — and `raw` sends a string
 *       with `res.send`, anything else with `res.json`.
 * A-09  `send()` skips the success response when `res.headersSent` is already
 *       true, i.e. a handler that wrote the response itself wins.
 * A-10  A unique/duplicate-constraint message is rewritten to
 *       'There is already an entry with this name' — the check is a
 *       case-insensitive substring test on `message`, so it fires on any error
 *       containing "unique" or "duplicate", not just on DB errors.
 * A-11  `reportError` stays silent for a `ResponseError` whose status is
 *       <= 404; everything else is reported.
 * A-12  `isResponseError` duck-types on `httpStatusCode` **and** `errorCode`
 *       both being numbers, which is what lets external hooks throw look-alikes.
 */

export function sendSuccessResponse(res, data, raw, responseCode, responseHeader) {
	if (responseCode !== undefined) {
		res.status(responseCode);
	}

	if (responseHeader) {
		res.header(responseHeader);
	}

	if (data instanceof Readable) {
		// A-08
		data.pipe(res);
		return;
	}

	if (raw === true) {
		if (typeof data === 'string') {
			res.send(data);
		} else {
			res.json(data);
		}
	} else {
		res.json({ data });
	}
}

export function isResponseError(error) {
	if (error instanceof ResponseError) return true;

	if (error instanceof Error) {
		// A-12
		return (
			'httpStatusCode' in error &&
			typeof error.httpStatusCode === 'number' &&
			'errorCode' in error &&
			typeof error.errorCode === 'number'
		);
	}

	return false;
}

export function sendErrorResponse(res, error, deps = {}) {
	let httpStatusCode = 500;

	const response = {
		code: 0, // A-04
		message: error.message ?? 'Unknown error',
	};

	if (isResponseError(error)) {
		if (deps.inDevelopment) {
			deps.logger?.error(`[${error.httpStatusCode}] ${error.message}`);
		}

		const { originalUrl } = res.req ?? {};

		if (error.errorCode === 404 && originalUrl) {
			// A-07
			const basePath = originalUrl.split('/')[1] ?? '';
			const isLegacyFormTrigger = originalUrl.includes(FORM_TRIGGER_PATH_IDENTIFIER);
			const isFormTrigger = basePath.includes('form');

			if (isFormTrigger || isLegacyFormTrigger) {
				const isTestWebhook = basePath.includes('test');
				res.status(404);
				return res.render('form-trigger-404', { isTestWebhook });
			}
		}

		if (error.errorCode === 409 && originalUrl && originalUrl.includes('form-waiting')) {
			return res.render('form-trigger-409', { message: error.message });
		}

		httpStatusCode = error.httpStatusCode;

		if (error.errorCode) response.code = error.errorCode; // A-04
		if (error.hint) response.hint = error.hint;
		if (error.meta) response.meta = error.meta;
	}

	if (error instanceof NodeApiError) {
		if (deps.inDevelopment) {
			deps.logger?.error(`${error.name} ${error.message}`);
		}
		Object.assign(response, error); // A-05
	}

	if (error.stack && deps.inDevelopment) {
		response.stacktrace = error.stack; // A-06
	}

	res.status(httpStatusCode).json(response);
}

export const isUniqueConstraintError = (error) =>
	['unique', 'duplicate'].some((s) => error.message.toLowerCase().includes(s)); // A-10

export function reportError(error, deps = {}) {
	if (!(error instanceof ResponseError) || error.httpStatusCode > 404) {
		// A-11
		deps.errorReporter?.error(error);
	}
}

/**
 * Wraps a controller so every response shares one format.
 * `send(fn, raw)` → `async (req, res) => void`.
 */
export function send(processFunction, raw = false, deps = {}) {
	return async (req, res) => {
		try {
			const data = await processFunction(req, res);
			if (!res.headersSent) sendSuccessResponse(res, data, raw); // A-09
		} catch (error) {
			if (error instanceof Error) {
				reportError(error, deps);

				if (isUniqueConstraintError(error)) {
					error.message = 'There is already an entry with this name'; // A-10
				}
			}

			sendErrorResponse(res, error, deps);
		}
	};
}
