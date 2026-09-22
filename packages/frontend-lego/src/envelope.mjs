/**
 * The operation envelope — semantic, not a wire format.
 *
 * The frontend needs one lightweight context per boundary crossing: who is
 * acting, on which capability and operation, against which contract version, with
 * what deadline, and how to correlate/observe the result. That context is the
 * same whether the answer comes from a REST call, from a local computation, or
 * from a cached value.
 *
 * Two rules keep it honest:
 *
 *   1. it carries **no secrets** — an authorization *context* (scopes, subject),
 *      never a token, and the constructor refuses anything that looks like one;
 *   2. it serializes **nothing** for local execution — `toTransportHints()` is
 *      empty for `transport: 'local'`, so the envelope never becomes a payload
 *      that a local call has to pay for.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { CONTRACT_VERSION } from './contract.mjs';

export const TRANSPORTS = Object.freeze(['rest', 'local', 'none']);

/** Fields that make up the envelope, in the order documentation shows them. */
export const ENVELOPE_FIELDS = Object.freeze([
  'capability',
  'operation',
  'contractVersion',
  'correlationId',
  'authorization',
  'deadlineMs',
  'cancellation',
  'idempotencyKey',
]);

/** Field names that would turn an authorization *context* into a credential. */
const FORBIDDEN_AUTH_KEYS = Object.freeze(['token', 'accessToken', 'refreshToken', 'password', 'secret', 'apiKey', 'authorization', 'cookie', 'jwt', 'bearer']);

const OPERATION_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class EnvelopeError extends Error {
  constructor(message, { field } = {}) {
    super(message);
    this.name = 'EnvelopeError';
    this.code = 'frontend.envelope.invalid';
    this.field = field ?? null;
  }
}

let counter = 0;

/** Deterministic-enough correlation id that does not need a crypto API. */
export function nextCorrelationId(prefix = 'fe') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * @param {object} init
 * @param {string} init.capability          capability id that owns the operation
 * @param {string} init.operation           semantic operation, e.g. `workflow.list`
 * @param {string} [init.contractVersion]   contract version the caller speaks
 * @param {string} [init.correlationId]     request/correlation identity
 * @param {{ subject?: string, scopes?: string[] }} [init.authorization]
 * @param {number} [init.deadlineMs]        relative budget; becomes an absolute deadline
 * @param {AbortSignal} [init.signal]       cancellation
 * @param {string} [init.idempotencyKey]    required for `command` operations
 * @param {'rest'|'local'|'none'} [init.transport]
 * @param {string} [init.kind]              `query` | `command`
 * @param {() => number} [init.now]
 */
export function createOperationContext({
  capability,
  operation,
  contractVersion = CONTRACT_VERSION,
  correlationId = nextCorrelationId(),
  authorization = { subject: null, scopes: [] },
  deadlineMs = null,
  signal = null,
  idempotencyKey = null,
  transport = 'rest',
  kind = 'query',
  now = () => Date.now(),
} = {}) {
  if (typeof capability !== 'string' || !CAPABILITY_PATTERN.test(capability)) {
    throw new EnvelopeError(`capability must be kebab-case (got ${JSON.stringify(capability)})`, { field: 'capability' });
  }
  if (typeof operation !== 'string' || !OPERATION_PATTERN.test(operation)) {
    throw new EnvelopeError(`operation must look like "<domain>.<name>" (got ${JSON.stringify(operation)})`, { field: 'operation' });
  }
  if (!TRANSPORTS.includes(transport)) {
    throw new EnvelopeError(`transport must be one of ${TRANSPORTS.join(', ')}`, { field: 'transport' });
  }
  if (deadlineMs !== null && (!Number.isFinite(deadlineMs) || deadlineMs <= 0)) {
    throw new EnvelopeError('deadlineMs must be a positive number of milliseconds', { field: 'deadlineMs' });
  }
  if (kind === 'command' && (idempotencyKey === null || idempotencyKey === '')) {
    // A command without an idempotency key is a retry waiting to duplicate work.
    throw new EnvelopeError(`operation "${operation}" is a command and needs an idempotencyKey`, { field: 'idempotencyKey' });
  }
  if (authorization === null || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw new EnvelopeError('authorization must be a context object ({ subject, scopes })', { field: 'authorization' });
  }
  const leaked = Object.keys(authorization).filter((key) => FORBIDDEN_AUTH_KEYS.includes(key));
  if (leaked.length > 0) {
    throw new EnvelopeError(
      `the envelope carries an authorization context, never a credential (remove: ${leaked.join(', ')})`,
      { field: 'authorization' },
    );
  }

  const startedAt = now();
  const deadline = deadlineMs === null ? null : startedAt + deadlineMs;
  const scopes = Object.freeze([...(authorization.scopes ?? [])]);
  const subject = authorization.subject ?? null;

  return Object.freeze({
    capability,
    operation,
    kind,
    contractVersion,
    correlationId,
    authorization: Object.freeze({ subject, scopes }),
    deadlineMs,
    deadline,
    idempotencyKey,
    transport,
    signal,
    /** Stable semantic identity used by logs, traces and the plan model. */
    identity: `${capability}:${operation}@${contractVersion}`,

    cancelled() {
      return Boolean(signal?.aborted);
    },
    expired(at = now()) {
      return deadline !== null && at > deadline;
    },
    remainingMs(at = now()) {
      return deadline === null ? null : Math.max(0, deadline - at);
    },

    /**
     * The only place the envelope touches the wire — and it stays empty unless
     * the request actually travels. Local execution pays nothing.
     */
    toTransportHints() {
      if (transport !== 'rest') return Object.freeze({ headers: Object.freeze({}), query: Object.freeze({}) });
      const headers = { 'x-correlation-id': correlationId, 'x-contract-version': contractVersion };
      if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
      return Object.freeze({ headers: Object.freeze(headers), query: Object.freeze({}) });
    },

    /** Observability record: boundary-level, no per-component tracing. */
    describe() {
      return Object.freeze({
        identity: `${capability}:${operation}@${contractVersion}`,
        capability,
        operation,
        kind,
        contractVersion,
        correlationId,
        transport,
        subject,
        scopes: scopes.length,
        deadline,
        idempotencyKey,
      });
    },
  });
}

/**
 * The outcome record a boundary writes once per crossing. Deliberately small and
 * free of payloads: identity, outcome, duration, optional machine-readable code.
 */
export function observationRecord(context, { outcome = 'ok', durationMs = null, errorCode = null, subLego = null, at = Date.now() } = {}) {
  const base = typeof context?.describe === 'function' ? context.describe() : {};
  return Object.freeze({
    lego: 'ui-frontend',
    subLego,
    identity: base.identity ?? null,
    capability: base.capability ?? null,
    operation: base.operation ?? null,
    contractVersion: base.contractVersion ?? null,
    correlationId: base.correlationId ?? null,
    transport: base.transport ?? null,
    outcome,
    durationMs,
    errorCode,
    at: new Date(at).toISOString(),
  });
}

/** Envelope contract as data (docs, `.ai/` cards, tests). */
export function describeEnvelope() {
  return Object.freeze({
    fields: ENVELOPE_FIELDS,
    transports: TRANSPORTS,
    rules: Object.freeze([
      'An authorization context is { subject, scopes } — never a token, cookie or key.',
      'A command operation must carry an idempotencyKey.',
      'A deadline is a budget in milliseconds; the context exposes the absolute deadline.',
      'Cancellation is an AbortSignal, not a boolean flag to poll.',
      'Local execution serializes nothing: transport hints are empty.',
      'The envelope is semantic: no display text, no payload bodies, no error messages.',
    ]),
  });
}
