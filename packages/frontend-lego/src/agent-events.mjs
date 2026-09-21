/**
 * The universal agent event contract — the frontend's view of what agents do.
 *
 * Any runtime that can map its own events into these names can drive the same UI:
 * an agent framework, a CLI agent, a hosted model gateway or a native runtime. The
 * vocabulary belongs to no product, and a product's names appear only inside a
 * *mapping declaration* — never in the vocabulary, the trace or the delegation tree.
 *
 * Three rules make the trace safe to render:
 *
 *   1. **No payloads.** An event carries a `summary` and *references*
 *      (`payloadRef`, `artifactRef`, `decisionRef`). There is no `payload` field to
 *      fill in, so a timeline cannot quietly become an unbounded transcript, and no
 *      model chain-of-thought has anywhere to live.
 *   2. **Bounded by declaration.** The trace has a declared capacity; when it is full
 *      the oldest row is dropped and `dropped` counts it. Nothing grows without
 *      limit, and nothing disappears silently.
 *   3. **Transport-neutral.** An event group declares which of the four interaction
 *      classes may carry it (`call`/`event`/`stream`/`batch`); no transport is ever
 *      named, and the same event contract works in-process, over a socket or from a
 *      future worker.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */
import { INTERACTION_CLASSES } from './interactions.mjs';

/** The event vocabulary. Adding a name is additive; renaming one is a breaking change. */
export const AGENT_EVENT_TYPES = Object.freeze([
  'agent.created',
  'agent.started',
  'agent.waiting',
  'agent.paused',
  'agent.resumed',
  'agent.delegated',
  'agent.completed',
  'agent.failed',
  'agent.cancelled',
  'context.loaded',
  'context.compacted',
  'tool.requested',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'decision.created',
  'decision.approved',
  'decision.rejected',
  'approval.requested',
  'approval.granted',
  'approval.denied',
  'artifact.created',
  'artifact.updated',
  'runtime.connected',
  'runtime.disconnected',
  'runtime.unavailable',
]);

const EVENT_SET = new Set(AGENT_EVENT_TYPES);

/** The namespaces, with what each one means. */
export const EVENT_GROUPS = Object.freeze([
  Object.freeze({ prefix: 'agent', meaning: 'the lifecycle of one delegated task', types: Object.freeze(AGENT_EVENT_TYPES.filter((type) => type.startsWith('agent.'))) }),
  Object.freeze({ prefix: 'context', meaning: 'what the agent was given, and what it had to compress', types: Object.freeze(AGENT_EVENT_TYPES.filter((type) => type.startsWith('context.'))) }),
  Object.freeze({ prefix: 'tool', meaning: 'a tool call, from request to outcome', types: Object.freeze(AGENT_EVENT_TYPES.filter((type) => type.startsWith('tool.'))) }),
  Object.freeze({ prefix: 'decision', meaning: 'a decision an agent made, and how it was settled', types: Object.freeze(AGENT_EVENT_TYPES.filter((type) => type.startsWith('decision.'))) }),
  Object.freeze({ prefix: 'approval', meaning: 'a gate a human has to open before the work continues', types: Object.freeze(AGENT_EVENT_TYPES.filter((type) => type.startsWith('approval.'))) }),
  Object.freeze({ prefix: 'artifact', meaning: 'something produced that outlives the run', types: Object.freeze(AGENT_EVENT_TYPES.filter((type) => type.startsWith('artifact.'))) }),
  Object.freeze({ prefix: 'runtime', meaning: 'the connection an agent runs on', types: Object.freeze(AGENT_EVENT_TYPES.filter((type) => type.startsWith('runtime.'))) }),
]);

/**
 * Which interaction class may carry which namespace. Declared per namespace, so the
 * contract stays transport-neutral while a caller still knows what shape to expect:
 * a live lifecycle notice is an EVENT, the trace itself is a CALL or a STREAM, and a
 * batch of approvals may ride together.
 */
export const EVENT_DELIVERY = Object.freeze({
  agent: Object.freeze(['event', 'stream']),
  context: Object.freeze(['event']),
  tool: Object.freeze(['event', 'stream']),
  decision: Object.freeze(['event', 'call']),
  approval: Object.freeze(['call', 'event', 'batch']),
  artifact: Object.freeze(['event', 'call']),
  runtime: Object.freeze(['event', 'call']),
});

/** How a row ends. `running` is not a terminal state, and neither is `waiting`. */
export const EVENT_STATUSES = Object.freeze(['pending', 'running', 'waiting', 'success', 'failure', 'cancelled', 'skipped']);

