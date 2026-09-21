# Backend LEGO foundation (P2.6)

Status: **implemented**, enforced by `node tools/lego/architecture-gate.mjs`.
Baseline: `main` at `cb71dbb2` (P2 compatibility contract layer, merged, CI green).

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
└── version         a contract version + what counts as a breaking change
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
owner and a deadline — rule **R8** deletes them automatically when they heal):

| id | import | owner | by | resolution |
| :--- | :--- | :--- | :--- | :--- |
| A1 | `src/compat/auth-context.mjs` → `src/auth.mjs` | agent-3 | P5 | publish `toPublicUser` via an auth contract module |
| A2 | `src/settings/routes.mjs` → `src/auth.mjs` | agent-3 | P5 | publish `hasOwner` via the auth contract |
| A3 | `src/engine.mjs` → `src/store.mjs` | agent-5 | P8 | publish a storage contract (id allocation + collection ports) |

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

Locked contracts today: `compat.http` (1.0.0), `lego.error-contract` (1.0.0),
`lego.domain-registry` (1.0.0), `kernel.platform` (1.0.0), `reference.lego` (1.0.0).

### Contract changelog

| date | contract | version | change |
| :--- | :--- | :--- | :--- |
| 2026-09-22 | `compat.http` | 1.0.0 | initial lock of the P2 surface (no behaviour change) |
| 2026-09-22 | `kernel.platform` | 1.0.0 | initial lock of the shared kernel |
| 2026-09-22 | `lego.error-contract` | 1.0.0 | initial publication |
| 2026-09-22 | `lego.domain-registry` | 1.0.0 | initial publication |
| 2026-09-22 | `reference.lego` | 1.0.0 | initial publication (template) |

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

Every violation prints the rule, file, line, the specific reason and a fix.
Runtime ≈ 250 ms, zero dependencies, pure Node — it runs in every CI job.

**The gate is proven, not asserted.** `--selftest` plants seven real violations
in a throwaway copy of the tree (including the three patterns P2.6 names:
storage→workflow internals, execution→workflow internals, node→credential/storage
persistence) and requires each to be caught, plus a negative control that a
*correct* file raises nothing. It currently reports 8/8.

## 12. Reference LEGO

`apps/n8n-lego/src/reference-lego/` — a template, deliberately not mounted on any
route and not reachable from the running server (`lego.json: "mounted": false`,
asserted by a test so it can never quietly become a feature).

```
src/reference-lego/
├── contract/index.mjs   PUBLIC  capability id, contract version, error identity, port factory
├── internal/store.mjs   PRIVATE cross-domain import of this fails the gate
├── lego.json            domain card: owner, capability, dependencies, tests
└── README.md            the six-step recipe for building a real LEGO from it
```

It demonstrates: contract-only imports, dependency injection (a LEGO never
fetches its own collaborators — the composition root supplies them), errors as
contract codes rather than HTTP statuses, a frozen behaviour-only port, and the
internal boundary that makes the implementation replaceable.

## 13. What P2.6 did NOT do

No workflow, execution, auth, credentials, node-registry, dynamic-parameter,
storage, webhook or worker feature. No SQLite/Postgres migration, no queues, no
scaling, no microservices, no Rust, no JS→Rust port, no speculative
optimisation, no backend rewrite. The one new runtime behaviour is *zero*: the
foundation modules are data + pure functions, and `src/server.mjs` is unchanged,
so P0/P1/P2 behaviour is bit-for-bit what it was at `cb71dbb2`.

## 14. Verification

```
architecture gate      node tools/lego/architecture-gate.mjs            → OK (0 violations)
gate selftest          node tools/lego/architecture-gate.mjs --selftest → 8/8 detected
capability conformance node tools/lego/capability-conformance.mjs       → OK (23 features)
foundation contracts   node --test apps/n8n-lego/test/lego-foundation.test.mjs → 24/24
P0/P1/P2 regression    node --test apps/n8n-lego/test/*.test.mjs        → 49/49
clean clone + browser  see .github/workflows/n8n-lego.yml clean-clone job
```
