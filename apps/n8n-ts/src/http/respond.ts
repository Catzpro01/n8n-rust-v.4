/**
 * Response helpers implementing the envelope rules of
 * contracts/runtime-api.contract.md §3:
 *   success → `{ data }`, error → `{ code, message, details?, requestId }`,
 *   every response carries `X-Request-Id` and `X-Content-Type-Options`.
 *
 * Per-request headers that depend on the *request* (CORS) are attached to the
 * response object once by the pipeline and merged here, so every writer —
 * including the error path — emits them.
 *
 * `X-Frame-Options` is deliberately never set: the console is embedded in a
 * proxied preview iframe.
 */
import type { ServerResponse } from 'node:http';
import { HttpError } from './errors.ts';
import type { RuntimeConfig } from '../config.ts';

export type ResponseMeta = {
  requestId: string;
  config: RuntimeConfig;
  extraHeaders?: Record<string, string>;
};

const requestHeaders = new WeakMap<ServerResponse, Record<string, string>>();

/** Attach headers that must appear on every response of this request. */
export function attachResponseHeaders(response: ServerResponse, headers: Record<string, string>): void {
  if (Object.keys(headers).length > 0) requestHeaders.set(response, headers);
}

function baseHeaders(response: ServerResponse, meta: ResponseMeta): Record<string, string> {
  return {
    'x-request-id': meta.requestId,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-n8n-ts-contract': '1.0.0',
    ...(requestHeaders.get(response) ?? {}),
    ...(meta.extraHeaders ?? {}),
  };
}

export function corsHeaders(config: RuntimeConfig): Record<string, string> {
  if (config.corsOrigin === 'off') return {};
  return {
    'access-control-allow-origin': config.corsOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, X-N8N-API-KEY, X-Request-Id',
    'access-control-expose-headers': 'X-Request-Id, X-N8N-TS-Contract',
    'access-control-max-age': '600',
  };
}

export function sendJson(response: ServerResponse, status: number, payload: unknown, meta: ResponseMeta): void {
  const body = Buffer.from(JSON.stringify(payload ?? null), 'utf8');
  response.writeHead(status, {
    ...baseHeaders(response, meta),
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
  });
  response.end(body);
}

export function sendData(response: ServerResponse, status: number, data: unknown, meta: ResponseMeta): void {
  sendJson(response, status, { data }, meta);
}

export function sendText(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  meta: ResponseMeta,
): void {
  const buffer = Buffer.from(body, 'utf8');
  response.writeHead(status, {
    ...baseHeaders(response, meta),
    'content-type': `${contentType}; charset=utf-8`,
    'content-length': String(buffer.byteLength),
  });
  response.end(buffer);
}

export function sendEmpty(response: ServerResponse, status: number, meta: ResponseMeta): void {
  response.writeHead(status, { ...baseHeaders(response, meta), 'content-length': '0' });
  response.end();
}

/** Map any thrown value to the frozen error body. */
export function sendError(response: ServerResponse, error: unknown, meta: ResponseMeta): void {
  const httpError =
    error instanceof HttpError
      ? error
      : new HttpError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));

  const body: Record<string, unknown> = {
    code: httpError.code,
    message: httpError.message,
    requestId: meta.requestId,
  };
  if (httpError.details !== undefined) body.details = httpError.details;
  if (meta.config.env !== 'production' && error instanceof Error && error.stack && httpError.status >= 500) {
    const current = typeof httpError.details === 'object' && httpError.details !== null ? httpError.details : {};
    body.details = { ...current, stack: error.stack };
  }
  let effectiveMeta = meta;
  if (httpError.status === 405 && httpError.details && typeof httpError.details === 'object') {
    const allowed = (httpError.details as { allowed?: string[] }).allowed;
    if (Array.isArray(allowed)) {
      effectiveMeta = { ...meta, extraHeaders: { ...(meta.extraHeaders ?? {}), allow: allowed.join(', ') } };
    }
  }
  sendJson(response, httpError.status, body, effectiveMeta);
}
