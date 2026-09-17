import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	ResponseError,
	BadRequestError,
	NotFoundError,
	ConflictError,
	InternalServerError,
	WorkflowValidationError,
	formatSuccessResponse,
	formatErrorResponse,
	formatUnauthenticatedResponse,
	formatPublicApiError,
	isResponseError,
	formatZodIssue,
	validateDto,
	ApiDispatcher,
} from '../src/index.mjs';

const root = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

test('01. Health endpoints: return { status: "ok" }', async () => {
	const dispatcher = new ApiDispatcher();
	const healthz = await dispatcher.handleRequest({ method: 'GET', path: '/healthz' });
	assert.deepEqual(healthz, { status: 200, body: { status: 'ok' } });

	const readiness = await dispatcher.handleRequest({ method: 'GET', path: '/healthz/readiness' });
	assert.deepEqual(readiness, { status: 200, body: { status: 'ok' } });
});

test('02. Unauthenticated envelope: 401 { status: "error", message: "Unauthorized" }', async () => {
	const dispatcher = new ApiDispatcher({ authValidator: () => false });
	dispatcher.get('/rest/workflows', async () => [{ id: '1' }]);

	const res = await dispatcher.handleRequest({ method: 'GET', path: '/rest/workflows' });
	assert.deepEqual(res, {
		status: 401,
		body: { status: 'error', message: 'Unauthorized' },
	});
});

test('03. Success envelope: wraps objects, booleans, and nulls in { data }', async () => {
	const dispatcher = new ApiDispatcher({ authValidator: () => true });

	dispatcher.get('/rest/data', async () => ({ id: 'wf-1', name: 'Test' }));
	const objRes = await dispatcher.handleRequest({ method: 'GET', path: '/rest/data' });
	assert.deepEqual(objRes, { status: 200, body: { data: { id: 'wf-1', name: 'Test' } } });

	dispatcher.delete('/rest/credentials/:id', async () => true);
	const boolRes = await dispatcher.handleRequest({ method: 'DELETE', path: '/rest/credentials/1' });
	assert.deepEqual(boolRes, { status: 200, body: { data: true } });

	dispatcher.get('/rest/null', async () => null);
	const nullRes = await dispatcher.handleRequest({ method: 'GET', path: '/rest/null' });
	assert.deepEqual(nullRes, { status: 200, body: { data: null } });
});

test('04. Known response errors: { code, message, hint?, meta? }', async () => {
	const badReq = formatErrorResponse(new BadRequestError('Instance owner already setup'));
	assert.deepEqual(badReq, { status: 400, body: { code: 400, message: 'Instance owner already setup' } });

	const notFound = formatErrorResponse(
		new NotFoundError('Could not load the workflow - you can only access workflows owned by you'),
	);
	assert.deepEqual(notFound, {
		status: 404,
		body: { code: 404, message: 'Could not load the workflow - you can only access workflows owned by you' },
	});

	const validationErr = formatErrorResponse(
		new WorkflowValidationError(
			'Workflow cannot be activated because it has no trigger node. At least one trigger, webhook, or polling node is required.',
		),
	);
	assert.deepEqual(validationErr, {
		status: 400,
		body: {
			code: 400,
			message:
				'Workflow cannot be activated because it has no trigger node. At least one trigger, webhook, or polling node is required.',
			meta: { validationError: true },
		},
	});

	const conflict = formatErrorResponse(new ConflictError('Webhook path in use'));
	assert.deepEqual(conflict, { status: 409, body: { code: 409, message: 'Webhook path in use' } });
});

test('05. Unknown error: mapped to 500 { code: 0, message }', () => {
	const genericError = new Error('Database connection failed');
	const res = formatErrorResponse(genericError);
	assert.deepEqual(res, {
		status: 500,
		body: { code: 0, message: 'Database connection failed' },
	});
});

test('06. Zod validation formatting: raw first issue object on 400', () => {
	const issue1 = formatZodIssue({
		code: 'invalid_type',
		expected: 'string',
		received: 'undefined',
		path: ['emailOrLdapLoginId'],
		message: 'Required',
	});
	assert.deepEqual(issue1, {
		code: 'invalid_type',
		expected: 'string',
		received: 'undefined',
		path: ['emailOrLdapLoginId'],
		message: 'Required',
	});

	const issue2 = formatZodIssue({
		code: 'too_small',
		minimum: 1,
		type: 'string',
		inclusive: true,
		exact: false,
		message: 'Workflow name is required',
		path: ['name'],
	});
	assert.deepEqual(issue2, {
		code: 'too_small',
		minimum: 1,
		type: 'string',
		inclusive: true,
		exact: false,
		message: 'Workflow name is required',
		path: ['name'],
	});

	const issue3 = formatZodIssue({
		code: 'custom',
		message: 'Nodes must be an array',
		fatal: true,
		path: ['nodes'],
	});
	assert.deepEqual(issue3, {
		code: 'custom',
		message: 'Nodes must be an array',
		fatal: true,
		path: ['nodes'],
	});
});

