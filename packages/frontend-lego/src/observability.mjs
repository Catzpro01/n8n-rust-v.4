/**
 * Boundary-level observability: a small, stable event vocabulary and a sink.
 *
 * What this is: named events at the moments that matter architecturally — a
 * capability registered, a lifecycle transition, a contract mismatch, an upgrade
 * applied or refused, an operation rejected, a degradation decided. A future
 * observability system consumes them; today the sink defaults to a bounded
 * in-memory buffer so the events are inspectable in tests and in the evidence.
 *
 * What this deliberately is not: no telemetry service, no batching, no sampling,
 * no network, no per-component tracing. Events carry semantic identity, never
 * payloads, subjects or scopes — an observability record that leaks a session is a
 * liability, not telemetry.
 *
 * The sink is isolated: a broken sink must never break the UI, so a throwing sink
 * is caught and counted rather than propagated.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/**
 * The vocabulary. Ids are stable and semantic; adding one is additive, renaming
 * one is a breaking change to whoever consumes the stream.
 */
export const FRONTEND_EVENTS = Object.freeze({
  // capability + lifecycle
  CAPABILITY_REGISTERED: 'frontend.capability.registered',
  CAPABILITY_REJECTED: 'frontend.capability.rejected',
  CAPABILITY_DISABLED: 'frontend.capability.disabled',
  CAPABILITY_DEGRADED: 'frontend.capability.degraded',
  LIFECYCLE_TRANSITION: 'frontend.lifecycle.transition',
  // negotiation + contracts
  NEGOTIATION_DECIDED: 'frontend.negotiation.decided',
  CONTRACT_MISMATCH: 'frontend.contract.mismatch',
  // units
  UNIT_REGISTERED: 'frontend.unit.registered',
  UNIT_REJECTED: 'frontend.unit.rejected',
  UPGRADE_APPLIED: 'frontend.upgrade.applied',
  UPGRADE_REJECTED: 'frontend.upgrade.rejected',
  DOWNGRADE_REJECTED: 'frontend.upgrade.downgrade-rejected',
  REPLACEMENT_APPLIED: 'frontend.replacement.applied',
  REPLACEMENT_REJECTED: 'frontend.replacement.rejected',
  // operations
  OPERATION_COMPLETED: 'frontend.operation.completed',
  OPERATION_REJECTED: 'frontend.operation.rejected',
  // knowledge pack
  PACK_DRIFT_DETECTED: 'frontend.pack.drift-detected',
});

export const EVENT_NAMES = Object.freeze(Object.values(FRONTEND_EVENTS));

/** Fields every event carries. Anything else is event-specific metadata. */
export const EVENT_FIELDS = Object.freeze(['id', 'at', 'sequence', 'lego', 'subLego', 'capability', 'operation', 'details']);

/** Fields that must never appear in an event: they belong to the session, not to telemetry. */
const FORBIDDEN_KEYS = Object.freeze(['payload', 'body', 'token', 'authorization', 'subject', 'scopes', 'cookie', 'password', 'secret', 'content']);

export class ObservabilityError extends Error {
  constructor(message, { eventId, errors } = {}) {
    super(message);
    this.name = 'ObservabilityError';
    this.code = 'frontend.observability.invalid-event';
    this.eventId = eventId ?? null;
    this.errors = Object.freeze([...(errors ?? [])]);
  }
}

/**
 * @param {object} init
 * @param {(event: object) => void} [init.sink]  consumer; defaults to the internal buffer only
 * @param {number} [init.limit]                  ring-buffer size (events kept in memory)
 * @param {() => number} [init.now]
 * @param {() => string} [init.idFactory]
 */
export function createObservability({ sink = null, limit = 200, now = () => Date.now(), idFactory = null } = {}) {
  if (!Number.isInteger(limit) || limit <= 0) throw new ObservabilityError(`limit must be a positive integer (got ${limit})`);
  if (sink !== null && typeof sink !== 'function') throw new ObservabilityError('sink must be a function or null');

  let sequence = 0;
  const buffer = [];
  let dropped = 0;
  let sinkErrors = 0;

  /** Emits one event. Returns the frozen event, or null when the id is not declared. */
  function emit(id, { subLego = null, capability = null, operation = null, ...details } = {}) {
    if (!EVENT_NAMES.includes(id)) {
      // An undeclared event id is a typo that would silently produce an unusable
      // stream; refusing it is cheaper than discovering it in a dashboard.
      throw new ObservabilityError(`"${id}" is not a declared frontend event`, { eventId: id, errors: [`unknown event id "${id}"`] });
    }
    const leaked = Object.keys(details).filter((key) => FORBIDDEN_KEYS.includes(key));
    if (leaked.length > 0) {
      throw new ObservabilityError(
        `event "${id}" carries fields that belong to the session, not to telemetry: ${leaked.join(', ')}`,
        { eventId: id, errors: leaked.map((key) => `${key} is forbidden`) },
      );
    }
    sequence += 1;
    const event = Object.freeze({
      id,
      at: new Date(now()).toISOString(),
      sequence,
      lego: 'ui-frontend',
      subLego,
      capability,
      operation,
      details: Object.freeze({ ...details }),
      ...(idFactory ? { traceId: idFactory() } : {}),
    });
    buffer.push(event);
    if (buffer.length > limit) {
      buffer.shift();
      dropped += 1;
    }
    if (sink) {
      try {
        sink(event);
      } catch {
        // A broken consumer is not allowed to break the UI. Counted, then ignored.
        sinkErrors += 1;
      }
    }
    return event;
  }

  /** Emits only when the id is declared — for call sites that cannot afford to throw. */
  function tryEmit(id, fields) {
    try {
      return emit(id, fields);
    } catch {
      return null;
    }
  }

  return Object.freeze({
    emit,
    tryEmit,
    events: () => Object.freeze([...buffer]),
    recent: (count = 10) => Object.freeze(buffer.slice(-Math.max(0, count))),
    /** Counts per event id — the shape a dashboard needs, without a dashboard. */
    counts: () => Object.freeze(buffer.reduce((counts, event) => {
      counts[event.id] = (counts[event.id] ?? 0) + 1;
      return counts;
    }, {})),
    stats: () => Object.freeze({ emitted: sequence, kept: buffer.length, dropped, sinkErrors, limit }),
    clear: () => {
      buffer.length = 0;
      return true;
    },
  });
}

/**
 * A sink that records events into an array it owns — used by tests, evidence and
 * any tool that wants the stream without a framework behind it.
 */
export function createBufferSink() {
  const seen = [];
  return Object.freeze({
    sink: (event) => seen.push(event),
    events: () => Object.freeze([...seen]),
  });
}

/** The event model as data (docs, `.ai/` cards, the future observability system). */
export function describeObservability() {
  return Object.freeze({
    events: Object.freeze(Object.entries(FRONTEND_EVENTS).map(([constant, id]) => Object.freeze({ constant, id }))),
    fields: EVENT_FIELDS,
    forbiddenFields: FORBIDDEN_KEYS,
    rules: Object.freeze([
      'Boundary level only: capability, unit, operation, lifecycle — never per component.',
      'Semantic identity in, no payloads, no subjects, no scopes out.',
      'An undeclared event id is refused, so the stream cannot silently gain a new shape.',
      'A throwing sink is counted and ignored: observability never breaks the UI.',
      'The default sink is a bounded in-memory buffer; nothing is sent anywhere.',
    ]),
  });
}
