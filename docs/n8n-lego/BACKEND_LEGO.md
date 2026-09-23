# Backend LEGO foundation (P2.6) + lifecycle certification (P2.7) + P2.13 implementation overlay

> The sections below retain historical P2.6/P2.7/P2.11 evidence. They are not rewritten to look current. Current granular status is canonical in `docs/n8n-lego/milestones.json` and generated in `.ai/master/MILESTONE_REGISTER.md`.

**Current milestone:** P2.13 — Context & Session (**in-progress on Agent 2; not complete until Manager reconciliation, merge validation and post-merge verification**).

**Protected main baseline:** `e754c5df35b41b0ff2ac769519f05f056835411c` (P2.12 Skill baseline).

**P2.13 implementation:** `apps/n8n-lego/src/lego/context-session.mjs`, public contracts `context.mjs` and `agent-session.mjs`, contract locks `ai.context@1.0.0` and `ai.agent-session@1.0.0`. AI runtime, Memory persistence, Workspace execution, MCP/Runtime Adapter runtime, Agent Machine loop and Rust remain out of scope.

* **P2.6** built the socket system: domain boundaries, ownership, contracts,
  error identity, versioning, the legacy boundary and a mechanical isolation gate.
* **P2.7** certifies that the architecture survives *change*: nested LEGO
  (§13), independent sub-LEGO upgrade (§14), implementation replacement (§15),
  contract compatibility decisions (§14), and scale-out readiness (§16) — with
  an honest statement of what is **not** yet ready.

P2.6 builds the **socket system**, not the bricks. No workflow, execution, auth,
credentials, node-registry, dynamic-parameter, storage or worker feature was
implemented here, and no Rust was written — Rust stays locked, JavaScript stays
the active backend. What P2.6 adds is the set of mechanisms that make future
domains developable in parallel without hidden coupling:

| deliverable | where |
| :--- | :--- |
| domain + capability registry | `apps/n8n-lego/src/lego/manifest/domains.json` |
| registry API (the programmatic contract) | `apps/n8n-lego/src/lego/registry.mjs` |
| machine-readable error contract | `apps/n8n-lego/src/lego/contracts/errors.contract.json` + `src/lego/errors.mjs` |
| contract versioning lock | `apps/n8n-lego/src/lego/contracts/contract-lock.json` |
| architecture/isolation gate | `tools/lego/architecture-gate.mjs` (+ `.core.mjs`, `.selftest.mjs`) |
| capability conformance check | `tools/lego/capability-conformance.mjs` |
| reference LEGO template | `apps/n8n-lego/src/reference-lego/` |
| foundation contract tests | `apps/n8n-lego/test/lego-foundation.test.mjs` (24 tests) |
| contract compatibility model (P2.7) | `apps/n8n-lego/src/lego/compat.mjs` |
| nested reference LEGO (P2.7) | `apps/n8n-lego/src/reference-lego/sub/**` |
| scale-out readiness check (P2.7) | `tools/lego/scale-out-readiness.mjs` |
| lifecycle certification tests (P2.7) | `apps/n8n-lego/test/lego-lifecycle.test.mjs` (28 tests) |

---

## 1. What a backend LEGO is

A directory is not a LEGO. In this repository a LEGO is a domain that has all
seven of the following, or it does not exist:

```
LEGO
├── contract        a declared PUBLIC surface (the only thing consumers may import)
├── implementation  private files nobody outside the domain may reach
├── tests           contract tests, referenced from the contract lock
├── capability      one or more capability ids with a declared status
├── dependencies    an explicit dependsOn / mustNotDependOn list
├── ownership       exactly one owning agent
├── version         a contract version + what counts as a breaking change
└── sub-LEGO        zero or more child LEGOs, each with all of the above (P2.7)
```

All seven are recorded as data in `src/lego/manifest/domains.json`, so a human
reads them and `tools/lego/architecture-gate.mjs` enforces them.

## 2. The registry

One manifest describes every backend domain. A domain entry:

```json
{
  "id": "execution",
  "owner": "agent-2",
  "kind": "domain",
  "status": "partial",
  "phase": "P3",
  "errorNamespace": "execution",
  "paths": ["src/engine.mjs"],
  "public": [],
  "dependsOn": ["platform-kernel", "compatibility", "storage"],
  "mustNotDependOn": ["workflow", "legacy-rest", "auth", "runtime-host"],
  "contract": { "version": "0.1.0", "tests": ["test/rest.test.mjs"] },
  "capabilities": [{ "id": "execution.run-manual", "status": "implemented" }]
}
```

`kind` says what structural role the entry plays: `domain`, `kernel`, `boundary`
(the compatibility layer), `legacy` (the strangler zone), `composition-root`
(the server), `governance` (the foundation itself) or `template`.

`status` is the honest implementation state — `implemented`, `partial`,
`planned`, `legacy`, `unsupported`, `deferred`, `template`. P2.6 does **not**
claim domains are isolated that are not: `workflow`, `execution`, `credentials`
and `workspace` still have most of their behaviour inside the legacy aggregate,
and the manifest says so.

Registered domains (21): `platform-kernel`, `lego-foundation`, `compatibility`,
`auth`, `credentials`, `workflow`, `execution`, `node-registry`,
`dynamic-parameters`, `webhook`, `storage`, `worker`, `realtime`, `settings`,
`editor-ui-host`, `workspace`, `observability`, `data-tables`, `legacy-rest`,
`runtime-host`, `reference-lego`.

## 3. Public contract vs internal implementation

