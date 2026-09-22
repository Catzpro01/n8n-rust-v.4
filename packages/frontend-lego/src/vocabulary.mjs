/**
 * The shared vocabulary lock — one word, one meaning, on both sides of the seam.
 *
 * The frontend and the backend LEGO foundation are separate packages with separate
 * owners, and they speak about the same things: why a capability cannot serve, what
 * lifecycle it is in, what kind of version move happened, which interaction class an
 * operation is. Two dialects for those questions is exactly the failure this phase
 * exists to prevent, so this module **pins** the vocabulary the backend foundation
 * already publishes, with provenance, and refuses anything that is not in it.
 *
 * Three rules, machine-checkable:
 *
 *   1. A **shared** concept is quoted, never re-invented. `VOCABULARIES` records the
 *      contract that owns it, its version and the file the values were read from, so
 *      a reviewer can check the quote instead of trusting it.
 *   2. A **frontend-local** concept is declared as such (`mapsTo`) and, when it says
 *      something about a shared concept, it must map *totally* into it. A local word
 *      that duplicates a shared one is a conflict, not a synonym.
 *   3. An extra word is **declared with its reason** (`extra`). A vocabulary that
 *      quietly grows an undeclared term fails `vocabularyConflicts()`.
 *
 * Nothing here executes, reads disk or knows a transport. It is data plus three pure
 * functions, so an agent (or a test) can answer "is this still the same vocabulary?"
 * without reading either implementation.
 *
 * Framework-neutral and browser-safe: no framework import, no `node:*` import.
 */

/**
 * The backend foundation this lock quotes, so a drift report can say where to look.
 *
 * P2.13 reconciliation re-read the tree at the **current** protected baseline: `main` @ `efa3da35`
 * is the merge of agent-2's `arena/01a0c6b5-n8n-rust-v-4` work (PR #45, "Agent 2 P2.13 Context &
 * Session backend"), so the quote names `main` and the commit the tree actually came from. The
 * earlier quotes are historical evidence and are **not** rewritten: `e754c5df` (P2.12, PR #44) is the
 * baseline both agents started from, `fb254f32` is where agent-2's publication was first read while it
 * was still peer-branch-only, and `6f7b66da` (P2.10) is the quote before that. Rows recorded against
 * them in `docs/n8n-lego/decisions/cross-agent-decisions.json` keep naming them.
 */
export const QUOTED_FROM = Object.freeze({
  repository: 'Catzpro01/n8n-rust-v.4',
  branch: 'main',
  commit: '67e638ef',
  mergedInto: '67e638ef83028bbc69876e2e768181415c7554fa',
  phase: 'P2.14',
  readOn: '2026-09-22',
  readFor: 'P2.14 — Memory: quoting ai.memory@1.0.0 (agent-2 branch, `f11aee01`) and re-verifying every P2.13 quote against the protected-main baseline `67e638ef`, which is the merge of PR #46 (P2.13 Context & Session frontend)',
  /**
   * The publication this lock consumes is **on protected main**.
   *
   * Agent-2 published both contract-lock rows, the five registry operations and the contract surface
   * module on `arena/01a0c6b5-n8n-rust-v-4` (first read at `fb254f32`, finalised at `dd6f889c`), and
   * the Manager merged that branch as PR #45 → `main` @ `efa3da35`. Protected main therefore publishes
   * 17 lock rows including both contracts, and every set below is verifiable against this branch's own
   * backend copy: `test/29-alignment.test.mjs` compares them against the tree it is pointed at, which
   * is now the same tree the lock quotes.
   *
   * One divergence this lock used to carry is **closed by that merge**: agent-2's `fa18ba76` moved
   * `ai-lego-set.json#lego[id=context-session].continuationPackage` to the canonical
   * `toolStateReferences` / `importantReferences`, so the manifest and the locked contract now spell
   * all fourteen sections identically. The record of what differed, and of the commit that closed it,
   * is kept at `VOCABULARIES#continuationSection.divergenceClosed` — a closed divergence is evidence,
   * not something to delete silently.
   */
  publication: Object.freeze({
    branch: 'arena/01a0c6b5-n8n-rust-v-4',
    commit: 'fb254f32',
    finalCommit: 'dd6f889c',
    owner: 'agent-2',
    lockRows: Object.freeze(['ai.context@1.0.0', 'ai.agent-session@1.0.0']),
    lockedContractCount: 17,
    surfaceModule: 'apps/n8n-lego/src/lego/context-session.mjs',
    publicModules: Object.freeze(['apps/n8n-lego/src/lego/context.mjs', 'apps/n8n-lego/src/lego/agent-session.mjs']),
    visibleOn: 'github',
    onProtectedMain: true,
    mergedInto: Object.freeze({ branch: 'main', commit: 'efa3da35', pullRequest: 45, mergedBy: 'manager' }),
    backendCorrection: Object.freeze({ commit: 'fa18ba76', what: 'continuation manifest vocabulary moved to the canonical toolStateReferences / importantReferences; session close made executable for completed/failed/cancelled' }),
  }),
  protectedMain: Object.freeze({
    branch: 'main',
    commit: 'efa3da35',
    phase: 'P2.13',
    lockedContractCount: 17,
    note: 'protected main publishes both ai.context@1.0.0 and ai.agent-session@1.0.0 (status implemented, owner manager, domain ai-foundation), so the surface reports published from the rows it is handed — and it publishes NO ai.memory row, so the Memory surface reports declared-not-locked against it',
  }),
  /**
   * The P2.14 publication: `ai.memory@1.0.0`. **Not on protected main yet.**
   *
   * Agent-2 published the bounded Memory contract on `arena/01a0c90d-n8n-rust-v-4` @ `f11aee01`:
   * one contract-lock row (`ai.memory@1.0.0`, owner `manager`, domain `ai-foundation`, status
   * `implemented`), the `ai.memory` capability with four operations in `manifest/domains.json`,
   * the canonical manifest `manifest/memory.json` and the surface module `src/lego/memory.mjs`.
   *
   * The lock quotes that publication — a peer's published change is not an assumption this branch
   * may keep ignoring — but the quote is **bounded by a comparison**: `test/29-alignment.test.mjs`
   * compares the memory sets only against a tree that publishes the row, and against protected main
   * @ `67e638ef` it announces the non-comparison instead of reporting a pass it did not perform.
   * `protectedMain` below stays the P2.13 statement because that is what protected main publishes
   * today; when the manager merges the branch, the rows move there and the comparison runs against
   * the default tree with no edit to this package.
   */
  memoryPublication: Object.freeze({
    agent: 'agent-2',
    branch: 'arena/01a0c90d-n8n-rust-v-4',
    commit: 'f11aee01',
    backendCommit: '5fbaf934',
    reportCommit: 'f11aee01',
    /**
     * The peer branch moved after this lock read it, and the move is recorded rather than ignored.
     * `2dcd8570` added doc-coupling tests only — `apps/n8n-lego/test/lego-memory.test.mjs`,
     * `packages/frontend-lego/test/34-memory.test.mjs` and an `XA-12` `arbiter` string in the
     * decision register. The contract files this lock quotes were **not touched**, so the quote
     * stands at both commits; `commit` above stays the commit the words were read from, because a
     * provenance entry records where a value came from, not where the branch happens to be now.
     */
    tip: '2dcd8570',
    tipReadAt: '2026-09-22',
    tipChange: 'doc-coupling tests + XA-12 arbiter text; no contract file, no lock row, no manifest value changed',
    lockRows: Object.freeze(['ai.memory@1.0.0']),
    lockedContractCount: 18,
    contractManifest: 'apps/n8n-lego/src/lego/manifest/memory.json',
    surfaceModule: 'apps/n8n-lego/src/lego/memory.mjs',
    registry: 'apps/n8n-lego/src/lego/manifest/domains.json#id=ai-foundation.capabilities[id=ai.memory]',
    aiSet: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json#lego[id=memory]',
    operations: Object.freeze(['memory.remember', 'memory.recall', 'memory.list', 'memory.forget']),
    permissions: Object.freeze(['ai:memory:read', 'ai:memory:write']),
    visibleOn: 'github',
    onProtectedMain: false,
    mergedInto: null,
    /**
     * One file is added by **both** branches at the same path, and the reconciler has to know it
     * before the merge does: this branch's `test/34` is the frontend suite (the rule A29
     * `enforcedBy`, 26 tests), the peer's is a five-test doc-coupling check written from the backend
     * side. Neither is wrong; they are two views of one coupling, and the frontend file is the one
     * that owns A29. Recorded here because a same-path add is silent until it conflicts.
     */
    collision: Object.freeze({
      path: 'packages/frontend-lego/test/34-memory.test.mjs',
      thisBranch: '26 tests — the Memory surface suite, A29 enforcedBy, quotes nine sets and exercises the states',
      peerBranch: '5 tests — backend-side doc coupling (manifest ↔ lock ↔ .ai matrix ↔ evidence report)',
      rule: 'the frontend path stays the frontend suite; the peer checks worth keeping (the generated `.ai` matrix must agree with the tree lock, the product manifest must mark Memory implemented) are already asserted here against the tree being tested',
    }),
    note: 'Bounded Memory: remember/recall/list/forget only. The provider boundary (MemoryProvider, InMemoryProvider default) is the persistence boundary and is replaceable; no vector search, no embedding, no model or provider dependency. Traversal (`traverse`) and explicit edge creation (`relate`) are future stages, not P2.14 operations — the AI set declared five verbs before this publication and now declares the four that exist.',
  }),
  protectedMainBaseline: Object.freeze({
    branch: 'main',
    commit: 'e754c5df',
    phase: 'P2.12',
    lockedContractCount: 15,
    status: 'historical',
    note: 'the baseline both P2.13 agents started from: protected main published no ai.context or ai.agent-session row, so the frontend failed closed against that tree and reported declared-not-locked. Kept because evidence rows recorded against it name it',
  }),
  p214Baseline: Object.freeze({
    branch: 'main',
    commit: '67e638ef',
    full: '67e638ef83028bbc69876e2e768181415c7554fa',
    phase: 'P2.13 (merged)',
    lockedContractCount: 17,
    status: 'current',
    note: 'the protected-main baseline both P2.14 agents started from: PR #46 (Agent 1 Context & Session frontend) merged on top of PR #45. It carries P2.13 in full and no ai.memory row',
  }),
  previousQuote: Object.freeze({ branch: 'arena/01a0c521-n8n-rust-v-4', commit: '6f7b66da', phase: 'P2.10', status: 'historical' }),
});


/**
 * `apps/n8n-lego/src/lego/manifest/foundation.json` is read by the backend modules
 * (`foundation.mjs`, `envelope.mjs`), by two tools and by the registry itself
 * (`domains.json` -> `foundation.vocabulary`), and it is inside the public paths of the
 * manager-owned `lego-foundation` domain — but **no contract-lock row publishes it**, so
 * its vocabulary has no pinned contract version. That is not something the frontend may
 * quietly resolve: every set quoted from it carries this record, and `XA-9` in
 * `docs/n8n-lego/decisions/cross-agent-decisions.json` asks the manager to publish it.
 */
const FOUNDATION_MANIFEST_PUBLICATION = Object.freeze({
  owner: 'manager',
  domain: 'lego-foundation',
  decision: 'XA-9',
  what: 'manifest/foundation.json is declared public by the lego-foundation domain and named by domains.json -> foundation.vocabulary, but no contract-lock row publishes it, so these values have no pinned contract version',
});

/**
 * `ai.skill@1.0.0` — published. The Skill contract is locked in
 * `apps/n8n-lego/src/lego/contracts/contract-lock.json` (owner `manager`, domain
 * `ai-foundation`, status `implemented`) after `XA-19` was resolved in the P2.12 finalize by
 * adopting the *implemented* shape: four published operations (`skill.list`, `skill.resolve`,
 * `skill.describe`, `skill.validate-selection`), the six-state lifecycle, the four disclosure
 * levels and the two `ai:skill:*` permission words. `register`, `select`, `load` and `release`
 * are internal registry lifecycle methods and are **not** published caller operations, and no
 * name anywhere in the contract implies execution. So the four Skill sets below are quoted
 * with a pinned contract version instead of the `publicationPending` record they used to
 * carry — and the pin is checked against the lock row, not against the string (`test/29`).
 */
const AI_SKILL_CONTRACT = Object.freeze({ id: 'ai.skill', version: '1.0.0', owner: 'manager' });

/**
 * `ai.memory@1.0.0` — published by agent-2 on its P2.14 branch, **not yet on protected main**.
 *
 * The bounded Memory contract is locked in `apps/n8n-lego/src/lego/contracts/contract-lock.json`
 * (owner `manager`, domain `ai-foundation`, status `implemented`) with the canonical manifest
 * `manifest/memory.json` and the surface module `src/lego/memory.mjs`. Five scopes, six kinds,
 * five retentions, thirteen fields, a two-state lifecycle (`active` -> `forgotten`), four published
 * operations and two permission words. The nine Memory sets below quote that publication with a
 * pinned contract version, exactly the way the Skill sets quote `ai.skill@1.0.0` and the Context &
 * Session sets quote `ai.context@1.0.0` — and the pin is checked against the lock row, not against
 * the string (`test/29-alignment.test.mjs`), which is why a tree that carries no `ai.memory` row is
 * reported as an announced non-comparison rather than as agreement.
 *
 * What is **not** quoted, on purpose: `memory.json#interaction` (`call`, `batch`) and
 * `memory.json#degradation` (`available`, `degraded`, `optional-absent`) duplicate the canonical
 * `lego.interaction` sets, so the Memory surface references `interaction` and `degradation`
 * instead of declaring a second set with the same meaning under a second id.
 */
const AI_MEMORY_CONTRACT = Object.freeze({ id: 'ai.memory', version: '1.0.0', owner: 'manager' });

