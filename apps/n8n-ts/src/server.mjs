#!/usr/bin/env node
/**
 * n8n-ts baseline HTTP server (Worker 1).
 *
 * - node:http only
 * - GET /
 * - GET /healthz
 * - POST /api/v1/workflows/run
 * - engine: packages/reconstructed-engine via apps/n8n-ts/lib/engine-adapter.mjs
 *
 * Contract: contracts/ts-runtime-baseline.contract.md
 * Rust: FROZEN — do not import crates or apps/n8n-rust.
 */

import http from 'node:http';
import { loadDefaultEnv, resolveConfig, PACKAGE_VERSION } from './config.mjs';
import { createLogger } from './logger.mjs';
import { stripBasePath, sendError } from './http-util.mjs';
import { createRouter } from './routes.mjs';
import { LEGO_INTEGRATION } from '../lib/engine-adapter.mjs';

loadDefaultEnv();

/**
 * Create and optionally listen.
 * @param {{ env?: NodeJS.ProcessEnv, listen?: boolean }} [options]
 */
export async function createServer(options = {}) {
  const env = options.env ?? process.env;
  const config = resolveConfig(env);
  const logger = createLogger({ logLevel: config.logLevel });
  const startedAt = Date.now();
  const router = createRouter({ config, logger, startedAt });

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    try {
      const host = req.headers.host || `${config.host}:${config.port}`;
      const url = new URL(req.url || '/', `http://${host}`);
      const stripped = stripBasePath(url.pathname, config.basePath);
      if (stripped === null) {
        sendError(res, 404, 'Not Found');
        return;
      }
      await router.handle(req, res, stripped);
    } catch (err) {
      logger.error('unhandled request error', {
        err: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        sendError(res, 500, 'Internal server error');
      } else {
        res.end();
      }
    } finally {
      logger.debug('request', {
        method: req.method,
        url: req.url,
        ms: Date.now() - start,
        status: res.statusCode,
      });
    }
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const api = {
    server,
    config,
    logger,
    /**
     * @param {{ host?: string, port?: number }} [opts]
     * @returns {Promise<{ host: string, port: number, url: string }>}
     */
    async listen(opts = {}) {
      const host = opts.host ?? config.host;
      const port = opts.port ?? config.port;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`;
      logger.info('n8n-ts baseline listening', {
        host,
        port: actualPort,
        version: PACKAGE_VERSION,
        engine: LEGO_INTEGRATION.engine,
        basePath: config.basePath || '/',
      });
      return { host, port: actualPort, url };
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };

  if (options.listen !== false && options.autoListen) {
    await api.listen();
  }

  return api;
}

/** CLI entry when executed directly */
async function main() {
  const api = await createServer({ autoListen: false });
  const info = await api.listen();

  const shutdown = async (signal) => {
    api.logger.info('shutting down', { signal });
    try {
      await api.close();
      process.exit(0);
    } catch (err) {
      api.logger.error('shutdown error', { err: String(err) });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Ready line for scripts/doctor
  console.log(`N8N_TS_READY url=${info.url} port=${info.port} version=${PACKAGE_VERSION}`);
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('/server.mjs') ||
    process.argv[1].endsWith('\\server.mjs') ||
    process.argv[1].includes('apps/n8n-ts/src/server'));

if (isDirect) {
  main().catch((err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'fatal', err: String(err) }));
    process.exit(1);
  });
}
