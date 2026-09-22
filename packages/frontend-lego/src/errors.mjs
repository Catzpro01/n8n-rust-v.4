/**
 * Frontend error boundary — backend errors become machine-readable before they
 * become displayable.
 *
 * Chain (contract §8):
 *
 *   backend error (status + code + meta)
 *        → normalizeError()   FrontendError { kind, status, code, messageKey, params, meta }
 *        → toDisplayModel()   { messageKey, fallbackText, severity, actions }
 *        → (future Translation LEGO) renders messageKey in the active locale
 *
 * The point of the indirection: today the fallback text is English, tomorrow a
 * locale catalog replaces it — and nothing in between ever has to parse a
 * sentence to know what happened. `code` is the API of this module.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { MESSAGE_SLOTS } from './i18n.mjs';

/**
 * Error kinds — the frontend's closed vocabulary. A kind is what a surface
 * branches on; it is never derived from message text.
 */
export const ERROR_KINDS = Object.freeze([
  'network',
  'auth',
  'forbidden',
  'not-found',
  'conflict',
  'validation',
  'unsupported',
  'server',
  'aborted',
  'unknown',
]);

/** Stable machine-readable codes. `frontend.*` codes are ours; others may be backend codes. */
export const ERROR_CODES = Object.freeze({
  NETWORK_UNREACHABLE: 'frontend.network.unreachable',
  REQUEST_ABORTED: 'frontend.request.aborted',
  SESSION_EXPIRED: 'frontend.session.expired',
  PERMISSION_DENIED: 'frontend.permission.denied',
  RESOURCE_MISSING: 'frontend.resource.missing',
  RESOURCE_CONFLICT: 'frontend.resource.conflict',
  REQUEST_INVALID: 'frontend.request.invalid',
  VALIDATION_FAILED: 'frontend.validation.failed',
  CAPABILITY_UNSUPPORTED: 'frontend.capability.unsupported',
  SERVER_ERROR: 'frontend.server.error',
  ERROR_UNKNOWN: 'frontend.error.unknown',
});

/**
 * Default mapping: kind → { code, messageKey, severity, retryable }.
 * `messageKey` lives in the `backend-errors` slot of the message-slot model, so a
 * future catalog covers it without touching this table.
 */
const DEFAULTS = Object.freeze({
  network: Object.freeze({ code: ERROR_CODES.NETWORK_UNREACHABLE, messageKey: 'backend-errors.network-unreachable', severity: 'error', retryable: true, actions: Object.freeze(['retry', 'dismiss']) }),
  aborted: Object.freeze({ code: ERROR_CODES.REQUEST_ABORTED, messageKey: 'backend-errors.request-aborted', severity: 'info', retryable: true, actions: Object.freeze(['dismiss']) }),
  auth: Object.freeze({ code: ERROR_CODES.SESSION_EXPIRED, messageKey: 'backend-errors.session-expired', severity: 'error', retryable: false, actions: Object.freeze(['signin', 'dismiss']) }),
  forbidden: Object.freeze({ code: ERROR_CODES.PERMISSION_DENIED, messageKey: 'backend-errors.permission-denied', severity: 'warning', retryable: false, actions: Object.freeze(['dismiss']) }),
  'not-found': Object.freeze({ code: ERROR_CODES.RESOURCE_MISSING, messageKey: 'backend-errors.resource-missing', severity: 'warning', retryable: false, actions: Object.freeze(['back', 'dismiss']) }),
  conflict: Object.freeze({ code: ERROR_CODES.RESOURCE_CONFLICT, messageKey: 'backend-errors.resource-conflict', severity: 'warning', retryable: true, actions: Object.freeze(['reload', 'dismiss']) }),
  validation: Object.freeze({ code: ERROR_CODES.VALIDATION_FAILED, messageKey: 'backend-errors.validation-failed', severity: 'error', retryable: false, actions: Object.freeze(['dismiss']) }),
  unsupported: Object.freeze({ code: ERROR_CODES.CAPABILITY_UNSUPPORTED, messageKey: 'backend-errors.capability-unsupported', severity: 'warning', retryable: false, actions: Object.freeze(['dismiss']) }),
  server: Object.freeze({ code: ERROR_CODES.SERVER_ERROR, messageKey: 'backend-errors.server-error', severity: 'error', retryable: true, actions: Object.freeze(['retry', 'dismiss']) }),
  unknown: Object.freeze({ code: ERROR_CODES.ERROR_UNKNOWN, messageKey: 'backend-errors.unknown', severity: 'error', retryable: false, actions: Object.freeze(['dismiss']) }),
});

