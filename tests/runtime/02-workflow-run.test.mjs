/**
 * T2 — workflow execution via real POST /api/v1/workflows/run
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request, loadFixture } from './helpers.mjs';

describe('T2 workflow execution', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.stop();
  });

  it('runs linear fixture to COMPLETED', async () => {
    const workflow = loadFixture('linear.workflow.json');
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: { workflow },
    });

    assert.equal(status, 200);
    assert.ok(json.data);
    assert.equal(json.data.status, 'success');
    assert.equal(json.data.finished, true);
    assert.equal(json.data.engine, 'reconstructed-engine');
    assert.match(json.data.executionId, /^exec-/);
    assert.equal(json.data.result.status, 'COMPLETED');
    assert.equal(json.data.result.finished, true);
    assert.ok(json.data.result.data['Manual Trigger']);
    assert.ok(json.data.result.data.Code);
    assert.ok(json.data.result.data.Set);
    assert.ok(Array.isArray(json.data.result.executionLog));
    assert.ok(json.data.result.executionLog.length >= 3);
  });

  it('runs one-node fixture', async () => {
    const workflow = loadFixture('one-node.workflow.json');
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: { workflow, inputData: [{ hello: 'world' }] },
    });
    assert.equal(status, 200);
    assert.equal(json.data.result.status, 'COMPLETED');
    const startItems = json.data.result.data.Start;
    assert.ok(Array.isArray(startItems));
    assert.equal(startItems[0].json.hello, 'world');
    assert.equal(startItems[0].json.triggered, true);
  });
});
