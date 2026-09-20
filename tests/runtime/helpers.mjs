/**
 * Shared helpers for runtime tests — always talk to a real node:http server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
export const FIXTURES = path.join(__dirname, 'fixtures');

export function loadFixture(name) {
  const p = path.join(FIXTURES, name);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Start baseline server on ephemeral port.
 * @param {Record<string, string>} [envOverrides]
 */
export async function startTestServer(envOverrides = {}) {
  const serverHref = pathToFileURL(
    path.join(REPO_ROOT, 'apps/n8n-ts/src/server.mjs'),
  ).href;
  const { createServer } = await import(serverHref);

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    N8N_TS_HOST: '127.0.0.1',
    // resolveConfig needs a valid port; actual listen uses port 0
    N8N_TS_PORT: '59999',
    N8N_TS_LOG_LEVEL: 'error',
    N8N_LOCALE: 'en',
    ...envOverrides,
  };

  const api = await createServer({ env, autoListen: false });
  const info = await api.listen({ host: '127.0.0.1', port: 0 });
  return {
    api,
    baseUrl: info.url,
    port: info.port,
    async stop() {
      await api.close();
    },
  };
}

/**
 * @param {string} baseUrl
 * @param {string} pathname
 * @param {RequestInit & { json?: unknown }} [init]
 */
export async function request(baseUrl, pathname, init = {}) {
  const headers = { ...(init.headers || {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = headers['content-type'] || 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, status: res.status, text, json };
}
