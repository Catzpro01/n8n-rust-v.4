/**
 * T6 — stop + start again → healthz ok
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request } from './helpers.mjs';

describe('T6 restart', () => {
  it('server can stop and start again', async () => {
    const first = await startTestServer();
    const h1 = await request(first.baseUrl, '/healthz');
    assert.equal(h1.status, 200);
    await first.stop();

    // Old port should be dead
    let dead = false;
    try {
      await fetch(`${first.baseUrl}/healthz`, { signal: AbortSignal.timeout(500) });
    } catch {
      dead = true;
    }
    assert.equal(dead, true);

    const second = await startTestServer();
    const h2 = await request(second.baseUrl, '/healthz');
    assert.equal(h2.status, 200);
    assert.equal(h2.json.status, 'ok');
    // New instance should still run workflows
    const run = await request(second.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: {
        workflow: {
          nodes: [{ name: 'A', type: 'n8n-nodes-base.manualTrigger', parameters: {} }],
          connections: {},
        },
      },
    });
    assert.equal(run.status, 200);
    await second.stop();
  });
});
