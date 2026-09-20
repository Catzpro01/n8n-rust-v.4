/**
 * Workflow endpoints (contract §3 rows 7–13): stateless run, stored CRUD and
 * run-by-id.
 */
import { isPlainObject, readJsonBody, requireObjectBody } from '../http/body.ts';
import { validationError, workflowNotFound } from '../http/errors.ts';
import { sendData } from '../http/respond.ts';
import { executeWorkflowRun } from '../engine/bridge.ts';
import type { App } from '../app-context.ts';
import type { Router } from '../http/router.ts';
import type { ExecutionRecord } from '../store/execution-store.ts';

type RunPayload = {
  definition: unknown;
  startNode: string | null;
  input: unknown;
  locale: string | undefined;
  mode: string;
};

/** Accept `{ workflow }`, a bare workflow, or a stored-workflow reference. */
function extractRunPayload(body: Record<string, unknown>): RunPayload {
  const hasWrapper = isPlainObject(body.workflow);
  const definition = hasWrapper ? body.workflow : body;
  if (!isPlainObject(definition)) throw validationError('workflow definition must be a JSON object', { path: 'workflow' });
  if (body.startNode !== undefined && typeof body.startNode !== 'string') {
    throw validationError('startNode must be a string', { path: 'startNode' });
  }
  if (body.locale !== undefined && typeof body.locale !== 'string') {
    throw validationError('locale must be a string', { path: 'locale' });
  }
  if (body.input !== undefined && typeof body.input !== 'object') {
    throw validationError('input must be an object or an array of objects', { path: 'input' });
  }
  return {
    definition,
    startNode: (body.startNode as string | undefined) ?? null,
    input: body.input,
    locale: body.locale as string | undefined,
    mode: typeof body.mode === 'string' ? body.mode : 'manual',
  };
}

function runResultData(record: ExecutionRecord): Record<string, unknown> {
  return {
    executionId: record.executionId,
    workflowId: record.workflowId,
    status: record.status,
    finished: record.finished,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    durationMs: record.durationMs,
    executionLog: record.executionLog,
    data: record.data,
    warnings: record.warnings,
    ...(record.statusText !== undefined ? { statusText: record.statusText } : {}),
  };
}

export function registerWorkflowRoutes(app: App, router: Router): void {
  // Stateless run — must be registered before `/workflows/:id/run`.
  router.post('/api/v1/workflows/run', async (context) => {
    const body = requireObjectBody(await readJsonBody(context.request, app.config.maxBodyBytes));
    const payload = extractRunPayload(body);
    const record = await executeWorkflowRun({
      ...payload,
      config: app.config,
      logger: app.logger.child({ requestId: context.requestId }),
      store: app.executions,
      requestedBy: (body.requestedBy as 'http' | 'console' | undefined) ?? 'http',
      workflowId:
        typeof (payload.definition as { id?: unknown }).id === 'string'
          ? ((payload.definition as { id: string }).id)
          : null,
    });
    sendData(context.response, 200, runResultData(record), { requestId: context.requestId, config: app.config });
  });

  router.get('/api/v1/workflows', (context) => {
    const items = app.workflows.summaries();
    sendData(context.response, 200, { count: items.length, items }, {
      requestId: context.requestId,
      config: app.config,
    });
  });

  router.post('/api/v1/workflows', async (context) => {
    const body = requireObjectBody(await readJsonBody(context.request, app.config.maxBodyBytes));
    const definition = isPlainObject(body.workflow) ? body.workflow : body;
    const { workflow, created } = await app.workflows.save(definition);
    sendData(context.response, created ? 201 : 200, workflow, { requestId: context.requestId, config: app.config });
  });

  router.get('/api/v1/workflows/:id', (context) => {
    const workflow = app.workflows.get(context.params.id as string);
    if (!workflow) throw workflowNotFound(context.params.id as string);
    sendData(context.response, 200, workflow, { requestId: context.requestId, config: app.config });
  });

  router.put('/api/v1/workflows/:id', async (context) => {
    const id = context.params.id as string;
    if (!app.workflows.has(id)) throw workflowNotFound(id);
    const body = requireObjectBody(await readJsonBody(context.request, app.config.maxBodyBytes));
    const definition = isPlainObject(body.workflow) ? body.workflow : body;
    const { workflow } = await app.workflows.save(definition, { id });
    sendData(context.response, 200, workflow, { requestId: context.requestId, config: app.config });
  });

  router.delete('/api/v1/workflows/:id', async (context) => {
    const id = context.params.id as string;
    const deleted = await app.workflows.delete(id);
    if (!deleted) throw workflowNotFound(id);
    sendData(context.response, 200, { id, deleted: true }, { requestId: context.requestId, config: app.config });
  });

  router.post('/api/v1/workflows/:id/run', async (context) => {
    const id = context.params.id as string;
    const workflow = app.workflows.get(id);
    if (!workflow) throw workflowNotFound(id);
    const body = requireObjectBody(await readJsonBody(context.request, app.config.maxBodyBytes));
    const request = isPlainObject(body.request) ? (body.request as Record<string, unknown>) : body;
    const record = await executeWorkflowRun({
      definition: workflow,
      startNode: typeof request.startNode === 'string' ? request.startNode : null,
      input: request.input,
      locale: typeof request.locale === 'string' ? request.locale : undefined,
      mode: typeof request.mode === 'string' ? request.mode : 'manual',
      workflowId: id,
      requestedBy: (request.requestedBy as 'http' | 'console' | undefined) ?? 'http',
      config: app.config,
      logger: app.logger.child({ requestId: context.requestId }),
      store: app.executions,
    });
    sendData(context.response, 200, runResultData(record), { requestId: context.requestId, config: app.config });
  });
}
