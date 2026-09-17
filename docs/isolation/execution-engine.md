# Anatomy: the execution engine as the *producer* of execution scoping

**Task:** `TASK-403-execution-engine-spec` (taken over under the non-blocking protocol §4 *work-stealing* — see
[`results/TASK-403-execution-engine-spec.md`](../../results/TASK-403-execution-engine-spec.md))
**Worker:** Agent 6 · **Branch:** `agent-6`
**Reference read from:** n8n `2.9.1` (`packages/core` + `packages/workflow` as vendored in `reference/n8n`)
**Primary source:** `packages/core/src/execution-engine/workflow-execute.ts` (2655 L) plus
`node-execution-context/{base-execute-context,node-execution-context,execute-context}.ts`,
`routing-node.ts`, `../utils/{get-additional-keys,execution-metadata,resolve-source-overwrite}.ts`,
`packages/workflow/src/workflow.ts:817-890` (`getStartNode`).
**Machine evidence:** 13 probe groups / 4601 recorded values / 10 recorded typed throws from **real `WorkflowExecute` runs**
— [`docs/isolation/agent-6-probes/engine-observations.json`](agent-6-probes/engine-observations.json)
(sha256 `0016e713b34240dda1efc8eaa2abec442b2fcc7376497a24056519f380f020fb`), produced by
[`engine-probes.cjs`](agent-6-probes/engine-probes.cjs); replay determinism **MATCH** via
[`agent-6-probes/engine-determinism-check.cjs`](agent-6-probes/engine-determinism-check.cjs).
**Contract:** [`contracts/execution-engine.contract.md`](../../contracts/execution-engine.contract.md)
**Consumers of this slice:** [`variable-lookup-scoping.md`](variable-lookup-scoping.md) (the *consumer* side of the same
tuple) and [`expression-syntax-pipeline.md`](expression-syntax-pipeline.md) (the `=…{{ }}` pipeline that is invoked once
per node parameter).

---

## 0. Why this file exists in the Expression slice

`TASK-PIPE-13` documents what `WorkflowDataProxy` **reads**. It reads nothing of its own: every coordinate it resolves —
`runIndex`, `itemIndex`, `connectionInputData`, `runData[activeNode][runIndex].source`, `$parameter`, `$prevNode` — is
handed to it by `WorkflowExecute`. Those coordinates are the *output* of the engine and the *input* of the lookup, so the
producer must be specified where the consumer is. Each rule below is pinned by a probe group (`403A`…`403K`) rather than
by prose.

Boundary: the engine is **not** owned by the Expression LEGO. This document isolates the interface, and §9 states
exactly which fields cross into the data-proxy and how.

---

## 1. `E1` — Entry point and its shape

| Fact | Source | Evidence |
| :--- | :--- | :--- |
| Public surface used by everything else: `run({workflow, startNode, destinationNode, pinData, triggerToStartFrom, additionalRunFilterNodes})` | `workflow-execute.ts:123` | `403D`, `403E` |
| `run()` is deliberately **not** `async` — it returns `PCancelable<IRun>`; adding `async` would break cancellation | `workflow-execute.ts:120-122` (in-code comment), `processRunExecutionData` `:1400-1403` | `403E_cancel.hasCancelMethod === true` |
| Constructor: `(additionalData, mode, runExecutionData = createRunExecutionData(), storedAt = 'db')`; sets `status = 'new'` and owns an `AbortController` | `workflow-execute.ts:105-121` | `403A` (context `fields.abortSignal`, `runExecutionData`) |
| Missing start node is a **synchronous throw**, not a rejected promise: `ApplicationError('No node to start the workflow from could be found')` | `:136-138` | `403D_scheduling.missing_startNode_two_action_nodes` |
| Start node resolution is delegated to `Workflow.getStartNode`: single-node graphs short-circuit to that node; otherwise first non-disabled trigger/poll type; otherwise the first node whose type ∈ `STARTING_NODE_TYPES` | `workflow.ts:817-857` | `403D.missing_startNode_with_only_action_node` (1 node ⇒ runs) vs `missing_startNode_two_action_nodes` (⇒ throws) |
| `destinationNode` narrows execution to a `runNodeFilter` = parents over `main` + parents over `ALL_NON_MAIN`, plus the destination itself when `mode === 'inclusive'`, de-duplicated | `:141-155` | `403D_scheduling.destination_inclusive` (`runNodeFilter: ['Start','A']`, `runDataKeys: ['Start','A']`) and `.destination_exclusive` (filter stops at the parents) |
| The filter is enforced by **skipping popped nodes**, not by pruning the graph | `:1572-1580` | `403D.destination_exclusive`: sibling leaves parallel to the destination never appear in `runData` |
| The stack is seeded with exactly one entry: `{node: startNode, data: triggerToStartFrom?.data?.data ?? {main: [[{json:{}}]]}, source: null}` | `:157-172` | `403C.linear_success.perNode.Start.tasks[0].source === []` (a `null` source becomes `[]` when the task is written) |
| `pinData` is stored on `resultData` **without any mode check**, so it overrides node output in every mode that reaches this code path | `:173-186`, `:1632-1637` | `403C.pinned_middle_manual` **and** `.pinned_middle_cli` — both replace the throwing node's output with `[{pinned:true}]` |
| `settings.executionOrder !== 'v1'` ⇒ "legacy order" | `:189-191` | `403C.legacy_order_v0_*`, `403J` |

