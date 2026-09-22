/**
 * Execution history endpoints (contract §3 rows 14–15) — the debugging surface.
 */
import { executionNotFound, validationError } from '../http/errors.ts';
import { sendData } from '../http/respond.ts';
import type { App } from '../app-context.ts';
import type { Router } from '../http/router.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

export function registerExecutionRoutes(app: App, router: Router): void {
  router.get('/api/v1/executions', (context) => {
    const rawLimit = context.query.get('limit');
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== null) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw validationError(`limit must be an integer in [1, ${MAX_LIMIT}]`, { path: 'limit', received: rawLimit });
      }
      limit = parsed;
    }
    const items = app.executions.list(limit);
    sendData(context.response, 200, { count: items.length, items }, {
      requestId: context.requestId,
      config: app.config,
    });
  });

  router.get('/api/v1/executions/:id', async (context) => {
    const record = await app.executions.get(context.params.id as string);
    if (!record) throw executionNotFound(context.params.id as string);
    sendData(context.response, 200, record, { requestId: context.requestId, config: app.config });
  });
}
