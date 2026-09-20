/**
 * 05-unknown-node — bedakan UNKNOWN_NODE (error) vs unknown TYPE (passthrough).
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { httpPost, readFixture, spawnServer } from './helpers.mjs';

describe('unknown node (nyata)', () => {
  let srv;
  before(async () => {
    srv = await spawnServer();
    await srv.waitForHealth();
  });
  after(async () => srv.stop());

  const post = (body) => httpPost(srv.baseUrl, '/api/v1/workflows/run', { body });

  it('startNode tak ada → 400 UNKNOWN_NODE', async () => {
    const r = await post(readFixture('unknown-node'));
    assert.equal(r.status, 400);
    assert.match(r.json.message, /Ghost/);
    assert.equal(r.json.hint, 'UNKNOWN_NODE');
  });

  it('koneksi target tak ada → 400 UNKNOWN_NODE', async () => {
    const r = await post({
      workflow: {
        nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp' }],
        connections: { A: { main: [[{ node: 'Ghost', type: 'main', index: 0 }]] } },
      },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.hint, 'UNKNOWN_NODE');
  });

  it('koneksi source tak ada → 400 UNKNOWN_NODE', async () => {
    const r = await post({
      workflow: {
        nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp' }],
        connections: { Ghost: { main: [[{ node: 'A', type: 'main', index: 0 }]] } },
      },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.hint, 'UNKNOWN_NODE');
  });

  it('TYPE tanpa handler → 200 passthrough (input = output)', async () => {
    const r = await post(readFixture('two-node-passthrough'));
    assert.equal(r.status, 200);
    assert.equal(r.json.data.status, 'COMPLETED');
    assert.deepEqual(r.json.data.data.First, [{ json: { echo: 'me' } }]);
    assert.deepEqual(r.json.data.data.Second, [{ json: { echo: 'me' } }]);
    assert.equal(r.json.data.executionLog.length, 2);
  });

  it('unknown type dicatat warn di log server', async () => {
    const before = srv.output().stdout.length;
    await post({
      workflow: { nodes: [{ name: 'W', type: 'custom.anehBanget' }] },
    });
    const added = srv.output().stdout.slice(before);
    assert.match(added, /unknown node type "custom\.anehBanget" — passthrough/);
  });
});