/** Terminal outcomes, used to derive an agent's status from its events. */
export const TERMINAL_STATUSES = Object.freeze(['success', 'failure', 'cancelled', 'skipped']);

/** The fields one trace row may carry. Anything else is refused — including `payload`. */
export const TRACE_FIELDS = Object.freeze([
  'sequence',
  'timestamp',
  'eventType',
  'agentId',
  'parentAgentId',
  'taskId',
  'executionId',
  'sessionId',
  'runtimeId',
  'capability',
  'operation',
  'status',
  'durationMs',
  'summary',
  'payloadRef',
  'artifactRef',
  'decisionRef',
  'approvalState',
]);

/** The fields a delegation node carries. Authority is *not* one of them. */
export const DELEGATION_FIELDS = Object.freeze(['agentId', 'parentAgentId', 'taskId', 'runtimeId', 'sessionId', 'status', 'depth', 'children', 'grants', 'effectivePermissions']);

/** Fields whose presence would turn a timeline into a transcript. Refused by name. */
const FORBIDDEN_FIELDS = Object.freeze(['payload', 'body', 'content', 'messages', 'transcript', 'reasoning', 'chainOfThought', 'thoughts', 'token', 'authorization', 'credential']);

/** A summary is a sentence, not a document. */
export const SUMMARY_LIMIT = 280;

/** The declared capacity of a work trace. Full means the oldest row is dropped and counted. */
export const TRACE_LIMIT = 200;

export class AgentEventError extends Error {
  constructor(message, { code = 'frontend.agent.invalid-event', eventType = null, errors = [] } = {}) {
    super(message);
    this.name = 'AgentEventError';
    this.code = code;
    this.eventType = eventType;
    this.errors = Object.freeze([...errors]);
  }
}

/** Is this a declared event type? Fail-closed question, asked before anything is stored. */
export function isAgentEventType(value) {
  return EVENT_SET.has(value);
}

/** The interaction classes that may carry a namespace. */
export function deliveryClassesFor(eventType) {
  const prefix = String(eventType).split('.')[0];
  return EVENT_DELIVERY[prefix] ?? null;
}

/**
 * Validates one trace row.
 *
 * Deliberately strict: an undeclared field is an error rather than extra metadata,
 * because the whole point of a bounded trace is that its shape is closed.
 */
