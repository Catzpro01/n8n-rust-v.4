/**
 * The Memory surface — the layer that survives context replacement, quoted and never written (P2.14).
 *
 * `ai.memory@1.0.0` is published by agent-2 and owns Memory; this module is the frontend's consumer
 * of it. It renders what the contract declares and it renders the absence of it. It produces
 * neither. Four rules carry the design:
 *
 *   1. **Memory is not Context, and Context is not Memory.** `Context` is what is loaded now and can
 *      be compacted, rolled over and replaced; `Session` is the lifecycle of an interaction; `Memory`
 *      is what was *deliberately retained* and must still be there after a window is gone. The
 *      contract states the invariant and forbids the failure (`isNot` refuses "a second copy of the
 *      context payload" and "hidden Context storage"), and this surface keeps them apart in the other
 *      direction too: it renders no context, no session, no token count and no continuation. A
 *      context that *references* memory is correct; a memory record that carries a context body is
 *      refused by `validateMemoryRecord()`, and a context or session record that carries a memory
 *      payload is refused by the Context & Session surface (`assertDistinctConcepts`).
 *   2. **The vocabulary is quoted, not re-declared.** Nine canonical sets come from the vocabulary
 *      lock with the contract, the file and the declaration they were read from: 5 scopes, 6 kinds,
 *      5 retentions, 13 fields, 2 lifecycle states, 10 graph nodes, 11 graph edges, 4 published
 *      operations, 2 permission words. Nothing is coined here — and the words the contract does NOT
 *      publish (embeddings, similarity, relevance score, retention enforcement) have no set at all,
 *      so a screen cannot render them even by accident.
 *   3. **A record is a record; a list is a list.** `memory.list` is deterministic and bounded:
 *      scope-filtered, ordered `createdAt` ascending then `memoryId` ascending, `limit` 1..100 with a
 *      default of 50, an opaque cursor, and `[] / total 0` for no matches. This surface reproduces
 *      that contract exactly — it never re-sorts by anything (there is no relevance ranking to sort
 *      by), never pages past the bound and never renders a fifth entry as if it were the fifth
 *      result. An empty result is an answer: "no memory is stored at this scope", not an error and
 *      never "your memory was erased".
 *   4. **Persistence is behind a boundary, so it is never claimed.** The public contract is
 *      `ai.memory`; storage lives behind `MemoryProvider`, whose default is an in-memory map. This
 *      surface therefore has exactly three persistence words — `provider-bound`, `in-memory-only`,
 *      `not-declared` — and no "saved", no "synced", no green dot for a provider nobody connected.
 *      Forgetting is terminal and explicit: nothing expires on its own, so no entry is rendered with
 *      a countdown, and no affordance offers a forget.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import, no backend import. The
 * declarations are handed over by the application (or by a test); this package never reads the
 * backend tree, and nothing it returns enters the boot payload.
 */
import { vocabularyOf } from './vocabulary.mjs';

/* ------------------------------------------------------------------ contracts */

export const MEMORY_CONTRACT_ID = 'ai.memory';
/**
 * The LEGO `ai.memory` belongs to. Memory is an entry in the official AI/Agent LEGO set
 * (`ai-lego-set.json#lego[id=memory]`, index 4, phase B) — it is **not** a sub-LEGO of
 * `context-session`, and it is not a sixteenth top-level LEGO either. Naming the three ids here is
 * what keeps "memory survives context replacement" from becoming "memory is part of context".
 */
export const MEMORY_LEGO_ID = 'memory';
export const MEMORY_PHASE = 'B';

/**
 * The decision that owns what Memory still owes. `XA-12` is `open-for-manager` in
 * `docs/n8n-lego/decisions/cross-agent-decisions.json`: the bounded four-operation surface is
 * published, and the deferred half — relevance-ranked traversal, explicit edge creation and
 * retention-policy enforcement — is what stays open. The frontend does not resolve it; it renders
 * the published half and names the other.
 */
export const MEMORY_DECISION = 'XA-12';
/** The decision that asked where Memory is modelled at all; it stays open beside XA-12. */
export const MEMORY_MODELING_DECISION = 'XA-11';

/**
 * The version the declaration claims (`ai-lego-set.json#lego[id=memory].versioning` →
 * `ai.memory@1.0.0`, and `manifest/memory.json#version`). A claim is reported as `declaredVersion`
 * and never as a published version: a consumer binds to a contract-lock row, and protected main
 * @ `67e638ef` publishes none for Memory — so against that tree the same code reports
 * `declared-not-locked` and renders no version.
 */
export const MEMORY_DECLARED_VERSION = '1.0.0';

/** Where each quoted shape comes from. Provenance, not a copy. */
export const MEMORY_DECLARATION_SOURCE = Object.freeze({
  file: 'apps/n8n-lego/src/lego/manifest/memory.json',
  path: '(whole document)',
  owner: 'manager',
  contract: MEMORY_CONTRACT_ID,
  declaredVersion: MEMORY_DECLARED_VERSION,
  decision: MEMORY_DECISION,
});

export const MEMORY_LEGO_DECLARATION_SOURCE = Object.freeze({
  file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
  path: `lego#id=${MEMORY_LEGO_ID}`,
  owner: 'manager',
  contract: null,
  decision: MEMORY_MODELING_DECISION,
});

export const MEMORY_CAPABILITY_DECLARATION_SOURCE = Object.freeze({
  file: 'apps/n8n-lego/src/lego/manifest/domains.json',
  path: 'domains#id=ai-foundation.capabilities[id=ai.memory]',
  owner: 'manager',
  contract: 'lego.domain-registry',
  contractVersion: '1.1.0',
});

/** The module the locked row names as the surface, so a reader can go and read the contract. */
export const MEMORY_SURFACE_MODULE = 'apps/n8n-lego/src/lego/memory.mjs';

/* --------------------------------------------------------------- quoted words */

const SCOPE_SET = vocabularyOf('memoryScope');
const KIND_SET = vocabularyOf('memoryKind');
const RETENTION_SET = vocabularyOf('memoryRetention');
const FIELD_SET = vocabularyOf('memoryField');
const LIFECYCLE_SET = vocabularyOf('memoryLifecycle');
const OPERATION_SET = vocabularyOf('memoryOperation');
const PERMISSION_SET = vocabularyOf('memoryPermission');
const NODE_SET = vocabularyOf('memoryGraphNode');
const EDGE_SET = vocabularyOf('memoryGraphEdge');

/** The five retention namespaces, in published order — the ladder the UI renders. */
export const MEMORY_SCOPES = SCOPE_SET.values;
export const MEMORY_KINDS = KIND_SET.values;
export const MEMORY_RETENTIONS = RETENTION_SET.values;
export const MEMORY_FIELDS = FIELD_SET.values;
export const MEMORY_LIFECYCLE = LIFECYCLE_SET.values;
export const MEMORY_OPERATIONS = OPERATION_SET.values;
export const MEMORY_PERMISSIONS = PERMISSION_SET.values;
export const MEMORY_GRAPH_NODES = NODE_SET.values;
export const MEMORY_GRAPH_EDGES = EDGE_SET.values;

/** Every set this surface quotes, so a reviewer can see there is no local vocabulary in the rendering path. */
export const MEMORY_QUOTED_VOCABULARIES = Object.freeze([
  SCOPE_SET.id, KIND_SET.id, RETENTION_SET.id, FIELD_SET.id, LIFECYCLE_SET.id,
  OPERATION_SET.id, PERMISSION_SET.id, NODE_SET.id, EDGE_SET.id,
]);

/**
 * The published operation names, **verbatim**. The contract spells them `memory.<verb>` — not a bare
 * verb, and not `ai.memory.<verb>`. The frontend renders the spelling it was handed: "fixing" a
 * published operation name is how a consumer invents a second API, so the qualified form
 * `ai.memory.remember` is deliberately NOT produced anywhere in this module.
 */
