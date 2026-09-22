/**
 * The Context & Session surface — five distinct things, quoted words, no runtime (P2.13).
 *
 * Context & Session is ONE LEGO with TWO contracts: `ai.context` (what is loaded now) and
 * `ai.agent-session` (bounded state — identity plus references). The backend owns both
 * declarations; this module is the frontend's consumer of them. It renders state, and it renders
 * the absence of state. It never produces either.
 *
 * Five rules carry the design:
 *
 *   1. **Five things, never one object.** `Conversation != Session != Context window != Memory !=
 *      Execution`. A conversation holds many sessions, a session holds one or more windows, memory
 *      is what survives a window being replaced, and execution state comes from `execution.*` —
 *      never from a transcript. `assertDistinctConcepts()` refuses a record that merges them,
 *      because one generic "AI state" object is how a UI ends up promising a memory store and an
 *      agent run it does not have.
 *   2. **The vocabulary is quoted, not re-declared.** Ten sets come from the vocabulary lock
 *      (`src/vocabulary.mjs`), each with the contract, the file and the declaration path it was
 *      read from: 7 scopes, 9 context fields, 6 context lifecycle states, 14 continuation
 *      sections, 5 declared operation verbs, 5 registered context operations, 3 session
 *      operations, 7 session states, 10 session fields, 3 session references, 5 permission words,
 *      3 token kinds, the 3 context-manager phases and the 3 verification results.
 *   3. **A claim is not a publication — and a publication is not a merge.** Agent-2 published
 *      `ai.context@1.0.0` and `ai.agent-session@1.0.0` on `arena/01a0c6b5-n8n-rust-v-4` @
 *      `fb254f32` (lock rows, five registry operations, and the `CONTEXT_MANAGER_STATES` /
 *      `CONTINUATION_FIELDS` / `CONTINUATION_VERIFICATION` surface), so this lock quotes that
 *      publication: the two word lists that were pending are **promoted** (`PROMOTED_PUBLICATIONS`
 *      records the commit, the symbol and the fact that the values did not change). Protected main
 *      @ `e754c5df` publishes 15 rows and neither contract, so against that tree the same code
 *      reports `declared-not-locked` with `version: null` and never renders a version it cannot
 *      cite. Publication state is derived from the rows handed over, not from this comment — the
 *      state is
 *      derived from the row it is handed, not from a hardcoded string.
 *   4. **No fabricated numbers, no implied runtime.** A usage figure is `reported`, `estimated`,
 *      `not-reported` or `over-budget`, and it carries its token kind or is not rendered at all.
 *      Nothing here computes a percentage from nothing, renders a transcript, implies a Memory
 *      store, or offers an execution affordance. `Continue session` is an *intent*: the operation
 *      that would serve it is not published, so it is answered `operation-unpublished` instead of
 *      being wired to an invented one.
 *   5. **Fail closed, and report a difference instead of adopting it.** An unknown scope, state,
 *      section or field is refused by name; a secret-shaped key is refused by name *and* by
 *      pattern; an unbounded record (a session carrying a transcript) is refused; a declaration
 *      whose vocabulary moved past the quote is reported as `drift` with both spellings, and the
 *      reconciliation decides — this package never resolves a difference itself.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import, no backend import.
 * The declarations are handed over by the application (or by a test); this package never reads the
 * backend tree, and nothing it returns enters the boot payload.
 */
import { PENDING_CONTRACT_ROWS, PENDING_PUBLICATIONS, PROMOTED_PUBLICATIONS, pendingPublicationOf, promotionOf, vocabularyOf } from './vocabulary.mjs';

/* ------------------------------------------------------------------ contracts */

export const CONTEXT_CONTRACT_ID = 'ai.context';
export const SESSION_CONTRACT_ID = 'ai.agent-session';
/** Memory's own contract, named here only so the separation can state what it is NOT. P2.14 owns it. */
export const MEMORY_CONTRACT_ID = 'ai.memory';
/** One LEGO, two contracts. There is no `ai-context` and no `ai-session` LEGO. */
export const CONTEXT_SESSION_LEGO_ID = 'context-session';

/**
 * The decision that owes the publication this surface waits for: the two contract-lock rows and
 * the rollover/verification vocabulary. Recorded in
 * `docs/n8n-lego/decisions/cross-agent-decisions.json` (and argued in
 * `docs/n8n-lego/decisions/XA-20-context-session-publication.md`). The frontend does not resolve
 * it; it fails closed and names it.
 */
export const CONTEXT_SESSION_DECISION = 'XA-20';
/** Memory is a different question and a different milestone (P2.14). Named so nothing here implies a store. */
export const MEMORY_DECISION = 'XA-12';
/** Token and cost usage publication — the reason a usage figure carries a kind and a source. */
export const TOKEN_DECISION = 'XA-17';

/**
 * The version both declarations *claim* (`manifest/ai-lego-set.json#lego[id=context-session]
 * .versioning`). A claim is reported as `declaredVersion` and never as a published version: a
 * consumer binds to a contract-lock row, and at the P2.13 baseline there is none for either
 * contract.
 */
export const CONTEXT_DECLARED_VERSION = '1.0.0';
export const SESSION_DECLARED_VERSION = '1.0.0';

/** Where each quoted shape comes from. Provenance, not a copy. */
export const CONTEXT_DECLARATION_SOURCE = Object.freeze({
  file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
  path: 'context',
  owner: 'manager',
  contract: CONTEXT_CONTRACT_ID,
  declaredVersion: CONTEXT_DECLARED_VERSION,
  publishedVersion: null,
  decision: CONTEXT_SESSION_DECISION,
});

export const SESSION_DECLARATION_SOURCE = Object.freeze({
  file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
  path: 'agentSession',
  owner: 'manager',
  contract: SESSION_CONTRACT_ID,
  declaredVersion: SESSION_DECLARED_VERSION,
  publishedVersion: null,
  decision: CONTEXT_SESSION_DECISION,
});

/**
 * The LEGO-level declaration: the six-state context lifecycle, the fourteen continuation sections,
 * the five operation verbs and the rollover rule. Published by no contract-lock row, which is why
 * every set quoted from it carries a `publicationPending` record in the lock.
 */
export const LEGO_DECLARATION_SOURCE = Object.freeze({
  file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
  path: 'lego#id=context-session',
  owner: 'manager',
  contract: null,
  decision: CONTEXT_SESSION_DECISION,
});

/** The registry half: which operations and permissions are actually published as capabilities. */
export const CAPABILITY_DECLARATION_SOURCE = Object.freeze({
  file: 'apps/n8n-lego/src/lego/manifest/domains.json',
  path: 'domains#id=ai-foundation.capabilities[id=ai.context|ai.agent-session]',
  owner: 'manager',
  contract: 'lego.domain-registry',
  contractVersion: '1.1.0',
});

/* --------------------------------------------------------------- quoted words */

const SCOPE_SET = vocabularyOf('contextScope');
const CONTEXT_FIELD_SET = vocabularyOf('contextField');
const CONTEXT_LIFECYCLE_SET = vocabularyOf('contextLifecycle');
const CONTINUATION_SECTION_SET = vocabularyOf('continuationSection');
const CONTEXT_VERB_SET = vocabularyOf('contextOperationVerb');
const CONTEXT_OPERATION_SET = vocabularyOf('contextOperation');
const SESSION_OPERATION_SET = vocabularyOf('agentSessionOperation');
const SESSION_STATE_SET = vocabularyOf('agentSessionState');
const SESSION_FIELD_SET = vocabularyOf('agentSessionField');
const SESSION_REFERENCE_SET = vocabularyOf('agentSessionReference');
const CONTEXT_PERMISSION_SET = vocabularyOf('contextPermission');
const SESSION_PERMISSION_SET = vocabularyOf('agentSessionPermission');
const TOKEN_KIND_SET = vocabularyOf('tokenKind');

/** The seven context scopes, in declaration order — which is the disclosure ladder the UI renders. */
export const CONTEXT_SCOPES = SCOPE_SET.values;
/** What one context record carries. `parent` and `checksum` are what make lineage provable. */
export const CONTEXT_FIELDS = CONTEXT_FIELD_SET.values;
/** The six context lifecycle states. Never a boolean, never collapsed into the canonical set. */
export const CONTEXT_LIFECYCLE = CONTEXT_LIFECYCLE_SET.values;
/** The fourteen sections a continuation package must carry. `refs` is the published spelling. */
export const CONTINUATION_SECTIONS = CONTINUATION_SECTION_SET.values;
/** The five verbs the LEGO declares. */
export const CONTEXT_DECLARED_VERBS = CONTEXT_VERB_SET.values;
/** The two context operations the registry publishes. */
export const CONTEXT_OPERATIONS = CONTEXT_OPERATION_SET.values;
/** The three session operations the registry publishes. */
export const SESSION_OPERATIONS = SESSION_OPERATION_SET.values;
/** The seven session states. */
export const SESSION_STATES = SESSION_STATE_SET.values;
/** What identifies a session. */
export const SESSION_FIELDS = SESSION_FIELD_SET.values;
/** What a session points at instead of holding. */
export const SESSION_REFERENCES = SESSION_REFERENCE_SET.values;
/** Requirements of backend operations — never a grant the UI holds, never a control it renders. */
export const CONTEXT_PERMISSIONS = CONTEXT_PERMISSION_SET.values;
export const SESSION_PERMISSIONS = SESSION_PERMISSION_SET.values;
/** The three token kinds a usage figure must name. */
export const TOKEN_KINDS = TOKEN_KIND_SET.values;

/** The three context-manager phases, quoted from the published `ai.context@1.0.0` surface. */
const PHASE_SET = vocabularyOf('contextRolloverPhase');
/** The three continuity-verification results, quoted from the same published surface. */
const VERIFICATION_SET = vocabularyOf('continuationVerification');
export const ROLLOVER_PHASES = PHASE_SET.values;
export const VERIFICATION_RESULTS = VERIFICATION_SET.values;

/**
 * Whether a quoted set's words come from a published contract — **derived from the lock**, never
 * hardcoded, so the same code reports `pending` against protected main @ `e754c5df` and `published`
 * against the tree agent-2 pushed at `fb254f32` (and against main after the merge) with no edit.
 */
function publicationOfSet(set) {
  const contract = set?.provenance?.contract ?? null;
  const promotion = promotionOf(set?.id);
  return Object.freeze({
    id: set?.id ?? null,
    published: contract !== null,
    contract,
    contractId: contract?.id ?? null,
    version: contract?.version ?? null,
    promoted: promotion !== null,
    publishedOn: set?.provenance?.publishedOn ?? null,
    decision: contract === null ? CONTEXT_SESSION_DECISION : null,
    state: contract === null ? 'pending' : 'published',
  });
}
const PHASE_PUBLICATION = publicationOfSet(PHASE_SET);
const VERIFICATION_PUBLICATION = publicationOfSet(VERIFICATION_SET);

