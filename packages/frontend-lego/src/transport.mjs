/**
 * Transport-neutral operation delivery.
 *
 * A business contract says *what* an operation is (`workflow.list`). It says
 * nothing about *how* the call travels. That decision belongs here, and it is made
 * by cost: the cheapest transport that can carry the operation wins, which for a
 * same-process LEGO is a direct call with no serialization at all.
 *
 * What this deliberately is not:
 *
 *   - no service registry, no broker, no message bus, no daemon;
 *   - no HTTP between local modules — a transport must declare the kinds it can
 *     carry, and the local one can only carry `local` operations;
 *   - no hidden fallback: if nothing can carry an operation, the call is refused by
 *     name rather than quietly routed somewhere slower.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { ENVELOPE_FIELDS, createOperationContext, observationRecord } from './envelope.mjs';
import { DEFAULT_INTERACTION, canCarry as canCarryInteraction, interactionOf } from './interactions.mjs';

/**
 * Transport kinds, cheapest first. `event` and `stream` are delivery *shapes*
 * (fire-and-forget, incremental); `ipc` and `remote` are declared so a future
 * implementation can register them without the contract changing.
 */
export const TRANSPORT_KINDS = Object.freeze(['local', 'rest', 'event', 'stream', 'ipc', 'remote']);

/** What a transport costs a caller. Used for selection and reported in the plan. */
export const TRANSPORT_COSTS = Object.freeze({ local: 0, event: 1, stream: 2, rest: 3, ipc: 4, remote: 5 });

/** Serialization a transport imposes. `none` is the point of the local transport. */
export const SERIALIZATION = Object.freeze(['none', 'json', 'binary', 'stream']);

export class TransportError extends Error {
  constructor(message, { code = 'frontend.transport.unavailable', operation = null, capability = null } = {}) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.operation = operation;
    this.capability = capability;
  }
}

/** Raised when no registered transport can carry an operation. Fail closed. */
export class NoTransportError extends TransportError {
  constructor(message, { operation, capability, considered } = {}) {
    super(message, { code: 'frontend.transport.unsupported', operation, capability });
    this.name = 'NoTransportError';
    this.considered = Object.freeze([...(considered ?? [])]);
  }
}

/**
 * Declares a transport. `invoke` is the only function a transport owns; everything
 * else here is metadata that makes the choice inspectable.
 *
 * @param {object} init
 * @param {string} init.id                    stable transport identity
 * @param {'local'|'rest'|'event'|'stream'|'ipc'|'remote'} init.kind
 * @param {(context: object) => any} [init.invoke]
 * @param {string[]} [init.operations]        operations this transport can carry (`*` = any)
 * @param {string[]} [init.capabilities]      capabilities it serves (empty = all)
 * @param {'none'|'json'|'binary'|'stream'} [init.serialization]
 * @param {boolean} [init.implemented]        false = declared for the future, not usable
 */
export function defineTransport({
  id,
  kind,
  invoke = null,
  operations = ['*'],
  capabilities = [],
  serialization = 'json',
  implemented = true,
  notes = null,
} = {}) {
  if (typeof id !== 'string' || id.length === 0) throw new TransportError('a transport needs an id');
  if (!TRANSPORT_KINDS.includes(kind)) throw new TransportError(`transport "${id}" has unknown kind "${kind}" (one of ${TRANSPORT_KINDS.join(', ')})`);
  if (!SERIALIZATION.includes(serialization)) throw new TransportError(`transport "${id}" has unknown serialization "${serialization}" (one of ${SERIALIZATION.join(', ')})`);
  if (implemented && typeof invoke !== 'function') throw new TransportError(`transport "${id}" is implemented but has no invoke()`);
  return Object.freeze({
    id,
    kind,
    invoke,
    operations: Object.freeze([...(operations ?? ['*'])]),
    capabilities: Object.freeze([...(capabilities ?? [])]),
    serialization,
    implemented: implemented === true,
    cost: TRANSPORT_COSTS[kind],
    notes,
    canCarry(operation) {
      return this.operations.includes('*') || this.operations.includes(operation);
    },
    serves(capability) {
      return this.capabilities.length === 0 || this.capabilities.includes(capability);
    },
  });
}

