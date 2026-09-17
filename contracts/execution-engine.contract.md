# LEGO Contract: Execution Engine (reconstructed)

**Derived from:** n8n 2.9.4 source (`packages/core/src/execution-engine/workflow-execute.ts`,
`packages/core/src/execution-engine/partial-execution-utils/*.ts`,
`packages/workflow/src/common/{get-connected-nodes,get-parent-nodes,map-connections-by-destination}.ts`,
`packages/workflow/src/{interfaces,execution-status}.ts`) and runtime comparison against the pinned
`n8n-core` / `n8n-workflow` **2.9.1** (the dependency set of n8n 2.9.4).
**Owner:** Agent 1 (`workflow`) — reconstruction lives in `packages/reconstructed-engine/`
**Status:** TESTED — 126 regression cases, including 48 pinned-runtime differential cases
**Rule basis:** `PROJECT_RULES.md` #1 (ZERO RUST → JavaScript/TypeScript, 1:1 from source) and #5
(every module must have a clear boundary and a formal contract).

> This contract is **machine-checked**: `packages/reconstructed-engine/test/contract-conformance.test.mjs`
> parses the fenced blocks below and fails if the implementation drifts from them. The provenance
> line numbers are checked against the real files in `reference/n8n/`, so a reference upgrade that
> moves the code breaks the build instead of silently invalidating the citations.

---

## 1. Scope and boundary

The module reconstructs the **execution loop and its in-memory partial-run planning layer**: which node
runs next, with what input, what is recorded, when the run ends, and how a destination subgraph is
prepared before partial execution.

* **In scope:** start-node selection, traversal order, fan-in waiting, item propagation, run data
  recording, error/retry/cancellation semantics, pin data, `alwaysOutputData`, `executeOnce`,
  `pairedItem` decoration, wait-state parking/resume, graph traversal helpers, and the graph/run-data
  planning primitives used by partial execution.
* **Out of scope (explicit non-goals, see §7):** node implementations, expressions, credentials,
  persistence, the scheduler that decides when to resume, sub-workflows, and AI/tool node execution.
* **Inputs:** a plain workflow object (`{ nodes, connections, settings?, pinData? }`) plus registered
  node type handlers, or graph/run-data values passed to the in-memory partial-planning subpath.
* **Outputs:** an execution result in the n8n shape (§3), or in-memory graph/planning values. The
  module performs **no** I/O: no filesystem, no network, no database, no `process.env` reads.

## 2. Public surface

<!-- CONTRACT-SURFACE:BEGIN -->
```json
{
  "exports": [
    "WorkflowExecutionEngine",
    "getConnectedNodes",
    "getHighestNode",
    "getParentNodes",
    "mapConnectionsByDestination"
  ],
  "engineMethods": [
    "registerNodeType",
    "runWorkflow",
    "getParentNodes",
    "numberOfInputs",
    "getHighestNode",
    "handleExecuteOnce",
    "ensureInputData",
    "maxExecutionsFor",
    "assignPairedItems",
    "mainOutputCount",
    "handleNodeErrorOutput",
    "handleWaitingState",
    "processRunExecutionData",
    "addNodeToBeExecuted",
    "prepareWaitingToExecution",
    "releaseWaitingNodes",
    "findStartNode"
  ],
  "engineAccessors": ["executionOrder"],
  "instanceFields": [
    "definition",
    "nodes",
    "connections",
    "connectionsByDestinationNode",
    "settings",
    "nodeTypes",
    "nodeTypeDescriptions",
    "runExecutionData"
  ],
  "partialGraphModule": {
    "file": "partial.mjs",
    "packageExport": "./partial",
    "exports": [
      "DirectedGraph",
      "filterDisabledNodes",
      "findSubgraph",
      "getNextExecutionIndex",
      "getIncomingData",
      "getIncomingDataFromAnyRun",
      "cleanRunData",
      "handleCycles",
      "anyReachableRootHasRunData",
      "findTriggerForPartialExecution",
      "isDirty",
      "findStartNodes",
      "getSourceDataGroups",
      "addWaitingExecution",
      "addWaitingExecutionSource",
      "recreateNodeExecutionStack",
      "rewireGraph"
    ],
    "directedGraphMethods": [
      "hasNode",
      "getNodes",
      "getNodesByNames",
      "getConnections",
      "addNode",
      "addNodes",
      "removeNode",
      "addConnection",
      "addConnections",
      "getDirectChildConnections",
      "getChildrenRecursive",
      "getChildren",
      "getDirectParentConnections",
      "getParentConnectionsRecursive",
      "getParentConnections",
      "getConnection",
      "getStronglyConnectedComponents",
      "depthFirstSearchRecursive",
      "depthFirstSearch",
      "clone",
      "toIConnections",
      "makeKey"
    ],
    "directedGraphStatics": ["fromWorkflow", "fromNodesAndConnections"],
    "deliberatelyOmitted": ["toWorkflow"]
  }
}
```
<!-- CONTRACT-SURFACE:END -->

