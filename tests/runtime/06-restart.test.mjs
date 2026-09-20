/**
 * 06-restart — SIGTERM graceful (exit 0) → start lagi di PORT SAMA → sehat.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { freePort, httpGet, httpPost, readFixture, spawnServer } from './helpers.mjs';

describe('restart (nyata)', () => {
  it('stop graceful + start ulang di port sama', async () => {
    const port = await freePort();

    // putaran 1
    const srv1 = await spawnServer({ port });
    await srv1.waitForHealth();
    const run1 = await httpPost(srv1.baseUrl, '/api/v1/workflows/run', { body: readFixture('minimal') });
    assert.equal(run1.status, 200);

    // SIGTERM → exit 0 dalam ≤10 dtk (graceful)
    const t0 = Date.now();
    const code = await srv1.stop('SIGTERM');
    assert.equal(code, 0);
    assert.ok(Date.now() - t0 < 10_000, 'shutdown harus < 10 detik');
    const { stdout } = srv1.output();
    assert.match(stdout, /draining|shutdown complete/);

    // server mati: health gagal
    await assert.rejects(() => httpGet(srv1.baseUrl, '/healthz', {}).then((r) => {
      if (r.status === 200) throw new Error('masih hidup setelah stop');
    }));

    // putaran 2 — port SAMA membuktikan pelepasan bersih
    const srv2 = await spawnServer({ port });
    try {
      await srv2.waitForHealth();
      const h = await httpGet(srv2.baseUrl, '/healthz');
      assert.equal(h.json.status, 'ok');
      const run2 = await httpPost(srv2.baseUrl, '/api/v1/workflows/run', { body: readFixture('linear') });
      assert.equal(run2.status, 200);
      assert.equal(run2.json.data.status, 'COMPLETED');
    } finally {
      await srv2.stop();
    }
  });
});
