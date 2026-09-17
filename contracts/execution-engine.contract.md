# LEGO Contract: Execution Engine (`WorkflowExecute`) — producer of the execution scoping coordinates

**Task:** `TASK-403-execution-engine-spec` · **Worker:** Agent 6 (role *Expression & Scoping Specialist*), taken over from
`agent-1` under the non-blocking protocol §4 (work-stealing on `NEEDS_CORRECTION`)
**Reference:** n8n `2.9.1` — `packages/core/src/execution-engine/workflow-execute.ts` (2655 L),
`node-execution-context/{base-execute-context,node-execution-context,execute-context}.ts`, `routing-node.ts`,
`utils/{get-additional-keys,execution-metadata,resolve-source-overwrite}.ts`,
`packages/workflow/src/{workflow.ts:817-890,errors/…,node-helpers.ts}`
**Evidence:** 13 probe groups / 4601 values / 10 typed throws from real `WorkflowExecute` runs —
[`engine-observations.json`](../docs/isolation/agent-6-probes/engine-observations.json)
(sha256 `0016e713b34240dda1efc8eaa2abec442b2fcc7376497a24056519f380f020fb`), runner
[`engine-probes.cjs`](../docs/isolation/agent-6-probes/engine-probes.cjs), determinism **MATCH**
**Anatomy:** [`docs/isolation/execution-engine.md`](../docs/isolation/execution-engine.md) (`E1`–`E10`)
**Consumed by:** [`variable-lookup.contract.md`](variable-lookup.contract.md) (interface `P1`–`P6`), [`expression-syntax.contract.md`](expression-syntax.contract.md)
**Status:** `CONTRACTED` (specification only — **no Rust is written for this LEGO in Phase 2**, see `X1`)

---

## 1. Interface (normative)

```typescript
// Emitted BY the engine, consumed by the lookup slice. One instance per node RUN (not per item).
interface EngineNodeRunContext {            // produced at workflow-execute.ts:1020-1040
  workflow: Workflow;                       // graph, settings, pinData, nodeTypes, expression
  runExecutionData: IRunExecutionData;      // resultData.runData = the only store lookup can read
  mode: WorkflowExecuteMode;                // 'manual' | 'cli' | 'webhook' | 'trigger' | …
  runIndex: number;                         // position in runData[nodeName]  -> $runIndex
  node: INode;                              // activeNodeName = node.name     -> $parameter/$json root
  connectionInputData: INodeExecutionData[];// main[0] of this run            -> .item, $getPairedItem
  executeData: IExecuteData;                // {node, data, source, runIndex, metadata}
  additionalKeys: IWorkflowDataProxyAdditionalKeys;   // -> $execution, $executionId, $resumeWebhookUrl, $secrets, $vars
  abortSignal: AbortSignal;                 // engine-owned, opaque to lookup
  hints: NodeExecutionHint[];               // node -> taskData.hints sink
}

interface ExecutionEngine {                 // the whole public contract of this slice
  run(opts: {
    workflow: Workflow;
    startNode?: INode;
    destinationNode?: { nodeName: string; mode: 'inclusive' | 'exclusive' };
    pinData?: IPinData;
    triggerToStartFrom?: { name: string; data: ITaskData };
    additionalRunFilterNodes?: string[];
  }): PCancelable<IRun>;                    // MUST stay synchronous (cancel() would be lost)
  processRunExecutionData(workflow: Workflow): PCancelable<IRun>;
  checkReadyForExecution(workflow: Workflow, input: {
    startNode?: string; destinationNode?: IDestinationNode; pinDataNodeNames?: string[];
  }): IWorkflowIssues | null;
  getBackgroundExecuteData?(): …;           // not part of this slice
}
```

