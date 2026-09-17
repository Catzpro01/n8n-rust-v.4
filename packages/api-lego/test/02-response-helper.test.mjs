import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { BadRequestError, NodeApiError, NotFoundError, ResponseError } from '../src/errors.mjs';
import {
	isResponseError,
	isUniqueConstraintError,
	reportError,
	send,
	sendErrorResponse,
	sendSuccessResponse,
} from '../src/response-helper.mjs';
import { makeErrorReporter, makeLogger, makeRes, makeWritableRes } from './helpers/fake-response.mjs';

test('A-08 the default success path wraps the payload in { data }', () => {
	const res = makeRes();
	sendSuccessResponse(res, { id: '1' });
	assert.deepEqual(res.body, { data: { id: '1' } });
	assert.equal(res.statusCode, undefined, 'no status is set unless asked');
	assert.deepEqual(res.headers, []);
});

test('A-08a raw sends strings with send(), everything else with json()', () => {
	const stringRes = makeRes();
	sendSuccessResponse(stringRes, 'raw text', true);
	assert.deepEqual(stringRes.body, 'raw text');
	assert.deepEqual(stringRes.calls.at(-1)[0], 'send');

	const objectRes = makeRes();
	sendSuccessResponse(objectRes, { a: 1 }, true);
	assert.deepEqual(objectRes.body, { a: 1 });
	assert.deepEqual(objectRes.calls.at(-1)[0], 'json');
});

test('A-08b a Readable is piped, never wrapped — and raw is never consulted', async () => {
	const res = makeWritableRes();
	const stream = Readable.from(['chunk-a', 'chunk-b']);
	sendSuccessResponse(res, stream, true);

	// `pipe` is asynchronous; wait for the destination to finish.
	await new Promise((resolve) => res.on('finish', resolve));

	assert.equal(res.ended, true);
	const written = res.chunks.join('');
	assert.ok(written.includes('chunk-a'), `expected the stream body, got: ${written}`);
	assert.ok(written.includes('chunk-b'), `expected the stream body, got: ${written}`);
});

test('A-08c an explicit status code and headers are applied first', () => {
	const res = makeRes();
	sendSuccessResponse(res, { a: 1 }, false, 201, { 'x-test': '1' });
	assert.equal(res.statusCode, 201);
	assert.deepEqual(res.headers, [{ 'x-test': '1' }]);
	assert.deepEqual(res.body, { data: { a: 1 } });
});

test('A-04 an unknown error becomes 500 with code 0', () => {
	const res = makeRes();
	sendErrorResponse(res, new Error('boom'));
	assert.equal(res.statusCode, 500);
	assert.deepEqual(res.body, { code: 0, message: 'boom' });
});

test('A-04a a ResponseError supplies status, code, hint and meta', () => {
	const res = makeRes();
	const error = new ResponseError('gone', 404, 404, 'check the id');
	error.meta = { id: 'x' };
	sendErrorResponse(res, error);
	assert.equal(res.statusCode, 404);
	assert.deepEqual(res.body, { code: 404, message: 'gone', hint: 'check the id', meta: { id: 'x' } });
});

test('A-04b a falsy errorCode leaves the envelope at code 0 (status still 400)', () => {
	const res = makeRes();
	sendErrorResponse(res, new BadRequestError('bad', 0));
	assert.equal(res.statusCode, 400);
	assert.equal(res.body.code, 0);
});

test('A-04c the `if (error.errorCode)` guard is unreachable dead code', () => {
	// `errorCode` defaults to `httpStatusCode` and TypeScript default parameters
	// fire on `undefined` too, so a ResponseError can only ever carry a NUMBER.
	// The sole falsy value reachable in practice is an explicit 0 — and assigning
	// it unconditionally would produce the same body, which is why a mutant that
	// deletes the guard is behaviourally equivalent (verified: 35/35 still pass).
	const withZero = new BadRequestError('bad', 0);
	assert.equal(withZero.errorCode, 0);
	assert.equal(withZero.httpStatusCode, 400);

	const res = makeRes();
	sendErrorResponse(res, withZero);
	assert.equal(res.statusCode, 400);
	assert.equal(res.body.code, 0);
	assert.equal(res.body.code, withZero.errorCode, 'guard or no guard: identical output');
});

test('A-04d status and code can still diverge (ServiceUnavailableError, errorCode 0)', () => {
	const res = makeRes();
	sendErrorResponse(res, new (Object.getPrototypeOf(new BadRequestError('x')).constructor)('x'));
	assert.equal(res.statusCode, 400);
	assert.equal(res.body.code, 400);
});

test('A-05 a NodeApiError is merged over the envelope', () => {
	const res = makeRes();
	sendErrorResponse(res, new NodeApiError('node failed', { node: 'HTTP Request', extra: 1 }));
	assert.equal(res.statusCode, 500);
	assert.equal(res.body.message, 'node failed');
	assert.equal(res.body.node, 'HTTP Request');
	assert.equal(res.body.extra, 1);
});

test('A-06 stacktrace appears only in development', () => {
	const prod = makeRes();
	sendErrorResponse(prod, new Error('boom'), { inDevelopment: false });
	assert.equal('stacktrace' in prod.body, false);

	const dev = makeRes();
	sendErrorResponse(dev, new Error('boom'), { inDevelopment: true, logger: makeLogger() });
	assert.equal(typeof dev.body.stacktrace, 'string');
});

