# Node LEGO — Isolation of the n8n Node Model

**Agent:** Agent 2 (TASK: N8N Node Model Isolation)
**Reference:** `reference/n8n` @ `n8n@2.9.4` (commit `b6dc2787c45677a29a9612cd27eb911302961a83`, 2026-02-25)
**Package under isolation:** `n8n-workflow@2.9.1` (`reference/n8n/packages/workflow`)
**Companion contract:** [`contracts/node.contract.md`](../../contracts/node.contract.md)
**Boundary patch:** [`patches/0001-node-model-boundary.patch`](../../patches/0001-node-model-boundary.patch)

---

## 1. X-Ray summary (required before any change)

### 1.1 Where the Node Model actually lives

Contrary to a name-based guess, there is no `Node.model.ts`. The Node Model is a set of
type contracts + pure functions inside `packages/workflow/src/`:

| File | Lines | Node-Model role |
|---|---|---|
| `src/interfaces.ts` | 3452 | Canonical type contracts: `INode`, `INodeType`, `IVersionedNodeType`, `abstract class Node`, `INodeTypeDescription`, `INodeProperties`, `NodeConnectionTypes`, `INodeTypes`, issues, loading DTOs… |
| `src/node-helpers.ts` | 1966 | `NodeHelpers`: pure functions over `INode`/`INodeTypeDescription` (parameters, display rules, IO, naming, issues, versioning) |
| `src/versioned-node-type.ts` | 30 | `VersionedNodeType` class (multi-version nodes) |
| `src/node-validation.ts` | 88 | `validateNodeCredentials`, `isNodeConnected`, `isTriggerLikeNode` |
| `src/node-parameters/filter-parameter.ts` | ~450 | filter parameter model + evaluation |
| `src/node-parameters/parameter-type-validation.ts` | ~290 | `validateNodeParameters`, `assertParamIs*` |
| `src/node-parameters/node-parameter-value-type-guard.ts` | 130 | runtime type guards for parameter values |
| `src/node-parameters/path-utils.ts` | ~40 | `resolveRelativePath` for collection paths |
| `src/node-parameters/rename-node-utils.ts` | ~15 | `renameFormFields` |
| `src/errors/node-*.error.ts`, `src/errors/abstract/node.error.ts` | — | node-scoped error classes (shared contract, raised by execution) |

### 1.2 Direct imports of the Node Model internals

`node-helpers.ts` imports (all verified at tag 2.9.4):

* runtime: `@n8n/errors` (`ApplicationError`), `lodash/get`, `lodash/isEqual`
* intra-package: `./constants`, `./expressions/expression-helpers` (`isExpression`), `./node-parameters/filter-parameter`, `./type-guards`, `./type-validation`, `./utils` (`deepCopy`)
* **type-only**: `./interfaces`, `./run-execution-data/...`, **`./workflow`** (the `Workflow` class type — owned by Agent 1)

`versioned-node-type.ts`: only type-only `./interfaces`. `node-validation.ts`: `./interfaces` + `displayParameter` from `./node-helpers`. `node-parameters/*`: `./errors`..., `./interfaces`, `../utils`, `../type-validation`, `@n8n/errors`, `lodash/*`.

### 1.3 Who uses the Node Model (consumers, measured)

| Consumer | Evidence |
|---|---|
| `packages/nodes-base` | **478** `*.node.ts` classes `implements INodeType`; **248** credential files import `INodeProperties`; `VersionedNodeType` extended by multi-version nodes (e.g. `Switch`, `RemoveDuplicates`, `Todoist`…) |
| `packages/@n8n/nodes-langchain` | AI nodes incl. `ChatTrigger`/`McpTrigger` extending abstract `Node` |
| `packages/core` | execution contexts, `RoutingNode` (`execution-engine/routing-node.ts`), `partial-execution-utils` — implement the runtime side of the lifecycle contract |
| `packages/cli` | `NodeTypes` registry (`src/node-types.ts`), `LoadNodesAndCredentials`, `NodeTypesController` (serves `INodeTypeDescription[]` to the editor incl. translations), breaking-changes rules, `export nodes` command |
| `packages/frontend/editor-ui` | **146** source files import `INode`/`INodeTypeDescription`/`NodeHelpers` from `n8n-workflow` (NDV panel, composables, chatHub…) |
| `packages/@n8n/task-runner`, `packages/@n8n/ai-workflow-builder.ee`, `eslint-plugin-community-nodes`, `packages/testing` | registry wrappers, LLM tooling, node-lint rules, benchmarks |

