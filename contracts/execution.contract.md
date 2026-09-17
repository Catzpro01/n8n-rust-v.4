# LEGO Contract: Execution Engine

**Derived from:** n8n 2.9.4 source — `packages/core/src/execution-engine/workflow-execute.ts`, `.../node-execution-context/*`, `packages/workflow/src/{workflow.ts,workflow-data-proxy.ts,errors/*,run-execution-data-factory.ts}`
**Owner:** execution LEGO (Agent-1 scope, Phase 3 reconstruction)
**Status:** IMPLEMENTED · TESTED (32/32)
**Implementation:** `packages/execution-engine/src/*.mjs` (JavaScript / Node.js ESM, zero dependencies)
**Rust:** NOT ALLOWED for this LEGO (`PROJECT_RULES.md` v2.9.4 rule 1)

---

## 1. Purpose

Run a workflow definition the way n8n 2.9.4 runs it: pick a start node, walk the node
execution stack, execute node types with an execution context, record run data, route
each output to its connected inputs, join multi-input nodes, and apply the node's
retry/error policy. Everything the loop consumes from other LEGOs is injected
(workflow model, node definitions, hooks), never imported from `reference/n8n`.

## 2. Input

| Input | Producer | Shape |
|---|---|---|
| workflow | Workflow LEGO (`contracts/workflow.contract.md`) | `{ id, name, active, settings, nodes: Record<name, INode>, connections, connectionsByDestinationNode, nodeTypes, getStartNode(), getHighestNode(), getParentNodes() }` |
| node definitions | Node LEGO (`contracts/node.contract.md`) | `{ description: { name, group, inputs, outputs }, execute?, trigger?, poll?, webhook?, customOperations? }` registered in a `NodeTypesRegistry` by `type@version` |
| start data | trigger / manual run | `startNodes: [{ node, data?, source? }]`, default `{ main: [[{ json: {} }]] }` |
| run data | persistence LEGO (`contracts/persistence.contract.md`) | a resumable `IRunExecutionData` (version 1) — see `contracts/execution-data.contract.md` |
| pin data | editor / manual run | `{ [nodeName]: INodeExecutionData[] }` |
| hooks | lifecycle caller | `{ runHook(name, args) }` for `workflowExecuteBefore/After`, `nodeExecuteBefore/After` |

## 3. Output

* `IRun`-shaped result: `{ status: 'success' | 'error' | 'waiting', mode, startedAt, stoppedAt, finished, data: IRunExecutionData, waitTill? }`.
* `data.resultData.runData[nodeName][runIndex]` — one `ITaskData` per run with
  `startTime`, `executionIndex`, `executionTime`, `source[]`, `executionStatus`, `data.main`, optional `error`.
* `data.resultData.lastNodeExecuted`, `data.resultData.error`.
* `data.executionData.{nodeExecutionStack, waitingExecution, waitingExecutionSource}` keep the restart/join state.

## 4. Public surface (must match `E08` of `tools/execution-engine-gate.mjs`)

