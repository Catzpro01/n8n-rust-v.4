# Execution Loop Spec — n8n 2.9.4 `WorkflowExecute`

**Task:** `POOL-001-core-workflow-execute-loop` (dynamic_task_pool, priority 100)
**Module:** execution · **Phase:** 3 (reconstruction)
**Source of truth:** `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts` (2,655 lines, monorepo `n8n@2.9.4`, `@n8n/*` packages `2.9.1`)
**Method:** line-by-line deconstruction of `processRunExecutionData` + every method it calls. No behavior invented; every claim below carries a line reference (`WEX:<lines>`).

**Status: TESTED (spec-level)** — ready as the behavioral contract for TASK-PIPE-01..05 (native JS/TS reconstruction, ZERO RUST per `PROJECT_RULES.md`).

---

## 1. Purpose & boundary

`WorkflowExecute` owns the **serial node-dispatch loop** of n8n: it pops node executions off a
stack, runs one node at a time, records run data, and pushes the node's downstream partners back
onto the stack (directly, or via a waiting queue for multi-input nodes). It does **not** own: node
implementations (`nodes-base`), expression evaluation (`workflow.evaluateExpression` /
`WorkflowDataProxy`), persistence (hooks call out), or the transport/trigger layers.

```text
run()/runPartialWorkflow2()          ← stack seeding (TASK-PIPE-01)
        │
processRunExecutionData()            ← THE loop (this spec, TASK-PIPE-02)
  ├─ ensureInputData()               ← defer when input data missing
  ├─ runNode()                       → execute | poll | trigger | webhook | declarative | disabled
  ├─ assignPairedItems()             ← item pairing (TASK-PIPE-04)
  ├─ addNodeToBeExecuted()           ← output routing + waiting queue (TASK-PIPE-02/03)
  └─ waiting-nodes drain             ← multi-input join + requiredInputs
        │
processSuccessExecution()            ← status resolution, fullRunData, workflowExecuteAfter
```

## 2. Core state (all on `this.runExecutionData: IRunExecutionData`)

| Field | Type | Role in the loop |
| :--- | :--- | :--- |
| `executionData.nodeExecutionStack` | `IExecuteData[]` | work stack. **Pop from FRONT (`shift`)**, re-queue to BACK (`push`) for deferral, to FRONT (`unshift`) on error/waiting-resume (v1 order: `unshift` for normal enqueue) |
| `executionData.waitingExecution` | `{ [nodeName]: { [runIndex]: ITaskDataConnections } }` | parked input data for **multi-input** nodes until every input has data (or the drain decides it may run) |
| `executionData.waitingExecutionSource` | same shape with `ISourceData` | provenance mirror of `waitingExecution` (`previousNode`, `previousNodeOutput`, `previousNodeRun`) |
| `resultData.runData` | `{ [nodeName]: ITaskData[] }` | recorded per-run task data (input+output+timings) — also the "already executed" test (`runData[node] !== undefined`) |
| `resultData.lastNodeExecuted` | `string` | endless-loop guard + `rethrowLastNodeError` |
| `resultData.pinData` | `{ [nodeName]: INodeExecutionData[] }` | pinned editor data short-circuits node execution |
| `startData.destinationNode` / `runNodeFilter` | `IDestinationNode` / `string[]` | partial-execution slicing (TASK-PIPE-05) |
| `waitTill` | `Date` | node requested pause → status `waiting`, node re-queued for resume |

`IExecuteData = { data: ITaskDataConnections, node: INode, source: ITaskDataConnectionsSource | null, runIndex?, metadata? }`
`ITaskDataConnections = { [connectionType]: Array<INodeExecutionData[] | null> }` — `null` = input slot that has not received data yet.
(`reference/n8n/packages/workflow/src/interfaces.ts:449-453, 2675-2719`; factory: `workflow/src/run-execution-data-factory.ts:54-92`)

## 3. Entry — stack seeding (TASK-PIPE-01 scope)

`run()` (WEX:123-188):
1. `startNode = startNode || workflow.getStartNode(destinationNode?.nodeName)`; no start node → `ApplicationError('No node to start the workflow from could be found')` (WEX:133-137).
2. If `destinationNode` is set, build `runNodeFilter` = parent nodes (main + `ALL_NON_MAIN`) + destination itself only when `mode === 'inclusive'` + `additionalRunFilterNodes`, deduped (WEX:141-153).
3. Seed stack with exactly one entry: `{ node: startNode, data: triggerToStartFrom?.data?.data ?? { main: [[ { json: {} } ]] }, source: null }` (WEX:157-171).
4. `createRunExecutionData({ startData: {destinationNode, runNodeFilter}, executionData: {nodeExecutionStack}, resultData: {pinData} })` (WEX:173-182).

