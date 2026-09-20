/**
 * T4 — empty workflow
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request, loadFixture } from './helpers.mjs';

describe('T4 empty workflow', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.stop();
  });

  it('nodes: [] → 400 workflow has no nodes', async () => {
    const workflow = loadFixture('empty.workflow.json');
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: { workflow },
    });
    assert.equal(status, 400);
    assert.equal(json.message, 'workflow has no nodes');
    assert.equal(json.code, 400);
  });

  it('workflow without nodes key treated as empty', async () => {
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: { workflow: { name: 'x' } },
    });
    assert.equal(status, 400);
    assert.equal(json.message, 'workflow has no nodes');
  });
});
