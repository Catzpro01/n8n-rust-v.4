# Node LEGO — Validation of Interfaces Consumed from Agent 1 (Workflow)

**Author:** Agent 2 · **Date:** 2026-09-17 · **Reference:** `n8n@2.9.4` @ `b6dc2787`
**Scope:** responsibility #3 of `agent-2` — validate proposed interfaces from Agent 1
(`getNode`, `getConnectedNodes`) against actual n8n source behavior.
**Writes confined to:** `docs/isolation/node*` (all reads were read-only).

---

## 1. Interfaces proposed by Agent 1

From `docs/isolation/workflow.md` (main @ `82be4146`, §2) the Workflow LEGO exposes
graph-traversal methods incl. `getNode`, `getParentNodes`, `getChildNodes`, `getStartNode`;
role manifest for Agent 2 names `getNode` and `getConnectedNodes` for validation.

## 2. Actual source behavior (verified at tag `n8n@2.9.4`)

### 2.1 `Workflow.getNode`

`reference/n8n/packages/workflow/src/workflow.ts:301`

```ts
getNode(nodeName: string): INode | null {
	return this.nodes[nodeName] ?? null;
}
```

* Keyed by **node name**, not id. Missing name → `null` (never throws).
* Return type uses the Node Model's `INode` (contract §2) — shape verified.

Sibling `getNodes(nodeNames: string[]): INode[]` (workflow.ts:~309) silently drops
unknown names — returned array may be shorter than input.

### 2.2 `Workflow.getConnectedNodes`

`reference/n8n/packages/workflow/src/workflow.ts:605` — a thin method delegating to the
exported pure function `reference/n8n/packages/workflow/src/common/get-connected-nodes.ts:11`:

```ts
getConnectedNodes(
	connections: IConnections,
	nodeName: string,
	connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
	depth = -1,
	checkedNodesIncoming?: string[],
): string[]
```

Semantics verified from source:

* Consumes **Node Model types** `IConnections` and `NodeConnectionType` (both exported by
  the `node-model` barrel — contract §6).
* Defaults: connectionType = `main`; `depth = -1` = unlimited; `depth = 0` → `[]`.
* Returns **node names** (`string[]`), not `INode` instances.
* Unknown `nodeName` (absent in `connections`) → `[]`.
* Exclusive helpers `getParentNodes`/`getChildNodes` (`common/get-parent-nodes.ts`,
  `common/get-child-nodes.ts`) wrap the same function with pre-mapped adjacency.

## 3. Validation verdict (Node Model perspective)

| Interface | Verdict | Notes |
|---|---|---|
| `getNode(name): INode \| null` | ✅ VALID | Return type is Node-contract `INode`. Consumers (execution, NodeHelpers-adjacent flows) must handle `null`; contract updated to state this explicitly. |
| `getConnectedNodes(connections, nodeName, type?, depth?, checked?): string[]` | ✅ VALID | Both parameter types (`IConnections`, `NodeConnectionType`) and the `'ALL'/'ALL_NON_MAIN'` extension cases are owned/declared in `contracts/node.contract.md` §6. Name-based returns rely on Agent-1 invariant "unique node names" — consistent with Node Model (`INode.name` is the reference key). |
| `getParentNodes`/`getChildNodes` | ✅ VALID (bonus) | Same type basis as `getConnectedNodes`; declared here for completeness. |

**No behavior change requested.** These signatures match source; Node LEGO contract §11
formally declares them as *consumed* interfaces (CONTRACT FIRST rule).

## 4. Coordination notes

1. Agent 1's scaffold `contracts/workflow.contract.md` does not yet declare these methods
   nor the consumed types `IConnections`/`NodeConnectionType`. Per rule 4, Agent 1 should
   add: consumed-from-node = `{ IConnections, NodeConnectionType, INode }`, provided =
   `getNode`, `getNodes`, `getConnectedNodes`, `getParentNodes`, `getChildNodes`,
   `getStartNode` (with the null/empty semantics above).
2. `depth` semantics (`-1` unlimited, `0` none) and default `connectionType = main` are
   relied upon by execution code — stable public behavior, do not tighten defaults.
3. All traversal keys are node **names**; any future switch to id-keyed lookups is a
   breaking change across both contracts and must be coordinated.