export const MEMORY_OPERATION_IDS = Object.freeze([...MEMORY_OPERATIONS]);

/**
 * What the contract declares for the future and does NOT publish as operations.
 *
 * Derived, with its source: `manifest/memory.json#futureStages` names `traverse` (relevance-ranked
 * traversal) and `relate` (explicit edge creation), and `notImplemented` states the same. They are
 * words the surface must be able to *name and refuse*, because a memory screen that shows a search
 * box is a screen that offered `traverse`. `assertDeferredOperations()` below fails if the backend
 * ever turns one of them into a real operation without this list moving.
 */
export const DEFERRED_MEMORY_OPERATIONS = Object.freeze(['traverse', 'relate']);

/** The relation vocabulary a reference must use. Free text is refused; these eleven are not a suggestion. */
export const MEMORY_REFERENCE_FIELDS = Object.freeze(['id', 'relation', 'kind']);

/**
 * How many references one record may carry and how large `content` may be, quoted from the contract's
 * own bound (`references` is bounded to 32 entries and `content` to 64 KiB canonical). A UI that
 * rendered 200 references would be rendering something the contract refuses to store.
 */
export const MEMORY_REFERENCE_LIMIT = 32;
export const MEMORY_CONTENT_LIMIT_BYTES = 64 * 1024;

/** `memory.list`'s own bound, quoted: `limit` 1..100, default 50. Never re-derived, never exceeded. */
export const MEMORY_LIST_LIMIT = Object.freeze({ min: 1, max: 100, default: 50 });

/** The ordering `memory.list` guarantees. There is no second ordering, because no ranking is published. */
export const MEMORY_LIST_ORDERING = Object.freeze(['createdAt asc', 'memoryId asc']);

/* ------------------------------------------------------- separation from Context */

/**
 * The four concepts this surface keeps apart, as data — the other half of the invariant the
 * Context & Session surface carries (rule A28). Both halves exist because the failure is
 * symmetric: memory hidden inside context state, and context hidden inside a memory record.
 *
 * `crosses` names the direction this module is responsible for refusing.
 */
export const MEMORY_SEPARATION = Object.freeze([
  Object.freeze({
    id: 'context',
    what: 'what is loaded now, at one declared scope; compactable and replaceable',
    contract: 'ai.context',
    crosses: 'a memory record carrying a context body, a snapshot or a continuation is refused — a record REFERENCES what it is about (`references`), it does not contain it',
    rule: 'Memory survives context replacement. If a record held the window, memory would be replaced with it.',
  }),
  Object.freeze({
    id: 'session',
    what: 'bounded state: identity plus references',
    contract: 'ai.agent-session',
    crosses: 'a memory record carrying a session state, a message list or a transcript is refused; `scopeOwner` may BE a sessionId, and that is a namespace, not session state',
    rule: 'A session is not a transcript and not a store; forgetting a session does not forget a memory, and forgetting a memory does not touch a session.',
  }),
  Object.freeze({
    id: 'memory',
    what: 'deliberately retained records with their own identity, retention and provenance',
    contract: MEMORY_CONTRACT_ID,
    crosses: 'the record shape itself: `memoryId`, `scope`, `scopeOwner`, `kind`, `retention`, `content`, `references`, `provenance`, `version`, `size`, `checksum`, `createdAt`, `updatedAt`',
    rule: 'Memory is what survives; it is not the window, not the session and not execution state.',
  }),
  Object.freeze({
    id: 'execution',
    what: 'a workflow run and its state',
    contract: 'execution.*',
    crosses: 'a memory record whose `content` claims a live run state is refused; a `execution` kind is a record ABOUT a run, and its `references` point at one',
    rule: 'Execution state comes from the execution domain. Nothing here reads it, and a `task` memory is never a running task.',
  }),
]);

/**
 * The refusal this module is responsible for: a memory record that stopped being a record and became
 * a container for context, session or execution state.
 *
 * It refuses *merging*, not *referencing* — `references: [{ id: 'ctx-1', relation: 'observed_in' }]`
 * is exactly right, `content: { messages: [...] }` is not.
 */
export function assertMemoryIsNotContext(record = {}) {
  const findings = [];
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new MemoryError('a memory record must be an object', { code: MEMORY_ERROR_CODES.invalidRecord, concept: null });
  }
  if (record.context !== undefined) findings.push('"context" is refused: memory references a context, it does not carry one');
  if (record.session !== undefined) findings.push('"session" is refused: a sessionId belongs in `scopeOwner` as a namespace, never as an embedded session');
  if (record.window !== undefined) findings.push('"window" is refused: a context window is replaceable by design and memory is what survives it');
  if (record.continuation !== undefined) findings.push('"continuation" is refused: a continuation is a context-rollover package, not a memory');
  if (record.snapshot !== undefined) findings.push('"snapshot" is refused: a retained snapshot of a window is a second copy of the context payload');
  if (record.execution !== undefined && typeof record.execution === 'object' && record.execution !== null) {
    findings.push('"execution" carries an object: execution state comes from the execution domain, and a record may only reference a run');
  }
  for (const key of ['messages', 'transcript', 'turns', 'history']) {
    if (record[key] !== undefined) {
      findings.push(`"${key}" is refused: an unbounded conversation copy is not memory — it is the transcript the contract refuses by name, and a retained record carries summaries and references instead`);
    }
  }
  if (findings.length > 0) {
    throw new MemoryError(`memory stays a record: ${findings.join('; ')}`, {
      code: MEMORY_ERROR_CODES.contextMerged,
      concept: 'context|session|memory|execution',
      findings,
    });
  }
  return Object.freeze({
    ok: true,
    separation: MEMORY_SEPARATION,
    rule: 'Referencing is allowed; merging is not. Memory survives context replacement, so it may not be stored inside what it survives.',
  });
}

/* ------------------------------------------------------------------- refusals */

/**
 * Keys that would turn a memory record into something it must never be. Two families, the same ones
 * the contract's `security.mustNot` names: **secrets** (a credential, a token, a cookie, an
 * authorization header, a host path) and **private model material** (chain-of-thought, a raw or
 * hidden prompt, a transcript, full model output).
 *
 * The contract is explicit that `content` and reference keys are scanned by the same sensitive
 * pattern that guards context state (`security.sensitiveRefusal`), so the refusal list is shared in
 * spirit and stated here in full so this module can be read on its own.
 */
export const FORBIDDEN_MEMORY_FIELDS = Object.freeze({
  credentials: 'a credential never belongs in a memory record: it is resolved by the credentials domain at use time',
  credential: 'a credential never belongs in a memory record',
  secret: 'no secret is remembered; a memory list is rendered on screen and a secret rendered once is a secret leaked',
  token: 'an authentication token is a secret; a memory record never carries one',
  tokens: 'an authentication token is a secret',
  accessToken: 'a secret, refused by name',
  apiKey: 'a secret, refused by name',
  cookie: 'a session cookie is a transport credential, never a memory',
  authorization: 'an authorization header is a credential',
  password: 'a secret, refused by name',
  privateKey: 'a secret, refused by name',
  chainOfThought: 'private model reasoning is never stored as memory; a `decision` kind carries a summary and evidence references instead',
  reasoning: 'private model reasoning is not an audit format',
  rawPrompt: 'a raw or hidden prompt is private model material',
  hiddenPrompt: 'a raw or hidden prompt is private model material',
  systemPrompt: 'a raw or hidden prompt is private model material',
  transcript: 'a transcript is the failure the contract names first: memory holds summaries and references, never the conversation itself',
  messages: 'a message list is a transcript by another name',
  modelOutput: 'full model output belongs to the artifact contract, referenced by id',
  completion: 'full model output belongs to the artifact contract, referenced by id',
  path: 'an arbitrary host path is a capability claim; a reference is an opaque id resolved by the owning domain',
  hostPath: 'an arbitrary host path is a capability claim',
  absolutePath: 'an arbitrary host path is a capability claim',
  filesystem: 'no filesystem authority follows from a memory record',
  terminal: 'no terminal authority follows from a memory record',
  grants: 'a memory record grants nothing',
  permissions: 'the quoted permission words are requirements of backend operations, never a grant carried by a record',
});