/**
 * The local transport: a direct call in the same process.
 *
 * No serialization, no envelope on the wire, no HTTP. The envelope exists (the
 * caller still gets correlation and deadlines) but `toTransportHints()` is empty,
 * which is asserted in the tests rather than promised in a comment.
 */
export function defineLocalTransport({ id = 'local:direct', handlers = {}, serialization = 'none' } = {}) {
  const base = defineTransport({
    id,
    kind: 'local',
    serialization,
    invoke: async (context) => {
      const handler = handlers[context.operation] ?? handlers['*'] ?? null;
      if (!handler) {
        throw new TransportError(`the local transport has no handler for "${context.operation}"`, { code: 'frontend.transport.no-handler', operation: context.operation, capability: context.capability });
      }
      return handler(context);
    },
    notes: 'in-process direct call: no serialization, no network',
  });
  // `handlers` is a live map: a handler attached after assembly becomes reachable, and
  // the transport carries exactly what it can serve — never "everything" by default.
  return Object.freeze({
    ...base,
    get operations() {
      return Object.freeze(Object.keys(handlers));
    },
    canCarry: (operation) => Object.prototype.hasOwnProperty.call(handlers, '*')
      || Object.prototype.hasOwnProperty.call(handlers, operation),
  });
}

/**
 * @param {object} init
 * @param {Array<object>} init.transports  declared transports (implemented or not)
 * @param {object} [init.observability]    optional event sink (src/observability.mjs)
 */