Helper usage outside `n8n-workflow` (files, measured): `getNodeWebhookUrl` 90 · `displayParameter` 23 · `getNodeInputs` 21 · `getNodeParameters` 20 · `getNodeOutputs` 15 · `getNodeParametersIssues` 9 · `getVersionedNodeType` 6 · `mergeNodeProperties` 4.

### 1.4 What turned out NOT to be Node Model

* `packages/cli/src/node-types.ts` + `load-nodes-and-credentials.ts` — registry **implementation** & package scanning (Agent 4 infra).
* `packages/core/src/execution-engine/*` — execution runtime for nodes, incl. `RoutingNode` executing declarative `routing` definitions, and the `I*Functions` context implementations (Agent 3).
* `packages/cli/src/webhooks/*` (`live-webhooks.ts`, `test-webhooks.ts`, …) — webhook routing/registration (Agent 4). The Node Model only owns the `IWebhookDescription` **data**.
* `packages/cli/src/credentials*` — credential storage/decryption (Agent 4). Node Model only holds `{ id, name }` references.
* `packages/workflow/src/workflow.ts` + `workflow-diff.ts` + `common/*` graph helpers — Workflow LEGO (Agent 1).
* `expression.ts`, `workflow-data-proxy*.ts` — expression runtime (excluded per task scope).
* Scheduler/cron service, queue, persistence (`@n8n/db`, migrations), task runners' sandboxing.

### 1.5 Hard-to-separate dependencies (documented, NOT rewritten)

1. `interfaces.ts` interleaves Node-Model types with execution (`ITaskData`, `IRunData`), workflow (`IWorkflowBase`), and credential types in one 3.4k-line module. Splitting it is a big rewrite of the package's single source of contracts — **rejected** under "correctness > isolation". Instead, the boundary is *declared* via the barrel (§3).
2. `NodeHelpers.isExecutable/getNodeInputs/getNodeOutputs` take a `Workflow` — a type-only edge into Agent 1's LEGO. No runtime coupling; left as-is.
3. `INodeType` lifecycle signatures reference `IExecuteFunctions` & friends, which are *implemented* in `n8n-core`. The types stay here (they are part of the node contract); implementations stay in execution.
4. Node errors (`NodeApiError`, …) are thrown by execution but defined in this package; they stay exported from the package root, not from the barrel.

---

## 2. Required documentation sections

### Purpose

Own the **definition surface of a node**: identity, type/version, parameter schema & values, input/output definitions, metadata, configuration/display rules, issues, and the lifecycle *interface* a node implements — shared identically by nodes-base definitions, the execution engine, the REST API and the editor.

### Source files

See table §1.1. **Added by this task:** `reference/n8n/packages/workflow/src/node-model/index.ts` (boundary barrel, additive only).

### Public API

* Package-level (unchanged): everything still exported from `n8n-workflow` root (`src/index.ts: export * from './interfaces'` etc.).
* New explicit boundary: `n8n-workflow/node-model` (resolved via existing `"./*": "./*"` subpath export → `dist/{esm,cjs}/node-model/index.js`), re-exporting:
  1. identity/instance types (`INode`, `INodes`, `IPinData`, `INodeCredentials*`, `OnError`)
  2. parameter value types + structured values (`NodeParameterValueType`, ResourceLocator/Mapper/Filter/Assignment)
  3. property definitions (`INodeProperties` family, display options)
  4. descriptions & metadata (`INodeTypeDescription`, `INodeTypeBaseDescription`, icons, hints, codex, declarative-routing **definitions**, webhook **descriptions**)
  5. IO definitions (`NodeConnectionTypes`, `nodeConnectionTypes`, `INodeInput/OutputConfiguration`, `IConnections` family)
  6. lifecycle contract (`INodeType`, `IVersionedNodeType`, `Node`, `SupplyData`, `NodeOutput`, `Engine*`, `I*Functions` boundary contexts)
  7. output item & issues types (`INodeExecutionData`, `IBinary*`, `IPairedItemData`, `INodeIssues*`)
  8. registry interface (`INodeTypes`, `INodeTypeData`, loading DTOs)
  9. implementations: `VersionedNodeType`, `validateNodeCredentials`, `isNodeConnected`, `isTriggerLikeNode`, all of `node-helpers`, `node-parameters/*` utilities