Handler contract (the only way node logic enters the engine):

```typescript
type NodeHandler = (
  node: INode,
  items: INodeExecutionData[],          // first input slot, for convenience
  ctx: {
    inputData: INodeExecutionData[][];  // ALL input slots, indexed like the connection map
    source: Array<ISourceData | null>;
    runIndex: number;
    putExecutionToWait(waitTill: Date): void;
  },
) => INodeExecutionData[] | Promise<INodeExecutionData[]>;

registerNodeType(typeName: string, handler: NodeHandler, description?: {
  requiredInputs?: number | number[];   // interfaces.ts:2355 — the expression form is NOT supported
  inputs?: string[];                    // used for its .length
  outputs?: Array<string | { type: string }>;  // node-helpers.ts:1140-1196 — used to find the
                                        // error output when onError is 'continueErrorOutput'
  trigger?: unknown;                    // presence identifies a trigger start node
  poll?: unknown;                       // presence identifies a poll start node
  name?: string;                        // excludes the manual-chat trigger from auto-start
}): void

// node-helpers.ts:1140-1196 — how many `main` outputs a node has
mainOutputCount(node: INode): number

// workflow-execute.ts:2463-2562 — move error items onto the last main output, in place
handleNodeErrorOutput(node: INode, nodeSuccessData: INodeExecutionData[][], executionData: IExecuteData): void

// workflow-execute.ts:1285-1302 — repair a waiting IRunExecutionData so it can run on (mutates it)
handleWaitingState(state: IRunExecutionData): IRunExecutionData

// workflow-execute.ts:1400-1412 — run the state this engine was constructed with
processRunExecutionData(options?: RunOptions): Promise<RunResult>
```