/**
 * Temporary English fallbacks, one per kind. Not a translation system: no locale
 * switch, no dictionaries — a readable sentence so the UI is usable until the
 * Translation LEGO renders `messageKey`. Keys are the same `messageKey`s above.
 */
const FALLBACK_TEXT = Object.freeze({
  'backend-errors.network-unreachable': 'Cannot reach the n8n server. Check your connection and try again.',
  'backend-errors.request-aborted': 'The request was cancelled.',
  'backend-errors.session-expired': 'Your session expired. Please sign in again.',
  'backend-errors.permission-denied': 'You do not have permission to do that.',
  'backend-errors.resource-missing': 'That item no longer exists.',
  'backend-errors.resource-conflict': 'Somebody changed this in the meantime. Reload and try again.',
  'backend-errors.validation-failed': 'The request was rejected by the server.',
  'backend-errors.capability-unsupported': 'This n8n instance does not support “{feature}” yet.',
  'backend-errors.server-error': 'The n8n server reported an internal error.',
  'backend-errors.unknown': 'Something went wrong.',
});

/** Status code → kind. The one place a status number is interpreted. */
export function kindForStatus(status) {
  if (status === 0) return 'network';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status === 501) return 'unsupported';
  if (status >= 500) return 'server';
  if (status >= 400) return 'validation';
  return 'unknown';
}

/** The error model every surface consumes. Never thrown across the boundary. */
export class FrontendError extends Error {
  /**
   * @param {object} init
   * @param {string} init.kind one of ERROR_KINDS
   * @param {string} [init.code] machine-readable code (backend code or ERROR_CODES)
   * @param {string} [init.messageKey] message slot key (<slot>.<name>)
   * @param {number} [init.status] HTTP status, 0 for transport failures
   * @param {object} [init.params] placeholders for the message (e.g. { feature })
   * @param {boolean} [init.retryable]
   * @param {object} [init.meta] backend `meta` (e.g. { feature, owner, phase })
   * @param {string} [init.fallbackText] backend message or the built-in fallback
   * @param {string|null} [init.surface] surface id the error happened on
   */
  constructor(init = {}) {
    const kind = ERROR_KINDS.includes(init.kind) ? init.kind : 'unknown';
    const defaults = DEFAULTS[kind];
    const messageKey = init.messageKey ?? defaults.messageKey;
    const fallbackText = init.fallbackText ?? FALLBACK_TEXT[messageKey] ?? FALLBACK_TEXT[DEFAULTS.unknown.messageKey];
    super(fallbackText);
    this.name = 'FrontendError';
    this.kind = kind;
    this.status = typeof init.status === 'number' ? init.status : 0;
    this.code = init.code ?? defaults.code;
    this.messageKey = messageKey;
    this.params = Object.freeze({ ...(init.params ?? {}) });
    this.retryable = init.retryable ?? defaults.retryable;
    this.meta = Object.freeze({ ...(init.meta ?? {}) });
    this.fallbackText = fallbackText;
    this.surface = init.surface ?? null;
    this.actions = defaults.actions;
    if (init.cause !== undefined) this.cause = init.cause;
  }

  /** Serialisable form — what a consumer may put in state, logs or evidence. */
  toJSON() {
    return {
      kind: this.kind,
      status: this.status,
      code: this.code,
      messageKey: this.messageKey,
      params: this.params,
      retryable: this.retryable,
      meta: this.meta,
      surface: this.surface,
    };
  }
}

export function isFrontendError(value) {
  return value instanceof FrontendError;
}

/**
 * Normalizes anything a request layer can produce into a `FrontendError`.
 * Accepted inputs: FrontendError (returned as-is), a fetch `Response`, an object
 * with `{ status, code?, message?, meta? }` (the compatibility layer's
 * `HttpError`), an `AbortError`, any other `Error`, or an unknown value.
 *
 * @param {unknown} input
 * @param {{ surface?: string|null, aborted?: boolean }} [options]
 * @returns {FrontendError}
 */
