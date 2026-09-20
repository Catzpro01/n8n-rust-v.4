/**
 * 02-workflow-execution — eksekusi valid via runtime nyata.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { httpPost, readFixture, spawnServer } from './helpers.mjs';

describe('workflow execution (nyata)', () => {
  let srv;
  before(async () => {
    srv = await spawnServer();
    await srv.waitForHealth();
  });
  after(async () => srv.stop());

  it('minimal 1-node → COMPLETED + envelope {data}', async () => {
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body: readFixture('minimal') });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json), ['data']);
    assert.equal(r.json.data.status, 'COMPLETED');
    assert.equal(r.json.data.finished, true);
    assert.equal(r.json.data.executionLog.length, 1);
    assert.equal(r.json.data.executionLog[0].node, 'Start');
    assert.equal(r.json.data.executionLog[0].status, 'success');
    assert.ok(r.json.data.data.Start);
    assert.equal(r.json.data.data.Start[0].json.status, 'ACTIVE');
    assert.ok(r.json.data.data.Start[0].json.triggeredAt);
  });

  it('linear 3-node → log urut BFS + data per node', async () => {
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body: readFixture('linear') });
    assert.equal(r.status, 200);
    const log = r.json.data.executionLog;
    assert.deepEqual(log.map((e) => e.node), ['Start', 'Step', 'End']);
    for (const entry of log) {
      assert.equal(entry.status, 'success');
      assert.ok(entry.durationMs >= 0);
    }
    assert.deepEqual(Object.keys(r.json.data.data).sort(), ['End', 'Start', 'Step']);
  });

  it('startNode eksplisit → mulai dari tengah', async () => {
    const body = { ...readFixture('linear'), startNode: 'Step' };
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.json.data.executionLog.map((e) => e.node),
      ['Step', 'End'],
    );
  });

  it('locale en → 200, machine fields utuh', async () => {
    const body = { ...readFixture('minimal'), locale: 'en' };
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.executionLog[0].node, 'Start');
    assert.equal(r.json.data.executionLog[0].type, 'n8n-nodes-base.manualTrigger');
  });

  it('request dicatat satu baris info', async () => {
    const before = srv.output().stdout.length;
    await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body: readFixture('minimal') });
    const added = srv.output().stdout.slice(before);
    assert.match(added, /POST \/api\/v1\/workflows\/run 200 \d+ms nodes=1/);
  });
});
