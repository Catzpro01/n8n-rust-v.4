import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  WebhookHttpServer,
  WebhookRequestHandler,
  createNoResponse,
  createStaticResponse,
  createStreamResponse,
  extractResponseNodeResult,
  isWebhookNoResponse,
  isWebhookResponse,
  isWebhookStaticResponse,
  isWebhookStreamResponse,
} from '../src/index.mjs';

const manager = (result) => ({ getWebhookMethods: () => ['GET'], executeWebhook: async () => result });

test('response factories create disjoint tagged response variants', () => {
  const none = createNoResponse();
  const staticResponse = createStaticResponse({ ok: true }, 201, { x: 'static' });
  const streamResponse = createStreamResponse(Readable.from(['x']), 202, { x: 'stream' });
  assert.equal(isWebhookResponse(none), true);
  assert.equal(isWebhookNoResponse(none), true);
  assert.equal(isWebhookStaticResponse(staticResponse), true);
  assert.equal(isWebhookStreamResponse(streamResponse), true);
  assert.equal(isWebhookResponse({ body: 'untagged' }), false);
});

test('request handler translates tagged static status, headers, and body', async () => {
  const result = await new WebhookRequestHandler().handle({ method: 'GET', path: 'x', headers: { origin: 'https://client.test' } }, manager(createStaticResponse({ ok: true }, 201, { 'x-result': 'yes' })));
  assert.equal(result.statusCode, 201);
  assert.equal(result.headers['x-result'], 'yes');
  assert.equal(result.headers['access-control-allow-origin'], 'https://client.test');
  assert.deepEqual(result.body, { ok: true });
});

test('request handler preserves explicitly empty no-response results', async () => {
  const result = await new WebhookRequestHandler().handle({ method: 'GET', path: 'x', headers: {} }, manager(createNoResponse()));
  assert.deepEqual(result, { statusCode: 200, headers: {}, body: undefined });
});

test('response-node extraction keeps JSON and Buffer bodies static', async () => {
  const json = await extractResponseNodeResult({ body: { ok: true }, statusCode: 202, headers: { x: '1' } });
  assert.equal(isWebhookStaticResponse(json), true);
  assert.deepEqual(json.body, { ok: true }); assert.equal(json.code, 202);
  const bytes = Buffer.from([0, 255]);
  const binary = await extractResponseNodeResult({ body: bytes, statusCode: 200 });
  assert.equal(isWebhookStaticResponse(binary), true); assert.deepEqual(binary.body, bytes);
});

test('persisted response-node binary resolves through injected stream port', async () => {
  const ids = [];
  const result = await extractResponseNodeResult({ body: { binaryData: { id: 'binary-123' } }, statusCode: 206, headers: { 'content-type': 'application/octet-stream' } }, {
    getBinaryStream: async (id) => { ids.push(id); return Readable.from([Buffer.from('stored')]); },
  });
  assert.equal(isWebhookStreamResponse(result), true);
  assert.deepEqual(ids, ['binary-123']); assert.equal(result.code, 206);
  let body = ''; for await (const chunk of result.stream) body += chunk;
  assert.equal(body, 'stored');
});

test('persisted response-node binary fails loudly without storage port', async () => {
  await assert.rejects(() => extractResponseNodeResult({ body: { binaryData: { id: 'binary-123' } } }), /binary stream port/);
});

test('native HTTP transport pipes streaming chunks with custom metadata', async () => {
  const stream = Readable.from(['{"type":"begin"}\n', '{"type":"end"}\n']);
  const server = new WebhookHttpServer({
    handler: new WebhookRequestHandler(),
    manager: manager(createStreamResponse(stream, 202, { 'content-type': 'application/x-ndjson', 'x-stream': 'yes' })),
  });
  const address = await server.listen({ host: '0.0.0.0' });
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/stream`);
    assert.equal(response.status, 202); assert.equal(response.headers.get('x-stream'), 'yes');
    assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
    assert.equal(await response.text(), '{"type":"begin"}\n{"type":"end"}\n');
  } finally { await server.close(); }
});
