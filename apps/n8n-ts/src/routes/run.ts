/**
 * POST /api/v1/workflows/run — eksekusi sinkron via LEGO engine (kontrak §2.3 + §3).
 * Semua validasi workflow didelegasikan ke adapter Worker 4; route ini hanya
 * mengurus HTTP boundary (method, content-type, limit, envelope).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody } from '../body.js';
import type { BaselineConfig } from '../config.js';
import { sendFail, sendOk } from '../envelope.js';
import { executeWorkflow, validateWorkflow } from '../engine.js';
import { logger } from '../logger.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function handleRun(
  req: IncomingMessage,
  res: ServerResponse,
  config: BaselineConfig,
): Promise<void> {
  const started = Date.now();

  // 1. Content-Type harus JSON.
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().includes('application/json')) {
    sendFail(res, 415, 'Content-Type must be application/json', 'UNSUPPORTED_MEDIA_TYPE');
    logLine(req, 415, started, 0);
    return;
  }

  // 2. Baca body dengan limit.
  const body = await readBody(req, config.bodyLimitBytes);
  if (!body.ok) {
    if (body.reason === 'too-large') {
      sendFail(res, 413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
      logLine(req, 413, started, 0);
    } else {
      sendFail(res, 400, 'Invalid JSON body', 'MALFORMED_JSON');
      logLine(req, 400, started, 0);
    }
    return;
  }

  // 3. Parse JSON. Body kosong = bukan JSON valid (kontrak §3 → MALFORMED_JSON).
  if (body.raw.trim() === '') {
    sendFail(res, 400, 'Invalid JSON body', 'MALFORMED_JSON');
    logLine(req, 400, started, 0);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.raw) as unknown;
  } catch {
    sendFail(res, 400, 'Invalid JSON body', 'MALFORMED_JSON');
    logLine(req, 400, started, 0);
    return;
  }
  if (!isPlainObject(parsed)) {
    sendFail(res, 400, "Field 'workflow' is required and must be an object", 'MALFORMED_REQUEST');
    logLine(req, 400, started, 0);
    return;
  }

  const { workflow, input, startNode, locale } = parsed;

  // 4. Validasi `input` (satu-satunya validasi body di luar adapter — shape HTTP).
  if (input !== undefined && !isPlainObject(input) && !Array.isArray(input)) {
    sendFail(res, 400, "Field 'input' must be an object or array", 'MALFORMED_REQUEST');
    logLine(req, 400, started, 0);
    return;
  }

  // 5. Validasi workflow via adapter (kontrak §3 — semua kasus di sana).
  let validation;
  try {
    validation = await validateWorkflow(workflow, startNode);
  } catch (err) {
    logger.error('validation crashed', { error: String(err) });
    sendFail(res, 500, 'Workflow execution failed', 'EXECUTION_FAILED');
    logLine(req, 500, started, 0);
    return;
  }
  if (!validation.ok) {
    const first = validation.errors[0] ?? { message: 'Invalid workflow', hint: 'MALFORMED_REQUEST' };
    sendFail(res, 400, first.message, first.hint);
    logLine(req, 400, started, nodeCountOf(workflow));
    return;
  }

  // 6. Locale efektif: body.locale → workflow.activeLocale → env default.
  const workflowObj = workflow as Record<string, unknown>;
  const effectiveLocale = pickLocale(locale, workflowObj.activeLocale, config.defaultLocale);

  // 7. Eksekusi via SATU-SATUNYA engine.
  try {
    const result = await executeWorkflow({
      workflow: workflowObj,
      input: input ?? [{}],
      startNode: typeof startNode === 'string' ? startNode : null,
      locale: effectiveLocale,
      timeoutMs: config.executionTimeoutMs,
    });
    sendOk(res, result);
    logLine(req, 200, started, nodeCountOf(workflow));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('workflow execution failed', { error: message });
    logger.debug('execution error detail', { stack: err instanceof Error ? err.stack : undefined });
    sendFail(res, 500, 'Workflow execution failed', 'EXECUTION_FAILED');
    logLine(req, 500, started, nodeCountOf(workflow));
  }
}

function pickLocale(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c;
  }
  return 'id';
}

function nodeCountOf(workflow: unknown): number {
  if (isPlainObject(workflow) && Array.isArray(workflow.nodes)) return workflow.nodes.length;
  return 0;
}

function logLine(req: IncomingMessage, status: number, started: number, nodeCount: number): void {
  const ms = Date.now() - started;
  logger.info(`POST /api/v1/workflows/run ${status} ${ms}ms nodes=${nodeCount}`);
  logger.debug('run detail', { method: req.method, url: req.url, status, ms, nodeCount });
}