---

## 2. `E2` — The per-node cycle, in the order the engine performs it

Observed by instrumenting a node type so that `execute()` snapshots the context it was handed (`403A`), and by diffing
`runData` across 24 graphs (`403C`).

1. `executionLoop: while (stack.length)`; timeout flag checked first, `status === 'canceled'` returns
   (`:1483-1497`).
2. `executionData = stack.shift()` — the stack is LIFO/FIFO depending on who enqueued (`:1502-1504`).
3. `taskStartedData = {startTime, executionIndex: additionalData.currentNodeExecutionIndex++, source: executionData.source ? executionData.source.main : [], hints: []}`
   (`:1506-1512`). The engine writes **no `runIndex` field** into a task; the run index is the array position in
   `runData[nodeName]` — see `E5`.
4. **Input items are rewritten**: for every connection type and every branch, each input item is replaced by
   `{...item, pairedItem: {item: itemIndex, input: inputIndex || undefined, sourceOverwrite?}}`, preserving a tool
   `sourceOverwrite` through `resolveSourceOverwrite` (`:1514-1556`). This is the mechanism that makes the
   `$('X').item` / `$getPairedItem` lookups in `TASK-PIPE-13` resolve positionally, and the reason
   `pairedItem.input` is `undefined` (not `0`) for branch 0.
5. `runIndex = executionData.runIndex ?? runData[node].length ?? 0` (`:1556-1565`).
6. Endless-loop guard: `currentExecutionTry = `${node}:${runIndex}``; if it equals `lastExecutionTry` →
   `ApplicationError('Stopped execution because it seems to be in an endless loop')` (`:1567-1571`). `lastExecutionTry`
   is only ever assigned on the *skip* path (`:1582`), i.e. the guard protects the re-queue loop, not normal repeats.
7. `runNodeFilter` skip (`:1572-1580`) → `ensureInputData` (`:1580`, def `:2315`) → if false, the entry is **pushed back
   on the stack** and the iteration restarts with no `runData` entry at all.
8. `nodeExecuteBefore` hook, skipped when `executionData.metadata.nodeWasResumed` (`:1588-1599`).
9. `retryOnFail` clamps: `maxTries = Math.min(5, Math.max(2, node.maxTries || 3))`,
   `waitBetweenTries = Math.min(5000, Math.max(0, node.waitBetweenTries || 1000))` (`:1600-1615`).
10. `runNode(...)` inside the `try` (`:1659`); a **second** attempt is triggered when the returned data itself contains
    `data[0][0].json.error !== undefined` (`:1672`, `:1689`) — a soft-failure heuristic, not an exception.