export function normalizeError(input, options = {}) {
  if (input instanceof FrontendError) {
    if (options.surface && !input.surface) input.surface = options.surface;
    return input;
  }

  const surface = options.surface ?? null;

  if (options.aborted === true) {
    return new FrontendError({ kind: 'aborted', surface, cause: input });
  }

  if (input instanceof Error && input.name === 'AbortError') {
    return new FrontendError({ kind: 'aborted', surface, cause: input });
  }

  // Transport failure: fetch rejects with a TypeError when the host is unreachable.
  if (input instanceof TypeError) {
    return new FrontendError({ kind: 'network', fallbackText: 'Cannot reach the n8n server.', surface, cause: input });
  }

  const status = Number(
    typeof input === 'object' && input !== null && 'status' in input
      ? input.status
      : typeof input === 'object' && input !== null && typeof input.statusCode === 'number'
        ? input.statusCode
        : NaN,
  );

  if (!Number.isFinite(status)) {
    return new FrontendError({
      kind: 'unknown',
      surface,
      fallbackText: typeof input === 'string' && input.length > 0 ? input : undefined,
      cause: input instanceof Error ? input : undefined,
    });
  }

  const body = typeof input === 'object' && input !== null && input.body && typeof input.body === 'object' ? input.body : input;
  const backendCode = typeof body?.code === 'string' || typeof body?.code === 'number' ? String(body.code) : undefined;
  const backendMessage = typeof body?.message === 'string' && body.message.length > 0 ? body.message : undefined;
  const backendMeta = typeof body?.meta === 'object' && body.meta !== null ? body.meta : undefined;

  const kind = kindForStatus(status);
  const defaults = DEFAULTS[kind];

  // `unsupported` carries the capability metadata from the P2 contract: those
  // fields are the machine-readable payload a surface shows instead of a guess.
  if (kind === 'unsupported') {
    const feature = typeof backendMeta?.feature === 'string' ? backendMeta.feature : undefined;
    return new FrontendError({
      kind,
      status,
      code: backendCode ?? defaults.code,
      messageKey: defaults.messageKey,
      params: feature ? { feature } : {},
      meta: backendMeta,
      fallbackText: backendMessage ?? FALLBACK_TEXT[defaults.messageKey],
      surface,
    });
  }

  // zod-style validation bodies (api.contract §3) are their own contract: the
  // first issue is the body, with `code` and `path` but no envelope. `path` is
  // what a form needs to highlight the field, so it wins over the message.
  if (kind === 'validation' && Array.isArray(body?.path)) {
    return new FrontendError({
      kind,
      status,
      code: backendCode ?? ERROR_CODES.REQUEST_INVALID,
      messageKey: defaults.messageKey,
      params: { field: Array.isArray(body.path) ? body.path.join('.') : String(body.path) },
      meta: { ...(backendMeta ?? {}), path: body.path, issue: backendCode },
      fallbackText: typeof body?.message === 'string' ? body.message : undefined,
      surface,
    });
  }

  return new FrontendError({
    kind,
    status,
    code: backendCode ?? defaults.code,
    messageKey: defaults.messageKey,
    meta: backendMeta,
    fallbackText: backendMessage,
    surface,
  });
}

/**
 * What a surface renders. `messageKey` + `params` are the localizable part;
 * `fallbackText` is what shows today.
 *
 * @param {FrontendError} error
 * @returns {{ code: string, messageKey: string, params: object, fallbackText: string, severity: string, retryable: boolean, actions: string[], status: number, meta: object, surface: string|null }}
 */
export function toDisplayModel(error) {
  const value = isFrontendError(error) ? error : normalizeError(error);
  const defaults = DEFAULTS[value.kind] ?? DEFAULTS.unknown;
  return {
    code: value.code,
    messageKey: value.messageKey,
    params: value.params,
    fallbackText: value.fallbackText,
    severity: defaults.severity,
    retryable: value.retryable,
    actions: [...defaults.actions],
    status: value.status,
    meta: value.meta,
    surface: value.surface,
  };
}

/**
 * Every `messageKey` this module can emit. The contract test asserts they all
 * live in the `backend-errors` slot, so the Translation LEGO can enumerate them.
 */
export function errorMessageKeys() {
  return Object.freeze(Object.values(DEFAULTS).map((entry) => entry.messageKey));
}

/** Guard used by the contract test: all error keys belong to a declared slot. */
export function assertErrorKeysUseDeclaredSlots() {
  const slots = new Set(MESSAGE_SLOTS.map((slot) => slot.id));
  const offenders = errorMessageKeys().filter((key) => !slots.has(key.split('.')[0]));
  if (offenders.length > 0) {
    throw new Error(`error message keys outside the declared slots: ${offenders.join(', ')}`);
  }
  return true;
}
