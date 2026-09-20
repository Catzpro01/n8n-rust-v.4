/**
 * 07-configuration — PORT/LOG_LEVEL/.env (runtime nyata).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIST_SERVER,
  ROOT,
  freePort,
  httpGet,
  httpPost,
  isPortBusy,
  readFixture,
  spawnServer,
  waitForHealth,
} from './helpers.mjs';

describe('configuration (nyata)', () => {
  it('PORT override dihormati', async () => {
    const port = await freePort();
    // Teruskan port SEKALIGUS sebagai target probe dan env PORT (sama nilai).
    const srv = await spawnServer({ port, env: { PORT: String(port) } });
    try {
      await srv.waitForHealth();
      assert.equal(srv.port, port);
      const h = await httpGet(srv.baseUrl, '/healthz');
      assert.equal(h.json.status, 'ok');
    } finally {
      await srv.stop();
    }
  });

  it('PORT invalid → fallback 5678 + warn', async (t) => {
    if (await isPortBusy(5678)) {
      t.skip('port 5678 sedang dipakai — skip fallback test');
      return;
    }
    const srv = await spawnServer({ env: { PORT: 'bukan-angka' } });
    try {
      // Server fallback ke 5678 (abaikan srv.baseUrl yang menunjuk port bebas).
      await waitForHealth('http://127.0.0.1:5678', 15000, srv.output);
      assert.match(srv.output().stdout, /invalid PORT/);
    } finally {
      await srv.stop();
    }
  });

  it('LOG_LEVEL invalid → fallback info + warn, server tetap jalan', async () => {
    const srv = await spawnServer({ env: { LOG_LEVEL: 'ngawur' } });
    try {
      await srv.waitForHealth();
      assert.match(srv.output().stdout, /invalid LOG_LEVEL/);
      const r = await httpPost(srv.baseUrl, '/api/v1/workflows/run', { body: readFixture('minimal') });
      assert.equal(r.status, 200);
    } finally {
      await srv.stop();
    }
  });

  it('boot selalu mencetak satu baris [config]', async () => {
    const srv = await spawnServer();
    try {
      await srv.waitForHealth();
      assert.match(
        srv.output().stdout,
        /\[config\] host=.* port=\d+ logLevel=\w+ bodyLimit=\d+ execTimeoutMs=\d+ locale=\w+ env=\w+ version=/,
      );
    } finally {
      await srv.stop();
    }
  });

  it('.env di cwd dibaca (PORT + BODY_LIMIT + LOG_LEVEL)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'n8n-ts-env-'));
    try {
      const port = await freePort();
      writeFileSync(join(dir, '.env'), `PORT=${port}\nLOG_LEVEL=debug\nBODY_LIMIT_BYTES=1024\n`);
      // Spawn mentah TANPA PORT di env agar .env yang menentukan.
      const childEnv = { ...process.env, HOST: '127.0.0.1', NODE_ENV: 'test' };
      delete childEnv.PORT;
      delete childEnv.LOG_LEVEL;
      delete childEnv.BODY_LIMIT_BYTES;
      const proc = spawn('node', [DIST_SERVER], {
        cwd: dir,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      proc.stdout.on('data', (d) => (stdout += d.toString()));
      assert.ok(ROOT.length > 0); // root tersedia untuk debug bila gagal
      try {
        await waitForHealth(`http://127.0.0.1:${port}`, 15000, () => ({ stdout }));
        assert.match(stdout, /\[config\].*bodyLimit=1024/);
        assert.match(stdout, /\.env/); // log debug menyebut file .env yang dimuat
      } finally {
        proc.kill('SIGTERM');
        await new Promise((r) => proc.on('exit', r));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