/** Every set this surface quotes, so a reviewer can see there is no local vocabulary. */
export const CONTEXT_SESSION_QUOTED_VOCABULARIES = Object.freeze([
  SCOPE_SET.id, CONTEXT_FIELD_SET.id, CONTEXT_LIFECYCLE_SET.id, CONTINUATION_SECTION_SET.id,
  CONTEXT_VERB_SET.id, CONTEXT_OPERATION_SET.id, SESSION_OPERATION_SET.id, SESSION_STATE_SET.id,
  SESSION_FIELD_SET.id, SESSION_REFERENCE_SET.id, CONTEXT_PERMISSION_SET.id,
  SESSION_PERMISSION_SET.id, TOKEN_KIND_SET.id, PHASE_SET.id, VERIFICATION_SET.id,
]);

/**
 * The qualified spelling of the five published operations (`<capability>.<operation>`), derived
 * from the quoted names so the two spellings cannot disagree: `ai.context.load`,
 * `ai.context.compact`, `ai.agent-session.create`, `ai.agent-session.status`,
 * `ai.agent-session.close`. Five operations, and nothing else is callable.
 */
export const PUBLISHED_OPERATION_IDS = Object.freeze([
  ...CONTEXT_OPERATIONS.map((name) => `${CONTEXT_CONTRACT_ID}.${name}`),
  ...SESSION_OPERATIONS.map((name) => `${SESSION_CONTRACT_ID}.${name}`),
]);

/**
 * The declared-but-unregistered verbs: `rollover`, `rehydrate`, `verify`. The AI set declares
 * them, the registry publishes no operation for them, so no affordance may offer them and every
 * request for one is answered `operation-unpublished`. Rendering the gap is the point: hiding it
 * would make a specification read as an API.
 */
export const UNPUBLISHED_CONTEXT_VERBS = Object.freeze(
  CONTEXT_DECLARED_VERBS.filter((verb) => !CONTEXT_OPERATIONS.includes(verb)),
);

/**
 * A derived *classification* of the quoted session states, not a new vocabulary: three of the
 * seven end a session. Used to keep a closed session from being rendered as resumable.
 */
export const SESSION_TERMINAL_STATES = Object.freeze(['completed', 'failed', 'cancelled']);

/** The quoted context lifecycle states that describe rollover work, in the order they happen. */
export const ROLLOVER_LIFECYCLE_STATES = Object.freeze(['prepare', 'compacting', 'rolled-over']);

/* ------------------------------------------------------- the five distinct things */

/**
 * The Memory concept, derived from what the tree publishes — the P2.14 change to this surface.
 *
 * At P2.13 the answer was a flat `exists: false` with "NO STORE EXISTS" underneath it, and that was
 * true of both trees at the time. It is no longer true of every tree: agent-2 published
 * `ai.memory@1.0.0` on its P2.14 branch, so a tree that carries that lock row **has** a store — and a
 * frontend that kept printing "no store exists" against it would be lying in the other direction.
 *
 * So the concept is derived: `exists` is `'implemented'` when the row is handed over and `false` when
 * it is not, and the detail names which LEGO owns the store. What does not change in either case is
 * the separation: **this surface renders no memory record**. Memory is a different LEGO with a
 * different contract (`ai.memory`), Context references it and never contains it, and a count rendered
 * from loaded context plus decisions and artifacts must say that is what it is.
 */
export function memoryConcept({ published = false } = {}) {
  return Object.freeze({
    id: 'memory',
    what: 'what survives context replacement',
    contract: 'ai.memory',
    exists: published ? 'implemented' : false,
    decision: MEMORY_DECISION,
    detail: published
      ? 'A STORE IS PUBLISHED, and it is a DIFFERENT LEGO: `ai.memory` (P2.14) owns remembered records with their own identity, isolation and provenance behind a provider boundary, and its own surface renders them. This surface still renders NO memory record — Context references memory, it does not contain it, and no embedding or vector search is implied here or there'
      : 'NO STORE IS PUBLISHED IN THIS TREE. The honest sources here stay loaded context (ai.context), decisions (ai.decision) and artifacts (ai.artifact) — a count rendered from those must say so, and no memory store, embedding or vector search may be implied. The contract itself is declared (`ai.memory` in the AI set, an entry of the `ai-foundation` registry) and the publication decision is XA-12',
  });
}

/**
 * The permanent distinction, as data (P2.13 §B1, and the invariant the backend declaration
 * itself carries at `manifest/ai-lego-set.json#lego[id=context-session].distinction`).
 *
 * `exists` answers "is there a store or a runtime behind this word today?" — for Execution the
 * honest answer is still no (the Agent Machine has no runtime), and for Memory it now depends on the
 * tree: see `memoryConcept()`. A surface that renders five tabs is not claiming five
 * implementations, and it is not denying one that exists either.
 */
export function distinctConcepts({ memoryPublished = false } = {}) {
  return Object.freeze([
    Object.freeze({
      id: 'conversation',
      what: 'the whole exchange a user has; it may contain many sessions and many context windows',
      contract: null,
      exists: false,
      detail: 'not persisted by this LEGO and not a session: nothing here stores a conversation, and a new window is never a new conversation',
    }),
    Object.freeze({
      id: 'session',
      what: 'bounded state: identity plus references',
      contract: SESSION_CONTRACT_ID,
      exists: 'contract-only',
      detail: 'a session is not an unbounded transcript; it carries contextRef, artifactRef and traceRef and never inlines what they point at',
    }),
    Object.freeze({
      id: 'context-window',
      what: 'what is loaded now, at one declared scope',
      contract: CONTEXT_CONTRACT_ID,
      exists: 'contract-only',
      detail: 'selectively loaded and bounded; compaction preserves the checksum chain so a later reader can prove what it descended from',
    }),
    memoryConcept({ published: memoryPublished }),
    Object.freeze({
      id: 'execution',
      what: 'a workflow run and its state',
      contract: 'execution.*',
      exists: 'declared',
      detail: 'execution state is not conversation history: it comes from the execution domain, and no execution affordance is offered from this surface',
    }),
  ]);
}

/**
 * The five concepts as the *default* tree renders them: no memory lock row handed over. This is the
 * constant a reader can inspect without building a view, and it is honest about the tree it was
 * written in rather than about every tree — the view derives the live answer.
 */
export const DISTINCT_CONCEPTS = distinctConcepts();

/* ------------------------------------------------------------------- refusals */

/**
 * Keys that would turn context or session state into something it must never be. Each is refused
 * by name, with the reason — the same shape the Skill surface uses for entitlement claims.
 *
 * Two families: **secrets** (a credential, a token, a cookie, an authorization header, a host
 * path) and **private model material** (chain-of-thought, a raw or hidden prompt, a transcript,
 * full model output). References are preferred over payloads everywhere: a session that inlines
 * what it should point at has stopped being bounded.
 */
export const FORBIDDEN_FIELDS = Object.freeze({
  credentials: 'a credential never travels in context or session state; it is resolved by the credentials domain at use time',
  credential: 'a credential never travels in context or session state',
  secret: 'no secret belongs in a rendered state',
  token: 'an authentication token is a secret; a token COUNT is usage metadata and travels as { kind, used, unit, source } — never under this key',
  tokens: 'an authentication token is a secret; a token count travels as usage metadata with a declared kind',
  accessToken: 'a secret, refused by name',
  apiKey: 'a secret, refused by name',
  cookie: 'session cookies are transport credentials; the UI renders a session identity, never a cookie',
  authorization: 'an authorization header is a credential',
  password: 'a secret, refused by name',
  privateKey: 'a secret, refused by name',
  chainOfThought: 'private model reasoning is never stored, never transported and never rendered',
  reasoning: 'private model reasoning is not an audit format; a decision carries a reasonSummary and evidence references instead',
  rawPrompt: 'a raw or hidden prompt is private model material',
  hiddenPrompt: 'a raw or hidden prompt is private model material',
  systemPrompt: 'a raw or hidden prompt is private model material',
  transcript: 'a session is bounded state, not a transcript; a transcript copy in a session, an event, an artifact or a decision is the specific failure this surface refuses',
  messages: 'a message list is a transcript by another name',
  modelOutput: 'full model output belongs to the artifact contract, referenced by id',
  completion: 'full model output belongs to the artifact contract, referenced by id',
  path: 'an arbitrary host path is a capability claim; a reference is an opaque id resolved by the owning domain',
  hostPath: 'an arbitrary host path is a capability claim',
  absolutePath: 'an arbitrary host path is a capability claim',
  filesystem: 'no filesystem authority follows from a context or a session',
  terminal: 'no terminal authority follows from a context or a session',
  grants: 'a context or session grants nothing; authority comes from a role or an approval',
  permissions: 'the quoted permission words are requirements of backend operations, never a grant carried by state',
  capabilityGrants: 'an unrestricted capability grant is refused; delegation narrows authority explicitly and never propagates it',
});

/**
 * The key-shaped refusal. Names above are the known ones; this catches the ones nobody thought to
 * list, because a secret that slips through a rendered state is not a documentation problem.
 * Values are not scanned — a *count* of tokens with a declared kind and source is legitimate usage
 * metadata, and so is the word "token" inside a reason string.
 */
/**
 * The same refusals as a pattern, so a key nobody enumerated is still refused. `tokenKind` is
 * exempted explicitly: it is a quoted vocabulary name, not a credential, and a refusal that fires
 * on the field the surface is supposed to render would be a refusal nobody can act on.
 */
export const FORBIDDEN_KEY_PATTERN = /(credential|secret|token(?!kind)|cookie|passw|api[_-]?key|authorization|private[_-]?key|chain[_-]?of[_-]?thought|reasoning|transcript|message|raw[_-]?prompt|hidden[_-]?prompt|system[_-]?prompt|model[_-]?output|completion|path|permission|grant)/i;

/**
 * What the UI must never imply about context or session state. Each entry is a relationship a
 * reader could otherwise infer from a chip, a bar or a continuation line.
 */
export const FORBIDDEN_IMPLICATIONS = Object.freeze([
  'model-inference',
  'provider-call',
  'memory-store',
  'agent-execution',
  'skill-execution',
  'workspace-action',
  'filesystem-access',
  'terminal-access',
  'mcp-runtime',
  'runtime-adapter',
  'token-fabrication',
  'transcript-dump',
  'permission-grant',
]);

/**
 * The three refusals whose *reason* depends on what the backend publishes, derived so the same code
 * stays truthful before and after a publication: `continue` is published by nobody (the session
 * capability publishes create/status/close), while `rehydrate` and `verify` are context operations
 * that protected main @ `e754c5df` does not register and agent-2's `fb254f32` publication does.
 * Either way the UI renders state and wires no call.
 */
export function forbiddenReasons({ contextOperations = CONTEXT_OPERATIONS, sessionOperations = SESSION_OPERATIONS } = {}) {
  const publishes = (verb) => contextOperations.includes(verb);
  return Object.freeze({
    continueSession: `no continue operation is published (${sessionOperations.join(', ')} are the session operations), so the affordance is an intent answered operation-unpublished`
      + (publishes('rollover') ? ` — the published path a backend would take is ${contextOperations.filter((verb) => ['rollover', 'rehydrate', 'verify'].includes(verb)).map((verb) => `${CONTEXT_CONTRACT_ID}.${verb}`).join(' -> ')}, and none of it is triggered from here` : ''),
    rehydrate: publishes('rehydrate')
      ? `published as ${CONTEXT_CONTRACT_ID}.rehydrate behind ai:context:write: the UI renders the rehydrated state and the verification result, and never calls the operation`
      : 'declared as a LEGO verb, published as no operation: operation-unpublished',
    verify: publishes('verify')
      ? `published as ${CONTEXT_CONTRACT_ID}.verify behind ai:context:read: the verification RESULT is rendered, the act of verifying is a backend operation nobody may trigger from here`
      : 'declared as a LEGO verb, published as no operation: the verification RESULT is rendered, the act is not offered',
  });
}
const FORBIDDEN_REASONS = forbiddenReasons();

