# LEGO Isolation: Connection & Graph Traversal

**Status:** `TESTED` (analysis + boundary + reference tests vs. real `n8n-workflow@2.9.1`; live VPS not reachable from sandbox)
**Owner:** Agent 3 (LEGO `connection`)
**Task:** `tasks/TASK-301-connection.yaml`
**Closes:** `ISSUE-007` (missing `docs/isolation/connection.md`) — see `docs/isolation/CROSS-AGENT-ISSUES.md`
**Answers:** Agent 1 `MSG-02` (ownership of `graph/**` + `connections-diff`, `docs/isolation/workflow-handoff.md` §3.1)
**Reference:** n8n 2.9.4 (`reference/n8n`, commit `b6dc2787`)

## 0. Interfaces consumed from the VERIFIED Workflow LEGO (Agent 1)

Agent 1's frozen public surface (`docs/isolation/workflow-handoff.md` §2, 15 symbols, VERIFIED
11/11 live at `a092e00f`) is the **only** thing this LEGO consumes at runtime. No new barrel
exports, no internal reach-through.

| Consumed symbol | Surface group | How Connection uses it | Pinned by case |
|---|---|---|---|
| `Workflow.getNode(name)` → `INode \| null` | lookup | node-existence guard before routing queries (`getNodeConnectionIndexes` returns `undefined` when the parent is unknown); never throws (`workflow.contract.md` §"getNode(unknownName)") | 01, 02 |
| `getConnectedNodes(map, name, type, depth, checked?)` | graph | the single traversal primitive; `getChildNodes`/`getParentNodes` are 1-line wrappers over it | 01–04 |
| `getChildNodes`, `getParentNodes` | graph | orientation-specific wrappers | 01–04 |
| `mapConnectionsByDestination` | graph | inversion source→destination | 01, 02 |
| `buildAdjacencyList`, `getRootNodes`, `getLeafNodes`, `getInputEdges`, `getOutputEdges`, `hasPath`, `parseExtractableSubgraphSelection` | graph | subgraph analysis | 02–04 |
| `compareConnections` | content | connection diff | 05 |
| `Workflow.connectionsBySourceNode` / `connectionsByDestinationNode` | fields | read-only inputs to every function above | all |
| `Workflow.getNodeConnectionIndexes`, `getHighestNode`, `getStartNode`, `getParentMainInputNode`, `getParentNodesByDepth` | traversal / start node | **consumed, not owned** — behaviour pinned so a Phase-3 move is verifiable (C9–C11) | 01–04 |
| types `IConnection`, `IConnections`, `INodeConnection`, `NodeConnectionType(s)`, `IConnectionAdjacencyList`, `ExtractableErrorResult`, `ExtractableSubgraphData`, `ConnectionsDiff`, `INodeConnectionsDiff` | types | compile-time only | — |

Node-side inputs come from Agent 2's contract (`contracts/node.contract.md`): node **`name`** is the
primary reference key; declared port counts via `NodeHelpers.getNodeOutputs/getNodeInputs` (D-09).

### 0.1 Answer to MSG-02 — ownership of `graph/**` + `connections-diff`

Agent 1 measured both files as dependency-free leaves (type-only import of `interfaces`) and
offered Option A (Connection owns, Workflow re-exports via port `P-CONNECTION-GRAPH`) or Option B
(Workflow keeps, Connection consumes). Independent measurement here agrees
(`DEPENDENCY-GRAPH.md`: connection → interfaces TYPE-ONLY, 1 edge).

**Decision (Agent 3): Option A for Phase 3, Option B for the remainder of Phase 2.**