export function validateTraceEvent(event = {}) {
  const errors = [];
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return Object.freeze({ ok: false, errors: Object.freeze(['a trace event must be an object']) });
  }
  if (!isAgentEventType(event.eventType)) {
    errors.push(`"${event.eventType}" is not a declared agent event type`);
  }
  for (const key of Object.keys(event)) {
    if (FORBIDDEN_FIELDS.includes(key)) errors.push(`"${key}" may never enter the trace — reference it with payloadRef/artifactRef instead`);
    else if (!TRACE_FIELDS.includes(key)) errors.push(`unknown field "${key}"`);
  }
  if (event.status !== undefined && !EVENT_STATUSES.includes(event.status)) {
    errors.push(`"status" must be one of ${EVENT_STATUSES.join(', ')}`);
  }
  if (event.summary !== undefined) {
    if (typeof event.summary !== 'string') errors.push('"summary" must be a string');
    else if (event.summary.length > SUMMARY_LIMIT) errors.push(`"summary" is ${event.summary.length} characters, over the ${SUMMARY_LIMIT}-character limit`);
  }
  if (event.durationMs !== undefined && (typeof event.durationMs !== 'number' || event.durationMs < 0)) {
    errors.push('"durationMs" must be a non-negative number');
  }
  for (const reference of ['payloadRef', 'artifactRef', 'decisionRef']) {
    const value = event[reference];
    if (value !== undefined && value !== null && typeof value !== 'string') errors.push(`"${reference}" must be a reference string or null`);
  }
  // An `agent.*` row without an agent is not a weaker row, it is an unusable one.
  if (typeof event.eventType === 'string' && event.eventType.startsWith('agent.') && typeof event.agentId !== 'string') {
    errors.push('an agent event names the agent it is about');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * A normaliser that maps a foreign product's events into this vocabulary.
 *
 * The product's names live in the `map`, which is data: adding a runtime is adding a
 * mapping, not editing the contract. An unmapped or mis-typed event is refused — a
 * timeline that silently drops events is worse than one that says it cannot read
 * them.
 *
 * @param {{ runtimeId?: string, map?: Record<string, string>, defaults?: object }} init
 */
export function createEventNormalizer({ runtimeId = null, map = {}, defaults = {} } = {}) {
  const mapping = new Map(Object.entries(map));
  for (const [external, internal] of mapping) {
    if (!isAgentEventType(internal)) {
      throw new AgentEventError(`mapping "${external}" → "${internal}" targets an undeclared event type`, { eventType: internal });
    }
  }
  return Object.freeze({
    runtimeId,
    mappingSize: mapping.size,
    externalNames: Object.freeze([...mapping.keys()].sort()),
    /**
     * @returns {{ ok: boolean, event: object|null, errors: string[] }}
     */
    normalise(raw = {}) {
      const external = raw.type ?? raw.event ?? null;
      const internal = mapping.get(external) ?? null;
      if (internal === null) {
        return Object.freeze({
          ok: false,
          event: null,
          errors: Object.freeze([`"${external}" is not mapped by runtime "${runtimeId ?? 'unnamed'}"`]),
        });
      }
      const candidate = {
        ...defaults,
        ...raw,
        eventType: internal,
        runtimeId: raw.runtimeId ?? defaults.runtimeId ?? runtimeId,
      };
      // The external name is metadata about the mapping, never a trace field.
      delete candidate.type;
      delete candidate.event;
      const validation = validateTraceEvent(candidate);
      return Object.freeze({ ok: validation.ok, event: validation.ok ? Object.freeze(candidate) : null, errors: validation.errors });
    },
  });
}

/**
 * A bounded work trace.
 *
 * Ordering is by `(timestamp, sequence)`: a row that arrives out of order is placed
 * where its timestamp belongs — which matters because a trace is read as a story.
 * Capacity is declared; dropping is counted; a row that cannot be validated never
 * enters.
 */
export function createWorkTrace({ limit = TRACE_LIMIT } = {}) {
  const rows = [];
  let sequence = 0;
  let dropped = 0;
  let rejected = 0;

  function compare(left, right) {
    if (left.timestamp !== right.timestamp) return typeof left.timestamp === 'number' && typeof right.timestamp === 'number' ? left.timestamp - right.timestamp : 0;
    return left.sequence - right.sequence;
  }

  function append(event = {}) {
    const validation = validateTraceEvent(event);
    if (!validation.ok) {
      rejected += 1;
      throw new AgentEventError(`trace event refused: ${validation.errors.join('; ')}`, { eventType: event.eventType ?? null, errors: validation.errors });
    }
    sequence += 1;
    const row = Object.freeze({ ...event, sequence });
    const index = rows.findIndex((existing) => compare(row, existing) < 0);
    if (index === -1) rows.push(row);
    else rows.splice(index, 0, row);
    while (rows.length > limit) {
      rows.shift();
      dropped += 1;
    }
    return row;
  }

  return Object.freeze({
    limit,
    /** The rows that survived, in timeline order. */
    entries: () => Object.freeze([...rows]),
    /** How many rows the bound has dropped, and how many were refused outright. */
    stats: () => Object.freeze({ rows: rows.length, limit, dropped, rejected, sequence }),
    latest: (agentId = null) => (agentId === null ? rows[rows.length - 1] ?? null : [...rows].reverse().find((row) => row.agentId === agentId) ?? null),
    append,
  });
}

/**
 * The delegation tree, derived from events.
 *
 * **Authority does not flow down a tree.** A node's effective permissions are the
 * grants declared for *that* agent — a parent's grants are never added, and the
 * answer says so explicitly (`inherited: false`), because "the child could do what
 * the parent could" is the assumption that turns a helpful decomposition into a
 * privilege escalation.
 *
 * @param {Array<object>} events trace rows (or events) in any order
 * @param {{ grants?: Record<string, string[]>, sessions?: Record<string, string> }} [extra]
 */
export function buildDelegationTree(events = [], { grants = {}, sessions = {} } = {}) {
  const agents = new Map();
  const problems = [];

  const ensure = (agentId, parentAgentId = null) => {
    if (typeof agentId !== 'string' || agentId.length === 0) return null;
    if (!agents.has(agentId)) {
      agents.set(agentId, {
        agentId,
        parentAgentId: parentAgentId ?? null,
        taskId: null,
        runtimeId: null,
        sessionId: sessions[agentId] ?? null,
        status: 'pending',
        children: [],
        grants: Object.freeze([...(grants[agentId] ?? [])]),
      });
    }
    const node = agents.get(agentId);
    if (parentAgentId && node.parentAgentId === null) node.parentAgentId = parentAgentId;
    return node;
  };

  for (const event of [...events].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))) {
    if (!isAgentEventType(event.eventType)) continue;
    const node = ensure(event.agentId ?? event.sessionId ?? null, event.parentAgentId ?? null);
    if (!node) continue;
    node.taskId = event.taskId ?? node.taskId;
    node.runtimeId = event.runtimeId ?? node.runtimeId;
    node.sessionId = event.sessionId ?? node.sessionId;
    const status = statusForEvent(event);
    if (status) node.status = status;
    if (event.eventType === 'agent.delegated' && typeof event.summary === 'string') {
      // The delegated agent's id is the reference in the summary contract; the child
      // is declared by its own `agent.created` row, never invented from a parent.
      const child = typeof event.delegatedAgentId === 'string' ? event.delegatedAgentId : null;
      if (child && !node.children.includes(child)) node.children.push(child);
    }
  }

  // Parent links must resolve, and the tree must not contain a cycle.
  for (const node of agents.values()) {
    if (node.parentAgentId !== null && !agents.has(node.parentAgentId)) {
      problems.push(`${node.agentId} names parent ${node.parentAgentId}, which no event declares`);
    }
  }
  for (const node of agents.values()) {
    const seen = new Set([node.agentId]);
    let cursor = node.parentAgentId;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        problems.push(`delegation cycle through ${node.agentId}`);
        break;
      }
      seen.add(cursor);
      cursor = agents.get(cursor)?.parentAgentId ?? null;
    }
  }

  const depthOf = (agentId) => {
    let depth = 0;
    let cursor = agents.get(agentId)?.parentAgentId ?? null;
    while (cursor !== null && depth <= agents.size) {
      depth += 1;
      cursor = agents.get(cursor)?.parentAgentId ?? null;
    }
    return depth;
  };

  const nodes = [...agents.values()]
    .map((node) => Object.freeze({
      agentId: node.agentId,
      parentAgentId: node.parentAgentId,
      taskId: node.taskId,
      runtimeId: node.runtimeId,
      sessionId: node.sessionId,
      status: node.status,
      depth: depthOf(node.agentId),
      children: Object.freeze([...node.children].filter((child) => agents.has(child)).sort()),
      grants: node.grants,
      /** Own grants only: a parent's permissions are never inherited, and that is stated. */
      effectivePermissions: node.grants,
      inherited: false,
    }))
    .sort((left, right) => (left.depth !== right.depth ? left.depth - right.depth : left.agentId.localeCompare(right.agentId)));

  return Object.freeze({
    roots: Object.freeze(nodes.filter((node) => node.parentAgentId === null).map((node) => node.agentId)),
    nodes: Object.freeze(nodes),
    ok: problems.length === 0,
    problems: Object.freeze(problems),
    /** The rule, as data, so a reader cannot mistake the tree for an authority graph. */
    rule: 'A delegation tree is a record of who asked whom. A child holds exactly the permissions it was granted, never its parent’s.',
  });
}

