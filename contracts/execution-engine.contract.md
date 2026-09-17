# LEGO Contract: Execution Engine (reconstructed)

**Derived from:** n8n 2.9.4 source (`packages/core/src/execution-engine/workflow-execute.ts`,
`packages/workflow/src/common/{get-connected-nodes,get-parent-nodes,map-connections-by-destination}.ts`,
`packages/workflow/src/{interfaces,execution-status}.ts`) and runtime comparison against the pinned
`n8n-core` / `n8n-workflow` **2.9.1** (the dependency set of n8n 2.9.4).
**Owner:** Agent 1 (`workflow`) — reconstruction lives in `packages/reconstructed-engine/`
**Status:** TESTED — 49 regression cases, 7 of them executed against the real engine
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
    "nodeTypeDescriptions"
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
}): void
```

An unregistered node type is a **passthrough** (its input items become its output).

## 3. Result shape

<!-- CONTRACT-RESULT:BEGIN -->
```json
{
  "resultKeys": ["status", "finished", "timedOut", "cyclic", "cycleSkips", "executionLog", "data", "resultData"],
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
{ "statuses": ["success", "error", "canceled"] }
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
| G13 | `lastNodeExecuted` is the last node that produced data, or the failing node | `:1739`, `:1778` | lastNodeExecuted test |
| G14 | `getConnectedNodes` / `getParentNodes` / `mapConnectionsByDestination` are byte-behaviour-identical to `n8n-workflow` 2.9.1 | `common/*.ts` | `graph-equivalence.test.mjs` ×3 |

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
    "waitTill",
    "subExecution",
    "credentials",
    "expression",
    "sourceOverwrite"
  ]
}
```
<!-- CONTRACT-NONGOALS:END -->

Concretely: `waitTill` resume, sub-workflow execution, credential resolution, expression evaluation
(`{{ … }}`), the `sourceOverwrite` branch of the input re-stamp (AI tool executions, `:1530-1541`),
`requiredInputs` given as an expression string, execution data persistence, and node implementations
themselves. Each is another LEGO's contract (`expression.contract.md`, `credentials.contract.md`,
`execution-data.contract.md`, `persistence.contract.md`, `node.contract.md`).

## 8. Provenance

Every behaviour above cites its source line. The full, machine-checked list lives in the module
sources; the contract test verifies that each cited range still exists inside the referenced file in
`reference/n8n/` (currently `workflow-execute.ts` = 2655 lines, `get-connected-nodes.ts` = 95,
`get-parent-nodes.ts` = 18, `map-connections-by-destination.ts` = 49).

## 9. Verification hooks

| Command | Covers |
| :--- | :--- |
| `npm run engine:test` | this contract (49 cases: 45 unit + 4 graph-port equivalence, 7 of them against the real engine) |
| `bash tests/integration/run_gate.sh --offline-only` | stage 3 runs the suite above; stages 1-2 run the other LEGO gates |
| `node tests/compatibility/contract_conformance.mjs` | asserts this contract file is present |