Exactly **58 runtime exports** (verified via `require()` of built CJS bundle); types are compile-time only.

### Inputs (into the Node Model)

* node definitions authored in `nodes-base` / `nodes-langchain` (classes + `INodeTypeDescription`)
* `INode` instances (workflow JSON), `IConnections` (graph data), pinned data
* options objects for helpers (e.g. `GetNodeParametersOptions`)

### Outputs (from the Node Model)

* effective parameter values (`INodeParameters`), `INodeIssues`, resolved inputs/outputs lists, webhook path/url strings, version-resolved `INodeType`s, filter results, validation assertions

### Dependencies

`@n8n/errors`, lodash, `luxon` (constants), intra-package `utils/type-guards/type-validation`, expression *detector* only; **type-only** edge to `Workflow` (Agent 1) and `IRunExecutionData` (Agent 3). No dependency on io/db/http.

### Consumers

§1.3 — every subsystem; that is exactly why the boundary must stay non-breaking.

### Owns

Type contracts listed in contract §1 + their pure helper/validation logic + `VersionedNodeType` + the lifecycle **interfaces**.

### Does NOT own

Registry implementation, node loading/scanning, execution engine, execution contexts, expression runtime, webhook routing/persistence, credential storage/decryption, workflow graph management, scheduling/queue/persistence, editor rendering.

### Isolation boundary

```
┌─────────────────────────────────────────────────────────────┐
│                        NODE LEGO                            │
│  packages/workflow/src/node-model/index.ts  (barrel)        │
│    ├─ interfaces.ts        (contracts; shared file — noted) │
│    ├─ node-helpers.ts      (pure ops over contracts)        │
│    ├─ versioned-node-type.ts                              │
│    ├─ node-validation.ts                                  │
│    └─ node-parameters/*                                   │
└───────────────────────┬─────────────────────────────────────┘
                        │  contract (contracts/node.contract.md)
        ┌───────────────┼────────────────┬───────────────┐
        ▼               ▼                ▼               ▼
   Workflow LEGO   Execution LEGO    CLI/API + infra   Editor UI
   (Agent 1)       (Agent 3)         (Agent 4)         (consumer)
   typed edge:     implements        implements        renders
   Workflow type   I*Functions       INodeTypes,       descriptions
   only            + RoutingNode     loads, serves     from REST
```

Change applied: **one additive file** in the reference (`packages/workflow/src/node-model/index.ts`, 317 LoC, re-exports only). Verified by `git status`: `?? packages/workflow/src/node-model/` — zero modifications to existing files. The same change is committed as a standalone patch: `patches/0001-node-model-boundary.patch`.

### Tests

* Baseline (BEFORE): `n8n-workflow` full unit suite — **48 files / 2015 tests PASS** (`pnpm vitest run` in `packages/workflow`).
* Node-model-related subset: `test/node-helpers.test.ts`, `test/node-helpers.conditions.test.ts`, `test/node-validation.test.ts`, `test/node-parameters/*`(3), `test/filter-parameter.test.ts`, `test/rename-node-utils.test.ts` — **8 files / 532 tests**.
* Adjacent suites also green in full run: `test/node-errors.test.ts`, `test/errors/node.error.test.ts`, `test/node-reference-parser-utils.test.ts`, `test/common.test.ts`, `test/type-validation.test.ts`.

### Before status

* `pnpm install` — provisioned via filtered workspace install (full install blocked in sandbox: `codeload.github.com` wa-sqlite tarball for `@n8n/design-system`, and `cdn.sheetjs.com` for xlsx are unreachable; both are unrelated to `n8n-workflow`). `@types/ssh2@1.11.6` hand-placed into root `node_modules/@types` to reproduce the type-hoisting CI gets from a full install (environment shim, no source change).
* `pnpm --filter n8n-workflow typecheck` — **PASS** (pre-change, confirmed identical run post-change).
* `pnpm --filter n8n-workflow test` — **2015 PASS**.
* Package `build` — PASS.

### After status

