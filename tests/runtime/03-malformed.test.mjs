/**
 * 03-malformed — request rusak → error envelope yang tepat (runtime nyata).
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { httpPost, spawnServer } from './helpers.mjs';

describe('malformed requests (nyata)', () => {
  let srv;
  before(async () => {
    srv = await spawnServer();
    await srv.waitForHealth();
  });
  after(async () => srv.stop());

  const post = (opts) => httpPost(srv.baseUrl, '/api/v1/workflows/run', opts);

  it('body bukan JSON → 400 MALFORMED_JSON', async () => {
    const r = await post({ rawBody: '{tidak-valid-json' });
    assert.equal(r.status, 400);
    assert.equal(r.json.hint, 'MALFORMED_JSON');
  });

  it('body kosong → 400 MALFORMED_JSON', async () => {
    const r = await post({ rawBody: '' });
    assert.equal(r.status, 400);
    assert.equal(r.json.hint, 'MALFORMED_JSON');
  });

  it('body array (bukan object) → 400 MALFORMED_REQUEST', async () => {
    const r = await post({ rawBody: '[]' });
    assert.equal(r.status, 400);
    assert.equal(r.json.hint, 'MALFORMED_REQUEST');
  });

  it('workflow hilang → 400 MALFORMED_REQUEST', async () => {
    const r = await post({ body: {} });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /workflow/);
    assert.equal(r.json.hint, 'MALFORMED_REQUEST');
  });

  it('nodes bukan array → 400 MALFORMED_REQUEST', async () => {
    const r = await post({ body: { workflow: { nodes: 'x' } } });
    assert.equal(r.status, 400);
    assert.equal(r.json.hint, 'MALFORMED_REQUEST');
  });

  it('node tanpa name/type → 400 + index', async () => {
    const r = await post({ body: { workflow: { nodes: [{ name: 'A' }] } } });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /index 0/);
    assert.equal(r.json.hint, 'MALFORMED_REQUEST');
  });

  it('nama duplikat → 400', async () => {
    const r = await post({
      body: {
        workflow: {
          nodes: [
            { name: 'A', type: 't' },
            { name: 'A', type: 't' },
          ],
        },
      },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /Duplicate/);
  });

  it('content-type salah → 415', async () => {
    const r = await post({ body: { a: 1 }, headers: { 'content-type': 'text/plain' } });
    assert.equal(r.status, 415);
    assert.equal(r.json.hint, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('input bukan object/array → 400', async () => {
    const r = await post({
      body: {
        workflow: { nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp' }] },
        input: 42,
      },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /input/);
  });

  it('error selalu JSON tanpa stacktrace', async () => {
    const r = await post({ body: {} });
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(Object.keys(r.json).sort(), ['code', 'hint', 'message']);
    assert.ok(!('stacktrace' in r.json) && !('stack' in r.json));
  });
});

describe('body limit (nyata, server khusus)', () => {
  let srv;
  before(async () => {
    srv = await spawnServer({ env: { BODY_LIMIT_BYTES: '1024' } });
    await srv.waitForHealth();
  });
  after(async () => srv.stop());

  it('body > limit → 413 PAYLOAD_TOO_LARGE', async () => {
    const big = 'x'.repeat(2048);
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', {
      body: { workflow: { nodes: [{ name: 'A', type: 't', parameters: { big } }] } },
    });
    assert.equal(r.status, 413);
    assert.equal(r.json.hint, 'PAYLOAD_TOO_LARGE');
  });

  it('server tetap sehat setelah 413', async () => {
    const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', {
      body: { workflow: { nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp' }] } },
    });
    assert.equal(r.status, 200);
  });
});
