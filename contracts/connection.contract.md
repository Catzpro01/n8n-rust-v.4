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
| CD-02 | Agent 1 / `workflow` | `workflow-handoff.md` §2 "graph" group | `getConnectedNodes`, `getChildNodes`, `getParentNodes`, `mapConnectionsByDestination`, `buildAdjacencyList`, `getRootNodes`, `getLeafNodes`, `getInputEdges`, `getOutputEdges`, `hasPath`, `parseExtractableSubgraphSelection`, `getNodeByName` | read-only, frozen 15-symbol surface | provider VERIFIED |
| CD-03 | Agent 1 / `workflow` | `workflow-handoff.md` §2 "content" | `compareConnections` | read-only | provider VERIFIED |
| CD-04 | Agent 1 / `workflow` | `workflow.contract.md` §3.3 | `Workflow.connectionsBySourceNode`, `connectionsByDestinationNode`, `getNodeConnectionIndexes`, `getHighestNode`, `getStartNode`, `getParentMainInputNode`, `getParentNodesByDepth` | read-only (consumed, not owned) | provider VERIFIED; defect D-08 (`renameNode` stale destination map) open with Agent 1 |
| CD-05 | Agent 2 / `node` | `contracts/node.contract.md` §2 (`name` is the primary reference key) + `NodeHelpers.getNodeOutputs/getNodeInputs/getConnectionTypes` | declared port counts incl. trailing "Error" main output | read-only | provider VERIFIED (`eb1c1195`); `node.contract.md` §6 formalises `getNodeInputs/getNodeOutputs/getConnectionTypes` + `INodeOutputConfiguration.category: 'error'` → D-09 contract-satisfied; runtime confirmation of trailing-error-output index remains Agent 2 (`node-helpers.ts` L1170) |
| CD-06 | Agent 4 / `validation` | `contracts/validation.contract.md` | consumer of §3.1–3.2 (`DanglingConnections`); `CycleDetection` must be labelled NEW CAPABILITY (§3.6, `ISSUE-003`) | — | informational |
| CD-07 | shared | `packages/workflow/src/interfaces.ts` | `IConnection`, `IConnections`, `INodeConnection`, `NodeConnectionType(s)` | type-only | — |

Ownership of `common/**`, `graph/graph-utils.ts`, `connections-diff.ts`: Phase 2 = consumed from Workflow (Option B); Phase 3 = transferred to Connection behind port `P-CONNECTION-GRAPH` (Option A) — decision recorded in `docs/isolation/connection.md` §0.1, pending Agent 5 acknowledgement.
- **Validation (Agent 4):** consumes §3.1–3.2 to implement `DanglingConnections`; note §3.6 — `CycleDetection` must not reject cyclic graphs as invalid for execution.
- shared `interfaces.ts` for types.

## 7. Verification

`npm run connection:check` (`tools/connection-isolation-gate.mjs`) executes the reference oracle
(`n8n-workflow@2.9.1`, the n8n 2.9.4 dependency set) and the reconstructed routing engine over a
12-graph corpus and compares 1,246 call results, including traversal order:

| Check | Scope | Evidence |
|---|---|---|
| `C01` | 13 declared `P-CONNECTION-GRAPH` symbols exist on both sides | `da1654a8` had 2 missing |
| `C02` | the routing engine imports nothing | boundary stays closed |
| `C03` | traversal: `mapConnectionsByDestination`, `getConnected/Child/ParentNodes` | 969 calls |
| `C04` | adjacency, input/output edges, roots, leaves, `hasPath`, extractable selection | 271 calls |
| `C05` | `compareConnections` over corpus pairs | 6 pairs |
| `C06` | the compiled TypeScript twin == the committed ESM twin (anti-drift) | 12 graphs |
| `C07` | `packages/connection-lego/test/*.test.mjs` (boundary + graph analysis + facade integration + wrapper members) | 22/22 |
| `C08` | the Phase 5 facade consumes this port: `facade.connection` is the port module itself, `resolveExecutionPlan()`/`executeWorkflow()` match the oracle-derived order over the corpus, no inline duplicate remains | 12/12 plans + 1 execution order |
| `C09` | the two Workflow members carried for `runner.mjs` (`getNodeConnectionIndexes`, `getHighestNode` — owner LEGO 01, deviation `D-11`) match the real `n8n-workflow` `Workflow` class, including disabled nodes and connection sources that are not nodes | 686 calls |

The ESM twin is generated (`node tools/connection-isolation-extract.mjs --emit-esm`); editing it by
hand fails `C06`. Consumers (Phase 5 facade) import the TypeScript port directly and must expose it
**by reference** — a re-implementation, wrapper object, or declaration-order shortcut fails `C07`/`C08`. Error payloads of `parseExtractableSubgraphSelection` follow the reference exactly
(`{ errorCode, node }`, `{ errorCode, nodes }`, `{ errorCode, start, end }`).

## 8. Ownership

| Owns | Does NOT own |
|---|---|
| `IConnections` orientation semantics, sparse-slot rules | `Workflow` wrapper methods and map lifecycle |
| `common/*`, `graph/graph-utils.ts`, `connections-diff.ts` | declared port counts (`NodeHelpers`) |
| invariants 1–8 | runtime item routing, `executionOrder` v0/v1, `DirectedGraph`/`handleCycles` |
