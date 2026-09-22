/**
 * Runtime entry point — `node apps/n8n-ts/src/server.ts` (no build step).
 *
 * Boot order: config → logger → stores → routes → listen → signal handlers.
 * Exit codes: 78 invalid configuration (EX_CONFIG), 1 fatal boot error, 0 clean shutdown.
 */
import { createServer, type Server } from 'node:http';
import { loadConfig, describeConfig, ConfigError, type RuntimeConfig } from './config.ts';
import { createLogger, type Logger } from './logger.ts';
import { createApp, handleRequest, type App } from './app.ts';

const EX_CONFIG = 78;
const SHUTDOWN_GRACE_MS = 10_000;

function checkNodeVersion(logger?: Logger): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map((part) => Number(part));
  if (major > 22 || (major === 22 && minor >= 18) || major >= 23) return;
  const message = `Node.js >= 22.18.0 is required (native TypeScript execution); running ${process.version}`;
  if (logger) logger.error(message);
  else process.stderr.write(`${message}\n`);
  process.exit(EX_CONFIG);
}

async function shutdown(app: App, server: Server, logger: Logger, signal: string): Promise<void> {
  app.shuttingDown = true;
  logger.info('shutdown requested', { signal, graceMs: SHUTDOWN_GRACE_MS });

  const forced = setTimeout(() => {
    logger.warn('shutdown grace period elapsed — destroying remaining connections');
    server.closeAllConnections?.();
  }, SHUTDOWN_GRACE_MS);
  forced.unref();

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
  clearTimeout(forced);
  logger.info('runtime stopped');
  process.exit(0);
}

async function main(): Promise<void> {
  checkNodeVersion();

  let config: RuntimeConfig;
  try {
    config = loadConfig();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : (error as Error).message;
    process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'invalid configuration', error: message })}\n`);
    process.exit(EX_CONFIG);
  }

  const logger = createLogger({
    level: config.logLevel,
    format: config.logFormat,
    base: { service: 'n8n-ts-runtime', pid: process.pid, env: config.env },
  });

  logger.info('runtime starting', { version: config.version, node: process.version });
  logger.debug('effective configuration', describeConfig(config));
  if (config.apiKey === null) {
    logger.warn('N8N_TS_API_KEY is not set — /api/v1 is unauthenticated (acceptable for local development only)');
  }
  if (config.allowCodeEval) {
    logger.warn('N8N_TS_ALLOW_CODE_EVAL is enabled — user JavaScript runs in-process; not production safe');
  }

  const app = await createApp(config, logger);
  const server = createServer((request, response) => {
    handleRequest(app, request, response).catch((error: unknown) => {
      logger.error('unhandled request error', { cause: error instanceof Error ? error.message : String(error) });
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 'INTERNAL_ERROR', message: 'unhandled request error' }));
    });
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logger.info('runtime listening', {
    url: `http://${config.host}:${port}`,
    console: `http://${config.host}:${port}/`,
    healthz: `http://${config.host}:${port}/healthz`,
    storage: config.storage,
    dataDir: config.dataDir,
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown(app, server, logger, signal);
    });
  }
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { cause: reason instanceof Error ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception — exiting', { cause: error.message, stack: error.stack });
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', msg: 'runtime failed to start', error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exit(1);
});
