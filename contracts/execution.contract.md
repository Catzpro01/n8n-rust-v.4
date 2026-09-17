# LEGO Contract: Execution Engine

**Derived from:** n8n 2.9.4 source — `packages/core/src/execution-engine/workflow-execute.ts`, `.../node-execution-context/*`, `packages/workflow/src/{workflow.ts,workflow-data-proxy.ts,errors/*,run-execution-data-factory.ts}`
**Owner:** execution LEGO (Agent-1 scope, Phase 3 reconstruction)
**Status:** IMPLEMENTED · TESTED (60/60)
**Implementation:** `packages/execution-engine/src/*.mjs` (JavaScript / Node.js ESM, zero dependencies)
**Rust:** none — this LEGO is JavaScript (`PROJECT_RULES.md` v2.9.4 §1). Since `docs/isolation/PHASE-3-OPENING-RECORD.md`,
Rust is permitted for the port track only under `crates/**` + `apps/**`; gate `E03` enforces that confinement.

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

* `IRun`-shaped result: `{ status: 'success' | 'error' | 'waiting', mode, startedAt, stoppedAt, data: IRunExecutionData }`,
  plus `finished: true` **only** on a clean finish and `waitTill` **only** while waiting
  (`getFullRunData` L2452-2461 returns neither; `workflow-execute.ts` L2429-2440 assigns one of them).
* `data.resultData.runData[nodeName][runIndex]` — one `ITaskData` per run with
  `startTime`, `executionIndex`, `executionTime`, `source[]`, `executionStatus`, `data.main`, optional `error`.
* `data.resultData.lastNodeExecuted`, `data.resultData.error`.
* `data.executionData.{nodeExecutionStack, waitingExecution, waitingExecutionSource}` keep the restart/join state.
* Activation path (TASK-ENGINE-ACTIVATION-01): `ActiveWorkflows.add(workflowId, …)` returns once every trigger node is
  started and every poller is registered; `remove(workflowId)` closes triggers and deregisters crons;
  `TriggersAndPollers.runTrigger` returns the node's `ITriggerResponse`, and in manual mode the response carries
  `manualTriggerResponse` (a promise resolved by `emit(data)` / `emitError(error)` / `saveFailedExecution(error)`).

## 4. Public surface (must match `E08` of `tools/execution-engine-gate.mjs`)

