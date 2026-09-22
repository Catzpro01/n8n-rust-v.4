/**
 * Interaction semantics: what an operation *means*, independent of any transport.
 *
 * There are four logical classes and there will never be many more:
 *
 *   CALL    request/response — one answer, the caller waits;
 *   EVENT   asynchronous notification — the caller does not wait for an answer;
 *   STREAM  incremental sequence — many answers over time;
 *   BATCH   several operations resolved by one request/response.
 *
 * The class belongs to the **operation declaration**, never to the transport. A
 * transport then either can or cannot carry that class — `rest` cannot carry a
 * `stream`, a fire-and-forget bus cannot carry a `call` — and when nothing can, the
 * call is refused by name instead of being quietly reshaped.
 *
 * This is deliberately not a second envelope: the envelope (src/envelope.mjs) still
 * carries identity, correlation, deadline, cancellation and idempotency. The
 * interaction class only says which of those fields *mean something* for the call.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { TRANSPORT_KINDS } from './transport.mjs';

/** The four logical interaction classes. */
export const INTERACTION_CLASSES = Object.freeze(['call', 'event', 'stream', 'batch']);

/**
 * What each class means. `expectsResponse`, `incremental`, `fanOut` and the
 * envelope-field lists are what make the class checkable rather than descriptive.
 */
export const INTERACTIONS = Object.freeze([
  Object.freeze({
    id: 'call',
    direction: 'caller-to-callee',
    expectsResponse: true,
    incremental: false,
    fanOut: 'one',
    /** Envelope fields that carry meaning for this class. */
    envelopeFields: Object.freeze(['capability', 'operation', 'contractVersion', 'correlationId', 'deadlineMs', 'signal', 'idempotencyKey']),
    payload: 'one request, one response',
    example: 'frontend asks a capability for a page of workflows',
    failure: 'rejected with a code; the caller sees the failure, the UI renders the declared fallback',
  }),
  Object.freeze({
    id: 'event',
    direction: 'producer-to-consumer',
    expectsResponse: false,
    incremental: false,
    fanOut: 'many',
    envelopeFields: Object.freeze(['capability', 'operation', 'contractVersion', 'correlationId']),
    payload: 'one notification, no answer',
    example: 'a capability announces that a node type changed',
    failure: 'dropped is dropped: no retry loop, and the surface re-reads state on its next interaction',
  }),
  Object.freeze({
    id: 'stream',
    direction: 'producer-to-consumer',
    expectsResponse: true,
    incremental: true,
    fanOut: 'many',
    envelopeFields: Object.freeze(['capability', 'operation', 'contractVersion', 'correlationId', 'deadlineMs', 'signal']),
    payload: 'sequence of values until completion or cancellation',
    example: 'execution progress reported incrementally',
    failure: 'the stream ends with a declared terminal state; cancellation ends it without an error',
  }),
  Object.freeze({
    id: 'batch',
    direction: 'caller-to-callee',
    expectsResponse: true,
    incremental: false,
    fanOut: 'many',
    envelopeFields: Object.freeze(['capability', 'operation', 'contractVersion', 'correlationId', 'deadlineMs', 'idempotencyKey']),
    payload: 'several operations resolved by one request/response',
    example: 'a screen resolves several capability availability answers at once',
    failure: 'per-entry outcome: one refused entry never hides behind a successful batch',
  }),
]);

const BY_ID = new Map(INTERACTIONS.map((interaction) => [interaction.id, interaction]));

export class InteractionError extends Error {
  constructor(message, { code = 'frontend.interaction.unsupported', interaction = null, operation = null } = {}) {
    super(message);
    this.name = 'InteractionError';
    this.code = code;
    this.interaction = interaction;
    this.operation = operation;
  }
}

/** True when `value` is one of the four classes. */
export function isInteractionClass(value) {
  return typeof value === 'string' && BY_ID.has(value);
}

/** The definition of a class, or null. */
export function interactionOf(id) {
  return BY_ID.get(id) ?? null;
}

/** The class an operation defaults to when nothing is declared: a plain call. */
export const DEFAULT_INTERACTION = 'call';

