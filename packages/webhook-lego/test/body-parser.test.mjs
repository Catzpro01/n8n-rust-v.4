import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WebhookHttpServer,
  WebhookRequestHandler,
  getMultipartBoundary,
  parseMultipartFormData,
  parseWebhookBody,
} from '../src/index.mjs';

const multipart = (boundary, parts) => Buffer.concat(parts.flatMap(({ name, filename, type, value }) => [
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename === undefined ? '' : `; filename="${filename}"`}\r\n${type ? `Content-Type: ${type}\r\n` : ''}\r\n`),
  Buffer.isBuffer(value) ? value : Buffer.from(value),
  Buffer.from('\r\n'),
]).concat(Buffer.from(`--${boundary}--\r\n`)));

test('multipart boundary supports quoted and unquoted parameters', () => {
  assert.equal(getMultipartBoundary('multipart/form-data; boundary=abc'), 'abc');
  assert.equal(getMultipartBoundary('multipart/form-data; charset=utf-8; boundary="a b"'), 'a b');
  assert.equal(getMultipartBoundary('text/plain'), undefined);
});

test('multipart parser normalizes single fields and preserves repeated values', async () => {
  const raw = multipart('x', [
    { name: 'one', value: 'value' },
    { name: 'many', value: 'first' },
    { name: 'many', value: 'second' },
  ]);
  const parsed = await parseMultipartFormData(raw, 'multipart/form-data; boundary=x');
  assert.deepEqual(parsed, { data: { one: 'value', many: ['first', 'second'] }, files: {} });
});

test('multipart parser retains binary bytes and file metadata', async () => {
  const bytes = Buffer.from([0, 1, 2, 255, 13, 10]);
  const parsed = await parseMultipartFormData(multipart('bin', [{ name: 'upload', filename: 'data.bin', type: 'application/octet-stream', value: bytes }]), 'multipart/form-data; boundary=bin');
  assert.equal(parsed.files.upload.originalFilename, 'data.bin');
  assert.equal(parsed.files.upload.mimetype, 'application/octet-stream');
  assert.equal(parsed.files.upload.size, bytes.length);
  assert.deepEqual(parsed.files.upload.data, bytes);
});

test('multipart parser preserves repeated files and omits oversized files', async () => {
  const raw = multipart('files', [
    { name: 'upload', filename: 'a.txt', type: 'text/plain', value: 'a' },
    { name: 'upload', filename: 'b.txt', type: 'text/plain', value: 'bb' },
    { name: 'large', filename: 'large.txt', type: 'text/plain', value: 'toolarge' },
  ]);
  const parsed = await parseMultipartFormData(raw, 'multipart/form-data; boundary=files', { maxFileSize: 2 });
  assert.equal(parsed.files.upload.length, 2);
  assert.deepEqual(parsed.files.upload.map((file) => file.originalFilename), ['a.txt', 'b.txt']);
  assert.equal(parsed.files.large, undefined);
});

test('multipart parser rejects missing boundary and malformed bodies', async () => {
  await assert.rejects(() => parseMultipartFormData(Buffer.from('x'), 'multipart/form-data'), (error) => error.statusCode === 400 && /boundary/.test(error.message));
  await assert.rejects(() => parseMultipartFormData(Buffer.from('x'), 'multipart/form-data; boundary=nope'), (error) => error.statusCode === 400 && /Invalid multipart/.test(error.message));
});

test('body parser handles JSON, form-urlencoded repeats, XML, and opaque binary', async () => {
  assert.deepEqual((await parseWebhookBody(Buffer.from('{"ok":true}'), 'application/json')).body, { ok: true });
  assert.deepEqual((await parseWebhookBody(Buffer.from('x=1&x=2&space=a+b'), 'application/x-www-form-urlencoded')).body, { x: ['1', '2'], space: 'a b' });
  assert.equal((await parseWebhookBody(Buffer.from('<x/>'), 'application/xml')).body, '<x/>');
  assert.deepEqual((await parseWebhookBody(Buffer.from([0, 255]), 'application/octet-stream')).body, Buffer.from([0, 255]));
});

test('native HTTP multipart parsing crosses an injected binary storage port', async () => {
  let received; const stored = [];
  const manager = {
    getWebhookMethods: () => ['POST'],
    async executeWebhook(request) { received = request; return { body: { accepted: true } }; },
  };
  const server = new WebhookHttpServer({
    handler: new WebhookRequestHandler(), manager,
    storeFile: async ({ data, ...metadata }) => { stored.push({ data, metadata }); return { ...metadata, id: `memory:${stored.length}` }; },
  });
  const address = await server.listen({ host: '0.0.0.0' });
  try {
    const boundary = 'socket-boundary';
    const raw = multipart(boundary, [
      { name: 'label', value: 'report' },
      { name: 'file', filename: 'report.txt', type: 'text/plain', value: 'hello' },
    ]);
    const response = await fetch(`http://127.0.0.1:${address.port}/upload`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: raw });
    assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(received.body.data.label, 'report');
    assert.equal(received.body.files.file.id, 'memory:1');
    assert.equal(received.files.file.id, 'memory:1');
    assert.deepEqual(received.rawBody, raw);
    assert.deepEqual(stored[0].data, Buffer.from('hello'));
  } finally { await server.close(); }
});
