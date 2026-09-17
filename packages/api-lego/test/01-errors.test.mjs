import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BadRequestError,
	ConflictError,
	ContentTooLargeError,
	ForbiddenError,
	InternalServerError,
	NotFoundError,
	NotImplementedError,
	ResponseError,
	ServiceUnavailableError,
	TooManyRequestsError,
	UnauthenticatedError,
	UnprocessableRequestError,
} from '../src/errors.mjs';

test('A-01 the name is ALWAYS "ResponseError", even for subclasses', () => {
	assert.equal(new UnauthenticatedError().name, 'ResponseError');
	assert.equal(new NotFoundError('nope').name, 'ResponseError');
	assert.equal(new InternalServerError().name, 'ResponseError');
	// …so discriminating on `name` is a trap: `instanceof` still works.
	assert.ok(new UnauthenticatedError() instanceof ResponseError);
	assert.equal(new UnauthenticatedError() instanceof NotFoundError, false);
});

test('A-02 level follows the status band: 4xx warning, 502-504 info, else error', () => {
	assert.equal(new UnauthenticatedError().level, 'warning');
	assert.equal(new NotFoundError('x').level, 'warning');
	assert.equal(new ServiceUnavailableError('x').level, 'info');
	assert.equal(new InternalServerError().level, 'error');
	assert.equal(new NotImplementedError('x').level, 'error', '501 is not in the 502-504 band');
});

test('errorCode defaults to httpStatusCode', () => {
	assert.equal(new UnauthenticatedError().errorCode, 401);
	assert.equal(new ConflictError('x').errorCode, 409);
	assert.equal(new UnprocessableRequestError('x').errorCode, 422);
	assert.equal(new TooManyRequestsError('x').errorCode, 429);
	assert.equal(new ContentTooLargeError('x').errorCode, 413);
	assert.equal(new ForbiddenError().errorCode, 403);
});

test('A-03 an explicit undefined still falls back to the status code', () => {
	// TypeScript default parameters fire on `undefined`, so `BadRequestError(m)`
	// — which forwards `undefined` — yields errorCode 400, not undefined.
	assert.equal(new BadRequestError('bad').errorCode, 400);
	assert.equal(new BadRequestError('bad', 0).errorCode, 0, 'only an explicit falsy value survives');
	assert.equal(new ServiceUnavailableError('x').errorCode, 503);
	assert.equal(new ServiceUnavailableError('x', 0).errorCode, 0);
});

test('default messages and hints are pinned', () => {
	assert.equal(new UnauthenticatedError().message, 'Unauthenticated');
	assert.equal(new ForbiddenError().message, 'Forbidden');
	assert.equal(new InternalServerError().message, 'Internal Server Error');
	assert.equal(new InternalServerError('boom').message, 'boom');
	assert.equal(new UnauthenticatedError('x', 'a hint').hint, 'a hint');
});

test('NotFoundError.isDefinedAndNotNull only throws on null/undefined', () => {
	assert.doesNotThrow(() => NotFoundError.isDefinedAndNotNull(0, 'zero'));
	assert.doesNotThrow(() => NotFoundError.isDefinedAndNotNull('', 'empty'));
	assert.doesNotThrow(() => NotFoundError.isDefinedAndNotNull(false, 'false'));
	assert.throws(() => NotFoundError.isDefinedAndNotNull(null, 'gone'), NotFoundError);
	assert.throws(() => NotFoundError.isDefinedAndNotNull(undefined, 'gone'), NotFoundError);
	assert.throws(() => NotFoundError.isDefinedAndNotNull(null, 'gone'), { message: 'gone' });
});

test('cause is preserved through the Error constructor', () => {
	const cause = new Error('root cause');
	assert.equal(new InternalServerError('boom', cause).cause, cause);
});