/** Which status a row implies for its agent. Rows that carry no status imply none. */
function statusForEvent(event) {
  if (event.status && EVENT_STATUSES.includes(event.status)) return event.status;
  switch (event.eventType) {
    case 'agent.created': return 'pending';
    case 'agent.started': return 'running';
    case 'agent.waiting':
    case 'agent.paused': return 'waiting';
    case 'agent.resumed':
    case 'agent.delegated': return 'running';
    case 'agent.completed': return 'success';
    case 'agent.failed': return 'failure';
    case 'agent.cancelled': return 'cancelled';
    case 'tool.failed': return 'failure';
    default: return null;
  }
}

/** The event contract as data, for docs, `.ai/` cards, the contract and tests. */
export function describeAgentEvents() {
  return Object.freeze({
    eventTypes: AGENT_EVENT_TYPES,
    groups: Object.freeze(EVENT_GROUPS.map((group) => Object.freeze({ prefix: group.prefix, size: group.types.length, delivery: EVENT_DELIVERY[group.prefix] }))),
    statuses: EVENT_STATUSES,
    traceFields: TRACE_FIELDS,
    delegationFields: DELEGATION_FIELDS,
    limits: Object.freeze({ trace: TRACE_LIMIT, summary: SUMMARY_LIMIT }),
    rules: Object.freeze([
      'The vocabulary belongs to no product: a runtime maps its names in, and an unmapped event is refused rather than dropped.',
      'A trace row carries a summary and references; there is no payload field, and a credential or reasoning field is refused by name.',
      'The trace is bounded by declaration: at capacity the oldest row is dropped and counted.',
      'Events declare which interaction class may carry them; no event names a transport.',
      'A child agent receives exactly its own grants — placement and parentage never grant authority.',
      'Model and provider identity are shown only when the runtime exposes them; chain-of-thought is never representable.',
    ]),
  });
}