/** The same refusals as a key pattern, so a key nobody enumerated is still refused. */
export const FORBIDDEN_MEMORY_KEY_PATTERN = /(credential|secret|token|cookie|passw|api[_-]?key|authorization|private[_-]?key|chain[_-]?of[_-]?thought|reasoning|transcript|messages|raw[_-]?prompt|hidden[_-]?prompt|system[_-]?prompt|model[_-]?output|completion|path|permission|grant)/i;

const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/** Refuses forbidden keys anywhere in a memory payload, and names every key it refused. */
export function scanForbiddenMemoryKeys(record, { path = '' } = {}) {
  const refused = [];
  if (record === null || typeof record !== 'object') return Object.freeze(refused);
  for (const [key, value] of Object.entries(record)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (FORBIDDEN_MEMORY_FIELDS[key] !== undefined) refused.push(Object.freeze({ key: at, reason: FORBIDDEN_MEMORY_FIELDS[key] }));
    else if (FORBIDDEN_MEMORY_KEY_PATTERN.test(key)) refused.push(Object.freeze({ key: at, reason: 'matches the secret/private-model key pattern; memory carries records and references, not credentials or reasoning' }));
    if (value !== null && typeof value === 'object') refused.push(...scanForbiddenMemoryKeys(value, { path: at }));
  }
  return Object.freeze(refused);
}

/**
 * The error codes this module raises or returns, declared once.
 *
 * Declared here rather than scattered as string literals so three things cannot drift apart: the two
 * throw sites, the class default, and the table in `contracts/frontend.contract.md` §19.20. Note what
 * is *not* in this list: the unpublished case is not an error at all — it is the canonical
 * `lego.capability_unavailable` **verdict** returned by `memoryUnsupported()`, because "no contract
 * row exists in this tree" is a state a screen renders, not an exception it catches.
 */
export const MEMORY_ERROR_CODES = Object.freeze({
  invalid: 'frontend.memory.invalid',
  invalidRecord: 'frontend.memory.invalid-record',
  contextMerged: 'frontend.memory.context-merged',
});

/** The canonical unsupported verdict — returned, never thrown. */
export const MEMORY_UNSUPPORTED_ERROR = 'lego.capability_unavailable';

/** Raised for a record, scope, kind, retention or declaration this surface refuses to render. */
export class MemoryError extends Error {
  constructor(message, { code = MEMORY_ERROR_CODES.invalid, concept = null, value = null, findings = [] } = {}) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.concept = concept;
    this.value = value;
    this.findings = Object.freeze([...(findings ?? [])]);
  }
}

/* ------------------------------------------------------ scopes, kinds, retention */

/**
 * One memory scope, with its rank in the quoted declaration order.
 *
 * The order is the namespace ladder the contract publishes (`GLOBAL` first, `SESSION` last) and it
 * is quoted, not re-sorted. `GLOBAL` is the only scope with no owner; every other scope requires a
 * `scopeOwner`, because scope owns isolation and the provider boundary never infers one. A record
 * whose scope and owner do not exactly match a filter is never returned — so an unknown scope is
 * refused here rather than approximated by the nearest wider namespace.
 */
export function memoryScope(scope) {
  if (!MEMORY_SCOPES.includes(scope)) {
    return Object.freeze({
      scope,
      known: false,
      rank: null,
      requiresOwner: null,
      detail: `"${scope}" is not one of the five declared memory scopes (${MEMORY_SCOPES.join(', ')}) — an unknown scope is refused, never widened to the nearest namespace`,
    });
  }
  const rank = MEMORY_SCOPES.indexOf(scope);
  const table = {
    GLOBAL: { requiresOwner: false, detail: 'instance-wide retention with no owner; the one namespace that is not isolated by an identity, so a UI renders it as the widest and least specific bucket' },
    PROJECT: { requiresOwner: true, detail: 'retained knowledge about one project; the owner is the projectId, and another project never sees it' },
    WORKFLOW: { requiresOwner: true, detail: 'retained knowledge about one workflow; the owner is the workflowId' },
    AGENT: { requiresOwner: true, detail: 'what one agent deliberately retained; the owner is the agentId' },
    SESSION: { requiresOwner: true, detail: 'knowledge retained across the windows of one session; the owner is the sessionId — a namespace, never session state' },
  }[scope];
  return Object.freeze({
    scope,
    known: true,
    rank,
    width: rank === 0 ? 'widest' : rank === MEMORY_SCOPES.length - 1 ? 'narrowest' : 'intermediate',
    requiresOwner: table.requiresOwner,
    detail: table.detail,
  });
}

/** The ladder as data, in the quoted declaration order. */
export function memoryScopeLadder() {
  return Object.freeze(MEMORY_SCOPES.map((scope) => memoryScope(scope)));
}

/**
 * What one kind means *to the UI*.
 *
 * Every row says the same thing in a different way: the kind is a **record about** something, never
 * the thing and never a live handle on it. That is the contract's own `kindRule`, rendered.
 */
export function memoryKind(kind) {
  if (!MEMORY_KINDS.includes(kind)) {
    return Object.freeze({
      kind,
      known: false,
      executing: false,
      inference: false,
      detail: `"${kind}" is not one of the six declared kinds (${MEMORY_KINDS.join(', ')}) — an unknown kind is reported, never mapped to the nearest one`,
    });
  }
  const table = {
    note: 'a free-form retained observation: the lowest-commitment kind, and the one most likely to be EPHEMERAL',
    decision: 'a record ABOUT a choice, with its evidence referenced — not the choice itself, and not the approval that let it happen',
    artifact: 'a record ABOUT something produced, referencing the artifact by id; it is not the artifact and carries no model output',
    task: 'a record ABOUT work — not a running task, not a queue entry and not a schedule',
    execution: 'a record ABOUT a run, referencing it; execution state still comes from the execution domain',
    reference: 'a record ABOUT where something lives: a pointer kept on purpose, with `references` naming what it points at',
  }[kind];
  return Object.freeze({ kind, known: true, executing: false, inference: false, detail: table });
}

/** Every kind with its rendering rule. */
export function memoryKinds() {
  return Object.freeze(MEMORY_KINDS.map((kind) => memoryKind(kind)));
}

/**
 * What one retention word means, and — the part that matters — what it does **not** promise.
 *
 * The contract is explicit: retention is a declaration, nothing expires on its own, and the higher
 * three words require an explicit forget. So no retention word renders as a countdown, a TTL or an
 * "auto-deleted" badge.
 */
export function memoryRetention(retention) {
  if (!MEMORY_RETENTIONS.includes(retention)) {
    return Object.freeze({
      retention,
      known: false,
      expiresOnItsOwn: false,
      requiresExplicitForget: null,
      detail: `"${retention}" is not one of the five declared retention words (${MEMORY_RETENTIONS.join(', ')})`,
    });
  }
  const table = {
    EPHEMERAL: { requiresExplicitForget: false, detail: 'expected to be forgotten; the surface says so, and still never deletes anything and never implies a timer' },
    WORKING: { requiresExplicitForget: false, detail: 'working knowledge for the task at hand; expected to be forgotten, and nothing expires on its own' },
    IMPORTANT: { requiresExplicitForget: true, detail: 'meant to survive; retracting it takes an explicit forget operation this surface does not offer' },
    DURABLE: { requiresExplicitForget: true, detail: 'meant to survive for a long time; still removed only by an explicit forget' },
    PERMANENT: { requiresExplicitForget: true, detail: 'meant to stay; the strongest declaration the contract has, and still not a guarantee the UI may upgrade' },
  }[retention];
  return Object.freeze({ retention, known: true, expiresOnItsOwn: false, ...table });
}

