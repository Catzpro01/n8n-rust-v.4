/**
 * T5 — unknown node type (strict)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request, loadFixture } from './helpers.mjs';

describe('T5 unknown node', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.stop();
  });

  it('strict mode → 422 Unknown node type', async () => {
    const workflow = loadFixture('unknown-node.workflow.json');
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: { workflow },
    });
    assert.equal(status, 422);
    assert.match(json.message, /Unknown node type:/);
    assert.match(json.message, /definitelyNotARealNode/);
    assert.equal(json.code, 422);
  });

  it('strictTypes:false allows passthrough', async () => {
    const workflow = loadFixture('unknown-node.workflow.json');
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: { workflow, options: { strictTypes: false } },
    });
    assert.equal(status, 200);
    assert.equal(json.data.result.status, 'COMPLETED');
  });
});