| Symbol | Module | Role |
|---|---|---|
| `WorkflowExecute` | workflow-execute.mjs | the execute loop (`run`, `processRunExecutionData`, `runNode`, `executeNode`, `ensureInputData`, `assignPairedItems`, `handleNodeErrorOutput`, `routeOutputData`) |
| `LOOP_ERRORS`, `getMainOutputCount`, `getNodeOutputs` | workflow-execute.mjs | pinned messages + main-output counting (`getMainOutputCount(description, node)` counts the `continueErrorOutput` error output; `getNodeOutputs` returns the node-aware output list) |
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
| `WorkflowActivationError`, `WorkflowDeactivationError`, `TriggerCloseError`, `UserError` | errors.mjs | activation/deactivation error model, including the `cause` re-wrap and `level` derivation |
| `ExecutionLifecycleHooks`, `createDeferredPromise` | lifecycle-hooks.mjs | the 8-name hook store (`addHandler`/`runHook`, handlers awaited in order) + the deferred-promise factory used by manual triggers |
| `TriggersAndPollers` | triggers-and-pollers.mjs | runs a trigger node (`runTrigger`, incl. the manual-mode `manualTriggerResponse` + emit/emitError/saveFailedExecution overrides) and a poller (`runPoll`) |
| `ActiveWorkflows`, `ScheduledTaskManager`, `toCronExpression` | active-workflows.mjs | activation registry (`add`/`remove`/`closeTrigger`/`createPollExecuteFn`), dependency-free cron bookkeeping (keying, duplicate guard, deregistration) and the `TriggerTime → cron` mapper |
| `TriggerContext` | trigger-context.mjs | `nodeType.trigger`'s context: throwing `emit`/`emitError`/`saveFailedExecution` defaults, `getActivationMode()`, `getCredentials()` boundary, `helpers.createDeferredPromise`/`returnJsonArray` |
| `WaitTracker` | wait-tracker.mjs | schedules and resumes waiting executions via timers, DB queries (`getWaitingExecutions`), project resolution, and parent execution resumption |
| `WaitTracker` reference quirks (pinned by the ISSUE-028 repair `e823d4f0`, verified in review sweep 24) | wait-tracker.mjs | 1:1 fidelity, not hardening: `startedAt` always a key of the `data` literal (L120-127); `waitTill.getTime() - now` with **no** zero clamp (L78); `startTracking()` has **no** re-entry guard (L47-58); `waitTill` is not coerced to `Date`; `workflowData.id` is read **without** optional chaining (L113). Each printed by a regression test in `test/07-wait-tracker.test.mjs` |
| `getDataLastExecutedNodeData`, `shouldRestartParentExecution`, `updateParentExecutionWithChildResults` | workflow-helpers.mjs | helpers for WaitTracker: child execution output extraction, parent execution restart guards, and parent nodeExecutionStack updates |
| `OperationalError`, `ExecutionAlreadyResumingError` | errors.mjs | operational errors; duplicate resume suppression during sub-workflow completions |
| `ActiveExecutions` | active-executions.mjs | in-memory active execution lifecycle, registration, concurrency reservations, streaming chunk writing, post-execute settlement, and cancellation |
| `ExecutionNotFoundError`, `ExecutionCancelledError`, `ManualExecutionCancelledError`, `TimeoutExecutionCancelledError`, `SystemShutdownExecutionCancelledError` | errors.mjs | execution lookup and cancellation errors for active workflow stopping and shutdown |
| `WorkflowRunner` | workflow-runner.mjs | central workflow execution coordinator: `run`, `runMainProcess`, `processError`, `enqueueExecution`, timeout handling, streaming callbacks, and error recovery |
| `MaxStalledCountError` | errors.mjs | BullMQ stalled worker error representation for queue-mode retry exhaustions |
| `SubworkflowOperationError` | errors.mjs | sub-workflow execution error model |
| `STARTING_NODES`, `findSubworkflowStart` | subworkflow-execution.mjs | sub-workflow trigger discovery (executeWorkflowTrigger priority, manual trigger fallbacks) |
| `getRunData`, `getBase`, `executeWorkflow` | subworkflow-execution.mjs | sub-workflow execution lifecycle: input mapping, run data construction, active execution tracking, waitTill extraction, and error propagation |
| `ManualExecutionService` | manual-execution.mjs | manual execution service coordinating trigger-to-start, full, and partial runs |
| `DirectedGraph`, `TOOL_EXECUTOR_NODE_NAME`, `cleanRunData`, `filterDisabledNodes`, `findStartNodes`, `findSubgraph`, `findTriggerForPartialExecution`, `handleCycles`, `isTool`, `recreateNodeExecutionStack`, `rewireGraph` | partial-execution.mjs | graph representations and partial execution algorithms for manual trigger starts and sub-graph isolation |
| `DEFAULT_SAVE_CONFIG`, `toSaveSettings` | save-settings.mjs | execution save settings resolution against global and per-workflow policies |
| `FailedRunFactory`, `generateFailedExecutionFromError` | failed-run-factory.mjs | structured failed execution run data creation for pre-execution failures and permission blocks |
| `executeErrorWorkflow`, `saveExecutionProgress` | error-workflow.mjs | error workflow execution dispatching and per-node execution progress database persistence |
| `ExecutionRecoveryService`, `ARTIFICIAL_TASK_DATA` | execution-recovery.mjs | truncated/crashed execution recovery from event logs, artificial task data synthesis, and workflow auto-deactivation |
| `NodeCrashedError`, `WorkflowCrashedError` | errors.mjs | crash errors indicating OOM or abnormal termination during node or workflow execution |

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

## 6b. Activation invariants (TASK-ENGINE-ACTIVATION-01, pinned to reference lines)

| # | Invariant | Source | Test |
|---|---|---|---|
| A1 | `runTrigger` without a trigger function throws `ApplicationError('Node type does not have a trigger function defined')` with `extra.nodeName` + `tags.nodeType`; `runPoll` mirrors it for `poll` | triggers-and-pollers.ts L35-40, L105-110 | 05 · runTrigger/runPoll |
| A2 | Manual mode attaches `manualTriggerResponse` *after* the trigger ran; the emit/emitError/saveFailedExecution overrides are installed inside the promise executor, so a missing `hooks` object rejects that promise instead of throwing | L42-90 (oracle triggers-and-pollers.test.ts manual block) | 05 · manual mode |
| A3 | `emit(data, responsePromise?, donePromise?)` resolves the manual response and registers `sendResponse` / `workflowExecuteAfter` handlers that settle the caller's deferred promises | L55-66 | 05 · emit |
| A4 | `add()` starts triggers first, stores `{ triggerResponses }`, then polling; a polling failure deletes the entry only when there was no trigger response, and always rejects with `WorkflowActivationError` | active-workflows.ts L81-145 | 05 · add/rollback |
| A5 | Polling: the initial test run happens **before** any cron registration and rethrows; later ticks emit data, skip `null`, and emit the error instead of throwing | L150-186, L255-288 | 05 · polling |
| A6 | A cron expression whose first field contains `*` is rejected with `UserError` ("The polling interval is too short. It has to be at least a minute.") before registration | L170-175 | 05 · interval |
| A7 | `remove()` deregisters crons, closes triggers, returns `false` + warns for an inactive id; `TriggerCloseError` is logged/reported (not thrown), other close errors become `WorkflowDeactivationError` | L189-249 | 05 · remove/close |
| A8 | `WorkflowActivationError` copies an `ApplicationError` cause into a plain Error keeping name/message/stack and derives `level` (timeout/refused/auth ⇒ `warning`) | workflow-activation.error.ts L19-59 | 05 · interval (cause quirk) |
| A9 | Hook store: 8 names, `addHandler` pushes, `runHook` awaits handlers in order with `this` bound, a throwing handler stops the rest | execution-lifecycle-hooks.ts L88-134 | 05 · hooks |
| A10 | `queryNodes`/`getTriggerNodes`/`getPollNodes` skip disabled nodes and keep declaration order | workflow.ts L254-295 | 05 · model |
| A11 | `toCronExpression` inserts the random second (and random minute for `everyX: hours`) and trims a custom expression verbatim | cron.ts L52-72 | 05 · cron |