/** Every retention word with its rendering rule. */
export function memoryRetentions() {
  return Object.freeze(MEMORY_RETENTIONS.map((retention) => memoryRetention(retention)));
}

/**
 * What one lifecycle state means, and whether it is terminal.
 *
 * Two states only. `forgotten` is terminal and idempotent — forgetting an already-forgotten identity
 * returns `forgotten` without error, and forgetting an absent identity is a no-op returning
 * `forgotten: false`. Nothing here is "deleted but recoverable": the UI must not offer a restore,
 * because no operation publishes one.
 */
export function memoryLifecycleState(state) {
  if (!MEMORY_LIFECYCLE.includes(state)) {
    return Object.freeze({
      state,
      known: false,
      terminal: false,
      recoverable: false,
      detail: `"${state}" is not one of the two declared memory lifecycle states (${MEMORY_LIFECYCLE.join(', ')})`,
    });
  }
  const table = {
    active: { terminal: false, detail: 'remembered and addressable; a record, not a live thing — being active implies no process, no subscription and no watch' },
    forgotten: { terminal: true, detail: 'explicitly forgotten and terminal; not expired (nothing expires on its own), not recoverable (no restore operation exists) and not a soft delete' },
  }[state];
  return Object.freeze({ state, known: true, recoverable: false, ...table });
}

/** Every lifecycle state with its rendering rule. */
export function memoryLifecycle() {
  return Object.freeze(MEMORY_LIFECYCLE.map((state) => memoryLifecycleState(state)));
}

/* ------------------------------------------------------------- record validation */

/**
 * Validates one memory record against the quoted field vocabulary.
 *
 * Fail-closed, like every other surface in this package: the field set is closed (thirteen fields
 * plus nothing), an identity is required, an unknown scope/kind/retention is a finding, and a
 * `references` entry whose relation is not one of the eleven declared edges is a finding rather than
 * a looser link. A record that carries a secret-shaped key, an inlined context or a transcript is
 * refused by name — and the refusal is returned, not swallowed, so the reader sees why a record is
 * not on screen.
 */
export function validateMemoryRecord(record = {}) {
  const findings = [];
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return Object.freeze({ ok: false, findings: Object.freeze(['a memory record must be an object']), memoryId: null, refused: Object.freeze([]), known: false });
  }
  const refused = scanForbiddenMemoryKeys(record);
  for (const entry of refused) findings.push(`"${entry.key}" is refused: ${entry.reason}`);
  const known = new Set(MEMORY_FIELDS);
  for (const key of Object.keys(record)) {
    if (!known.has(key) && FORBIDDEN_MEMORY_FIELDS[key] === undefined) {
      findings.push(`unknown field "${key}" (the quoted memory vocabulary is ${MEMORY_FIELDS.join(', ')})`);
    }
  }
  if (typeof record.memoryId !== 'string' || record.memoryId.length === 0) findings.push('"memoryId" must name the record — a memory with no stable identity cannot be recalled, versioned or forgotten');
  else if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.memoryId)) {
    findings.push(`"memoryId" \"${record.memoryId}\" breaks the published identity pattern (^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$)`);
  }
  if (record.scope === undefined) findings.push('"scope" must be declared: the namespace a record is isolated to is never inferred from context');
  else if (!MEMORY_SCOPES.includes(record.scope)) findings.push(`unknown scope "${record.scope}" (one of ${MEMORY_SCOPES.join(', ')})`);
  else if (record.scope !== 'GLOBAL' && (typeof record.scopeOwner !== 'string' || record.scopeOwner.length === 0)) {
    findings.push(`scope "${record.scope}" requires a "scopeOwner": without one the record has no namespace and scope isolation cannot hold`);
  }
  if (record.scopeOwner !== undefined && record.scopeOwner !== null && typeof record.scopeOwner !== 'string') {
    findings.push('"scopeOwner" must be a stable identity string (a projectId, workflowId, agentId or sessionId)');
  }
  if (record.kind === undefined) findings.push('"kind" must be declared');
  else if (!MEMORY_KINDS.includes(record.kind)) findings.push(`unknown kind "${record.kind}" (one of ${MEMORY_KINDS.join(', ')})`);
  if (record.retention === undefined) findings.push('"retention" must be declared: how long a record is meant to survive is not a UI guess');
  else if (!MEMORY_RETENTIONS.includes(record.retention)) findings.push(`unknown retention "${record.retention}" (one of ${MEMORY_RETENTIONS.join(', ')})`);
  if (record.content === undefined) findings.push('"content" must be present (an empty object is a content, absence is not)');
  if (record.references !== undefined && record.references !== null) {
    if (!Array.isArray(record.references)) findings.push('"references" must be an array of { id, relation } — linkage, not a load');
    else {
      if (record.references.length > MEMORY_REFERENCE_LIMIT) {
        findings.push(`"references" carries ${record.references.length} entries against the published bound of ${MEMORY_REFERENCE_LIMIT}`);
      }
      record.references.forEach((reference, index) => {
        if (reference === null || typeof reference !== 'object' || Array.isArray(reference)) {
          findings.push(`reference ${index} must be an object { id, relation }`);
          return;
        }
        if (typeof reference.id !== 'string' || reference.id.length === 0) findings.push(`reference ${index} has no id: an edge with no target is not a reference`);
        if (!MEMORY_GRAPH_EDGES.includes(reference.relation)) {
          findings.push(`reference ${index} uses relation "${reference.relation}", which the published edge vocabulary does not declare (${MEMORY_GRAPH_EDGES.join(', ')}) — an undeclared relation is refused, never passed through as free text`);
        }
        const extra = Object.keys(reference).filter((key) => !MEMORY_REFERENCE_FIELDS.includes(key));
        if (extra.length > 0) findings.push(`reference ${index} carries undeclared field(s) ${extra.join(', ')}`);
        if (reference.kind !== undefined && !MEMORY_GRAPH_NODES.includes(reference.kind)) {
          findings.push(`reference ${index} declares node kind "${reference.kind}", which is not one of the ten graph nodes`);
        }
      });
    }
  }
  if (record.provenance !== undefined && record.provenance !== null) {
    if (typeof record.provenance !== 'object' || Array.isArray(record.provenance)) findings.push('"provenance" must be an object { createdBy?, source? }');
    else {
      const extra = Object.keys(record.provenance).filter((key) => !['createdBy', 'source'].includes(key));
      if (extra.length > 0) findings.push(`"provenance" carries undeclared field(s) ${extra.join(', ')} (the published shape is { createdBy?, source? })`);
    }
  }
  if (record.version !== undefined && record.version !== null && !Number.isInteger(record.version)) {
    findings.push('"version" must be an integer: it increments on an update, and a version nobody can compare is not a version');
  }
  for (const field of ['size', 'checksum']) {
    if (record[field] === undefined || record[field] === null) findings.push(`"${field}" is required: the published record carries the two-field integrity envelope (size, checksum)`);
  }
  if (record.size !== undefined && record.size !== null && (typeof record.size !== 'number' || Number.isNaN(record.size) || record.size < 0)) {
    findings.push('"size" must be a non-negative number');
  }
  if (record.checksum !== undefined && record.checksum !== null && (typeof record.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(record.checksum))) {
    findings.push('"checksum" must be the sha256 hex digest the contract publishes (64 lowercase hex characters): a digest in another shape is reported, not verified');
  }
  return Object.freeze({
    ok: findings.length === 0 && refused.length === 0,
    findings: Object.freeze(findings),
    memoryId: typeof record.memoryId === 'string' ? record.memoryId : null,
    refused,
    known: true,
    lifecycle: MEMORY_LIFECYCLE.includes(record.lifecycle) ? record.lifecycle : null,
  });
}

/* -------------------------------------------------------------- the list contract */