11. `pinData` override of `nodeSuccessData` (`:1632-1637`), bypassed when the node is `disabled`.
12. `onError === 'continueErrorOutput'` → `handleNodeErrorOutput` mutates the output branches (`:1719-1721`, `E7`).
13. `assignPairedItems` autofix (`:1736`, def `:2581`) → `lastNodeExecuted` only when the result is truthy (`:1738-1740`).
14. Empty output + `alwaysOutputData` → a synthesised `[{json:{}, pairedItem:[…all inputs…]}]` (`:1741-1765`).
15. `nodeSuccessData === null && !waitTill` → `continue executionLoop` **before** any `taskData` is written (`:1769-1775`).
16. `catch` → `lastNodeExecuted` is set to the failing node, `executionError = {...e, message, stack}` (`:1776-1801`).
17. `taskData = {...taskStartedData, executionTime, metadata: executionData.metadata, executionStatus: waitTill ? 'waiting' : 'success'}`;
    error branch sets `executionStatus: 'error'` and attaches `error` (`:1817-1827`).
18. `continueOnFail === true` **or** `onError ∈ {continueRegularOutput, continueErrorOutput}` → the node's **input**
    `main[0]` is passed through as its output; otherwise the stack entry is un-shifted back for resumption and the loop
    breaks (`:1841-1893`).
19. Legacy soft-error unwrap: an item carrying both `json.$error` and `json.$json` is rewritten to
    `{error: <message>}`; a bare `item.error` becomes `json = {error: message}` (`:1901-1915`).
20. `taskData.data = {main: nodeSuccessData}` (or `{[rewireOutputLogTo]: …}`), then pushed to
    `runData[nodeName]` — **merged** with `Object.assign` if an entry already exists at that index (`:1918-1948`).
21. Children are scheduled (`E4`), then `nodeExecuteAfter` fires unless a destination stop already fired it (`:2077`).

---

## 3. `E3` — The context object the engine builds (this is the Expression boundary)

`executeNode()` constructs exactly one **`ExecuteContext`** per node *run* (`:1020-1040`), with `closeFunctions = []`
owned by the engine and returned to the caller as `{data, hints: context.hints}` (`:1072`). `ExecuteSingleContext` is
**not** reachable from `WorkflowExecute` — it is created only inside `routing-node.ts:93` for a node's sub-executions, so
per-item parameter defaults belong to the routing layer, not the engine.