/** What this surface may do, and what is forbidden — with the reason for each refusal. */
export const CONTEXT_SESSION_AFFORDANCES = Object.freeze({
  allowed: Object.freeze([
    'show-session-identity',
    'show-session-state',
    'show-context-scope',
    'show-context-lifecycle',
    'show-reported-usage',
    'show-rollover-state',
    'show-continuation-state',
    'show-verification-result',
    'show-previous-and-next-session',
    'show-degraded-continuation',
    'show-pending-publication',
  ]),
  forbidden: Object.freeze({
    execute: 'no execution affordance: the Agent Machine has no runtime and this surface is not it',
    infer: 'no model inference and no provider call is implied by a context or a session',
    loadMemory: 'Memory is a different LEGO with its own contract (ai.memory, XA-12) and this surface renders none of it: what may be counted here is loaded context, decisions and artifacts, and it must say that is what it is',
    writeContext: 'context writes are backend operations (ai.context.compact) behind ai:context:write; the UI renders state, it does not mutate it',
    rollOverNow: 'a rollover is a deterministic backend transition at a declared threshold, not a button',
    continueSession: FORBIDDEN_REASONS.continueSession,
    rehydrate: FORBIDDEN_REASONS.rehydrate,
    verify: FORBIDDEN_REASONS.verify,
    resetSession: 'no silent reset: a failed continuation is surfaced as failed, never as a fresh session',
    grantPermission: 'a permission word is a requirement of a backend operation, never a grant the UI holds or gives',
    readTranscript: 'a transcript is refused by name; a session carries references',
    fabricateTokens: 'a count nobody reported is not shown; there is no path from not-reported to a number',
    tools: 'tool access belongs to the tool gateway contract, never to a context or a session',
    filesystem: 'no filesystem authority follows from this surface',
    terminal: 'no terminal authority follows from this surface',
  }),
});

/**
 * The six things a continuation line may say — the local vocabulary `continuationAffordance`,
 * declared with its reason in the lock. Each names the backend fact it renders, and each is
 * explicit about whether an operation exists to serve it.
 *
 * The table is a **function of what is published**, so a publication changes the answer without an
 * edit: `verify` is unregistered on protected main @ `e754c5df` (state `operation-unpublished`) and
 * registered by agent-2's `ai.context@1.0.0` publication at `fb254f32` (state
 * `rendered-from-declaration`, act still not offered). `continue` is published by nobody in either
 * tree, so `continue-session` stays `operation-unpublished` in both — an intent, never a wired call.
 */
export function continuationAffordances({
  contextOperations = CONTEXT_OPERATIONS,
  sessionOperations = SESSION_OPERATIONS,
  phasesPublished = PHASE_PUBLICATION.published,
  verificationPublished = VERIFICATION_PUBLICATION.published,
} = {}) {
  const serves = (verb) => contextOperations.includes(verb);
  const verifyState = serves('verify') ? 'rendered-from-declaration' : 'operation-unpublished';
  const verificationSource = (word) => `the ${verificationPublished ? 'published' : 'ruled'} verification result \`${word}\`${verificationPublished ? ' (quoted from CONTINUATION_VERIFICATION, ai.context@1.0.0)' : ` (pending publication, ${CONTEXT_SESSION_DECISION})`}`;
  const publishedPath = ['rollover', 'rehydrate', 'verify'].filter(serves).map((verb) => `${CONTEXT_CONTRACT_ID}.${verb}`);
  return Object.freeze([
    Object.freeze({
      id: 'continue-session',
      says: 'Continue session',
      rendersFrom: 'the intent to carry on in the same session',
      operation: null,
      state: 'operation-unpublished',
      publishedPath: Object.freeze(publishedPath),
      detail: `${SESSION_CONTRACT_ID} publishes ${sessionOperations.join(', ')}; there is no continue operation, so this is rendered as an intent the backend cannot serve as one call — never wired to an invented operation`
        + (publishedPath.length > 0 ? `. The published path a backend takes is ${publishedPath.join(' -> ')}, and the UI triggers none of it` : ''),
    }),
    Object.freeze({
      id: 'rollover-preparing',
      says: 'Rollover preparing',
      rendersFrom: `the quoted context lifecycle state \`prepare\` and the ${phasesPublished ? 'published' : 'ruled'} PREPARE phase`,
      operation: serves('rollover') ? 'rollover' : null,
      state: 'rendered-from-declaration',
      detail: 'a declared threshold was reached; the continuation package is being prepared. Nothing is interrupted and no phase is advanced by the UI',
    }),
    Object.freeze({
      id: 'continuation-linked',
      says: 'Continuation linked',
      rendersFrom: 'the quoted context lifecycle state `rolled-over` plus the parent reference of the next context',
      operation: null,
      state: 'rendered-from-declaration',
      detail: 'the next window exists and names the one it descended from; identity lineage is preserved, so a compacted context can prove its ancestry',
    }),
    Object.freeze({
      id: 'continuity-verified',
      says: 'Continuity verified',
      rendersFrom: verificationSource('verified'),
      operation: 'verify',
      state: verifyState,
      detail: 'every continuity check passed on the rehydrated state; the result is rendered, the act of verifying is a backend operation nobody may trigger from here',
    }),
    Object.freeze({
      id: 'continuation-degraded',
      says: 'Continuation degraded',
      rendersFrom: verificationSource('degraded'),
      operation: 'verify',
      state: verifyState,
      detail: 'the continuation carried over but something is missing, and the missing items are named. Degraded is announced, never rendered as verified and never silently repaired',
    }),
    Object.freeze({
      id: 'continuation-failed',
      says: 'Continuation failed',
      rendersFrom: verificationSource('failed'),
      operation: 'verify',
      state: verifyState,
      detail: 'rehydration did not preserve the required state. This is surfaced as a failure — never as a new session, which is how a silent reset loses an objective',
    }),
  ]);
}

/** The six affordances as this branch's quoted publication state renders them. */
export const CONTINUATION_AFFORDANCES = continuationAffordances();

/** The four ways a usage figure may be sourced (local vocabulary `contextUsageReport`). */
export const USAGE_REPORT_STATES = Object.freeze(['reported', 'estimated', 'not-reported', 'over-budget']);

/** Raised for a record, scope, state or declaration this surface refuses to render. */
export class ContextSessionError extends Error {
  constructor(message, { code = 'frontend.context-session.invalid', concept = null, value = null, findings = [] } = {}) {
    super(message);
    this.name = 'ContextSessionError';
    this.code = code;
    this.concept = concept;
    this.value = value;
    this.findings = Object.freeze([...(findings ?? [])]);
  }
}

const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/** One quoted set as data: where it was read from, and which contract publishes it (null when pending). */
function quotedSet(id) {
  const set = vocabularyOf(id);
  return Object.freeze({
    id,
    contract: set.provenance.contract,
    declaredIn: `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`,
    publicationPending: set.publicationPending ?? null,
    size: set.values.length,
  });
}

/* ------------------------------------------------------------ concept separation */

/**
 * The five concepts must stay five. This is the machine-readable half of the invariant: a record
 * that claims to be a session while carrying a transcript, a context body, a memory store or an
 * execution state is refused — with the concept it collapsed named.
 *
 * It refuses *merging*, not *referencing*: a session that carries `contextRef` is correct, a
 * session that carries `context: { body: [...] }` is not.
 */
export function assertDistinctConcepts(record = {}) {
  const findings = [];
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new ContextSessionError('a concept record must be an object', { code: 'frontend.context-session.invalid-record', concept: null });
  }
  const merged = Object.keys(record).filter((key) => FORBIDDEN_FIELDS[key] !== undefined || FORBIDDEN_KEY_PATTERN.test(key));
  for (const key of merged) findings.push(`"${key}" is refused: ${FORBIDDEN_FIELDS[key] ?? 'a secret-shaped or private-model key may not travel in context or session state'}`);
  // Inlined payloads: the distinction is kept by reference, so an object where a ref belongs is a merge.
  for (const reference of SESSION_REFERENCES) {
    const value = record[reference];
    if (value !== undefined && value !== null && typeof value === 'object') {
      findings.push(`"${reference}" must be a reference (a string id), not an inlined payload — a session that holds what it points at is not bounded`);
    }
  }
  if (record.context !== undefined && typeof record.context === 'object' && record.context !== null && !('contextId' in record.context)) {
    findings.push('"context" carries no contextId: an inlined context body is a transcript by another name, and the window belongs to ai.context');
  }
  if (record.memory !== undefined) {
    findings.push(`"memory" is refused: memory is a SEPARATE LEGO (\`ai.memory\`) with its own contract and its own surface (${MEMORY_DECISION}), and a context or session record that carries a memory payload has merged two of the five concepts. Loaded context, decisions and artifacts may be counted and must be named as such`);
  }
  if (record.execution !== undefined && typeof record.execution === 'object' && record.execution !== null) {
    findings.push('"execution" carries an object: execution state comes from the execution domain, never from session or context state');
  }
  if (findings.length > 0) {
    throw new ContextSessionError(`the five concepts must stay distinct: ${findings.join('; ')}`, {
      code: 'frontend.context-session.concepts-merged',
      concept: 'conversation|session|context-window|memory|execution',
      findings,
    });
  }
  return Object.freeze({
    ok: true,
    concepts: Object.freeze(DISTINCT_CONCEPTS.map((concept) => Object.freeze({ id: concept.id, contract: concept.contract, exists: concept.exists }))),
    rule: 'Conversation != Session != Context window != Memory != Execution. Referencing is allowed; merging is not.',
  });
}

/** Refuses forbidden keys anywhere in a record tree, and names every key it refused. */
export function scanForbiddenKeys(record, { path = '' } = {}) {
  const refused = [];
  if (record === null || typeof record !== 'object') return Object.freeze(refused);
  for (const [key, value] of Object.entries(record)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (FORBIDDEN_FIELDS[key] !== undefined) refused.push(Object.freeze({ key: at, reason: FORBIDDEN_FIELDS[key] }));
    else if (FORBIDDEN_KEY_PATTERN.test(key)) refused.push(Object.freeze({ key: at, reason: 'matches the secret/private-model key pattern; a state record carries references and identifiers, not credentials or reasoning' }));
    if (value !== null && typeof value === 'object') refused.push(...scanForbiddenKeys(value, { path: at }));
  }
  return Object.freeze(refused);
}

/* ---------------------------------------------------------------- session states */

/**
 * What one session state means *to the UI*.
 *
 * Seven rows, one per quoted state, and every row says the same two things: this is not an
 * execution state, and it grants nothing. `running` means the backend says the session is running
 * — it does not mean a model is being called from here, and it does not mean this UI may act.
 */