`runPartialWorkflow2()` (WEX:197-317) resumes from recorded `runData` (execution retry / "execute with previous data"): creates the stack from `runData` start nodes (`getStartNodeAndRunData`), re-uses `waitingExecution` so partial branches continue where they stopped (WEX:274-296).

Both funnel into **`processRunExecutionData(workflow)`**.

## 4. The main loop — `processRunExecutionData` (WEX:1403-2314)

### 4.0 Prologue
- `setupExecution()`: `status='running'`, asserts hooks exist, captures `startedAt` (WEX:1331-1356, 1404).
- `checkForWorkflowIssues()`: runs `checkReadyForExecution` (node/credential/input issues) → throws `WorkflowHasIssuesError` before anything executes (WEX:1305-1330, 1405).
- `handleWaitingState()`: if resuming a `waitTill` execution — unset `waitTill`, **disable the stack-top node** (it is the waiter), and **pop its last recorded run** so it doesn't show as run twice (WEX:1285-1304, 1406).
- Returns a **`PCancelable<IRun>`**. `onCancel`: `status='canceled'`, `updateTaskStatusesToCancelled()`, abort `AbortController`, emit `workflowExecuteAfter` with full run data (WEX:1414-1436, 2641-2651).
- `establishExecutionContext` then `workflowExecuteBefore` hook (or `workflowExecuteResume` when `restartExecutionId` set). Hook failure records an error run for the stack-top node and aborts (WEX:1438-1484).

### 4.1 Per-iteration (labeled `executionLoop`, `while (nodeExecutionStack.length !== 0)`, WEX:1486-1488)

**a. Timeout / cancel** — `executionTimeoutTimestamp` reached → `status='canceled'`, `timedOut=true`; `status==='canceled'` → `return` (silent; finalization in `.then`) (WEX:1489-1498).

**b. Pop** — `nodeSuccessData=null; executionError=undefined; executionData = nodeExecutionStack.shift()` (FRONT) (WEX:1500-1504).

**c. `taskStartedData`** — `{ startTime: Date.now(), executionIndex: additionalData.currentNodeExecutionIndex++, source: executionData.source?.main ?? [], hints: [] }` (WEX:1506-1512).

**d. pairedItem pre-assignment** — for every input item, rewrite `pairedItem = { item: itemIndex, input: inputIndex || undefined }` (keeping `sourceOverwrite` for AI-tool items). This is *before* the node runs, so nodes see clean input (WEX:1514-1552).

**e. `runIndex`** — `executionData.runIndex` if set, else `runData[node].length` (how many times it already ran), else 0 (WEX:1554-1560).

**f. Endless-loop guard** — `currentExecutionTry = name:runIndex`; equal to the previous iteration's try → `ApplicationError('Stopped execution because it seems to be in an endless loops')` [sic] (WEX:1562-1568).

**g. `runNodeFilter`** — if filter set and node not in it → `continue` (parallel leaves of a partial execution are skipped) (WEX:1570-1580).

**h. `ensureInputData`** (WEX:2315-2370) — for each input connection: `getHighestNode` returns no active incoming node (all disabled) → run anyway with whatever data; `executionData.data` lacks `main` → **push BACK to stack, defer** (`return false` → `continue executionLoop`); legacy order (`v0`) additionally defers when `main[connectionIndex] === null` (multi-input join not complete) (WEX:1582-1587).

**i. `nodeExecuteBefore` hook** — skipped when `executionData.metadata?.nodeWasResumed` (AI-1414: avoid double spinner) (WEX:1590-1614).

**j. Retry policy** — `maxTries = retryOnFail ? clamp(maxTries ?? 3, 2, 5) : 1`; `waitBetweenTries = retryOnFail ? clamp(waitBetweenTries ?? 1000, 0, 5000) : 0` ms (WEX:1615-1631).

