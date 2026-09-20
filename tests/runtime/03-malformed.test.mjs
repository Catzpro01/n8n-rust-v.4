/**
 * T3 — malformed requests
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request } from './helpers.mjs';

describe('T3 malformed request', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.stop();
  });

  it('invalid JSON → 400', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v1/workflows/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.message, 'Invalid JSON body');
    assert.equal(json.code, 400);
  });

  it('empty body → 400', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v1/workflows/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.message, 'Invalid JSON body');
  });

  it('array body → 400', async () => {
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: [],
    });
    assert.equal(status, 400);
    assert.equal(json.message, 'Request body must be a JSON object');
  });

  it('missing workflow → 400', async () => {
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'POST',
      json: { locale: 'en' },
    });
    assert.equal(status, 400);
    assert.equal(json.message, 'workflow is required');
  });

  it('GET on run endpoint → 405', async () => {
    const { status, json } = await request(ctx.baseUrl, '/api/v1/workflows/run', {
      method: 'GET',
    });
    assert.equal(status, 405);
    assert.equal(json.message, 'Method Not Allowed');
  });

  it('unknown path → 404', async () => {
    const { status, json } = await request(ctx.baseUrl, '/no/such/path');
    assert.equal(status, 404);
    assert.equal(json.message, 'Not Found');
  });
});
