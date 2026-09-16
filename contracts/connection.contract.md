# LEGO Contract: Connection Model

**Derived from:** n8n 2.9.4 `packages/workflow/src/{interfaces.ts, common/**, graph/graph-utils.ts, connections-diff.ts}` and runtime observation (`tests/reference/connection/*`).
**Owner:** Agent 3 (LEGO `connection`)
**Status:** TESTED

## 1. Data Schema

```typescript
type NodeConnectionType =
  | 'main'
  | 'ai_agent' | 'ai_chain' | 'ai_document' | 'ai_embedding' | 'ai_languageModel' | 'ai_memory'
  | 'ai_outputParser' | 'ai_retriever' | 'ai_reranker' | 'ai_textSplitter' | 'ai_tool' | 'ai_vectorStore';

interface ConnectionContract {          // = IConnection
  node: string;                         // destination node NAME (source-keyed map) / source node NAME (destination-keyed map)
  type: NodeConnectionType;
  index: number;                        // destination INPUT index (source-keyed) / source OUTPUT index (destination-keyed)
}

// source-keyed (the persisted workflow.connections)
type Connections = Record<sourceNodeName, Record<NodeConnectionType, Array<ConnectionContract[] | null>>>;
//                                                                  ^ position = source OUTPUT index; [] or null = no edges from that output

// destination-keyed (derived, mapConnectionsByDestination)
type ConnectionsByDestination = Record<destNodeName, Record<NodeConnectionType, Array<ConnectionContract[]>>>;
//                                                                              ^ position = destination INPUT index; padded with []

interface NodeConnectionIndexes { sourceIndex: number; destinationIndex: number; }   // = INodeConnection
```

## 2. Input

| Function | Input |
|---|---|
| `mapConnectionsByDestination(c)` | source-keyed `Connections` |
| `getChildNodes(bySrc, name, type?='main'\|'ALL'\|'ALL_NON_MAIN', depth?=-1)` | source-keyed map |
| `getParentNodes(byDest, name, type?, depth?)` | destination-keyed map |
| `getConnectedNodes(map, name, type?, depth?, checked?)` | either map |
| `buildAdjacencyList(bySrc)` | source-keyed map |
| `getRootNodes / getLeafNodes / getInputEdges / getOutputEdges(selection, adj)` | `Set<nodeName>`, adjacency list |
| `hasPath(start, end, adj)` | node names |
| `parseExtractableSubgraphSelection(selection, adj)` | `Set<nodeName>` |
| `compareConnections(prev, next)` | two source-keyed maps |

## 3. Invariants

1. Node references are by **name**; `name` must exist in the node list (validation contract) but the connection functions themselves never look nodes up and return `[]`/`undefined` for unknown names.
2. Output index must be `>= 0` and within the declared output count of the source node; input index must be `>= 0` and within the declared input count of the destination node — declared counts come from `NodeHelpers.getNodeOutputs/getNodeInputs` (Agent 2). A node with `onError: 'continueErrorOutput'` has one extra trailing `main` output ("Error"); it is an ordinary output index in this model.
3. Sparse output slots (`[]`, `null`) are valid and preserved; the destination map pads missing input indexes with `[]`.
4. Inversion is lossless and exact (C1 in `docs/isolation/connection.md`).
5. Traversal results are deduplicated, farthest-first, depth-bounded, and terminate on cycles.
6. **Cycles are permitted.** n8n 2.9.4 performs no acyclicity validation in `n8n-workflow`; `Merge ⇄ Loop`-style graphs execute. (Supersedes the earlier "graph must be acyclic" statement; see `docs/isolation/connection.md` §6.) Cycle handling for *partial* executions is engine-owned (`packages/core/.../partial-execution-utils`).
7. Graph utilities (`roots`, `leaves`, `hasPath`, extractable selection) evaluate **`main` edges only**; edges of AI types are ignored there but included by `buildAdjacencyList`, `getInputEdges`, `getOutputEdges`.
8. `compareConnections` identity = JSON of `{node,type,index}`; result keyed `[source][type]` with `sourceIndex` and the position (`index`) inside the slot.
9. All functions are pure (no mutation of inputs) — exception noted: `Workflow.renameNode` (Agent 1) mutates the source map in place and does not refresh the destination map (D-08).

## 4. Output

- Traversal: `string[]` node names.
- Inversion: destination-keyed map (new object).
- `parseExtractableSubgraphSelection`: `{ start?: string; end?: string }` **or** `ExtractableErrorResult[]` with `errorCode ∈ { 'Multiple Input Nodes', 'Multiple Output Nodes', 'Input Edge To Non-Root Node', 'Output Edge From Non-Leaf Node', 'No Continuous Path From Root To Leaf In Selection' }`.
- `compareConnections`: `{ added, removed }`.
- `Workflow.getNodeConnectionIndexes` (consumed, Agent 1): `NodeConnectionIndexes | undefined` — first path found by BFS.