**k. Try-loop** (`for tryIndex < maxTries`, WEX:1633-1797):
   - **pinData**: if pinned and node not disabled → `nodeSuccessData = [pinData[node]]` (runIndex always 0), node code never runs (WEX:1640-1646).
   - **`runNode()` dispatch** (WEX:1186-1284):
     | node state | behavior |
     | :--- | :--- |
     | `disabled` | `handleDisabledNode`: pass through `inputData.main[0]` as output (`{data: [main[0]]}`; `undefined` if input null/absent) (WEX:911-921, 1194-1196) |
     | `execute` / customOperation | `executeNode`: builds `ExecuteContext`, calls `nodeType.execute(context)`; runs close-functions via `Promise.allSettled`, rethrows first rejection (WEX:1004-1077) |
     | `poll` | manual mode → run `poll()`; other modes → pass input through (WEX:1078-1097) |
     | `trigger` | manual mode → `TriggersAndPollers.runTrigger` (+ `manualTriggerFunction`, close on abort); other modes → pass through (WEX:1098-1150) |
     | `webhook` (non-declarative) | pass input through — the WebhookService already produced the data (WEX:1261-1267) |
     | declarative (`requestDefaults`) | `executeDeclarativeNodeInTest` via `RoutingNode` (WEX:1151-1185) |
     - Before dispatch: `prepareConnectionInputData` → **`connectionInputData = inputData.main[0]`**; returns `null` (→ node returns `{data: undefined}`, i.e. no-op) when main is missing or empty; **legacy v0** uses the *first non-empty* input instead; poll/trigger/webhook get `[]` (WEX:922-955, 1216-1223). `rethrowLastNodeError` re-raises a previous failure of the same node (WEX:966-989). `handleExecuteOnce` slices every input to its first item when `node.executeOnce` (WEX:990-1003).
   - **soft-failure retry**: if `runNodeData.data[0][0].json.error !== undefined` and tries remain → `sleep(waitBetweenTries)` and re-run (nodes may return errors as data) (WEX:1685-1703).
   - **engine request** (`isEngineRequest`, AI tool-calls): `handleEngineRequest` schedules the requested sub-nodes via `addNodeToBeExecuted`, **re-queues the requesting node itself** with `metadata.subNodeExecutionData`, `continue executionLoop` (WEX:1705-1719, 1357-1402).
   - success: `convertBinaryData` → `nodeSuccessData = runNodeData.data`; hints merged; `onError==='continueErrorOutput'` → `handleNodeErrorOutput` splits error items onto the last (error) output (WEX:1721-1740, 2463-2580); `closeFunction` captured for teardown (WEX:1742-1746).
   - **`assignPairedItems`** (WEX:2581-2640, TASK-PIPE-04): fills missing `pairedItem` when inferrable — 1 input item & 1 output → `{item:0}`; same item count → `{item:index}`; N inputs aggregated to 1 output → `{item:0}`; otherwise gives up (leaves undefined).
   - `lastNodeExecuted` set when output non-null (WEX:1735-1741).
   - **`alwaysOutputData`**: empty first output → synthesize `{json:{}}` with pairedItem from all inputs (WEX:1743-1769).
   - **branch death**: `nodeSuccessData === null && !waitTill` → `continue executionLoop` (downstream never enqueued) (WEX:1771-1776). `break` on success (WEX:1777).
   - **catch**: record error for Sentry when unwrapped; `executionError = {...e, message, stack}`; loop continues to k' (WEX:1778-1797).

**l. Record run data** — ensure `runData[node]` array exists; `taskData = { ...taskStartedData, executionTime, metadata, executionStatus: waitTill ? 'waiting' : 'success' }` (WEX:1800-1811).

**m. Error path** (WEX:1813-1901):
   - `taskData.error = executionError; executionStatus='error'`; `sendChunk` hook emits the error (streaming response).
   - `continueOnFail === true || onError ∈ {continueRegularOutput, continueErrorOutput}` → **pass the node's input through as output** (`nodeSuccessData = [inputData.main[0]]` when non-null) and continue the workflow (WEX:1843-1856).
   - else (hard fail): merge `taskData` into `runData[node][runIndex]` (entry may pre-exist from engine-request `inputOverride`), **`unshift` the node back onto the stack** so a restart resumes there, `nodeExecuteAfter`, `break` (WEX:1858-1877).
   - `$error`/`$json` merge: items carrying `{ $error, $json }` get `error = $error; json = {error: $error.message}` (WEX:1899-1913).

**n. Success recording** — `taskData.data = { main: nodeSuccessData }` (`rewireOutputLogTo` may move the log to another connection type, WEX:1915-1932); push/merge into `runData[node][runIndex]` (WEX:1934-1947).

**o. waitTill** — node set `waitTill`: `nodeExecuteAfter`, **`unshift` node back to stack** (resume point), `break` (WEX:1949-1961).

**p. destinationNode reached** — `nodeExecuteAfter` then `continue` — nothing downstream is enqueued (partial execution) (WEX:1963-1973).