/**
 * The four list states, declared here because `LOCAL_VOCABULARIES` quotes this symbol.
 *
 * A provenance entry that names a symbol no module exports is a citation to nothing, so the
 * declaration lives in the module that uses it and `test/34` compares the lock against it. The four
 * states are not decoration: `empty` (the backend answered "no records match") and
 * `not-handed-over` (nobody asked) look identical on screen and mean opposite things.
 */
export const MEMORY_LIST_STATES = Object.freeze(['rendered', 'empty', 'not-handed-over', 'refused']);

/**
 * Where a record came from — two states, and no guessed third.
 *
 * `provenance` is an optional `{ createdBy?, source? }` in the published shape, so an entry either
 * carries a declared origin or it does not. A surface that filled the gap with the current user, an
 * agent name or a default would be inventing an audit trail, which is why `no-provenance` is a state
 * it renders rather than a hole it papers over.
 */
export function memoryOrigin(record = {}) {
  const provenance = record?.provenance ?? null;
  const shaped = provenance !== null && typeof provenance === 'object' && !Array.isArray(provenance);
  const createdBy = shaped && typeof provenance.createdBy === 'string' ? provenance.createdBy : null;
  const source = shaped && typeof provenance.source === 'string' ? provenance.source : null;
  const declared = createdBy !== null || source !== null;
  return Object.freeze({
    state: declared ? 'declared-provenance' : 'no-provenance',
    declared,
    createdBy,
    source,
    detail: declared
      ? 'the record carries the provenance the contract publishes; it is rendered as declared and never enriched with a guessed author'
      : 'the record carries no provenance: the surface says exactly that and never fills in the current user, an agent name or a default',
  });
}

/** The two origin states, declared here because the vocabulary lock quotes this symbol. */
export const MEMORY_ORIGINS = Object.freeze(['declared-provenance', 'no-provenance']);

/**
 * The kind returned by `memory.recall` / `memory.list`: exactly the published output shape, or the
 * canonical unsupported answer. A `null` record from `recall` is an **answer** ("no such record"),
 * not a failure — the contract says so (`empty: "null, not an exception"`), and a UI that rendered it
 * as an error would be inventing a state.
 */
export function memoryRecallResult(result = {}) {
  const record = result?.record ?? null;
  if (record === null) {
    return Object.freeze({
      state: 'empty',
      record: null,
      validation: null,
      origin: null,
      detail: 'recall returned null: no record carries that memoryId. This is the published empty answer, not an error — nothing is rendered and nothing is inferred about why',
    });
  }
  const validation = validateMemoryRecord(record);
  const origin = memoryOrigin(record);
  return Object.freeze({
    state: validation.ok ? 'rendered' : 'refused',
    record,
    validation,
    origin,
    detail: validation.ok ? `record ${validation.memoryId} (${origin.state})` : `the record is refused: ${validation.findings[0]}`,
  });
}

/**
 * The list state: `rendered`, `empty`, `not-handed-over` or `refused`.
 *
 * The four are not decoration. `empty` (the backend answered "no records match") and
 * `not-handed-over` (nobody asked) look identical on screen and mean opposite things, and collapsing
 * them is how a UI tells a user their memory was erased. `refused` is shown by name, and
 * `nextCursor` is carried through untouched — the surface never paginates on its own and never
 * implies there are more results than the cursor proves.
 */