export function sessionState(state) {
  if (!SESSION_STATES.includes(state)) {
    return Object.freeze({
      state,
      known: false,
      terminal: false,
      executing: false,
      inference: false,
      grants: null,
      detail: `"${state}" is not one of the seven declared session states (${SESSION_STATES.join(', ')}) — an unknown state is reported, never guessed`,
    });
  }
  const table = {
    created: { detail: 'the session exists and carries identity; no work has been reported for it' },
    running: { detail: 'the backend reports work in progress; that is a state, not an execution affordance' },
    waiting: { detail: 'waiting on something outside the session (an approval, an input, a child); nothing is progressing' },
    paused: { detail: 'deliberately held; resumable only by a backend operation this surface does not offer' },
    completed: { detail: 'the session ended normally; it is a record now, not a live thing' },
    failed: { detail: 'the session ended in failure; the reason is a reference, never an inlined transcript' },
    cancelled: { detail: 'the session was stopped; cancellation is a backend act, not a UI reset' },
  }[state];
  return Object.freeze({
    state,
    known: true,
    terminal: SESSION_TERMINAL_STATES.includes(state),
    executing: false,
    inference: false,
    grants: null,
    ...table,
  });
}

/** Every session state with its rendering rule — the table above, as data. */
export function sessionLifecycle() {
  return Object.freeze(SESSION_STATES.map((state) => sessionState(state)));
}

/**
 * What one context lifecycle state means, and whether it is part of rollover.
 *
 * `prepare`, `compacting` and `rolled-over` are the published words the UI renders rollover with.
 * The ruled three-phase machine (`NORMAL -> PREPARE -> ROLLOVER`) is *not* published, so this
 * surface does not spell `NORMAL`: below-threshold monitoring is rendered from `active` plus a
 * reported usage figure, and the pending phase machine is named as pending.
 */
export function contextLifecycleState(state) {
  if (!CONTEXT_LIFECYCLE.includes(state)) {
    return Object.freeze({
      state,
      known: false,
      rollover: false,
      compacted: false,
      detail: `"${state}" is not one of the six declared context lifecycle states (${CONTEXT_LIFECYCLE.join(', ')})`,
    });
  }
  const table = {
    declared: { rollover: false, compacted: false, detail: 'the context is declared; nothing is loaded into it yet' },
    active: { rollover: false, compacted: false, detail: 'in use as the current window; usage is monitored, and monitoring is not an interruption' },
    prepare: { rollover: true, compacted: false, detail: 'a declared threshold was reached and a rollover is being prepared; there is still room to write the continuation package' },
    compacting: { rollover: true, compacted: false, detail: 'compaction is running; the checksum chain must survive it' },
    'rolled-over': { rollover: true, compacted: true, detail: 'the next window exists and is linked to the one it descended from' },
    closed: { rollover: false, compacted: false, detail: 'the context is closed; it stays readable as a record and is not a live window' },
  }[state];
  return Object.freeze({ state, known: true, ...table });
}

/** Every context lifecycle state with its rendering rule. */
export function contextLifecycle() {
  return Object.freeze(CONTEXT_LIFECYCLE.map((state) => contextLifecycleState(state)));
}

/* ------------------------------------------------------------------ scope ladder */

/**
 * One context scope, with its rank in the quoted declaration order.
 *
 * The order is the disclosure ladder (`GLOBAL` widest → `TASK` narrowest) and it is quoted, not
 * re-sorted: an agent loads the narrowest scope that answers its question, and there is no
 * load-everything context.
 */
export function contextScope(scope) {
  if (!CONTEXT_SCOPES.includes(scope)) {
    return Object.freeze({
      scope,
      known: false,
      rank: null,
      selective: false,
      eager: false,
      detail: `"${scope}" is not one of the seven declared scopes (${CONTEXT_SCOPES.join(', ')}) — an unknown scope is refused, not approximated by the nearest wider one`,
    });
  }
  const rank = CONTEXT_SCOPES.indexOf(scope);
  const table = {
    GLOBAL: 'instance-wide; the widest scope, and the one a task almost never needs',
    WORKFLOW: 'one workflow and its structure',
    NODE: 'one node in a workflow',
    EXECUTION: 'one run: its failures and its data',
    EVENT: 'one event inside a run',
    AGENT: 'one agent\'s own working scope',
    TASK: 'one task; the narrowest scope, and the default an agent should aim at',
  }[scope];
  return Object.freeze({
    scope,
    known: true,
    rank,
    width: rank === 0 ? 'widest' : rank === CONTEXT_SCOPES.length - 1 ? 'narrowest' : 'intermediate',
    selective: true,
    eager: false,
    detail: table,
  });
}

/** The ladder as data, widest first, in the quoted declaration order. */
export function scopeLadder() {
  return Object.freeze(CONTEXT_SCOPES.map((scope) => contextScope(scope)));
}

/* -------------------------------------------------------------- record validation */

/**
 * Validates one context record against the quoted field vocabulary.
 *
 * Fail-closed on purpose: an unknown field is a finding (the vocabulary is closed), a missing
 * identity is a finding, and a `parent` that is an object carrying a payload is a finding — the
 * parent reference is how a compacted context proves its ancestry, so it must be an id (and
 * optionally a checksum), never an inlined body.
 */
export function validateContextRecord(record = {}) {
  const findings = [];
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return Object.freeze({ ok: false, findings: Object.freeze(['a context record must be an object']), contextId: null, refused: Object.freeze([]) });
  }
  const refused = scanForbiddenKeys(record);
  for (const entry of refused) findings.push(`"${entry.key}" is refused: ${entry.reason}`);
  const known = new Set([...CONTEXT_FIELDS, 'lineage', 'lifecycle', 'usage', 'budget', 'compactedFrom']);
  for (const key of Object.keys(record)) {
    if (!known.has(key) && FORBIDDEN_FIELDS[key] === undefined) findings.push(`unknown field "${key}" (the quoted context vocabulary is ${CONTEXT_FIELDS.join(', ')})`);
  }
  if (typeof record.contextId !== 'string' || record.contextId.length === 0) findings.push('"contextId" must name the context');
  if (record.scope === undefined) findings.push('"scope" must be declared — an undeclared scope is an eager load by accident');
  else if (!CONTEXT_SCOPES.includes(record.scope)) findings.push(`unknown scope "${record.scope}" (one of ${CONTEXT_SCOPES.join(', ')})`);
  if (record.lifecycle !== undefined && !CONTEXT_LIFECYCLE.includes(record.lifecycle)) {
    findings.push(`unknown lifecycle state "${record.lifecycle}" (one of ${CONTEXT_LIFECYCLE.join(', ')})`);
  }
  if (record.version !== undefined && record.version !== null && !/^\d+(\.\d+)*$/.test(String(record.version))) {
    findings.push('"version" must be a monotonic identifier so a snapshot can be told apart from its predecessor');
  }
  if (record.checksum !== undefined && record.checksum !== null && typeof record.checksum !== 'string') {
    findings.push('"checksum" must be a string: the chain is verified by comparing digests, not by trusting a narrative');
  }
  if (record.parent !== undefined && record.parent !== null) {
    const parent = record.parent;
    if (typeof parent === 'object') {
      if (typeof parent.contextId !== 'string' || parent.contextId.length === 0) findings.push('"parent" must name the context this one descended from (parent.contextId)');
      const inlined = Object.keys(parent).filter((key) => !['contextId', 'checksum', 'version', 'scope'].includes(key));
      if (inlined.length > 0) findings.push(`"parent" carries an inlined payload (${inlined.join(', ')}): a parent is a reference, so lineage stays provable and bounded`);
    } else if (typeof parent !== 'string') {
      findings.push('"parent" must be a context id or { contextId, checksum? }');
    }
  }
  if (record.size !== undefined && record.size !== null) {
    if (typeof record.size !== 'number' || Number.isNaN(record.size) || record.size < 0) findings.push('"size" must be a non-negative number');
    if (typeof record.budget === 'number' && typeof record.size === 'number' && record.size > record.budget) {
      findings.push(`size ${record.size} exceeds the declared bound ${record.budget}: context is bounded by rule, and an over-bound record is a finding, not a rounding`);
    }
  }
  return Object.freeze({ ok: findings.length === 0 && refused.length === 0, findings: Object.freeze(findings), contextId: record.contextId ?? null, refused });
}

/**
 * Validates one session record.
 *
 * A session is identity plus references. The quoted field vocabulary is closed (`sessionId` …
 * `updatedAt` plus the three references), a terminal state is reported as terminal, and an inlined
 * transcript is refused as unbounded — the one property the backend declaration requires of a
 * session record.
 */
export function validateSessionRecord(record = {}) {
  const findings = [];
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return Object.freeze({ ok: false, findings: Object.freeze(['a session record must be an object']), sessionId: null, refused: Object.freeze([]), terminal: false });
  }
  const refused = scanForbiddenKeys(record);
  for (const entry of refused) findings.push(`"${entry.key}" is refused: ${entry.reason}`);
  const known = new Set([...SESSION_FIELDS, ...SESSION_REFERENCES, 'continuation', 'previousSessionId', 'nextSessionId']);
  for (const key of Object.keys(record)) {
    if (!known.has(key) && FORBIDDEN_FIELDS[key] === undefined) findings.push(`unknown field "${key}" (the quoted session vocabulary is ${[...SESSION_FIELDS, ...SESSION_REFERENCES].join(', ')})`);
  }
  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) findings.push('"sessionId" must name the session');
  if (typeof record.agentId !== 'string' || record.agentId.length === 0) findings.push('"agentId" must name the agent the session belongs to — a session without an agent is not a session');
  const status = record.status;
  if (status === undefined) findings.push('"status" must be declared: a session state is never inferred from the presence of fields');
  else if (!SESSION_STATES.includes(status)) findings.push(`unknown status "${status}" (one of ${SESSION_STATES.join(', ')})`);
  for (const reference of SESSION_REFERENCES) {
    const value = record[reference];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') findings.push(`"${reference}" must be a reference string, not an inlined payload`);
  }
  for (const field of ['createdAt', 'updatedAt']) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number') findings.push(`"${field}" must be a timestamp (string or number)`);
  }
  return Object.freeze({
    ok: findings.length === 0 && refused.length === 0,
    findings: Object.freeze(findings),
    sessionId: record.sessionId ?? null,
    refused,
    terminal: SESSION_STATES.includes(status) ? SESSION_TERMINAL_STATES.includes(status) : false,
  });
}

/* ------------------------------------------------------------ continuation package */

/**
 * The envelope a handed-over continuation travels in: the fourteen sections are the package, and
 * these are the facts about its transport — the window it came from, the window it produced, the
 * backend's own verification result and the lineage ids. An envelope field is not an unknown
 * section, and it is never rendered as package content either.
 */
export const CONTINUATION_ENVELOPE_FIELDS = Object.freeze([
  'bound',
  'createdAt',
  'sourceContextId',
  'target',
  'targetContextId',
  'verification',
  'previousSessionId',
  'nextSessionId',
]);

/**
 * Validates a continuation package: the fourteen quoted sections, an identity that must be present,
 * a bound that must hold, and no private model material.
 *
 * `identity` is required and must name both the session and the context the continuation carries
 * over — a package with no identity is refused rather than rendered, because rehydrating an
 * anonymous package is how a continuation silently becomes a new conversation. Sections that are
 * absent are reported as `missing` (and drive a `degraded` verification), never silently filled.
 */