Measured instance state (`403A_context_surface.context.fields`, class `ExecuteContext`):
`abortSignal`, `additionalData`, `closeFunctions`, `connectionInputData` (length = items of this run's main input),
`executeData` (`{data, metadata, node, runIndex, source}`), `getNodeParameter` (a *bound property*, not a prototype
method), `helpers`, `hints`, `inputData`, `instanceSettings`, `mode`, `node`, `nodeHelpers`, `runExecutionData`,
`runIndex`, `subNodeExecutionResults`, `workflow`. There is **no `itemIndex`** — `ExecuteContext` is index-based, so
`getNodeParameter(name, itemIndex)` takes the index explicitly (contrast `403B.identities`).

Public surface actually used by expression scoping, all observed live:
`getMode()`, `getExecutionId()`, `getExecutionContext()`, `getWorkflow()`, `getNode()`, `getWorkflowDataProxy(itemIndex)`,
`getInputData(i)`, `getInputSourceData()`, `getExecuteData()`, `continueOnFail()`, `isToolExecution()`,
`addExecutionHints()`, `setMetadata()`, `getExecutionCancelSignal()`, `onExecutionCancellation()`, `nodeInputs`,
`nodeOutputs`, `getParentNodes()`, `getChildNodes()`, `getConnectedNodes()`, `getTimezone()`, `getWorkflowSettings()`,
`getInstanceId/BaseUrl/RestApiUrl`, `getRunnerStatus()`, `addInputData()`, `addOutputData()`
(`base-execute-context.ts:53-269`, `node-execution-context.ts:71-281`, `execute-context.ts:49-248`).

**The hand-off to the lookup slice is a single field**: `additionalKeys`, produced by
`getAdditionalKeys(additionalData, mode, runExecutionData)` (`utils/get-additional-keys.ts`). Observed key set from inside
a real node: `$execution, $executionId, $resumeWebhookUrl, $secrets, $vars` (`403A.additionalKeysKeys`) — identical to
the `PIPE-13` prediction. `getWorkflowDataProxy(0).`*own keys* from the same context = 43 entries
(`$json … $workflow, DateTime, Duration, Interval`) (`403A.proxyOwnKeys`).

---

## 4. `E4` — Scheduling rules (what makes a node run at all)

| Rule | Source | Evidence |
| :--- | :--- | :--- |
| A child is enqueued only if the parent's branch at that output index **is an array and is non-empty**, or the connection targets input `index > 0` **and** the workflow is legacy-ordered | `:2013-2018` | `403C.empty_branch_output` (child `After` absent from `runData`) vs `403C.alwaysOutputData_on_empty` (1 synthesised item ⇒ child runs) and `403C.empty_branch_v0` (still skipped, because the connection targets input 0) |
| v1 enqueues with `unshift`, legacy `v0` with `push` | `:417`, `:530`, `:808` | `403J_sibling_order`: v1 executes `Near → Far → Bottom`, v0 executes the declared order `Far → Near → Bottom` |
| In v1 the batch is first sorted by canvas position — larger `y` first, then larger `x` first — so after `unshift` the **top-left-most** sibling runs first | `:2041-2054` | `403J` (positions `(100,100) < (300,300) < (50,500)` ⇒ observed order `Near, Far, Bottom`) |
| A node with more than one main input waits in `waitingExecution[node][waitingNodeIndex]`, one slot per input; when every slot is non-`null` the entry is moved to the stack and both waiting maps delete that index | `:420-570` | `403C.multi_input_merge_waits`: `Merge` executed once with `source: [{prev:'L'},{prev:'R'}]` and `data.main: [1]` |
| A parent whose output branch is empty still writes `null`/`[]` into the waiting slot when it is the *null* path, and `null` propagates as "no data" (that is how a disabled upstream is felt downstream) | `:485-495` | `403C.disabled_node_passes_input_through` (disabled node keeps its `source` link and hands `main[0]` through verbatim) |
| `connectionInputData` = `main[0]`, or the first non-empty branch in legacy order; `null` slot ⇒ `{data: undefined}`; trigger/poll/webhook nodes get `[]` | `:922-964` | `403A.context.fields.connectionInputData.length === 3` for a 3-item input |
| `runIndex` of a child equals the parent's `runIndex` unless the parent supplies `newRunIndex`; the run index is the position in `runData[nodeName]` | `:512`, `:1556-1565`, `:1918-1948` | `403I_runIndex_and_proxy_per_activation`: node `C` has `runs: 2`, `runIndexField` 0 then 1, and the proxy reports `$runIndex: 0` with `$prevNode: {name:'B'}` then `$runIndex: 1` with `$prevNode: {name:'A'}` |
| `source` written for a child = `[{previousNode, previousNodeOutput, previousNodeRun}]` (input index → branch index) | `:496-503`, `:812-820` | `403C.fan_out_runIndex_per_branch`: `Right.source = [{prev:'Split', out:1, run:0}]` |
| `executeOnce` does **not** change the context class; it slices every input branch to its first item | `:990-1002` | `403C.executeOnce_slices_inputs` (`count: 1` from 4 items) vs `.no_executeOnce_sees_all` (`count: 4`); `403F.classes` all `ExecuteContext` |

---

## 5. `E5` — What the engine writes, and only the engine writes

`resultData` keys observed on every run: `error, lastNodeExecuted, metadata, pinData, runData` (`403C.*.resultDataKeys`);
`IRunExecutionData` top-level keys: `executionData, manualData, parentExecution, pushRef, resultData, startData,
validateSignature, version, waitTill`.

Per task (`ITaskData`) the engine owns: `startTime`, `executionIndex` (monotone per **engine instance**, taken from
`additionalData.currentNodeExecutionIndex`, `403D.executionIndex_sequence` + `…after_run === 4` for a 4-node run),
`executionTime`, `source`, `hints`, `metadata`, `inputOverride`, `data`, `executionStatus`, `error`,
`executionStatus ∈ {success, error, waiting}` (`:1817-1827`), plus `lastNodeExecuted` (only when the node produced truthy
data, `:1738-1740`).

Node-side writers are limited: `setMetadata()` lands in `executionData.metadata` → surfaced as `taskData.metadata`
(`403C.setMetadata_lands_in_task` → `['customKey','subExecutionRef']`), and `addExecutionHints()` accumulates into
`context.hints` → copied into `taskStartedData.hints` (`:1715-1717`, `403C.hints_landed_on_task`). `setMetadata` is the
same store that `$execution.customData` writes in the lookup slice (`PIPE-13 §12`).

**A node returning `null` leaves no trace at all**: no task, no `lastNodeExecuted` change —
`403C.returns_null_ends_branch` reports `runDataKeys: ['Start']`.

---

## 6. `E6` — Error taxonomy and what survives serialisation

| Rule | Source | Evidence |
| :--- | :--- | :--- |
| The per-task error is a **plain-object snapshot** `executionError = {...e, message, stack}`; it is *not* an `Error` instance | `:1800-1801`, `:1453-1458` | `403C.throw_stops_workflow`: `error.keys === ['message','stack']`, `isErrorInstance: false`, `name` falls back to `Object` |
| Own enumerable props of n8n error classes therefore do survive (`name`, `description`, `context`, `extra`, `type`, `level`, `node`, `tags`, `timestamp`, `lineNumber`, `messages`, `functionality`, `errorResponse`), but `cause` arrives as an own key holding `undefined` | `:1800` + `ExecutionBaseError` | `403C.node_op_error_recorded_in_task`: 16 keys, `hasCause: false`, `name: 'NodeOperationError'` |
| `context` is **overwritten** by the error base class with `{itemIndex, runIndex, metadata}`; a caller-supplied `context.parameter` is not preserved in the run data | `ExecutionBaseError` ctor | same record: `contextKeys: ['itemIndex','metadata','runIndex']` while `parameter` was passed — matches the `PIPE-12`/`PIPE-13` observation that `context.parameter` is attached by `getParameterValue`, not by the task record |
| `resultData.error` gets the same snapshot treatment | `:2264`, `:2430` | `403C.throw_stops_workflow.resultError.isErrorInstance === false` |
| `continueOnFail` (or `onError ∈ {continueRegularOutput, continueErrorOutput}`) turns a failure into "task `executionStatus: 'error'` **plus** input passthrough", so the workflow still finishes `success` | `:1841-1855` | `403C.throw_continueOnFail_passthrough` (`status: 'success'`, `Boom.data.main: [2]` = the 2 input items, `After` executed) |
| Without that flag: the entry is un-shifted back onto the stack, `nodeExecuteAfter` runs only if not aborted, and the loop breaks ⇒ `runData` has the error task and nothing after it | `:1856-1893` | `403C.throw_stops_workflow` |
| Retry is invisible in `runData`: `maxTries` attempts produce **one** task | `:1600-1690` | `403C.retryOnFail_recovers`: node attempted twice (`recoveredAfterAttempts: 2`), `runs: 1` |
| Soft failure `json.error` alone is *not* treated as an error unless retries are on; only `json.$error` + `json.$json` is unwrapped | `:1901-1915`, `:1672` | `403C.error_in_json_soft_failure` (`status: 'success'`, item passed through unchanged) |
| Endless-loop guard message is a plain `ApplicationError` thrown from the loop, so it aborts the whole execution rather than one node | `:1565-1571` | code path only (not reproducible without a re-queue loop; recorded as an explicit gap in the contract `X-4`) |

---

## 7. `E7` — `handleNodeErrorOutput`, and the synthetic error output

`onError: 'continueErrorOutput'` makes the engine re-shape the node's own output *before* it is stored
(`:1719-1721` → `:2463-2560`):

1. `outputs = NodeHelpers.getNodeOutputs(workflow, node, description)`; when the flag is set the list **gains a synthetic
   output** `{category: 'error', type: 'main', displayName: 'Error'}` — measured, not inferred
   (`403H.effective_outputs_of_the_two_branch_type`: `['main','main', {…}]` vs `['main','main']` without the flag).
2. `mainOutputTypes` = the `main` entries of that list ⇒ **3** here.
3. A throwaway `ExecuteContext` is built (`:2481-2495`) with `connectionInputData = []` and the *same* `runIndex`, only
   to obtain `getWorkflowDataProxy(0)` and call `dataProxy.$getPairedItem(...)` — i.e. the engine re-enters the lookup
   slice from inside the error path (`PIPE-13 §4`, `L14`).
4. For each branch `0 … mainOutputTypes.length - 2`, items are classified by
   `item.error` **or** `json.error` with exactly 1 key **or** `json.error` + `json.message` with exactly 2 keys.
   Error items are *moved* out; their json is merged with the paired input item json when `$getPairedItem` resolves.
5. `nodeSuccessData[mainOutputTypes.length - 1] = errorItems` (`:2559`) — the **last effective** branch, which with the
   synthetic output is one index beyond what the node returned.

Consequence measured in `403H.two_branch_node_onError_continueErrorOutput`: a node that already routes its failures to
its own second output ends up with `data.main = [2, 0, 2]` — branch 1 emptied, errors parked in a third, unconnected
branch — so `ErrPath` never runs. The same node **without** the flag (`403H.two_branch_node_without_onError_flag`)
delivers the errors to `ErrPath` normally. Any reimplementation that omits the synthetic output will silently move the
error branch by one index.

---

## 8. `E8` — Terminal states: waiting, cancellation, timeout, cancel-propagation

| Fact | Source | Evidence |
| :--- | :--- | :--- |
| `runNode` dispatch order: disabled ⇒ `handleDisabledNode`; then `getCustomOperation`; `execute ‖ customOperation` ⇒ `executeNode`; else `poll`; else `trigger`; else webhook-without-`requestDefaults` ⇒ passthrough `{data: inputData.main}`; else `executeDeclarativeNodeInTest` | `:1200-1268` | `403C.disabled_node_passes_input_through` (passthrough verified) |
| A node that called `putExecutionToWait` ⇒ `executionStatus: 'waiting'` (`waitTill` set), `handleWaitingState` then clears `waitTill`, disables the waiting node, and `.pop()`s the last run of `lastNodeExecuted` so it re-executes on resume | `:1821`, `:1285-1303` | code + `403C.*` shapes (`waitTill: undefined` on every non-waiting run) |
| `cancel()` sets `status = 'canceled'`, calls `updateTaskStatusesToCancelled()` (every `executionStatus: 'running'` → `'canceled'`), aborts the controller and still emits `workflowExecuteAfter` | `:1423-1431`, `:2641-2650` | `403E_cancel`: `status: 'canceled'`, `runDataKeys: []`, `resultError.name: 'ManualExecutionCancelledError'`, `finished: undefined` |
| `additionalData.executionTimeoutTimestamp` in the past ⇒ `status = 'canceled'`, `timedOut = true`, checked **once per loop iteration** | `:1486-1492` | `403E_cancel.executionTimeoutTimestamp_in_the_past`: `status: 'canceled'`, `runDataKeys: []` |
| `closeFunctions` collected per node run are executed by `executeNode`'s caller; the first `Error` thrown by one is rethrown, otherwise `ApplicationError('Error on execution node's close function(s)')` | `:1020-1072` | `403A.fields.closeFunctions` = `[]` at capture time |
| Abort signal identity: nodes receive `this.abortController.signal` (`AbortSignal`, `aborted: false` at run start) | `:1030`, `base-execute-context.ts:57` | `403A.methods.cancelSignal` |

---

## 9. `E9` — The producer→consumer interface for `$json`/`$node`/`$parameter` (formal)

Emitted per node run by `executeNode`, consumed by `WorkflowDataProxy` (labels refer to the lookup contract):

| Engine field / call | Value in `403A`/`403I` | Lookup-side meaning |
| :--- | :--- | :--- |
| `runExecutionData` | object with `resultData.runData` | `A1`/`A2`: `$(node)` resolves through `runData[activeNode][runIndex].source` |
| `runIndex` | `0`, then `1` for the second activation of `C` | `$runIndex`, `I3` |
| `itemIndex` (argument of `getWorkflowDataProxy(i)`, and of `getNodeParameter(name, i)`) | `0` | `$itemIndex`, `$json`, `$binary` (`I1`/`I2`) |
| `connectionInputData` | 4 items for a 4-item input | `.item`/`$getPairedItem` input side (`L4`, `A6`) |
| `activeNodeName` ← `node.name` | `'P1'`, `'C'` | scoping root (`I4`) |
| `additionalKeys` | `$execution, $executionId, $resumeWebhookUrl, $secrets, $vars` | `I15`–`I18`; `mode`-dependent (`manual` → `$execution.mode === 'test'`, observed in `403A`) |
| `mode` | `'manual'` | `$mode` (`I5`), and the `__UNKNOWN__` fallback root: with `additionalData.executionId` absent, `getExecutionId()` → `undefined` and `$execution.id`/`$executionId` → `'__UNKNOWN__'` (`403A2`) |
| `executeData` (`{node, data, source, runIndex, metadata}`) | all 5 keys present | `throwOnMissingExecutionData` softening and `$prevNode` (`I6`, `L17`) |
| `abortSignal`, `closeFunctions`, `hints`, `subNodeExecutionResults` | present / empty | engine-owned; **not** part of the lookup interface |

---

## 10. `E10` — Divergences and hazards a reimplementation must not "clean up"

1. **`pinData` has no mode gate here** (`:1632-1637`): production callers avoid it by not passing `pinData`; anything that
   re-implements the engine and gates on `mode === 'manual'` behaves differently from n8n 2.9.1. (`403C.pinned_middle_cli`)
2. **`alwaysOutputData` synthesises one item per *node*, not per branch** — `nodeSuccessData[0] = [{json:{}, pairedItem: all inputs}]`,
   other branches untouched (`:1741-1765`, `403C.alwaysOutputData_on_empty`).
3. **`pairedItem.input` loses the literal `0`** (`inputIndex \|\| undefined`, `:1546`) while the reader compensates with
   `input \|\| 0` — the asymmetry is load-bearing for `$getPairedItem` and `handleNodeErrorOutput`.
4. **`context` on the task error record is engine-owned**, so parameter-level context set during expression evaluation
   never reaches `runData` (`E6` row 3).
5. **`nodeSuccessData === null` and `[[]]` mean different things**: the former writes no task at all, the latter writes a
   task with an empty branch and stops downstream (`E2` step 15, `E4` row 1).
6. `assignPairedItems` aborts the whole *output* scan (`break checkOutputData`, `:2631`) on the first branch whose
   cardinality cannot be justified — later branches keep whatever `pairedItem` the node gave them (`403C.pairedItem_breaks_on_cardinality_mismatch`:
   the node's 4 items stay `absent`, while the *next* node re-derives `1:1` from its own input).
7. The endless-loop guard compares only against the immediately preceding `node:runIndex` (`:1567-1571`), so it is a
   re-queue guard rather than a cycle detector.

---

## 11. Evidence and reproduction

```bash
# record (needs the prebuilt .runtime; do NOT re-run scripts/setup-reference-runtime.sh)
NODE_PATH=$PWD/.runtime/node_modules node docs/isolation/agent-6-probes/engine-probes.cjs /tmp/e1.json
NODE_PATH=$PWD/.runtime/node_modules node docs/isolation/agent-6-probes/engine-probes.cjs /tmp/e2.json
node docs/isolation/agent-6-probes/engine-determinism-check.cjs /tmp/e1.json /tmp/e2.json   # -> MATCH
sha256sum docs/isolation/agent-6-probes/engine-observations.json
```

Probe groups: `403A` context surface · `403A2` missing `executionId` · `403B` one context per run ·
`403C` 24-graph lifecycle matrix · `403D` start-node/destination/executionIndex · `403E` cancel + timeout ·
`403F` context class vs node flags · `403G` bare `checkReadyForExecution` · `403H` error-output routing ·
`403I` `runIndex` + proxy per activation · `403J` sibling order · `403K` the gate the engine itself applies.

`403G`/`403K` deliberately contrast each other: `checkReadyForExecution(wf, {})` returns `null` for a workflow with an
unknown node type (no scope ⇒ nothing checked), while the same workflow **through `run()`** throws
`WorkflowHasIssuesError`, because `checkForWorkflowIssues` injects `startNode`, `destinationNode` and
`pinDataNodeNames` (`:1305-1333`). Validation is therefore scoped and pin-exempt, not global.