**q. Output routing** (WEX:1975-2057, TASK-PIPE-02/03) — if the node has `main` output connections:
   - For every `outputIndex` → every `connectionData`: destination node must exist (`ApplicationError('Destination node not found')`).
   - **Enqueue only if** `nodeSuccessData[outputIndex]` is non-null/non-empty, **or** (`connectionData.index > 0` && legacy v0) — v0 forces second inputs to receive data even when the branch is empty.
   - **v1**: collect `nodesToAdd` then sort **top-left first** (`position[1]` desc, then `position[0]` desc) and enqueue in that order (WEX:2011-2041).
   - **v0/v1-else**: enqueue immediately in connection order via `addNodeToBeExecuted` (WEX:1997-2008).
   - Non-`main` connection types are **not** routed here (sub-node wiring is owned by the Connection LEGO; the loop only handles `main`).

**r. `nodeExecuteAfter` hook** — always awaited after routing (WEX:2061-2067).

### 4.2 Waiting-nodes drain (WEX:2069-2245)

Runs at the bottom of **every** iteration when the stack is empty but `waitingExecution` is not:
1. For each waiting node (insertion order): skip if `requiredInputs` demands all inputs (v1 only; may be an expression resolved via `getSimpleParameterValue`) and not all inputs have data.
2. Skip if any parent is itself waiting (`parentIsWaiting`) — order by dependency.
3. Take the **earliest outstanding run index** (`Object.keys(...).sort()[0]`).
4. `inputsWithData` = input indexes whose slot ≠ `null` (an **empty array still counts as delivered** — parent ran but emitted nothing).
5. `requiredInputs` as array → every listed index must be in `inputsWithData`; as number → `inputsWithData.length >= requiredInputs`; else skip.
6. Materialize inputs: `null → []`; pad to `nodeType.description.inputs.length` with `[]`.
7. If **any** input has ≥1 item → push `{node, data:{main}, source: waitingExecutionSource[node][runIndex]}` to the stack (BACK) and stop scanning; else drop this waiting entry and **rescan from the start** (`i = -1`).
8. Consumed entries are deleted (node key removed when no run indexes remain).

**Note:** the drain only ever pushes when data exists, so a multi-input node whose every branch died (all-empty arrays) never executes — matching n8n's "no data → no run" semantics.

### 4.3 Finalization
- Normal exit → `.then` → `processSuccessExecution(startedAt, workflow, executionError | cancel-error, closeFunction)` (WEX:2249-2262).
- `processSuccessExecution` (WEX:2371-2451): status = `error` (or `canceled` when message/name mentions cancel) | `waiting` (waitTill set) | `success`; collects changed `staticData`; `moveNodeMetadata()`; awaits `closeFunction` (trigger teardown); `getFullRunData` (`{data, mode, startedAt, stoppedAt, storedAt, status}`); sets `resultData.error` / `waitTill` / `finished=true`; `workflowExecuteAfter` hook (skipped when already cancelled).
- Thrown error → `.catch`: fullRunData gets `resultData.error`, `moveNodeMetadata`, `workflowExecuteAfter`, close, return (WEX:2263-2311).

## 5. `addNodeToBeExecuted` — enqueue & join rules (WEX:406-825)

Signature: `(workflow, connectionData, outputIndex, parentNodeName, nodeSuccessData, runIndex, newRunIndex?, metadata?)`.

- **Enqueue position**: `enqueueFn = settings.executionOrder === 'v1' ? 'unshift' : 'push'` — **v1 is LIFO (depth-first)**, **v0 is FIFO (breadth-first)** (WEX:417).
- **Multi-input destination** (`connectionsByDestinationNode[dest].main.length > 1`, WEX:422-746):
  1. Lazily create `waitingExecution[dest]` / `waitingExecutionSource[dest]`.
  2. Find an existing waiting run-entry whose `main[connectionData.index]` is still unfilled (`createNewWaitingEntry=false`), else `waitingNodeIndex = number of existing entries` and `prepareWaitingToExecution(dest, inputCount, idx)` seeds `{main: [null × inputCount]}` (WEX:387-404).
  3. Store `nodeSuccessData[outputIndex]` (or `null`) into the slot + source `{previousNode, previousNodeOutput, previousNodeRun}`.
  4. **All slots filled → enqueue immediately** (position per `enqueueFn`) with the joined data and delete the waiting entry.
  5. Data still missing → `stillDataMissing=true`; **legacy v0 only**: walk unexecuted ancestor chains and enqueue the deepest runnable ancestor with an empty item `{json:{}}` when its input would be empty (`incomingConnectionIsEmpty`, WEX:359-374) — the "force execute everything above" behavior that v1 dropped.
- **Single-input destination** (WEX:748-825): build `connectionDataArray` (pre-filled with `null`s up to `connectionData.index`), store the items, then either park it in `waitingExecution` (if `stillDataMissing`) or push `{node, data:{main}, source, runIndex: newRunIndex, metadata}` to the stack.