export function validateContinuationPackage(pkg = {}, { maxSections = CONTINUATION_SECTIONS.length, maxEntriesPerSection = 64 } = {}) {
  const findings = [];
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return Object.freeze({ ok: false, findings: Object.freeze(['a continuation package must be an object']), sections: Object.freeze([]), present: Object.freeze([]), missing: Object.freeze([...CONTINUATION_SECTIONS]), refused: Object.freeze([]), bounded: false });
  }
  const refused = scanForbiddenKeys(pkg);
  for (const entry of refused) findings.push(`"${entry.key}" is refused: ${entry.reason}`);
  const present = CONTINUATION_SECTIONS.filter((section) => pkg[section] !== undefined && pkg[section] !== null);
  const missing = CONTINUATION_SECTIONS.filter((section) => !present.includes(section));
  const unknown = Object.keys(pkg).filter((key) => !CONTINUATION_SECTIONS.includes(key) && !CONTINUATION_ENVELOPE_FIELDS.includes(key));
  for (const key of unknown) findings.push(`unknown section "${key}" (the quoted continuation vocabulary is ${CONTINUATION_SECTIONS.join(', ')})`);
  if (present.length > maxSections) findings.push(`a continuation package carries ${present.length} sections against a bound of ${maxSections}`);
  const identity = pkg.identity;
  if (identity === undefined || identity === null) findings.push('"identity" is required: a continuation that cannot name what it continues is refused, not rendered');
  else {
    if (typeof identity !== 'object' || Array.isArray(identity)) findings.push('"identity" must be an object naming the session and the context');
    else {
      if (typeof identity.sessionId !== 'string' || identity.sessionId.length === 0) findings.push('"identity.sessionId" is required');
      if (typeof identity.contextId !== 'string' || identity.contextId.length === 0) findings.push('"identity.contextId" is required — the continuation must name the window it carries over');
    }
  }
  for (const section of present) {
    const value = pkg[section];
    if (Array.isArray(value) && value.length > maxEntriesPerSection) {
      findings.push(`section "${section}" carries ${value.length} entries against a bound of ${maxEntriesPerSection}: a continuation is a summary with references, not a dump`);
    }
    if (typeof value === 'string' && value.length > 4096) {
      findings.push(`section "${section}" is a ${value.length}-character string: a bounded package carries summaries and references, and this reads like a transcript`);
    }
  }
  if (pkg.compressedHistory !== undefined && Array.isArray(pkg.compressedHistory)) {
    const raw = pkg.compressedHistory.find((entry) => typeof entry === 'object' && entry !== null && (entry.raw !== undefined || entry.text !== undefined));
    if (raw !== undefined) findings.push('"compressedHistory" carries a raw entry: compressed history is a summary, and a raw message body is a transcript');
  }
  return Object.freeze({
    ok: findings.length === 0 && refused.length === 0,
    findings: Object.freeze(findings),
    sections: CONTINUATION_SECTIONS,
    present: Object.freeze(present),
    missing: Object.freeze(missing),
    refused,
    bounded: present.length <= maxSections && findings.every((finding) => !finding.includes('against a bound of')),
  });
}

/* ----------------------------------------------------------------------- usage */

/**
 * A usage figure, honestly.
 *
 * Four outcomes and no fifth path: `reported` (the backend or the provider handed the number over
 * with a declared kind and unit), `estimated` (declared as an estimate, and labelled as one),
 * `not-reported` (nobody reported anything, so there is no percentage, no bar and no number) and
 * `over-budget` (a reported figure exceeded its declared bound).
 *
 * This is the function that makes a fabricated token count unrepresentable: it never divides
 * something by nothing, never defaults a missing unit, and never promotes an estimate to a
 * report.
 */
export function contextUsage(usage = null) {
  const none = (detail, extra = {}) => Object.freeze({
    state: 'not-reported',
    kind: null,
    used: null,
    budget: null,
    remaining: null,
    unit: null,
    percent: null,
    fabricated: false,
    source: null,
    detail,
    ...extra,
  });
  if (usage === null || usage === undefined) return none('no usage was reported; a percentage is never computed from nothing, so nothing is drawn');
  if (typeof usage !== 'object' || Array.isArray(usage)) return none('usage must be reported as an object { kind, used, budget?, unit, source }');
  const kind = usage.kind ?? usage.tokenKind ?? null;
  if (kind === null) {
    return none(`a usage figure must carry its token kind (${TOKEN_KINDS.join(', ')}): a number with no kind is ambiguous, and the ambiguity is the bug — it is not rendered`);
  }
  if (!TOKEN_KINDS.includes(kind)) {
    return none(`"${kind}" is not one of the three declared token kinds (${TOKEN_KINDS.join(', ')}); a figure without a declared kind is ambiguous, and the ambiguity is the bug`, { kind });
  }
  const used = usage.used;
  if (used === undefined || used === null) {
    return none('no used figure was reported', { kind });
  }
  if (typeof used !== 'number' || Number.isNaN(used) || used < 0) {
    return none('a reported usage figure must be a non-negative number', { kind });
  }
  const unit = usage.unit ?? null;
  if (unit === null) {
    return none('a number without a declared unit is not a token count; the unit is reported by the backend or the figure is not shown', { kind, used });
  }
  const source = usage.source ?? null;
  if (source !== 'reported' && source !== 'estimated') {
    return none(`usage source must be declared as "reported" or "estimated", got ${source === null ? 'nothing' : `"${source}"`}`, { kind, used, unit });
  }
  const budget = typeof usage.budget === 'number' && !Number.isNaN(usage.budget) && usage.budget > 0 ? usage.budget : null;
  if (budget !== null && used > budget) {
    return Object.freeze({
      state: 'over-budget',
      kind,
      used,
      budget,
      remaining: 0,
      unit,
      percent: Math.round((used / budget) * 100),
      fabricated: false,
      source,
      detail: `reported ${used} ${unit} of ${kind} against a bound of ${budget}: over budget, and a rollover at this point has no room left for the continuation package`,
    });
  }
  return Object.freeze({
    state: source,
    kind,
    used,
    budget,
    remaining: budget === null ? null : budget - used,
    unit,
    percent: budget === null ? null : Math.round((used / budget) * 100),
    fabricated: false,
    source,
    detail: budget === null
      ? `${source} ${used} ${unit} of ${kind}; no bound was declared, so no percentage is drawn`
      : `${source} ${used} ${unit} of ${budget} (${kind})`,
  });
}

/* --------------------------------------------------------------------- rollover */

/**
 * The rollover threshold rule, checked rather than trusted.
 *
 * A threshold must be declared, must be a fraction strictly below the bound, and must leave room
 * to serialize the continuation package. A threshold at or above 1.0 is refused with the reason the
 * backend declaration itself gives — this is the rule that keeps a rollover from being attempted at
 * 100%.
 */
export function validateRolloverThreshold(threshold) {
  if (threshold === undefined || threshold === null) {
    return Object.freeze({ ok: false, threshold: null, findings: Object.freeze(['no rollover threshold was declared; without one there is no PREPARE, and a UI may not invent a trigger']) });
  }
  if (typeof threshold !== 'number' || Number.isNaN(threshold)) {
    return Object.freeze({ ok: false, threshold, findings: Object.freeze(['a rollover threshold must be a number (a fraction of the declared bound)']) });
  }
  if (threshold <= 0) {
    return Object.freeze({ ok: false, threshold, findings: Object.freeze(['a rollover threshold must be greater than 0: a threshold of 0 rolls over before anything is loaded']) });
  }
  if (threshold >= 1) {
    return Object.freeze({
      ok: false,
      threshold,
      findings: Object.freeze([`a threshold of ${threshold} waits for the exact limit: a rollover attempted at 100% has no room left to write the continuation package, which is the one operation that makes the rollover survivable`]),
    });
  }
  return Object.freeze({ ok: true, threshold, findings: Object.freeze([]) });
}

/**
 * The phase a *reported* usage figure implies, computed deterministically — and only ever reported
 * as an expectation.
 *
 * The frontend does not advance a phase. It renders the phase or lifecycle state the backend
 * handed over; this function exists so a screen can say "the declared threshold is reached, a
 * rollover is expected" without deciding that one has started. The three-phase machine is quoted
 * from the published `ai.context@1.0.0` surface (`CONTEXT_MANAGER_STATES`), so `phasePublication`
 * and `published` are derived from the lock: `published` against a tree that carries the
 * publication, `pending` against one that does not. `publishedWord` is the quoted lifecycle state
 * the UI renders next to the phase.
 */
export function expectedRolloverPhase({ usage = null, threshold = null, lifecycleState = null } = {}) {
  const publication = PHASE_PUBLICATION;
  const report = contextUsage(usage);
  const thresholdCheck = validateRolloverThreshold(threshold);
  const quoted = CONTEXT_LIFECYCLE.includes(lifecycleState) ? lifecycleState : null;
  const base = Object.freeze({
    phasePublication: publication.state,
    decision: publication.decision,
    phaseContract: publication.contract,
    phases: ROLLOVER_PHASES,
    usage: report,
    threshold: thresholdCheck.ok ? thresholdCheck.threshold : null,
    thresholdFindings: thresholdCheck.findings,
    lifecycleState: quoted,
  });
  if (quoted !== null && ROLLOVER_LIFECYCLE_STATES.includes(quoted)) {
    const phase = quoted === 'prepare' ? 'PREPARE' : 'ROLLOVER';
    return Object.freeze({ ...base, expectedPhase: phase, published: publication.published, publishedWord: quoted, detail: `the declaration reports the lifecycle state "${quoted}", which is the published word for the ${phase} phase` + (publication.published ? `; the phase machine itself is published as ${ROLLOVER_PHASES.join(' -> ')} by ${publication.contractId}@${publication.version}` : `; the phase name itself is not published (${CONTEXT_SESSION_DECISION})`) });
  }
  if (report.state === 'not-reported') {
    return Object.freeze({ ...base, expectedPhase: null, published: publication.published, publishedWord: quoted, detail: report.detail + ` — with nothing reported there is no phase to expect, and ${ROLLOVER_PHASES[0]} is never asserted from silence` });
  }
  if (!thresholdCheck.ok) {
    return Object.freeze({ ...base, expectedPhase: null, published: publication.published, publishedWord: quoted, detail: thresholdCheck.findings[0] });
  }
  if (report.percent === null) {
    return Object.freeze({ ...base, expectedPhase: null, published: publication.published, publishedWord: quoted, detail: 'usage was reported without a bound, so no threshold crossing can be computed; the figure is shown and no phase is expected' });
  }
  const reached = report.percent / 100 >= thresholdCheck.threshold;
  return Object.freeze({
    ...base,
    expectedPhase: reached ? ROLLOVER_PHASES[1] : ROLLOVER_PHASES[0],
    published: publication.published,
    publishedWord: reached ? 'prepare' : quoted,
    detail: reached
      ? `${report.percent}% of the declared bound is at or above the ${Math.round(thresholdCheck.threshold * 100)}% threshold: a rollover is expected and the continuation package should be prepared now, not at the limit`
      : `${report.percent}% of the declared bound is below the ${Math.round(thresholdCheck.threshold * 100)}% threshold: usage is monitored and nothing is interrupted`,
  });
}

