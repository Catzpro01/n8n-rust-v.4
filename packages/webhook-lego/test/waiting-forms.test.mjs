import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORM_NODE_TYPE,
  WAIT_NODE_TYPE,
  WEBHOOK_SANDBOX_CSP,
  WaitingFormManager,
  WebhookHttpServer,
  WebhookRequestHandler,
  findCompletionPage,
  renderDefaultFormCompletion,
  sanitizeWaitingFormRequest,
} from '../src/index.mjs';

const form = (name, operation = 'completion', extra = {}) => ({ name, type: FORM_NODE_TYPE, parameters: { operation }, ...extra });
const execution = (overrides = {}) => ({
  id: '42', status: 'waiting', finished: false,
  workflowData: { nodes: [form('Page', 'page')] },
  data: { resultData: { lastNodeExecuted: 'Page', runData: { Page: [{}] } }, executionData: { nodeExecutionStack: [{ node: form('Page', 'page') }] } },
  ...overrides,
});
const setup = (value, options = {}) => {
  const calls = [];
  const manager = new WaitingFormManager({
    executionRepository: { async findSingleExecution() { return value; } },
    getParentNodes: options.getParentNodes ?? (() => []),
    executeFormWebhook: options.executeFormWebhook ?? (async (payload) => { calls.push(payload); return { body: '<form>next</form>', headers: { 'content-type': 'text/html' } }; }),
  });
  return { manager, calls };
};

test('completion selection prefers current enabled completion node', () => {
  const workflow = { nodes: { Done: form('Done') }, getParentNodes: () => [] };
  assert.equal(findCompletionPage(workflow, {}, 'Done'), 'Done');
  workflow.nodes.Done.disabled = true;
  assert.equal(findCompletionPage(workflow, {}, 'Done'), undefined);
});

test('completion selection reverses parents and requires prior run data', () => {
  const workflow = { nodes: { Last: { name: 'Last', type: 'other', parameters: {} }, A: form('A'), B: form('B'), C: form('C', 'page') }, getParentNodes: () => ['A', 'B', 'C'] };
  assert.equal(findCompletionPage(workflow, { A: [], B: [] }, 'Last'), 'B');
  assert.equal(findCompletionPage(workflow, {}, 'Last'), undefined);
});

test('status endpoint reports raw status, missing execution, and form-waiting states', async () => {
  const waiting = execution();
  let result = await setup(waiting).manager.executeWebhook({ path: '42/n8n-execution-status', method: 'GET', headers: {} });
  assert.equal(result.body, 'form-waiting');
  assert.equal(result.headers['access-control-allow-origin'], '*');
  waiting.data.executionData.nodeExecutionStack[0].node = { type: WAIT_NODE_TYPE, parameters: { resume: 'form' } };
  assert.equal((await setup(waiting).manager.executeWebhook({ path: '42/n8n-execution-status', method: 'GET', headers: {} })).body, 'form-waiting');
  waiting.status = 'success';
  assert.equal((await setup(waiting).manager.executeWebhook({ path: '42/n8n-execution-status', method: 'GET', headers: {} })).body, 'success');
  assert.equal((await setup(undefined).manager.executeWebhook({ path: '42/n8n-execution-status', method: 'GET', headers: {} })).body, 'null');
});

test('request sanitizer removes only auth and browser identity cookies', () => {
  const request = { headers: { cookie: 'n8n-auth=secret; safe=yes; n8n-browserId=id' }, cookies: { 'n8n-auth': 'secret', safe: 'yes', 'n8n-browserId': 'id' } };
  sanitizeWaitingFormRequest(request);
  assert.equal(request.headers.cookie, 'safe=yes');
  assert.deepEqual(request.cookies, { safe: 'yes' });
});

test('missing and failed executions preserve waiting-form errors', async () => {
  await assert.rejects(() => setup(undefined).manager.executeWebhook({ path: '42', method: 'GET', headers: {} }), (error) => error.statusCode === 404);
  const failed = execution(); failed.data.resultData.error = { message: 'boom' };
  await assert.rejects(() => setup(failed).manager.executeWebhook({ path: '42', method: 'GET', headers: {} }), (error) => error.statusCode === 409 && /finished with error/.test(error.message));
});

