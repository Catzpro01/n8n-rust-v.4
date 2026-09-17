import assert from 'node:assert/strict';
import test from 'node:test';
import { WaitingWebhookManager, generateWaitingWebhookSignature, validateWaitingWebhookSignature } from '../src/index.mjs';

const execution = (overrides = {}) => ({
  id: '42', status: 'waiting', finished: false, mode: 'webhook',
  workflowData: { nodes: [{ name: 'Wait', type: 'n8n-nodes-base.wait', parameters: { operation: 'wait' } }] },
  data: {
    waitTill: new Date(),
    resultData: { lastNodeExecuted: 'Wait', runData: { Wait: [{ source: [{ previousNode: 'A' }], inputOverride: { main: [[{ json: { x: 1 } }]] } }] } },
    executionData: { nodeExecutionStack: [{ node: { name: 'Wait', type: 'n8n-nodes-base.wait' } }] },
  },
  ...overrides,
});

const manager = (value, options = {}) => new WaitingWebhookManager({
  executionRepository: { async findSingleExecution() { return value; } },
  resolveWebhook: options.resolveWebhook ?? (async () => ({ restartWebhook: true })),
  resumeExecution: options.resumeExecution ?? (async ({ execution: found }) => ({ body: { status: found.status } })),
  signingSecret: 'secret',
});

test('missing, running, failed, and finished executions preserve status errors', async () => {
  await assert.rejects(() => manager(undefined).executeWebhook({ path: '42', method: 'POST' }), (error) => error.statusCode === 404 && /does not exist/.test(error.message));
  await assert.rejects(() => manager(execution({ status: 'running' })).executeWebhook({ path: '42', method: 'POST' }), (error) => error.statusCode === 409 && /running already/.test(error.message));
  const failed = execution(); failed.data.resultData.error = { message: 'boom' };
  await assert.rejects(() => manager(failed).executeWebhook({ path: '42', method: 'POST' }), (error) => error.statusCode === 409 && /finished with error/.test(error.message));
  await assert.rejects(() => manager(execution({ finished: true })).executeWebhook({ path: '42', method: 'POST' }), (error) => error.statusCode === 409 && /finished already/.test(error.message));
});

test('resume disables wait node, clears waitTill, pops prior run, and resets params', async () => {
  const value = execution(); let resumed;
  const result = await manager(value, { resumeExecution: async (payload) => { resumed = payload; return { body: { resumed: true } }; } }).executeWebhook({ path: '42/approved', method: 'POST', params: { path: '42' } });
  assert.deepEqual(result.body, { resumed: true });
  assert.equal(value.data.waitTill, undefined);
  assert.equal(value.data.executionData.nodeExecutionStack[0].node.disabled, true);
  assert.deepEqual(resumed.request.params, {});
  assert.equal(resumed.suffix, 'approved');
  assert.equal(value.data.resultData.runData.Wait.length, 1);
  assert.deepEqual(value.data.resultData.runData.Wait[0].inputOverride, { main: [[{ json: { x: 1 } }]] });
  assert.equal(value.data.resultData.runData.Wait[0].startTime, 0);
});

test('HITL resumes preserve input and rewire output logging to ai_tool', async () => {
  const value = execution(); value.data.executionData.nodeExecutionStack[0].node.type = 'vendorHitlTool';
  await manager(value).executeWebhook({ path: '42', method: 'POST' });
  assert.equal(value.data.executionData.nodeExecutionStack[0].node.rewireOutputLogTo, 'ai_tool');
});

test('missing matching restart webhook returns privacy-preserving 404', async () => {
  await assert.rejects(
    () => manager(execution(), { resolveWebhook: async () => undefined }).executeWebhook({ path: '42/nope', method: 'GET' }),
    (error) => error.statusCode === 404 && /does not contain a waiting webhook/.test(error.message),
  );
});

test('signed send-and-wait request accepts exact URL HMAC and rejects wrong token', async () => {
  const value = execution(); value.data.validateSignature = true; value.workflowData.nodes[0].parameters.operation = 'sendAndWait';
  const unsigned = new URL('http://example.test/webhook-waiting/42?action=yes');
  const signature = generateWaitingWebhookSignature(unsigned, 'secret');
  const good = { path: '42', method: 'POST', host: 'example.test', url: `/webhook-waiting/42?action=yes&signature=${signature}`, query: { action: 'yes', signature } };
  assert.equal(validateWaitingWebhookSignature(good, 'secret'), true);
  assert.deepEqual((await manager(value).executeWebhook(good)).body, { status: 'waiting' });
  const bad = { ...good, query: { action: 'yes', signature: 'wrong' }, url: '/webhook-waiting/42?action=yes&signature=wrong' };
  assert.deepEqual(await manager(execution({ data: value.data, workflowData: value.workflowData })).executeWebhook(bad), { statusCode: 401, body: { error: 'Invalid token' } });
});

test('finished send-and-wait webhook can render no-action result', async () => {
  const value = execution({ finished: true });
  value.workflowData.nodes[0].id = 'node-id';
  value.workflowData.nodes[0].parameters.operation = 'sendAndWait';
  const result = await manager(value).executeWebhook({ path: '42/node-id', method: 'POST' });
  assert.deepEqual(result.body, { message: 'No action is required.' });
});

test('in-flight guard rejects a concurrent second resume', async () => {
  const value = execution(); let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const instance = manager(value, { resumeExecution: async () => { await gate; return {}; } });
  const first = instance.executeWebhook({ path: '42', method: 'POST' });
  await Promise.resolve(); await Promise.resolve();
  await assert.rejects(() => instance.executeWebhook({ path: '42', method: 'POST' }), (error) => error.statusCode === 409);
  release(); await first;
});

test('waiting webhooks allow all form origins and report no method metadata', () => {
  const instance = manager(execution());
  assert.deepEqual(instance.findAccessControlOptions(), { allowedOrigins: '*' });
  assert.deepEqual(instance.getWebhookMethods(), []);
});