`IF-1` The engine's only *outputs* are (a) `IRunExecutionData` (`resultData.runData` + `resultData.error` +
`lastNodeExecuted` + `metadata` + `pinData` + `waitTill`), (b) lifecycle hook calls, (c) `executionStatus` per task ∈
`{success, error, waiting, canceled}`. `403C.*.resultDataKeys` = `[error, lastNodeExecuted, metadata, pinData, runData]`.
`IF-2` `run()` never rejects for a *node* error: node failure is data (`taskData.error`), workflow failure is
`resultData.error` (`403C.throw_stops_workflow` → `status: 'error'`, promise resolved).
`IF-3` `run()` throws **synchronously** only for `ApplicationError('No node to start the workflow from could be found')`
(`:136-138`, `403D.missing_startNode_two_action_nodes`) and `WorkflowHasIssuesError` (from
`checkForWorkflowIssues`, `403K.missing_required_parameter_blocks_run`).
`IF-4` `startNode` resolution order: explicit option → `Workflow.getStartNode(destinationNode)`, whose own order is
single-node short-circuit → first non-disabled trigger/poll type → first node with `type ∈ STARTING_NODE_TYPES`
(`workflow.ts:817-857`, `constants.ts:53`) → `undefined`.
`IF-5` Per-item parameter resolution is NOT an engine interface: the engine hands an index-based context, and
`getNodeParameter(name, itemIndex)` / `getWorkflowDataProxy(itemIndex)` take the index from the caller. `ExecuteSingleContext`
exists only inside `routing-node.ts:93` (verified unreachable from `WorkflowExecute`: `403F.classes` are all `ExecuteContext`).
`IF-6` The scoping tuple field `additionalKeys` is produced exclusively by `getAdditionalKeys(additionalData, mode, runExecutionData)`;
the engine never extends it (`403A.additionalKeysKeys` = the 5 predicted keys).

---

## 2. Obligations — behaviour a conforming implementation must reproduce

