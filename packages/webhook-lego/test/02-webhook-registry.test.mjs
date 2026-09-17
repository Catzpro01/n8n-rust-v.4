/**
 * Webhook LEGO — registry + helper behaviour (reference port).
 *
 * The values below were read off the pinned runtime first: `NodeHelpers.getNodeWebhookPath/Url` and
 * `WebhookPathTakenError` from `n8n-workflow@2.9.1` were executed, and the CLI-only pieces were taken
 * from the reference source. `npm run webhook:check` (`tools/webhook-isolation-gate.mjs`, W01-W07)
 * re-proves all of it on every run; this suite keeps the same facts offline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(PKG, '..', '..');
const engine = await import(join(REPO, 'packages/reconstructed-engine/src/webhook-engine.ts'));
const {
	WebhookPathTakenError,
	WebhookRegistry,
	WebhookResponseHeaders,
	WorkflowActivationError,
	collectNodeWebhooks,
	extractWebhookOnReceivedResponse,
	getNodeWebhookPath,
	getNodeWebhookUrl,
	getWebhookPath,
	isDynamicPath,
	isDynamicWebhookPath,
	sanitizeWebhookRequest,
	staticSegmentsOf,
	webhookNotFoundErrorMessage,
	webhookNotFoundPayload,
} = engine;

const webhookNodeType = engine.WEBHOOK_NODE_TYPE;

test('getNodeWebhookPath namespaces by workflow + node name, or by webhookId', () => {
	assert.equal(getNodeWebhookPath('wf-1', { name: 'My Node' }, 'hook'), 'wf-1/my%20node/hook');
	assert.equal(getNodeWebhookPath('wf-1', { name: 'Ünïcode NODE' }, 'hook'), `wf-1/${encodeURIComponent('ünïcode node')}/hook`);
	assert.equal(getNodeWebhookPath('wf-1', { name: 'N', webhookId: 'uuid-1' }, 'hook'), 'uuid-1/hook');
	assert.equal(getNodeWebhookPath('wf-1', { name: 'N', webhookId: 'uuid-1' }, 'hook', true), 'hook', 'a full path is returned untouched');
	assert.equal(getNodeWebhookPath('wf-1', { name: 'N', webhookId: 'uuid-1' }, '', true), 'uuid-1', 'empty full path falls back to the webhook id');
	assert.equal(getNodeWebhookPath('wf-1', { name: 'N' }, 'hook', false, true), 'hook', 'a restart webhook keeps the raw path');
	assert.equal(getNodeWebhookPath('', { name: 'N' }, '', undefined, undefined), '/n/', 'an empty workflow id still namespaces');
});

test('getNodeWebhookUrl trims a leading slash and forces the webhookId prefix for `:params`', () => {
	assert.equal(getNodeWebhookUrl('http://localhost:5678', 'wf-1', { name: 'N' }, 'hook'), 'http://localhost:5678/wf-1/n/hook');
	assert.equal(getNodeWebhookUrl('http://localhost:5678', 'wf-1', { name: 'N' }, '/hook'), 'http://localhost:5678/wf-1/n/hook');
	assert.equal(
		getNodeWebhookUrl('http://localhost:5678', 'wf-1', { name: 'N', webhookId: 'uuid-1' }, 'user/:id/posts', true),
		'http://localhost:5678/uuid-1/user/:id/posts',
		'a dynamic path always keeps the webhookId, even when isFullPath is requested',
	);
	assert.equal(getNodeWebhookUrl('http://localhost:5678', 'wf-1', { name: 'N' }, ':id'), 'http://localhost:5678/wf-1/n/:id');
});

test('WebhookPathTakenError is an activation error with level warning', () => {
	const error = new WebhookPathTakenError('Node X', new Error('cause'));
	assert.equal(error.message, 'The URL path that the "Node X" node uses is already taken. Please change it to something else.');
	assert.equal(error.name, 'WebhookPathTakenError');
	assert.equal(error.level, 'warning');
	assert.ok(error instanceof WorkflowActivationError, 'the reference class extends WorkflowActivationError');
	assert.equal(error.cause, undefined, 'ApplicationError does not expose the cause');
});

test('the registry matches static paths first, then dynamic `<webhookId>/…` paths', () => {
	const registry = new WebhookRegistry();
	registry.storeWebhook({ workflowId: 'wf1', webhookPath: 'simple', method: 'GET', node: 'Static' });
	registry.storeWebhook({ workflowId: 'wf2', webhookPath: 'user/:id/posts', method: 'GET', node: 'Dynamic', webhookId: 'uuid-c' });
	registry.storeWebhook({ workflowId: 'wf2', webhookPath: ':id/posts', method: 'GET', node: 'CatchAll', webhookId: 'uuid-c' });
	registry.storeWebhook({ workflowId: 'wf2', webhookPath: 'user/:id', method: 'GET', node: 'Shorter', webhookId: 'uuid-c' });

	assert.equal(registry.findWebhook('GET', 'simple').node, 'Static');
	assert.equal(registry.findWebhook('GET', 'uuid-c/user/123/posts').node, 'Dynamic', 'most static segments win');
	assert.equal(registry.findWebhook('GET', 'uuid-c/user/123').node, 'Shorter', 'the segment count must match');
	assert.equal(registry.findWebhook('GET', 'uuid-c/123/posts').node, 'CatchAll', 'the `:var`-only row matches anything');
	assert.equal(registry.findWebhook('GET', 'uuid-other/user/123/posts'), null, 'a different webhookId never matches');
	assert.equal(registry.findWebhook('POST', 'uuid-c/user/123/posts'), null, 'the method must match');
	assert.equal(registry.findWebhook('GET', 'uuid-c/user/123/comments'), null);
});

test('registry stores upsert by method + path and deletes per workflow', () => {
	const registry = new WebhookRegistry();
	const stored = registry.storeWebhook({ workflowId: 'wf1', webhookPath: 'x', method: 'GET', node: 'first' });
	assert.equal(stored.pathLength, 1);
	assert.deepEqual(stored.staticSegments, ['x']);

	registry.storeWebhook({ workflowId: 'wf2', webhookPath: 'x', method: 'GET', node: 'second' });
	assert.equal(registry.allWebhooks().length, 1, 'the reference upserts on (method, webhookPath)');
	assert.equal(registry.findWebhook('GET', 'x').node, 'second');

	registry.storeWebhook({ workflowId: 'wf2', webhookPath: 'y', method: 'GET', node: 'other' });
	assert.deepEqual(registry.getWebhookMethods('x'), ['GET']);
	assert.deepEqual(registry.getWebhookMethods('uuid-unknown'), []);

	assert.equal(registry.deleteWorkflowWebhooks('wf2'), 2);
	assert.deepEqual(registry.allWebhooks(), []);
	assert.equal(registry.webhooks.size, 0, 'the cache view is cleared too');
});

test('getWebhookMethods prefers static rows and falls back to a dynamic lookup', () => {
	const registry = new WebhookRegistry();
	registry.storeWebhook({ workflowId: 'wf1', webhookPath: 'multi', method: 'GET', node: 'A' });
	registry.storeWebhook({ workflowId: 'wf1', webhookPath: 'multi', method: 'POST', node: 'A' });
	registry.storeWebhook({ workflowId: 'wf2', webhookPath: 'user/:id', method: 'PATCH', node: 'B', webhookId: 'uuid-b' });

	assert.deepEqual(registry.getWebhookMethods('multi'), ['GET', 'POST']);
	assert.deepEqual(registry.getWebhookMethods('uuid-b/user/7'), ['PATCH']);
	assert.deepEqual(registry.getWebhookMethods('nope'), []);
});

test('path helpers mirror the reference predicates', () => {
	assert.equal(isDynamicPath('uuid/user/:id'), true);
	assert.equal(isDynamicPath('uuid/:id'), true);
	assert.equal(isDynamicPath('uuid'), false);
	assert.equal(isDynamicPath('uuid/:id'), true);
	// With a single segment there is no webhook id to strip, so the reference matches `:id` directly.
	assert.equal(isDynamicPath(':id'), true);
	assert.equal(isDynamicPath('uuid/:'), false);
	assert.equal(getWebhookPath({ path: 'user/:id', webhookId: 'uuid' }), 'uuid/user/:id');
	assert.equal(getWebhookPath({ path: 'user/posts', webhookId: 'uuid' }), 'user/posts');
	assert.deepEqual(staticSegmentsOf('user/:id/posts'), ['user', 'posts']);
	assert.equal(isDynamicWebhookPath('user/:id'), true);
	assert.equal(isDynamicWebhookPath('user/id'), false);
});

test('collectNodeWebhooks follows getNodeWebhooks (disabled nodes, multi-method, defaults)', () => {
	const resolve = (node, parameter, _mode, _runData, _fallback, defaultValue) =>
		parameter === undefined ? defaultValue : (node.parameters?.[parameter] ?? defaultValue);
	const descriptions = [{ path: 'path', httpMethod: 'httpMethod', isFullPath: 'isFullPath', restartWebhook: 'restartWebhook' }];

	const simple = collectNodeWebhooks({ workflowId: 'wf', node: { name: 'Simple', parameters: { path: 'my-path', httpMethod: 'GET' } }, webhooks: descriptions, resolveParameter: resolve });
	assert.deepEqual(simple.map((entry) => [entry.httpMethod, entry.path, entry.webhookId ?? null]), [['GET', 'wf/simple/my-path', null]]);

	const multi = collectNodeWebhooks({ workflowId: 'wf', node: { name: 'Multi', parameters: { path: 'm', httpMethod: 'GET,POST' } }, webhooks: descriptions, resolveParameter: resolve });
	assert.deepEqual(multi.map((entry) => entry.httpMethod), ['GET', 'POST'], 'comma separated methods are split');

	const defaulted = collectNodeWebhooks({ workflowId: undefined, node: { name: 'D', parameters: { path: 'd' } }, webhooks: descriptions, resolveParameter: resolve });
	assert.equal(defaulted[0].httpMethod, 'GET', 'the httpMethod default is GET');
	assert.equal(defaulted[0].path, '__UNSAVED__/d/d', 'an unsaved workflow uses the reference placeholder');

	const dynamic = collectNodeWebhooks({ workflowId: 'wf', node: { name: 'Dyn', webhookId: 'uuid-d', parameters: { path: 'user/:id/posts' } }, webhooks: descriptions, resolveParameter: resolve });
	assert.equal(dynamic[0].webhookId, 'uuid-d', 'dynamic paths carry the node webhook id');
	assert.equal(dynamic[0].path, 'uuid-d/user/:id/posts');

	const disabled = collectNodeWebhooks({ workflowId: 'wf', node: { name: 'Off', disabled: true, parameters: { path: 'x' } }, webhooks: descriptions, resolveParameter: resolve });
	assert.deepEqual(disabled, [], 'disabled nodes register nothing');

	// `ignoreRestartWebhooks` compares the *description field* with the literal `true`, not the
	// resolved parameter value — with a parameter-name description the entry is still collected.
	const parameterNamedRestart = collectNodeWebhooks({ workflowId: 'wf', node: { name: 'R', webhookId: 'uuid-r', parameters: { path: 'restart', restartWebhook: true } }, webhooks: descriptions, resolveParameter: resolve, ignoreRestartWebhooks: true });
	assert.equal(parameterNamedRestart.length, 1, 'a parameter-name description is not skipped');

	const literalRestart = collectNodeWebhooks({
		workflowId: 'wf',
		node: { name: 'R', webhookId: 'uuid-r', parameters: { path: 'restart' } },
		webhooks: [{ path: 'path', httpMethod: 'httpMethod', restartWebhook: true }],
		resolveParameter: resolve,
		ignoreRestartWebhooks: true,
	});
	assert.deepEqual(literalRestart, [], 'a literal `restartWebhook: true` description is skipped');
});

test('request sanitizer strips the auth + browser-id cookies only', () => {
	const request = { headers: { cookie: 'n8n-auth=abc; n8n-browserId=x; keep=1', other: 'h' }, cookies: { 'n8n-auth': 'abc', 'n8n-browserId': 'x', keep: '1' } };
	sanitizeWebhookRequest(request);
	assert.equal(request.headers.cookie, 'keep=1');
	assert.deepEqual(request.cookies, { keep: '1' });

	const untouched = { headers: { cookie: 'a=1' }, cookies: null };
	sanitizeWebhookRequest(untouched);
	assert.equal(untouched.headers.cookie, 'a=1');
	assert.equal(untouched.cookies, null);

	const nonString = { headers: { cookie: 42 }, cookies: { 'n8n-auth': 'z' } };
	sanitizeWebhookRequest(nonString);
	assert.equal(nonString.headers.cookie, 42, 'only string headers are rewritten');
	assert.deepEqual(nonString.cookies, {}, 'parsed cookies are still cleaned');
});

test('onReceived response extraction and the not-found payload', () => {
	assert.equal(extractWebhookOnReceivedResponse('noData', {}), undefined);
	assert.equal(extractWebhookOnReceivedResponse('direct', {}), 'direct');
	assert.deepEqual(extractWebhookOnReceivedResponse(undefined, { webhookResponse: { ok: true } }), { ok: true });
	assert.deepEqual(extractWebhookOnReceivedResponse(undefined, {}), { message: 'Workflow was started' });

	assert.equal(webhookNotFoundErrorMessage({ path: 'x' }), 'The requested webhook "x" is not registered.');
	assert.equal(webhookNotFoundErrorMessage({ path: 'x', httpMethod: 'GET' }), 'The requested webhook "GET x" is not registered.');
	assert.equal(
		webhookNotFoundErrorMessage({ path: 'x', httpMethod: 'PUT', webhookMethods: ['GET', 'POST'] }),
		'This webhook is not registered for PUT requests. Did you mean to make a GET or POST request?',
	);

	const wrongMethod = ['GET', 'POST', 'PATCH'];
	webhookNotFoundErrorMessage({ path: 'x', httpMethod: 'DELETE', webhookMethods: wrongMethod });
	assert.deepEqual(wrongMethod, ['GET', 'POST'], 'the reference mutates the caller array with pop()');

	const payload = webhookNotFoundPayload({ path: 'x', httpMethod: 'GET' }, { hint: 'production' });
	assert.equal(payload.httpStatusCode, 404);
	assert.match(payload.hint, /production URL/);
	assert.equal(webhookNotFoundPayload({ path: 'x', httpMethod: 'GET', webhookMethods: ['POST'] }).hint, '', 'a wrong-method error carries no hint');
});

test('WebhookResponseHeaders drops protected + invalid headers and lower-cases keys', () => {
	const warnings = [];
	const headers = new WebhookResponseHeaders({ warn: (message) => warnings.push(message) });

	headers.addFromObject({ 'Content-Type': 'application/json', 'Content-Security-Policy': 'default-src none' });
	headers.addFromNodeHeaders({ entries: [{ name: 'X-Node', value: 'yes' }] });
	headers.set('X-Numbers', 42);
	headers.set('X-Bad', 'line\r\nbreak');
	headers.set('X-Also-Bad', 'ok\u0000');

	// `set()` stores the value untouched (the reference signature is string-only, so a JS caller
	// passing a number stores a number); only `addFromObject` / node headers stringify.
	assert.deepEqual(Object.fromEntries(headers.toMap()), { 'content-type': 'application/json', 'x-node': 'yes', 'x-numbers': 42 });
	assert.equal(headers.toMap().has('content-security-policy'), false, 'protected headers are dropped');
	assert.equal(warnings.length, 2, 'invalid header values are warned, not thrown');

	const applied = [];
	headers.applyToResponse({ setHeaders: (map) => applied.push(map) });
	assert.equal(applied.length, 1);
	assert.equal(new WebhookResponseHeaders().applyToResponse({ setHeaders: () => applied.push('never') }) === undefined, true, 'nothing is applied when there are no headers');
	assert.equal(applied.length, 1);
});

test('the LEGO exports the webhook node type constants used by the registry', () => {
	assert.equal(webhookNodeType, 'n8n-nodes-base.webhook');
	assert.equal(engine.RESPOND_TO_WEBHOOK_NODE_TYPE, 'n8n-nodes-base.respondToWebhook');
});
