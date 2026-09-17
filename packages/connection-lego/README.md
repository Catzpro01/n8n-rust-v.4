# @lego/connection — Connection Model LEGO

Phase 3 structural isolation of connection routing & graph traversal from
`reference/n8n/packages/workflow` (n8n 2.9.4).

**Isolated ≠ replaced.** The boundary is real and enforced; the running
implementation is still the pinned reference runtime. Rust implementation NOT STARTED.

## What is in the box

| path | role |
| :--- | :--- |
| `manifest/ownership.json` | single source of truth: what Connection owns, ports, public surface |
| `src/ports/` | declared outer boundary: contracts + port definitions |
| `src/adapters/reference/` | binds ports to pinned reference runtime `n8n-workflow@2.9.1` |
| `src/adapters/strict/` | standalone port implementations (no reference runtime) |
| `src/model-surface.ts` | public surface — seam a replacement must implement |
| `src/kernel/snapshots.ts` | kernel constants (drift-checked) |
| `test/` | isolation tests (boundary, extraction, equivalence, strict, surface parity) |

## Ownership (Phase 3 — Option A)

Per `docs/isolation/workflow-handoff.md` §3.1 and `TASK-303-connection.yaml`,
Connection now **owns**:

- `graph/graph-utils.ts` — adjacency list, roots/leaves, edges, hasPath, extractable-subgraph validation
- `connections-diff.ts` — connection diffing
- `common/*` — traversal primitives (getConnectedNodes, getChildNodes, getParentNodes, mapConnectionsByDestination, getNodeByName) — *candidate for P-CONNECTION-TRAVERSAL, currently consumed from Workflow for runtime safety*

Workflow re-exports these via port `P-CONNECTION-GRAPH` to keep 6318 external import sites stable.

## Commands

```bash
npm run build       # extract isolated unit + TS build
npm run typecheck   # typecheck ports/adapters/facade
npm test            # isolation tests
npm run verify      # full gate verification
```

## Invariants (from contracts/connection.contract.md)

1. Node references by name; unknown names → []/undefined (pure functions never throw)
2. Sparse slots ([], null) valid and preserved; destination map pads missing indexes with []
3. Inversion lossless and exact
4. Traversal deduplicated, farthest-first, depth-bounded, terminates on cycles
5. Cycles are legal (Loop nodes) — no acyclicity validation in n8n-workflow
6. Graph utils (roots/leaves/hasPath/extractable) evaluate main edges only
7. compareConnections identity = JSON of {node,type,index}
8. All functions pure (no mutation) — exception: Workflow.renameNode mutates source map in place (D-08)

## Not done

- No Rust code.
- No changes to reference/n8n/** (hash-verified).
- Workflow wrapper methods (getNodeConnectionIndexes, getHighestNode, etc.) stay with Agent 1 per CD-04.