The handler context also carries `putExecutionToWait(waitTill: Date)`
(`base-execute-context.ts:107-112`) — how a node parks the whole execution. `options.runExecutionData`
(or the constructor's second argument) continues a persisted run; the result's `runExecutionData` is
the snapshot to persist. The status precedence is `canceled` > `error` > `waiting` > `success`
(`:2383-2400`).

An unregistered node type is a **passthrough** (its input items become its output). Registering a
handler *without* a description is deliberately the same as an unknown node type as far as
`mainOutputCount` is concerned: `node-helpers.ts:1146-1148` returns `[]` when there is no
`nodeTypeData`, so such a node has no error output to route to.

The partial-planning API is a separate package subpath, `@lego/reconstructed-engine/partial`. It
works in memory and performs no external I/O: `DirectedGraph` plus the source-identical graph,
run-data, cycle, and
trigger/start selection, source grouping, execution-stack recreation, and AI-tool rewiring helpers
used by `WorkflowExecute.runPartialWorkflow2`. The full partial-run orchestrator is **not** yet
exposed: `DirectedGraph#toWorkflow` and `runPartialWorkflow2` remain explicit follow-up work.

## 3. Result shape

<!-- CONTRACT-RESULT:BEGIN -->
```json
{
  "resultKeys": ["status", "finished", "timedOut", "paused", "waitTill", "cyclic", "cycleSkips", "executionLog", "data", "resultData", "runExecutionData"],
  "resultDataKeys": ["runData", "lastNodeExecuted", "error"],
  "taskDataKeys": ["startTime", "executionIndex", "source", "hints", "executionTime", "executionStatus", "data", "error"],
  "taskDataRequired": ["startTime", "executionIndex", "source", "hints", "executionTime", "executionStatus", "data"],
  "logEntryKeys": ["node", "type", "inputCount", "outputCount", "durationMs", "status"]
}
```
<!-- CONTRACT-RESULT:END -->

* `resultData.runData[nodeName]` is an `ITaskData[]` (`interfaces.ts:2675-2691`), one entry per run
  index. `data` and `executionLog` are flat **compatibility views** of the same information, not a
  second source of truth.
* `status` is an `ExecutionStatus` (`execution-status.ts`).

<!-- CONTRACT-STATUS:BEGIN -->
```json
{ "statuses": ["success", "error", "canceled", "waiting"] }
```
<!-- CONTRACT-STATUS:END -->

Precedence (`workflow-execute.ts:2383-2400`): `canceled` > `error` > `waiting` > `success`.

## 4. Behavioural guarantees

| # | Guarantee | Reference | Test |
| :-- | :--- | :--- | :--- |
| G1 | `runWorkflow` **always terminates**, even on a cyclic graph (a node runs at most `max(1, input slots)` times per run; dropped arrivals are reported in `cycleSkips`) | local fail-safe pending full n8n loop-node/reset-data semantics | `engine.test.mjs` CYCLE GUARD ×2 |
| G2 | A node with more than one input slot runs **once** with all inputs; missing inputs are released with `[]` only once the stack drains | `:405-560`, `:2079-2160` | CONFORMANCE fan-in ×2 |
| G3 | A node is not released while **any ancestor** is still waiting | `:2136-2142` | ancestor test |
| G4 | `requiredInputs` (count or index list) is honoured for `executionOrder: 'v1'` and ignored for `'v0'` | `:2107-2177`, `interfaces.ts:2355` | requiredInputs ×4 |
| G5 | Ordering: `'v1'` (default) sorts the nodes to add top-left first and unshifts; `'v0'` pushes | `:417`, `:2041-2055` | order test + 2 equivalence cases |
| G6 | An output that produced no items does not run its branch | `:2013-2019` | empty-output test |
| G7 | A connection to a node missing from the graph throws `ApplicationError('Destination node not found')` | `:2005-2012` | dangling test |
| G8 | A node error is recorded (`executionStatus: 'error'`, `error`), the run ends with `status: 'error'`, downstream nodes do not run; `continueOnFail` / `onError ∈ {continueRegularOutput, continueErrorOutput}` pass the **input** through and continue | `:1823-1900` | error + continueOnFail ×3 |
| G9 | An elapsed `executionTimeoutTimestamp` cancels the run before the next node | `:1486-1496` | TIMEOUT ×3 + equivalence |
| G10 | Pin data replaces the node run; a `disabled` node ignores its pin | `:1632-1637` | PIN DATA ×3 + equivalence |
| G11 | `alwaysOutputData` emits one `{ json: {}, pairedItem }` item so the branch continues | `:1742-1767` | alwaysOutputData ×2 + equivalence |
| G12 | Input items are re-stamped with `pairedItem: { item, input: inputIndex \|\| undefined }` before the node runs; output items get `pairedItem` auto-fixed where unambiguous | `:1517-1552`, `:2581-2641` | pairedItem ×5 + equivalence |
| G13 | `lastNodeExecuted` is the last node that **returned output** — including an output with zero items — or the failing node | `:1738-1741`, `:1778` | lastNodeExecuted test |
| G14 | `getConnectedNodes` / `getParentNodes` / `mapConnectionsByDestination` are byte-behaviour-identical to `n8n-workflow` 2.9.1 | `common/*.ts` | `graph-equivalence.test.mjs` ×3 |
| G15 | `retryOnFail` re-runs the node up to `min(5, max(2, maxTries \|\| 3))` times, waiting `min(5000, max(0, waitBetweenTries \|\| 1000))` ms between attempts — `0` means 1000 ms, because the reference uses `\|\|` | `:1600-1630` | retryOnFail ×4 + equivalence |
| G16 | A node that did not throw but returned `json.error` on its first item is retried with the same budget and then counts as a **success** | `:1670-1692` | soft-failure test |
| G17 | With `onError: 'continueErrorOutput'`, items carrying an error move off every regular output onto the **last** main output; the error output exists because `getNodeOutputs` appends one, so a node type with no registered description routes nothing | `:1720-1722`, `:2463-2562`, `node-helpers.ts:1140-1196` | continueErrorOutput ×5 + equivalence |
| G18 | Items reporting an error inline (`json.$error` + `json.$json`, or an `item.error`) are collapsed to `item.error` + `json = { error: message }`, on a successful node too | `:1898-1917` | inline error ×2 + equivalence |
| G19 | A node that calls `ctx.putExecutionToWait(date)` parks the run: `executionStatus: 'waiting'`, the node goes back on the stack, nothing downstream runs, `status: 'waiting'`, and the result carries `waitTill` + a resumable `runExecutionData` | `:1821`, `:1948-1959`, `:2391-2396`, `:2435-2436`, `base-execute-context.ts:107-112` | waitTill ×3 + equivalence |
| G20 | Resuming (`processRunExecutionData`) clears `waitTill`, marks the parked node `disabled` and pops its `waiting` entry, so the node does not run again and does not look like it ran twice | `:1285-1302`, `:1400-1412` | resume ×2 + equivalence |
| G21 | A `disabled` node is never executed — not even for pin data — and passes its first main input through | `:909-920`, `:1199-1201` | disabled-node ×2 + equivalence |
| G22 | A disabled multi-input node passes through **only its first main slot**. If that slot never arrived, fan-in release normalizes it to `[]`, so the node records an empty output and the branch ends even when a later slot carried items. | `:909-920`, `:2192-2196`, `:2013-2019` | disabled multi-input test + equivalence |
| G23 | A node with `executeOnce: true` is handed only the first item of every input slot | `:990-1002`, `:1219` | executeOnce ×2 + equivalence |
| G24 | A node is only run when its inputs are ready; a slot whose ancestors are all disabled never waits, and an entry that is not ready goes back on the stack | `:2315-2348`, `:1580-1584`, `workflow.ts:492-568` | ensureInputData ×3 + graph equivalence |
| G25 | The same `node:runIndex` arriving twice in a row aborts the run with `ApplicationError('Stopped execution because it seems to be in an endless loop')` instead of spinning | `:1564-1568` | endless-loop test |
| G26 | With no explicit start, one enabled node wins; otherwise the first registered trigger/poll node wins (excluding the manual-chat trigger), then the exact ordered fallback types are tried. An arbitrary ordinary node is never selected. | `workflow.ts:817-860`, `constants.ts:53-59` | start-node ×6 + equivalence |
| G27 | A restored stack entry uses its explicit `runIndex` when present; otherwise it continues at the existing `runData[node].length`. Global `executionIndex` likewise continues after the highest persisted index. | `:1555-1561`, `interfaces.ts:2675-2691` | restored runIndex test |
| G28 | The partial-execution graph foundation (`DirectedGraph`, `filterDisabledNodes`, `findSubgraph`) matches n8n-core 2.9.1 for class surface (except declared `toWorkflow`), imports, traversals, Tarjan components, node removal/rewiring, disabled-node filtering, and subgraph search. | `partial-execution-utils/directed-graph.ts:39-566`, `filter-disabled-nodes.ts:5-18`, `find-subgraph.ts:6-120` | `partial-equivalence.test.mjs` ×8 |
| G29 | Partial-run planning ports preserve execution-index selection, incoming-data lookup, immutable run-data cleaning, cycle-entry selection, reachable-root detection, and trigger precedence (destination → parent with run data → pinned webhook → webhook → first parent). All seven cases are runtime-differential tested; incoming-data helpers omitted from the root barrel are loaded from their pinned deep module and also retain no-runtime assertions. | `run-data-utils.ts:11-26`, `get-incoming-data.ts:3-34`, `clean-run-data.ts:12-49`, `handle-cycles.ts:15-56`, `find-trigger-for-partial-execution.ts:6-112` | `partial-steps.test.mjs` ×7 |
| G30 | Partial start selection stops at the earliest dirty node on each traversed branch and preserves Loop Over Items completion rules; deterministic source grouping then reconstructs complete stack entries or sparse waiting entries, while AI-tool rewiring inserts the exact virtual executor and removes the reachable root. All twelve cases compare the pinned runtime in strict mode; support helpers omitted from the root barrel also retain no-runtime assertions. | `find-start-nodes.ts:13-185`, `get-source-data-groups.ts:5-164`, `recreate-node-execution-stack.ts:20-220`, `rewire-graph.ts:7-58`, `execution.ts:1` | `partial-stack-equivalence.test.mjs` ×12 |

## 5. Determinism

Same workflow + same handlers + same options ⇒ same `executionLog` order, same `runData` structure,
same item payloads. The only non-deterministic fields are wall-clock (`startTime`, `executionTime`).

## 6. Failure contract

| Situation | Behaviour |
| :--- | :--- |
| no executable automatic start (empty workflow or multiple ordinary nodes) | rejects with `ApplicationError('No node to start the workflow from could be found')` |
| dangling connection | rejects with `ApplicationError('Destination node not found')` + `extra.{sourceNodeName,destinationNodeName}` |
| node handler throws | **does not** reject: recorded as `executionStatus: 'error'`, `resultData.error` set, `status: 'error'` |
| cyclic graph | terminates; `cyclic: true`, `cycleSkips[]` lists the dropped arrivals |
| deadline elapsed | `status: 'canceled'`, `timedOut: true`, partial `runData` preserved |

## 7. Non-goals (asserted by the contract test, so they cannot appear silently)

<!-- CONTRACT-NONGOALS:BEGIN -->
```json
{
  "nonGoals": [
    "subExecution",
    "credentials",
    "expression",
    "sourceOverwrite"
  ]
}
```
<!-- CONTRACT-NONGOALS:END -->

Concretely: sub-workflow execution, credential resolution, expression evaluation (`{{ … }}`), the
`sourceOverwrite` branch of the input re-stamp (AI tool executions, `:1530-1541`), `requiredInputs`
given as an expression string, the *scheduler* that decides when a paused execution is resumed
(n8n's `WaitTracker` plus the database — this engine only parks and resumes), the persisted
`IRunExecutionData` fields it does not maintain (`contextData`, `metadata`, `manualData`, `pushRef`,
`runtimeData`), and node implementations themselves.

`waitTill` pause **and** resume are in scope and implemented (G19-G20) — the earlier revision of
this contract listed them as a non-goal, and the conformance test forced this section to be
corrected when the implementation started using the name. The remaining capabilities belong to
other LEGO contracts (`expression.contract.md`, `credentials.contract.md`,
`execution-data.contract.md`, `persistence.contract.md`, `node.contract.md`).

## 8. Provenance

Every behaviour above cites its source line. The full, machine-checked list lives in the module
sources; the contract test verifies that each cited range still exists inside the referenced file in
`reference/n8n/`, including every partial-execution utility named by G28-G30.

## 9. Verification hooks

| Command | Covers |
| :--- | :--- |
| `npm run engine:test` | this contract (126 cases: 70 engine unit + 4 graph parity + 17 execution parity + 8 partial-graph parity + 7 partial-step unit/parity + 12 partial-stack unit/parity + 8 contract conformance) |
| `npm run engine:test:strict` | the same 126 cases with the pinned reference runtime mandatory; zero parity skips allowed |
| `bash tests/integration/run_gate.sh --offline-only` | stage 3 runs the suite above; stages 1-2 run the other LEGO gates |
| `node tests/compatibility/contract_conformance.mjs` | asserts this contract file is present |
