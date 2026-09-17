import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { extractWebhookLastNodeResponse, extractWebhookOnReceivedResponse } from '../src/index.mjs';

const task = (main) => ({ data: { main } });

test('onReceived response follows noData, explicit, webhook, and default precedence', () => {
  assert.equal(extractWebhookOnReceivedResponse('noData', { webhookResponse: 'ignored' }), undefined);
  assert.equal(extractWebhookOnReceivedResponse('explicit', { webhookResponse: 'ignored' }), 'explicit');
  assert.deepEqual(extractWebhookOnReceivedResponse(undefined, { webhookResponse: { from: 'node' } }), { from: 'node' });
  assert.deepEqual(extractWebhookOnReceivedResponse(undefined, {}), { message: 'Workflow was started' });
});

test('firstEntryJson returns first item and supports nested response property', async () => {
  const result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryJson', taskData: task([[{ json: { nested: { value: 3 } } }]]), responsePropertyName: 'nested.value', responseContentType: 'text/plain' });
  assert.deepEqual(result, { ok: true, result: { type: 'static', body: 3, contentType: 'text/plain' } });
});

test('firstEntryJson preserves first-output compatibility unless all outputs are enabled', async () => {
  const taskData = task([[], [{ json: { second: true } }]]);
  let result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryJson', taskData });
  assert.equal(result.ok, false); assert.equal(result.error.message, 'No item to return was found');
  result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryJson', taskData, checkAllMainOutputs: true });
  assert.deepEqual(result.result.body, { second: true });
});

test('firstEntryBinary reports missing item and binary data distinctly', async () => {
  let result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryBinary', taskData: task([[]]), responseBinaryPropertyName: 'data' });
  assert.equal(result.error.message, 'No item was found to return');
  result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryBinary', taskData: task([[{ json: {} }]]), responseBinaryPropertyName: 'data' });
  assert.equal(result.error.message, 'No binary data was found to return');
});

test('firstEntryBinary validates property name and existence with exact errors', async () => {
  const taskData = task([[{ json: {}, binary: { data: { data: '', mimeType: 'text/plain' } } }]]);
  let result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryBinary', taskData });
  assert.equal(result.error.message, "No 'responseBinaryPropertyName' is set");
  result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryBinary', taskData, responseBinaryPropertyName: 3 });
  assert.equal(result.error.message, "'responseBinaryPropertyName' is not a string");
  result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryBinary', taskData, responseBinaryPropertyName: 'missing' });
  assert.equal(result.error.message, "The binary property 'missing' which should be returned does not exist");
});

test('firstEntryBinary decodes in-memory base64 and gives MIME type precedence', async () => {
  const result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryBinary', taskData: task([[{ json: {}, binary: { file: { data: Buffer.from('hello').toString('base64'), mimeType: 'text/plain' } } }]]), responseBinaryPropertyName: 'file' });
  assert.equal(result.ok, true); assert.equal(result.result.type, 'static');
  assert.deepEqual(result.result.body, Buffer.from('hello')); assert.equal(result.result.contentType, 'text/plain');
});

test('firstEntryBinary resolves persisted data through binary stream port', async () => {
  const stream = Readable.from(['stored']); const ids = [];
  const result = await extractWebhookLastNodeResponse({ responseDataType: 'firstEntryBinary', taskData: task([[{ json: {}, binary: { data: { id: 'id-1', data: '', mimeType: 'image/png' } } }]]), responseBinaryPropertyName: 'data', getBinaryStream: async (id) => { ids.push(id); return stream; } });
  assert.equal(result.ok, true); assert.equal(result.result.type, 'stream'); assert.equal(result.result.stream, stream);
  assert.deepEqual(ids, ['id-1']); assert.equal(result.result.contentType, 'image/png');
});

test('allEntries defaults to first main output and extracts every JSON item', async () => {
  const result = await extractWebhookLastNodeResponse({ responseDataType: 'allEntries', taskData: task([[{ json: { a: 1 } }, { json: { b: 2 } }], [{ json: { ignored: true } }]]) });
  assert.deepEqual(result, { ok: true, result: { type: 'static', body: [{ a: 1 }, { b: 2 }], contentType: undefined } });
});

test('allEntries can scan later outputs and returns empty array when none has data', async () => {
  let result = await extractWebhookLastNodeResponse({ responseDataType: 'allEntries', taskData: task([[], [{ json: { found: true } }]]), checkAllMainOutputs: true });
  assert.deepEqual(result.result.body, [{ found: true }]);
  result = await extractWebhookLastNodeResponse({ taskData: task([[], []]) });
  assert.deepEqual(result.result.body, []);
});

test('noData returns a successful static undefined response', async () => {
  assert.deepEqual(await extractWebhookLastNodeResponse({ responseDataType: 'noData', taskData: task([]) }), { ok: true, result: { type: 'static', body: undefined, contentType: undefined } });
});
