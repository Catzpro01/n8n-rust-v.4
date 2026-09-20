/**
 * T7 — configuration (locale, base path)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request } from './helpers.mjs';

describe('T7 configuration', () => {
  it('respects N8N_LOCALE default in healthz', async () => {
    const ctx = await startTestServer({ N8N_LOCALE: 'id' });
    try {
      const { json } = await request(ctx.baseUrl, '/healthz');
      assert.equal(json.locale, 'id');
    } finally {
      await ctx.stop();
    }
  });

  it('respects N8N_TS_BASE_PATH', async () => {
    const ctx = await startTestServer({ N8N_TS_BASE_PATH: '/n8n' });
    try {
      // Outside base → 404
      const miss = await request(ctx.baseUrl, '/healthz');
      assert.equal(miss.status, 404);

      const hit = await request(ctx.baseUrl, '/n8n/healthz');
      assert.equal(hit.status, 200);
      assert.equal(hit.json.status, 'ok');

      const run = await request(ctx.baseUrl, '/n8n/api/v1/workflows/run', {
        method: 'POST',
        json: {
          workflow: {
            nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp', parameters: {} }],
            connections: {},
          },
        },
      });
      assert.equal(run.status, 200);
    } finally {
      await ctx.stop();
    }
  });
});
