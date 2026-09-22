/**
 * Request body reading with a hard byte limit (`N8N_TS_MAX_BODY_BYTES`).
 * Content-Length is checked first, then the streamed size, so a lying client
 * cannot stream past the limit.
 */
import type { IncomingMessage } from 'node:http';
import { HttpError, badJson, payloadTooLarge } from './errors.ts';

export async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = req.headers['content-length'];
  if (typeof declared === 'string' && declared !== '') {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) throw payloadTooLarge(maxBytes);
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.byteLength;
    if (size > maxBytes) throw payloadTooLarge(maxBytes);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Parse a JSON body. Empty bodies become `{}` so that `POST` endpoints with an
 * optional payload do not need a special case.
 */
export function parseJsonBody(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return {};
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw badJson(`request body is not valid JSON: ${(error as Error).message}`);
  }
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return parseJsonBody(await readRequestBody(req, maxBytes));
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Assert a JSON object body (used by every write endpoint). */
export function requireObjectBody(value: unknown, what = 'request body'): Record<string, unknown> {
  if (!isPlainObject(value)) throw invalidBody(what);
  return value;
}

function invalidBody(what: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', `${what} must be a JSON object`);
}