## 5. Errors

None of the pure functions throw. Invalid indexes/unknown names are *not* detected here; that is the Validation LEGO's responsibility (`contracts/validation.contract.md` `DanglingConnections`). `parseExtractableSubgraphSelection` reports problems as data (§4), not exceptions.

## 6. Dependencies (registered)

| ID | Provider | Contract | Interface consumed | Access | Status |
|---|---|---|---|---|---|
| CD-01 | Agent 1 / `workflow` | `contracts/workflow.contract.md` §3.1, `workflow-handoff.md` §2 | `Workflow::getNode(name) → INode \| null` (never throws) | read-only | provider VERIFIED (`a092e00f`) |
| CD-02 | Agent 1 / `workflow` (→ becomes **provided** by Connection under §8 once A2–A6 land; `common/*` 5 symbols stay consumed) | `workflow-handoff.md` §2 "graph" group | `getConnectedNodes`, `getChildNodes`, `getParentNodes`, `mapConnectionsByDestination`, `buildAdjacencyList`, `getRootNodes`, `getLeafNodes`, `getInputEdges`, `getOutputEdges`, `hasPath`, `parseExtractableSubgraphSelection`, `getNodeByName` | read-only, frozen 15-symbol surface | provider VERIFIED |
| CD-03 | Agent 1 / `workflow` (→ **provided** by Connection under §8) | `workflow-handoff.md` §2 "content" | `compareConnections` | read-only | provider VERIFIED; transfer pending |
| CD-04 | Agent 1 / `workflow` | `workflow.contract.md` §3.3 | `Workflow.connectionsBySourceNode`, `connectionsByDestinationNode`, `getNodeConnectionIndexes`, `getHighestNode`, `getStartNode`, `getParentMainInputNode`, `getParentNodesByDepth` | read-only (consumed, not owned) | provider VERIFIED; defect D-08 (`renameNode` stale destination map) open with Agent 1 |
| CD-05 | Agent 2 / `node` | `contracts/node.contract.md` §2 (`name` is the primary reference key) + `NodeHelpers.getNodeOutputs/getNodeInputs/getConnectionTypes` | declared port counts incl. trailing "Error" main output | read-only | provider VERIFIED (`eb1c1195`); `node.contract.md` §6 formalises `getNodeInputs/getNodeOutputs/getConnectionTypes` + `INodeOutputConfiguration.category: 'error'` → D-09 contract-satisfied; runtime confirmation of trailing-error-output index remains Agent 2 (`node-helpers.ts` L1170) |
| CD-06 | Agent 4 / `validation` | `contracts/validation.contract.md` | consumer of §3.1–3.2 (`DanglingConnections`); `CycleDetection` must be labelled NEW CAPABILITY (§3.6, `ISSUE-003`) | — | informational |
| CD-07 | shared | `packages/workflow/src/interfaces.ts` | `IConnection`, `IConnections`, `INodeConnection`, `NodeConnectionType(s)` | type-only | — |

Ownership of `common/**`, `graph/graph-utils.ts`, `connections-diff.ts`: Phase 2 = consumed from Workflow (Option B); Phase 3 = transferred to Connection behind port `P-CONNECTION-GRAPH` (Option A) — decision recorded in `docs/isolation/connection.md` §0.1, pending Agent 5 acknowledgement.
- **Validation (Agent 4):** consumes §3.1–3.2 to implement `DanglingConnections`; note §3.6 — `CycleDetection` must not reject cyclic graphs as invalid for execution.
- shared `interfaces.ts` for types.

## 7. Ownership

| Owns | Does NOT own |
|---|---|
| `IConnections` orientation semantics, sparse-slot rules | `Workflow` wrapper methods and map lifecycle |
| `graph/graph-utils.ts`, `connections-diff.ts` (**accepted A**, §8 — pending A2–A6) | `common/*` (runtime-imported by `workflow.ts` L5-9 → stays Workflow; candidate later port) · declared port counts (`NodeHelpers`) |
| invariants 1–8 | runtime item routing, `executionOrder` v0/v1, `DirectedGraph`/`handleCycles` |

## 8. Provided: graph & diff surface (`P-CONNECTION-GRAPH`) — MSG-02 answer: **accepted A**

Status: **DECLARED, not yet executed.** Until Agent 1 completes steps A2–A4 of
`docs/isolation/workflow-graph-ownership-plan.md` and Agent 5 re-runs the 11 gates (A6), both files
physically stay where `packages/workflow-lego/manifest/ownership.json` puts them. Sequenced after the
MSG-09 reference-integrity fix. Reference source: n8n 2.9.4, `reference/n8n/packages/workflow/src`.

### 8.1 Symbols (verbatim signatures, source line)

`graph/graph-utils.ts` — only import: `import type { IConnection, IConnections } from '../interfaces'`