/**
 * What the Memory publication owes and settles, recorded where a reader of the lock will find it.
 *
 * Two things this record is deliberately **not**: it is not a publication source (nothing derives
 * `published` from it — that comes from the lock rows a tree actually hands over), and it is not a
 * claim that P2.14 is complete. It is the provenance of the quote plus the honest half
 * `memory.json` itself carries: `traverse`, `relate`, relevance-ranked retrieval and automatic
 * retention enforcement are future stages, and `XA-12` stays open-for-manager for exactly those.
 */
const AI_MEMORY_PUBLICATION = Object.freeze({
  owner: 'manager',
  domain: 'ai-foundation',
  decision: 'XA-12',
  what: 'P2.14 bounded Memory: ai.memory@1.0.0 is locked with four operations (memory.remember, memory.recall, memory.list, memory.forget) and two permission words (ai:memory:read, ai:memory:write). The deferred half — relevance-ranked traversal, explicit edge creation (`relate`) and retention-policy enforcement — stays a future stage and is recorded by XA-12, which remains open-for-manager',
});

/**
 * What is still unpublished on this side: the AI set's own maturity words. Locking
 * `ai.skill` settles the Skill *contract*; it does not decide where Skill is modelled, and
 * `manifest/ai-lego-set.json` is still named by no domain in `domains.json` and published by
 * no contract-lock row, so its `statusVocabulary` has no pinned contract version. That is the
 * remaining half of `XA-11` ("is a skill a backend concept at all, and under which domain?"),
 * and `ai.skill` was declared inside the existing `ai-foundation` domain precisely so a later
 * ruling moves a contract rather than deletes a domain.
 */
const AI_SET_STATUS_PUBLICATION = Object.freeze({
  owner: 'manager',
  domain: 'ai-lego-set',
  decision: 'XA-11',
  what: 'manifest/ai-lego-set.json spells maturity with six words (agent-2 added `in-progress` at P2.13), but the file is named by no domain in domains.json and no contract-lock row publishes the AI set, so its statusVocabulary has no pinned contract version — `ai.skill@1.0.0` is locked, and whether Skill stays modelled under ai-foundation is the open half of XA-11',
});

/**
 * What P2.13 (Context & Session) owed the frontend — **settled by publication**.
 *
 * At the P2.13 start baseline (`e754c5df`) `ai.context` and `ai.agent-session` were declared in
 * `manifest/ai-foundation.json` and registered `contract-only` in `manifest/domains.json`, while
 * `contracts/contract-lock.json` published no row for either, and no backend declaration published the
 * rollover phases, the continuation sections or the continuity verification results. Two word lists
 * were therefore kept out of `VOCABULARIES` in `PENDING_PUBLICATIONS` rather than coined locally.
 *
 * Agent-2 published all of it (`fb254f32`, finalised `dd6f889c`, merged by the Manager as PR #45 →
 * `main` @ `efa3da35`): both word lists were promoted into `VOCABULARIES` with contract pins, and
 * `PROMOTED_PUBLICATIONS` records the promotion together with the fact that the published values are
 * identical to the values the manager ruled. `PENDING_PUBLICATIONS` is empty. `XA-20` stays open — the
 * manager still owns publication/locking semantics, and a worker does not close a manager-owned
 * decision by having been proved right.
 */
/**
 * The Context & Session block of the AI set: `manifest/ai-lego-set.json#lego[id=context-session]`
 * publishes the six-state context lifecycle, the fourteen continuation-package sections, the
 * rollover rule and five operation verbs (`load`, `compact`, `rollover`, `rehydrate`, `verify`) —
 * and no contract-lock row publishes that file (`XA-11` records the same fact for its
 * `statusVocabulary`). So these sets are quoted with a pending record rather than assigned to
 * `ai.foundation@1.0.0`, which publishes the *shapes* in `ai-foundation.json` but not these words.
 *
 * The asymmetry this note used to record is **closed**: at the P2.13 start baseline the AI set
 * declared five verbs while the registry published two operations, so `rollover`, `rehydrate` and
 * `verify` were rendered `operation-unpublished`. Protected main @ `efa3da35` registers all five as
 * operations of `ai.context` (`status: implemented`), so all five are quoted in `contextOperation`
 * with a registry pin. Publishing an operation is still not offering a button: the surface renders
 * them as facts and wires no call, and `continue` is still published by nobody.
 */
const AI_SET_CONTEXT_PUBLICATION = Object.freeze({
  owner: 'manager',
  domain: 'ai-lego-set',
  decision: 'XA-20',
  what: 'manifest/ai-lego-set.json#lego[id=context-session] publishes the six-state context lifecycle, the continuation package sections and five operation verbs, but the FILE is published by no contract-lock row, so these words carry no pinned contract version of their own. ai.context@1.0.0 and ai.agent-session@1.0.0 ARE locked on protected main at efa3da35 and all five verbs are registered operations of ai.context, which is why the sets quoted from the contract surface (contextOperation, continuationSection, contextRolloverPhase, continuationVerification) carry a contract pin while these two do not. XA-20 remains the manager-owned row for publication/locking semantics, including whether the AI set itself ever gets a lock row',
});

/**
 * The token kinds of the context-rollover reference scenario. `manifest/reference-scenarios.json`
 * is manager-owned and `contract-only`; no lock row publishes it, and `XA-17` is the open question
 * about which contract publishes token and cost usage. Quoted because the frontend must render a
 * usage figure *per declared kind* (message / modelInput / output) rather than one ambiguous
 * number — presenting the message count as the model input count is the confusion the scenario
 * exists to prevent.
 */
const TOKEN_SCENARIO_PUBLICATION = Object.freeze({
  owner: 'manager',
  domain: 'reference-scenarios',
  decision: 'XA-17',
  what: 'manifest/reference-scenarios.json#scenarios[id=context-rollover].tokenKinds names three token kinds (message, modelInput, output) and the scenario adds a total in its steps, but no contract-lock row publishes the file and no contract publishes token usage — XA-17 asks which one does, per call, per run and per session',
});

/**
 * The canonical vocabularies. `values` is the complete set; `provenance` names the
 * contract (id/version/owner) and the exact declaration the values were read from
 * (`kind` + `file` + `path`/`symbol`), so a reviewer can check the quote instead of
 * trusting it. Read from the backend foundation at P2.10 (`lego.domain-registry@1.1.0`,
 * `ai.foundation@1.0.0` and the `lego.*` contracts those rows name).
 */