## 7. Known deltas vs. n8n 2.9.4 (explicit, not accidental)

1. **Expression evaluation is a bounded JavaScript subset, not the upstream sandbox.**
   `=`-prefixed values are evaluated inside a fresh `node:vm` context (`src/expression-sandbox.mjs`,
   covered by gate `E09`): a source scan rejects prototype/`constructor`/`__proto__` access,
   restricted globals (`process`, `require`, `eval`, `Function`, `this`, …) and `import`/`class`/`with`;
   host values cross a read-only membrane (prototype properties denied, mutating array/date methods
   and every `set`/`delete`/`defineProperty` blocked) and each evaluation is bounded by
   `timeoutMs` (default 100 ms) with code generation disabled. The upstream **JEXL / `@n8n/tournament`
   AST sandbox** (`expression-sandboxing.ts`, `__sanitize`, `___n8n_data`, `DOLLAR_SIGN_ERROR`) is
   still **not** reconstructed, so semantics are not upstream-equivalent — do not point this at
   untrusted workflows expecting n8n parity.
2. **No cancellation / `AbortController`**, no `executionTimeoutTimestamp` checks.
3. **No engine requests** (AI agent pause/resume, `requests-response.ts`), no `subNodeExecutionResults`.
4. **No partial execution** (`runPartialWorkflow2`, `partial-execution-utils/*`).
5. **No binary-data conversion** in the loop (`convertBinaryData`, `binary-data/*`).
6. **Legacy `forceInputNodeExecution`** only follows direct inputs; upstream additionally walks grandparent nodes.
7. **Trigger/poll execution**: `trigger.call(context)` and `poll.call(context)` are invoked, but the
   webhook/polling services (`triggers-and-pollers.ts`, `active-workflows.ts`) are out of scope.
8. **Data proxy**: `$vars`, `$secrets`, `$evaluateExpression`, data tables, `$fromAI`, `$jmespath`
   and the full Luxon surface are not reconstructed (`DataProxyDateTime` covers the common tokens).
9. **Queue mode, error reporting/telemetry** are out of scope. The lifecycle hook store itself *is*
   reconstructed (`ExecutionLifecycleHooks`), but the engine only ever fires the hooks it already fires.
10. **Cron scheduling is an injected adapter.** The reference `ScheduledTaskManager` wraps the `cron`
   package (a runtime dependency the engine must not take — gate `E01`), so `registerCron(ctx, onTick)`
   / `deregisterCrons(workflowId)` are the boundary: `ScheduledTaskManager` reproduces the keying,
   summaries and duplicate guard, and the caller supplies the timer.
11. **TriggerContext helper families**: only `createDeferredPromise` + `returnJsonArray` are present; the
   SSH-tunnel, request, binary and scheduling helper families belong to other LEGOs/adapters and are not
   reconstructed here.
12. **`getCredentials()`** delegates to an injected `_getCredentials` adapter when the caller supplies one
   (credentials LEGO); otherwise it raises the boundary warning error instead of returning `{}`.

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
| the bounded `node:vm` evaluator guard (`expression-sandbox.mjs`) | upstream AST rewriting (`@n8n/tournament`), JEXL semantics |
| run-data factories used by the loop | persistence, pruning, queueing, webhooks, credentials, binary storage |
| activation lifecycle (trigger responses, poller scheduling bookkeeping, lifecycle hook store) | the scheduling runtime (`cron`), webhook HTTP servers, credential resolution, instance leadership |
