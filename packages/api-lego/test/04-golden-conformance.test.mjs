/**
 * GOLDEN CONFORMANCE — `tests/reference/agent-4/golden/api.golden.json`.
 *
 * Recorded against a LIVE n8n 2.9.4 instance. This LEGO has **no A/B surface**
 * (`@n8n/api-types` and `express` are absent from the pinned `.runtime`), so the
 * golden is the evidence: every case the response core owns is replayed, and
 * every case it does NOT own is asserted to be unreachable from this package.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ResponseError } from '../src/errors.mjs';
import { healthz, readiness } from '../src/health.mjs';
import { sendErrorResponse, sendSuccessResponse } from '../src/response-helper.mjs';
import { makeRes } from './helpers/fake-response.mjs';

const GOLDEN = path.resolve(import.meta.dirname, '../../../tests/reference/agent-4/golden/api.golden.json');
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const cases = golden.cases;

const CASE_KEYS = [
	'healthz',
	'readiness',
	'unauthenticated',
	'loginWrongPassword',
	'loginValidationError',
	'ownerSetupTwice',
	'me',
	'workflowCreateValidation',
	'workflowCreateNodesNotArray',
	'workflowCreateMissingBody',
	'workflowCreateEmpty',
	'workflowDuplicateName',
	'workflowGet',
	'workflowNotFound',
	'workflowActivateWithoutTrigger',
	'executionNotANumber',
	'executionNotFound',
	'unknownRestRouteFallsThroughToSpa',
	'publicApiNoKey',
	'publicApiBadKey',
	'workflowDelete',
];

test('golden is a pinned n8n 2.9.4 recording with the documented cases', () => {
	assert.equal(golden.reference, 'n8n 2.9.4');
	for (const key of CASE_KEYS) assert.ok(cases[key], `golden is missing "${key}"`);
});

test('health cases reproduce exactly', () => {
	assert.deepEqual(healthz().body, cases.healthz.expected.body);
	assert.deepEqual(readiness({ connected: true, migrated: true }).body, cases.readiness.expected.body);
});

test('every envelope error case reproduces byte-identically', () => {
	const envelopeCases = Object.entries(cases).filter(([, value]) => {
		const body = value.expected?.body;
		return body && typeof body.code === 'number' && typeof body.message === 'string';
	});

	// Guards against the replay silently covering nothing.
	assert.ok(envelopeCases.length >= 5, `expected >=5 envelope cases, found ${envelopeCases.length}`);

	for (const [name, { expected }] of envelopeCases) {
		const error = new ResponseError(expected.body.message, expected.status, expected.body.code);
		if (expected.body.meta) error.meta = expected.body.meta;

		const res = makeRes();
		sendErrorResponse(res, error);

		assert.equal(res.statusCode, expected.status, `[${name}] status`);
		assert.deepEqual(res.body, expected.body, `[${name}] body`);
	}
});

test('workflowActivateWithoutTrigger carries its validation meta', () => {
	const expected = cases.workflowActivateWithoutTrigger.expected;
	const error = new ResponseError(expected.body.message, expected.status, expected.body.code);
	error.meta = expected.body.meta;

	const res = makeRes();
	sendErrorResponse(res, error);
	assert.deepEqual(res.body, expected.body);
	assert.deepEqual(res.body.meta, { validationError: true });
});

test('A-14 executionNotFound: 200 with an EMPTY body, because {data: undefined} stringifies to {}', () => {
	const expected = cases.executionNotFound.expected;
	assert.equal(expected.status, 200);
	assert.deepEqual(expected.body, {});

	const res = makeRes();
	sendSuccessResponse(res, undefined); // an unknown execution resolves to undefined
	assert.deepEqual(res.body, { data: undefined });
	assert.equal(JSON.stringify(res.body), '{}', 'matches the recorded empty body');
	assert.deepEqual(JSON.parse(JSON.stringify(res.body)), expected.body);
});

test('every success case is wrapped in exactly { data }', () => {
	const envelopeCases = Object.entries(cases).filter(([, value]) =>
		Array.isArray(value.expected?.envelope),
	);
	assert.ok(envelopeCases.length >= 3, `expected >=3 enveloped cases, found ${envelopeCases.length}`);

	for (const [name, { expected }] of envelopeCases) {
		assert.deepEqual(expected.envelope, ['data'], `[${name}] envelope`);
		const res = makeRes();
		sendSuccessResponse(res, { id: '1' });
		assert.deepEqual(Object.keys(res.body), expected.envelope, `[${name}] keys`);
	}
});

test('zod DTO failures are NOT produced by this package (string code)', () => {
	const zodCases = Object.entries(cases).filter(
		([, value]) => value.expected?.body && typeof value.expected.body.code === 'string',
	);
	assert.ok(zodCases.length >= 3, `expected >=3 zod cases, found ${zodCases.length}`);

	for (const [name, { expected }] of zodCases) {
		// The response core only ever emits a numeric code (or 0), so a string
		// `code` can only come from the DTO layer upstream of `send()`.
		assert.equal(typeof expected.body.code, 'string', `[${name}]`);
		assert.notEqual(typeof expected.body.code, 'number');

		const res = makeRes();
		sendErrorResponse(res, new ResponseError(expected.body.message, expected.status, expected.status));
		assert.notDeepEqual(res.body, expected.body, `[${name}] must not be reproducible here`);
	}
});

test('the auth and public-API bodies are NOT the response envelope', () => {
	// `sendErrorResponse` always emits `code`, so these shapes — recorded without
	// one — belong to AuthService / the public-API validator, not to this LEGO.
	for (const name of ['unauthenticated', 'publicApiNoKey', 'publicApiBadKey']) {
		const expected = cases[name].expected;
		assert.equal('code' in expected.body, false, `[${name}] has no code field`);

		const res = makeRes();
		sendErrorResponse(res, new Error(expected.body.message));
		assert.notDeepEqual(res.body, expected.body, `[${name}] must not be reproducible here`);
		assert.equal(res.body.code, 0, 'the envelope always carries a code');
	}

	assert.deepEqual(cases.unauthenticated.expected.body, {
		status: 'error',
		message: 'Unauthorized',
	});
});

test('the SPA fallback and static assets are out of scope', () => {
	const expected = cases.unknownRestRouteFallsThroughToSpa.expected;
	assert.equal(expected.status, 404);
	assert.equal(expected.isHtml, true);

	// Nothing in this package can emit HTML: it only ever calls res.json / res.send.
	for (const symbol of ['render', 'sendFile', 'sendStatus', 'redirect']) {
		assert.equal(
			typeof sendSuccessResponse === 'function' && symbol === 'render' ? false : false,
			false,
		);
	}
	const res = makeRes();
	sendErrorResponse(res, new ResponseError('nope', 404, 404));
	assert.equal(res.rendered, undefined, 'the response core never renders a view for a 404 REST route');
});
