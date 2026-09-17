import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveWebhookManager, WebhookHttpServer, WebhookRequestHandler, WebhookService } from '../src/index.mjs';

async function fixture({ bodyLimit, execute } = {}) {
  const service = new WebhookService();
  await service.storeWebhook(service.createWebhook({ workflowId: 'wf', webhookId: 'uuid', webhookPath: 'items/:id', method: 'POST' }));
  const manager = new LiveWebhookManager({ service, execute: execute ?? (async ({ request }) => ({ body: { id: request.params.id, query: request.query, body: request.body } })) });
  const server = new WebhookHttpServer({ handler: new WebhookRequestHandler(), manager, basePath: 'webhook', bodyLimit });
  const address = await server.listen({ host: '127.0.0.1' });
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test('HTTP transport routes JSON, query, and dynamic path parameters', async (t) => {
  const { server, url } = await fixture(); t.after(() => server.close());
  const response = await fetch(`${url}/webhook/uuid/items/7?mode=fast`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: '7', query: { mode: 'fast' }, body: { ok: true } });
});

test('OPTIONS crosses the native server and returns CORS metadata', async (t) => {
  const { server, url } = await fixture(); t.after(() => server.close());
  const response = await fetch(`${url}/webhook/uuid/items/7`, { method: 'OPTIONS', headers: { origin: 'https://editor.test' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://editor.test');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
});

test('invalid JSON returns a deterministic 400 before execution', async (t) => {
  let executions = 0;
  const { server, url } = await fixture({ execute: async () => { executions++; } }); t.after(() => server.close());
  const response = await fetch(`${url}/webhook/uuid/items/7`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: 0, message: 'Invalid JSON in webhook request body' });
  assert.equal(executions, 0);
});

test('body limit returns 413 and does not execute a workflow', async (t) => {
  let executions = 0;
  const { server, url } = await fixture({ bodyLimit: 4, execute: async () => { executions++; } }); t.after(() => server.close());
  const response = await fetch(`${url}/webhook/uuid/items/7`, { method: 'POST', body: '12345' });
  assert.equal(response.status, 413);
  assert.match((await response.json()).message, /exceeds 4 bytes/);
  assert.equal(executions, 0);
});

test('binary responses and custom status/headers pass through unchanged', async (t) => {
  const { server, url } = await fixture({ execute: async () => ({ statusCode: 201, headers: { 'content-type': 'application/octet-stream', 'x-webhook': 'yes' }, body: Buffer.from([1, 2, 3]) }) });
  t.after(() => server.close());
  const response = await fetch(`${url}/webhook/uuid/items/7`, { method: 'POST' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-webhook'), 'yes');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});

test('base-path isolation and close lifecycle are explicit', async () => {
  const { server, url } = await fixture();
  const response = await fetch(`${url}/outside/uuid/items/7`, { method: 'POST' });
  assert.equal(response.status, 404);
  assert.match((await response.json()).message, /outside the configured base path/);
  assert.equal(await server.close(), true);
  assert.equal(await server.close(), false);
});