test('07. DTO validation integration via validateDto', () => {
	const schema = {
		name: { type: 'string', required: true, minLength: 1, minLengthMessage: 'Workflow name is required' },
		nodes: { type: 'array', required: true, message: 'Nodes must be an array' },
	};

	// Missing name
	const r1 = validateDto(schema, { nodes: [] });
	assert.equal(r1.valid, false);
	assert.deepEqual(r1.error, {
		code: 'invalid_type',
		expected: 'string',
		received: 'undefined',
		path: ['name'],
		message: 'Required',
	});

	// Empty name
	const r2 = validateDto(schema, { name: '', nodes: [] });
	assert.equal(r2.valid, false);
	assert.deepEqual(r2.error, {
		code: 'too_small',
		minimum: 1,
		type: 'string',
		inclusive: true,
		exact: false,
		message: 'Workflow name is required',
		path: ['name'],
	});

	// Nodes not array
	const r3 = validateDto(schema, { name: 'Workflow 1', nodes: 'not-array' });
	assert.equal(r3.valid, false);
	assert.deepEqual(r3.error, {
		code: 'custom',
		message: 'Nodes must be an array',
		fatal: true,
		path: ['nodes'],
	});

	// Valid
	const r4 = validateDto(schema, { name: 'Workflow 1', nodes: [] });
	assert.equal(r4.valid, true);
});

test('08. Resource-specific not-found semantics', async () => {
	const dispatcher = new ApiDispatcher({ authValidator: () => true });

	// Workflow not found -> 404
	dispatcher.get('/rest/workflows/:id', async (req) => {
		if (req.params.id === 'nope') {
			throw new NotFoundError(
				'Could not load the workflow - you can only access workflows owned by you',
			);
		}
		return { id: req.params.id };
	});
	const wfRes = await dispatcher.handleRequest({ method: 'GET', path: '/rest/workflows/nope' });
	assert.equal(wfRes.status, 404);
	assert.deepEqual(wfRes.body, {
		code: 404,
		message: 'Could not load the workflow - you can only access workflows owned by you',
	});

	// Execution not found -> 200 {}
	dispatcher.get('/rest/executions/:id', async (req) => {
		if (req.params.id === '999999') {
			return null;
		}
		return { id: req.params.id };
	});
	const execRes = await dispatcher.handleRequest({ method: 'GET', path: '/rest/executions/999999' });
	assert.equal(execRes.status, 200);
	assert.deepEqual(execRes.body, {});

	// Execution ID not a number -> 400
	const notNumRes = await dispatcher.handleRequest({ method: 'GET', path: '/rest/executions/abc' });
	assert.equal(notNumRes.status, 400);
	assert.deepEqual(notNumRes.body, {
		code: 400,
		message: 'Execution ID is not a number',
	});

	// Unmatched /rest/* route -> 404 with HTML SPA fallback
	const spaRes = await dispatcher.handleRequest({ method: 'GET', path: '/rest/this-does-not-exist' });
	assert.equal(spaRes.status, 404);
	assert.equal(spaRes.isHtml, true);
	assert.match(spaRes.contentType, /^text\/html/);
});

test('09. Public API v1 auth errors', async () => {
	const dispatcher = new ApiDispatcher({ publicApiKeys: new Set(['valid-key-123']) });

	// No key -> 401
	const noKey = await dispatcher.handleRequest({ method: 'GET', path: '/api/v1/workflows' });
	assert.deepEqual(noKey, {
		status: 401,
		body: { message: "'X-N8N-API-KEY' header required" },
	});

	// Bad key -> 401
	const badKey = await dispatcher.handleRequest({
		method: 'GET',
		path: '/api/v1/workflows',
		headers: { 'X-N8N-API-KEY': 'bad-key' },
	});
	assert.deepEqual(badKey, {
		status: 401,
		body: { message: 'unauthorized' },
	});
});

test('10. Reference Golden Parity: matches api.golden.json expectations', () => {
	const golden = JSON.parse(
		readFileSync(join(root, 'tests/reference/agent-4/golden/api.golden.json'), 'utf8'),
	);
	const c = golden.cases;

	assert.deepEqual(c.healthz.expected, { status: 200, body: { status: 'ok' } });
	assert.deepEqual(c.readiness.expected, { status: 200, body: { status: 'ok' } });
	assert.deepEqual(c.unauthenticated.expected, { status: 401, body: { status: 'error', message: 'Unauthorized' } });
	assert.deepEqual(c.loginWrongPassword.expected, { status: 401, body: { code: 401, message: 'Wrong username or password. Do you have caps lock on?' } });
	assert.deepEqual(c.ownerSetupTwice.expected, { status: 400, body: { code: 400, message: 'Instance owner already setup' } });
	assert.deepEqual(c.workflowNotFound.expected, { status: 404, body: { code: 404, message: 'Could not load the workflow - you can only access workflows owned by you' } });
	assert.deepEqual(c.workflowActivateWithoutTrigger.expected, {
		status: 400,
		body: {
			code: 400,
			message: 'Workflow cannot be activated because it has no trigger node. At least one trigger, webhook, or polling node is required.',
			meta: { validationError: true },
		},
	});
	assert.deepEqual(c.executionNotFound.expected, { status: 200, body: {} });
	assert.deepEqual(c.executionNotANumber.expected, { status: 400, body: { code: 400, message: 'Execution ID is not a number' } });
	assert.deepEqual(c.publicApiNoKey.expected, { status: 401, body: { message: "'X-N8N-API-KEY' header required" } });
	assert.deepEqual(c.publicApiBadKey.expected, { status: 401, body: { message: 'unauthorized' } });
});

test('11. Negative control: unhandled error has code 0 and never 500', () => {
	const err = new Error('boom');
	const formatted = formatErrorResponse(err);
	assert.equal(formatted.body.code, 0);
	assert.notEqual(formatted.body.code, 500);
});

test('12. Negative control: unauthenticated does not use { code, message } format', () => {
	const unauth = formatUnauthenticatedResponse();
	assert.equal('code' in unauth.body, false);
	assert.equal(unauth.body.status, 'error');
	assert.equal(unauth.body.message, 'Unauthorized');
});