export const VOCABULARIES = Object.freeze([
  Object.freeze({
    id: 'degradation',
    question: 'May this capability serve a caller here, and if not, what must the consumer do instead?',
    about: 'availability',
    values: Object.freeze([
      'available',
      'degraded',
      'capability-unavailable',
      'optional-absent',
      'version-incompatible',
      'dependency-disabled',
      'migration-required',
      'feature-unsupported',
    ]),
    /** What each value instructs a consumer to do — quoted, so the frontend cannot soften it. */
    actions: Object.freeze({
      available: 'proceed',
      degraded: 'proceed with reduced guarantees; the provider declares what is reduced',
      'capability-unavailable': 'fail with lego.capability_unavailable',
      'optional-absent': 'skip the optional path; this is not an error',
      'version-incompatible': 'fail with lego.version_incompatible — never silently adapt',
      'dependency-disabled': 'fail with lego.dependency_disabled',
      'migration-required': 'fail with lego.migration_required and name the migration',
      'feature-unsupported': 'answer 501 through the compatibility layer',
    }),
    usable: Object.freeze({ available: true, degraded: true }),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.interaction', version: '1.0.0', owner: 'agent-2' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/interaction.mjs',
      symbol: 'DEGRADATION_STATES',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'lifecycle',
    question: 'What lifecycle state is this LEGO or capability in, and may it be called?',
    about: 'state',
    values: Object.freeze([
      'declared',
      'available',
      'installed',
      'loaded',
      'active',
      'idle',
      'degraded',
      'disabled',
      'failed',
      'unloaded',
      'deprecated',
    ]),
    callable: Object.freeze(['active', 'idle', 'degraded', 'deprecated']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.negotiation', version: '1.0.0', owner: 'agent-2' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/negotiation.mjs',
      symbol: 'LIFECYCLE_STATES',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'changeKind',
    question: 'What kind of move is A → B for a contract or unit version?',
    about: 'change',
    values: Object.freeze(['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.contract-compat', version: '1.0.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/compat.mjs',
      symbol: 'CHANGE_KINDS',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'interaction',
    question: 'What does an operation mean, independent of any transport?',
    about: 'interaction',
    values: Object.freeze(['call', 'event', 'stream', 'batch']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.interaction', version: '1.0.0', owner: 'agent-2' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/interaction.mjs',
      symbol: 'INTERACTION_CLASSES',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'capabilityStatus',
    question: 'How far has this capability been implemented?',
    about: 'implementation',
    // `contract-only` (P2.10) is deliberately distinct from `planned`: the contract is
    // fixed and gate-checked, only the implementation is missing.
    values: Object.freeze(['implemented', 'partial', 'planned', 'contract-only', 'legacy', 'unsupported', 'deferred', 'template']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/registry.mjs',
      symbol: 'DOMAIN_STATUS',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'capabilityCriticality',
    question: 'What happens to the instance when this capability is absent?',
    about: 'level',
    values: Object.freeze(['critical', 'standard', 'optional']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains[].capabilities[].criticality',
      read: 'unique',
    }),
  }),
  Object.freeze({
    id: 'capabilityMigrationState',
    question: 'Where is this capability in its strangler/migration journey?',
    about: 'migration',
    values: Object.freeze(['stable', 'not-started', 'strangler-pending']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains[].capabilities[].migrationState',
      read: 'unique',
    }),
  }),
  Object.freeze({
    id: 'capabilityReplacement',
    question: 'What kind of replacement may this capability undergo?',
    about: 'replacement',
    values: Object.freeze(['contract-preserving']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains[].capabilities[].replacement',
      read: 'unique',
    }),
  }),
  Object.freeze({
    id: 'trustLevel',
    question: 'How far may this code be trusted, and what may it reach?',
    about: 'trust',
    values: Object.freeze(['core', 'verified', 'community', 'untrusted']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'trust.levels',
      read: 'keys',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),
  Object.freeze({
    id: 'transportKind',
    question: 'How do bytes move between two parties?',
    about: 'transport',
    values: Object.freeze(['in-process', 'worker', 'remote', 'mcp']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'transportRouting.kinds',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'transportTarget',
    question: 'Where may the same logical contract be bound, without changing it?',
    about: 'transport',
    values: Object.freeze(['in-process-js', 'in-process-rust', 'wasm', 'worker', 'remote-api']),
    provenance: Object.freeze({
      // No lock row yet: quoted from the foundation manifest, publication pending.
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'transport.targets',
      read: 'values',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),

  /* ------------------------------------------------------------ the AI foundation */

  Object.freeze({
    id: 'aiKind',
    question: 'What kind of thing is this — a provider or a runtime?',
    about: 'kind',
    values: Object.freeze(['model-provider', 'tool-provider', 'application-provider', 'agent-runtime', 'simulation-runtime']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'providerKinds',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'runtimeLocality',
    question: 'Where does this runtime execute, relative to the caller?',
    about: 'transport',
    values: Object.freeze(['in-process', 'local-process', 'local-network', 'remote']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'agentRuntime.runtimeMetadata.locality',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'agentSessionState',
    question: 'What state is an agent session in?',
    about: 'state',
    values: Object.freeze(['created', 'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'agentSession.states',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'agentEventType',
    question: 'What happened in an agent run?',
    about: 'event',
    values: Object.freeze([
      'agent.created', 'agent.started', 'agent.waiting', 'agent.paused', 'agent.resumed',
      'agent.delegated', 'agent.completed', 'agent.failed', 'agent.cancelled',
      'context.loaded', 'context.compacted',
      'tool.requested', 'tool.started', 'tool.completed', 'tool.failed',
      'decision.created', 'decision.approved', 'decision.rejected',
      'approval.requested', 'approval.granted', 'approval.denied',
      'artifact.created', 'artifact.updated',
      'runtime.connected', 'runtime.disconnected', 'runtime.unavailable',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'events.types',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'agentEventEnvelopeField',
    question: 'Which fields does an agent event carry?',
    about: 'field',
    values: Object.freeze([
      'eventId', 'timestamp', 'type', 'sessionId', 'scope',
      'agentId', 'parentId', 'taskId', 'status', 'durationMs', 'summary', 'references',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'events.envelope.required+optional',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'agentSessionField',
    question: 'What identifies an agent session?',
    about: 'field',
    values: Object.freeze(['sessionId', 'agentId', 'parentSessionId', 'taskId', 'workflowId', 'executionId', 'runtimeId', 'status', 'createdAt', 'updatedAt']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'agentSession.fields',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'delegationField',
    question: 'What does a delegation edge carry?',
    about: 'field',
    values: Object.freeze(['delegationId', 'parentSessionId', 'childSessionId', 'task', 'grantedCapabilities', 'budget', 'deadline', 'status']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'delegation.fields',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'delegationBudgetField',
    question: 'What may a delegated child spend?',
    about: 'field',
    values: Object.freeze(['maxTokens', 'maxToolCalls', 'maxDurationMs', 'maxChildren']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'delegation.budget.fields',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'contextScope',
    question: 'How wide is the context an agent loaded?',
    about: 'scope',
    values: Object.freeze(['GLOBAL', 'WORKFLOW', 'NODE', 'EXECUTION', 'EVENT', 'AGENT', 'TASK']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'context.scopes',
      read: 'values',
      note: 'P2.13: the declaration order is the disclosure ladder the UI renders (GLOBAL widest -> TASK narrowest); the order is quoted, not re-sorted',
    }),
  }),
  /**
   * The Context & Session vocabulary quoted for P2.13.
   *
   * Two contracts, one LEGO: `ai.context` (what is loaded now) and `ai.agent-session` (bounded
   * state: identity plus references). Both are **declared** by `manifest/ai-foundation.json` and
   * **registered** as capabilities of the `ai-foundation` domain in `manifest/domains.json`, and
   * neither has its own contract-lock row yet — the files they are quoted from are published by
   * `ai.foundation@1.0.0` and `lego.domain-registry@1.1.0`, so the sets below are contract-pinned
   * quotes and not pending ones. What *is* pending is the pair of dedicated rows
   * (`ai.context@1.0.0`, `ai.agent-session@1.0.0`) plus the rollover/continuation/verification
   * vocabulary: see `PENDING_PUBLICATIONS` and `XA-20`.
   */
  Object.freeze({
    id: 'contextField',
    question: 'What does one context record carry?',
    about: 'field',
    values: Object.freeze(['contextId', 'scope', 'parent', 'snapshot', 'version', 'source', 'dependencies', 'size', 'checksum']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'context.fields',
      read: 'values',
      note: '`parent` and `checksum` are what make lineage provable: a compacted context must be able to name the context it descended from, so neither field is optional in a rendered record',
    }),
  }),
  Object.freeze({
    id: 'agentSessionReference',
    question: 'What does a session point at, instead of holding?',
    about: 'reference',
    values: Object.freeze(['contextRef', 'artifactRef', 'traceRef']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'agentSession.references',
      read: 'values',
      note: 'references, never payloads: a session that inlined a context, an artifact or a transcript would stop being bounded, which is the one property the declaration requires of it',
    }),
  }),
  Object.freeze({
    id: 'contextOperation',
    question: 'Which operation does the context capability publish?',
    about: 'operation',
    values: Object.freeze(['load', 'compact', 'rollover', 'rehydrate', 'verify']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains#id=ai-foundation.capabilities[id=ai.context].operations[].name',
      read: 'values',
      note: 'five published operations, all `implemented` in the registry on protected main @ efa3da35 and all five named by the `ai.context@1.0.0` contract-lock row: `load` (`ai:context:read`, idempotent), `compact`, `rollover`, `rehydrate` (`ai:context:write`, not idempotent) and `verify` (`ai:context:read`, idempotent). At the P2.13 start baseline (e754c5df) the registry published two of them `contract-only`; agent-2 added the other three and the Manager merged them as PR #45. Publishing an operation is not offering a button: the UI renders these as facts and wires no call, and `continue` is still published by nobody',
      movedBy: Object.freeze({ commit: 'fb254f32', branch: 'arena/01a0c6b5-n8n-rust-v-4', added: Object.freeze(['rollover', 'rehydrate', 'verify']), previousValues: Object.freeze(['load', 'compact']), mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }) }),
    }),
  }),
  Object.freeze({
    id: 'agentSessionOperation',
    question: 'Which operation does the agent-session capability publish?',
    about: 'operation',
    values: Object.freeze(['create', 'status', 'close']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains#id=ai-foundation.capabilities[id=ai.agent-session].operations[].name',
      read: 'values',
      note: 'three published operations, all `contract-only`. There is no `continue`, `pause`, `resume` or `execute` operation: `pause`/`resume` belong to the agent-runtime contract, and a continuation is a link the backend records, not an operation a UI calls',
    }),
  }),
  Object.freeze({
    id: 'contextPermission',
    question: 'Which permission does a context operation require?',
    about: 'permission',
    values: Object.freeze(['ai:context:read', 'ai:context:write']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains#id=ai-foundation.capabilities[id=ai.context].permissions',
      read: 'values',
      note: 'requirements of the two published operations, never a grant the UI holds and never a control it renders',
    }),
  }),
  Object.freeze({
    id: 'agentSessionPermission',
    question: 'Which permission does an agent-session operation require?',
    about: 'permission',
    values: Object.freeze(['ai:agent:create', 'ai:agent:read', 'ai:agent:control']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains#id=ai-foundation.capabilities[id=ai.agent-session].permissions',
      read: 'values',
      note: '`create` requires ai:agent:create, `status` requires ai:agent:read, `close` requires ai:agent:control. `ai:agent:invoke` is NOT among them: no published session operation invokes a model',
    }),
  }),
  Object.freeze({
    id: 'contextLifecycle',
    question: 'Which of the six lifecycle states is a context in — declared, in use, preparing a rollover, compacting, rolled over or closed?',
    about: 'state',
    values: Object.freeze(['declared', 'active', 'prepare', 'compacting', 'rolled-over', 'closed']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
      path: 'lego#id=context-session.lifecycle',
      read: 'values',
      note: 'six states, never a boolean and never collapsed into the canonical `lifecycle` set: `prepare`, `compacting` and `rolled-over` exist only here. `prepare` is the published word for "a rollover is being prepared" and `rolled-over` for "the next window exists and is linked", so the UI renders both from the declaration instead of from an unpublished phase name',
    }),
    publicationPending: AI_SET_CONTEXT_PUBLICATION,
  }),
  Object.freeze({
    id: 'continuationSection',
    question: 'Which sections must a continuation package carry across a rollover?',
    about: 'section',
    values: Object.freeze([
      'identity', 'objective', 'plan', 'completedWork', 'unfinishedWork', 'constraints',
      'decisions', 'activeEntities', 'toolStateReferences', 'artifacts', 'importantReferences', 'errors',
      'unresolvedQuestions', 'compressedHistory',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.context', version: '1.0.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/context-session.mjs',
      symbol: 'CONTINUATION_FIELDS',
      read: 'values',
      note: 'fourteen sections, quoted in publication order from the locked `ai.context@1.0.0` surface (`CONTINUATION_FIELDS`, re-exported by `src/lego/context.mjs` and named in the contract-lock row\'s exports). No section is a transcript, a raw prompt or a reasoning dump — `compressedHistory` is a summary and the privacy rule refuses the rest by name',
      publishedOn: Object.freeze({ branch: 'arena/01a0c6b5-n8n-rust-v-4', commit: 'fb254f32', lockRow: 'ai.context@1.0.0', mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }) }),
    }),
    /**
     * A **divergence inside the backend that this lock reported and did not adopt — now closed**.
     *
     * At `fb254f32` the AI-set manifest still spelled two of the fourteen sections `toolState` and
     * `refs` while the locked contract spelled them `toolStateReferences` and `importantReferences`.
     * The frontend quoted the contract (a contract-lock row is a publication, a manifest entry is a
     * plan), recorded the manifest spelling verbatim, reported it as drift data, and refused to average
     * the two or coin a third spelling. Agent-2 then moved the manifest to the canonical spelling in
     * `fa18ba76` and the Manager merged it as PR #45 → `main` @ `efa3da35`, so manifest and contract now
     * agree on all fourteen sections and `vocabularyDrift()` reports no difference.
     *
     * The record is kept rather than deleted: a closed divergence is the evidence that the rule worked
     * (quote the publication, name the difference, let its owner close it), and a reconciler reading
     * this file after the merge must be able to see that the frontend never adopted the stale spelling.
     */
    divergenceClosed: Object.freeze({
      decision: 'XA-20',
      owner: 'agent-2 (manifest) / manager (arbitration)',
      wasAgainst: Object.freeze({
        file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
        path: 'lego#id=context-session.continuationPackage',
        values: Object.freeze(['identity', 'objective', 'plan', 'completedWork', 'unfinishedWork', 'constraints',
          'decisions', 'activeEntities', 'toolState', 'artifacts', 'refs', 'errors',
          'unresolvedQuestions', 'compressedHistory']),
        observedAt: 'fb254f32',
      }),
      differed: Object.freeze([
        Object.freeze({ published: 'toolStateReferences', manifest: 'toolState' }),
        Object.freeze({ published: 'importantReferences', manifest: 'refs' }),
      ]),
      identical: 12,
      closedBy: Object.freeze({ commit: 'fa18ba76', agent: 'agent-2', what: 'manifest continuationPackage moved to the canonical toolStateReferences / importantReferences' }),
      verifiedOn: Object.freeze({ branch: 'main', commit: 'efa3da35', pullRequest: 45 }),
      canonicalFields: Object.freeze(['toolStateReferences', 'importantReferences']),
      rule: 'the published contract won and the manifest followed it; the frontend changed nothing to make that true',
    }),
  }),
  Object.freeze({
    id: 'contextOperationVerb',
    question: 'Which operation does the Context & Session LEGO declare — and which of those does the registry actually publish?',
    about: 'operation',
    values: Object.freeze(['load', 'compact', 'rollover', 'rehydrate', 'verify']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
      path: 'lego#id=context-session.operations',
      read: 'values',
      note: 'five declared verbs, and protected main now registers all five as operations of `ai.context` (`contextOperation`: load, compact, rollover, rehydrate, verify) — the gap this set used to render (`rollover`/`rehydrate`/`verify` as declared intent with no operation behind them) was closed by the P2.13 publication. The set is kept because the AI-set file itself is still published by no lock row, so these five words are quoted as a declaration rather than as a contract',
    }),
    publicationPending: AI_SET_CONTEXT_PUBLICATION,
  }),
  Object.freeze({
    id: 'tokenKind',
    question: 'Which kind of token count is this figure — the visible message, the whole model input, or the output?',
    about: 'token',
    values: Object.freeze(['message', 'modelInput', 'output']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/reference-scenarios.json',
      path: 'scenarios[id=context-rollover].tokenKinds',
      read: 'keys',
      note: 'a usage figure without a kind is ambiguous, and the ambiguity is the bug: `1 token` for the message next to `1847` for the model input is one screen showing two different facts. The frontend renders the kind with the number or renders nothing',
    }),
    publicationPending: TOKEN_SCENARIO_PUBLICATION,
  }),
  /**
   * The Memory vocabulary quoted for P2.14. Nine sets, all quoted from the same publication
   * (`ai.memory@1.0.0`): the scope ladder, the entry kinds, the retention ladder, the record
   * fields, the two-state lifecycle, the graph node and edge vocabularies, the four published
   * operations and the two permission words.
   *
   * What is **not** here is as deliberate as what is. There is no `memoryEmbedding`, no
   * `memoryVector`, no `memoryScore` and no `memoryRelevance`: the published contract has no
   * embedding, no vector store and no ranking, so a UI that could render a similarity figure would
   * be a UI rendering something nobody published. `memory.json#interaction` and
   * `memory.json#degradation` are not re-declared either — they are subsets of the canonical
   * `interaction` and `degradation` sets, and a second set with the same meaning is exactly the
   * dialect the lock exists to prevent.
   */
  Object.freeze({
    id: 'memoryScope',
    question: 'How wide is the namespace a memory record is isolated to?',
    about: 'scope',
    values: Object.freeze(['GLOBAL', 'PROJECT', 'WORKFLOW', 'AGENT', 'SESSION']),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'scopes',
      read: 'values',
      note: 'five scopes and no more. `GLOBAL` has no owner; every other scope requires a `scopeOwner` that is itself a stable identity, because scope owns isolation and the provider boundary never infers one. The published ladder is narrower than the context ladder on purpose: memory is retained deliberately, so `NODE`, `EXECUTION` and `EVENT` — the three widest-churn context scopes — are not retention namespaces',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'memoryKind',
    question: 'What kind of thing was remembered?',
    about: 'kind',
    values: Object.freeze(['note', 'decision', 'artifact', 'task', 'execution', 'reference']),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'kinds',
      read: 'values',
      note: 'six declared categories, drawn from the memory graph node vocabulary. A kind grants nothing: a `task` memory is a record ABOUT a task, not a running task, and a `decision` memory is a record about a choice rather than the choice itself — which is the distinction the frontend renders next to every entry',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'memoryRetention',
    question: 'How long is this memory record intended to survive?',
    about: 'retention',
    values: Object.freeze(['EPHEMERAL', 'WORKING', 'IMPORTANT', 'DURABLE', 'PERMANENT']),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'retention',
      read: 'values',
      note: 'an explicit declaration, not a policy engine: `EPHEMERAL` and `WORKING` are expected to be forgotten and the other three require an explicit forget operation. Nothing expires on its own, so a retention word may never be rendered as a countdown or a promise that the record is gone',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'memoryLifecycle',
    question: 'Is this memory record active, or forgotten?',
    about: 'state',
    values: Object.freeze(['active', 'forgotten']),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'lifecycle.states',
      read: 'values',
      note: 'exactly two states, drawn from `memory.json#lifecycle`. A record is `active` once remembered and becomes `forgotten` only through an explicit forget; `forgotten` is terminal, so the UI never renders a forgotten record as recoverable and never offers a restore. There is no third state: "expired" does not exist, because nothing expires on its own',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'memoryField',
    question: 'What does one memory record carry?',
    about: 'field',
    values: Object.freeze([
      'memoryId', 'scope', 'scopeOwner', 'kind', 'retention', 'content', 'references',
      'provenance', 'version', 'size', 'checksum', 'createdAt', 'updatedAt',
    ]),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'fields',
      read: 'values',
      note: 'thirteen fields, and the last two of the integrity envelope (`size`, `checksum`) are not optional in a rendered record. `scopeOwner` is the only conditionally-absent field: `GLOBAL` has no owner. `content` is bounded (64 KiB canonical) and `references` is linkage, never a load',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'memoryOperation',
    question: 'Which operation does the Memory capability publish?',
    about: 'operation',
    values: Object.freeze(['memory.remember', 'memory.recall', 'memory.list', 'memory.forget']),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'operations[].name',
      read: 'values',
      note: 'four published operations, spelled as the contract spells them (`memory.<verb>`, not a bare verb). `memory.list` is the only retrieval that returns more than one record and it is deterministic and bounded: scope-filtered, ordered `createdAt` ascending then `memoryId` ascending, `limit` 1..100 default 50, opaque `cursor`. `traverse` and `relate` are declared as future stages and are NOT operations, so no UI affordance may offer them',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'memoryPermission',
    question: 'Which permission does a memory operation require?',
    about: 'permission',
    values: Object.freeze(['ai:memory:read', 'ai:memory:write']),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'permissions',
      read: 'values',
      note: 'two words: `read` covers `memory.recall` and `memory.list`, `write` covers `memory.remember` and `memory.forget`. There is no `ai:memory:admin` and no broad permission, and a memory record never carries a grant — `memory.remember` creates a record, never an authority',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'memoryGraphNode',
    question: 'What can a memory reference point at?',
    about: 'graph',
    values: Object.freeze([
      'project', 'workflow', 'node', 'execution', 'agent', 'session',
      'decision', 'evidence', 'artifact', 'task',
    ]),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'graph.nodes',
      read: 'values',
      note: 'ten addressable references that already exist elsewhere — a decision id, an artifact id, a workflow id. The graph is the logical shape of memory, not a storage engine: the bounded P2.14 implementation stores linkage in a record`s `references` array and does not traverse. A node word is never a claim that the referenced thing is loaded, alive or reachable',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'memoryGraphEdge',
    question: 'How may one memory record be linked to another thing?',
    about: 'graph',
    values: Object.freeze([
      'depends_on', 'caused', 'derived_from', 'supports', 'contradicts', 'implements',
      'belongs_to', 'delegated_to', 'decided_by', 'observed_in', 'related_to',
    ]),
    provenance: Object.freeze({
      contract: AI_MEMORY_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/memory.json',
      path: 'graph.edges',
      read: 'values',
      note: 'eleven declared relations, and free text is refused: an edge the vocabulary does not declare is not a looser link, it is an undeclared one. `references` is validated against this list, bounded to 32 entries, and is never dereferenced automatically — linkage is not a load',
      publishedOn: Object.freeze({ branch: 'arena/01a0c90d-n8n-rust-v-4', commit: 'f11aee01', lockRow: 'ai.memory@1.0.0' }),
    }),
    openDecision: AI_MEMORY_PUBLICATION,
  }),
  Object.freeze({
    id: 'decisionRisk',
    question: 'How risky is the decision an agent made?',
    about: 'level',
    values: Object.freeze(['low', 'medium', 'high', 'critical']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'decision.risk',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'decisionApprovalState',
    question: 'Does this decision need approval, and did it get one?',
    about: 'approval',
    values: Object.freeze(['not-required', 'pending', 'granted', 'denied']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'decision.approvalState',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'approvalDecision',
    question: 'How did a human answer an approval request?',
    about: 'approval',
    values: Object.freeze(['granted', 'denied', 'expired']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'approval.decision',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'toolSideEffect',
    question: 'What does calling this tool do to the world?',
    about: 'side-effect',
    values: Object.freeze(['read-only', 'writes', 'destructive', 'external']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/ai-foundation.mjs',
      symbol: 'TOOL_SIDE_EFFECTS',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'artifactKind',
    question: 'What kind of artifact did something produce?',
    about: 'artifact',
    values: Object.freeze(['patch', 'diff', 'log', 'report', 'screenshot', 'file', 'model-output', 'simulation-result']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'artifact.kinds',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'artifactRetention',
    question: 'How long may this artifact be kept?',
    about: 'retention',
    values: Object.freeze(['ephemeral', 'session', 'retained', 'pinned']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'artifact.retention',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'resourceDimension',
    question: 'Which resources may a capability or runtime declare?',
    about: 'field',
    values: Object.freeze(['cpu', 'memory', 'disk', 'network', 'latency', 'locality', 'startupCost', 'estimatedCost', 'availability']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'resourceProfiles.dimensions',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'resourceProfile',
    question: 'Which resource class does this workload belong to?',
    about: 'level',
    values: Object.freeze(['low-resource', 'standard', 'high-resource', 'remote']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'resourceProfiles.profiles',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'aiResourceField',
    question: 'Which fields may a declared resource requirement carry?',
    about: 'field',
    values: Object.freeze(['cpu', 'memory', 'disk', 'network', 'concurrency', 'startup']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'resources.fields',
      read: 'values',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),
  Object.freeze({
    id: 'deviceProfileField',
    question: 'Which facts describe a device class?',
    about: 'field',
    values: Object.freeze(['cpuCores', 'memoryMb', 'diskMb', 'os', 'arch', 'gpu', 'network']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'deviceProfile.fields',
      read: 'values',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),
  Object.freeze({
    id: 'deviceClass',
    question: 'Which machine classes exist?',
    about: 'device',
    values: Object.freeze(['android-termux', 'low-end-vps', 'laptop', 'server']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/foundation.json',
      path: 'deviceProfile.classes',
      read: 'keys',
    }),
    publicationPending: FOUNDATION_MANIFEST_PUBLICATION,
  }),
  Object.freeze({
    id: 'mcpConcept',
    question: 'Which MCP concepts exist, at the edge only?',
    about: 'mcp',
    values: Object.freeze(['server', 'client', 'tool', 'resource', 'prompt', 'connection', 'authorization', 'capability']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'mcp.concepts',
      read: 'values',
    }),
  }),
  Object.freeze({
    id: 'zeroInstallLayerState',
    question: 'What state is one installation layer in?',
    about: 'state',
    values: Object.freeze(['ready', 'not-configured']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'zeroInstall.state',
      read: 'unique',
    }),
  }),
  Object.freeze({
    id: 'zeroInstallLayer',
    question: 'Which layers does a zero-install report name?',
    about: 'layer',
    values: Object.freeze(['aiFoundation', 'modelProvider', 'toolProvider', 'agentRuntime']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'zeroInstall.state',
      read: 'keys',
    }),
  }),
  Object.freeze({
    id: 'aiFoundationCapability',
    question: 'Which capability contracts does the AI Foundation publish?',
    about: 'capability-kind',
    values: Object.freeze([
      'ai.model-gateway', 'ai.tool-gateway', 'ai.agent-runtime', 'ai.application-provider',
      'ai.agent-session', 'ai.agent-delegation', 'ai.agent-events', 'ai.decision',
      'ai.approval', 'ai.artifact', 'ai.context', 'ai.skill', 'ai.memory',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains#id=ai-foundation.capabilities',
      read: 'id',
      note: 'thirteen capabilities of the `ai-foundation` domain. `ai.memory` joined the list at P2.14 (`implemented`, four operations) on agent-2`s branch; `ai.skill` joined at the P2.12 finalize. A capability is declared here whether it is contract-only or implemented — the status is a field, not a separate list',
      movedBy: Object.freeze({ commit: '5fbaf934', branch: 'arena/01a0c90d-n8n-rust-v-4', added: Object.freeze(['ai.memory']), previousValues: Object.freeze([
        'ai.model-gateway', 'ai.tool-gateway', 'ai.agent-runtime', 'ai.application-provider',
        'ai.agent-session', 'ai.agent-delegation', 'ai.agent-events', 'ai.decision',
        'ai.approval', 'ai.artifact', 'ai.context', 'ai.skill',
      ]) }),
    }),
  }),
  Object.freeze({
    id: 'aiPermission',
    question: 'Which permission names do the published AI operations require?',
    about: 'permission',
    // The 26 names the thirteen `ai.*` capabilities publish on their operations — including
    // the two `ai:skill:*` words the locked Skill contract requires and the two `ai:memory:*`
    // words `ai.memory@1.0.0` requires. The vocabulary file names only the three provider
    // contracts' permissions (eight of these) plus the application-provider trio below; the
    // operation list is what a caller is actually refused by, so that is what the frontend quotes.
    values: Object.freeze([
      'ai:model:read', 'ai:model:invoke',
      'ai:tool:read', 'ai:tool:invoke',
      'ai:agent:create', 'ai:agent:invoke', 'ai:agent:control', 'ai:agent:read', 'ai:agent:delegate',
      'ai:app:read', 'ai:app:invoke',
      'ai:event:read', 'ai:event:write',
      'ai:decision:read', 'ai:decision:write',
      'ai:approval:request', 'ai:approval:resolve', 'ai:approval:read',
      'ai:artifact:read', 'ai:artifact:write',
      'ai:context:read', 'ai:context:write',
      'ai:skill:read', 'ai:skill:select',
      'ai:memory:read', 'ai:memory:write',
    ]),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'domains#id=ai-foundation.capabilities[].operations[].permission',
      read: 'unique',
      note: 'the `ai.foundation` vocabulary publishes eight of these for the three provider contracts; the remaining operation permissions exist only here — see XA-10. `ai:memory:read` and `ai:memory:write` are the P2.14 pair: read covers `memory.recall`/`memory.list`, write covers `memory.remember`/`memory.forget`, and there is no `ai:memory:admin`',
      movedBy: Object.freeze({ commit: '5fbaf934', branch: 'arena/01a0c90d-n8n-rust-v-4', added: Object.freeze(['ai:memory:read', 'ai:memory:write']) }),
    }),
  }),
  Object.freeze({
    id: 'applicationPermission',
    question: 'Which permissions does an application provider publish for its application capabilities?',
    values: Object.freeze(['app:github:read', 'app:github:write', 'app:github:receive']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.foundation', version: '1.0.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-foundation.json',
      path: 'applicationProvider.exampleCapabilities.capabilities[].permission',
      read: 'unique',
      note: '`exampleCapabilities` is illustrative (no GitHub client exists) but it is the only place the application-provider permission names are declared — XA-10 records that the registry publishes `ai:app:*` for the same capability instead',
    }),
  }),
  Object.freeze({
    id: 'surfaceAliasKind',
    question: 'What kind of thing does a surface alias point at?',
    about: 'alias-kind',
    values: Object.freeze(['domain']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'lego.domain-registry', version: '1.1.0', owner: 'manager' }),
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/domains.json',
      path: 'surfaceAliases.aliases[].kind',
      read: 'unique',
    }),
  }),
  /**
   * The Skill vocabulary. A Skill is *how* a task is done (procedure plus a capability
   * map); a capability is *what* can be done; the Agent Machine is *who* does it. The
   * six states below are the frontend's whole state model for a skill, and they are six
   * facts rather than one flag: `registered` ≠ `available` ≠ `selected` ≠ `loaded` ≠
   * `active` ≠ `released`. Three of the six do not exist in the canonical `lifecycle`
   * set, which is exactly why this set is quoted separately instead of borrowed.
   */
  Object.freeze({
    id: 'skillLifecycle',
    question: 'Which of the six skill states is this skill in — known, offered, chosen, in context, in use or let go?',
    about: 'state',
    values: Object.freeze(['registered', 'available', 'selected', 'loaded', 'active', 'released']),
    provenance: Object.freeze({
      contract: AI_SKILL_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
      path: 'lego#id=skill.lifecycle',
      read: 'values',
      note: '`available`, `loaded` and `active` are the canonical `lifecycle` words for the same facts; `registered`, `selected` and `released` exist only in the skill declaration, so the two sets may not be merged into one',
    }),
  }),
  Object.freeze({
    id: 'skillOperation',
    question: 'Which operation does a skill declare — and which of them may a UI ever offer?',
    about: 'operation',
    values: Object.freeze(['list', 'resolve', 'describe', 'validate-selection']),
    provenance: Object.freeze({
      contract: AI_SKILL_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
      path: 'lego#id=skill.operations',
      read: 'values',
      note: 'the four published caller operations, spelled as verbs here and qualified in the lock (`skill.list`, `skill.resolve`, `skill.describe`, `skill.validate-selection`); `register`, `select`, `load` and `release` are internal registry lifecycle methods and are not published, and no operation executes a procedure — discovery may name these four and the UI offers none of them',
    }),
  }),
  Object.freeze({
    id: 'skillDisclosureLevel',
    question: 'How much of a skill is disclosed — identity, card, procedure or deep knowledge?',
    about: 'disclosure',
    values: Object.freeze(['L0', 'L1', 'L2', 'L3']),
    provenance: Object.freeze({
      contract: AI_SKILL_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
      path: 'lego#id=skill.disclosureLevels',
      read: 'keys',
      note: 'selection happens on L0/L1 and loading deeper is a separate decision; the frontend shows the level a caller asked for and never loads L2/L3 by itself',
    }),
  }),
  Object.freeze({
    id: 'skillPermission',
    question: 'Which permissions does a skill operation require?',
    about: 'permission',
    values: Object.freeze(['ai:skill:read', 'ai:skill:select']),
    provenance: Object.freeze({
      contract: AI_SKILL_CONTRACT,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
      path: 'lego#id=skill.permissions',
      read: 'values',
      note: 'these are requirements of the published operations (`skill.list`, `skill.resolve` and `skill.describe` require `ai:skill:read`; `skill.validate-selection` requires `ai:skill:select`), never grants a skill holds, never a UI affordance — and `ai:skill:execute` does not exist at any layer',
    }),
  }),
  Object.freeze({
    id: 'aiLegoStatus',
    question: 'How mature is an AI/Agent LEGO in the official set?',
    about: 'status',
    values: Object.freeze(['implemented', 'contract-only', 'planned', 'blocked', 'deferred', 'in-progress']),
    provenance: Object.freeze({
      contract: null,
      kind: 'json',
      file: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json',
      path: 'statusVocabulary',
      read: 'keys',
      note: 'the AI set spells maturity with six words; the registry publishes eight for capabilities (`capabilityStatus`), so the two sets are quoted separately — `blocked` exists only here. `in-progress` was added by agent-2 (first seen at fb254f32 on its branch, merged into protected main at efa3da35 through PR #45): its `context-session` LEGO is `in-progress` and its `ai-foundation.json` blocks carry `implementationStatus: "in-progress"`. Agent-2 edited this frontend-owned set on its own branch to say so; this branch independently applied the same six words, so the merge is a Class B agreement rather than a conflict of meaning',
      movedBy: Object.freeze({ commit: 'fb254f32', branch: 'arena/01a0c6b5-n8n-rust-v-4', added: Object.freeze(['in-progress']), mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }) }),
    }),
    publicationPending: AI_SET_STATUS_PUBLICATION,
  }),
  Object.freeze({
    id: 'contextRolloverPhase',
    question: 'Which phase is the context manager in — monitored, preparing a rollover, or rolling over?',
    about: 'state',
    values: Object.freeze(['NORMAL', 'PREPARE', 'ROLLOVER']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.context', version: '1.0.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/context-session.mjs',
      symbol: 'CONTEXT_MANAGER_STATES',
      read: 'values',
      note: 'PROMOTED from PENDING_PUBLICATIONS at P2.13: agent-2 published the three-phase manager state as `CONTEXT_MANAGER_STATES` inside the locked `ai.context@1.0.0` surface (the contract-lock row names it among the exports of `src/lego/context.mjs`). The values are byte-identical to the ones the manager ruled and the frontend recorded as expected, so promotion changed the provenance, not the words. Protected main @ e754c5df does not carry the module yet: this set is compared only against a tree that publishes the row.',
      publishedOn: Object.freeze({ branch: 'arena/01a0c6b5-n8n-rust-v-4', commit: 'fb254f32', lockRow: 'ai.context@1.0.0', exportedBy: 'apps/n8n-lego/src/lego/context.mjs', mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }) }),
    }),
    promotedFrom: Object.freeze({
      previousState: 'PENDING_PUBLICATIONS.contextRolloverPhase',
      decidedBy: 'manager, P2.13 Context & Session brief §B4 (2026-09-22): NORMAL -> PREPARE -> ROLLOVER, and never at 100% — a rollover must happen while there is still room to serialize the continuation package',
      expectedValuesThen: Object.freeze(['NORMAL', 'PREPARE', 'ROLLOVER']),
      valuesChangedBy: 'nothing — the published enumeration equals the ruled one',
      decision: 'XA-20',
      rule: 'A phase is a backend fact. The frontend renders the phase or lifecycle state it is handed and never advances the phase itself: it does not decide that a rollover starts.',
    }),
  }),
  Object.freeze({
    id: 'continuationVerification',
    question: 'Did the continuation actually survive — verified, degraded or failed?',
    about: 'verification',
    values: Object.freeze(['verified', 'degraded', 'failed']),
    provenance: Object.freeze({
      contract: Object.freeze({ id: 'ai.context', version: '1.0.0', owner: 'manager' }),
      kind: 'module',
      file: 'apps/n8n-lego/src/lego/context-session.mjs',
      symbol: 'CONTINUATION_VERIFICATION',
      read: 'values',
      note: 'PROMOTED from PENDING_PUBLICATIONS at P2.13: agent-2 published the three continuity-verification results as `CONTINUATION_VERIFICATION` inside the locked `ai.context@1.0.0` surface, and `verifyContinuationPackage` is one of the row\'s named exports. Values identical to the ruled three, so promotion moved the provenance and not the words.',
      publishedOn: Object.freeze({ branch: 'arena/01a0c6b5-n8n-rust-v-4', commit: 'fb254f32', lockRow: 'ai.context@1.0.0', exportedBy: 'apps/n8n-lego/src/lego/context.mjs', mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }) }),
    }),
    promotedFrom: Object.freeze({
      previousState: 'PENDING_PUBLICATIONS.continuationVerification',
      decidedBy: 'manager, P2.13 Context & Session brief §B6 (2026-09-22): rehydration has an explicit verification stage and distinguishes verified / degraded / failed continuation; missing state is never silently repaired',
      expectedValuesThen: Object.freeze(['verified', 'degraded', 'failed']),
      valuesChangedBy: 'nothing — the published enumeration equals the ruled one',
      decision: 'XA-20',
      rule: 'Three outcomes, never two: `degraded` is not `failed` and must not be rendered as `verified`. Missing state is reported as missing; it is never silently repaired.',
    }),
  }),
]);