| Symbol | Module | Role |
|---|---|---|
| `WorkflowExecute` | workflow-execute.mjs | the execute loop (`run`, `processRunExecutionData`, `runNode`, `executeNode`, `ensureInputData`, `assignPairedItems`, `handleNodeErrorOutput`, `routeOutputData`) |
| `LOOP_ERRORS`, `getMainOutputCount` | workflow-execute.mjs | pinned messages + main-output counting |
| `ExecuteContext` | node-execution-context.mjs | node execution context (`getInputData`, `getNodeParameter`, `getWorkflowDataProxy`, `helpers`) |
| `returnJsonArray`, `normalizeItems`, `constructExecutionMetaData`, `copyInputItems`, `getParameterValue`, `NO_OP_LOGGER` | node-execution-context.mjs | helper surface visible to node code |
| `WorkflowDataProxy`, `DataProxyDateTime`, `resolvePairedItemJson` | data-proxy.mjs | `$json/$node/$items/$input/…` |
| `resolveRetryPolicy`, `withRetry`, `sleep`, `RETRY_LIMITS` | retry.mjs | retry policy (POOL-003) |
| `resolveErrorStrategy`, `continuesOnError`, `errorPassThrough`, `splitErrorOutputs`, `mergeErrorInformation`, `buildErrorItem`, `ERROR_STRATEGIES` | error-handling.mjs | error policy (POOL-003) |
| `addNodeToBeExecuted`, `prepareWaitingToExecution`, `incomingConnectionIsEmpty`, `isLegacyExecutionOrder` | execution-stack.mjs | routing + multi-input join |
| `createRunExecutionData`, `createEmptyRunExecutionData`, `createErrorExecutionData`, `createDestinationNode`, `RUN_EXECUTION_DATA_VERSION` | run-execution-data.mjs | run data factories (I11 of the execution-data contract) |
| `ApplicationError`, `NodeOperationError`, `NodeApiError`, `UnexpectedError`, `toExecutionError`, `isSoftFailure`, `errorMessageOf` | errors.mjs | error model |
| `evaluateExpressionValue`, `evaluateCode`, `resolveParameterValue`, `isExpression`, `ExpressionError` | expression.mjs | parameter resolution (subset, see §7) |
| `NodeTypesRegistry`, `ReconstructedWorkflow`, `isTriggerLike` | workflow.mjs | injected carriers for the loop (not a model implementation) |

## 5. Loop invariants (pinned to source lines)

| # | Invariant | Source | Test |
|---|---|---|---|
| L1 | One `ITaskData` per node run; `runIndex` = number of recorded runs for that node | `workflow-execute.ts` L1556-1562 | 01 · I12 |
| L2 | `executionIndex` increments monotonically across the whole execution | L1495-1500 | 01 · linear chain |
| L3 | Node is skipped when its `connectionInputData` is empty; a `null` return records **no** task data | L1213, L1787 | 01 · null branch |
| L4 | `[[]]` (empty array) is a **successful** task; downstream nodes do not run | L1772 | 01 · I8 |
| L5 | `alwaysOutputData` converts an empty output into `{ json: {}, pairedItem: [{item, input} …] }` | L1745-1768 | 01 · I9 |
| L6 | Input items get `pairedItem = { item, input }` before the node runs; missing output `pairedItem` is auto-filled only when unambiguous (1-in/1-out, same count, aggregation) | L1523-1540, L2581 | 01 · I3/I4 |
| L7 | Every output is routed to its `main[outputIndex]` consumers with `source = { previousNode, previousNodeOutput, previousNodeRun }` | L2000-2050 | 01 · I6/I7 |
| L8 | Legacy order (`executionOrder !== 'v1'`) sorts newly added nodes top-left first and force-executes input nodes; `v1` enqueues with `unshift` | L413, L2019-2060 | 01 · ordering, destination |
| L9 | A node with >1 input waits in `waitingExecution` until every input carries data; the joined entry is executed once with `data.main[i]` per input | L424-560 | 01 · merge |
| L10 | `destinationNode` restricts execution through `runNodeFilter` | L142-153, L1571 | 01 · destination |
| L11 | `pinData` replaces a node's output without executing it | L1636-1642 | 01 · pinData |
| L12 | Re-processing the same `node:runIndex` in one execution stops with `Stopped execution because it seems to be in an endless loop` | L1563-1568 | 01 · endless loop |
| L13 | `nodeExecuteBefore` fires before a node (skipped when `metadata.nodeWasResumed`) and `nodeExecuteAfter` after it | L1585-1595 | 01 · hooks |
| L14 | A disabled node passes its input through and records a task | L911 | 01 · disabled |

## 6. Retry & error semantics (POOL-003)

