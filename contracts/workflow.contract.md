# LEGO Contract: Workflow Definition

| Field | Value |
| :--- | :--- |
| Owner | Agent 1 — Workflow Domain Engineer |
| LEGO | `workflow` — Workflow Model / DAG lifecycle |
| Status | Phase 2 — `ISOLATED`, self-verified 11/11; **Agent-5 verification pending** (`docs/isolation/workflow-handoff.md` §5) |
| Reference | n8n `2.9.4` — `reference/n8n`, upstream `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Reference source | `packages/workflow/src` — 10 owned modules, see `packages/workflow-lego/manifest/ownership.json` |
| Isolation record | `docs/isolation/workflow.md` · ports: `docs/isolation/workflow-port-contract.md` |
| Rust | **NOT STARTED** — Phase 2 forbids Rust. This document specifies the TypeScript reference behavior a future Rust LEGO must reproduce. |

## 1. Purpose

Own the in-memory structural model of a workflow and the pure algorithms over it: the node
collection, the connection maps, both adjacency indexes, graph traversal, node renaming,
static/pin-data access, workflow content checksum and connection diffing.

## 2. Data Schema

```typescript
interface WorkflowContract {
  id: string;
  name: string;
  nodes: NodeContract[];
  connections: Record<string, Record<string, ConnectionContract[][]>>;
  settings?: Record<string, any>;
  staticData?: Record<string, any>;
}
```

Runtime shape (observed, not aspirational):

| Fact | Evidence |
| :--- | :--- |
| The constructor accepts `nodes: INode[]` but immediately re-keys them into an object keyed by node **name** (`Workflow.nodes: INodes`). | `workflow.ts:50, 60, 138-143` |
| Two indexes are derived from one source: `connectionsBySourceNode` (as supplied) and `connectionsByDestinationNode` (`mapConnectionsByDestination`). | `workflow.ts:145-148` |
| `pinData` and `staticData` are stored separately from execution data; `staticData` is wrapped in `ObservableObject.create` with `ignoreEmptyOnFirstChild`. | `workflow.ts:126-130` |
| `timezone` is resolved once at construction and is `readonly`. | `workflow.ts:78, 132` |

## 3. Responsibilities

1. **Structural model** — node collection keyed by name; `getNode`, `getNodes`, `getPinDataOfNode`, `getStaticData`, `queryNodes`, `getTriggerNodes`, `getPollNodes`.
2. **Mutation** — `setNodes`, `setConnections`, `setPinData`, `setSettings`, `overrideStaticData`, `setTestStaticData`.
3. **Traversal** — `getChildNodes`, `getParentNodes`, `getConnectedNodes`, `getParentNodesByDepth`, `searchNodesBFS`, `getParentMainInputNode`, `getConnectionsBetweenNodes`, `getNodeConnectionIndexes`, `getHighestNode`.
4. **Start-node resolution** — `getStartNode`, `__getStartNode` (first trigger/poll node, skipping `disabled` nodes).
5. **Renaming** — `renameNode`, `renameNodeInParameterValue` (parameter rewriting delegated to LEGO 02 through ports).
6. **Content identity & diffing** — `calculateWorkflowChecksum`, `compareConnections`.

## 4. Non-responsibilities

| Not owned | Owner |
| :--- | :--- |
| Workflow execution, node scheduling, run data | `packages/core` — out of Phase-2 scope |
| Expression evaluation | expression runtime (`P-EXPRESSION-RUNTIME` port is **opaque**: the model stores `workflow.expression` and never calls it) |
| Node parameter defaults/output resolution | **LEGO 02 — Node Model** (`P-NODE-MODEL`, `P-NODE-RENAME`, `P-NODE-REFERENCE`) |
| Validation / enforcement of the invariants in §5 | **LEGO 04 — Validation**, and any enforcement there is a **NEW CAPABILITY**, not reference behavior |
| Persistence, HTTP, webhooks, scheduling, credentials | out of scope (no database/HTTP import exists in this LEGO) |
| Node-type registry | host input (`HostContext.nodeTypes`), not a LEGO seam |

## 5. Invariants — declared vs. enforced

**The three structural invariants below are DECLARATIONS OF INTENT. The n2n 2.9.4 reference does not
enforce any of them inside `packages/workflow/src`.** Measured evidence, so no consumer mistakes intent
for behavior:

| Invariant | Enforced by the reference? | Observed behavior | Evidence |
| :--- | :--- | :--- | :--- |
| `nodes`: unique node names | **NO** | `setNodes()` builds the name-keyed object without checking; a duplicate name silently **overwrites** the previous node (last one wins) | `workflow.ts:138-143`; `grep -rIn "unique\|duplicate" workflow.ts interfaces.ts` → 1 unrelated comment |
| `connections`: source/destination names exist in `nodes` | **NO** | no check, no error on load; lookups degrade gracefully — `getNode()` → `null`, `getNodes()` logs a `console.warn` and skips | `workflow.ts:301-303`, `workflow.ts:310-329` |
| graph is acyclic | **NO** | no cycle detection exists in the package: `grep -rIn cycle packages/workflow/src` → **2 hits, both the word "lifecycle"** (`execution-context.ts:96,118`). The only `detectCycles` in the whole reference tree is `packages/@n8n/workflow-sdk/src/codegen/graph-annotator.ts:16` — DFS over a `SemanticGraph`, in the SDK **codegen** package, not a workflow-model guard | see `ISSUE-003` response in `docs/isolation/workflow-handoff.md` §3.2 |
| `timezone` defaults from ambient global state when unset | **YES** (default applied) | `this.settings.timezone ?? getGlobalState().defaultTimezone` — reached only through the injectable port `P-KERNEL-CONFIG` | `workflow.ts:132` |

> Any LEGO that *does* implement uniqueness, dangling-connection or cycle checks must document them as
> new behavior. `contracts/validation.contract.md` §2 check 3 (`CycleDetection`) is subject to this rule
> and is tracked as `ISSUE-003`.

## 6. Dependencies (ports consumed)

Eleven declared ports, machine-checked by `node tools/workflow-port-surface.mjs --check`:
`P-KERNEL-TYPES`, `P-KERNEL-CONSTANTS`, `P-KERNEL-ERRORS`, `P-KERNEL-UTILS`, `P-KERNEL-OBSERVABLE`,
`P-KERNEL-CONFIG`, `P-NODE-MODEL`, `P-NODE-RENAME`, `P-NODE-REFERENCE`, `P-EXPRESSION-RUNTIME`,
`P-EXTERNAL-JSSHA`. Full table with signatures: `docs/isolation/workflow-port-contract.md`.

Cross-LEGO runtime edge of note: `workflow.ts:20 → expression` is **construction only**
(`new Expression(this)` at `workflow.ts:134`); no method call crosses that seam.

## 7. Error behavior

| Input | Behavior | Evidence |
| :--- | :--- | :--- |
| `getNode(unknownName)` | returns `null` — never throws | `workflow.ts:301-303` |
| `getNodes([...unknown])` | skips unknown names and writes `console.warn(\`Could not find a node with the name ${name} …\`)` — **observable side effect** | `workflow.ts:310-329` |
| `getPinDataOfNode(unknownName)` | returns `undefined` | `workflow.ts:331-333` |
| `getStartNode()` when nothing qualifies | returns `undefined` | `workflow.ts:867-891` |
| `renameNode(_, newName)` with a JS-prototype name (`hasOwnProperty`, `constructor`, `__proto__`, … 13 restricted keys) | throws `UserError('Node name "…" is a restricted name.')` | `workflow.ts:391-411` |
| `renameNode(currentName, newName)` when `newName` is already taken | **no collision check** — existing node object is replaced in the name-keyed map | `workflow.ts:413-417` |
| `getHighestNode(unknownName)` | **throws `TypeError`** — `this.nodes[nodeName].disabled` is dereferenced without a guard | `workflow.ts:500-504` |
| `calculateWorkflowChecksum` without WebCrypto | falls back to `P-EXTERNAL-JSSHA` | `workflow-checksum.ts` |

## 8. Lifecycle

* **Construction** — `new Workflow({ id, name, nodes, connections, active, nodeTypes, staticData, settings, pinData })`; nodes re-keyed, destination index built, `timezone` resolved, `expression` attached. (`workflow.ts:88-135`)
* **Import/edit** — setters replace whole maps (`setNodes`, `setConnections`) or individual fields; `setConnections` always re-derives the destination index. (`workflow.ts:145-158`)
* **Query** — traversal methods are pure reads over the two indexes; `getStartNode` is the entry point used by execution (out of this LEGO).
* **Rename** — node object is copied to the new key, `name` is updated, the old key is deleted, then parameter references are rewritten via ports. (`workflow.ts:413-490`)
* **Serialize** — `toJSON()` produces the persisted shape (`nodes` as an array, `connections`, `settings`, `staticData`, `pinData`); checksum is computed from this content. (`workflow.ts:136-137`, `workflow-checksum.ts`)

## 9. Data ownership

The LEGO owns the **in-memory** representation only. It does not read or write storage, does not own
execution data (`IRunExecutionData`), and does not own node-type definitions (registry is host input).
`staticData` is wrapped in an observable proxy so hosts can persist changes — the host owns persistence.

## 10. Compatibility requirements

1. Public surface is frozen at **15 symbols** (`packages/workflow-lego/src/model-surface.ts`,
   `manifest/ownership.json → publicSurface`, generated `.extract/dist/model-api.js` must agree).
2. Semantic behavior must be identical to n8n 2.9.4 — verified by
   `docs/isolation/evidence/model-digest.comparison.json`: **252/252 sections identical**, strict mode
   218 identical / 34 declared-port differences / **0 undeclared**.
3. Consumers may reach graph helpers and `compareConnections` only via their deep module paths
   (`graph/graph-utils`, `connections-diff`), never by adding new barrel exports.
4. Ambient state may enter only through `P-KERNEL-CONFIG`; `console` output in `getNodes()` is part of
   the observable behavior and must be preserved or explicitly modelled.