## 6. Ordering semantics — the v0/v1 fork (TASK-PIPE-03 scope)

| Aspect | v0 (legacy, default when unset) | v1 (`settings.executionOrder='v1'`) |
| :--- | :--- | :--- |
| Enqueue | `push` (FIFO, breadth-first) | `unshift` (LIFO, depth-first) |
| Sibling order | connection declaration order | sorted top-left first (y desc, then x desc) |
| Multi-input data | first non-empty input used; second inputs forced even when branch empty (`connectionData.index>0`); unexecuted ancestors force-run | strictly `main[0]`; missing input → node waits |
| `requiredInputs` | ignored in drain | honored (count or index array, expression-resolvable) |
| `ensureInputData` join check | defers on `main[i]===null` | defers only when `data.main` absent |

## 7. Testable invariants (acceptance checklist for the native reconstruction)

1. Stack discipline: pop `shift()`; defer → `push` (back); error-resume & wait-resume → `unshift` (front); v1 enqueue → `unshift`, v0 → `push`.
2. A node runs **at most once per (name, runIndex)** — the endless-loop guard fires on an immediate repeat of `name:runIndex`.
3. Empty output (`null`/`undefined`) kills the branch: downstream nodes are never enqueued, unless `connectionData.index>0` in v0 or `alwaysOutputData` synthesizes `{json:{}}`.
4. Multi-input nodes execute only when every required input slot is non-`null` (join), or when the drain proves `requiredInputs` satisfied; empty arrays count as "delivered, no items".
5. `pinData` short-circuits execution and always records runIndex 0.
6. `onError/continueOnFail` failure passes the node's **input** to downstream, records `executionStatus:'error'`.
7. Hard failure records the error in `runData`, re-queues the failed node at the stack front, and stops the loop (`.break` → finalization with `status='error'`).
8. `waitTill` → `status:'waiting'`, waiter node re-queued and disabled on resume, its last recorded run popped.
9. `destinationNode` execution stops the loop after recording that node's run (inclusive mode runs the destination).
10. `runNodeFilter` prunes non-ancestor leaves during partial executions.
11. pairedItem pre-assignment rewrites input items to `{item, input}` before node execution; `assignPairedItems` post-fills missing pairs only in the three inferable shapes.
12. Disabled nodes pass `main[0]` through untouched; disabled input chains are skipped by `getHighestNode` (node still runs with no data).
13. `executeOnce` truncates every input to its first item before the node sees it.
14. Only `main` connections are routed by the loop; non-main types never appear on the stack from this code path.
15. Hooks fire in order `workflowExecuteBefore` → per node (`nodeExecuteBefore` … `nodeExecuteAfter`) → `workflowExecuteAfter`; `sendChunk` fires on node error; `nodeExecuteBefore` skipped for resumed agent nodes.

## 8. Pipeline mapping

| Spec section | Feeds task |
| :--- | :--- |
| §3 seeding, §4.1h | TASK-PIPE-01 Topological DAG Resolution & Execution Stack Initialization |
| §4.1 main loop, §5 enqueue | **TASK-PIPE-02 Node Execution Loop (Stack Pop, Run, Output Routing)** |
| §4.2 drain, §6 ordering fork, §5 multi-input join | TASK-PIPE-03 Multi-Branch & Sparse Output Routing Determinism |
| §4.1d pairedItem pre-assign, `assignPairedItems` | TASK-PIPE-04 Item Pairing Engine |
| §4.1g/p filter + destinationNode, §3 partial | TASK-PIPE-05 Destination Node & Partial Execution Slicing |

## 9. Open notes / risks

- **`waitingExecution` run-index keying**: `prepareWaitingToExecution` writes `nodeWaiting[runIndex]` where `runIndex` is actually the *waiting entry index*, not a node run index — reconstructors must preserve this quirk (array-indexed object keys), not "fix" it.
- v0 ancestor force-execution (WEX:593-745) is the most intricate part of `addNodeToBeExecuted`; it only runs when `isLegacyExecutionOrder` — keep it isolated behind the same guard in the reconstruction.
- The soft-failure retry (json.error) and the try/catch retry (`retryOnFail`) are two **different** retry mechanisms that can both apply; order: try/catch loop wraps everything, soft-failure loop is inside.
- `updateTaskStatusesToCancelled` marks in-flight `executionStatus:'canceled'` for tasks without terminal status (WEX:2641-2651).
- `currentNodeExecutionIndex` comes from `additionalData` and must be shared across sub-executions to keep `executionIndex` globally monotonic.