/**
 * Vocabulary the frontend expects the backend to publish and refuses to coin — **empty at P2.13**:
 * both Context & Session rows were promoted into `VOCABULARIES` when agent-2 published
 * `ai.context@1.0.0` at `fb254f32` (see `PROMOTED_PUBLICATIONS`). The list is kept, and kept
 * asserted, because the next unpublished word the UI needs belongs here rather than in a string.
 *
 * These are not quoted sets: nothing in the backend tree declares them today, so putting them in
 * `VOCABULARIES` would make the alignment gate (`test/29`) compare a quote against a declaration
 * that does not exist. They are kept apart, with the decision that settled their *shape* (the
 * manager's P2.13 architecture ruling) and the decision that owes their *publication* (`XA-20`).
 *
 * The rule this exists to enforce: a word the backend has not published is either absent from the
 * UI or rendered as an explicit pending state — never spelled locally and never adopted from a
 * handed-over declaration without a comparison. `test/32-context-session.test.mjs` scans the
 * backend tree for these values and **fails while they stay here after the backend publishes
 * them**: promotion into `VOCABULARIES` (with a contract, a version and a declaration path) is the
 * only way forward, and it happens at reconciliation, not silently.
 */
export const PENDING_PUBLICATIONS = Object.freeze([]);

/**
 * The two rows that used to be pending, kept as **promotion evidence**.
 *
 * A pending row is a promise that the frontend will not coin a word; a promotion is the moment the
 * backend publishes it. Both halves belong in the lock, because "we made it up and it happened to
 * match" is indistinguishable from "we quoted it" unless the promotion is recorded with the commit
 * that published it. Each record names the branch, the commit, the module symbol, the contract-lock
 * row, the values as ruled and the values as published — and the fact that they are identical, so a
 * reconciler can see that promotion changed the provenance and not the words.
 */
