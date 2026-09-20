/**
 * Envelope HTTP baseline — selaras contracts/api.contract.md §3:
 * sukses `{ data }`, error `{ code, message, hint? }`. Selalu JSON.
 */
import type { ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Sukses: 200 { data } */
export function sendOk(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { data });
}

/** Error: { code, message, hint? } — tanpa stacktrace (kontrak §3). */
export function sendFail(res: ServerResponse, code: number, message: string, hint?: string): void {
  sendJson(res, code, hint === undefined ? { code, message } : { code, message, hint });
}

export function sendNotFound(res: ServerResponse): void {
  sendFail(res, 404, 'Not Found', 'NOT_FOUND');
}

export function sendMethodNotAllowed(res: ServerResponse): void {
  sendFail(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED');
}
