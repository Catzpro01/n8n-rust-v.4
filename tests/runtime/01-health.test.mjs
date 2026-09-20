/**
 * 01-health — GET /, GET /healthz, 404 JSON, 405. Melawan runtime nyata.
 * Jalankan: node --test tests/runtime/01-health.test.mjs
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { httpGet, runtimeVersion, spawnServer } from './helpers.mjs';

describe('runtime health (nyata)', () => {
  let srv;
  before(async () => {
    srv = await spawnServer();
    await srv.waitForHealth();
  });
  after(async () => srv.stop());

  it('GET / → landing baseline', async () => {
    const r = await httpGet(srv.baseUrl, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.equal(r.json.name, 'n8n-ts-baseline');
    assert.equal(r.json.status, 'ok');
    assert.deepEqual(r.json.endpoints, ['GET /', 'GET /healthz', 'POST /api/v1/workflows/run']);
  });

  it('version response = package.json version', async () => {
    const r = await httpGet(srv.baseUrl, '/');
    assert.equal(r.json.version, runtimeVersion());
    const h = await httpGet(srv.baseUrl, '/healthz');
    assert.equal(h.json.version, runtimeVersion());
  });

  it('GET /healthz → { status ok, uptimeSec, version }', async () => {
    const r = await httpGet(srv.baseUrl, '/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'ok');
    assert.ok(Number.isInteger(r.json.uptimeSec) && r.json.uptimeSec >= 0);
  });

  it('path tak dikenal → 404 JSON (bukan HTML)', async () => {
    const r = await httpGet(srv.baseUrl, '/rute-tidak-ada');
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(r.json, { code: 404, message: 'Not Found', hint: 'NOT_FOUND' });
  });

  it('method salah → 405 JSON', async () => {
    const a = await httpGet(srv.baseUrl, '/', { method: 'POST' });
    assert.equal(a.status, 405);
    assert.equal(a.json.hint, 'METHOD_NOT_ALLOWED');
    const b = await httpGet(srv.baseUrl, '/api/v1/workflows/run', { method: 'GET' });
    assert.equal(b.status, 405);
    const c = await httpGet(srv.baseUrl, '/healthz', { method: 'DELETE' });
    assert.equal(c.status, 405);
  });

  it('GET / dan /healthz tidak membanjiri log info', async () => {
    await httpGet(srv.baseUrl, '/');
    await httpGet(srv.baseUrl, '/healthz');
    const { stdout } = srv.output();
    // Boleh ada di debug, tapi level info default: tidak ada baris per-request GET.
    assert.doesNotMatch(stdout, /GET \/healthz 200/);
  });
});
