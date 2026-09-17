import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LiveWebhookManager,
  TestWebhookRegistry,
  WebhookRequestHandler,
  WebhookService,
} from '../src/index.mjs';

async function setup() {
  const service = new WebhookService();
  await service.storeWebhook(service.createWebhook({ workflowId: 'wf', webhookPath: 'hook', method: 'POST', node: 'Webhook' }));
  return service;
}

test('stores, resolves, upserts, and deletes static webhooks', async () => {
  const service = await setup();
  assert.equal((await service.findWebhook('POST', 'hook')).workflowId, 'wf');
  assert.equal(await service.findWebhook('GET', 'hook'), null);
  assert.deepEqual(await service.getWebhookMethods('hook'), ['POST']);
  await service.storeWebhook(service.createWebhook({ workflowId: 'replacement', webhookPath: 'hook', method: 'POST' }));
  assert.equal((await service.findWebhook('POST', 'hook')).workflowId, 'replacement');
  await service.deleteWorkflowWebhooks('replacement');
  assert.equal(await service.findWebhook('POST', 'hook'), null);
});

test('dynamic routing uses webhookId, path length, and most static segments', async () => {
  const service = new WebhookService();
  await service.storeWebhook(service.createWebhook({ workflowId: 'specific', webhookPath: 'users/:id', method: 'GET', webhookId: 'uuid' }));
  await service.storeWebhook(service.createWebhook({ workflowId: 'fallback', webhookPath: ':one/:two', method: 'GET', webhookId: 'uuid' }));
  assert.equal((await service.findWebhook('GET', 'uuid/users/42')).workflowId, 'specific');
  assert.equal((await service.findWebhook('GET', 'uuid/a/b')).workflowId, 'fallback');
  assert.equal(await service.findWebhook('GET', 'uuid/users'), null);
  assert.deepEqual(service.extractPathParameters(await service.findWebhook('GET', 'uuid/users/42'), 'uuid/users/42'), { id: '42' });
});

test('live manager builds dynamic params and crosses execution port', async () => {
  const service = new WebhookService();
  await service.storeWebhook(service.createWebhook({ workflowId: 'wf', webhookPath: 'orders/:id', method: 'POST', webhookId: 'uuid' }));
  const manager = new LiveWebhookManager({ service, execute: async ({ request, webhook }) => ({
    body: { workflowId: webhook.workflowId, id: request.params.id, executionMode: 'production' },
  }) });
  const response = await manager.executeWebhook({ method: 'POST', path: 'uuid/orders/7' });
  assert.deepEqual(response.body, { workflowId: 'wf', id: '7', executionMode: 'production' });
});

test('request handler returns default onReceived response', async () => {
  const service = await setup();
  const manager = new LiveWebhookManager({ service, execute: async () => ({}) });
  const response = await new WebhookRequestHandler().handle({ method: 'POST', path: 'hook', headers: {} }, manager);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { message: 'Workflow was started' });
});

test('wrong method and unknown route produce exact production errors', async () => {
  const service = await setup();
  const manager = new LiveWebhookManager({ service, execute: async () => ({}) });
  const handler = new WebhookRequestHandler();
  const wrong = await handler.handle({ method: 'GET', path: 'hook' }, manager);
  assert.equal(wrong.statusCode, 404);
  assert.equal(wrong.body.message, 'This webhook is not registered for GET requests. Did you mean to make a POST request?');
  const missing = await handler.handle({ method: 'POST', path: 'missing' }, manager);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.message, 'The requested webhook "POST missing" is not registered.');
  assert.match(missing.body.hint, /^The workflow must be active/);
});

test('unsupported methods preserve the reference 500 response', async () => {
  const response = await new WebhookRequestHandler().handle({ method: 'PROPFIND', path: 'hook' }, {});
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { code: 0, message: 'The method PROPFIND is not supported.' });
});

test('OPTIONS returns CORS metadata without executing workflow', async () => {
  const service = await setup();
  let executions = 0;
  const manager = new LiveWebhookManager({ service, execute: async () => { executions++; } });
  const response = await new WebhookRequestHandler().handle({ method: 'OPTIONS', path: 'hook', headers: { origin: 'http://example.test' } }, manager);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-methods'], 'OPTIONS, POST');
  assert.equal(response.headers['access-control-allow-origin'], 'http://example.test');
  assert.equal(response.headers['access-control-max-age'], '300');
  assert.equal(executions, 0);
});

test('test webhook registration is one-shot and has the editor hint', async () => {
  const registry = new TestWebhookRegistry();
  registry.register({ method: 'POST', path: 'listen', execute: async () => ({ body: { heard: true } }) });
  assert.deepEqual(registry.getWebhookMethods('listen'), ['POST']);
  assert.deepEqual((await registry.executeWebhook({ method: 'POST', path: 'listen' })).body, { heard: true });
  await assert.rejects(
    () => registry.executeWebhook({ method: 'POST', path: 'listen' }),
    (error) => error.statusCode === 404 && /^Click the 'Execute workflow' button/.test(error.hint),
  );
});

test('test webhook registration expires and invokes timeout callback', () => {
  let scheduled;
  let timedOut = 0;
  const registry = new TestWebhookRegistry({ setTimer: (fn) => { scheduled = fn; return 1; }, clearTimer() {} });
  registry.register({ method: 'POST', path: 'listen', execute() {}, onTimeout: () => timedOut++ });
  scheduled();
  assert.equal(timedOut, 1);
  assert.deepEqual(registry.getWebhookMethods('listen'), []);
});

test('conflict detection catches cross-workflow and same-workflow duplicates', async () => {
  const service = await setup();
  const external = await service.findConflicts([{ httpMethod: 'POST', path: 'hook', node: 'A' }], 'other');
  assert.equal(external.length, 1);
  const duplicates = await service.findConflicts([
    { httpMethod: 'GET', path: 'same', node: 'A' },
    { httpMethod: 'GET', path: 'same', node: 'B' },
  ], 'wf');
  assert.equal(duplicates.length, 1);
});
