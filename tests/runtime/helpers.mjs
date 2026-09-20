/**
 * Helpers test runtime — SELALU melawan runtime NYATA (spawn node dist/server.js).
 * Dilarang mengimpor apps/n8n-ts/src/* atau mem-mock engine.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { once } from 'node:events';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
export const DIST_SERVER = `${ROOT}/apps/n8n-ts/dist/server.js`;
export const RUNTIME_PKG = `${ROOT}/apps/n8n-ts/package.json`;

export function readFixture(name) {
  return JSON.parse(readFileSync(`${ROOT}/tests/runtime/fixtures/${name}.json`, 'utf8'));
}

export function runtimeVersion() {
  return JSON.parse(readFileSync(RUNTIME_PKG, 'utf8')).version;
}

/** Cari port bebas (race aman untuk test: server child langsung bind). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function assertBuilt() {
  if (!existsSync(DIST_SERVER)) {
    throw new Error(
      `runtime belum di-build: ${DIST_SERVER} tidak ada. Jalankan dulu: npm --prefix apps/n8n-ts run build`,
    );
  }
}

/**
 * Spawn server nyata. Return { proc, port, baseUrl, output(), stop(), waitForHealth() }.
 * `output()` = { stdout, stderr } sejauh ini (untuk assert log).
 */
export async function spawnServer({ port, env = {}, cwd } = {}) {
  assertBuilt();
  const chosen = port ?? (await freePort());
  const proc = spawn('node', [DIST_SERVER], {
    cwd: cwd ?? ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(chosen), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => (stdout += d.toString()));
  proc.stderr.on('data', (d) => (stderr += d.toString()));

  const baseUrl = `http://127.0.0.1:${chosen}`;
  const api = {
    proc,
    port: chosen,
    baseUrl,
    output: () => ({ stdout, stderr }),
    async waitForHealth(timeoutMs = 15000) {
      await waitForHealth(baseUrl, timeoutMs, () => ({ stdout, stderr }));
    },
    async stop(signal = 'SIGTERM') {
      if (proc.exitCode !== null) return proc.exitCode;
      proc.kill(signal);
      const [code] = await once(proc, 'exit');
      return code;
    },
  };
  return api;
}

export async function waitForHealth(baseUrl, timeoutMs = 15000, logsFn) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) {
        const body = await res.json();
        if (body?.status === 'ok') return body;
      }
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = String(err?.cause?.code ?? err);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const logs = logsFn ? logsFn() : {};
  throw new Error(`healthz tidak OK dalam ${timeoutMs}ms (${baseUrl}): ${lastErr}\nSTDOUT:\n${logs.stdout ?? ''}\nSTDERR:\n${logs.stderr ?? ''}`);
}

export async function httpGet(baseUrl, path, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: safeJson(text) };
}

export async function httpPost(baseUrl, path, { body, rawBody, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: safeJson(text) };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Cek cepat apakah port sedang dipakai (untuk skip anggun). */
export async function isPortBusy(port) {
  try {
    await new Promise((resolve, reject) => {
      const srv = createServer();
      srv.on('error', reject);
      srv.listen(port, '127.0.0.1', () => srv.close(resolve));
    });
    return false;
  } catch {
    return true;
  }
}
