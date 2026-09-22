/**
 * HTTP error taxonomy — the frozen code vocabulary of
 * contracts/runtime-api.contract.md §4.
 */

export type ErrorCode =
  | 'BAD_JSON'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_START_NODE'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'WORKFLOW_NOT_FOUND'
  | 'EXECUTION_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'EMPTY_WORKFLOW'
  | 'INVALID_WORKFLOW'
  | 'UNKNOWN_NODE'
  | 'UNKNOWN_CONNECTION'
  | 'INTERNAL_ERROR'
  | 'STORAGE_ERROR'
  | 'NOT_READY'
  | 'EXECUTION_TIMEOUT';

export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;
  readonly code: ErrorCode;
  details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badJson = (message: string, details?: unknown): HttpError => new HttpError(400, 'BAD_JSON', message, details);
export const validationError = (message: string, details?: unknown): HttpError =>
  new HttpError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'missing or invalid X-N8N-API-KEY header'): HttpError =>
  new HttpError(401, 'UNAUTHORIZED', message);
export const notFound = (message = 'route not found'): HttpError => new HttpError(404, 'NOT_FOUND', message);
export const workflowNotFound = (id: string): HttpError =>
  new HttpError(404, 'WORKFLOW_NOT_FOUND', `workflow "${id}" does not exist`);
export const executionNotFound = (id: string): HttpError =>
  new HttpError(404, 'EXECUTION_NOT_FOUND', `execution "${id}" does not exist`);
export const methodNotAllowed = (message: string, details?: unknown): HttpError =>
  new HttpError(405, 'METHOD_NOT_ALLOWED', message, details);
export const payloadTooLarge = (limit: number): HttpError =>
  new HttpError(413, 'PAYLOAD_TOO_LARGE', `request body exceeds N8N_TS_MAX_BODY_BYTES (${limit} bytes)`);
export const emptyWorkflow = (details?: unknown): HttpError =>
  new HttpError(422, 'EMPTY_WORKFLOW', 'workflow contains no nodes', details);
export const invalidWorkflow = (message: string, details?: unknown): HttpError =>
  new HttpError(422, 'INVALID_WORKFLOW', message, details);
export const unknownNode = (message: string, details?: unknown): HttpError =>
  new HttpError(422, 'UNKNOWN_NODE', message, details);
export const unknownConnection = (message: string, details?: unknown): HttpError =>
  new HttpError(422, 'UNKNOWN_CONNECTION', message, details);
export const storageError = (message: string, details?: unknown): HttpError =>
  new HttpError(500, 'STORAGE_ERROR', message, details);
export const internalError = (message: string, details?: unknown): HttpError =>
  new HttpError(500, 'INTERNAL_ERROR', message, details);
export const notReady = (message: string, details?: unknown): HttpError => new HttpError(503, 'NOT_READY', message, details);
export const executionTimeout = (timeoutMs: number): HttpError =>
  new HttpError(504, 'EXECUTION_TIMEOUT', `execution exceeded N8N_TS_EXECUTION_TIMEOUT_MS (${timeoutMs} ms)`);