| # | Behaviour | Source | Test |
|---|---|---|---|
| E1 | `retryOnFail` → `maxTries = min(5, max(2, node.maxTries \|\| 3))`, `waitBetweenTries = min(5000, max(0, node.waitBetweenTries \|\| 1000))`; otherwise `1` / `0` | L1597-1612 | 03 · policy |
| E2 | A thrown error is retried; the retries stay inside one run and one `ITaskData` | L1614-1830 | 03 · retry |
| E3 | A returned `{ json: { error } }` item is a **soft failure** and drives the same retry loop | L1670-1692 | 03 · soft failure |
| E4 | Soft failures that exhaust the retries are recorded as **success** tasks that carry `{ json: { error } }` (upstream has no `executionError` for them) | L1670-1740 | 03 · pinned quirk |
| E5 | Exhausted thrown error with default `onError` stops the execution: task status `error`, `resultData.error` set, the failed stack entry is put back for a restart, downstream nodes do not run | L1866-1925 | 03 · stop |
| E6 | `continueOnFail: true` (legacy) and `onError: 'continueRegularOutput'` pass `main[0]` of the input through and keep running | L1843-1852 | 03 · continue |
| E7 | `onError: 'continueErrorOutput'` moves error items (item.error, or json with only `error`/`error`+`message`) onto the last main output; the resolved paired item's json is merged under the error json | L2463-2570 | 03 · error output |
| E8 | Items carrying `error` (or `{ $error, $json }`) are normalised to `{ json: { error: message } }` with the error object preserved on the item | L1934-1958 | 03 · normalisation |
| E9 | `NodeOperationError` / `NodeApiError` keep `node`, `description`, `httpCode`, `errorResponse`; `toExecutionError` serialises the subset stored in run data | errors/*.ts | 03 · classes |

## 7. Known deltas vs. n8n 2.9.4 (explicit, not accidental)

1. **Expression evaluation is a JavaScript subset.** `=`-prefixed values are evaluated with a
   `new Function` scope carrying the data-proxy variables; the upstream JEXL sandbox
   (`expression-sandboxing.ts`, prototype allow-lists) is **not** reconstructed yet. Do not point
   this at untrusted workflows.
2. **No cancellation / `AbortController`**, no `executionTimeoutTimestamp` checks.
3. **No engine requests** (AI agent pause/resume, `requests-response.ts`), no `subNodeExecutionResults`.
4. **No partial execution** (`runPartialWorkflow2`, `partial-execution-utils/*`).
5. **No binary-data conversion** in the loop (`convertBinaryData`, `binary-data/*`).
6. **Legacy `forceInputNodeExecution`** only follows direct inputs; upstream additionally walks grandparent nodes.
7. **Trigger/poll execution**: `trigger.call(context)` and `poll.call(context)` are invoked, but the
   webhook/polling services (`triggers-and-pollers.ts`, `active-workflows.ts`) are out of scope.
8. **Data proxy**: `$vars`, `$secrets`, `$evaluateExpression`, data tables, `$fromAI`, `$jmespath`
   and the full Luxon surface are not reconstructed (`DataProxyDateTime` covers the common tokens).
9. **Queue mode, hooks beyond the five lifecycle hooks, error reporting/telemetry** are out of scope.

## 8. Dependencies

* Workflow LEGO — node/connection access (`contracts/workflow.contract.md` D-03/D-05)
* Node LEGO — `INodeType` shape and `description.inputs/outputs` (`contracts/node.contract.md`)
* Execution Data contract — `ITaskData`, `IRunData`, `IExecuteData` shapes (invariants I3-I13)
* Expression contract — parameter resolution surface (`contracts/expression.contract.md`)
* Caller-provided hooks — persistence/realtime LEGOs observe runs through them

## 9. Ownership

| Owns | Does NOT own |
|---|---|
| the execute loop, run index/execution index bookkeeping, task data assembly | the workflow model (`workflow.ts` is re-used, not reimplemented) |
| routing to child nodes, multi-input waiting/join, destination filtering | node catalogue / node type registry contents |
| retry policy, error strategy, error-output splitting, soft-failure detection | error message text of individual nodes |
| node execution context surface + data proxy variables | expression sandboxing / JEXL semantics |
| run-data factories used by the loop | persistence, pruning, queueing, webhooks, credentials, binary storage |
