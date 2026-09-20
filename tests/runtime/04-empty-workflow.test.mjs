/**
 * 04-empty-workflow — nodes [] → 400 EMPTY_WORKFLOW (runtime nyata).
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { httpPost, readFixture, spawnServer } from './helpers.mjs';

describe('empty workflow (nyata)', () => {
  let srv;
  before(async () => {
    srv = await spawnServer();
    await srv.waitForHealth();
  });
  after(async () => srv.stop());

  it('fixture empty → 400 EMPTY_WORKFLOW', async () => {
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body: readFixture('empty') });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 400);
    assert.match(r.json.message, /no nodes/i);
    assert.equal(r.json.hint, 'EMPTY_WORKFLOW');
  });

  it('nodes hilang seluruh → MALFORMED (bukan EMPTY)', async () => {
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', {
      body: { workflow: { connections: {} } },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.hint, 'MALFORMED_REQUEST');
  });
});
