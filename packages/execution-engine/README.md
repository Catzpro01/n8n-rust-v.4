# @lego/execution-engine

Reconstructed n8n **2.9.4** workflow execution engine — JavaScript (Node.js ESM), zero
dependencies, no build step. Part of the Phase-3 reconstruction on the JavaScript track
(`PROJECT_RULES.md` v2.9.4 §1); gate `E03` proves it contributes no Rust and that the Phase-3 port
track stays confined to `crates/**` + `apps/**`.

```bash
node --test test/*.test.mjs     # 32 assertions, node:test only
node ../../tools/execution-engine-gate.mjs   # 8 gates + evidence
```

| Module | Reconstructs |
| :--- | :--- |
| `src/workflow-execute.mjs` | `WorkflowExecute.run/processRunExecutionData/runNode/executeNode/ensureInputData/assignPairedItems` |
| `src/execution-stack.mjs` | `addNodeToBeExecuted`, multi-input `waitingExecution`, `prepareWaitingToExecution` |
| `src/node-execution-context.mjs` | `ExecuteContext` + `returnJsonArray` / `normalizeItems` / `constructExecutionMetaData` / `copyInputItems` |
| `src/data-proxy.mjs` | `WorkflowDataProxy` (`$json`, `$node`, `$items`, `$input`, `$prevNode`, `$env`, `$now`, …) |
| `src/expression.mjs` | parameter resolution (`={{ … }}` / `=expr`), subset without the JEXL sandbox |
| `src/retry.mjs` | retry clamps (`maxTries`, `waitBetweenTries`) and `withRetry` |
| `src/error-handling.mjs` | `stopWorkflow` / `continueRegularOutput` / `continueErrorOutput`, error-item splitting |
| `src/errors.mjs` | `ApplicationError`, `NodeOperationError`, `NodeApiError`, `toExecutionError`, `isSoftFailure` |
| `src/run-execution-data.mjs` | `IRunExecutionData` factories (version 1) |
| `src/workflow.mjs` | injected carriers: `NodeTypesRegistry`, `ReconstructedWorkflow` (model stays in `packages/workflow-lego`) |

Behaviour is pinned to source lines — see
[`docs/isolation/execution.md`](../../docs/isolation/execution.md) (mapping + known deltas) and
[`contracts/execution.contract.md`](../../contracts/execution.contract.md) (invariants L1–L14, E1–E9).

**Status:** POOL-001 · POOL-002 · POOL-003 `IMPLEMENTED` — 32/32 tests, gate 8/8.