export function memoryList({ result = null, scope = null, limit = null, cursor = null } = {}) {
  const requested = Object.freeze({
    scope: scope?.scope ?? null,
    scopeOwner: scope?.scopeOwner ?? null,
    limit: limit ?? MEMORY_LIST_LIMIT.default,
    cursor: cursor ?? null,
    ordering: MEMORY_LIST_ORDERING,
  });
  if (result === null || result === undefined) {
    return Object.freeze({
      state: 'not-handed-over',
      requested,
      entries: Object.freeze([]),
      total: null,
      nextCursor: null,
      refused: Object.freeze([]),
      findings: Object.freeze([]),
      detail: 'no list was handed over: nothing is rendered and no empty state is claimed — "nothing was returned" is not "nothing is remembered"',
    });
  }
  const raw = Array.isArray(result) ? { results: result } : result;
  const entries = asArray(raw.results);
  const validations = entries.map((entry) => validateMemoryRecord(entry));
  const refused = validations.flatMap((validation) => validation.refused);
  const findings = validations.flatMap((validation) => validation.findings.map((finding, index) => `${entries[index]?.memoryId ?? `#${index}`}: ${finding}`));
  const total = typeof raw.total === 'number' ? raw.total : entries.length;
  const nextCursor = typeof raw.nextCursor === 'string' ? raw.nextCursor : null;
  const state = refused.length > 0 || findings.length > 0 ? 'refused' : entries.length === 0 ? 'empty' : 'rendered';
  const detail = state === 'refused'
    ? `the handed-over list is refused before rendering: ${findings[0] ?? refused[0]?.reason}`
    : state === 'empty'
      ? `the backend answered with no records at this scope (total ${total}): that is an answer, and the surface says exactly that — it is not an error and not a claim that anything was deleted`
      : `${entries.length} record(s) rendered in the published order (${MEMORY_LIST_ORDERING.join(', ')}), total ${total}${nextCursor === null ? ', no further page' : ', more available behind the cursor'}`;
  return Object.freeze({
    state,
    requested,
    entries: Object.freeze(entries),
    validations: Object.freeze(validations),
    total,
    nextCursor,
    more: nextCursor !== null,
    refused: Object.freeze(refused),
    findings: Object.freeze(findings),
    detail,
  });
}

/** The three persistence states, declared here because the vocabulary lock quotes this symbol. */
export const MEMORY_PERSISTENCE_STATES = Object.freeze(['provider-bound', 'in-memory-only', 'not-declared']);

/**
 * The persistence statement — three words and no fourth.
 *
 * The published contract puts storage behind `MemoryProvider` and says out loud that the default is
 * an in-memory map that may be replaced by SQLite, a filesystem snapshot or a graph store behind the
 * same interface. So a UI cannot know durability from the contract alone, and must not guess: it
 * renders what the application declared, or says nothing.
 */
export function memoryPersistence({ provider = null } = {}) {
  if (provider === null || provider === undefined) {
    return Object.freeze({
      state: 'not-declared',
      kind: null,
      connected: false,
      detail: 'no provider was declared: the surface says nothing about durability, and never renders "saved", "synced" or a connected indicator',
    });
  }
  const kind = typeof provider.kind === 'string' ? provider.kind : null;
  const inMemory = kind === 'in-memory' || provider.inMemory === true;
  return Object.freeze({
    state: inMemory ? 'in-memory-only' : 'provider-bound',
    kind,
    id: typeof provider.id === 'string' ? provider.id : null,
    connected: provider.connected === true,
    declared: true,
    detail: inMemory
      ? 'the declared provider is in-memory: the records shown do not outlive the process, and the surface says so instead of implying a save'
      : `a provider is declared behind the contract boundary (${kind ?? 'kind not named'}); the contract is replaceable and the surface names the boundary rather than the storage engine`,
  });
}

/* --------------------------------------------------------------- contract state */

function rowsOf(contract) {
  if (contract === null || contract === undefined) return [];
  if (Array.isArray(contract)) return contract;
  return Object.entries(contract).map(([id, row]) => (row !== null && typeof row === 'object' ? { id, ...row } : { id, version: row }));
}

/** One contract row, or the honest record of a row that does not exist. */
function contractStateOf(contractId, declaredVersion, rows) {
  const row = rows.find((entry) => (entry.id ?? entry.contract) === contractId) ?? null;
  if (row !== null) {
    const version = typeof row.version === 'string' ? row.version : null;
    return Object.freeze({
      id: contractId,
      version,
      declaredVersion,
      owner: row.owner ?? MEMORY_DECLARATION_SOURCE.owner,
      status: row.status ?? 'published',
      domain: row.domain ?? 'ai-foundation',
      published: true,
      comparable: version !== null,
      decision: MEMORY_DECISION,
      lockedIn: 'apps/n8n-lego/src/lego/contracts/contract-lock.json',
      agreesWithClaim: version === declaredVersion,
      detail: version === null
        ? 'a lock row without a version cannot be compared, and an uncomparable contract is reported as such'
        : version === declaredVersion
          ? `published at ${version}, which is the version the declaration claims`
          : `published at ${version} while the declaration claims ${declaredVersion}: a difference to reconcile, not to average`,
    });
  }
  return Object.freeze({
    id: contractId,
    version: null,
    declaredVersion,
    owner: MEMORY_DECLARATION_SOURCE.owner,
    status: 'declared-not-locked',
    domain: 'ai-foundation',
    published: false,
    comparable: false,
    decision: MEMORY_DECISION,
    lockedIn: 'apps/n8n-lego/src/lego/contracts/contract-lock.json',
    agreesWithClaim: false,
    detail: `${contractId} is declared in ${MEMORY_DECLARATION_SOURCE.file} and registered in the domain registry, and the AI set claims ${contractId}@${declaredVersion} — but no contract-lock row publishes it in this tree, so no version is rendered and the surface stays pending (${MEMORY_DECISION})`,
  });
}

/**
 * The publication state of Memory, on its own: one contract row and one boolean.
 *
 * This is the cheap half — it materialises no lifecycle tables, no affordance prose and no
 * validation — so `createFrontendLego().describe()` can report publication without building a
 * surface nobody rendered. Deriving it from the rows handed over is what makes the same code report
 * `declared-not-locked` against protected main @ `67e638ef` and `published` at `1.0.0` against a tree
 * that carries agent-2's row, with no edit.
 */
export function memoryPublication({ surface = null, contract = null } = {}) {
  const rows = rowsOf(contract ?? surface?.publication?.rows ?? null);
  const memory = contractStateOf(MEMORY_CONTRACT_ID, MEMORY_DECLARED_VERSION, rows);
  return Object.freeze({ published: memory.published, memory, rows: Object.freeze(rows) });
}

/**
 * The canonical unsupported answer for a Memory surface asked about a contract nobody locked.
 * A verdict, not an empty object.
 */
export function memoryUnsupported(reason = 'no Memory declaration was handed over') {
  return Object.freeze({
    state: 'capability-unavailable',
    error: MEMORY_UNSUPPORTED_ERROR,
    reason,
    decision: MEMORY_DECISION,
    contract: Object.freeze({
      id: MEMORY_CONTRACT_ID,
      version: null,
      declaredVersion: MEMORY_DECLARED_VERSION,
      published: false,
    }),
    detail: 'no fallback store, no placeholder entries, no memory-to-context injection and no model is implied in this state — the surface reports the gap it was handed and nothing else',
  });
}

/* ----------------------------------------------------------------------- drift */

/**
 * The vocabulary-bearing fields of a handed-over Memory declaration and the quoted set each is
 * compared with. The declaration is a composite of the three backend blocks the application hands
 * over: `memory` (from `manifest/memory.json`), `lego` (from
 * `manifest/ai-lego-set.json#lego[id=memory]`) and `capabilities` (from `manifest/domains.json`).
 * A block that is absent says nothing and is not drift.
 */
export const MEMORY_DRIFT_FIELDS = Object.freeze([
  Object.freeze({ block: 'memory', field: 'scopes', set: 'memoryScope' }),
  Object.freeze({ block: 'memory', field: 'kinds', set: 'memoryKind' }),
  Object.freeze({ block: 'memory', field: 'retention', set: 'memoryRetention' }),
  Object.freeze({ block: 'memory', field: 'fields', set: 'memoryField' }),
  Object.freeze({ block: 'memory', field: 'lifecycle.states', set: 'memoryLifecycle' }),
  Object.freeze({ block: 'memory', field: 'graph.nodes', set: 'memoryGraphNode' }),
  Object.freeze({ block: 'memory', field: 'graph.edges', set: 'memoryGraphEdge' }),
  Object.freeze({ block: 'memory', field: 'operations', set: 'memoryOperation', read: 'names' }),
  Object.freeze({ block: 'memory', field: 'permissions', set: 'memoryPermission' }),
]);

const driftOf = (block, field, quoted, declared) => {
  const added = declared.filter((value) => !quoted.includes(value));
  const removed = quoted.filter((value) => !declared.includes(value));
  if (added.length === 0 && removed.length === 0) return null;
  return Object.freeze({
    block,
    field,
    quoted: Object.freeze([...quoted]),
    declared: Object.freeze([...declared]),
    added: Object.freeze(added),
    removed: Object.freeze(removed),
  });
};

const readPath = (source, path) => path.split('.').reduce((cursor, key) => (cursor === undefined || cursor === null ? undefined : cursor[key]), source);

/**
 * Compares a handed-over Memory declaration with the vocabulary this package quotes, and reports the
 * difference instead of resolving it.
 *
 * States: `not-declared` (nothing handed over), `in-sync` (every present block agrees) and `drift` (a
 * difference, named in both directions). The published contract's own spelling wins nothing here and
 * loses nothing here: the surface keeps rendering the words it quotes, names the words it was handed,
 * and the reconciliation decides which set is canonical. `definitions` reports the two prose rules a
 * diff can detect as *moved* (`definition` and `distinction`) without treating prose as vocabulary.
 */
export function memoryDrift({ declaration = null, surface = null, contract = null } = {}) {
  const rows = rowsOf(contract ?? surface?.publication?.rows ?? null);
  const owner = surface?.declarationSource?.owner ?? MEMORY_DECLARATION_SOURCE.owner;
  const decision = surface?.alignment?.decision ?? MEMORY_DECISION;
  const rule = 'A difference is reported and registered, never resolved locally: the surface keeps rendering the words it quotes, names the words it was handed, and the reconciliation decides which set is canonical.';
  const memory = contractStateOf(MEMORY_CONTRACT_ID, MEMORY_DECLARED_VERSION, rows);
  const pending = Object.freeze(memory.published ? [] : Object.freeze([Object.freeze({
    kind: 'contract-row',
    id: MEMORY_CONTRACT_ID,
    declaredVersion: MEMORY_DECLARED_VERSION,
    decision: MEMORY_DECISION,
    publishedOn: null,
    onProtectedMain: false,
  })]));
  if (declaration === null || declaration === undefined) {
    return Object.freeze({
      state: 'not-declared',
      differences: Object.freeze([]),
      compared: Object.freeze([]),
      pending,
      uncomparable: Object.freeze(memory.published ? [] : [`${MEMORY_CONTRACT_ID} version (claimed ${MEMORY_DECLARED_VERSION}, no lock row)`]),
      owner,
      decision,
      rule,
      detail: 'no declaration was handed over: nothing is compared and nothing is claimed about the words the backend uses',
    });
  }
  const memoryBlock = declaration.memory ?? null;
  const differences = [];
  const compared = [];
  for (const { block, field, set, read } of MEMORY_DRIFT_FIELDS) {
    const source = block === 'memory' ? memoryBlock : declaration[block];
    if (source === null || source === undefined) continue;
    const raw = readPath(source, field);
    if (raw === undefined) continue;
    const quoted = vocabularyOf(set).values;
    const declared = raw === null
      ? []
      : read === 'names'
        ? asArray(raw).map((entry) => (typeof entry === 'string' ? entry : entry?.name)).filter((name) => typeof name === 'string')
        : asArray(raw);
    compared.push(`${block}.${field}`);
    const difference = driftOf(block, field, quoted, declared);
    if (difference !== null) differences.push(difference);
  }
  // The registry half: which operations the capability actually publishes, against the quote.
  for (const capability of asArray(declaration.capabilities)) {
    if (capability?.id !== MEMORY_CONTRACT_ID) continue;
    const declaredNames = asArray(capability.operations).map((operation) => (typeof operation === 'string' ? operation : operation?.name)).filter((name) => typeof name === 'string');
    compared.push(`capabilities[id=${MEMORY_CONTRACT_ID}].operations`);
    const difference = driftOf('capabilities', `[id=${MEMORY_CONTRACT_ID}].operations`, MEMORY_OPERATIONS, declaredNames);
    if (difference !== null) differences.push(difference);
    const declaredPermissions = asArray(capability.permissions).filter((permission) => typeof permission === 'string');
    compared.push(`capabilities[id=${MEMORY_CONTRACT_ID}].permissions`);
    const permissionDifference = driftOf('capabilities', `[id=${MEMORY_CONTRACT_ID}].permissions`, MEMORY_PERMISSIONS, declaredPermissions);
    if (permissionDifference !== null) differences.push(permissionDifference);
  }
  // The version claim: `ai.memory@1.0.0` in the AI set against the row handed over.
  const claim = declaration.lego?.versioning ?? memoryBlock?.version ?? null;
  if (typeof claim === 'string') {
    compared.push('lego.versioning');
    const claimsVersion = claim.includes(`${MEMORY_CONTRACT_ID}@${MEMORY_DECLARED_VERSION}`) || claim === MEMORY_DECLARED_VERSION;
    if (!memory.published && !claimsVersion) {
      differences.push(Object.freeze({
        block: 'lego',
        field: 'versioning',
        quoted: Object.freeze([`${MEMORY_CONTRACT_ID}@${MEMORY_DECLARED_VERSION} (claimed, unlocked)`]),
        declared: Object.freeze([claim]),
        added: Object.freeze([]),
        removed: Object.freeze([`${MEMORY_CONTRACT_ID}@${MEMORY_DECLARED_VERSION}`]),
      }));
    }
    if (memory.published && memory.version !== null && !claim.includes(memory.version)) {
      differences.push(Object.freeze({
        block: 'lego',
        field: 'versioning',
        quoted: Object.freeze([`${MEMORY_CONTRACT_ID}@${memory.version} (locked)`]),
        declared: Object.freeze([claim]),
        added: Object.freeze([]),
        removed: Object.freeze([`${MEMORY_CONTRACT_ID}@${memory.version}`]),
      }));
    }
  }
  return Object.freeze({
    state: differences.length === 0 ? (compared.length === 0 ? 'not-declared' : 'in-sync') : 'drift',
    differences: Object.freeze(differences),
    compared: Object.freeze(compared),
    pending,
    uncomparable: Object.freeze(memory.published ? [] : [`${MEMORY_CONTRACT_ID} version (claimed ${MEMORY_DECLARED_VERSION}, no lock row)`]),
    owner,
    decision,
    rule,
  });
}

/* ------------------------------------------------------------------ the surface */

/**
 * The fourteen relationships a reader could otherwise infer from a memory list, declared here because
 * `LOCAL_VOCABULARIES[id=memoryRefusal]` quotes this symbol.
 *
 * `memoryRefusal` is the other half of the affordance list: an affordance says what the surface may
 * show, and this says what showing it must never imply. `memory-dump` is first because the contract
 * forbids it in the Declaration itself; `relevance-ranking` and `vector-search` follow because the
 * roadmap mentions a traversable graph and a search box with a score would promise the deferred half;
 * `provider-connected` is the provider boundary's honesty rule; `automatic-retention` exists because
 * nothing expires on its own. `test/34` compares this declaration against the lock, so neither half
 * can drift without the gate failing.
 */
export const MEMORY_FORBIDDEN_IMPLICATIONS = Object.freeze([
  'memory-dump',
  'vector-search',
  'embedding',
  'relevance-ranking',
  'automatic-retention',
  'memory-to-context-injection',
  'model-inference',
  'agent-execution',
  'workspace-action',
  'filesystem-access',
  'terminal-access',
  'provider-connected',
  'permission-grant',
  'transcript-store',
]);

/** What this surface may render, and what it must never offer — with the reason for each refusal. */
export const MEMORY_AFFORDANCES = Object.freeze({
  allowed: Object.freeze([
    'show-memory-list',
    'show-memory-entry',
    'show-memory-scope',
    'show-memory-kind',
    'show-memory-retention',
    'show-memory-lifecycle',
    'show-memory-provenance',
    'show-memory-references',
    'show-memory-integrity',
    'show-memory-persistence-state',
    'show-pending-publication',
  ]),
  forbidden: Object.freeze({
    remember: 'writing memory is `memory.remember` behind `ai:memory:write`; the UI renders records, it does not create them',
    forget: 'deletion is `memory.forget`, it is terminal, and there is no undo and no restore operation: a destructive act belongs to a caller that holds the permission, never to a rendered list',
    traverse: `graph traversal is NOT published (${DEFERRED_MEMORY_OPERATIONS.join(', ')} are future stages): the only retrieval is the deterministic, scoped, bounded \`memory.list\``,
    relate: 'creating graph edges as a first-class operation is not published; references travel inside a record that was already written',
    search: 'there is no search: no relevance ranking, no similarity and no score is published, so a search box would promise a ranking nobody implements',
    embeddings: 'no embedding and no vector store exists in the contract; a similarity figure has no source',
    autoExpire: 'nothing expires on its own — every forget is explicit, so no retention word renders as a timer or a countdown',
    injectIntoContext: 'loading memory into a context is an explicit, bounded, relevance-driven caller decision; it is never a side effect of opening a screen',
    restore: 'a forgotten memory is terminal and no restore operation exists — offering one would invent an operation and a promise at the same time',
    execute: 'no execution affordance: a `task` memory is not a running task and the Agent Machine has no runtime',
    infer: 'no model inference and no provider call is implied by a memory list',
    connectProvider: 'the provider boundary belongs to the application: the UI reports a declared provider or says nothing, and never renders a connection it cannot see',
    grantPermission: 'a permission word is a requirement of a backend operation, never a grant the UI holds or gives',
    readTranscript: 'a transcript is refused by name; a memory record carries summaries and references',
    filesystem: 'no filesystem authority follows from a memory record',
    terminal: 'no terminal authority follows from a memory record',
  }),
});

/**
 * Builds the view the UI renders: publication state, the scope ladder, the list (or the honest
 * absence of one), entry validation, persistence statement, the separation from Context and Session,
 * the declared-but-deferred operations, and the refusals.
 *
 * Everything is derived from what was handed over. Nothing is fetched, nothing is written, and every
 * absence has a name.
 *
 * @param {{
 *   surface?: object|null,      the frontend surface declaration (manifest/memory.json)
 *   declaration?: object|null,  the composite backend declaration { memory, lego, capabilities }
 *   contract?: object[]|object|null,  published contract-lock rows, when any exist
 *   result?: object|object[]|null,    a `memory.list` result ({ results, total, nextCursor }) or a bare array
 *   record?: object|null,       a recall answer for a detail render: a record, or the published
 *                               `{ record: null }` empty answer. `null`/`undefined` means no detail
 *                               was handed over, and the view renders none — "not asked" and "asked
 *                               and empty" are different states, as everywhere else here.
 *   scope?: object|null,        the requested scope { scope, scopeOwner }
 *   limit?: number|null,        the requested limit
 *   cursor?: string|null,       the requested cursor
 *   provider?: object|null,     what the application declared about its provider
 * }} input
 */
export function createMemoryView({
  surface = null,
  declaration = null,
  contract = null,
  result = null,
  record = null,
  scope = null,
  limit = null,
  cursor = null,
  provider = null,
} = {}) {
  const publication = memoryPublication({ surface, contract });
  const memoryContract = publication.memory;
  const published = publication.published;

  const requestedScope = scope === null ? null : memoryScope(scope.scope);
  const list = memoryList({ result, scope, limit, cursor });
  // A record, or a recall result (`{ record }` — `null` inside it is the published empty answer).
  // Nothing handed over stays `null`: the view then renders no detail block at all rather than an
  // empty one, because "nobody asked" and "the backend answered null" must not look the same.
  const detail = record === null || record === undefined
    ? null
    : memoryRecallResult(record !== null && typeof record === 'object' && !Array.isArray(record) && 'record' in record ? record : { record });
  const persistence = memoryPersistence({ provider });
  const drift = memoryDrift({ declaration, surface, contract: publication.rows.length > 0 ? publication.rows : null });

  // A scope that was asked for and refused is a finding: rendering a scoped list against an
  // unknown scope would silently widen the namespace, which is the one thing scope exists to stop.
  const scopeFindings = [];
  if (scope !== null && scope !== undefined) {
    if (requestedScope === null || !requestedScope.known) {
      scopeFindings.push(`unknown scope "${scope.scope ?? 'undefined'}" (one of ${MEMORY_SCOPES.join(', ')})`);
    } else if (requestedScope.requiresOwner && (typeof scope.scopeOwner !== 'string' || scope.scopeOwner.length === 0)) {
      scopeFindings.push(`scope "${scope.scope}" was requested without a scopeOwner: an unowned non-GLOBAL scope is not a namespace, and the request is refused rather than widened`);
    }
  }
  const findings = [...scopeFindings, ...list.findings];
  const refused = Object.freeze([...list.refused]);
  const refusalNote = refused.length === 0
    ? ''
    : `; ${refused.length} handed-over ${refused.length === 1 ? 'field was' : 'fields were'} refused (${refused.map((entry) => entry.key).join(', ')})`;

  const availability = !published && declaration === null
    ? Object.freeze({ availability: 'capability-unavailable', detail: `${memoryContract.detail}; nothing was declared${refusalNote === '' ? ', so no record is rendered' : refusalNote}` })
    : !published
      ? Object.freeze({ availability: 'optional-absent', detail: `the declaration was handed over and the contract is still unlocked: the surface renders what was declared and names the publication it waits for${refusalNote}` })
      : findings.length > 0 || refused.length > 0
        ? Object.freeze({ availability: 'degraded', detail: `the contract is published but a handed-over record is refused: ${findings[0] ?? refused[0]?.reason}${refusalNote}` })
        : Object.freeze({ availability: 'available', detail: 'the contract is published and every handed-over record validated' });

  return Object.freeze({
    contract: memoryContract,
    published,
    availability: availability.availability,
    availabilityDetail: availability.detail,
    unsupported: published ? null : memoryUnsupported(availability.detail),
    drift,
    lego: Object.freeze({ id: MEMORY_LEGO_ID, phase: MEMORY_PHASE, contract: MEMORY_CONTRACT_ID, decision: MEMORY_MODELING_DECISION }),
    separation: MEMORY_SEPARATION,
    /** The list, with its four states and the exact `memory.list` contract it follows. */
    list: Object.freeze({
      ...list,
      limits: MEMORY_LIST_LIMIT,
      ordering: MEMORY_LIST_ORDERING,
      scope: requestedScope,
      scopeRequested: scope,
      scopeFindings: Object.freeze(scopeFindings),
    }),
    /** One record, when the application asked for one. `state: 'empty'` is the published null answer. */
    detail,
    scopes: memoryScopeLadder(),
    kinds: memoryKinds(),
    retentions: memoryRetentions(),
    lifecycles: memoryLifecycle(),
    graph: Object.freeze({
      nodes: MEMORY_GRAPH_NODES,
      edges: MEMORY_GRAPH_EDGES,
      traversalPublished: false,
      detail: 'the graph is the logical shape of memory, not a storage engine: P2.14 stores explicit linkage inside a record and publishes no traversal, so a graph view may be described and may not be drawn as a result set',
    }),
    persistence,
    /** The two origin states, so a renderer can name what it is showing without coining a word. */
    origins: MEMORY_ORIGINS,
    listStates: MEMORY_LIST_STATES,
    operations: Object.freeze({
      published: MEMORY_OPERATION_IDS,
      deferred: DEFERRED_MEMORY_OPERATIONS,
      offered: Object.freeze([]),
      rule: `The UI may name a published operation; it may not offer one. Nothing here calls ${MEMORY_OPERATION_IDS.join(', ')}, and ${DEFERRED_MEMORY_OPERATIONS.join('/')} are future stages that no affordance may offer.`,
    }),
    permissions: Object.freeze({ required: MEMORY_PERMISSIONS, grants: null }),
    pending: drift.pending,
    refused,
    findings: Object.freeze(findings),
    affordances: MEMORY_AFFORDANCES,
    forbiddenFields: FORBIDDEN_MEMORY_FIELDS,
    forbiddenImplications: vocabularyOf('memoryRefusal').values,
    declaration,
    declarationSources: Object.freeze({
      memory: MEMORY_DECLARATION_SOURCE,
      lego: MEMORY_LEGO_DECLARATION_SOURCE,
      capabilities: MEMORY_CAPABILITY_DECLARATION_SOURCE,
    }),
    quote: Object.freeze(MEMORY_QUOTED_VOCABULARIES.map((id) => {
      const set = vocabularyOf(id);
      return Object.freeze({
        id,
        contract: set.provenance.contract,
        declaredIn: `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`,
        publicationPending: set.publicationPending ?? null,
        openDecision: set.openDecision ?? null,
        size: set.values.length,
      });
    })),
    rule: 'Memory is what survives context replacement: deliberately retained records with their own identity, isolation and provenance, behind a provider boundary and never written from here. It is not the window, not the session and not execution state, and no record is invented, no persistence is claimed and no ranking is promised.',
  });
}

/** The surface as data: what it renders, over which quoted words, and with which provenance. */
export function describeMemory() {
  return Object.freeze({
    lego: MEMORY_LEGO_ID,
    phase: MEMORY_PHASE,
    contract: Object.freeze({
      id: MEMORY_CONTRACT_ID,
      declaredVersion: MEMORY_DECLARED_VERSION,
      publishedVersion: null,
      decision: MEMORY_DECISION,
      surfaceModule: MEMORY_SURFACE_MODULE,
    }),
    scopes: MEMORY_SCOPES,
    kinds: MEMORY_KINDS,
    retentions: MEMORY_RETENTIONS,
    fields: MEMORY_FIELDS,
    lifecycleStates: MEMORY_LIFECYCLE,
    operations: MEMORY_OPERATION_IDS,
    deferredOperations: DEFERRED_MEMORY_OPERATIONS,
    permissions: MEMORY_PERMISSIONS,
    graphNodes: MEMORY_GRAPH_NODES,
    graphEdges: MEMORY_GRAPH_EDGES,
    referenceFields: MEMORY_REFERENCE_FIELDS,
    referenceLimit: MEMORY_REFERENCE_LIMIT,
    contentLimitBytes: MEMORY_CONTENT_LIMIT_BYTES,
    listLimits: MEMORY_LIST_LIMIT,
    listOrdering: MEMORY_LIST_ORDERING,
    listStates: MEMORY_LIST_STATES,
    persistenceStates: MEMORY_PERSISTENCE_STATES,
    origins: MEMORY_ORIGINS,
    separation: MEMORY_SEPARATION,
    affordances: MEMORY_AFFORDANCES,
    forbiddenFields: FORBIDDEN_MEMORY_FIELDS,
    forbiddenImplications: vocabularyOf('memoryRefusal').values,
    driftFields: Object.freeze(MEMORY_DRIFT_FIELDS.map((entry) => `${entry.block}.${entry.field}`)),
    quoted: MEMORY_QUOTED_VOCABULARIES,
    sources: Object.freeze({
      memory: MEMORY_DECLARATION_SOURCE,
      lego: MEMORY_LEGO_DECLARATION_SOURCE,
      capabilities: MEMORY_CAPABILITY_DECLARATION_SOURCE,
    }),
    rule: 'Nine quoted sets, four published operations, two permission words, zero affordances, no invented record, no persistence claim and no ranking — Memory stays a separate LEGO from Context & Session, and the half the contract defers is named rather than implied.',
  });
}