| ID | Rule | Source | Evidence |
| :--- | :--- | :--- | :--- |
| `O1` | Stack seed = `{node: startNode, data: triggerToStartFrom?.data?.data ?? {main:[[{json:{}}]]}, source: null}` | `:157-172` | `403C.no_startItems_default_empty_item` |
| `O2` | `destinationNode` ⇒ `runNodeFilter = parents(main) ∪ parents(ALL_NON_MAIN) (+self if inclusive)`, deduped; enforcement = skip-on-pop | `:141-155`, `:1572-1580` | `403D.destination_{inclusive,exclusive}` |
| `O3` | `taskStartedData.source = executionData.source ? executionData.source.main : []`; no `runIndex` key is written into a task | `:1506-1512` | `403D.startNode_source_is_null` (`source: []` although the stack entry held `null`) |
| `O4` | Every input item is rewritten with positional `pairedItem {item, input: inputIndex \|\| undefined}` before the node sees it, preserving `sourceOverwrite` | `:1514-1556` | `403C.*.pairedItem`, `PIPE-13 §4` |
| `O5` | `runIndex = executionData.runIndex ?? (runData[node] ? runData[node].length : 0)` | `:1556-1565` | `403I` (`C` runs 0 then 1, `$prevNode` flips `B`→`A`) |
| `O6` | A child is scheduled only when the parent's branch is a non-empty array, or (`connectionData.index > 0 && legacy order`) | `:2013-2018` | `403C.empty_branch_output`, `.empty_branch_v0`, `.alwaysOutputData_on_empty` |
| `O7` | v1: `nodesToAdd` sorted by canvas position (y desc, then x desc) and enqueued with `unshift`; legacy: no sort, `push` | `:417`, `:2041-2054` | `403J_sibling_order` |
| `O8` | Multi-main-input nodes buffer in `waitingExecution[node][idx]` per input slot and are enqueued only when no slot is `null` | `:420-570` | `403C.multi_input_merge_waits` (`source` has one entry per input) |
| `O9` | `executeOnce === true` ⇒ every input branch `.slice(0,1)`; context class unchanged | `:990-1002` | `403C.executeOnce_slices_inputs` vs `.no_executeOnce_sees_all`; `403F` |
| `O10` | Disabled node ⇒ `handleDisabledNode` passes `main[0]` through and records a normal `success` task whose `source` names the disabled node | `:911-921`, `:1200` | `403C.disabled_node_passes_input_through` |
| `O11` | `connectionInputData` = first non-empty branch (legacy) else `main[0]`; empty ⇒ `{data: undefined}`; trigger/poll/webhook ⇒ `[]` | `:922-964` | `403A.fields.connectionInputData` |
| `O12` | `pinData[node]` replaces the node's output as `[nodePinData]` (single branch, always run 0) unless the node is disabled — **no mode test** | `:1632-1637` | `403C.pinned_middle_{manual,cli}`, `.pinned_disabled_node_ignored` |
| `O13` | `retryOnFail` clamps to `maxTries ∈ [2,5]` (default 3) and `waitBetweenTries ∈ [0,5000]` (default 1000); retries never add a `runData` entry | `:1600-1615` | `403C.retryOnFail_recovers` (`runs: 1` after 2 attempts) |
| `O14` | A retry is also triggered by soft failure `data[0][0].json.error !== undefined` | `:1672`, `:1689` | `403C.error_in_json_soft_failure` (with `retryOnFail` absent: no error recorded) |
| `O15` | On error: `continueOnFail \|\| onError ∈ {continueRegularOutput, continueErrorOutput}` ⇒ input passthrough and the run still finishes `success`; otherwise the entry is un-shifted back for resumption and the loop breaks | `:1841-1893` | `403C.throw_continueOnFail_passthrough` vs `.throw_stops_workflow` |
| `O16` | `taskData.error` / `resultData.error` are plain snapshots `{...e, message, stack}`, `instanceof Error === false`; only own enumerable props survive | `:1800-1801` | `403C.throw_stops_workflow`, `.node_op_error_recorded_in_task` (16 keys; `cause` present as `undefined`) |
| `O17` | `onError: 'continueErrorOutput'` moves error items out of branches `0 … n-2` into branch `n-1` where `n` counts the **synthetic** error output; classification is `item.error` \| `json.error` (1 key) \| `json.error`+`json.message` (2 keys) | `:2463-2560` | `403H.effective_outputs_of_the_two_branch_type`, `403H.two_branch_node_onError_continueErrorOutput` (`data.main = [2,0,2]`) |
| `O18` | `assignPairedItems` autofix: `1 input & 1 output branch` ⇒ `{item:0}`; equal counts ⇒ `{item:index}`; single output branch ⇒ `{item:0}`; otherwise `break checkOutputData` and later branches are left untouched; returns `?? null` | `:2581-2639` | `403C.pairedItem_autofix_single_input_output`, `.pairedItem_breaks_on_cardinality_mismatch` |
| `O19` | Node return `null` ⇒ `continue executionLoop` with **no** task written and `lastNodeExecuted` unchanged | `:1769-1775` | `403C.returns_null_ends_branch` |
| `O20` | Legacy soft-error unwrap: `json.$error` + `json.$json` ⇒ `error = json.$error`, `json = {error: message}`; a bare `item.error` ⇒ `json = {error: message}` | `:1901-1915` | `403C.error_in_json_soft_failure` (no `$error` pair ⇒ untouched) |
| `O21` | `executionStatus = waitTill ? 'waiting' : 'success'`, overwritten by `'error'` when `executionError !== undefined`; on cancel every `'running'` task becomes `'canceled'` | `:1821-1827`, `:2641-2650` | `403E_cancel.summary.perNode` (empty — cancel happened before the first task write) |
| `O22` | Pre-run gate: `checkForWorkflowIssues` calls `checkReadyForExecution` with `startNode = first stack node`, `destinationNode`, `pinDataNodeNames = keys(resultData.pinData)`; any issue ⇒ `WorkflowHasIssuesError`. A bare `checkReadyForExecution(wf, {})` validates **nothing** | `:1305-1333`, `:826-891` | `403K.{missing_required_parameter_blocks_run,same_node_pinned_runs,same_node_disabled_runs}` vs `403K.bare_gate_call_checks_nothing === null` |
| `O23` | `executionIndex` is a per-engine monotone counter read from `additionalData.currentNodeExecutionIndex` at pop time; the start node's task gets `0` | `:1506-1512` | `403D.executionIndex_sequence`, `…after_run: 4` for a 4-node run |
| `O24` | `additionalData.executionTimeoutTimestamp` past ⇒ `status='canceled'`, `timedOut=true`, checked once per iteration; `cancel()` additionally emits `workflowExecuteAfter` with the partial run data | `:1486-1492`, `:1423-1431` | `403E_cancel.executionTimeoutTimestamp_in_the_past` |
| `O25` | Node-side writers: `setMetadata()` → `taskData.metadata`; `addExecutionHints()` → `taskData.hints` (via `context.hints`) | `:73-79`, `:1715-1717` | `403C.setMetadata_lands_in_task`, `.hints_landed_on_task` |

---

## 3. Explicit non-ownership (this slice must NOT define)

- `X1` **No Rust.** Phase 2 of this branch is isolation only; `crates/**` and `apps/**` are untouched (verified in
  `results/TASK-403-execution-engine-spec.md` ops table). Implementation belongs to Phase 3.
- `X2` Expression *parsing* and `{{ }}` chunking → [`expression-syntax.contract.md`](expression-syntax.contract.md).
- `X3` `$json`/`$node`/`$parameter` *resolution semantics* → [`variable-lookup.contract.md`](variable-lookup.contract.md).
  The engine supplies the coordinates, never the resolution algorithm.
