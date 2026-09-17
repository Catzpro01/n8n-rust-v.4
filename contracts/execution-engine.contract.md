# LEGO Contract: Execution Engine (reconstructed)

**Derived from:** n8n 2.9.4 source (`packages/core/src/execution-engine/workflow-execute.ts`,
`packages/workflow/src/common/{get-connected-nodes,get-parent-nodes,map-connections-by-destination}.ts`,
`packages/workflow/src/{interfaces,execution-status}.ts`) and runtime comparison against the pinned
`n8n-core` / `n8n-workflow` **2.9.1** (the dependency set of n8n 2.9.4).
**Owner:** Agent 1 (`workflow`) — reconstruction lives in `packages/reconstructed-engine/`
**Status:** TESTED — 82 regression cases, 13 of them executed against the real engine
**Rule basis:** `PROJECT_RULES.md` #1 (ZERO RUST → JavaScript/TypeScript, 1:1 from source) and #5
(every module must have a clear boundary and a formal contract).

> This contract is **machine-checked**: `packages/reconstructed-engine/test/contract-conformance.test.mjs`
> parses the fenced blocks below and fails if the implementation drifts from them. The provenance
> line numbers are checked against the real files in `reference/n8n/`, so a reference upgrade that
> moves the code breaks the build instead of silently invalidating the citations.

---

## 1. Scope and boundary

The module reconstructs **the execution loop only**: which node runs next, with what input, what is
recorded, and when the run ends.

* **In scope:** traversal order, fan-in waiting, item propagation, run data recording, error and
  cancellation semantics, pin data, `alwaysOutputData`, `pairedItem` decoration, graph traversal
  helpers.
* **Out of scope (explicit non-goals, see §7):** node implementations, expressions, credentials,
  persistence, wait/resume, sub-workflows, AI/routing nodes.
* **Inputs:** a plain workflow object (`{ nodes, connections, settings?, pinData? }`) in the n8n file
  format, plus registered node type handlers.
* **Outputs:** a result object in the n8n shape (§3). The module performs **no** I/O: no filesystem,
  no network, no database, no `process.env` reads.

## 2. Public surface

<!-- CONTRACT-SURFACE:BEGIN -->
```json
{
  "exports": [
    "WorkflowExecutionEngine",
    "getConnectedNodes",
    "getParentNodes",
    "mapConnectionsByDestination"
  ],
  "engineMethods": [
    "registerNodeType",
    "runWorkflow",
    "getParentNodes",
    "numberOfInputs",
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
  ]
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
  },
) => INodeExecutionData[] | Promise<INodeExecutionData[]>;

registerNodeType(typeName: string, handler: NodeHandler, description?: {
  requiredInputs?: number | number[];   // interfaces.ts:2355 — the expression form is NOT supported
  inputs?: string[];                    // used for its .length
  outputs?: Array<string | { type: string }>;  // node-helpers.ts:1140-1196 — used to find the
                                        // error output when onError is 'continueErrorOutput'
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

Precedence (`workflow-execute.ts:2383-2400`): `canceled` > `error` > `success`.

## 4. Behavioural guarantees

| # | Guarantee | Reference | Test |
| :-- | :--- | :--- | :--- |
| G1 | `runWorkflow` **always terminates**, even on a cyclic graph (a node runs at most `max(1, input slots)` times per run; dropped arrivals are reported in `cycleSkips`) | safety net; n8n rejects cycles at validation time | `engine.test.mjs` CYCLE GUARD ×2 |
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
| G22 | A node whose output object is `null`/`undefined` (as opposed to empty) records **no** `runData` entry and ends its branch, unless it errored or parked | `:1769-1774` | null-output test |

## 5. Determinism

Same workflow + same handlers + same options ⇒ same `executionLog` order, same `runData` structure,
same item payloads. The only non-deterministic fields are wall-clock (`startTime`, `executionTime`).

## 6. Failure contract

| Situation | Behaviour |
| :--- | :--- |
| no nodes in the workflow | rejects with `Error('No nodes found in workflow definition')` |
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

`waitTill` pause **and** resume are in scope and implemented (G19-G21) — the earlier revision of
this contract listed them as a non-goal, and the conformance test forced this section to be
corrected when the implementation started using the name. Each is another LEGO's contract (`expression.contract.md`, `credentials.contract.md`,
`execution-data.contract.md`, `persistence.contract.md`, `node.contract.md`).

## 8. Provenance

Every behaviour above cites its source line. The full, machine-checked list lives in the module
sources; the contract test verifies that each cited range still exists inside the referenced file in
`reference/n8n/` (currently `workflow-execute.ts` = 2655 lines, `get-connected-nodes.ts` = 95,
`get-parent-nodes.ts` = 18, `map-connections-by-destination.ts` = 49).

## 9. Verification hooks

| Command | Covers |
| :--- | :--- |
| `npm run engine:test` | this contract (82 cases: 59 unit + 3 graph-port equivalence + 13 against the real engine + 7 contract conformance) |
| `bash tests/integration/run_gate.sh --offline-only` | stage 3 runs the suite above; stages 1-2 run the other LEGO gates |
| `node tests/compatibility/contract_conformance.mjs` | asserts this contract file is present |