export const PROMOTED_PUBLICATIONS = Object.freeze([
  Object.freeze({
    id: 'contextRolloverPhase',
    promotedOn: '2026-09-22',
    promotedIn: 'P2.13 (agent-1 branch, consuming the agent-2 publication)',
    publishedBy: Object.freeze({ agent: 'agent-2', branch: 'arena/01a0c6b5-n8n-rust-v-4', commit: 'fb254f32', mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }) }),
    publishedAs: Object.freeze({
      file: 'apps/n8n-lego/src/lego/context-session.mjs',
      symbol: 'CONTEXT_MANAGER_STATES',
      lockRow: 'ai.context@1.0.0',
      reExportedBy: 'apps/n8n-lego/src/lego/context.mjs',
    }),
    ruledValues: Object.freeze(['NORMAL', 'PREPARE', 'ROLLOVER']),
    publishedValues: Object.freeze(['NORMAL', 'PREPARE', 'ROLLOVER']),
    identical: true,
    decision: 'XA-20',
    quotedAs: 'VOCABULARIES#contextRolloverPhase',
  }),
  Object.freeze({
    id: 'continuationVerification',
    promotedOn: '2026-09-22',
    promotedIn: 'P2.13 (agent-1 branch, consuming the agent-2 publication)',
    publishedBy: Object.freeze({ agent: 'agent-2', branch: 'arena/01a0c6b5-n8n-rust-v-4', commit: 'fb254f32', mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }) }),
    publishedAs: Object.freeze({
      file: 'apps/n8n-lego/src/lego/context-session.mjs',
      symbol: 'CONTINUATION_VERIFICATION',
      lockRow: 'ai.context@1.0.0',
      reExportedBy: 'apps/n8n-lego/src/lego/context.mjs',
    }),
    ruledValues: Object.freeze(['verified', 'degraded', 'failed']),
    publishedValues: Object.freeze(['verified', 'degraded', 'failed']),
    identical: true,
    decision: 'XA-20',
    quotedAs: 'VOCABULARIES#continuationVerification',
  }),
]);

/** The promotion record of a set that used to be pending, or null. */
export function promotionOf(id) {
  return PROMOTED_PUBLICATIONS.find((entry) => entry.id === id) ?? null;
}

/**
 * Contract rows P2.13 owed the frontend: **none remain**.
 *
 * Both rows are locked on protected main at `efa3da35` (PR #45, merging agent-2's
 * `arena/01a0c6b5-n8n-rust-v-4`), so this list is empty and the surface reports `published` from the
 * rows the tree it is handed actually carries. The list keeps its name and its export because the
 * fail-closed rule it exists to enforce has not changed: a version *claim* in a manifest
 * (`ai.context@1.0.0, ai.agent-session@1.0.0` in
 * `manifest/ai-lego-set.json#lego[id=context-session].versioning`) is not a publication, a consumer
 * binds to a contract-lock row, and a row this list names is a row the frontend will not render as
 * published until a tree it can see publishes it. If a future milestone declares a contract without
 * locking it, its row goes here — not into the surface.
 */
export const PENDING_CONTRACT_ROWS = Object.freeze([
  Object.freeze({
    contract: 'ai.context',
    declaredVersion: '1.0.0',
    owner: 'manager',
    domain: 'ai-foundation',
    lockedIn: 'apps/n8n-lego/src/lego/contracts/contract-lock.json',
    decision: 'XA-20',
    declaredIn: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json#lego[id=context-session].versioning',
    publishedOn: Object.freeze({
      branch: 'arena/01a0c6b5-n8n-rust-v-4',
      commit: 'fb254f32',
      status: 'implemented',
      operations: Object.freeze(['load', 'compact', 'rollover', 'rehydrate', 'verify']),
      permissions: Object.freeze(['ai:context:read', 'ai:context:write']),
      onProtectedMain: true,
      mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }),
    }),
  }),
  Object.freeze({
    contract: 'ai.agent-session',
    declaredVersion: '1.0.0',
    owner: 'manager',
    domain: 'ai-foundation',
    lockedIn: 'apps/n8n-lego/src/lego/contracts/contract-lock.json',
    decision: 'XA-20',
    declaredIn: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json#lego[id=context-session].versioning',
    publishedOn: Object.freeze({
      branch: 'arena/01a0c6b5-n8n-rust-v-4',
      commit: 'fb254f32',
      status: 'implemented',
      operations: Object.freeze(['create', 'status', 'close']),
      permissions: Object.freeze(['ai:agent:control', 'ai:agent:create', 'ai:agent:read']),
      onProtectedMain: true,
      mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45 }),
    }),
  }),
]);

/**
 * The two rows that used to be pending, kept as **publication evidence**.
 *
 * This is provenance, not a publication source: nothing in the surface derives `published` from this
 * array (that would let a frontend claim a contract on the strength of its own notes). It exists so a
 * reconciler can see what was owed at the P2.13 start baseline, who published it, at which commit, and
 * where it landed on protected main — the same reason `PROMOTED_PUBLICATIONS` keeps the two promoted
 * word lists.
 */
export const PUBLISHED_CONTRACT_ROWS = Object.freeze([
  Object.freeze({
    contract: 'ai.context',
    version: '1.0.0',
    owner: 'manager',
    domain: 'ai-foundation',
    status: 'implemented',
    lockedIn: 'apps/n8n-lego/src/lego/contracts/contract-lock.json',
    declaredIn: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json#lego[id=context-session].versioning',
    decision: 'XA-20',
    operations: Object.freeze(['load', 'compact', 'rollover', 'rehydrate', 'verify']),
    permissions: Object.freeze(['ai:context:read', 'ai:context:write']),
    pendingAt: Object.freeze({ branch: 'main', commit: 'e754c5df', lockedContractCount: 15, state: 'declared-not-locked' }),
    firstPublishedOn: Object.freeze({ agent: 'agent-2', branch: 'arena/01a0c6b5-n8n-rust-v-4', commit: 'fb254f32', finalCommit: 'dd6f889c' }),
    mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45, lockedContractCount: 17 }),
  }),
  Object.freeze({
    contract: 'ai.agent-session',
    version: '1.0.0',
    owner: 'manager',
    domain: 'ai-foundation',
    status: 'implemented',
    lockedIn: 'apps/n8n-lego/src/lego/contracts/contract-lock.json',
    declaredIn: 'apps/n8n-lego/src/lego/manifest/ai-lego-set.json#lego[id=context-session].versioning',
    decision: 'XA-20',
    operations: Object.freeze(['create', 'status', 'close']),
    permissions: Object.freeze(['ai:agent:control', 'ai:agent:create', 'ai:agent:read']),
    pendingAt: Object.freeze({ branch: 'main', commit: 'e754c5df', lockedContractCount: 15, state: 'declared-not-locked' }),
    firstPublishedOn: Object.freeze({ agent: 'agent-2', branch: 'arena/01a0c6b5-n8n-rust-v-4', commit: 'fb254f32', finalCommit: 'dd6f889c' }),
    mergedIntoMain: Object.freeze({ commit: 'efa3da35', pullRequest: 45, lockedContractCount: 17 }),
  }),
]);

/** A pending publication by id, or null. Fail-closed: an unknown id is not a synonym. */
/**
 * The pending row of a vocabulary the backend has not published, or null.
 *
 * At P2.13 this returns null for both Context & Session word lists: they were promoted when agent-2
 * published `ai.context@1.0.0`. Callers must handle null by quoting the set instead — a null here
 * means "published", never "unknown".
 */
export function pendingPublicationOf(id) {
  return PENDING_PUBLICATIONS.find((entry) => entry.id === id) ?? null;
}

/**
 * Concepts the frontend owns. `mapsTo` names the canonical vocabulary they speak
 * about, `extra` declares any value that canonical set does not have (with the reason
 * it exists), and `mirror` declares the total mapping so a reviewer can see that a
 * local word is not a competing meaning.
 *
 * The frontend keeps three kinds of local word, on purpose:
 *
 *   1. **Words that ride a pinned browser contract.** Renaming `unitStatus` or
 *      `unitCriticality` would change the 18,126-byte boot payload for a naming reason
 *      (`test/16`), so they are *mapped* instead;
 *   2. **Words that name a UI fact the foundation does not model** (an input modality,
 *      a battery, a gateway's mechanism name) — each carries the reason it exists;
 *   3. **Words the frontend must not rename yet** because the backend publishes a
 *      different spelling for the same concept. Those are recorded for arbitration in
 *      `docs/n8n-lego/decisions/cross-agent-decisions.json` (XA-8, XA-9) and mapped
 *      here, never silently renamed.
 */