**PUBLIC** (listed in the domain's `public` array, and in the contract lock):
contracts, request models, response models, error codes, capability metadata,
stable interfaces.

**PRIVATE** (everything else in the domain's `paths`): implementation, persistence,
internal helpers, internal algorithms, internal data structures. A path segment
named `internal/` is *always* private, in every domain, and cross-domain imports
of it fail the gate unconditionally.

The rule the gate enforces: **when a domain declares a public surface, consumers
may import only from that surface.** A domain with an empty `public` array has
published nothing yet — nobody may import it at all except through an explicit,
time-boxed allowance (§7).

That is what makes a domain replaceable: `src/reference-lego/internal/store.mjs`
can become SQLite tomorrow and no consumer changes, because no consumer can name
it today.

## 4. Dependency direction

Direction is declared per domain, not inferred. The intended graph, derived from
the real repository rather than invented:

```
                       platform-kernel  (config, logger — graph leaf)
                              ▲
        ┌────────────┬────────┴────────┬─────────────┐
   compatibility   storage        node-registry   editor-ui-host
        ▲             ▲                ▲
   ┌────┴────┐        │                │
 auth    settings     │                │
   ▲                  │                │
   │             execution ────────────┘ (contract only)
   │                  ▲
   │              workflow  →  execution contract
   │                  ▲
   └──────────── legacy-rest (strangler zone, shrinking)
                       ▲
                 runtime-host (composition root — imports everything, imported by nothing)
```

Hard rules, each with a test and a gate selftest case:

* `workflow` → `execution` **contract** is allowed; `execution` → `workflow` is
  forbidden (`mustNotDependOn`).
* `storage` internals must never depend on a consuming domain — storage's
  `mustNotDependOn` lists every consumer.
* `node-registry` must never reach the credential (or storage) persistence
  implementation.
* `platform-kernel` depends on nothing.
* Cross-domain cycles are rejected outright by `validateRegistry()`.

The composition root (`src/server.mjs`, `bin/`) is the single exception: wiring
implementations together is its entire job, and nothing imports it back, so it
cannot create a cycle.

## 5. Shared kernel rule

The shared kernel is `platform-kernel`: **`src/config.mjs` and `src/logger.mjs`,
and nothing else.**

To be admitted to the kernel, a thing must satisfy all four:

1. it is a genuine cross-domain primitive (≥ 3 domains need it),
2. it has a named owner (currently: manager),
3. it has a contract version and stated compatibility expectations,
4. it has test coverage.

Explicitly forbidden, and the reason:

* `common/`, `utils/`, `helpers/`, `shared/`, `lib/misc` — a dumping ground has
  no owner, so nobody can ever break a dependency on it.
* Business logic of any domain. If two domains "share" behaviour, one of them
  owns it and publishes a contract; the other consumes it.
* Types/shapes that belong to one domain. A workflow shape is workflow's, even
  if execution reads it — that is what the contract is for.
* Anything with I/O side effects beyond process configuration and logging.

A kernel addition is a Manager decision, not a domain-owner decision.

## 6. The compatibility layer is a boundary, not a monolith

```
n8n editor UI (pinned 2.9.4, never patched)
        │ HTTP + WebSocket
        ▼
src/compat/   ← translation only
        │  route semantics · auth context · request/response shape · errors · capability state
        ▼
backend LEGO domains
```

`compatibility` may translate. It may **not** decide. Its `mustNotDependOn` list
contains `workflow`, `execution`, `storage`, `node-registry`, `credentials` and
`legacy-rest`, so the gate blocks the exact failure mode where every new feature
quietly lands in `src/compat/` and the boundary becomes the new monolith. The
contract test *"the compatibility layer may not become the new monolith"* asserts
that list stays in place.

The one thing it does own outward is the **capability contract**: unknown
`/rest/*` paths answer `501 {code:'unsupported', meta:{feature, owner, phase}}`.
`tools/lego/capability-conformance.mjs` proves the `owner` and `phase` the
frontend reads over the wire are the same ones the architecture declares — two
registries that cannot drift.

## 7. Legacy strangler boundary

Already isolated (own directory, own registry entry, gate-enforced):
`src/compat/`, `src/auth/` + `src/auth.mjs`, `src/settings/`, `src/lego/`,
`src/reference-lego/`, `src/engine.mjs`, `src/store.mjs`, `src/catalog.mjs`,
`src/push.mjs`, `src/ui.mjs`, `src/checksum.mjs`, `src/config.mjs`,
`src/logger.mjs`, `src/server.mjs`, `bin/`.

Still legacy: **`src/rest/routes.mjs`** (845 lines) — the aggregate holding
workflow CRUD, execution history, credentials CRUD, projects, tags, node types
and license/cosmetic endpoints.

The controlled boundary, rather than a big-bang refactor:

* The zone is **frozen**: `legacy.files` lists exactly one file, and rule **R5**
  fails the build if a new file appears inside `src/rest/`. The zone may shrink,
  never grow.
* The zone keeps its historical reach into domain internals
  (`legacy.allowInternalImports: true`) — new domains do not get that licence.
* Nothing may import the zone except the composition root.
* Each route prefix has a declared migration target
  (`legacy.migrationTargets`), so a carve-out is a lookup, not a debate:

  | prefix | moves to | phase |
  | :--- | :--- | :--- |
  | `/rest/workflows`, `/rest/active-workflows`, `/rest/tags` | `workflow` | P3 |
  | `/rest/executions` | `execution` | P3 |
  | `/rest/projects` | `workspace` | P3 |
  | `/rest/credentials` | `credentials` | P5 |
  | `/rest/types`, `/rest/node-types` | `node-registry` | P6 |
  | `/rest/license` | `compatibility` | — |

Temporary allowances (the three internal imports that exist today, each with an
owner, a deadline and an explicit `state` — rule **R8** deletes them
automatically when they heal). **All three are still `open` after P2.7**;
reviewed 2026-09-22 and none were hidden or quietly widened:

| id | import | owner | by | state | resolution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| A1 | `src/compat/auth-context.mjs` → `src/auth.mjs` | agent-3 | P5 | **open** | publish `toPublicUser` via an auth contract module |
| A2 | `src/settings/routes.mjs` → `src/auth.mjs` | agent-3 | P5 | **open** | publish `hasOwner` via the auth contract |
| A3 | `src/engine.mjs` → `src/store.mjs` | agent-5 | P8 | **open** | publish a storage contract (id allocation + collection ports) — the same work that clears the two blocking scale-out findings (§16) |

## 8. Error contract

Backend errors carry **stable semantic identity**; the frontend owns
presentation. Codes are `<namespace>.<reason>`, the namespace comes from the
owning domain's `errorNamespace`, and the catalogue lives in JSON so tooling and
the frontend can read it without executing JavaScript:

```
auth.unauthorized · auth.forbidden · auth.invalid_credentials · auth.owner_already_exists · auth.user_not_found
credential.not_found · credential.type_unknown
workflow.not_found · workflow.invalid · workflow.checksum_mismatch
execution.not_found · execution.failed · execution.timeout
node.not_found · node.catalog_unavailable
storage.not_found · storage.conflict · storage.unavailable
webhook.not_registered · workspace.project_not_found
compat.bad_request · compat.payload_too_large · compat.internal_error
unsupported            (kept namespace-free — the P2 wire contract)
```

Rules:

* a code is stable once published; renaming or removing one is **breaking**,
* each code declares the HTTP status the compatibility layer emits for it,
* messages are developer-facing English only — **no language packs ship in the
  backend**, and a contract test asserts the JSON contains no `translations` key,
* domains raise codes via `assertErrorCode()`, which throws on an unknown code,
  so an invented code fails at development time instead of reaching the UI,
* `src/lego/errors.mjs` is deliberately transport-free: a domain raises identity,
  `src/compat/error.mjs` renders the HTTP response. That keeps the error contract
  importable by a CLI, a worker or a test without dragging in the boundary.

This is the prerequisite the future Translation LEGO needs: it keys off `code`,
never off an English string. Building translation itself is out of P2.6 scope.

## 9. Contract versioning

`src/lego/contracts/contract-lock.json` has one row per public contract:
id, owner, domain, version, status, surface files, **exported symbols**,
consumers, contract tests.

* **breaking** (major): removing/renaming an export; removing a code or changing
  its status; changing a field's meaning or required shape; narrowing input;
  moving a file out of the public surface.
* **minor**: adding an export, an optional field, a code, a capability.
* **patch**: docs, internal changes with no surface change.
* Contracts at `0.x` are provisional — they may break with a minor bump, but the
  bump is still mandatory.
* A breaking change needs: the major bump, a note in §Contract changelog below,
  and sign-off from every consumer listed in the row.

Rule **R7** of the gate diffs the declared exports against the real exported
symbols, so a contract cannot drift silently: adding `foo` to a locked contract
file fails the build until the lock and version are updated.

The current contract lock has **47 rows**. The historical foundation set remains:
`compat.http` (1.0.0), `lego.error-contract` (1.0.0), `lego.domain-registry` (1.1.0),
`lego.contract-compat` (1.0.0), `kernel.platform` (1.0.0), `reference.lego` (1.1.0),
`reference.validation` (1.1.0), `reference.validation.schema` (1.0.0), and
`reference.repository` (1.0.0). P2.12 added `ai.skill@1.0.0`; P2.13 added the smallest
published Context & Session rows: `ai.context@1.0.0` and `ai.agent-session@1.0.0`; P2.14
added `ai.memory@1.0.0`; P2.15 added `ai.workspace@1.0.0`; P2.16 added the bounded Agent
Machine execution foundation row `ai.agent-machine@1.0.0`.
P3 slices (A…N), P9.1 and P2.25/P2.26 added their own execution, workflow, telemetry and gateway rows;
P6.1 added `node.registry@0.1.0`.
P6.2 added `registry.compiler@0.1.0`.
P6.3 added `package.transaction@0.1.0`.
P6.4 added `registry.closure@0.1.0`.
P6.5 added `node.resolution@0.1.0`.
The machine-readable lock is authoritative.

A domain that publishes several contracts names its **primary** one
(`contract.id`), so R9 can compare the registry and the lock without ambiguity.

### Contract changelog

| date | contract | version | change |
| :--- | :--- | :--- | :--- |
| 2026-09-24 | `node.resolution` | 0.1.0 | P6.5: workflow node resolution manifest — exact pins (identity + declaration digest + the epoch digest resolved against), so which implementation a run used is a stored fact rather than a reconstruction; resolution states match/missing/changed where `changed` (same identity, different bytes) is a registry integrity violation and `missing` is fatal even when a candidate version exists (nothing is silently dropped from a workflow); two-phase explicit upgrade (planning changes nothing; applying needs authorization, a matching revision and a proposal that still equals what the epoch would produce — stale proposals are refused, not merged) with the policy inside the proposal and recorded in history; monotonic revisions and append-only history; deterministic manifest digest. Reads epochs from P6.2 and identity from P6.1; touches no P3 internals. Leases, residency, capabilities, fingerprints and health remain P6.6+ (Issue #100) |
| 2026-09-24 | `registry.closure` | 0.1.0 | P6.4: dependency closure + content-addressed artifact store — deterministic, topologically ordered closure (dependency before dependent) over a catalogue handed in as data, with a stated semver subset (`*`, exact, caret, tilde; a pre-release is never selected unless a requirement names it); every supply-chain-burning refusal reported with who asked for what (missing required, unsatisfiable range, version conflict, declared conflict checked against the COMPLETE closure, cycle with its path named, depth and size ceilings); optional means may-be-absent never may-be-wrong; content addressing where an address IS the hash of the content (identical bytes dedupe, corruption is refused and never re-addressed); store manifest with a deterministic digest; garbage collection that requires the caller's live set. Install, journal and fence stay P6.3's; workflow pins, leases and attestation remain P6.5+ (Issue #100) |
| 2026-09-24 | `package.transaction` | 0.1.0 | P6.3: transactional package install + single-flight — fixed step order (`resolve → prepare → verify → stage → publish → activate`, none skippable, enforced as a proof rather than logged); `publish` named as the visibility boundary, with recovery asymmetric across it (attempts left → resume; exhausted → abort before it, roll back after it); explicit attempt numbering (replaying a recorded attempt is a no-op even after close, a new attempt counts toward a ceiling of two, a gap is a lost report) so a retry loop cannot escape the ceiling and a crashed driver can still reconcile its journal; fenced publication (must name the epoch digest it makes visible and hold the current install lease — a stale fence has no authority); immutable transaction and gate values; deterministic journal digest. The host does the IO and holds write authority; this contract plans, judges and refuses. Dependency closure, artifact store, leases, residency and health remain P6.4+ (Issue #100) |
| 2026-09-24 | `registry.compiler` | 0.1.0 | P6.2: registry compiler + immutable epoch — deterministic compile (digest is a pure function of content and lineage; invariant under key order, declaration order and capability order; no clock, filesystem or network in the module), all-or-nothing compile (one invalid declaration or one duplicate identity yields no epoch, reusing P6.1's reasons rather than inventing new ones), monotonic chained history (parent digest + full chain; a rollback is a NEW higher-numbered epoch carrying older content, so a downgrade is visible instead of silent), atomic publication (pointer move between deep-frozen epochs; the previous epoch stays bit-identical and a failed publication half-applies nothing), integrity verification (recompile and compare) and a sorted content diff. Identity, validation and per-declaration digests are quoted from `node.registry@0.1.0`; `node.portability@1.0.0` stays the domain's primary contract. Package mutation, install journal, dependency closure, leases and residency remain P6.3+ (Issue #100) |
| 2026-09-23 | `node.registry` | 0.1.0 | P6.1: initial lock of the canonical node registry contract — identity is `type` + `typeVersion` (rendered `type@typeVersion` as the pinned catalog writes it) and nothing else; a closed 17-field metadata schema (package, vendor, contract/implementation version, digest, provenance, capabilities, trust class, runtime locality, resource profile, compatibility, lifecycle, health, discovery); trust, capability, runtime, failure-boundary, resource-class, lifecycle and portability vocabulary quoted from the foundation manifest, `lego.negotiation` and `node.portability`; unknown field/trust/capability/runtime/lifecycle/health or an unverifiable digest refuses; duplicate identities are a conflict, never a precedence rule; nothing is published when any entry is invalid. Compiler, epochs and atomic publication remain P6.2 (Issue #100) |
| 2026-09-23 | `observability.structured-log` | 1.0.0 | P9.2: severity reuses P9.1; error taxonomy derives from locked source codes; bounded numeric/boolean attributes and all-message redaction before admission; no sink or kernel logger replacement. |
| 2026-09-23 | `observability.envelope` | 1.0.0 | P9.1: bounded native envelope and reusable correlation context, exact-version canonical codec, secret-field exclusion; product owner agent-6, implementation delegate Agent 4 (#101). No producer/runtime wiring. |
| 2026-09-23 | `execution.optimizer` | 1.0.0 | P3 Slice K: initial lock of the execution optimizer — semantics-safe fusion (pure whitelist + single-consumer/single-dep) and exact-fingerprint node-result cache; opt-in transforms, elimination/canonical identity stays in execution.ir (Issue #97) |
| 2026-09-23 | `execution.guard` | 1.0.0 | P3 Slice M: initial lock of the resource guard — six mandatory budgets, five priority lanes, three-tier pressure, admit/defer/reject with no clock (Issues #75/#79) |
| 2026-09-23 | `compatibility.oracle` | 1.0.0 | P3 Slice L: initial lock of the compatibility oracle — four Issue #91 modes, nine canonical observables, fail-closed equivalence, bounded #91(c) toggle sweep with identity recovery; zero-import (Issue #91) |
| 2026-09-23 | `execution.ir` | 1.0.0 | P3 Slice J: initial lock of the execution IR — raw compile, independently disableable optimizations (#91(c): noopPassthrough/dedupeDeps, all-off = canonical identity), bounded LRU cache; zero-import (Issues #75/#91) |
| 2026-09-23 | `workflow.dna` | 0.1.0 | P3 Slice H: initial lock of the bounded Workflow DNA (n8n checksum identity + order-insensitive morphology block, name lists capped at 64, single-pass, only the checksum seam imported; Issues #75/#91) |
| 2026-09-23 | `execution.state-stream` | 0.1.0 | P3 Slice F: additive exports (STATE_STREAM_SNAPSHOT_VERSION, stateStreamFromSnapshot) — fail-closed sha256 snapshot/resume (cursor + resident backlog + context) on the bounded stream seam; version stays 0.1.0 (additive, pre-1.0; Issues #75/#97) |
| 2026-09-23 | `execution.state-stream` | 0.1.0 | P3 Slice E: initial lock of the bounded streaming execution state (required `maxResidentEvents` bound, explicit backpressure with published `lego.backpressure`, bounded reads, finite batch stream, selective `consume`, zero-import purity; Issues #75/#97) |
| 2026-09-23 | `execution.frontier` | 0.1.0 | P3 Slice D: initial lock of the bounded runtime primitive (capacity-required ring FIFO, explicit `admitted`/`backpressure` outcomes with published `lego.backpressure`, bounded `takeBatch`, observability stats, pure structure; Issues #75/#97/#79) |
| 2026-09-23 | `workflow.graph` | 0.1.0 | P3 Slice C: additive exports (GRAPH_HOT_CACHE_DEFAULT_CHUNKS, GRAPH_NODE_LIFECYCLE, GRAPH_RESIDENCY) — store port (memory/lazy) + bounded HOT cache `maxCachedChunks`, residency HOT/WARM/COLD (`residencyOf`), `evictChunk`, `cacheStats`, `lifecycleOf`; version stays 0.1.0 (additive, pre-1.0; Issues #75/#97) |
| 2026-09-23 | `workflow.graph` | 0.1.0 | P3 Slice A: initial lock of the persistent logical graph (chunked verbatim nodes, source-bucketed connections, name→ordinal resident index, one-chunk reads, fail-closed bundle digest, lossless canonical export; Issues #75/#97) |
| 2026-09-23 | `ai.provider-declaration` | 1.0.0 | P2.26: initial lock of the provider declaration profile (sim/local/cloud — declared, never assumed; closed three-field shape; handed-over scoped request-bound access for GitHub-class boundaries; no client, no stored credential, Workspace untouched) |
| 2026-09-23 | `ai.model-gateway` | 1.0.0 | P2.25: initial lock of the first real model provider adapter (six gateway ops, explicit configuration, call-time authorization, canonical error translation, honest usage reporting into ai.token-usage@1.0.0, injected exchange edge) |
| 2026-09-23 | `ai.tool-gateway` | 1.0.0 | P2.25: initial lock of the first real tool provider adapter (seven gateway ops, five separate tool concepts, required sideEffects, requestId replay cache for tool.call, approval-reference presence, no invented usage) |
| 2026-09-23 | `ai.runtime-adapter` | 1.1.0 | P2.25: MINOR, additive — first real EXTERNAL runtime binding (src/lego/external-runtime.mjs) joins the seam surface; register/lookup/eligibility/manager and the P2.21 behaviour unchanged; ai.agent-runtime stays vocabulary (no lock row) |
| 2026-09-23 | `node.creator` | 1.0.0 | P2.23: initial lock of the bounded node creator & deterministic translation foundation (candidate-only output, single validation pipeline on node.portability@1.0.0, P2.19 approval/artifact touchpoints) |
| 2026-09-23 | `node.portability` | 1.0.0 | P2.22: initial lock of the node portability foundation (classes, runtime matrix, schema subset, fail-closed canPort/select validator) |
| 2026-09-23 | `ai.runtime-adapter` | 1.0.0 | P2.21: initial lock of the runtime adapter seam + deterministic harness (register/lookup/eligibility/manager + EXTERNAL fail-closed provider gate) |
| 2026-09-23 | `ai.mcp-boundary` | 1.0.0 | P2.20: initial lock of the four-state MCP vs Agent Control boundary declaration (declare/evaluate/revoke/inspect + fail-closed permission gate) |
| 2026-09-23 | `ai.artifact` | 1.0.0 | P2.19: initial lock of the opaque reference-only artifact foundation (create/read + lifecycle) |
| 2026-09-23 | `ai.approval` | 1.0.0 | P2.19: initial lock of the fail-closed approval foundation (request/resolve/inspect + waiting resolution) |
| 2026-09-23 | `ai.audit` | 1.0.0 | P2.19: initial lock of the bounded structured audit foundation (record/list) |
| 2026-09-23 | `lego.envelope` | 1.1.0 | P2.18: add optional `causationId` envelope field (MINOR, additive) |
| 2026-09-23 | `lego.interaction` | 1.1.0 | P2.18: export `BATCH_LIMITS`; bound buffer/block past highWaterMark (MINOR, additive) |
| 2026-09-23 | `lego.transport-kernel` | 1.0.0 | P2.18: lock the deterministic message codec (`encodeMessage`/`decodeMessage`/`validateEnvelope`/`KERNEL_LIMITS`) |
| 2026-09-22 | `compat.http` | 1.0.0 | initial lock of the P2 surface (no behaviour change) |
| 2026-09-22 | `kernel.platform` | 1.0.0 | initial lock of the shared kernel |
| 2026-09-22 | `lego.error-contract` | 1.0.0 | initial publication |
| 2026-09-22 | `lego.domain-registry` | 1.0.0 | initial publication |
| 2026-09-22 | `reference.lego` | 1.0.0 | initial publication (template) |
| 2026-09-22 | `lego.domain-registry` | 1.1.0 | P2.7: added hierarchy accessors (`getChildren`/`getDescendants`/`getAncestors`/`lineage`/`nestingDepth`/`rootOf`/`isWithin`/`tree`, `MAX_NESTING_DEPTH`) — additive, 1.0.0 consumers unaffected |
| 2026-09-22 | `lego.contract-compat` | 1.0.0 | P2.7: initial publication (version ranges, change classification, upgrade planning, replacement safety) |
| 2026-09-22 | `reference.lego` | 1.1.0 | P2.7: added `createReferenceTree` + `REFERENCE_SUBLEGOS` — additive; the parent's own operations unchanged |
| 2026-09-22 | `reference.validation` | 1.1.0 | P2.7: added `explain()` and the optional `strict` input — additive; **the demonstration that a child bump does not move its parent or siblings** |
| 2026-09-22 | `reference.validation.schema` | 1.0.0 | P2.7: initial publication (two interchangeable implementations) |
| 2026-09-22 | `reference.repository` | 1.0.0 | P2.7: initial publication (the sibling that must stay untouched) |
| 2026-09-22 | `ai.skill` | 1.0.0 | P2.12: published the existing Skill vocabulary; four discovery operations and two permissions; no execution runtime |
| 2026-09-22 | `ai.context` | 1.0.0 | P2.13: published the established Context vocabulary plus bounded lifecycle/rollover operations; additive initial publication |
| 2026-09-22 | `ai.agent-session` | 1.0.0 | P2.13: published the established bounded Session vocabulary and lifecycle states; additive initial publication |
| 2026-09-22 | `ai.memory` | 1.0.0 | P2.14: published the bounded Memory vocabulary — remember/recall/list/forget, scope isolation, checksum verification, provider-replaceable; additive initial publication |
| 2026-09-22 | `ai.workspace` | 1.0.0 | P2.15: published the bounded Workspace vocabulary — identity, metadata, opaque resource references, logical lifecycle behind a provider seam; additive initial publication |
| 2026-09-22 | `ai.agent-machine` | 1.0.0 | P2.16: published the bounded Agent Machine execution foundation — machine and task identity, canonical agent lifecycle, bounded step bookkeeping, first-class budgets, deterministic transitions, replaceable provider/executor seam; consumes Context/Session/Memory/Workspace by opaque reference only; additive initial publication |
| 2026-09-23 | `ai.agent-machine` | 1.1.0 | P2.16: additive bump **re-derived from the frozen P2.16 1.1.0 specification** after the original local-only commits proved unavailable on GitHub — added agentId identity (machine/agent/task distinct), the ready lifecycle state (agentMachine.prepare), registry-validated capabilityScope, bounded delegation bookkeeping (agentMachine.delegate + ai:agent:delegate: narrowed grants, clamped budget/deadline, maxChildren, no inheritance, no execution), bounded execution-graph validation (sequential/parallel/branch/fan-out/fan-in/join/retry; 128/16/8 ceilings; cycles and authority fields rejected), six session-scoped derived Universal Agent Event types, maxTasksPerAgent/maxCapabilityScope bounds and the fail-closed operation/permission surface; nine operations (no close), five permissions; startedAt now declared; every 1.0.0 flow unchanged |
| 2026-09-23 | `ai.token-usage` | 1.0.0 | P2.24: published the ONE canonical token & usage accounting contract (XA-17 resolution) — record/query/budget, reported/estimated/unavailable certainty with null-never-zero, P2.13 vocabulary quoted byte-for-byte, cost behind a handed pricing basis + declared rule (no fetch, no billing), requestId idempotency, closed privacy shape; additive initial publication |

## 10. Ownership model

| agent | role | domains |
| :--- | :--- | :--- |
| Agent 1 | Frontend + Compatibility | `compatibility`, `settings`, `editor-ui-host`, `legacy-rest` (custodian) |
| Agent 2 | Workflow + Execution | `workflow`, `execution`, `webhook`, `workspace` |
| Agent 3 | Auth + Credentials | `auth`, `credentials` |
| Agent 4 | Node Registry + Dynamic Parameters | `node-registry`, `dynamic-parameters` |
| Agent 5 | Storage + Isolation + Upgrade | `storage`, `data-tables` |
| Agent 6 | Runtime + Scaling + Deployment | `runtime-host`, `realtime`, `worker`, `observability` |
| Manager | Cross-domain contract governance | `platform-kernel`, `lego-foundation`, `reference-lego` |

Single-writer ownership is mechanically enforced: `validateRegistry()` fails if
a domain appears under two agents, if `domain.owner` disagrees with the agents
map, or if two domains claim the same file path. Two agents cannot silently own
the same code.

Provisional assignments Manager must confirm (§Handoff): `webhook` (Agent 2 vs
Agent 6), `settings` (Agent 1 owns the payload whose inputs come from everywhere),
`workspace` (projects touch auth sharing and workflow resources), and
`legacy-rest` (Agent 1 is custodian, not owner — each carve-out belongs to the
target domain).

## 11. Isolation test gate

```bash
node tools/lego/architecture-gate.mjs             # green/red, exit code
node tools/lego/architecture-gate.mjs --json      # machine-readable
node tools/lego/architecture-gate.mjs --selftest  # prove it still catches violations
node tools/lego/capability-conformance.mjs        # compat table vs registry
```

| rule | detects |
| :--- | :--- |
| R1 `unowned-file` | a backend source file no domain claims |
| R2 `forbidden-direction` | an import the importer declared it must not make |
| R3 `undeclared-dependency` | a cross-domain import with no `dependsOn` entry |
| R4 `internal-import` | reaching past a declared public surface / into `internal/` |
| R5 `legacy-zone-growth` | a new file inside the frozen legacy zone |
| R6 `registry-invalid` | ownership collisions, cycles, missing metadata |
| R7 `contract-drift` | exports changed without a contract version bump |
| R8 `stale-allowance` | a temporary allowance no import uses any more |
| R9 `version-incompatible` | registry/lock version drift, a consumer requirement the provider no longer satisfies, an undeclared breaking change, a version going backwards (P2.7) |

Every violation prints the rule, file, line, the specific reason and a fix.
Runtime ≈ 250 ms, zero dependencies, pure Node — it runs in every CI job.

**The gate is proven, not asserted.** `--selftest` runs 19 fixtures and requires
every one to be caught:

* **11 source fixtures** planted in a throwaway copy of the tree — the three
  patterns P2.6 names (storage→workflow internals, execution→workflow internals,
  node→credential/storage persistence), undeclared imports, internal-path reach,
  legacy-zone growth, unowned files, **plus four nested-LEGO cases** (sibling
  sub-LEGO internal reach, outside consumer importing a sub-LEGO internal, an
  undeclared sibling dependency, a grandchild escaping its ancestor's prohibition).
* **7 registry fixtures** that mutate an in-memory copy of the registry —
  an unsatisfied consumer requirement, registry/lock version drift, a breaking
  bump with no changelog, a version going backwards, a sub-LEGO owning a path
  outside its parent, a parent cycle, two agents claiming one sub-LEGO.
* **1 negative control**: a *correct* file must raise nothing.

## 12. Reference LEGO

`apps/n8n-lego/src/reference-lego/` — a template, deliberately not mounted on any
route and not reachable from the running server (`lego.json: "mounted": false`,
asserted by a test so it can never quietly become a feature).

```
src/reference-lego/
├── contract/index.mjs          PUBLIC  capability id, version, error identity, port factory,
│                                       and createReferenceTree() composing the sub-LEGOs
├── internal/store.mjs          PRIVATE cross-domain import of this fails the gate
├── sub/
│   ├── validation/             sub-LEGO @1.1.0  ← the one that was upgraded alone
│   │   ├── contract/index.mjs  PUBLIC
│   │   ├── internal/rules.mjs  PRIVATE
│   │   └── sub/schema/         sub-sub-LEGO @1.0.0 (depth 3)
│   │       ├── contract/index.mjs         PUBLIC — selects the implementation
│   │       └── internal/strict-checker.mjs
│   │           internal/table-checker.mjs PRIVATE — two interchangeable impls
│   └── repository/             sub-LEGO @1.0.0  ← the sibling that stayed untouched
│       └── contract/index.mjs  PUBLIC
├── lego.json                   domain card: owner, capability, dependencies, tests
└── README.md                   the six-step recipe for building a real LEGO from it
```

It demonstrates: contract-only imports, dependency injection (a LEGO never
fetches its own collaborators — the composition root supplies them), errors as
contract codes rather than HTTP statuses, a frozen behaviour-only port, and the
internal boundary that makes the implementation replaceable.

## 13. Nested LEGO (P2.7)

A sub-LEGO is **a full registry entry with a `parent`** — not a lesser thing.
Ownership, contracts, versioning, capabilities, tests and the dependency gate
work identically at every level, which is the only way the hierarchy stays
honest instead of decorative.

```json
{
  "id": "reference-lego.validation",
  "parent": "reference-lego",
  "owner": "manager",
  "paths":  ["src/reference-lego/sub/validation"],
  "public": ["src/reference-lego/sub/validation/contract"],
  "requires": { "reference-lego.validation.schema": "^1.0.0" },
  "contract": { "id": "reference.validation", "version": "1.1.0", "previousVersion": "1.0.0" }
}
```

Rules (`manifest.nesting`, enforced by `validateRegistry` + the gate):

* **Depth is capped at 3** (parent → child → grandchild). Deeper trees are
  decoration; the cap makes that a build failure rather than a code review.
* A child's `paths` must live **inside** its parent's paths. A sub-LEGO cannot
  own code its parent does not.
* **Nothing is inherited implicitly.** Each entry declares its own dependencies.
* A **parent may compose its own descendants' public contracts** without a
  `dependsOn` entry (`rule: parent-child`) — but reaching a child's `internal/`
  fails even for the parent. Being the parent grants composition, not x-ray vision.
* **Siblings are separate LEGOs.** `A.sub → B.sub` needs an explicit declaration,
  and reaching `B.sub`'s internals is always forbidden.
* **A child cannot escape its parent's prohibition.** If `reference-lego` must
  not depend on `storage`, neither may its grandchild — otherwise a domain could
  evade its own rule by pushing the import one level down.
* **Depending on a parent does not grant its children.** Each sub-LEGO contract
  is consumed explicitly, or the hierarchy leaks.
* A sub-LEGO **may be owned by a different agent** than its parent; ownership
  stays single-writer at every level.

Accessors: `getChildren`, `getDescendants`, `getAncestors`, `lineage`,
`nestingDepth`, `rootOf`, `isWithin`, `tree` (`lego.domain-registry` v1.1.0).

The worked example is the reference template (§12), which now nests:

```
reference-lego                     v1.0.0   parent
├── reference-lego.validation      v1.1.0   ← upgraded alone
│   └── …validation.schema         v1.0.0   depth 3, two implementations
└── reference-lego.repository      v1.0.0   ← untouched sibling
```

## 14. Contract compatibility and the upgrade lifecycle (P2.7)

`src/lego/compat.mjs` (`lego.contract-compat` v1.0.0) is the decision procedure.
It is deliberately small: no resolver, no lockfile solver — just the questions
the registry actually asks.

**Ranges:** `1.2.3` exact · `^1.2.3` same major · `~1.2.3` same major.minor ·
`>=1.2.3` · `*`.
`^` on a **0.x** version is strict (`^0.2.1` rejects `0.3.0`) because P2.6
declared 0.x contracts provisional — a 0.x minor is allowed to break, so
consumers must be told.

**Change kinds:** `unchanged` · `compatible` · `migration-required` ·
`breaking` · `downgrade`. Migration points are **declared**
(`migrations: ["1.1.0"]` in the lock), never inferred from a diff.

**The lifecycle**, returned as data by `planUpgrade()` so a future P9 upgrade
system can execute it and a test can assert it today:

```
v1 → compatibility-check → migration (if required) → tests → activation
```

`tests` is always `required`. `activation` is `blocked` whenever any declared
consumer's `requires` range stops being satisfied — that is what makes a
breaking change impossible to ship quietly.

### The parent/sub-LEGO bump rule

> A parent does **not** version-bump because a child changed compatibly. It
> bumps only when its **own parent-facing surface** moves.

Held by the fixtures and asserted by a test: `reference.validation` went
`1.0.0 → 1.1.0` (added `explain()` and an optional `strict` flag — additive
only), while `reference.repository` stayed `1.0.0`, `…validation.schema` stayed
`1.0.0`, and the parent `reference.lego` contract stayed `1.0.0`. The parent
declares `requires: {"reference-lego.validation": "^1.0.0"}`, and `1.1.0`
satisfies it, so nothing upstream had to move.

A **breaking** child change that surfaces through the parent *does* force a
parent major bump.

## 15. Implementation replacement (P2.7)

```
public contract  reference.validation.schema@1.0.0
├── implementation A  internal/strict-checker.mjs  (hand-written branches)
└── implementation B  internal/table-checker.mjs   (rule table)
```

Both satisfy `SCHEMA_OPERATIONS`. The consumer holds the **contract**, never a
concrete checker, so the swap is invisible: a test drives both through eight
input shapes and asserts identical output, then swaps the implementation
underneath the *consumer* and asserts the consumer's own behaviour and version
are unchanged.

`canReplaceImplementation()` makes safety decidable rather than a matter of
opinion — it refuses a replacement with a different contract id, an
unsatisfying version, or a missing operation.

This is the exact seam a future Rust implementation would use: same contract,
same operations, different internals. **No Rust exists; the point is that the
seam is tested.**

## 16. Scale-out readiness (P2.7)

P2.7 implements **no** worker, queue or scaling infrastructure. It asks one
checkable question: *if this LEGO moved into a second process tomorrow, would
its contract still hold?*

`tools/lego/scale-out-readiness.mjs` probes for the properties that break that
promise — `S1` module-global mutable state, `S2` process-local id allocation,
`S3` local filesystem state, `S4` direct `process.env` reads.

Two standards, deliberately unequal:

* **New LEGO code** (foundation, templates, future contract-first domains):
  findings **fail the build**. New contracts are process-agnostic from day one.
* **Existing code**: findings must be **declared, owned and dated** in
  `manifest.scaleOut.exceptions`. Undeclared findings fail; stale exceptions
  fail too, so the list can shrink but never rot.
* A construct that matches a probe but is genuinely safe can be justified in
  place with `// @scale-out-safe: <reason>` — a reviewable claim, not a mute.

### Honest status: the backend is NOT scale-out ready

Ten findings, all declared. The **blockers** (severity `blocking`, owner
Agent 5, phase P8) are both in `src/store.mjs`:

| # | finding | why it blocks |
| :--- | :--- | :--- |
| S2 | `newExecutionId()` allocates from a module-scope counter | two processes would issue colliding execution ids |
| S3 | local JSON files are the system of record | a second worker on another host sees none of it |

`benign` (identical in every process, tidy up on carve-out): the catalog cache
(`src/catalog.mjs`) and the roles cache (`src/compat/scopes.mjs`).
`should-fix`: `src/engine.mjs` reads `N8N_LEGO_ENGINE_PATH` directly instead of
receiving it in config (Agent 2, P4).
`accepted` permanently: `src/config.mjs`, `src/server.mjs` and `bin/` read the
environment — that is precisely their job as the edge that injects config, and
it is *why* the domains downstream stay process-agnostic.

The architecturally important property already holds: **no LEGO may reach
another LEGO's persistence internals**, enforced by R2/R4 today. That is what
makes a future process split a deployment change rather than a redesign.

# Foundation 1.0 (P2.8-B)

P2.6 answered *what are the boundaries?* P2.7 answered *do they survive change?*
P2.8-B answers **in what vocabulary does a LEGO describe itself?** — and turns
the answer into data that gates and AI agents read from one place.

Nothing below implements a feature domain. Nothing below touches Rust.

## 19. The definitive LEGO model

A LEGO declares fifteen attributes (`foundation.json` → `legoModel.attributes`):
identity, parent, public contract, private implementation, owner, data owner,
state owner, capabilities, dependencies, version, lifecycle, tests, resources,
trust, upgrade policy.

**Not every function is a LEGO.** The granularity test is explicit: *if it has no
independent contract, no independent owner and no independent lifecycle, it is a
function — not a LEGO.* This matters because the failure mode of a component
architecture is not too few components, it is a thousand of them.

Three tiers only — **Domain → Feature → Sub-LEGO**, depth capped at 3, exceptions
require Manager approval. Enforced by `MAX_NESTING_DEPTH` and gate rule R6.

## 20. The communication model — exactly four modes

| Mode | What it is | Use when |
| --- | --- | --- |
| `call` | synchronous direct contract call, typed objects, no serialization | **the default** — everything, unless another mode is justified |
| `event` | asynchronous notification that something happened | state changes others may care about; never request/response |
| `stream` | ordered flow with backpressure | execution output, logs, chat/AI tokens, large result sets |
| `batch` | many operations in one call | amortising per-call overhead |

Two rules carry most of the weight: **no HTTP between local LEGOs**, and **no
message bus for appearance**. Internal HTTP between two objects in one process is
the most expensive possible way to call a function — it buys the *look* of
separation while the actual isolation comes from the boundary gate, which costs
nothing at runtime. See ADR-0004.

## 21. Transport neutrality and the envelope

The same logical contract binds to five targets: in-process JS, in-process Rust,
WASM, worker, remote API. Adding a binding must never change the contract's
operations, error codes or semantics. `execute(request)` must never become
inherently `HTTP POST /execute`.

The envelope carries ten fields — `legoId`, `operation`, `contractVersion`,
`requestId`, `correlationId`, `traceId`, `actor`, `deadline`, `signal`,
`idempotencyKey` — and is **zero-cost on direct calls**: a plain object passed by
reference, serialized only at a worker or remote boundary.

Contract shapes are described with a **JSON Schema subset** (ADR-0002), not
TypeScript, because a Rust binding cannot read TypeScript. No code generator is
built in this phase.

## 22. Trust, capability, failure boundary

Trust levels are `core` → `verified` → `community` → `untrusted`. The six security
capabilities — network, filesystem, subprocess, secrets, native, env — are
**granted separately**. Trust never implies a capability; `untrusted` gets none by
default, and a grant beyond a level's default needs a written justification in
the manifest (gate rule F4).

Failure boundaries are `in-process-safe`, `sandboxed`, `worker-isolated`. A
community or untrusted LEGO left `in-process-safe` is a gate failure (F6): the
whole point is that untrusted code cannot take down the trusted core.

A sub-LEGO may never claim more trust than the LEGO containing it.

## 23. Activation, resources, portability, devices

Activation is `available → loaded → active → idle → unloaded → disabled`, with a
transition table that is actually enforced (`canTransition`). **Nothing is forced
into RAM** — that is what makes a 24-node catalog viable on a phone.

Resource profiles (cpu, memory, disk, network, concurrency, startup) are
**metadata, not a scheduler**. Portability profiles (`portable`,
`network-required`, `filesystem-required`, `process-required`, `native-required`,
`server-only`, `remote-capable`) let a node stay in the catalog on Android/Termux
by executing remotely instead of vanishing. Device classes include
`android-termux` and `low-end-vps` as first-class targets.

## 24. Node Contract and the twelve creation routes

`node-contract.json` defines what a node *is* — identity, manifest, parameters,
I/O, credentials, execution, events, errors, capabilities, portability, runtime
requirements, resources, trust — **without implementing a Node Registry**.

The identity rule is the load-bearing one: **`type` + `typeVersion` never change
because the implementation, runtime or language changed.** A workflow referencing
`n8n-nodes-base.httpRequest@4` keeps working whether JS serves it today or a
prebuilt Rust artifact serves it later.

All twelve routes are *defined only*: `no-code-api`, `declarative`, `openapi`,
`visual-builder`, `transform-formula`, `workflow-as-node`, `javascript`,
`python`, `wasm`, `rust`, `remote`, `community`. Only `javascript` and
`community` are marked `supported-today` — because only they already worked.
`rust` is `defined-not-implemented`.

The decision model is eight ordered rules, executable as
`decideCreationRoute(facts)`, which returns **the rule that fired** so a
recommendation can always be explained. An existing community node always wins
(D1): zero implementation and zero maintenance beat any rewrite.

`isRustJustified()` enforces four hard constraints — material measured benefit,
prebuilt artifacts for every platform, unchanged contract and node identity, no
impact on JS compatibility — and the JS implementation is retained permanently as
the fallback. "It is Rust" is explicitly not a reason. See ADR-0005.

## 25. The AI knowledge pack — generated, never hand-written

`.ai/` holds 47 generated files: the constitution, glossary, LEGO index, 24
domain cards, contract index, capability index, six decision cards, ten recipes,
migration cookbook, compatibility matrix, node routes, impact graph and ADR
index.

Every byte is generated by `tools/lego/ai-pack.mjs` from the manifest, the
contract lock and the foundation vocabulary — **the same data the gates
enforce**. `--check` runs in CI and fails when the pack is stale. A hand-written
architecture guide is a second registry, and a second registry always drifts;
this one is either correct or the build is red. See ADR-0003.

Context levels let an agent read the *smallest sufficient* thing: L0 constitution
(under 70 lines) → L1 domain card → L2 contract card → L3 recipe → L4 source.

Impact analysis and test selection are real tools, not prose:

```
node tools/lego/impact-graph.mjs --target storage        # blast radius 10
node tools/lego/impact-graph.mjs --plan --target auth --change "add scope check"
node tools/lego/impact-graph.mjs --changed src/settings/routes.mjs
```

Test selection escalates conservatively across six tiers (fast → contract →
boundary → integration → e2e → full): unowned files, manifest edits, public
surface edits, dependents, blast radius ≥ 5 and the editor-UI compatibility path
all push the tier up. A gate that under-tests to look fast is worse than no gate.

Plan mode is advisory and **never applies anything** — it reports contracts
affected, dependencies, tests required, resource impact, security impact, risk
and the rollback condition.

# Communication foundation (P2.9)

P2.8-B declared the vocabulary. P2.9 makes the communication model executable
and retires two of the three boundary allowances.

## 28. The four interaction classes

`src/lego/interaction.mjs` implements CALL, EVENT, STREAM and BATCH as
**semantics, not transports**. The module contains no transport at all — a
worker or remote adapter registers the same provider shape with a different
`transport` field, and no consumer changes.

| Class | Semantics | Local mechanism |
| --- | --- | --- |
| `call` | synchronous request/response — the default | direct function call |
| `event` | fire-and-forget notification | in-process emitter |
| `stream` | ordered incremental output with backpressure | async iterator |
| `batch` | many operations in one call | grouped local call |

Escalation ladder: direct call → EVENT → STREAM → BATCH → IPC (only across a
process) → HTTP (only across a network boundary).

**Why a dispatcher rather than direct imports?** A direct import makes the
*consumer* pick the implementation, which kills the replacement story — you
cannot swap JS for Rust, or in-process for worker, without editing every caller.
The dispatcher is one `Map.get()` and a function call, and it is what makes
ADR-0001 and ADR-0005 mechanically possible instead of aspirational. A test
proves it: `replacing an implementation leaves the consumer untouched`.

EVENT deliberately never throws at the emitter and never awaits handlers. One
slow or broken audit listener must not be able to stall an execution.

## 29. The operation envelope

`src/lego/envelope.mjs`. Ten fields plus `scope`: identity, correlation, trace,
actor, deadline, cancellation, idempotency.

The design constraint is cost. A workflow running 400 nodes creates 400
envelopes, so it is a frozen plain object with no clock call unless a deadline
was requested. An expensive envelope would simply be skipped by callers, and the
architecture would lose its identity and cancellation story exactly where it
matters most.

`deriveEnvelope()` propagates correlation and **clamps a child deadline to its
parent's** — a child that outlives its caller is the orphaned-work bug the
architecture forbids, so the clamp is not advisory.

`serializeEnvelope()` drops the `AbortSignal` and sets `cancellable: false`. A
worker binding must establish its own cancellation channel rather than pretend a
signal survived serialization.

**No secrets in the envelope**, asserted by test.

## 30. Cancellation and backpressure

Cancellation is explicit, propagating, idempotent and testable. A deliberate
cancel raises `lego.cancelled` (not retryable); a passed deadline raises
`lego.deadline_exceeded` (retryable). That distinction is the actionable part —
collapsing them into one boolean throws away the only useful information.

Backpressure is **mandatory to declare** on STREAM operations, because an
undeclared policy means "buffer without limit", which is how a process dies
slowly. Seven policies: `buffer`, `drop`, `drop-oldest`, `coalesce`, `block`,
`reject`, `terminate`.

## 31. Capability negotiation, lifecycle, degradation

`src/lego/negotiation.mjs`. `negotiate({ consumer, capability, requires,
operations })` answers in one call: may I, does it speak my version, does it
have what I need, is it alive. Failures are distinct codes because they are
differently actionable — `lego.access_denied` is an architecture bug in the
caller, `lego.dependency_disabled` is an operational state,
`lego.version_incompatible` is a migration.

**Nesting grants nothing.** Reaching a nested LEGO requires a declaration naming
that child. This is enforced here as well as in the import gate, because the
import gate only sees static imports — negotiation is where a dynamic lookup
would otherwise slip past.

Eleven lifecycle states (`declared` … `deprecated`); only `active`, `idle`,
`degraded` and `deprecated` are callable. Illegal transitions throw and do not
mutate state. Eight degradation states, each naming the action — there is no
silent fallback, because a fallback nobody declared is a bug nobody can find.

## 32. A1/A2 retired, A3 narrowed

**A1 and A2 are deleted, not marked resolved.** Both existed only because the
auth domain published nothing, so compatibility and settings imported
`src/auth.mjs` internals. Both needed exactly two small read-only functions.

The fix is `auth.identity` (`src/auth/contract/index.mjs`), a **dependency-free
nested leaf** owned by agent-3 exposing only `toPublicUser` and `hasOwner`. It
holds no authority: no session creation, no password verification, no token
minting — asserted by test.

Modelling it as a *leaf* rather than widening the `auth` domain is what avoids a
cycle: `auth/routes.mjs` depends on compatibility, so a `compatibility → auth`
edge would have been circular. The gate caught this immediately, which is the
gate doing its job.

**A3 is narrowed, not retired.** `src/engine.mjs` imports exactly
`newExecutionId` from `src/store.mjs`. Unlike A1/A2 this is not a pure read-only
projection — it mutates a process-local counter, and that counter *is* scale-out
blocker S2. Publishing a storage contract that merely re-exported it would
retire the allowance while preserving the blocker: a greener gate and an
identically unsafe system. Retiring A3 correctly is agent-5's durable
id-allocation work in P8.

`test/lego-boundary.test.mjs` pins all of this: the auth surface is exactly two
functions, no file outside `src/auth/` imports `src/auth.mjs`, A3 stays bounded
to one symbol in one file, and the allowance count may not grow.

## 33. Gate hardening

Two real gaps in the R7 export analyzer were found and fixed. Both failed
*silently in the unsafe direction* — the analyzer under-reported exports, so a
valid contract looked like it had lost a symbol:

- `export { a } from './x.mjs'` — the contract-facade pattern, which is the
  recommended way to publish a narrow surface. A negative lookahead was
  excluding it.
- `export async function* s()` — the natural shape of a STREAM operation.

Seven export-analyzer fixtures now pin the behaviour (selftest 19 → 26). R7 was
verified to still catch genuine drift afterwards by deliberately removing a
promised export and confirming the gate fired.

# Capability contracts and the AI Foundation (P2.10)

## 36. A capability is a contract, not a name

Until P2.10 a capability was `{id, status}`. That says a feature exists and
nothing a consumer can negotiate against, so consumers inferred the rest:
operations from route existence, permissions from implementation, lifecycle from
file presence, transport from the fact that something answered over HTTP.

Every one of those inferences breaks silently when an implementation is
replaced — the exact operation this architecture exists to make safe.

Each of the **71 capabilities** now declares operations, interaction classes,
permissions, lifecycle, availability, criticality, trust, transport, migration
state, degradation, resources and replacement policy. Each of the **139
operations** declares its own name, interaction class, permission, idempotency
and status.

> **Count correction (P2.11).** This section and `evidence/backend-lego-p210.json`
> previously said 173 operations. The manifest has always declared 139 — 82
> capabilities, 62 of which declare operations. The 173 figure was an arithmetic
> error in the prose, not a change in the data: `manifest/domains.json` is
> byte-identical to its P2.10 state. The count is now generated into
> `.ai/master/CURRENT_STATUS.md` rather than written by hand, which is the only
> durable fix for a number that drifted because a human maintained it.

The operations are grounded in routes and module exports that genuinely exist.
Where a feature does not exist, the capability declares `[]` and keeps an honest
status — inventing operations to fill a table would make the registry describe a
system nobody has written. See ADR-0010.

## 37. Surface aliases: UI vocabulary is not capability identity

The editor says `executions`; the architecture says `execution`. The tempting
fix is a second capability to match the UI, which duplicates ownership for a
grammatical difference.

Instead `surfaceAliases` maps a surface word to exactly one canonical domain and
creates no capability, no contract and no ownership. Five aliases are declared;
`projects → workspace` is a genuine rename rather than a plural, which is
exactly why it must be declared rather than guessed.

F14 rejects an alias pointing at a missing domain, two aliases claiming one
word, and — the dangerous case — a surface word that is *also* a real domain id
pointing somewhere else, which would make resolution order-dependent.

## 38. One authoritative 501 source

`compat/capability.mjs` remains the runtime mechanism; the registry remains
authoritative for ownership. `capability-conformance.mjs` binds them, and a test
now additionally requires that a capability answering 501 never reports
availability `available`. The frontend may derive a read model; it may not keep
a second copy that can drift.

## 39. The AI Foundation — contracts only

`manifest/ai-foundation.json` plus `ai-foundation.mjs` declare vocabulary for a
future AI Foundation. **Nothing is implemented**: no inference, no agent loop, no
gateway client, no MCP server or client, no network call, no new dependency. A
test asserts the module contains exactly one file read — its own manifest — and
none of `fetch`, `child_process`, `WebSocket` or a socket API.

The whole point is sequencing. The normal path is that one vendor's SDK arrives
first and its shape becomes the internal model; every later provider is then
bent to fit a competitor's abstractions. Writing the neutral contract first
makes the first adapter an implementation rather than a definition. See ADR-0009.

Five concepts are kept deliberately separate:

```
capability     WHAT the system can do    (owned by a LEGO, stable)
implementation HOW it is realised        (JS or Rust, swappable)
provider       WHERE it comes from       (model / tool / application)
transport      HOW bytes move            (in-process / worker / remote / mcp)
runtime        WHERE an agent executes   (agent / simulation runtime)
```

A capability named `composio.github.repo.read` fuses three of them into one
identifier: the same logical capability reached natively becomes a *different*
capability with a different name. F15 enforces neutrality mechanically — a
vendor name may appear only inside an `examples` array, never in an id, a
structural key or a default.

Eleven contracts are declared: model gateway, tool gateway, application
provider, agent runtime, session, delegation, events, decision, approval,
artifact, context.

Three choices worth stating:

- **Approval is fail-closed.** An unknown action requires approval. The
  tempting implementation is `list.includes(action)`, which returns false for
  anything new — so a newly added destructive action would need no approval
  until someone extended the list. That fails open exactly when a new capability
  appears. Read-only must be *proven*, not assumed.
- **Delegation never propagates authority.** A child gets only what is
  explicitly granted, and only what the parent holds. Otherwise one delegation
  chain quietly ends in an agent holding every permission.
- **Zero-install is a valid state.** Foundation ready, no provider configured,
  reported honestly as `capability-unavailable`. The system never fakes
  inference: a fake answer is worse than no answer, because the user cannot tell
  it is fake.

MCP is an edge adapter. No internal LEGO may call another over MCP, and MCP maps
*onto* the tool gateway rather than defining it — so if MCP changes, one adapter
changes.

## 40. Gate hardening (F10–F15) and a foundation selftest

Six rules were added to the existing foundation gate rather than to a parallel
checker: F10 capability-contract, F11 operation-declaration, F12
interaction-validity, F13 backpressure-declared, F14 surface-alias, F15
ai-vendor-neutral.

The foundation gate also gained its own selftest — 11 fixtures plus a negative
control — on the same principle as the architecture selftest: a gate nobody has
watched fail is a decoration.

Writing F13 immediately caught five stream operations with no backpressure
policy, including the editor push stream. Each now declares a policy *and a
recorded reason*: token streams `block` (dropping corrupts output, buffering
exhausts memory), agent progress `coalesce` (only the latest state matters),
editor push and event subscribers `drop-oldest` (a slow browser must not grow
the server heap).

## 41. What none of these phases did

No workflow, execution, auth, credentials, node-registry, dynamic-parameter,
storage, webhook or worker feature. No SQLite/Postgres migration, no queues, no
scaling, no microservices, no Rust, no JS→Rust port, no speculative
optimisation, no backend rewrite. No HTTP microservice was created to
"prove" isolation — LEGO-to-LEGO stays in-process behind contracts, which is
exactly what lets a future worker wrap the *same* logical contract.

P2.10 added capability contracts and the AI Foundation vocabulary. It did NOT
implement any AI feature: no inference, no agent loop, no model or tool gateway
client, no MCP server or client, no vendor SDK, no new dependency, no network
call and no daemon. No feature domain was implemented and no existing runtime
file was modified. `ai-foundation.mjs` reads exactly one file — its own manifest.

P2.9 added the communication foundation and retired two allowances. It did NOT
implement any feature domain: no Workflow, Execution, Auth, Credentials, Node
Registry, Dynamic Parameters or Storage feature, no storage rewrite, no worker
or scaling system, no microservice decomposition, no Rust, no Translation, no
Hermes, no AI assistant. The interaction module contains **no transport**: no
HTTP, no IPC, no message broker, no queue, no scheduler and no background loop.
`auth.identity` is a two-function re-export, not an auth implementation.

P2.8-B added **definitions, not implementations**. No Node Registry, no node
loader, no sandbox, no scheduler, no feature-flag platform, no code generator, no
replay infrastructure, no checkpointing, no distributed transactions, no second
registry. The twelve creation routes are described; none is built. The Chat
Contract reserves a slot for Hermes as an optional future provider and nothing
depends on it.

The one new runtime behaviour is *zero*: the foundation modules are data + pure
functions, the nested reference tree is a template that is never mounted
(`lego.json: "mounted": false`, asserted by a test), and `src/server.mjs` is
unchanged — so P0/P1/P2 behaviour is bit-for-bit what it was at `cb71dbb2`.

## 42. Verification

```
architecture gate       node tools/lego/architecture-gate.mjs            → OK (0 violations, 9 rules, 26 domains)
gate selftest           node tools/lego/architecture-gate.mjs --selftest → 26/26 detected
foundation gate         node tools/lego/foundation-gate.mjs              → OK (26 LEGOs, F1–F15)
foundation selftest     node tools/lego/foundation-gate.mjs --selftest   → 12/12 detected
capability conformance  node tools/lego/capability-conformance.mjs       → OK (23 features, 71 capabilities)
scale-out readiness     node tools/lego/scale-out-readiness.mjs          → OK (10 declared exceptions)
AI pack freshness       node tools/lego/ai-pack.mjs --check              → OK (52 generated files)
capability contracts    node --test apps/n8n-lego/test/lego-capability-contract.test.mjs → 33/33
AI foundation contracts node --test apps/n8n-lego/test/lego-ai-foundation.test.mjs    → 54/54
boundary regression     node --test apps/n8n-lego/test/lego-boundary.test.mjs         → 22/22
communication model     node --test apps/n8n-lego/test/lego-communication.test.mjs    → 65/65
foundation contracts    node --test apps/n8n-lego/test/lego-foundation.test.mjs       → 24/24
lifecycle certification node --test apps/n8n-lego/test/lego-lifecycle.test.mjs        → 28/28
foundation 1.0 model    node --test apps/n8n-lego/test/lego-foundation-model.test.mjs → 93/93
P0/P1/P2 + all suites   node --test apps/n8n-lego/test/*.test.mjs        → 344/344
everything              npm run lego:gate
clean clone + browser   see .github/workflows/n8n-lego.yml clean-clone job
```

## 43. The repository as project memory (P2.11)

This phase wrote no feature. It answered a different question: **what does a new
agent read to understand this project, when the conversation that produced it is
gone?**

Until now the answer was "the chat". That is not a durable answer, and it fails
in a specific way — not by losing information, but by losing *authority*. A fact
stated in conversation has no owner, no version and nothing that fails when it
becomes false.

### 43.1 Three new declarations

| Manifest | Declares |
| :--- | :--- |
| `manifest/ai-lego-set.json` | the fifteen official AI/Agent LEGO, six phases, three experiences, the external action model, deployment modes, security invariants, the Rust strategy and the current limits |
| `manifest/project-governance.json` | manager/worker authority, the job/task model, control planes, twenty-five decision principles and six blockers |
| `manifest/reference-scenarios.json` | seven end-to-end contract walkthroughs |

Eleven documents under `.ai/master/` are generated from them. None is
hand-written, and hand-writing one is not merely discouraged: `writeAll` deletes
`.ai/` before writing, so an edited file disappears on the next
`npm run lego:ai`, and `lego:ai:check` turns staleness into a build failure.

### 43.2 Why generated, and the evidence that settled it

The argument for generating architecture documentation is usually theoretical.
This phase produced the concrete case while it was being written.

The repository asserted **173 operations** — in `BACKEND_LEGO.md`, in `ADR-0010`
and in the P2.10 evidence file. The manifest had declared **139** the whole time:
82 capabilities, 62 of which declare operations. Nothing had regressed;
`manifest/domains.json` is byte-identical to its state at `6f7b66da`. A human had
done the arithmetic once, written the result in three places, and every later
reader took the agreement between those three places as corroboration.

That is the failure mode in full. A hand-maintained number is eventually wrong,
and copies of it make the error look verified. The same fate was already circling
the domain count, which had been described in prose as 25 against a manifest
declaring 26.

Better proofreading does not fix this. Removing the opportunity does: the counts
are now computed from the manifests at generation time, so they are either right
or the build is red. The 173 figure is corrected in all four places **with a note
recording what it was and why it changed** — an evidence file whose numbers
silently change is not evidence.

### 43.3 The tests found real defects in my own declaration

The new suite (`test/lego-ai-set.test.mjs`, 37 tests) was written before the
manifest was finished, and it immediately rejected four things I had written:

- nine of fifteen LEGO had no `lifecycle` field;
- `skill` and `mcp-adapter` carried free prose where the vocabulary word is
  `publicationPending`;
- **Agent Machine (phase B) depends on Approval (phase C)** — a roadmap that
  cannot run in its own stated order.

The third is the interesting one, because the fix was not to move a phase. The
dependency is real and the ordering is deliberate: Agent Machine can ship in B
*because approval fails closed*. With no Approval LEGO present, any action whose
approval requirement is unknown or destructive is refused. So the edge is now a
**declared exception** that must state its justification, its degradation and the
phase that closes it. The test does not forbid forward edges; it forbids
*undeclared* ones, because the dangerous version is the one nobody noticed.

### 43.4 F17 — the no-second-vocabulary rule, made mechanical

Two of the fifteen official LEGO share a name with something that already exists:
`workspace` is a core domain, and `capability` is the existing negotiation
mechanism. That overlap is correct — the AI Workspace *is* the workspace domain,
extended. What must never happen is the overlap going undeclared, because then
one word means two things in two registries and the divergence surfaces only when
someone implements the wrong one.

`F17 ai-set-reconciliation` fails the build when an official LEGO collides with,
or shadows behind an `ai-` prefix, a core domain without declaring `reconciles`.
Prose in a document cannot fail a build; a gate rule can. Two selftest fixtures
prove it fires — the foundation selftest is now **15/15**.

### 43.5 Blockers are asserted, not described

A status document that reports its own health tends to improve over time for
reasons unrelated to the system. So the class-A storage blockers are pinned by a
test: closing `BL-1` or `BL-2` fails the suite. Closing one now costs a
deliberate edit to an assertion instead of a quiet status flip in prose.

The same applies to the honesty claims. A test requires that only Capability is
`implemented`, and that `currentLimits` still says the AI runtime, model
inference and scale-out are not. All of this was verified by falsification:
closing a blocker, marking Agent Machine implemented and fabricating
`ai.memory@1.0.0` produced exactly four failures, after which the tree was
restored and re-verified.

### 43.6 A pinned version was the wrong assertion

`lego-foundation.test.mjs` pinned `ERROR_CONTRACT_VERSION` to exactly `1.0.0`.
When XA-5 published eleven new `lego.*` codes — a legitimate MINOR bump under the
contract's own rules — that test failed. The test was wrong, not the change: a
pinned exact version makes every compatible addition look like a regression, and
trains the reader to edit the assertion rather than think about it. It now
asserts the real invariant, the MAJOR version, which is the number a consumer
actually depends on.

### 43.7 What this phase did not do

No feature domain was implemented. No runtime module was touched. The only
executable changes are the generators in `ai-pack.mjs`, rule F17 in
`foundation-gate.mjs`, and two test files. Fourteen of the fifteen AI/Agent LEGO
remain `contract-only` or `planned`, and every generated page says so.

Supabase and the VPS execution gate are declared in the project plan but have no
client, schema, endpoint or credential in this tree. They are recorded as
**NOT VERIFIED**, and a test enforces that wording, because the plan describing
them is not evidence that they exist here.

## 44. Verification (P2.11)

```
architecture gate       node tools/lego/architecture-gate.mjs            → OK (26 domains, 14 contracts)
gate selftest           node tools/lego/architecture-gate.mjs --selftest → 26/26 detected
foundation gate         node tools/lego/foundation-gate.mjs              → OK (26 LEGOs, F1–F17)
foundation selftest     node tools/lego/foundation-gate.mjs --selftest   → 15/15 detected
capability conformance  node tools/lego/capability-conformance.mjs       → OK (23 features, 82 capabilities)
scale-out readiness     node tools/lego/scale-out-readiness.mjs          → OK — still NOT scale-out ready
AI pack freshness       node tools/lego/ai-pack.mjs --check              → OK (63 generated files)
AI LEGO set invariants  node --test apps/n8n-lego/test/lego-ai-set.test.mjs → 37/37
all suites              node --test apps/n8n-lego/test/*.test.mjs        → 381/381
everything              npm run lego:gate
```