| # | Symbol | Kind | Line | Signature |
|---|---|---|---|---|
| 1 | `ExtractableErrorResult` | type | 29 | union of `{ errorCode: 'Multiple Input Nodes'; nodes: Set<string> }` \| `{ errorCode: 'Multiple Output Nodes'; nodes: Set<string> }` \| `{ errorCode: 'Input Edge To Non-Root Node'; node: string }` \| `{ errorCode: 'Output Edge From Non-Leaf Node'; node: string }` \| `{ errorCode: 'No Continuous Path From Root To Leaf In Selection'; start: string; end: string }` |
| 2 | `IConnectionAdjacencyList` | type | 36 | `Map<string, Set<IConnection>>` (barrel alias `AdjacencyList`) |
| 3 | `getInputEdges` | function | 41 | `(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList) => Array<[string, IConnection]>` |
| 4 | `getOutputEdges` | function | 62 | `(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList) => Array<[string, IConnection]>` |
| 5 | `getRootNodes` | function | 103 | `(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList) => Set<string>` |
| 6 | `getLeafNodes` | function | 123 | `(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList) => Set<string>` |
| 7 | `hasPath` | function | 145 | `(start: string, end: string, adjacencyList: IConnectionAdjacencyList) => boolean` |
| 8 | `ExtractableSubgraphData` | type | 165 | `{ start?: string; end?: string }` |
| 9 | `buildAdjacencyList` | function | 170 | `(connectionsBySourceNode: IConnections) => IConnectionAdjacencyList` |
| 10 | `parseExtractableSubgraphSelection` | function | 209 | `(graphIds: Set<string>, adjacencyList: IConnectionAdjacencyList) => ExtractableSubgraphData \| ExtractableErrorResult[]` |

`connections-diff.ts` — only import: `import type { IConnection, IConnections } from '.'` (deviation D-01 → `P-KERNEL-TYPES`)

| # | Symbol | Kind | Line | Signature |
|---|---|---|---|---|
| 11 | `INodeConnectionsDiff` | type | 8 | `Record<string, ConnectionEntry[]>` where (non-exported) `ConnectionEntry = { sourceIndex: number; value: { index: number; connection: IConnection } \| null }` |
| 12 | `ConnectionsDiff` | type | 10 | `{ added: Record<string, INodeConnectionsDiff>; removed: Record<string, INodeConnectionsDiff> }` |
| 13 | `compareConnections` | function | 15 | `(prev: IConnections, next: IConnections) => ConnectionsDiff` |

(Agent 1 counts "12 symbols" = 7 graph functions + 3 graph types + `compareConnections` + 2 diff types
grouped as one content entry; the table above lists every export individually — 13 rows, same set.)

### 8.2 Invariants of the provided surface

1. **Pure over `IConnections` + node-name sets.** No import of `Workflow`, the adjacency indexes,
   `node-helpers` or the expression runtime — and none may be added (plan §5, last row).
2. **`main`-only.** `buildAdjacencyList` iterates every connection type key but the graph functions are
   used and pinned (`tests/reference/connection/03`) on `main` edges; non-`main` types are traversed by
   `common/*` (`'ALL'` / `'ALL_NON_MAIN'`), which is **not** part of this port.
3. **Deterministic ordering.** Results follow `Object.keys` / insertion order of the input maps and
   `Set`/`Map` iteration order; no sorting is performed. `compareConnections` decides equality by JSON
   identity of `IConnection` entries (`tests/reference/connection/05`).
4. **Public paths preserved.** `n8n-workflow` barrel (`index.ts:74-80`) and the deep path
   `dist/cjs/graph/graph-utils.js` keep exporting the same names; only ownership/port metadata moves.
5. **Behaviour pinned** by `tests/reference/connection/{01..05}` (5/5) and by Agent 1's digest sections
   `diff` + `graphValidation` — which become *port-dependent* under this port (plan §3.2);
   `beforeVsAfter` must stay 252/252.

### 8.3 Consumers (measured)

| Consumer | Edge |
|---|---|
| `index.ts:74-80` | barrel re-export (`parseExtractableSubgraphSelection`, `buildAdjacencyList`, `ExtractableErrorResult`, `ExtractableSubgraphData`, `IConnectionAdjacencyList as AdjacencyList`) |
| `workflow-diff.ts:11` | `compareConnections`, `ConnectionsDiff` (Workflow LEGO — consumes via `P-CONNECTION-GRAPH`) |
| `Workflow` class | **never calls them** |

### 8.4 Adapter obligation (step A5, Agent 3)

Deliver `P-CONNECTION-GRAPH` in two modes mirroring `packages/workflow-lego/src/adapters/{reference,strict}`:
*reference* = pinned runtime (`n8n-workflow/dist/cjs/graph/graph-utils.js`, `.../connections-diff.js`);
*strict* = standalone copy of the two files. Location and manifest schema to be confirmed by Agent 5
(proposed `packages/connection-lego/**`, see `tasks/TASK-303-connection.yaml`). Not started until A2–A4 land.
