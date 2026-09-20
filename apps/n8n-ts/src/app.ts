/**
 * Application wiring: stores → engine metadata → routes → request pipeline.
 *
 * Request pipeline (contract §3):
 *   CORS/preflight → auth (only when N8N_TS_API_KEY is set) → shutdown gate →
 *   route dispatch → envelope response → error mapping → access log
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RuntimeConfig } from './config.ts';
import { createLogger, type Logger } from './logger.ts';
import { Router } from './http/router.ts';
import { attachResponseHeaders, corsHeaders, sendEmpty, sendError, sendJson, sendText } from './http/respond.ts';
import { methodNotAllowed, notFound, notReady, unauthorized } from './http/errors.ts';
import { WorkflowStore } from './store/workflow-store.ts';
import { ExecutionStore } from './store/execution-store.ts';
import { engineMetadata, nodeTypes } from './engine/bridge.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerMetaRoutes } from './routes/meta.ts';
import { registerWorkflowRoutes } from './routes/workflows.ts';
import { registerExecutionRoutes } from './routes/executions.ts';
import { renderConsolePage } from './console/page.ts';
import type { App } from './app-context.ts';

export type { App } from './app-context.ts';

export async function createApp(config: RuntimeConfig, logger: Logger = createLogger({ level: config.logLevel, format: config.logFormat })): Promise<App> {
  const workflows = await WorkflowStore.create({ dataDir: config.dataDir, storage: config.storage, logger });
  const executions = await ExecutionStore.create({
    dataDir: config.dataDir,
    storage: config.storage,
    history: config.executionHistory,
    logger,
  });

  const app: App = {
    config,
    logger,
    workflows,
    executions,
    engine: engineMetadata(),
    nodeTypes: nodeTypes(config.locale),
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    shuttingDown: false,
    router: new Router(),
  };

  registerConsoleRoutes(app, app.router);
  registerHealthRoutes(app, app.router);
  registerMetaRoutes(app, app.router);
  registerWorkflowRoutes(app, app.router);
  registerExecutionRoutes(app, app.router);

  logger.info('runtime configured', {
    routes: app.router.routes().length,
    storage: config.storage,
    dataDir: config.dataDir,
    nodeTypes: app.nodeTypes.length,
    engine: `${app.engine.package}@${app.engine.version}`,
  });

  return app;
}

function registerConsoleRoutes(app: App, router: Router): void {
  const page = renderConsolePage(app.config);
  router.get('/', (context) => {
    sendText(context.response, 200, page, 'text/html', { requestId: context.requestId, config: app.config });
  });
  router.get('/favicon.ico', (context) => {
    sendEmpty(context.response, 204, { requestId: context.requestId, config: app.config });
  });
  router.get('/api/v1/health', (context) => {
    sendJson(context.response, 200, { status: app.shuttingDown ? 'shutting-down' : 'ok' }, {
      requestId: context.requestId,
      config: app.config,
    });
  });
}

function isAuthorized(app: App, request: IncomingMessage): boolean {
  const expected = app.config.apiKey;
  if (expected === null) return true;
  const provided = request.headers['x-n8n-api-key'];
  if (typeof provided !== 'string' || provided === '') return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function handleRequest(app: App, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const method = (request.method ?? 'GET').toUpperCase();
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  // CORS applies to every /api/* response (including errors and preflight) —
  // attached once here so no individual writer can forget it.
  attachResponseHeaders(response, path.startsWith('/api/') ? corsHeaders(app.config) : {});
  const meta = { requestId, config: app.config };

  try {
    if (method === 'OPTIONS' && path.startsWith('/api/')) {
      sendEmpty(response, 204, meta);
      return;
    }
    if (path.startsWith('/api/v1') && !isAuthorized(app, request)) throw unauthorized();
    if (app.shuttingDown && !path.startsWith('/healthz')) throw notReady('runtime is shutting down');

    const match = app.router.match(method, path);
    if (!match) throw notFound(`no route for ${method} ${path}`);
    if (match.kind === 'method-not-allowed') {
      throw methodNotAllowed(`${method} is not allowed on ${path}`, { allowed: match.allowed });
    }
    await match.handler({ request, response, params: match.params, query: url.searchParams, requestId });
  } catch (error) {
    sendError(response, error, meta);
  } finally {
    const status = response.statusCode;
    const fields = {
      method,
      path,
      status,
      durationMs: Date.now() - startedAt,
      requestId,
      query: url.search || undefined,
    };
    if (status >= 500) app.logger.error('request failed', fields);
    else if (status >= 400) app.logger.warn('request rejected', fields);
    else app.logger.debug('request handled', fields);
  }
}