* `n8n-workflow test` — **48 files / 2015 tests PASS** (identical to baseline).
* Node-model subset — **8 files / 532 tests PASS**.
* `typecheck` — **PASS** with barrel present (it also type-validates the barrel's re-export names).
* `build` — **PASS**; barrel emitted to `dist/esm/node-model/` and `dist/cjs/node-model/`.
* Runtime import check of built barrel — PASS (58 runtime exports; `NodeConnectionTypes.Main === 'main'`; `VersionedNodeType`, `Node`, `getNodeParameters`, `validateNodeCredentials`, `executeFilter` resolvable).
* Reference diff — additive only (`?? packages/workflow/src/node-model/`).

### Known limitations

1. **Smoke test not executed in this sandbox.** The 11-point reference smoke suite (n8n starts → editor → save/import → executions → webhook) requires a full monorepo build incl. `editor-ui`/`design-system`, whose dependencies (`wa-sqlite` github tarball, `xlsx` from `cdn.sheetjs.com`) are blocked by sandbox egress. Expected impact of this change is *none by construction*: it adds one unimported module and modifies nothing else; behavior-affecting tests (2015) are exactly identical. A full `pnpm install && pnpm build && n8n start` run should be executed in CI/an unrestricted runner before flipping status to VERIFIED-by-smoke.
2. `interfaces.ts` remains a shared multi-domain file — the boundary is enforced by the barrel + contract, not by file moves (deliberate; see §1.5).
3. `node-model` barrel is currently re-export-only; progressive consumer migration onto the boundary path is future work for other agents and must not alter imports of untouched areas without coordination.

---

## 3. Coordination notes for other agents

* **Agent 1 (Workflow):** untouched. Two type-only edges exist into `Workflow` (`NodeHelpers.isExecutable`, `getNodeInputs/Outputs`). If `Workflow`'s public shape changes, these signatures need review.
* **Agent 3 (Execution):** untouched. `I*Functions` boundary types documented in contract §4; execution owns their implementations.
* **Agent 4 (Infra/API):** untouched. `INodeTypes` implementation (`cli/src/node-types.ts`) and `LoadNodesAndCredentials` remain yours; contract §8 documents the interface you implement.
* **Agent 5 (Tests):** no test files were added/changed. Node-related test inventory is listed above for your coverage mapping.

### 3.1 Main-branch integration state (inspected 2026-09-17, `origin/main@82be4146`)

The integration branch `main` (separate, unrelated git history — Arena orchestrates merges) now contains:

* ✅ **Official smoke baseline:** `tests/reference/baseline/SMOKE_TEST_RESULTS.md` — **11/11 PASS**
  on VPS (`157.10.160.95`, Ubuntu 24.04) against pristine `n8n@2.9.4` @ `b6dc278` — the exact
  commit pinned by this work. This is the project's BEFORE reference for the regression rule.
  Node-LEGO regression gate: my change is additive-only with identical unit/typecheck/build
  results; the AFTER 11-point run on this branch state belongs to Agent 5's environment.
* ⚠️ **Contract divergence:** `main/contracts/node.contract.md` is a ~30-line scaffold
  ("assume-first" draft: only `id/name/type/typeVersion/position`-style `NodeContract`).
  `contracts/node.contract.md` in THIS branch is source-verified against 2.9.4 (source wins).
  At integration, reconcile in favor of the source-verified contract — the scaffold lacks
  connections/value/lifecycle/registry semantics and contains nothing contradicted here.
* ⚠️ **Reference-in-git divergence:** `main` commits `reference/` in-tree (~15k files);
  this branch keeps it git-ignored and commits `patches/0001-node-model-boundary.patch`
  instead. Either is workable; do not mix both for the same path.
* ✅ No conflicts: `main` has `docs/isolation/workflow.md` (Agent 1) but no
  `docs/isolation/node.md` — this document fills that gap. `main` also brings
  `docs/anatomy/04-node-system.md` (anatomy-side analysis, complementary to this isolation doc)
  and `tests/integration/regression_gate.py`.

## 4. Reproducing the reference workspace

```bash
git clone --depth 1 --branch n8n@2.9.4 https://github.com/n8n-io/n8n.git reference/n8n
cd reference/n8n
corepack enable   # pnpm 10.22.0
pnpm install --frozen-lockfile          # needs unrestricted egress
pnpm --filter n8n-workflow^... build && pnpm --filter n8n-workflow test
git apply ../../patches/0001-node-model-boundary.patch
pnpm --filter n8n-workflow typecheck && pnpm --filter n8n-workflow build
```

`reference/` is git-ignored in this repo (monorepo size) — the committed deliverables are the docs, the contract and the patch.