/**
 * Which transport kinds can carry which class.
 *
 * `rest` is one request and one response, so it cannot carry a stream; `event` is
 * fire-and-forget, so it cannot carry a call; `stream` carries incremental
 * sequences but not single answers; `local` (a direct call) can carry everything.
 */
export const INTERACTION_TRANSPORTS = Object.freeze({
  call: Object.freeze(['local', 'rest', 'ipc', 'remote']),
  event: Object.freeze(['local', 'event', 'ipc', 'remote']),
  stream: Object.freeze(['local', 'stream', 'ipc', 'remote']),
  batch: Object.freeze(['local', 'rest', 'ipc', 'remote']),
});

/** True when a transport kind may carry an interaction class. */
export function canCarry(interaction, transportKind) {
  const supported = INTERACTION_TRANSPORTS[interaction];
  if (!supported) return false;
  if (!TRANSPORT_KINDS.includes(transportKind)) return false;
  return supported.includes(transportKind);
}

/** Declares the interaction class of an operation. Validated, never guessed. */
export function defineInteraction(operation, interaction = DEFAULT_INTERACTION) {
  if (typeof operation !== 'string' || operation.length === 0) {
    throw new InteractionError('an interaction needs an operation name', { operation });
  }
  if (!isInteractionClass(interaction)) {
    throw new InteractionError(
      `"${operation}" declares interaction "${interaction}", which is not one of ${INTERACTION_CLASSES.join(', ')}`,
      { operation, interaction },
    );
  }
  return Object.freeze({ operation, interaction });
}

/**
 * Normalises an operation declaration that may be a plain string or an object.
 *
 * Accepted shapes:
 *   'workflow.list'                                  → call
 *   { name: 'workflow.watch', interaction: 'stream' }
 *   { name: 'workflow.list', interaction: 'unknown' } → refused
 */
export function normaliseInteraction(entry) {
  if (typeof entry === 'string') return Object.freeze({ operation: entry, interaction: DEFAULT_INTERACTION });
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    return defineInteraction(entry.name, entry.interaction ?? DEFAULT_INTERACTION);
  }
  throw new InteractionError('an interaction declaration must be an operation name or { name, interaction }');
}

/** The class a call is actually made with: declared wins, caller override must agree. */
export function resolveInteraction({ declared = null, requested = null, operation = null } = {}) {
  const base = declared ?? DEFAULT_INTERACTION;
  if (!isInteractionClass(base)) {
    throw new InteractionError(`"${operation ?? base}" declares an unknown interaction class "${base}"`, { operation, interaction: base });
  }
  if (requested === null || requested === undefined) return base;
  if (!isInteractionClass(requested)) {
    throw new InteractionError(`"${operation ?? requested}" was invoked as "${requested}", which is not one of ${INTERACTION_CLASSES.join(', ')}`, { operation, interaction: requested });
  }
  if (requested !== base) {
    // A caller may not reshape an operation: an event cannot be awaited into a call.
    throw new InteractionError(
      `"${operation}" is declared as "${base}" and cannot be invoked as "${requested}" — a caller does not decide an operation's interaction class`,
      { code: 'frontend.interaction.declaration-wins', operation, interaction: requested },
    );
  }
  return base;
}

/** The transport kinds that can carry a class, cheapest first. */
export function transportsFor(interaction) {
  const kinds = INTERACTION_TRANSPORTS[interaction];
  if (!kinds) throw new InteractionError(`unknown interaction class "${interaction}"`, { interaction });
  return Object.freeze([...kinds]);
}

/** The interaction model as data (docs, `.ai/` cards, tests). */
export function describeInteractions() {
  return Object.freeze({
    classes: INTERACTION_CLASSES,
    default: DEFAULT_INTERACTION,
    transports: INTERACTION_TRANSPORTS,
    definitions: INTERACTIONS,
    rules: Object.freeze([
      'An operation declares its interaction class; a transport only declares what it can carry.',
      'The class is never inferred from a route, a menu entry or a file path.',
      'A transport that cannot carry the class is not a candidate, even if it is cheaper.',
      'A caller may not reshape an operation: a declared class wins over a request.',
      'One class per operation: an operation that needs two shapes is two operations.',
      'No container is invented for a single call — a batch of one is a call.',
    ]),
  });
}