export const LOCAL_VOCABULARIES = Object.freeze([
  Object.freeze({
    id: 'surfaceStatus',
    question: 'How ready is this UI surface?',
    values: Object.freeze(['present', 'partial', 'unsupported']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/manifest/surfaces.json', symbol: 'surfaces[].status' }),
    why: 'A surface is a UI area, not a capability: the backend has no counterpart to be right or wrong about.',
  }),
  Object.freeze({
    id: 'unitStatus',
    question: 'How far has this nested unit been implemented?',
    values: Object.freeze(['declared', 'available', 'partial', 'unsupported']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({
        value: 'declared',
        reason: 'the unit declares its contract and its tests before its code — canonical `contract-only`; the spelling travels in the boot payload pinned to the P2.5 baseline, so it is mapped rather than renamed',
      }),
      Object.freeze({
        value: 'available',
        reason: 'an implementation exists for the unit — canonical `implemented`; mapped for the same pinned-payload reason',
      }),
    ]),
    mirror: Object.freeze({ declared: 'contract-only', available: 'implemented', partial: 'partial', unsupported: 'unsupported' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/manifest/sub-legos.json', symbol: 'subLegos[].status' }),
  }),
  Object.freeze({
    id: 'instanceImplementation',
    question: 'How much of this capability does THIS instance implement?',
    values: Object.freeze(['implemented', 'partial', 'unsupported', 'unknown']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({
        value: 'unknown',
        reason: 'the app handed over no usable status; the frontend reports that instead of guessing "implemented"',
      }),
    ]),
    mirror: Object.freeze({ implemented: 'implemented', partial: 'partial', unsupported: 'unsupported', unknown: null }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/backend-view.mjs', symbol: 'BACKEND_STATES' }),
  }),
  Object.freeze({
    id: 'frontendCapabilityDeclaration',
    question: 'What has this frontend declared about a capability of its own?',
    values: Object.freeze(['declared', 'available', 'partial', 'unsupported']),
    mapsTo: 'capabilityStatus',
    extra: Object.freeze([
      Object.freeze({ value: 'declared', reason: 'a catalog entry with a fixed contract and tests but no implementation: canonical `contract-only`' }),
      Object.freeze({ value: 'available', reason: 'the capability is offered here: canonical `implemented`' }),
    ]),
    mirror: Object.freeze({ declared: 'contract-only', available: 'implemented', partial: 'partial', unsupported: 'unsupported' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/registry.mjs', symbol: 'CAPABILITY_STATUSES' }),
  }),
  Object.freeze({
    id: 'capabilityLifecycle',
    question: 'Which lifecycle states does the frontend capability registry use?',
    values: Object.freeze(['available', 'installed', 'loaded', 'active', 'idle', 'unloaded', 'disabled']),
    mapsTo: 'lifecycle',
    extra: Object.freeze([]),
    mirror: Object.freeze({
      available: 'declared',
      installed: 'installed',
      loaded: 'loaded',
      active: 'active',
      idle: 'idle',
      unloaded: 'unloaded',
      disabled: 'disabled',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/lifecycle.mjs', symbol: 'CAPABILITY_STATES' }),
    why: 'Seven of the eleven canonical lifecycle states; `available` here means "in the catalog, nothing resolved", which the canonical vocabulary calls `declared`. Four canonical states (failed, degraded, deprecated and the one the frontend never reaches) are unused rather than renamed.',
  }),
  Object.freeze({
    id: 'unitCriticality',
    question: 'How critical is this UI unit or capability to the instance?',
    values: Object.freeze(['core', 'optional', 'enhancement']),
    mapsTo: 'capabilityCriticality',
    extra: Object.freeze([]),
    mirror: Object.freeze({ core: 'critical', optional: 'standard', enhancement: 'optional' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/lifecycle.mjs', symbol: 'CRITICALITY' }),
    why: 'The same question the backend answers with critical/standard/optional. The mapping is declared (core = failure breaks the instance, optional = absence has a declared fallback, enhancement = absence needs no notice) and the rename is recorded for arbitration rather than performed silently.',
  }),
  Object.freeze({
    id: 'unitTrust',
    question: 'How far may this frontend unit be trusted?',
    values: Object.freeze(['core', 'feature', 'extension', 'untrusted']),
    mapsTo: 'trustLevel',
    extra: Object.freeze([]),
    mirror: Object.freeze({ core: 'core', feature: 'core', extension: 'community', untrusted: 'untrusted' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/lifecycle.mjs', symbol: 'TRUST_LEVELS' }),
    why: '`core` and `feature` are both first-party code, so both map to canonical `core`; `extension` is third-party and unreviewed, which the canonical set calls `community`. Canonical `verified` is unused: no frontend unit has been through a signed review.',
  }),
  Object.freeze({
    id: 'deviceProfile',
    question: 'Which device budget is this UI rendering into?',
    values: Object.freeze(['desktop', 'laptop', 'low-memory', 'android', 'termux-companion', 'remote-only']),
    mapsTo: 'resourceProfile',
    extra: Object.freeze([]),
    mirror: Object.freeze({
      desktop: 'high-resource',
      laptop: 'standard',
      'low-memory': 'low-resource',
      android: 'low-resource',
      'termux-companion': 'low-resource',
      'remote-only': 'remote',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/profiles.mjs', symbol: 'DEVICE_PROFILES' }),
    why: 'A device profile is a browser budget; the canonical resource profiles are machine classes. The mapping is declared so a runtime that declares `low-resource` can be matched to the profiles that can host it.',
  }),
  Object.freeze({
    id: 'budgetField',
    question: 'Which budget facts may a profile or a requirement declare here?',
    values: Object.freeze(['memoryMb', 'storageMb', 'cpuCores', 'input', 'alwaysOnline', 'meteredNetwork', 'onBattery', 'latencyBudgetMs', 'executionModel']),
    mapsTo: 'resourceDimension',
    extra: Object.freeze([
      Object.freeze({ value: 'input', reason: 'a browser budget has an input modality (pointer or touch); a machine dimension list has no counterpart' }),
      Object.freeze({ value: 'onBattery', reason: 'battery presence is a device fact the foundation does not model, and the reason a battery-heavy runtime is placed remotely' }),
    ]),
    mirror: Object.freeze({
      memoryMb: 'memory',
      storageMb: 'disk',
      cpuCores: 'cpu',
      input: null,
      alwaysOnline: 'network',
      meteredNetwork: 'network',
      onBattery: null,
      latencyBudgetMs: 'latency',
      executionModel: 'locality',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/profiles.mjs', symbol: 'BUDGET_FIELDS' }),
  }),
  Object.freeze({
    id: 'gatewayTransport',
    question: 'Which carrier does the frontend gateway have available?',
    values: Object.freeze(['local', 'rest', 'event', 'stream', 'ipc', 'remote']),
    mapsTo: 'transportKind',
    extra: Object.freeze([]),
    mirror: Object.freeze({
      local: 'in-process',
      rest: 'remote',
      event: 'in-process',
      stream: 'in-process',
      ipc: 'worker',
      remote: 'remote',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/transport.mjs', symbol: 'TRANSPORT_KINDS' }),
    why: 'The gateway names the mechanism it implements (`local:direct`, an event dispatcher, a REST client); the canonical vocabulary names the kind. `event` and `stream` are in-process carriers of those interaction classes, not separate kinds.',
  }),
  Object.freeze({
    id: 'traceField',
    question: 'Which fields may a work-trace row carry?',
    values: Object.freeze([
      'sequence', 'eventId', 'timestamp', 'type', 'scope', 'sessionId', 'agentId', 'parentId',
      'taskId', 'executionId', 'runtimeId', 'capability', 'operation', 'status', 'durationMs',
      'summary', 'payloadRef', 'artifactRef', 'decisionRef', 'approvalState',
    ]),
    mapsTo: 'agentEventEnvelopeField',
    extra: Object.freeze([
      Object.freeze({ value: 'sequence', reason: 'a trace is ordered deterministically by (timestamp, sequence); the wire envelope carries no order' }),
      Object.freeze({ value: 'executionId', reason: 'a UI needs to anchor a row to the execution it observed' }),
      Object.freeze({ value: 'runtimeId', reason: 'a UI must be able to say which runtime produced a row' }),
      Object.freeze({ value: 'capability', reason: 'a boundary row names the capability it belongs to' }),
      Object.freeze({ value: 'operation', reason: 'a boundary row names the operation it belongs to' }),
      Object.freeze({ value: 'approvalState', reason: 'a trace records the gate; the canonical words come from decisionApprovalState' }),
    ]),
    mirror: Object.freeze({
      sequence: null,
      eventId: 'eventId',
      timestamp: 'timestamp',
      type: 'type',
      scope: 'scope',
      sessionId: 'sessionId',
      agentId: 'agentId',
      parentId: 'parentId',
      taskId: 'taskId',
      executionId: null,
      runtimeId: null,
      capability: null,
      operation: null,
      status: 'status',
      durationMs: 'durationMs',
      summary: 'summary',
      payloadRef: 'references',
      artifactRef: 'references',
      decisionRef: 'references',
      approvalState: null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agent-events.mjs', symbol: 'TRACE_FIELDS' }),
    why: 'A trace row is the UI projection of an event: the envelope fields keep their canonical names, the three reference fields resolve the envelope\'s `references` map into named slots, and the extras are named UI needs rather than second meanings.',
  }),
  Object.freeze({
    id: 'delegationNodeField',
    question: 'Which fields does a delegation-tree node carry?',
    values: Object.freeze(['agentId', 'parentId', 'sessionId', 'taskId', 'runtimeId', 'status', 'depth', 'children', 'grantedCapabilities', 'effectivePermissions']),
    mapsTo: 'delegationField',
    extra: Object.freeze([
      Object.freeze({ value: 'agentId', reason: 'the UI identifies a node by the agent that ran it' }),
      Object.freeze({ value: 'runtimeId', reason: 'the UI must be able to say which runtime ran the child' }),
      Object.freeze({ value: 'depth', reason: 'nesting depth is derived from parentage for display' }),
      Object.freeze({ value: 'children', reason: 'the tree shape, derived; the edge itself carries parentSessionId/childSessionId' }),
      Object.freeze({ value: 'effectivePermissions', reason: 'what the child actually holds — equal to its own grants, never the parent\'s' }),
    ]),
    mirror: Object.freeze({
      agentId: null,
      parentId: 'parentSessionId',
      sessionId: 'childSessionId',
      taskId: 'task',
      runtimeId: null,
      status: 'status',
      depth: null,
      children: null,
      grantedCapabilities: 'grantedCapabilities',
      effectivePermissions: null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agent-events.mjs', symbol: 'DELEGATION_FIELDS' }),
  }),
  Object.freeze({
    id: 'mcpConnectionState',
    question: 'What does the UI show for one MCP relationship?',
    values: Object.freeze(['connected', 'unavailable', 'permission-required', 'capability-unsupported']),
    mapsTo: 'degradation',
    extra: Object.freeze([
      Object.freeze({ value: 'permission-required', reason: 'the caller may be allowed to do this: a grantable state the degradation vocabulary does not name (it mirrors operationOutcome.permission-missing)' }),
    ]),
    mirror: Object.freeze({
      connected: 'available',
      unavailable: 'capability-unavailable',
      'permission-required': null,
      'capability-unsupported': 'feature-unsupported',
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'MCP_CONNECTION_STATES' }),
  }),
  Object.freeze({
    id: 'installationLayer',
    question: 'Which layers does the frontend report separately?',
    values: Object.freeze(['core', 'aiFoundation', 'inference', 'modelProvider', 'toolGateway', 'agentRuntime', 'simulationRuntime', 'mcp']),
    mapsTo: 'zeroInstallLayer',
    extra: Object.freeze([
      Object.freeze({ value: 'core', reason: 'the editor itself — the foundation does not model it as an AI layer, the UI must not hide it' }),
      Object.freeze({ value: 'inference', reason: 'whether a model can be reached at all; the foundation expresses this through modelProvider, the UI reports the consequence' }),
      Object.freeze({ value: 'simulationRuntime', reason: 'a simulation runtime is declared separately from a real one so a simulation can never read as real work' }),
      Object.freeze({ value: 'mcp', reason: 'the interop layer has its own state; folding it into toolGateway would hide an unconfigured adapter' }),
    ]),
    mirror: Object.freeze({
      core: null,
      aiFoundation: 'aiFoundation',
      inference: null,
      modelProvider: 'modelProvider',
      toolGateway: 'toolProvider',
      agentRuntime: 'agentRuntime',
      simulationRuntime: null,
      mcp: null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'INSTALLATION_LAYERS' }),
  }),
  Object.freeze({
    id: 'aiKindRole',
    question: 'Does this canonical kind provide or execute?',
    values: Object.freeze(['provider', 'runtime']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'AI_KIND_ROLES' }),
    why: 'A label over the five canonical kinds, not a sixth word: model-provider, tool-provider and application-provider are providers; agent-runtime and simulation-runtime execute.',
  }),
  Object.freeze({
    id: 'versionFit',
    question: 'Does what a provider offers satisfy what a consumer requires?',
    values: Object.freeze(['unchanged', 'compatible', 'migration-required', 'breaking', 'downgrade', 'invalid']),
    mapsTo: 'changeKind',
    extra: Object.freeze([
      Object.freeze({ value: 'invalid', reason: 'the two values are not versions, so no question about a change can be answered — the frontend reports that instead of a false compatibility' }),
    ]),
    mirror: Object.freeze({ unchanged: 'unchanged', compatible: 'compatible', 'migration-required': 'migration-required', breaking: 'breaking', downgrade: 'downgrade', invalid: null }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/versions.mjs', symbol: 'COMPATIBILITY' }),
  }),
  Object.freeze({
    id: 'providerKind',
    question: 'Which provider kinds may a provider declaration use here?',
    // Not a view and not a rename: these are the manager's `ai.foundation` provider-kind
    // words, three of the five canonical kinds. Nothing in the boot payload depends on
    // the spelling, so the frontend speaks the canonical words directly.
    values: Object.freeze(['model-provider', 'tool-provider', 'application-provider']),
    mapsTo: 'aiKind',
    extra: Object.freeze([]),
    mirror: Object.freeze({ 'model-provider': 'model-provider', 'tool-provider': 'tool-provider', 'application-provider': 'application-provider' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'PROVIDER_KINDS' }),
    why: 'The canonical set also names the two runtime kinds; a provider declaration must not use them, which is exactly why a declaration carries a kind and a runtime carries a kind from runtimeKind.',
  }),
  Object.freeze({
    id: 'runtimeKind',
    question: 'Which runtime kinds may a runtime declaration use here?',
    values: Object.freeze(['agent-runtime', 'simulation-runtime']),
    mapsTo: 'aiKind',
    extra: Object.freeze([]),
    mirror: Object.freeze({ 'agent-runtime': 'agent-runtime', 'simulation-runtime': 'simulation-runtime' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'RUNTIME_KINDS' }),
    why: 'A simulation runtime is never the same object as a real one, so the two canonical runtime kinds are declared here together and never merged.',
  }),
  Object.freeze({
    id: 'runtimeLocalityView',
    question: 'Where does the UI say an agent runtime runs?',
    values: Object.freeze(['local', 'remote']),
    mapsTo: 'runtimeLocality',
    extra: Object.freeze([
      Object.freeze({
        value: 'local',
        reason: 'the UI asks one question — does this run here or elsewhere — so it collapses the three canonical local localities (in-process, local-process, local-network) into one word; the canonical word travels with the runtime declaration and is shown verbatim when the user asks where it runs',
      }),
    ]),
    mirror: Object.freeze({ local: null, remote: 'remote' }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'RUNTIME_LOCALITY' }),
  }),
  Object.freeze({
    id: 'mcpObjectView',
    question: 'Which MCP objects may the UI represent?',
    values: Object.freeze(['client-capability', 'server-capability', 'tool', 'resource', 'prompt', 'connection', 'authorization', 'availability']),
    mapsTo: 'mcpConcept',
    extra: Object.freeze([
      Object.freeze({
        value: 'availability',
        reason: 'not an MCP object: the state the UI renders for a relationship, whose words come from mcpConnectionState',
      }),
    ]),
    mirror: Object.freeze({
      'client-capability': 'client',
      'server-capability': 'server',
      tool: 'tool',
      resource: 'resource',
      prompt: 'prompt',
      connection: 'connection',
      authorization: 'authorization',
      availability: null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/agents.mjs', symbol: 'MCP_OBJECTS' }),
    why: 'The canonical set names the protocol objects; the UI names what it shows — a capability in the client role and a capability in the server role, never the whole registry.',
  }),
  Object.freeze({
    id: 'frontendCapabilityPermission',
    question: 'Which permission does a frontend capability declare for itself?',
    // Exactly the six words the seven frontend capabilities declare today. Four of them
    // name the same grant as a published `ai:*` permission; the other two name a
    // workflow/execution grant whose domain publishes no permission names at all yet, so
    // they map to nothing and carry the reason — plus XA-8, which asks the manager which
    // namespace should win.
    values: Object.freeze([
      'inference:invoke',
      'workflow:write',
      'agent:delegate',
      'agent:run',
      'agent:observe',
      'execution:escalate',
    ]),
    mapsTo: 'aiPermission',
    extra: Object.freeze([
      Object.freeze({
        value: 'workflow:write',
        reason: 'a workflow-domain grant; no backend contract publishes workflow permission names yet, so there is nothing to map it to (XA-8)',
      }),
      Object.freeze({
        value: 'execution:escalate',
        reason: 'the execution-side effect of handing a run to an agent; the execution domain publishes no permission names yet (XA-8)',
      }),
    ]),
    mirror: Object.freeze({
      'inference:invoke': 'ai:model:invoke',
      'workflow:write': null,
      'agent:delegate': 'ai:agent:delegate',
      'agent:run': 'ai:agent:invoke',
      'agent:observe': 'ai:agent:read',
      'execution:escalate': null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/manifest/capabilities.json', symbol: 'capabilities[].permissions' }),
  }),
  Object.freeze({
    id: 'operationOutcome',
    question: 'Can this operation be executed, and if not, why not?',
    values: Object.freeze([
      'available',
      'degraded',
      'capability-unavailable',
      'optional-absent',
      'version-incompatible',
      'dependency-disabled',
      'migration-required',
      'feature-unsupported',
      'operation-denied',
      'operation-unpublished',
      'permission-missing',
      'permission-unknown',
    ]),
    mapsTo: 'degradation',
    extra: Object.freeze([
      Object.freeze({ value: 'operation-denied', reason: 'the caller is not granted the capability on its surface, so it is refused at the operation level without learning anything about the capability — placement never grants an operation' }),
      Object.freeze({ value: 'operation-unpublished', reason: 'the provider publishes no operation list, so the frontend cannot verify that the operation exists: fail closed rather than assume' }),
      Object.freeze({ value: 'permission-missing', reason: 'the capability declares a required permission the caller does not hold' }),
      Object.freeze({ value: 'permission-unknown', reason: 'the caller requires a permission the capability never declared' }),
    ]),
    /** The first eight are the canonical degradation states verbatim; the last four answer a question canonical degradation does not ask. */
    mirror: Object.freeze({
      available: 'available',
      degraded: 'degraded',
      'capability-unavailable': 'capability-unavailable',
      'optional-absent': 'optional-absent',
      'version-incompatible': 'version-incompatible',
      'dependency-disabled': 'dependency-disabled',
      'migration-required': 'migration-required',
      'feature-unsupported': 'feature-unsupported',
      'operation-denied': null,
      'operation-unpublished': null,
      'permission-missing': null,
      'permission-unknown': null,
    }),
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/negotiation.mjs', symbol: 'OPERATION_STATES' }),
  }),
  /**
   * P2.13 — the two frontend-local word sets the Context & Session surface needs, and the reason
   * neither maps into a canonical set today.
   *
   * Both describe **presentation** of a backend fact, and both name the pending publication that
   * would give them a canonical counterpart (`XA-20`). Neither is a second dialect for a published
   * word: the session states, the context scopes, the fields, the references, the operations and
   * the permissions are all quoted above and used verbatim by `src/context-session.mjs`. What is
   * local is (a) the six things a continuation line may *say*, and (b) the four ways a usage figure
   * may be *sourced* — and the second one exists precisely so that "the backend reported nothing"
   * can never be rendered as a number.
   */
  Object.freeze({
    id: 'continuationAffordance',
    question: 'What may the continuation line say about the link between one context window and the next?',
    values: Object.freeze([
      'continue-session',
      'rollover-preparing',
      'continuation-linked',
      'continuity-verified',
      'continuation-degraded',
      'continuation-failed',
    ]),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/context-session.mjs', symbol: 'CONTINUATION_AFFORDANCES' }),
    why: 'Six UI sentences about a continuation, not six backend states. Three of them render the manager-ruled verification outcomes (`verified`, `degraded`, `failed` — PENDING_PUBLICATIONS.continuationVerification, XA-20), one renders the published context lifecycle state `prepare` (quoted as `contextLifecycle`), one renders the link the backend records when a context is `rolled-over`, and `continue-session` is an *intent* the UI may show while the operation that would serve it is unpublished — `ai.agent-session` publishes create/status/close and the AI set declares a `rollover` verb nobody registered, so the affordance is answered `operation-unpublished` (see operationOutcome) rather than wired to an invented operation. When XA-20 is published these six must be re-declared as a total mapping into the published words, and until then no backend set exists to map into.',
    pendingPublication: 'XA-20',
  }),
  Object.freeze({
    id: 'contextUsageReport',
    question: 'Where did the context usage figure on screen come from?',
    values: Object.freeze(['reported', 'estimated', 'not-reported', 'over-budget']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/context-session.mjs', symbol: 'USAGE_REPORT_STATES' }),
    why: 'A usage figure is either sourced or it is not shown. `reported` means the backend or the provider handed the number over with a declared unit; `estimated` means the backend declared it an estimate and the UI must label it as one; `not-reported` means nobody reported anything, so no percentage is computed and no bar is drawn; `over-budget` means a reported figure exceeded its declared bound. There is no fifth state and no path from `not-reported` to a number: fabricating a token count to fill a percentage is the failure this set exists to make unrepresentable.',
    pendingPublication: 'XA-20',
  }),
  /**
   * The P2.14 Memory surface's own words. Five local sets, each naming a fact about the *rendering*
   * rather than a fact about memory — which is why none of them maps to a backend vocabulary: a
   * backend that published "the list was empty" as a word would be publishing a UI state.
   *
   * What is deliberately absent: there is no `memoryRelevance`, no `memoryScore`, no
   * `memoryConfidence` and no `memoryProvenance` — the published contract has no ranking, no
   * similarity and no confidence, so a set here would be a word nobody can fill. `memoryOrigin`
   * exists because provenance IS published (`provenance.createdBy` / `provenance.source`), and a
   * rendered entry must say where it came from rather than imply it was discovered.
   */
  Object.freeze({
    id: 'memoryListState',
    question: 'What did retrieval actually return?',
    values: Object.freeze(['rendered', 'empty', 'not-handed-over', 'refused']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/memory.mjs', symbol: 'MEMORY_LIST_STATES' }),
    why: '`rendered` means records were handed over and rendered; `empty` means the backend reported zero matches at the requested scope and that is an ANSWER, not an error — the surface says "no memory is stored at this scope" and renders no placeholder records; `not-handed-over` means no list was handed over at all, which is a different state from an empty one and is never rendered as "nothing is remembered"; `refused` means the handed-over payload was rejected (an unknown scope, an undeclared kind, a secret-shaped key, an unbounded body) and the refusal is shown by name. Collapsing `empty` into `not-handed-over` is exactly how a UI ends up telling a user their memory was erased.',
    decision: 'XA-12',
  }),
  Object.freeze({
    id: 'memoryPersistenceState',
    question: 'Is what is on screen actually persisted?',
    values: Object.freeze(['provider-bound', 'in-memory-only', 'not-declared']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/memory.mjs', symbol: 'MEMORY_PERSISTENCE_STATES' }),
    why: 'The published contract puts persistence behind a provider boundary: the default provider is an in-memory map, and the contract is replaceable by SQLite, a filesystem snapshot or a graph store behind the same interface. So a UI may never render "saved" or "saved to your workspace". `provider-bound` means the application declared a provider and the surface names it as declared; `in-memory-only` means the records came from a provider the application described as in-memory, so the surface says they do not outlive the process; `not-declared` means nobody said, and the surface says nothing about durability at all. There is no fourth state and no "cloud-synced".',
    decision: 'XA-12',
  }),
  Object.freeze({
    id: 'memoryOrigin',
    question: 'Where did this memory entry come from?',
    values: Object.freeze(['declared-provenance', 'no-provenance']),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/memory.mjs', symbol: 'MEMORY_ORIGINS' }),
    why: '`memory.json` publishes `provenance` as an optional `{ createdBy?, source? }`, so an entry either carries a declared origin or carries none. An entry with no provenance is rendered as exactly that — never with a guessed author, never with the current user, and never with "agent" as a default. Attribution invented by a UI is a false audit trail.',
    decision: 'XA-12',
  }),
  Object.freeze({
    id: 'memoryAffordance',
    question: 'What may the Memory surface show, and what may it never offer?',
    values: Object.freeze([
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
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/memory.mjs', symbol: 'MEMORY_AFFORDANCES' }),
    why: 'Eleven facts the surface may render, and no operation among them. Memory is read here, never written: the four published operations (`memory.remember`, `memory.recall`, `memory.list`, `memory.forget`) are named as facts and wired to nothing, because a "Forget" button in a UI is a destructive operation with no undo behind a permission the UI does not hold. `memory.list` is the shape a rendered list follows; it is not a call this package makes.',
    decision: 'XA-12',
  }),
  Object.freeze({
    id: 'memoryRefusal',
    question: 'What must a Memory surface never imply?',
    values: Object.freeze([
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
    ]),
    mapsTo: null,
    provenance: Object.freeze({ file: 'packages/frontend-lego/src/memory.mjs', symbol: 'MEMORY_FORBIDDEN_IMPLICATIONS' }),
    why: 'Fourteen relationships a reader could otherwise infer from a memory list. `memory-dump` is first because the contract forbids it in the Declaration itself ("Never dump full memory into context"); `relevance-ranking` and `vector-search` are next because the roadmap mentions a traversable graph and a UI that shows a search box with a score would be promising the deferred half; `provider-connected` is the honesty rule for the provider boundary — an absent provider is `optional-absent`, never a green dot; `automatic-retention` because nothing expires on its own; `memory-to-context-injection` because loading memory into a context is an explicit, bounded caller decision and never a side effect of opening a screen.',
    decision: 'XA-12',
  }),
]);

const BY_ID = new Map([...VOCABULARIES, ...LOCAL_VOCABULARIES].map((set) => [set.id, set]));

export class VocabularyError extends Error {
  constructor(message, { vocabulary = null, value = null } = {}) {
    super(message);
    this.name = 'VocabularyError';
    this.code = 'frontend.vocabulary.unknown-term';
    this.vocabulary = vocabulary;
    this.value = value;
  }
}

/** A vocabulary set by id, or null. */
export function vocabularyOf(id) {
  return BY_ID.get(id) ?? null;
}

/** Is `value` one of the declared terms of `id`? Fail-closed for an unknown set id. */
export function isDeclaredTerm(id, value) {
  const set = BY_ID.get(id);
  if (!set) throw new VocabularyError(`"${id}" is not a declared vocabulary`, { vocabulary: id, value });
  return set.values.includes(value);
}

/** `assertVocabulary`, as a throw: an undeclared term is never a synonym for a declared one. */
export function assertTerm(id, value) {
  if (!isDeclaredTerm(id, value)) {
    const set = BY_ID.get(id);
    throw new VocabularyError(`"${value}" is not a declared ${id} (one of ${set.values.join(', ')})`, { vocabulary: id, value });
  }
  return value;
}

/**
 * Compares an observed vocabulary (values read from a live module, a manifest or a
 * provider declaration) against the lock.
 *
 * @returns {{ id: string, ok: boolean, missing: string[], extra: string[], detail: string }}
 */
export function compareVocabulary(id, observed) {
  const set = BY_ID.get(id);
  if (!set) {
    return Object.freeze({ id, ok: false, missing: [], extra: [], detail: `"${id}" is not a declared vocabulary` });
  }
  const seen = new Set(observed ?? []);
  const missing = set.values.filter((value) => !seen.has(value));
  const extra = [...seen].filter((value) => !set.values.includes(value)).sort();
  return Object.freeze({
    id,
    ok: missing.length === 0 && extra.length === 0,
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
    detail: missing.length === 0 && extra.length === 0
      ? `${set.values.length} terms match`
      : `missing: [${missing.join(', ')}]; undeclared: [${extra.join(', ')}]`,
  });
}

/**
 * A drift report over several vocabularies at once, e.g. everything read from the
 * backend foundation in one pass. Unknown ids are reported, never skipped: a
 * comparison that silently checks nothing is worse than no comparison.
 */
export function vocabularyDrift(observed = {}) {
  const reports = Object.keys(observed)
    .sort()
    .map((id) => compareVocabulary(id, observed[id]));
  return Object.freeze({
    ok: reports.every((report) => report.ok),
    reports: Object.freeze(reports),
    summary: reports.map((report) => `${report.id}: ${report.ok ? 'ok' : report.detail}`).join('; '),
  });
}

/**
 * Self-audit of the lock itself — the check that keeps a vocabulary from quietly
 * growing a second meaning.
 *
 * * classes of conflict: a local set that names a canonical vocabulary must map every
 *   value into it, and every value it adds must be declared with a reason;
 * * a value may not appear in two canonical vocabularies with different meanings
 *   unless the overlap is intentional and declared (`sharedTerms`).
 */
/**
 * The overlaps that ARE declared, with the reason each one is not drift: two subjects
 * that quote the same word from the backend and mean it differently must be named
 * here, or `vocabularyConflicts()` reports them.
 *
 * A vocabulary may also declare its **subject** (`about`): two sets about the same
 * subject that share a spelling are the same word about the same thing — `sessionId`
 * is one field whether it appears in an event envelope or a session record, and `high`
 * is one amount whether it describes risk or a resource class. Sharing across
 * *different* subjects is what needs the declaration below.
 */
export const DECLARED_OVERLAPS = Object.freeze([
  Object.freeze({
    vocabularies: Object.freeze(['agentSessionState', 'continuationVerification']),
    values: Object.freeze({
      failed: 'a session can fail and a continuation can fail to survive: two declared subjects (`state` and `verification`), one English word, both quoted from the published backend and neither re-defined here',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['degradation', 'continuationVerification']),
    values: Object.freeze({
      degraded: 'a capability is degraded when something it needs is missing; a continuation is degraded when a section did not survive. Same spelling, two declared subjects, both quoted',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['lifecycle', 'continuationVerification']),
    values: Object.freeze({
      degraded: 'a lifecycle state of a capability, and a verification result of a continuation — quoted from two published declarations, mapped to two different UI facts',
      failed: 'a lifecycle state and a verification result; the frontend never renders one as the other (a failed continuation is not a failed capability)',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['trustLevel', 'continuationVerification']),
    values: Object.freeze({
      verified: 'a trust level is a property of a declaration (`XA-9` owes it a contract); a verification result is a property of a continuation (`ai.context@1.0.0` publishes it). Shared spelling, distinct subjects',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['degradation', 'lifecycle']),
    values: Object.freeze({
      available: 'a lifecycle state here, an availability there — both quoted from lego.negotiation/lego.interaction, neither re-defined',
      degraded: 'the same word for the same fact from two angles: a unit is degraded because a capability it needs is degraded',
      'migration-required': 'a version move here, an availability there; the availability is the version move seen by a caller',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['deviceClass', 'mcpConcept']),
    values: Object.freeze({
      server: 'a machine class on one side, the server role of an MCP relationship on the other — deliberately declared, because the two must never be mixed',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['changeKind', 'degradation']),
    values: Object.freeze({
      'migration-required': 'a change kind here (the version move A -> B), an availability there (what that move means to a caller); one fact, two angles, both quoted',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['resourceProfile', 'runtimeLocality']),
    values: Object.freeze({
      remote: 'a resource class satisfied off this machine, and the locality of the runtime that satisfies it — the class is a consequence of the locality',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['resourceProfile', 'transportKind']),
    values: Object.freeze({
      remote: 'a resource class that is satisfied elsewhere, and a transport kind that moves bytes over a link; the remote resource class implies the remote transport, not the reverse',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['degradation', 'skillLifecycle']),
    values: Object.freeze({
      available: 'the canonical availability word ("this may serve a caller") and the skill state "this is offered for selection" — one spelling about two subjects, both quoted, neither re-defined',
    }),
  }),
  /**
   * `status` is one spelling about three subjects, all quoted: an operation a session capability
   * publishes (`ai.agent-session.status` — "read the session state"), a field a session record
   * carries (the state itself), a field an event envelope carries, and a field a delegation edge
   * carries. Naming the operation `status` is the backend's published choice, so the overlap is
   * declared here rather than resolved by renaming one of them (P2.13, `XA-20` records the
   * publication question; the overlap itself is not a difference).
   */
  Object.freeze({
    vocabularies: Object.freeze(['agentSessionOperation', 'agentSessionField']),
    values: Object.freeze({
      status: 'the published operation that reads a session state, and the field that holds it — one word about two subjects (an act and a fact), both quoted from the backend, neither re-defined',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['agentSessionOperation', 'agentEventEnvelopeField']),
    values: Object.freeze({
      status: 'the session operation that asks for state, and the envelope field that reports the state of whatever happened — an act on one side, a fact on the other',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['agentSessionOperation', 'delegationField']),
    values: Object.freeze({
      status: 'the session operation that reads state, and the delegation field that carries a child edge\'s state — the same published spelling about two different records',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['aiLegoStatus', 'capabilityStatus']),
    values: Object.freeze({
      implemented: 'the same word about the same fact read from two declarations: the AI set spells a LEGO\'s maturity, the registry spells a capability\'s maturity',
      'contract-only': 'the contract is fixed and testable, no implementation exists — one status in the AI set, one in the registry',
      planned: 'intended, no contract fixed yet — one status word in both declarations',
      deferred: 'deliberately postponed in both declarations, for the same reason',
    }),
  }),
  /**
   * The P2.14 Memory overlaps. Four declared, each one a shared *word* between two subjects that a
   * reader could otherwise conflate — and conflating them is the failure, not the word.
   */
  Object.freeze({
    vocabularies: Object.freeze(['memoryKind', 'memoryGraphNode']),
    values: Object.freeze({
      decision: 'a memory record can BE about a decision (`memoryKind`), and a decision is also one of the ten things a record can point at (`memoryGraphNode`). One spelling, two subjects: the entry`s category and the thing it references. Both are quoted from `ai.memory@1.0.0` and neither re-defines the other',
      artifact: 'the same split: `artifact` as the kind of a memory entry, and `artifact` as an addressable graph node. A record of kind `artifact` is not by itself a reference to one — that is what its `references` array declares',
      task: 'a `task` memory is a record ABOUT a task, never a running task (the contract says so in `kindRule`), and `task` is also a graph node a record may point at. The UI renders the kind and the reference as two different facts',
      execution: '`execution` as a memory kind (a record about a run) and `execution` as a graph node (a run a record points at). Execution STATE still comes from the `execution.*` domain and never from a memory record',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['artifactRetention', 'memoryGraphNode']),
    values: Object.freeze({
      session: 'an artifact retention class (`artifactRetention`, ai.foundation) and an addressable memory graph node (`memoryGraphNode`, ai.memory). Two declared subjects, one English word, both quoted',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['delegationField', 'memoryKind']),
    values: Object.freeze({
      task: '`task` is a FIELD of a delegation edge (what the child was asked to do) and a KIND of a memory record (what was remembered). Same spelling, two declared subjects',
    }),
  }),
  Object.freeze({
    vocabularies: Object.freeze(['delegationField', 'memoryGraphNode']),
    values: Object.freeze({
      task: '`task` is a delegation field and a memory graph node. A delegation declares the task; a memory record may point at one',
    }),
  }),
]);

/**
 * Self-audit of the lock itself — the check that keeps a vocabulary from quietly
 * growing a second meaning.
 *
 * * a local set that names a canonical vocabulary must map every value into it, and
 *   every value that maps to *nothing* must be declared with a reason;
 * * a value may not appear in two canonical vocabularies unless the two share a
 *   declared subject (`about`) or the overlap is declared with its reason.
 */
export function vocabularyConflicts({ sharedTerms = DECLARED_OVERLAPS } = {}) {
  const conflicts = [];

  for (const set of LOCAL_VOCABULARIES) {
    if (set.mapsTo === null) {
      if (set.extra !== undefined && set.extra.length > 0) {
        conflicts.push(`${set.id} declares extra values but maps to no canonical vocabulary`);
      }
      continue;
    }
    const canonical = BY_ID.get(set.mapsTo);
    if (!canonical) {
      conflicts.push(`${set.id} maps to unknown vocabulary "${set.mapsTo}"`);
      continue;
    }
    const mirrored = new Set(Object.keys(set.mirror ?? {}));
    for (const value of set.values) {
      if (!mirrored.has(value)) conflicts.push(`${set.id} value "${value}" has no declared mapping into ${set.mapsTo}`);
      const target = set.mirror?.[value] ?? null;
      if (target !== null && !canonical.values.includes(target)) {
        conflicts.push(`${set.id} maps "${value}" to "${target}", which ${set.mapsTo} does not declare`);
      }
    }
    for (const [value, target] of Object.entries(set.mirror ?? {})) {
      const needsReason = target === null;
      const declared = (set.extra ?? []).find((entry) => entry.value === value);
      if (needsReason && !declared) {
        conflicts.push(`${set.id} value "${value}" maps to no ${set.mapsTo} term and carries no declared reason`);
      }
    }
    for (const declared of set.extra ?? []) {
      if (!set.values.includes(declared.value)) {
        conflicts.push(`${set.id} declares a reason for "${declared.value}", which is not one of its values`);
      }
    }
  }

  const declared = (a, b, value) => sharedTerms.some((entry) => {
    const [left, right] = entry.vocabularies;
    return (left === a && right === b) || (left === b && right === a) ? value in entry.values : false;
  });

  for (const set of VOCABULARIES) {
    for (const other of VOCABULARIES) {
      if (set.id >= other.id) continue;
      const sameSubject = set.about !== undefined && set.about === other.about;
      if (sameSubject) continue;
      const overlap = set.values.filter((value) => other.values.includes(value));
      for (const value of overlap) {
        if (!declared(set.id, other.id, value)) {
          conflicts.push(`"${value}" is declared by both ${set.id} and ${other.id} without a declared overlap`);
        }
      }
    }
  }

  return Object.freeze({
    ok: conflicts.length === 0,
    conflicts: Object.freeze(conflicts),
    checked: VOCABULARIES.length + LOCAL_VOCABULARIES.length,
    declaredOverlaps: sharedTerms.length,
  });
}

/**
 * Capability identity, normalised once and explicitly.
 *
 * A capability id is `<domain>.<name>` in lower kebab case — the same grammar the
 * operation names use. Normalisation is *not* a reformatting service: it lowercases
 * and trims only, and anything else is refused, so two spellings can never both be
 * "the" capability. Whether two ids collide is a separate question (`detectCollisions`).
 */
export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

export function normaliseCapabilityId(value) {
  if (typeof value !== 'string') {
    throw new VocabularyError(`a capability id must be a string, got ${typeof value}`, { vocabulary: 'capabilityId', value });
  }
  const trimmed = value.trim().toLowerCase();
  if (!CAPABILITY_ID_PATTERN.test(trimmed)) {
    throw new VocabularyError(`"${value}" is not a capability id (expected <domain>.<name> in lower kebab case)`, { vocabulary: 'capabilityId', value });
  }
  return trimmed;
}

/**
 * Where a name is used twice, with the origins kept apart.
 *
 * A frontend capability and a backend-advertised capability that share an id are not
 * synonyms: the frontend reports the collision and both origins, and never merges the
 * two. This is the machine-readable half of "no second semantic identity".
 *
 * @param {Array<{ id: string, origin: string }>} entries
 */
export function detectCollisions(entries = []) {
  const byId = new Map();
  for (const entry of entries) {
    const id = normaliseCapabilityId(entry.id);
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id).add(entry.origin);
  }
  const collisions = [...byId.entries()]
    .filter(([, origins]) => origins.size > 1)
    .map(([id, origins]) => Object.freeze({ id, origins: Object.freeze([...origins].sort()) }));
  return Object.freeze({
    collisions: Object.freeze(collisions),
    ok: collisions.length === 0,
    detail: collisions.length === 0
      ? `${byId.size} capability ids, each with exactly one origin`
      : collisions.map((entry) => `${entry.id}: ${entry.origins.join(' + ')}`).join('; '),
  });
}

/** The lock as data, for docs, `.ai/` cards, the contract document and tests. */
export function describeVocabulary() {
  return Object.freeze({
    quotedFrom: QUOTED_FROM,
    canonical: Object.freeze(VOCABULARIES.map((set) => Object.freeze({
      id: set.id,
      question: set.question,
      size: set.values.length,
      values: set.values,
      contract: set.provenance.contract,
      publicationPending: set.publicationPending ?? null,
      openDecision: set.openDecision ?? null,
      declaredIn: `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`,
    }))),
    local: Object.freeze(LOCAL_VOCABULARIES.map((set) => Object.freeze({
      id: set.id,
      question: set.question,
      values: set.values,
      mapsTo: set.mapsTo,
      extra: Object.freeze((set.extra ?? []).map((entry) => entry.value)),
      declaredIn: `${set.provenance.file}#${set.provenance.symbol ?? set.provenance.path}`,
    }))),
    rules: Object.freeze([
      'A shared word is quoted from the contract that owns it, with its version — never re-invented here.',
      'A frontend-local word declares what it maps to; a word with no mapping carries its reason.',
      'An undeclared term is refused (fail closed), never treated as a synonym.',
      'Capability ids are normalised once (trim, lowercase, <domain>.<name>); two spellings never both name one capability.',
      'Two origins sharing an id are a reported collision, not a merge.',
      'Two vocabularies may share a spelling only when they share a declared subject, or when the overlap is declared with its reason.',
      'A file no contract row publishes is declared pending with the owner and the decision that asks for one — never assigned to the closest-sounding contract.',
    ]),
  });
}
