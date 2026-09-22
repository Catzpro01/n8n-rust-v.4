# LEGO → Runtime Integration Audit (TypeScript baseline, Phase TS-1)

Owner: **Worker 4** (`data-plane/ts1-lego-integration`) · Reviewed/merged by the manager.
Contract: [`contracts/runtime-api.contract.md`](../contracts/runtime-api.contract.md) §5 (single engine rule).
Rust: **FROZEN** — this document deliberately contains no Rust work item.

## 1. Inventory of the existing LEGOs

| LEGO | Path | Language / shape | Runnable as-is by the runtime? | Role in the baseline |
| :--- | :--- | :--- | :--- | :--- |
| Execution engine | `packages/reconstructed-engine` | ESM JavaScript + TypeScript sources | **Yes** (pure ESM, Node built-ins only) | **The single execution engine** used by `apps/n8n-ts` |
| Workflow model | `packages/workflow-lego` | TypeScript, extracted build (`.extract/`), binds `n8n-workflow@2.9.1` | Not without the extraction build; its `model-surface.ts` re-exports the pinned reference package | Declared boundary + parity gate for the workflow model (structure, connections, adjacency, checksums) |
| Execution runtime | `packages/execution-lego` | TypeScript boundary surface over the reference runtime | No — it is a *port surface* (`model-surface.ts`) plus reference-pinned provenance checks | Declares active executions, activation, context hooks, crash recovery; its own docblock states it depends on `@lego/reconstructed-engine`'s execution engine |
| Events | `packages/events-lego` | TypeScript boundary surface | No | Event bus boundary (not needed for the baseline run path) |
| Queue | `packages/queue-lego` | TypeScript boundary surface | No | Queue mode boundary (single-process baseline does not scale out) |
| Realtime | `packages/realtime-lego` | TypeScript boundary surface | No | Push/SSE boundary (baseline console polls `/healthz` instead) |

**Finding:** only `reconstructed-engine` is a *runtime* LEGO today; the other five are *declared
boundaries* whose sources are pinned to n8n 2.9.4 and verified by the isolation gates
(`tools/*-isolation-gate.mjs`, `tools/workflow-*.mjs`). Wiring the TS boundary LEGOs into the running
process would require the extraction build (`.extract/`) and would add no behaviour to the baseline —
therefore the integration is **contract-level, not import-level**, and is documented here rather than
faked with a second implementation.

## 2. What the runtime consumes (import graph)

```
apps/n8n-ts/src/engine/bridge.ts
        └── import { ENGINE_PACKAGE, ENGINE_VERSION, NODE_REGISTRY_VERSION,
                     createNodeRegistry, runWorkflowDefinition, validateWorkflowDefinition,
                     listNodeTypes, WorkflowRunError }
            from '../../../packages/reconstructed-engine/index.mjs'
                        │
                        ├── validation.mjs      (pre-flight: EMPTY_WORKFLOW / INVALID_WORKFLOW + warnings)
                        ├── node-registry.mjs   (the only node behaviour in the repository's TS side)
                        └── runner.mjs          (the reconstructed n8n 2.9.4 DAG execution loop)
                                ├── node-catalog.mjs   (n8n 2.9.4 node labels/descriptions, 6 locales)
                                └── localization.mjs   (response metadata locale layer)
```

`packages/reconstructed-engine/index.mjs` is exported through the package `exports` map, so the runtime
imports a frozen path rather than reaching into internal files.

## 3. Single-engine proof (enforced by gate, not by convention)

`tests/integration/runtime_lego_integration.mjs` (Worker 3) asserts, on every CI run:

1. `apps/n8n-ts/src/**` contains exactly one module that imports the engine entrypoint
   (`src/engine/bridge.ts`) and **no** module that implements a queue/DAG loop, node handler table, or
   `runWorkflow`-style function.
2. No runtime `dependencies` beyond repo-local packages in `apps/n8n-ts/package.json`
   (no `express`, `zod`, `dotenv`, `n8n-core`, `n8n-workflow`).
3. `packages/reconstructed-engine/runner.mjs` still exposes the single `runWorkflow` loop, and the
   registry supplies behaviour only through `registerNodeType`.

## 4. Behaviour decisions made in this worker

| Decision | Rationale |
| :--- | :--- |
| Locale layer restricted to response metadata | `runner.mjs` used to localize the whole response, which could rewrite user payload strings under human-facing keys (`json.message`, `json.title`, …). The entrypoint keeps `data` byte-identical to handler output, and preserves `statusText` / `executionLog[].statusText` / `nodeLabel` additively. |
| Warning collection is per run | `createNodeRegistry()` is instance-scoped; warnings never leak between executions (asserted by test `handlers never leak warnings between runs`). |
| Unknown node types are not registered | Falling through to the runtime's unknown-node policy produces an explicit `UNKNOWN_NODE_TYPE` warning instead of a silent wrong result. |
| `jsCode` is disabled by default | Arbitrary JavaScript is not a baseline feature. When enabled (`N8N_TS_ALLOW_CODE_EVAL=true`) it runs in `node:vm` with a 1 s timeout, no `require`/`process`, and results are copied back into the host realm. Documented as **not** a security boundary. |
| Deterministic handlers | Regression fixtures (and later Rust equivalence tests) need byte-stable outputs: no clock, no randomness, no network. |
| `WorkflowRunError` for pre-execution failures | Lets the HTTP layer map `EMPTY_WORKFLOW` / `INVALID_WORKFLOW` to 422 without string-matching engine messages. |

## 5. Divergences from n8n 2.9.4 (recorded, not hidden)

| Area | Reference (n8n 2.9.4) | Baseline | Impact |
| :--- | :--- | :--- | :--- |
| Expressions | Full expression engine (`{{ }}`, `$json`, `$node`, …) | Not evaluated; literal value used + warning | Workflows that rely on expressions must not be trusted to compute — documented in the runtime README |
| Routers | `if`/`switch`/`merge` route outputs by index | Not registered; passthrough + warning | Conditional workflows are out of baseline scope |
| Node catalog | 400+ built-in nodes | 7 registered handler types | Explicit warning per unknown node |
| Task runner | Code node runs in a separate task runner process | Opt-in `node:vm` sandbox for `jsCode` | Not production safe — flag defaults to `false` |
| Persistence | Full DB (TypeORM/SQLite/Postgres) | JSON file store for workflows + execution records | Baseline only; Rust migration will revisit |
| Locale | i18n on the full response | Metadata-only | User payloads stay machine-canonical |

## 6. Migration path to Rust (after `TYPESCRIPT BASELINE FROZEN`)

The TypeScript baseline is the executable specification. Migration happens **one LEGO at a time**, each
with an equivalence gate against the frozen TypeScript behaviour — never as a big-bang rewrite:

| Order | LEGO → Rust crate | Equivalence source in this baseline |
| :--- | :--- | :--- |
| 1 | validation surface → `crates/n8n-validation` | `tests/fixtures/runtime/**` + `packages/reconstructed-engine/validation.mjs` |
| 2 | workflow model → `crates/n8n-workflow`, `crates/n8n-connection` | `packages/workflow-lego` manifests + runtime fixtures |
| 3 | node registry → `crates/n8n-nodes-rust` | deterministic handler outputs captured in `tests/fixtures/runtime/expected/**` |
| 4 | execution loop → `crates/n8n-execution-*` | `08-regression.test.mjs` byte-stable `data` snapshots |
| 5 | HTTP/runtime shell → `apps/n8n-rust` | `contracts/runtime-api.contract.md` (the contract is language-neutral by design) |

No Rust crate is created or modified during Phase TS-1.