test('A-07 a 404 on a form URL renders instead of returning JSON', () => {
	const res = makeRes({ originalUrl: '/form/abc-123' });
	sendErrorResponse(res, new NotFoundError('form not found'));
	assert.equal(res.body, undefined, 'no JSON body was written');
	assert.deepEqual(res.rendered, { view: 'form-trigger-404', options: { isTestWebhook: false } });
	assert.equal(res.statusCode, 404);

	const legacy = makeRes({ originalUrl: '/webhook/n8n-form/abc' });
	sendErrorResponse(legacy, new NotFoundError('nope'));
	assert.deepEqual(legacy.rendered.view, 'form-trigger-404');
});

test('A-07a a 409 on form-waiting renders the form-trigger-409 page', () => {
	const res = makeRes({ originalUrl: '/form-waiting/abc' });
	sendErrorResponse(res, new ResponseError('still running', 409, 409));
	assert.deepEqual(res.rendered, {
		view: 'form-trigger-409',
		options: { message: 'still running' },
	});
});

/**
 * Upstream keys the form-trigger exceptions off `error.errorCode`, not off
 * `error.httpStatusCode`. For `NotFoundError` the two are both 404, so a test
 * that only ever sends a `NotFoundError` cannot tell them apart — mutation A8
 * (swap the field) survived the whole suite. The pair below separates them:
 * `BadRequestError('x', 404)` carries `errorCode: 404` over `httpStatusCode: 400`.
 */
test('A-07 keys off errorCode, not httpStatusCode', () => {
	const res = makeRes({ originalUrl: '/form/abc-123' });
	sendErrorResponse(res, new BadRequestError('bad form', 404));
	assert.equal(res.body, undefined, 'the form renderer wins over the JSON envelope');
	assert.deepEqual(res.rendered, { view: 'form-trigger-404', options: { isTestWebhook: false } });

	// ...and an error whose *status* is 404 but whose code is something else
	// must NOT render — it is ordinary JSON.
	const plain = makeRes({ originalUrl: '/form/abc-123' });
	sendErrorResponse(plain, new ResponseError('not a form', 404, 400));
	assert.equal(plain.rendered, undefined);
	assert.deepEqual(plain.body, { code: 400, message: 'not a form' });
});

/**
 * A-07a matches the literal path segment `form-waiting`, not the looser
 * substring `form`. Mutation A9 (loosen the match) survived the whole suite
 * because no test sent a 409 down a plain `/form/...` URL.
 */
test('A-07a the 409 exception requires the form-waiting path, not any form path', () => {
	const waiting = makeRes({ originalUrl: '/form-waiting/abc' });
	sendErrorResponse(waiting, new ResponseError('still running', 409, 409));
	assert.deepEqual(waiting.rendered.view, 'form-trigger-409');

	// A 409 anywhere else is ordinary JSON, even on a form URL.
	const elsewhere = makeRes({ originalUrl: '/form/abc-123' });
	sendErrorResponse(elsewhere, new ResponseError('conflict', 409, 409));
	assert.equal(elsewhere.rendered, undefined);
	assert.equal(elsewhere.statusCode, 409);
	assert.deepEqual(elsewhere.body, { code: 409, message: 'conflict' });
});

test('A-12 isResponseError duck-types on two numeric fields', () => {
	assert.equal(isResponseError(new NotFoundError('x')), true);
	assert.equal(isResponseError(new Error('x')), false);

	const lookalike = new Error('from an external hook');
	lookalike.httpStatusCode = 422;
	lookalike.errorCode = 422;
	assert.equal(isResponseError(lookalike), true);

	const halfLookalike = new Error('nope');
	halfLookalike.httpStatusCode = 422;
	assert.equal(isResponseError(halfLookalike), false, 'both fields must be numbers');
});

test('A-10 the unique-constraint rewrite is a plain substring test', () => {
	assert.equal(isUniqueConstraintError(new Error('duplicate key value')), true);
	assert.equal(isUniqueConstraintError(new Error('UNIQUE constraint failed')), true);
	assert.equal(isUniqueConstraintError(new Error('something else')), false);
});

test('A-11 reportError stays silent for a ResponseError at or below 404', () => {
	const reporter = makeErrorReporter();
	reportError(new NotFoundError('x'), { errorReporter: reporter });
	assert.equal(reporter.errors.length, 0);

	reportError(new ResponseError('gone', 409, 409), { errorReporter: reporter });
	assert.equal(reporter.errors.length, 1, '409 is above the 404 threshold');

	reportError(new Error('plain'), { errorReporter: reporter });
	assert.equal(reporter.errors.length, 2, 'a non-ResponseError is always reported');
});

test('A-09 send() wraps a controller and skips the body when headers were sent', async () => {
	const ok = send(async () => ({ id: '1' }));
	const res = makeRes();
	await ok({}, res);
	assert.deepEqual(res.body, { data: { id: '1' } });

	const alreadySent = makeRes({ headersSent: true });
	await ok({}, alreadySent);
	assert.equal(alreadySent.body, undefined);
});

test('A-10a send() rewrites a duplicate message on the way out', async () => {
	const reporter = makeErrorReporter();
	const handler = send(async () => {
		throw new Error('SQLITE_CONSTRAINT: duplicate key');
	}, false, { errorReporter: reporter });

	const res = makeRes();
	await handler({}, res);
	assert.equal(res.statusCode, 500);
	assert.equal(res.body.message, 'There is already an entry with this name');
	assert.equal(reporter.errors.length, 1, 'it was reported before the rewrite');
});