- Phase 2 (now): Connection *consumes* the 12 graph + 1 content symbols exactly as frozen by
  Agent 1 (§0 table). No re-extraction, no re-run of Agent 1's 11/11 gate, no manifest edit in
  `packages/workflow-lego/` (Agent 1's path).
- Phase 3: Connection takes ownership of `common/**` (traversal), `graph/graph-utils.ts` and
  `connections-diff.ts`; Workflow declares port `P-CONNECTION-GRAPH` and keeps `Workflow.*`
  wrappers. `LEGO-MASTER-MAP.md` already assigns these files to Connection, so this converges the
  master map and `ownership.json` without a Phase-2 change.
- Requires Agent 5 acknowledgement (recorded in `tasks/TASK-301-connection.yaml` → `send_message`).

---

### 0.2 Gate result

Agent 5 merged this LEGO into `main` (`da39a5b6`) and promoted the Connection row to **VERIFIED**
(`32eb5115`: contract-conformance 21/21, live VPS 11/11). `ISSUE-007` is closed for Connection.
Still open with Agent 1: `MSG-02` (ownership ACK for Option A) and defect `D-08`.

### 0.3 Phase-3 follow-up manifest

Option A is drafted (not executed) as `tasks/TASK-303-connection.yaml`, status `PROPOSED`. It lists the
exact 12 graph + 1 content symbols for port `P-CONNECTION-GRAPH`, the types that stay in the shared kernel,
and the gates that must be green first (Connection row TESTED, Agent 5 + Agent 1 ACK, live 11/11 re-runnable).

## 1. Purpose

Own the **edge model** of a workflow and the **pure functions** over it:

- `IConnections` (source-keyed adjacency) and its inversion (destination-keyed)
- traversal: children / parents / connected nodes per connection type, bounded depth
- subgraph analysis: adjacency list, roots, leaves, in/out edges, reachability, extractable-selection validation
- connection diffing between two workflow versions

It does **not** own node identity, execution routing of items, or cycle handling for partial execution (see §9).

## 2. Source files (allowed paths, all read; none modified)

| File | Exports | Lines |
|---|---|---|
| `packages/workflow/src/common/map-connections-by-destination.ts` | `mapConnectionsByDestination(connections)` | 49 |
| `common/get-connected-nodes.ts` | `getConnectedNodes(connections, nodeName, type='main'\|'ALL'\|'ALL_NON_MAIN', depth=-1, checked?)` | 98 |
| `common/get-parent-nodes.ts` | `getParentNodes(connectionsByDestination, …)` → `getConnectedNodes` | 18 |
| `common/get-child-nodes.ts` | `getChildNodes(connectionsBySource, …)` → `getConnectedNodes` | 12 |
| `common/get-node-by-name.ts` | `getNodeByName(nodes, name)` | 19 |
| `common/index.ts` | barrel (also published as `n8n-workflow/common`) | 5 |
| `graph/graph-utils.ts` | `buildAdjacencyList`, `getInputEdges`, `getOutputEdges`, `getRootNodes`, `getLeafNodes`, `hasPath`, `parseExtractableSubgraphSelection`, types `IConnectionAdjacencyList`, `ExtractableErrorResult`, `ExtractableSubgraphData` | 273 |
| `connections-diff.ts` | `compareConnections(prev, next)`, types `ConnectionsDiff`, `INodeConnectionsDiff` | 87 |

Shape definitions live in the **shared** `interfaces.ts` (read-only for this LEGO):

```ts
interface IConnection { node: string; type: NodeConnectionType; index: number; }   // L89
type NodeInputConnections = Array<IConnection[] | null>;                          // per source-output index
interface INodeConnections { [type: string]: NodeInputConnections; }               // L411
interface IConnections { [sourceNodeName: string]: INodeConnections; }             // L416
interface INodeConnection { sourceIndex: number; destinationIndex: number; }       // L406
const NodeConnectionTypes = { Main:'main', AiAgent:'ai_agent', AiChain, AiDocument, AiEmbedding,
  AiLanguageModel:'ai_languageModel', AiMemory, AiOutputParser, AiRetriever, AiReranker,
  AiTextSplitter, AiTool:'ai_tool', AiVectorStore } as const;                      // L2249
```

## 3. Data model

```text
connectionsBySourceNode[source][type][outputIndex]  = IConnection[]   (dest node, dest type, dest INPUT index)
connectionsByDestinationNode[dest][type][inputIndex] = IConnection[]  (src node,  src type,  src OUTPUT index)
```

- Both are keyed by node **name**.
- Output slots may be sparse: `[]` or `null` are valid entries (`Sparse.main = [[], null, [...]]` observed).
- The "error" output of a node with `onError: 'continueErrorOutput'` is just the **last `main` output index** (`NodeHelpers.getNodeOutputs` appends `{category:'error', type:'main'}`); the connection model has no special error type.

## 4. Inputs / Outputs

| Function | Input | Output |
|---|---|---|
| `mapConnectionsByDestination` | `IConnections` (by source) | `IConnections` (by destination); missing dest indexes padded with `[]` |
| `getChildNodes` / `getParentNodes` / `getConnectedNodes` | adjacency, node name, type filter, depth | `string[]` of node names, **farthest-first** order, deduplicated, `[]` for unknown node |
| `buildAdjacencyList` | `IConnections` | `Map<source, Set<IConnection>>` (all types) |
| `getRootNodes` / `getLeafNodes` | selection `Set<string>`, adjacency list | `Set<string>` – **`main` edges only**, self-loops ignored |
| `getInputEdges` / `getOutputEdges` | selection, adjacency list | `Array<[fromNode, IConnection]>` – all types |
| `hasPath` | start, end, adjacency list | boolean, `main` only, cycle-safe (`seen`) |
| `parseExtractableSubgraphSelection` | selection, adjacency list | `{start?, end?}` or `ExtractableErrorResult[]` |
| `compareConnections` | prev, next `IConnections` | `{ added, removed }` keyed `[source][type] → { sourceIndex, value:{ index, connection } }[]` |

## 5. Invariants (observed, `tests/reference/connection/*`)

| # | Invariant | Case |
|---|---|---|
| C1 | Inversion is exact: `byDest[d][t][i]` contains `{node:s, type:t, index:o}` iff `bySrc[s][t][o]` contains `{node:d, type:t, index:i}` | 01, 02 |
| C2 | Destination arrays are padded with `[]` up to the highest referenced input index | 02 (`End.main[1] === []`) |
| C3 | Traversal returns each node once, farthest ancestor/descendant first; `depth` bounds hops; unknown node ⇒ `[]` | 01, 02 |
| C4 | Type filter: exact type, `'ALL'` (union), `'ALL_NON_MAIN'` (union minus `main`) | 03 |
| C5 | **Cycles are legal.** No function throws or loops forever on `Merge ⇄ Loop`; traversal, `getNodeConnectionIndexes`, `getHighestNode`, `hasPath` all terminate via visited sets | 04 |
| C6 | Graph utils (`roots/leaves/hasPath/extractable`) consider **`main` edges only**; AI sub-node edges are invisible to them | 03, 04 |
| C7 | `parseExtractableSubgraphSelection` errors: `Input Edge To Non-Root Node`, `Multiple Input Nodes`, `Output Edge From Non-Leaf Node`, `Multiple Output Nodes`, `No Continuous Path From Root To Leaf In Selection`; a loop back into the single input node is tolerated | 04 |
| C8 | `compareConnections` matches connections by JSON identity (`{node,type,index}`), reports per `sourceIndex`; whole-node removal appears as removals of each edge | 05 |
| C9 | `Workflow.getNodeConnectionIndexes(node, parent, type='main')` is a BFS over `byDest`; returns the **first** `{sourceIndex, destinationIndex}` found (not necessarily unique when multiple paths exist), `undefined` when unreachable or parent unknown | 01, 02, 04 |
| C10 | `Workflow.getHighestNode(name)` returns all `main`-ancestors without incoming `main` connections (several possible); `getStartNode` picks among them by node-type (`inputs.length === 0` preferred) | 01, 04 |
| C11 | Sub-nodes (only non-main outputs) resolve `getParentMainInputNode` to themselves when they have no main child | 03 |

## 6. Runtime observations that contradict existing docs/contracts

1. **The original `contracts/connection.contract.md` stated "Graph must be acyclic".** Source shows the opposite: nothing in `n8n-workflow` validates acyclicity; loops are a supported pattern (`Loop Over Items`, `Merge ⇄ Loop`). Cycle *handling* (`DirectedGraph.getStronglyConnectedComponents`, `handleCycles`) exists only for **partial** executions in `packages/core/src/execution-engine/partial-execution-utils/` – a forbidden path for this LEGO. This independently confirms Agent 1's `ISSUE-003` finding (`workflow.contract.md` §5 row "graph is acyclic → NO"; `workflow-handoff.md` §3.2). The connection contract has been corrected (§3.6) and aligns with Agent 1: acyclicity is a *declared intent*, enforcement (if any) is a **NEW CAPABILITY** for Agent 4, not reference behaviour.
2. **`Workflow.renameNode` updates `connectionsBySourceNode` in place but does NOT rebuild `connectionsByDestinationNode`** (`workflow.ts` L456-484; observed: after rename, `byDest.B` still points to the old name). This is Agent 1's file → reported in `dependencies.md` D-08, not fixed here.
3. **No topological sort exists in `n8n-workflow`.** Execution order is derived at runtime by `WorkflowExecute` (stack + `executionOrder` v0/v1 setting) and by `DirectedGraph` in core. "Implement topological sort" from the role brief is therefore **not** a port of existing behaviour; recorded as UNKNOWN/NOT-IN-REFERENCE rather than invented.

## 7. Dependencies

| Direction | Target | What | Owner |
|---|---|---|---|
| Connection → Node Model | node **name** as key; `NodeHelpers.getNodeOutputs/getNodeInputs/getConnectionTypes` for declared port counts (incl. extra error output) | index validation (contract §2) | Agent 2 (D-09) |
| Connection → Workflow | `Workflow` builds both maps (`workflow.ts` L146-147), exposes `getChildNodes/getParentNodes/getConnectedNodes/getNodeConnectionIndexes/getHighestNode/getStartNode/getParentMainInputNode/getParentNodesByDepth`, and mutates maps in `renameNode` | wrapper + ownership of instances | Agent 1 (D-08) |
| Connection → shared `interfaces.ts` | `IConnection`, `IConnections`, `NodeConnectionTypes` | type source | shared |
| Consumers of Connection | `Workflow` (Agent 1), `WorkflowDataProxy` default-branch/pairing legality (Expression), `WorkflowExecute` routing (`main[outputIndex]` → child input), editor-ui canvas & extract-subworkflow, `workflow-diff.ts` (`compareConnections`), `partial-execution-utils/DirectedGraph` (own adjacency built from `IConnections`) | | |

## 8. Owns

- Shape semantics of `IConnections` in both orientations (name-keyed, sparse slots allowed)
- `mapConnectionsByDestination`, `getConnectedNodes`, `getChildNodes`, `getParentNodes`, `getNodeByName`
- `graph/graph-utils.ts` (adjacency list, roots/leaves, edges, `hasPath`, extractable-subgraph validation)
- `connections-diff.ts`
- Invariants C1–C8 as contract

## 9. Does NOT own

- ❌ `Workflow` class methods that wrap these (`getNodeConnectionIndexes`, `getHighestNode`, `getStartNode`, `getParentMainInputNode`, `renameNode`) – Agent 1; C9–C11 are documented as *consumed* behaviour
- ❌ `NodeHelpers.getNodeOutputs/getNodeInputs` (declared ports, error output) – Agent 2
- ❌ Item routing at runtime (`WorkflowExecute.addNodeToBeExecuted`, `executionOrder` v0/v1) – engine
- ❌ `DirectedGraph`, `handleCycles`, `findSubgraph`, `findStartNodes` – `packages/core` (forbidden)
- ❌ Cycle detection / topological sort as a validation step – **does not exist in 2.9.4**

## 10. Boundary

```text
            shared interfaces.ts (IConnection, IConnections, NodeConnectionTypes)
                                   │ read-only
┌──────────────────────────────────▼───────────────────────────────┐
│ CONNECTION LEGO  (pure functions, no state, no node metadata)    │
│  common/*  graph/graph-utils.ts  connections-diff.ts             │
└──────┬───────────────────────┬──────────────────────┬────────────┘
       │                       │                      │
  Workflow (Agent 1)     WorkflowDataProxy       partial-execution-utils / WorkflowExecute
  builds+wraps maps      (Expression LEGO)       (engine, forbidden – builds own DirectedGraph)
```

**Kept together (not forced apart):** `getNodeConnectionIndexes` is conceptually a connection query but is implemented as a `Workflow` method over `connectionsByDestinationNode` (performance-tuned BFS). Extracting it would touch `workflow.ts`. It stays with Agent 1; its behaviour is pinned by cases 01/02/04 so a later move is verifiable.

**No source files modified.**

## 11. Verification

| Check | Result |
|---|---|
| `node tests/reference/harness/run.js connection` | 5/5 PASS |
| Consistency with Agent 1 frozen surface (`workflow-handoff.md` §2) | all consumed symbols are in the 15-symbol surface; none added |
| `ISSUE-003` alignment | identical conclusion reached independently from source + runtime |
| full harness (`execution-data` + `expression` + `connection`) | 18/18 PASS |
| `git diff -- reference/n8n` | empty → 11/11 baseline unaffected |
| Live VPS | unreachable from sandbox → status `TESTED` |

## 12. Phase 3 gate — differential verification of the routing engine (P-CONNECTION-GRAPH)

The Phase-3 takeover (`da1654a8`) implemented the routing engine in
`packages/reconstructed-engine/src/connection-routing-engine.ts` (+ a hand-written ESM twin that
`runner.mjs` imports) and declared `extract` / `verify` scripts — but the two referenced tools did
not exist, so nothing independently checked the "1:1 dari n8n 2.9.4" claim. That gate now exists:

```bash
npm run connection:check     # tools/connection-isolation-gate.mjs → C01..C07
```

The gate executes the reference oracle (`n8n-workflow@2.9.1` — the exact n8n 2.9.4 dependency set)
and the candidate engine over a 12-graph corpus (linear, fan-out, sparse slots, multi-type, cycle,
self-loop, dangling, diamond, depth chain, empty, external input edge, loop-back selection) and
compares **1,246 call results**: traversal order matters, so arrays are compared verbatim.

### 12.1 What the first run found (before)

| Check | Verdict at `da1654a8` |
|---|---|
| `C01` declared surface | **FAIL** — `getInputEdges`, `getOutputEdges` declared in the manifest but not implemented in the ESM twin |
| `C03` traversal (969 calls) | PASS — `mapConnectionsByDestination`, `getConnected/Child/ParentNodes` were already reference-exact |
| `C04` graph analysis (223 calls) | **FAIL — 35 divergences**, first: `buildAdjacencyList` invented empty destination keys (`['C', []]`) |
| `C05` connection diff (6 pairs) | PASS |
| `C06` twin parity | **FAIL — 20 divergences**: the TypeScript source and the ESM twin had already drifted (the TS twin has the edge helpers, the ESM twin does not) |

Two semantic divergences mattered beyond the shape:

1. **`getRootNodes` used every source in the adjacency map**, including nodes outside the selection.
   The reference only marks a node inner when an edge *from a node inside the selection* points at
   it, so a selection that receives an external `main` edge (case `G11-external-input`) got the wrong
   root set — which then changed `parseExtractableSubgraphSelection` verdicts.
2. **`parseExtractableSubgraphSelection` returned `{start, end}` for any 1-root/1-leaf selection**,
   while the reference only yields `start`/`end` for nodes that are simultaneously a root **and** an
   input node (resp. leaf **and** output node); everything else is `{ start: undefined, end: undefined }`.

### 12.2 What changed

- `connection-routing-engine.ts` is now a reference-exact port of `graph/graph-utils.ts`
  (helpers `union`/`intersection`/`difference` included, same iteration order and error payloads).
- The ESM twin is **generated** from the TypeScript source:
  `node tools/connection-isolation-extract.mjs --emit-esm`; `C06` fails if the two drift again.
- `getInputEdges` / `getOutputEdges` are implemented (edge-leading-in / edge-leading-out of a
  selection, all connection types, exactly like the reference).

### 12.3 After

| Check | Verdict |
|---|---|
| `C01` declared surface | PASS — 13 symbols in reference **and** candidate |
| `C02` boundary (candidate imports nothing) | PASS |
| `C03` traversal | PASS — 969/969 identical |
| `C04` graph analysis | PASS — 271/271 identical |
| `C05` connection diff | PASS — 6/6 pairs identical |
| `C06` twin parity (TS vs generated ESM) | PASS — 12 graphs |
| `C07` unit suite (`packages/connection-lego/test`) | PASS — 20/20 (5 boundary + 8 graph-analysis + 7 facade integration) |
| **Total** | **1,246 differential calls, 0 divergences** |

Evidence: `docs/isolation/evidence/connection-lego-gate.json`.

## 13. Phase 5 — the facade consumes the port (INTEGRATED)

Phase 5 shipped `packages/reconstructed-engine/src/n8n-reconstructed-facade.ts` as the single
production entry point ("12 LEGO unified"), but connection was only *decorative* there: the file
carried its own `class InternalConnectionEngine` with a hand-written `mapConnectionsByDestination`,
and the value it computed was never used — `executeWorkflow()` returned results in **declaration
order**, and the integration suite tested a `TestFacade` clone rather than the facade itself.

### 13.1 What changed

| Before | After |
|---|---|
| `InternalConnectionEngine` inline copy (drifted shape: `{node, type, index}` without preserving slot semantics) | deleted; the facade imports the verified port `import * as connectionPort from './connection-routing-engine.ts'` |
| connection data unused | `facade.connection` **is** the port module (same function objects, no wrapper) |
| results in declaration order | `resolveExecutionPlan()` (depth-first from every root, outgoing `main` connections in output-index order, each node once; unreachable nodes appended in declaration order) + `executeWorkflow()` returns `data` and `executionOrder` in that plan |
| `test-integration.mjs` exercised a copy | `test/03-facade-integration.test.mjs` imports the real facade (Node ≥ 22.18 type stripping) and is enforced by `C07` |

### 13.2 New gate check `C08`

`C08` re-computes the expected plan for all 12 corpus graphs **using the oracle only**
(`buildAdjacencyList` + `getRootNodes` + `getLeafNodes` from `n8n-workflow@2.9.1`, with an
independently written traversal), compares it to `facade.resolveExecutionPlan()`, performs the port
identity check, rejects an inline engine in the source, and runs one `executeWorkflow()` whose nodes
are declared in **reverse** order so declaration order cannot mask a broken wiring.

Negative controls (temporarily injected, gate caught each, then reverted):

| Injected defect | Caught by |
|---|---|
| `executeWorkflow` schedules in declaration order | `C08` — `facade.executeWorkflow order ["C","B","A"] ≠ oracle ["A","B","C"]` (and `C07`) |
| `facade.connection` wraps the port in a copy | `C07` — the port must be exposed by reference |
| (earlier) ESM twin left un-regenerated after a TS edit | `C06` — 20 twin divergences |

Evidence: `docs/isolation/evidence/connection-lego-gate.json` (`phase: phase-3+5-connection`).