/* --------------------------------------------------------------- verification */

/**
 * The continuity checks, as data.
 *
 * Each check names the section or reference it needs, so a `degraded` result can say exactly what
 * is missing instead of saying "something went wrong". These are the checks the manager's P2.13
 * ruling requires (§B6) and the ones the context-rollover reference scenario names in its verify
 * step: objective, constraints, pending actions, decisions, artifact references and permissions.
 */
export const CONTINUITY_CHECKS = Object.freeze([
  Object.freeze({ id: 'identity', requires: 'identity', question: 'does the continuation name the session and the context it carries over?' }),
  Object.freeze({ id: 'lineage', requires: 'parent', question: 'does the next context name the one it descended from, so the checksum chain stays verifiable?' }),
  Object.freeze({ id: 'objective', requires: 'objective', question: 'is the objective still there?' }),
  Object.freeze({ id: 'plan', requires: 'plan', question: 'is the plan still there, including the work that is not finished?' }),
  Object.freeze({ id: 'unfinishedWork', requires: 'unfinishedWork', question: 'is the unfinished work named, so nothing is silently dropped?' }),
  Object.freeze({ id: 'constraints', requires: 'constraints', question: 'are the constraints still binding?' }),
  Object.freeze({ id: 'decisions', requires: 'decisions', question: 'are the decisions and their evidence still carried?' }),
  Object.freeze({ id: 'artifacts', requires: 'artifacts', question: 'are the artifact references still carried?' }),
  Object.freeze({ id: 'errors', requires: 'errors', question: 'are the errors and unresolved questions still visible?' }),
  Object.freeze({ id: 'importantReferences', requires: 'importantReferences', question: 'are the important references still carried?' }),
]);

/**
 * The explicit verification stage.
 *
 * Three results and never two: `verified` (every check passed), `degraded` (the continuation
 * carried over but named sections were not carried) and `failed` (identity or lineage did not
 * survive, the package was refused, or the backend reported a failure). Missing state is reported
 * as missing. Nothing is repaired here — `repaired` is always empty and a silent repair is refused
 * by design, because a silent repair is how a continuation loses an objective and still looks green.
 *
 * Absent is not the same as empty. A section carried as `[]` says "there were none" and that is
 * information the reader is entitled to; a section that is not in the package at all is a loss, and
 * it is the loss that degrades a continuation. Conflating the two would degrade every clean session
 * that happened to produce no errors, and would hide the one that dropped its decisions.
 *
 * A result handed over by the backend wins over the computed one, and a handed-over result that is
 * not one of the three ruled words is refused rather than mapped to the nearest one.
 */
export function continuityVerification({ pkg = null, before = null, after = null, result = null } = {}) {
  const publication = VERIFICATION_PUBLICATION;
  const checks = [];
  const missing = [];
  const validation = pkg === null ? null : validateContinuationPackage(pkg);
  if (validation !== null && !validation.ok) {
    return Object.freeze({
      result: 'failed',
      published: publication.published,
      decision: publication.decision,
      resultContract: publication.contract,
      results: VERIFICATION_RESULTS,
      checks: Object.freeze([]),
      missing: Object.freeze([]),
      repaired: Object.freeze([]),
      refused: validation.refused,
      detail: `the continuation package is refused before verification: ${validation.findings.join('; ')}`,
    });
  }
  for (const check of CONTINUITY_CHECKS) {
    let ok = false;
    let detail = '';
    if (check.id === 'lineage') {
      const parent = after?.parent ?? null;
      const parentId = typeof parent === 'string' ? parent : parent?.contextId ?? null;
      ok = parentId !== null && (before?.contextId === undefined || parentId === before.contextId);
      detail = ok
        ? `the next context names ${parentId} as its parent${before?.checksum && parent?.checksum ? ` and carries a checksum link` : ''}`
        : before === null
          ? 'no previous context was handed over, so lineage cannot be checked'
          : `the next context does not name ${before?.contextId ?? 'the previous context'} as its parent`;
      if (!ok) missing.push(check.id);
    } else {
      const value = pkg === null ? undefined : pkg[check.requires];
      const present = value !== undefined && value !== null;
      const empty = present && Array.isArray(value) && value.length === 0;
      ok = present;
      detail = !present
        ? `section "${check.requires}" was not carried`
        : empty
          ? `section "${check.requires}" is carried and explicitly empty — "none" is information, not loss`
          : `section "${check.requires}" is carried`;
      if (!ok) missing.push(check.id);
    }
    checks.push(Object.freeze({ id: check.id, question: check.question, ok, detail }));
  }
  const identityOk = checks.find((check) => check.id === 'identity')?.ok === true;
  const lineageOk = checks.find((check) => check.id === 'lineage')?.ok === true;
  const computed = !identityOk || !lineageOk ? 'failed' : missing.length === 0 ? 'verified' : 'degraded';
  let final = computed;
  let reported = null;
  if (result !== null && result !== undefined) {
    if (!VERIFICATION_RESULTS.includes(result)) {
      throw new ContextSessionError(`"${result}" is not one of the three ${publication.published ? 'published' : 'ruled'} verification results (${VERIFICATION_RESULTS.join(', ')}); an unknown result is refused, never mapped to the nearest one`, {
        code: 'frontend.context-session.unknown-verification-result',
        concept: 'continuationVerification',
        value: result,
      });
    }
    // A backend result wins, but the disagreement is reported: a backend that says `verified`
    // while checks are missing is a difference a reconciler must see, not a fact to swallow.
    final = result;
    reported = result === computed ? null : Object.freeze({ reported: result, computed, detail: 'the backend reported a different result than the checks computed; both are shown and neither is silently adopted' });
  }
  const detail = final === 'verified'
    ? 'every continuity check passed: identity, lineage and all carried sections'
    : final === 'degraded'
      ? `the continuation carried over but ${missing.length} check(s) are missing: ${missing.join(', ')} — announced, not hidden, and not repaired here`
      : `continuity did not survive: ${missing.includes('identity') ? 'the package cannot name what it continues' : 'the next context does not prove which context it descended from'}`;
  return Object.freeze({
    result: final,
    published: publication.published,
    decision: publication.decision,
    resultContract: publication.contract,
    results: VERIFICATION_RESULTS,
    checks: Object.freeze(checks),
    missing: Object.freeze([...new Set(missing)]),
    repaired: Object.freeze([]),
    refused: validation?.refused ?? Object.freeze([]),
    reportedDisagreement: reported,
    rule: 'Missing state is reported, never silently repaired. `degraded` is not `failed`, and neither is rendered as `verified`.',
    detail,
  });
}

/**
 * Rehydration, as the UI may represent it: what was restored, what is missing, and which of the
 * three states the result leaves the continuation in. There is no fourth state and no reset — a
 * failed rehydration is surfaced as failed.
 */
export function rehydration({ pkg = null, verification = null } = {}) {
  if (verification === null) {
    return Object.freeze({
      state: 'not-verified',
      restored: Object.freeze([]),
      missing: Object.freeze([]),
      detail: 'no verification result was handed over: rehydration is never assumed to have worked, and an unverified continuation is not rendered as a verified one',
    });
  }
  const validation = pkg === null ? null : validateContinuationPackage(pkg);
  const restored = validation === null ? Object.freeze([]) : Object.freeze([...validation.present]);
  if (verification.result === 'failed') {
    return Object.freeze({
      state: 'continuation-failed',
      restored,
      missing: verification.missing,
      detail: verification.detail,
    });
  }
  if (verification.result === 'degraded') {
    return Object.freeze({
      state: 'continuation-degraded',
      restored,
      missing: verification.missing,
      detail: verification.detail,
    });
  }
  return Object.freeze({
    state: 'continuity-verified',
    restored,
    missing: Object.freeze([]),
    detail: verification.detail,
  });
}

/* -------------------------------------------------------------------- lineage */

/**
 * The previous/next session relationship, from references only.
 *
 * A session names its parent (`parentSessionId`) and a continuation names the session it continues;
 * both are ids. Nothing here infers a relationship from timestamps or from a shared agent, because
 * an inferred lineage is a lineage a reader cannot check.
 */
export function sessionLineage({ session = null, continuation = null, verification = null } = {}) {
  const previousSessionId = session?.parentSessionId ?? continuation?.identity?.previousSessionId ?? null;
  const nextSessionId = session?.nextSessionId ?? continuation?.identity?.nextSessionId ?? null;
  const contextRef = session?.contextRef ?? null;
  const parentContextId = typeof continuation?.sourceContextId === 'string' ? continuation.sourceContextId : null;
  const linked = nextSessionId !== null || parentContextId !== null || (session?.continuation?.linked === true);
  // The verification result may arrive computed (the view passes what it verified) or carried on
  // the envelope (a backend verdict). Either way an unverified link stays `continuation-linked`:
  // a link that was never checked is not announced as verified.
  const result = typeof verification === 'string'
    ? verification
    : verification?.result ?? continuation?.verification?.result ?? null;
  const affordance = !linked
    ? null
    : result === 'verified'
      ? 'continuity-verified'
      : result === 'degraded'
        ? 'continuation-degraded'
        : result === 'failed'
          ? 'continuation-failed'
          : 'continuation-linked';
  return Object.freeze({
    sessionId: session?.sessionId ?? continuation?.identity?.sessionId ?? null,
    previousSessionId,
    nextSessionId,
    contextRef,
    parentContextId,
    linked,
    affordance,
    detail: linked
      ? `continuation linked${previousSessionId ? ` to ${previousSessionId}` : ''}${nextSessionId ? `, next ${nextSessionId}` : ''}`
      : 'no continuation reference was handed over: a session with no link is rendered alone, and no reset is implied',
    rule: 'Lineage is read from references. It is never inferred from time, order or a shared agent.',
  });
}

/* --------------------------------------------------------------- contract state */

/** Normalizes the contract rows handed over (an array, or an object keyed by contract id). */
function rowsOf(contract) {
  if (contract === null || contract === undefined) return [];
  if (Array.isArray(contract)) return contract;
  return Object.entries(contract).map(([id, row]) => (row !== null && typeof row === 'object' ? { id, ...row } : { id, version: row }));
}

