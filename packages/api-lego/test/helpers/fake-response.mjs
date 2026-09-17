/** Minimal stand-ins for the express objects the response core touches. */

import { EventEmitter } from 'node:events';

/**
 * A recording `Response`. Enough surface for `status`, `header`, `json`,
 * `send`, `render`, `req.originalUrl` and `headersSent`.
 */
export function makeRes({ originalUrl = '/rest/workflows', headersSent = false } = {}) {
	const calls = [];
	const res = {
		req: { originalUrl },
		headersSent,
		calls,
		statusCode: undefined,
		body: undefined,
		headers: [],
		rendered: undefined,
		status(code) {
			res.statusCode = code;
			calls.push(['status', code]);
			return res;
		},
		header(value) {
			res.headers.push(value);
			calls.push(['header', value]);
			return res;
		},
		json(payload) {
			res.body = payload;
			calls.push(['json', payload]);
			return res;
		},
		send(payload) {
			res.body = payload;
			calls.push(['send', payload]);
			return res;
		},
		render(view, options) {
			res.rendered = { view, options };
			calls.push(['render', view, options]);
			return res;
		},
	};
	return res;
}

/** A writable stand-in, so `Readable.pipe(res)` has something to drain into. */
export function makeWritableRes() {
	const ee = new EventEmitter();
	ee.chunks = [];
	ee.ended = false;
	ee.write = (chunk) => {
		ee.chunks.push(chunk);
		return true;
	};
	ee.end = (chunk) => {
		if (chunk !== undefined) ee.chunks.push(chunk);
		ee.ended = true;
		ee.emit('finish');
		return ee;
	};
	return ee;
}

/** Records everything an `ErrorReporter` is asked to report. */
export function makeErrorReporter() {
	return {
		errors: [],
		error(error) {
			this.errors.push(error);
		},
	};
}

/** Records everything a `Logger` is asked to log. */
export function makeLogger() {
	return {
		lines: [],
		error(line) {
			this.lines.push(line);
		},
	};
}
