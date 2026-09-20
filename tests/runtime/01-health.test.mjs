/**
 * T1 — health endpoints against a real server
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request } from './helpers.mjs';

describe('T1 health', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(async () => {
    await ctx.stop();
  });

  it('GET /healthz → 200 status ok', async () => {
    const { status, json } = await request(ctx.baseUrl, '/healthz');
    assert.equal(status, 200);
    assert.equal(json.status, 'ok');
    assert.equal(json.service, 'n8n-ts-baseline');
    assert.equal(json.engine, 'reconstructed-engine');
    assert.equal(typeof json.version, 'string');
    assert.equal(typeof json.uptimeSec, 'number');
  });

  it('GET /healthz/readiness → 200 ready', async () => {
    const { status, json } = await request(ctx.baseUrl, '/healthz/readiness');
    assert.equal(status, 200);
    assert.equal(json.status, 'ok');
    assert.equal(json.ready, true);
  });

  it('GET / → 200 html landing', async () => {
    const { status, text, res } = await request(ctx.baseUrl, '/');
    assert.equal(status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(text, /n8n-ts|baseline/i);
  });
});