- `X4` Node-type behaviour (`execute` bodies), credential decryption, webhook registration and the runner/task-runner
  transports (`packages/cli/**`) — out of scope; the engine only dispatches to `execute` / `poll` / `trigger` / `webhook`
  and `executeDeclarativeNodeInTest` (`:1200-1268`).
- `X5` Execution **persistence** (`storedAt`, DB writes, `IRunExecutionData` save/restore) — interface referenced, not owned.
- `X6` `ExecuteSingleContext` semantics (routing layer) and `subNodeExecutionResults` (`EngineResponse`) plumbing for AI
  tool nodes — recorded in the anatomy, not contracted here.

---

## 4. Invariants

- `INV-1` One `ExecuteContext` per `(node, runIndex)`; the context's `runIndex`, `connectionInputData`,
  `executeData.source` and `additionalKeys` are read-only projections of exactly one engine activation. A second
  activation of the same node MUST produce a second context with `runIndex + 1` (`O5`, `403I`).
- `INV-2` `runData[nodeName]` is append-only within a run, and its length before a node starts *is* that node's
  `runIndex` (`O5`). Merging into an existing index is only for `inputOverride` pre-registration (`:1935-1948`).
- `INV-3` A task's `source` array is indexed by **input connection index**; entry `i` describes the parent that filled
  input `i`. Nodes started from the stack root have `source: []`, never `null` (`O3`).
- `INV-4` `executionStatus` is final at write time except for the cancel sweep (`O21`).
- `INV-5` Every error surfaced in run data is a plain snapshot; consumers must not rely on `instanceof Error`, on
  `cause`, or on prototype getters (`O16`).
- `INV-6` Downstream scheduling is decided solely by the *item count of the parent branch* (`O6`); the engine never
  inspects node identity for that decision.
- `INV-7` `pinData`, `executeOnce`, `continueOnFail`, `retryOnFail`, `onError`, `alwaysOutputData` alter **data shape or
  control flow**, never the context class or the scoping tuple (`403F`).
- `INV-8` Validation is scoped and pin-exempt; an unscoped `checkReadyForExecution` is a no-op (`O22`).

---

## 5. Declared gaps (recorded, not papered over)

| ID | Gap | Why it stays open |
| :--- | :--- | :--- |
| `G-1` | `handleWaitingState` / resume-from-wait is documented from source only | needs `putExecutionToWait` + a resume entry point; the harness exposes no resume driver (`403C` has no waiting scenario) |
| `G-2` | `poll` / `trigger` / `webhook` dispatch arms (`:1237-1257`) unobserved | the harness registers no poll/webhook-capable type; recorded as source-derived only |
| `G-3` | Endless-loop guard (`:1565-1571`) not reproducible without a crafted re-queue cycle | assertion is derived from the `ensureInputData` re-push path; kept as a normative `O`-free hazard in anatomy §10.7 |
| `G-4` | `subNodeExecutionResults` / `EngineResponse` and `rewireOutputLogTo` (AI tool paths) not exercised | owned by `X6`; only the field's presence is recorded (`403A.fields`) |
| `G-5` | `getKnownNodeTypes()` returns `{}` under the harness because `nodeTypes` there is a minimal shim | harness limitation, not an n8n behaviour claim |

---

## 6. Acceptance criteria (machine-checkable)

| Check | Command | Expected |
| :--- | :--- | :--- |
| Evidence exists and is re-derivable | `NODE_PATH=$PWD/.runtime/node_modules node docs/isolation/agent-6-probes/engine-probes.cjs /tmp/e.json` | exit `0`, 13 groups, 4601 values |
| Determinism | `node docs/isolation/agent-6-probes/engine-determinism-check.cjs /tmp/e.json docs/isolation/agent-6-probes/engine-observations.json` | `MATCH` |
| Recorded file integrity | `sha256sum docs/isolation/agent-6-probes/engine-observations.json` | `0016e713b34240dda1efc8eaa2abec442b2fcc7376497a24056519f380f020fb` |
| No Rust touched | `git diff --name-only HEAD -- crates apps tests reference` | empty |
| Reference tree untouched | `node tools/workflow-reference-manifest.mjs --check` | `PASS 15050 files` |
| Result integrity | `python3 tests/integration/result_integrity_audit.py` | this task's row: STATUS + non-empty operations table + evidence paths exist |
