import assert from 'node:assert/strict';
import test from 'node:test';
import { WebhookRequestHandler, WebhookResponseHeaders, createStaticResponse, normalizeResponseHeaders } from '../src/index.mjs';

test('valid headers are lower-cased and later values replace earlier ones', () => {
  const headers = new WebhookResponseHeaders();
  headers.set('X-Custom', 'first'); headers.set('x-CUSTOM', 'second');
  assert.deepEqual(headers.toObject(), { 'x-custom': 'second' });
});

test('invalid names and control-character values are dropped and reported', () => {
  const warnings = []; const headers = new WebhookResponseHeaders({ logger: { warn: (...args) => warnings.push(args) } });
  headers.set('<script>', 'xss'); headers.set('x-valid', 'bad\0value');
  assert.deepEqual(headers.toObject(), {}); assert.equal(warnings.length, 2);
  assert.ok(warnings.every(([message]) => message === 'Dropping invalid webhook response header'));
});

test('content-security-policy is protected regardless of case', () => {
  const headers = new WebhookResponseHeaders();
  headers.set('Content-Security-Policy', "default-src 'unsafe-inline'");
  headers.set('CONTENT-SECURITY-POLICY', "default-src 'none'");
  assert.deepEqual(headers.toObject(), {});
});

test('fromObject keeps valid entries and stringifies values', () => {
  const headers = WebhookResponseHeaders.fromObject({ 'X-Number': 42, 'x-bool': true, '<bad>': 'drop' });
  assert.deepEqual(headers.toObject(), { 'x-number': '42', 'x-bool': 'true' });
});

test('node header entries are validated and undefined entries are a no-op', () => {
  const headers = new WebhookResponseHeaders();
  headers.addFromNodeHeaders({});
  headers.addFromNodeHeaders({ entries: [{ name: 'X-One', value: '1' }, { name: '<bad>', value: 'x' }] });
  assert.deepEqual(headers.toObject(), { 'x-one': '1' });
});

test('applyToResponse uses bulk setHeaders and is a no-op when empty', () => {
  const calls = []; const response = { setHeaders: (map) => calls.push(map) };
  new WebhookResponseHeaders().applyToResponse(response);
  const headers = WebhookResponseHeaders.fromObject({ 'x-one': '1', 'x-two': '2' });
  headers.applyToResponse(response);
  assert.equal(calls.length, 1); assert.deepEqual([...calls[0]], [['x-one', '1'], ['x-two', '2']]);
});

test('applyToResponse supports native setHeader fallback', () => {
  const calls = []; const headers = WebhookResponseHeaders.fromObject({ 'x-one': '1' });
  headers.applyToResponse({ setHeader: (...args) => calls.push(args) });
  assert.deepEqual(calls, [['x-one', '1']]);
});

test('request handler accepts validated header containers without leaking internals', async () => {
  const headers = WebhookResponseHeaders.fromObject({ 'X-Safe': 'yes', 'Content-Security-Policy': 'unsafe' });
  assert.deepEqual(normalizeResponseHeaders(headers), { 'x-safe': 'yes' });
  const result = await new WebhookRequestHandler().handle(
    { method: 'GET', path: 'x', headers: {} },
    { getWebhookMethods: () => ['GET'], executeWebhook: async () => createStaticResponse('ok', 203, headers) },
  );
  assert.deepEqual(result, { statusCode: 203, headers: { 'x-safe': 'yes' }, body: 'ok' });
});