export function createOperationGateway({ transports = [], observability = null, now = () => Date.now() } = {}) {
  const byId = new Map();
  for (const transport of transports) {
    if (byId.has(transport.id)) throw new TransportError(`duplicate transport id "${transport.id}"`);
    byId.set(transport.id, transport);
  }

  /**
   * Every transport that could carry this operation, cheapest first.
   *
   * Two independent gates: the operation's interaction class decides which
   * transport kinds are *capable* at all, and the operation/kind semantics decide
   * whether a fire-and-forget shape is acceptable for a waiting call.
   */
  function candidates({ capability, operation, kind = 'query', interaction = DEFAULT_INTERACTION }) {
    if (!interactionOf(interaction)) {
      throw new TransportError(`"${operation}" declares interaction "${interaction}", which is not a known interaction class`, { code: 'frontend.transport.unknown-interaction', operation, capability });
    }
    return [...byId.values()]
      .filter((transport) => transport.implemented)
      .filter((transport) => canCarryInteraction(interaction, transport.kind))
      .filter((transport) => transport.canCarry(operation))
      .filter((transport) => transport.serves(capability))
      // The interaction class already decided whether a waiting call is required:
      // a `call` cannot be carried by a fire-and-forget shape, an `event` may not be
      // held open, and neither judgement is repeated here from `kind`.
      .sort((a, b) => (a.cost - b.cost) || a.id.localeCompare(b.id));
  }

  function select(request) {
    const options = candidates(request);
    const chosen = options[0] ?? null;
    if (!chosen) {
      throw new NoTransportError(
        `no transport can carry "${request.operation}" for capability "${request.capability}" as a "${request.interaction ?? DEFAULT_INTERACTION}" — the call is refused rather than routed somewhere slower`,
        { operation: request.operation, capability: request.capability, considered: [...byId.keys()].sort() },
      );
    }
    return Object.freeze({ transport: chosen, considered: Object.freeze([...byId.keys()].sort()), options: Object.freeze(options) });
  }

  /** What this gateway can do, including the transports declared for the future. */
  function describe() {
    return Object.freeze({
      transports: Object.freeze([...byId.values()].map((transport) => Object.freeze({
        id: transport.id,
        kind: transport.kind,
        cost: transport.cost,
        serialization: transport.serialization,
        implemented: transport.implemented,
        operations: transport.operations,
        capabilities: transport.capabilities,
        notes: transport.notes,
      }))),
      implemented: Object.freeze([...byId.values()].filter((transport) => transport.implemented).map((transport) => transport.id)),
      declared: Object.freeze([...byId.values()].filter((transport) => !transport.implemented).map((transport) => transport.id)),
    });
  }

  /**
   * Invokes an operation. The transport is chosen by cost, the envelope is built
   * once, and the outcome is observable at the boundary only.
   */
  async function invoke({
    capability,
    operation,
    payload = undefined,
    kind = 'query',
    /** Declared by the operation; the assembly looks it up in the registry. */
    interaction = DEFAULT_INTERACTION,
    contractVersion,
    correlationId,
    authorization,
    deadlineMs = null,
    signal = null,
    idempotencyKey = null,
    transportId = null,
  } = {}) {
    const selected = transportId ? (() => {
      const transport = byId.get(transportId) ?? null;
      if (!transport) throw new TransportError(`unknown transport "${transportId}"`, { operation, capability });
      if (!transport.canCarry(operation)) throw new TransportError(`transport "${transportId}" cannot carry "${operation}"`, { operation, capability });
      if (!canCarryInteraction(interaction, transport.kind)) {
        throw new TransportError(`transport "${transportId}" is a "${transport.kind}" transport and cannot carry a "${interaction}" operation`, { code: 'frontend.transport.incompatible-interaction', operation, capability });
      }
      return { transport, considered: [transportId], options: [transport] };
    })() : select({ capability, operation, kind, interaction });

    const context = createOperationContext({
      capability,
      operation,
      kind,
      transport: selected.transport.kind === 'local' || selected.transport.kind === 'ipc' ? 'local' : 'rest',
      ...(contractVersion === undefined ? {} : { contractVersion }),
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(authorization === undefined ? {} : { authorization }),
      deadlineMs,
      signal,
      idempotencyKey,
      now,
    });

    const startedAt = now();
    try {
      const value = await selected.transport.invoke(context, payload);
      observability?.emit('frontend.operation.completed', {
        capability,
        operation,
        transport: selected.transport.id,
        kind: selected.transport.kind,
        interaction,
        durationMs: now() - startedAt,
      });
      return Object.freeze({
        ok: true,
        value,
        transport: selected.transport.id,
        kind: selected.transport.kind,
        interaction,
        serialization: selected.transport.serialization,
        context,
        record: observationRecord(context, { outcome: 'ok', durationMs: now() - startedAt }),
      });
    } catch (error) {
      observability?.emit('frontend.operation.rejected', {
        capability,
        operation,
        transport: selected.transport.id,
        interaction,
        code: error?.code ?? 'unknown',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return Object.freeze({
    invoke,
    select,
    describe,
    transportOf: (id) => byId.get(id) ?? null,
    /** The envelope fields a caller may set — published so a caller need not import the envelope. */
    requestFields: ENVELOPE_FIELDS,
  });
}

/** Declared transports for the kinds no implementation exists for yet. */
export function declaredFutureTransports() {
  return Object.freeze([
    defineTransport({ id: 'future:event-bus', kind: 'event', implemented: false, serialization: 'json', notes: 'declared so an event shape has a home; no bus exists' }),
    defineTransport({ id: 'future:stream', kind: 'stream', implemented: false, serialization: 'stream', notes: 'declared for incremental results (log tails, execution streams)' }),
    defineTransport({ id: 'future:ipc', kind: 'ipc', implemented: false, serialization: 'binary', notes: 'declared for a future in-host IPC channel; today the local transport covers same-process' }),
    defineTransport({ id: 'future:remote', kind: 'remote', implemented: false, serialization: 'json', notes: 'declared for a remote instance; the REST boundary already covers today\'s case' }),
  ]);
}

/** The transport model as data (docs, `.ai/` cards, tests). */
export function describeTransports() {
  return Object.freeze({
    kinds: TRANSPORT_KINDS,
    costs: TRANSPORT_COSTS,
    serialization: SERIALIZATION,
    rules: Object.freeze([
      'Business contracts name operations; they never name a transport.',
      'An operation declares an interaction class (call, event, stream, batch); a transport only declares what it can carry.',
      'The cheapest capable transport wins; same-process calls are direct with no serialization.',
      'No HTTP between local modules: the local transport carries local operations only.',
      'Nothing is routed implicitly — an operation no transport can carry is refused by name.',
      'Kinds may be declared before they are implemented; a declared transport is never selected.',
    ]),
  });
}
