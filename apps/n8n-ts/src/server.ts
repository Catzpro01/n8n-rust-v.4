/**
 * n8n-ts baseline runtime — entry point.
 * Hanya `node:http`, tanpa framework. Lihat README.md untuk oprek/debug.
 *
 * Routing (kontrak §2): GET / · GET /healthz · POST /api/v1/workflows/run.
 * Selain itu: 404 JSON (baseline tidak punya SPA).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { formatConfigLine, loadConfig } from './config.js';
import {
  sendMethodNotAllowed,
  sendNotFound,
} from './envelope.js';
import { logger, setLogLevel } from './logger.js';
import { handleHealth } from './routes/health.js';
import { handleRoot } from './routes/root.js';
import { handleRun } from './routes/run.js';

const RUN_PATH = '/api/v1/workflows/run';

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const server = createServer((req, res) => {
    void dispatch(req, res, config.version, config.bodyLimitBytes, config.executionTimeoutMs, config.defaultLocale)
      .catch((err: unknown) => {
        logger.error('unhandled request error', { error: String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ code: 500, message: 'Workflow execution failed', hint: 'EXECUTION_FAILED' }));
        }
      });
  });

  installShutdown(server);

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(config.port, config.host, resolve);
  });

  logger.info(formatConfigLine(config));
  logger.info(`listening on ${config.host}:${config.port}`);
}

async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  version: string,
  bodyLimitBytes: number,
  executionTimeoutMs: number,
  defaultLocale: string,
): Promise<void> {
  const pathname = safePathname(req.url);
  const method = (req.method ?? 'GET').toUpperCase();

  // GET / (+ HEAD ramah)
  if (pathname === '/') {
    if (method === 'GET') {
      logger.debug('GET / 200');
      handleRoot(req, res, version);
      return;
    }
    sendMethodNotAllowed(res);
    return;
  }

  // GET /healthz (+ HEAD tanpa body)
  if (pathname === '/healthz') {
    if (method === 'GET' || method === 'HEAD') {
      logger.debug(`${method} /healthz 200`);
      handleHealth(req, res, version);
      return;
    }
    sendMethodNotAllowed(res);
    return;
  }

  // POST /api/v1/workflows/run
  if (pathname === RUN_PATH) {
    if (method !== 'POST') {
      sendMethodNotAllowed(res);
      return;
    }
    await handleRun(req, res, {
      host: '',
      port: 0,
      logLevel: 'info',
      bodyLimitBytes,
      executionTimeoutMs,
      defaultLocale,
      nodeEnv: '',
      version,
    });
    return;
  }

  sendNotFound(res);
}

function safePathname(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://local').pathname;
  } catch {
    return '/__bad_url__';
  }
}

/** Graceful shutdown: stop accept → drain ≤10 dtk → exit 0. Sinyal ke-2 = paksa. */
function installShutdown(server: ReturnType<typeof createServer>): void {
  let shuttingDown = false;
  const onSignal = (signal: string): void => {
    if (shuttingDown) {
      logger.warn(`received ${signal} again — force exit`);
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`received ${signal} — draining...`);
    const force = setTimeout(() => {
      logger.warn('drain timeout 10s — closing connections');
      server.closeAllConnections();
      process.exit(0);
    }, 10_000);
    force.unref?.();
    server.close(() => {
      clearTimeout(force);
      logger.info('shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}

main().catch((err: unknown) => {
  process.stderr.write(`[error] boot failed: ${String(err)}\n`);
  process.exit(1);
});