test('running execution returns without invoking form execution', async () => {
  const { manager, calls } = setup(execution({ status: 'running' }));
  assert.deepEqual(await manager.executeWebhook({ path: '42', method: 'GET', headers: {} }), { noWebhookResponse: true, body: undefined });
  assert.equal(calls.length, 0);
});

test('finished execution without completion node renders sandboxed default HTML', async () => {
  const value = execution({ finished: true, status: 'success' });
  const result = await setup(value).manager.executeWebhook({ path: '42', method: 'GET', headers: {} });
  assert.equal(result.headers['content-security-policy'], WEBHOOK_SANDBOX_CSP);
  assert.equal(result.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(result.body, /<title>Form Submitted<\/title>/);
  assert.match(result.body, /Your response has been recorded/);
});

test('renderer escapes titles while preserving reference-compatible message markup', () => {
  const html = renderDefaultFormCompletion({ title: '<bad>', formTitle: 'A&B', message: '<strong>ok</strong>' });
  assert.match(html, /&lt;bad&gt;/); assert.match(html, /A&amp;B/); assert.match(html, /<strong>ok<\/strong>/);
});

test('finished execution delegates the nearest executed completion page', async () => {
  const value = execution({ finished: true, status: 'success', workflowData: { nodes: [{ name: 'Last', type: 'other', parameters: {} }, form('Earlier'), form('Nearest')] }, data: { resultData: { lastNodeExecuted: 'Last', runData: { Earlier: [], Nearest: [] } }, executionData: { nodeExecutionStack: [{ node: { name: 'Last', type: 'other' } }] } } });
  const { manager, calls } = setup(value, { getParentNodes: () => ['Earlier', 'Nearest'] });
  await manager.executeWebhook({ path: '42', method: 'GET', headers: {} });
  assert.equal(calls[0].lastNodeExecuted, 'Nearest');
  assert.equal(calls[0].request.params && Object.keys(calls[0].request.params).length, 0);
});

test('POST disables the stack node while GET leaves it enabled and delegated responses allow all origins', async () => {
  const post = execution(); const postSetup = setup(post);
  const result = await postSetup.manager.executeWebhook({ path: '42/next', method: 'POST', headers: {}, params: { path: '42' } });
  assert.equal(post.data.executionData.nodeExecutionStack[0].node.disabled, true);
  assert.equal(postSetup.calls[0].suffix, 'next');
  assert.equal(result.headers['access-control-allow-origin'], '*');
  const get = execution(); await setup(get).manager.executeWebhook({ path: '42', method: 'GET', headers: {} });
  assert.equal(get.data.executionData.nodeExecutionStack[0].node.disabled, undefined);
});

test('native HTTP transport serves completion HTML/status and preserves empty no-response', async () => {
  let current = execution({ finished: true, status: 'success' });
  const manager = new WaitingFormManager({
    executionRepository: { async findSingleExecution() { return current; } },
    getParentNodes: () => [],
    executeFormWebhook: async () => ({ body: 'unused' }),
  });
  const server = new WebhookHttpServer({ handler: new WebhookRequestHandler(), manager, basePath: 'form-waiting' });
  const address = await server.listen({ host: '0.0.0.0' });
  try {
    const base = `http://127.0.0.1:${address.port}/form-waiting/42`;
    const completion = await fetch(base);
    assert.equal(completion.status, 200);
    assert.match(completion.headers.get('content-security-policy'), /sandbox/);
    assert.match(await completion.text(), /Your response has been recorded/);
    const status = await fetch(`${base}/n8n-execution-status`);
    assert.equal(status.headers.get('access-control-allow-origin'), '*');
    assert.equal(await status.text(), 'success');
    current = execution({ status: 'running' });
    const running = await fetch(base);
    assert.equal(await running.text(), '');
  } finally { await server.close(); }
});