/** One contract row, or the honest record of a row that does not exist. */
function contractStateOf(contractId, declaredVersion, rows) {
  const row = rows.find((entry) => (entry.id ?? entry.contract) === contractId) ?? null;
  const declaredIn = contractId === CONTEXT_CONTRACT_ID ? CONTEXT_DECLARATION_SOURCE : SESSION_DECLARATION_SOURCE;
  if (row !== null) {
    const version = typeof row.version === 'string' ? row.version : null;
    return Object.freeze({
      id: contractId,
      version,
      declaredVersion,
      owner: row.owner ?? declaredIn.owner,
      status: row.status ?? 'published',
      domain: row.domain ?? 'ai-foundation',
      published: true,
      comparable: version !== null,
      decision: row.decidedBy ?? CONTEXT_SESSION_DECISION,
      lockedIn: row.lockedIn ?? 'apps/n8n-lego/src/lego/contracts/contract-lock.json',
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
    owner: declaredIn.owner,
    status: 'declared-not-locked',
    domain: 'ai-foundation',
    published: false,
    comparable: false,
    decision: CONTEXT_SESSION_DECISION,
    lockedIn: 'apps/n8n-lego/src/lego/contracts/contract-lock.json',
    agreesWithClaim: false,
    detail: `${contractId} is declared in ${declaredIn.file}#${declaredIn.path} and registered contract-only in the domain registry, and the AI set claims ${contractId}@${declaredVersion} — but no contract-lock row publishes it, so no version is rendered and the surface stays pending (${CONTEXT_SESSION_DECISION})`,
  });
}

/**
 * The canonical unsupported answer, for a surface asked about context or session while the
 * contracts are unlocked or nothing was handed over. A verdict, not an empty object.
 */
export function contextSessionUnsupported(reason = 'no Context & Session declaration was handed over', { declaredVersion = null, contractId = null } = {}) {
  return Object.freeze({
    state: 'capability-unavailable',
    error: 'lego.capability_unavailable',
    reason,
    decision: CONTEXT_SESSION_DECISION,
    contract: Object.freeze({
      id: contractId ?? CONTEXT_CONTRACT_ID,
      version: null,
      declaredVersion,
      published: false,
    }),
    pending: Object.freeze(PENDING_CONTRACT_ROWS.map((row) => Object.freeze({ ...row }))),
    detail: 'no fallback capability, no execution control, no memory store and no token figure is rendered in this state',
  });
}

/* ----------------------------------------------------------------------- drift */

/**
 * The vocabulary-bearing fields of a handed-over declaration, and the quoted set each is compared
 * with. The declaration is a composite of the four backend blocks the application hands over, each
 * keyed by where it comes from: `context` and `agentSession` (from `manifest/ai-foundation.json`),
 * `lego` (from `manifest/ai-lego-set.json#lego[id=context-session]`) and `capabilities` (from
 * `manifest/domains.json`). A block that is absent says nothing and is not drift.
 */
export const DRIFT_FIELDS = Object.freeze([
  Object.freeze({ block: 'context', field: 'scopes', set: 'contextScope' }),
  Object.freeze({ block: 'context', field: 'fields', set: 'contextField' }),
  Object.freeze({ block: 'agentSession', field: 'states', set: 'agentSessionState' }),
  Object.freeze({ block: 'agentSession', field: 'fields', set: 'agentSessionField' }),
  Object.freeze({ block: 'agentSession', field: 'references', set: 'agentSessionReference' }),
  Object.freeze({ block: 'lego', field: 'lifecycle', set: 'contextLifecycle' }),
  Object.freeze({ block: 'lego', field: 'continuationPackage', set: 'continuationSection' }),
  Object.freeze({ block: 'lego', field: 'operations', set: 'contextOperationVerb' }),
  Object.freeze({ block: 'lego', field: 'scopes', set: 'contextScope' }),
  Object.freeze({ block: 'scenario', field: 'tokenKinds', set: 'tokenKind', read: 'keys' }),
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

/**
 * Compares a handed-over declaration with the vocabulary this package quotes, and reports the
 * difference instead of resolving it.
 *
 * States: `not-declared` (nothing handed over), `in-sync` (every present block agrees),
 * `drift` (a difference, named in both directions), and `publication-pending` — reported through
 * `pending`, which lists the vocabulary and the contract rows this surface is still waiting for.
 * `uncomparable` names what cannot be compared (a claimed version with no lock row), so silence is
 * never mistaken for agreement.
 */
export function declarationDrift({ declaration = null, surface = null, contract = null } = {}) {
  const rows = rowsOf(contract ?? surface?.publication?.rows ?? null);
  const owner = surface?.declarationSource?.owner ?? CONTEXT_DECLARATION_SOURCE.owner;
  const decision = surface?.alignment?.decision ?? CONTEXT_SESSION_DECISION;
  const rule = 'A difference is reported and registered, never resolved locally: the surface keeps rendering the words it quotes, names the words it was handed, and the reconciliation decides which set is canonical.';
  const pending = Object.freeze([
    ...PENDING_PUBLICATIONS.map((entry) => Object.freeze({ kind: 'vocabulary', id: entry.id, expectedValues: entry.expectedValues, decision: entry.publicationPending.decision })),
    ...PENDING_CONTRACT_ROWS.filter((row) => rows.find((candidate) => (candidate.id ?? candidate.contract) === row.contract) === undefined)
      .map((row) => Object.freeze({ kind: 'contract-row', id: row.contract, declaredVersion: row.declaredVersion, decision: row.decision, publishedOn: row.publishedOn ?? null })),
  ]);
  // Promotions are not pending work: they are evidence that a word the frontend refused to coin was
  // published, by whom and at which commit. They ride next to `pending` so a drift report shows
  // both halves of the publication story.
  const promoted = Object.freeze(PROMOTED_PUBLICATIONS.map((entry) => Object.freeze({
    kind: 'promoted-vocabulary',
    id: entry.id,
    values: entry.publishedValues,
    identicalToRuling: entry.identical,
    publishedBy: entry.publishedBy,
    lockRow: entry.publishedAs.lockRow,
    symbol: entry.publishedAs.symbol,
    decision: entry.decision,
  })));
  const uncomparable = Object.freeze(PENDING_CONTRACT_ROWS
    .filter((row) => rows.find((candidate) => (candidate.id ?? candidate.contract) === row.contract) === undefined)
    .map((row) => `${row.contract} version (claimed ${row.declaredVersion}, no lock row)`));
  if (declaration === null || declaration === undefined) {
    return Object.freeze({ state: 'not-declared', differences: Object.freeze([]), compared: Object.freeze([]), pending, promoted, uncomparable, owner, decision, rule });
  }
  const differences = [];
  const compared = [];
  for (const { block, field, set, read } of DRIFT_FIELDS) {
    const source = declaration[block];
    if (source === null || source === undefined) continue;
    const entries = Array.isArray(source) && block === 'capabilities' ? null : source;
    if (entries === null) continue;
    const raw = entries[field];
    // Absence is not a move: a block that does not carry the field says nothing about it.
    if (raw === undefined) continue;
    const quoted = vocabularyOf(set).values;
    const declared = raw === null ? [] : read === 'keys' ? Object.keys(raw) : asArray(raw);
    compared.push(`${block}.${field}`);
    const difference = driftOf(block, field, quoted, declared);
    if (difference !== null) differences.push(difference);
  }
  // The registry half: which operations the capabilities actually publish, against the quote.
  const capabilities = asArray(declaration.capabilities);
  for (const capability of capabilities) {
    const id = capability?.id;
    if (id !== CONTEXT_CONTRACT_ID && id !== SESSION_CONTRACT_ID) continue;
    const declaredNames = asArray(capability.operations).map((operation) => (typeof operation === 'string' ? operation : operation?.name)).filter((name) => typeof name === 'string');
    const quoted = id === CONTEXT_CONTRACT_ID ? CONTEXT_OPERATIONS : SESSION_OPERATIONS;
    compared.push(`capabilities[id=${id}].operations`);
    const difference = driftOf('capabilities', `[id=${id}].operations`, quoted, declaredNames);
    if (difference !== null) differences.push(difference);
    const declaredPermissions = asArray(capability.permissions).filter((permission) => typeof permission === 'string');
    const quotedPermissions = id === CONTEXT_CONTRACT_ID ? CONTEXT_PERMISSIONS : SESSION_PERMISSIONS;
    compared.push(`capabilities[id=${id}].permissions`);
    const permissionDifference = driftOf('capabilities', `[id=${id}].permissions`, quotedPermissions, declaredPermissions);
    if (permissionDifference !== null) differences.push(permissionDifference);
  }
  // The version claim: `ai.context@1.0.0, ai.agent-session@1.0.0` against the rows handed over.
  const claim = declaration.lego?.versioning;
  if (typeof claim === 'string') {
    compared.push('lego.versioning');
    for (const row of PENDING_CONTRACT_ROWS) {
      const locked = rows.find((candidate) => (candidate.id ?? candidate.contract) === row.contract) ?? null;
      const claimsRow = claim.includes(`${row.contract}@${row.declaredVersion}`);
      if (locked === null && !claimsRow) {
        differences.push(Object.freeze({
          block: 'lego',
          field: 'versioning',
          quoted: Object.freeze([`${row.contract}@${row.declaredVersion} (claimed, unlocked)`]),
          declared: Object.freeze([claim]),
          added: Object.freeze([]),
          removed: Object.freeze([`${row.contract}@${row.declaredVersion}`]),
        }));
      }
      if (locked !== null && typeof locked.version === 'string' && locked.version !== row.declaredVersion) {
        differences.push(Object.freeze({
          block: 'lego',
          field: 'versioning',
          quoted: Object.freeze([`${row.contract}@${locked.version} (locked)`]),
          declared: Object.freeze([claim]),
          added: Object.freeze([`${row.contract}@${locked.version}`]),
          removed: Object.freeze([`${row.contract}@${row.declaredVersion}`]),
        }));
      }
    }
  }
  return Object.freeze({
    state: differences.length === 0 ? (compared.length === 0 ? 'not-declared' : 'in-sync') : 'drift',
    differences: Object.freeze(differences),
    compared: Object.freeze(compared),
    pending,
    uncomparable,
    owner,
    decision,
    rule,
  });
}

/* ------------------------------------------------------------------- the view */

/**
 * Builds the view the UI renders: session identity and state, context scope and lifecycle, usage,
 * rollover, continuation, verification, lineage, and the publication state of both contracts.
 *
 * Everything is derived from what was handed over. Nothing is fetched, nothing is inferred, and
 * every absence has a name.
 *
 * @param {{
 *   surface?: object|null,        the frontend surface declaration (manifest/context-session.json)
 *   declaration?: object|null,    the composite backend declaration { context, agentSession, lego, capabilities, scenario }
 *   contract?: object[]|object|null,  published contract-lock rows, when any exist
 *   context?: object|null,        one context record
 *   session?: object|null,        one session record
 *   continuation?: object|null,   one continuation package (may carry `verification`)
 *   usage?: object|null,          one reported usage figure { kind, used, budget?, unit, source }
 *   threshold?: number|null,      the declared rollover threshold, as a fraction of the bound
 * }} input
 */
/**
 * The publication state of the pair, on its own.
 *
 * This is the cheap half of the view: two contract rows and one boolean, with no lifecycle tables,
 * no affordance prose and no validation. `createFrontendLego().describe()` reports publication
 * through it, so the boot path never materialises a surface nobody rendered — the Context & Session
 * view is not part of the boot descriptor, and the descriptor's assembly budget is measured.
 */
export function contextSessionPublication({ surface = null, contract = null } = {}) {
  const rows = rowsOf(contract ?? surface?.publication?.rows ?? null);
  const context = contractStateOf(CONTEXT_CONTRACT_ID, CONTEXT_DECLARED_VERSION, rows);
  const session = contractStateOf(SESSION_CONTRACT_ID, SESSION_DECLARED_VERSION, rows);
  /**
   * Whether the tree this surface is handed also publishes Memory. It is **not** part of this
   * surface's publication: Memory is a different LEGO with a different contract, and P2.13 cannot
   * become P2.14 by borrowing a row. It is read for one reason only — so the memory concept can say
   * whether a store exists in this tree instead of asserting that none does anywhere.
   */
  const memoryRow = rows.find((entry) => (entry.id ?? entry.contract) === MEMORY_CONTRACT_ID) ?? null;
  return Object.freeze({
    published: context.published && session.published,
    context,
    session,
    memoryPublished: memoryRow !== null,
    memoryRow: memoryRow === null ? null : Object.freeze({ id: MEMORY_CONTRACT_ID, version: memoryRow.version ?? null, status: memoryRow.status ?? 'published' }),
    rows: Object.freeze(rows),
  });
}

export function createContextSessionView({
  surface = null,
  declaration = null,
  contract = null,
  context = null,
  session = null,
  continuation = null,
  usage = null,
  threshold = null,
} = {}) {
  const publication = contextSessionPublication({ surface, contract });
  const contextContract = publication.context;
  const sessionContract = publication.session;
  const published = publication.published;

  const contextValidation = context === null ? null : validateContextRecord(context);
  const sessionValidation = session === null ? null : validateSessionRecord(session);
  // The handed-over continuation is a package inside an envelope: the envelope fields name the
  // window it came from, the window it produced and the backend's own verdict, and are not package
  // sections. Validation and verification both look at the package, and the envelope drives the
  // lineage and the reported result.
  const continuationValidation = continuation === null ? null : validateContinuationPackage(continuation);
  const usageReport = contextUsage(usage);
  // The phase expectation is computed from the reported figure and the lifecycle state the record
  // carries. It is an expectation: the transition itself is the backend's.
  const rollover = expectedRolloverPhase({ usage, threshold, lifecycleState: context?.lifecycle ?? null });
  const verification = continuation === null
    ? null
    : continuityVerification({
      pkg: continuation,
      before: context ?? null,
      after: continuation?.target ?? null,
      result: continuation?.verification?.result ?? null,
    });
  const rehydrated = continuation === null ? null : rehydration({ pkg: continuation, verification });
  const lineage = sessionLineage({ session, continuation, verification });

  const findings = [
    ...(contextValidation?.findings ?? []),
    ...(sessionValidation?.findings ?? []),
    ...(continuationValidation?.findings ?? []),
  ];
  const refused = Object.freeze([
    ...(contextValidation?.refused ?? []),
    ...(sessionValidation?.refused ?? []),
    ...(continuationValidation?.refused ?? []),
  ]);

  // A refusal is a fact about what was handed over, and it is named in the availability detail
  // rather than buried: the reader of a state must be able to see why the state is not rendered.
  const refusalNote = refused.length === 0
    ? ''
    : `; ${refused.length} handed-over ${refused.length === 1 ? 'field was' : 'fields were'} refused (${refused.map((entry) => entry.key).join(', ')})`;
  const availability = !published && declaration === null
    ? Object.freeze({ availability: 'capability-unavailable', detail: `${contextContract.detail}; nothing was declared${refusalNote === '' ? ', so no state is rendered' : refusalNote}` })
    : !published
      ? Object.freeze({ availability: 'optional-absent', detail: `the declarations were handed over and both contracts are still unlocked: the surface renders what was declared and names the publication it waits for${refusalNote}` })
      : findings.length > 0
        ? Object.freeze({ availability: 'degraded', detail: `the contracts are published but a handed-over record is refused: ${findings[0]}${refusalNote}` })
        : Object.freeze({ availability: 'available', detail: 'both contracts are published and every handed-over record validated' });

  return Object.freeze({
    contracts: Object.freeze({ context: contextContract, session: sessionContract }),
    published,
    availability: availability.availability,
    availabilityDetail: availability.detail,
    unsupported: published ? null : contextSessionUnsupported(availability.detail, {
      declaredVersion: CONTEXT_DECLARED_VERSION,
      contractId: CONTEXT_CONTRACT_ID,
    }),
    drift: declarationDrift({ declaration, surface, contract: publication.rows.length > 0 ? publication.rows : null }),
    /**
     * The five concepts, with what exists behind each. Memory's row is DERIVED from the lock rows
     * handed over (P2.14): `implemented` when the tree publishes `ai.memory`, `false` when it does
     * not — because a surface that kept saying "no store exists" against a tree that publishes one
     * would be lying in the other direction.
     */
    concepts: distinctConcepts({ memoryPublished: publication.memoryPublished }),
    /** What the tree publishes about Memory, read for the concept above and rendered nowhere. */
    memoryPublication: Object.freeze({
      published: publication.memoryPublished,
      row: publication.memoryRow,
      detail: publication.memoryPublished
        ? 'this tree publishes an `ai.memory` contract row: the store exists, it belongs to another LEGO, and this surface renders none of it'
        : 'this tree publishes no `ai.memory` contract row: no store is published here, and what may be counted is loaded context, decisions and artifacts (XA-12)',
    }),
    session: Object.freeze({
      record: session,
      validation: sessionValidation,
      state: session === null ? null : sessionState(session.status),
      states: sessionLifecycle(),
      lineage,
      withheld: Object.freeze(SESSION_FIELDS.filter((field) => session !== null && (session[field] === undefined || session[field] === null))),
    }),
    context: Object.freeze({
      record: context,
      validation: contextValidation,
      scope: context === null ? null : contextScope(context.scope),
      scopes: scopeLadder(),
      lifecycle: context === null ? null : contextLifecycleState(context.lifecycle ?? 'declared'),
      lifecycles: contextLifecycle(),
      usage: usageReport,
    }),
    rollover,
    continuation: Object.freeze({
      record: continuation,
      validation: continuationValidation,
      sections: CONTINUATION_SECTIONS,
      present: continuationValidation?.present ?? Object.freeze([]),
      missing: continuationValidation?.missing ?? Object.freeze([]),
      verification,
      rehydration: rehydrated,
      affordances: CONTINUATION_AFFORDANCES,
    }),
    operations: Object.freeze({
      published: PUBLISHED_OPERATION_IDS,
      contextVerbs: CONTEXT_DECLARED_VERBS,
      unpublishedVerbs: UNPUBLISHED_CONTEXT_VERBS,
      offered: Object.freeze([]),
      rule: UNPUBLISHED_CONTEXT_VERBS.length === 0
        ? `The UI may name a published operation; it may not offer one. Nothing here calls ${PUBLISHED_OPERATION_IDS.join(', ')} — every declared verb is registered, and an operation nobody wired stays unwired.`
        : `The UI may name a published operation; it may not offer one. Nothing here calls ${PUBLISHED_OPERATION_IDS.join(', ')}, and the declared-but-unregistered verbs (${UNPUBLISHED_CONTEXT_VERBS.join(', ')}) are answered operation-unpublished.`,
    }),
    permissions: Object.freeze({ context: CONTEXT_PERMISSIONS, session: SESSION_PERMISSIONS, grants: null }),
    pending: Object.freeze(PENDING_PUBLICATIONS.map((entry) => Object.freeze({
      id: entry.id,
      expectedValues: entry.expectedValues,
      decidedBy: entry.decidedBy,
      decision: entry.publicationPending.decision,
      partlyPublishedBy: entry.partlyPublishedBy ?? null,
    }))),
    promoted: Object.freeze(PROMOTED_PUBLICATIONS.map((entry) => Object.freeze({
      id: entry.id,
      values: entry.publishedValues,
      identicalToRuling: entry.identical,
      publishedBy: entry.publishedBy,
      publishedAs: entry.publishedAs,
      quotedAs: entry.quotedAs,
      decision: entry.decision,
    }))),
    refused,
    findings: Object.freeze(findings),
    affordances: CONTEXT_SESSION_AFFORDANCES,
    forbiddenFields: FORBIDDEN_FIELDS,
    forbiddenImplications: FORBIDDEN_IMPLICATIONS,
    declaration,
    declarationSources: Object.freeze({
      context: CONTEXT_DECLARATION_SOURCE,
      session: SESSION_DECLARATION_SOURCE,
      lego: LEGO_DECLARATION_SOURCE,
      capabilities: CAPABILITY_DECLARATION_SOURCE,
    }),
    quote: Object.freeze(CONTEXT_SESSION_QUOTED_VOCABULARIES.map(quotedSet)),
    rule: 'Context is what is loaded now; a session is bounded state; memory is what survives replacement and does not exist yet; execution belongs to another domain. This surface renders those four facts and names the fifth as absent — it never merges them, never fabricates a number and never offers an execution.',
  });
}

/** The surface as data: what it renders, over which quoted words, and with which provenance. */
export function describeContextSession() {
  return Object.freeze({
    lego: CONTEXT_SESSION_LEGO_ID,
    contracts: Object.freeze({
      context: Object.freeze({ id: CONTEXT_CONTRACT_ID, declaredVersion: CONTEXT_DECLARED_VERSION, publishedVersion: null, decision: CONTEXT_SESSION_DECISION }),
      session: Object.freeze({ id: SESSION_CONTRACT_ID, declaredVersion: SESSION_DECLARED_VERSION, publishedVersion: null, decision: CONTEXT_SESSION_DECISION }),
    }),
    pendingContractRows: PENDING_CONTRACT_ROWS,
    scopes: CONTEXT_SCOPES,
    contextFields: CONTEXT_FIELDS,
    contextLifecycle: CONTEXT_LIFECYCLE,
    continuationSections: CONTINUATION_SECTIONS,
    declaredVerbs: CONTEXT_DECLARED_VERBS,
    publishedOperations: PUBLISHED_OPERATION_IDS,
    unpublishedVerbs: UNPUBLISHED_CONTEXT_VERBS,
    sessionStates: SESSION_STATES,
    sessionFields: SESSION_FIELDS,
    sessionReferences: SESSION_REFERENCES,
    sessionOperations: SESSION_OPERATIONS,
    terminalSessionStates: SESSION_TERMINAL_STATES,
    rolloverLifecycleStates: ROLLOVER_LIFECYCLE_STATES,
    permissions: Object.freeze({ context: CONTEXT_PERMISSIONS, session: SESSION_PERMISSIONS }),
    tokenKinds: TOKEN_KINDS,
    usageStates: USAGE_REPORT_STATES,
    concepts: DISTINCT_CONCEPTS,
    continuationAffordances: CONTINUATION_AFFORDANCES,
    continuityChecks: CONTINUITY_CHECKS,
    verificationResults: VERIFICATION_RESULTS,
    rolloverPhases: ROLLOVER_PHASES,
    verificationPublication: VERIFICATION_PUBLICATION,
    phasePublication: PHASE_PUBLICATION,
    forbiddenFields: FORBIDDEN_FIELDS,
    forbiddenImplications: FORBIDDEN_IMPLICATIONS,
    affordances: CONTEXT_SESSION_AFFORDANCES,
    driftFields: Object.freeze(DRIFT_FIELDS.map((entry) => `${entry.block}.${entry.field}`)),
    quoted: CONTEXT_SESSION_QUOTED_VOCABULARIES,
    sources: Object.freeze({
      context: CONTEXT_DECLARATION_SOURCE,
      session: SESSION_DECLARATION_SOURCE,
      lego: LEGO_DECLARATION_SOURCE,
      capabilities: CAPABILITY_DECLARATION_SOURCE,
    }),
    rule: 'Five distinct things, ten quoted sets, five published operations, no fabricated number, no memory store, no execution affordance — and a publication gap that is rendered instead of hidden.',
  });
}
