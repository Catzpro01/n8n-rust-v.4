# Connection Model LEGO — Phase 3 reconstruction

A Node.js/TypeScript reconstruction of the n8n **2.9.4** connection routing code, written 1:1
from the pinned reference source and accepted by reference-recorded golden cases.

This package is on the JavaScript/TypeScript reconstruction track opened by
`docs/isolation/PHASE-3-OPENING-RECORD.md` (the separate Rust port track stays confined to
`crates/**` + `apps/**`). Phase 2 delivered the Connection boundary and contract; this delivers
code that sits behind them — the `IMPLEMENTED → VERIFIED` steps of the LEGO cycle
(`PROJECT_RULES.md`: `DISCOVERED → ISOLATED → CONTRACTED → IMPLEMENTED (NODE.JS/TS) → VERIFIED →
INTEGRATED`). Sibling Phase-3 packages: `packages/execution-engine/`,
`packages/expression-lego/`.

| Field | Value |
| :--- | :--- |
| Reference | n8n `2.9.4`, commit `b6dc2787c45677a29a9612cd27eb911302961a83` |
| Contract | `contracts/connection.contract.md` (§7 ownership) |
| Isolation blueprint | `docs/isolation/connection.md` |
| Acceptance set | `tests/reference/workflow-rust/fixtures.json` + `tests/reference/connection/01..05/expected.json` |
| Result | **52/52 tests pass** — 15 fixture cases + 32 golden probes + provenance, coverage and 2 negative controls |

## What is reconstructed

| file here | reference source | lines |
| :--- | :--- | ---: |
| `src/interfaces.ts` | `interfaces.ts` (type-only subset — CD-07) | — |
| `src/get-node-by-name.ts` | `common/get-node-by-name.ts` | 19 |
| `src/get-connected-nodes.ts` | `common/get-connected-nodes.ts` | 98 |
| `src/get-child-nodes.ts` | `common/get-child-nodes.ts` | 12 |
| `src/get-parent-nodes.ts` | `common/get-parent-nodes.ts` | 18 |
| `src/map-connections-by-destination.ts` | `common/map-connections-by-destination.ts` | 49 |
| `src/graph-utils.ts` | `graph/graph-utils.ts` | 273 |
| `src/connections-diff.ts` | `connections-diff.ts` | 100 |

Out of scope by ownership (`contracts/connection.contract.md` §7): the `Workflow` aggregate and
its methods (`getNodeConnectionIndexes`, `getHighestNode`, `getStartNode`,
`getParentMainInputNode`, `getParentNodesByDepth`) belong to LEGO 01, and declared port counts
belong to LEGO 02. The 14 `wf.*` probes in the golden files are counted and skipped, not
silently ignored.

## Reference quirks reproduced on purpose

The contract forbids a reconstruction from "fixing" observed reference behaviour. Each of these
is asserted, not assumed:

- **Traversal order is `unshift` + de-duplicating `splice`**, producing "farthest first"
  (`default-main-depth-unlimited` → `["D","C","B"]`). A sorted or BFS-appended order fails.
- **`for (i = addNodes.length; i--; i > 0)`** — the third expression is a no-op in the
  reference and is kept verbatim.
- **`depth = 0` → `[]`, `depth = -1` → unlimited**, because the decrement happens before the
  guard.
- **`renameNode` does not rebuild the destination index** (defect **D-08**). `getParentNodes`
  reads the destination map, which is what makes the staleness observable.
- **`compareConnections` compares each slot as a set keyed by `JSON.stringify`** — reordering
  inside a slot is not a change, moving between slots is a removal plus an addition.
- **`buildAdjacencyList` keys a `Set` by object identity**, so structurally equal connections
  from different slots are both kept.
- **Root/leaf/path analysis filters on `type === 'main'`**, making `ai_*` edges invisible.
- **A node named `__proto__` never becomes an own key**, so `getNodeByName` cannot return it.

## Run it

```bash
npm install --prefix packages/connection-lego
npm --prefix packages/connection-lego test        # tsc build + 52 assertions
npm --prefix packages/connection-lego run typecheck

# prove the acceptance set still matches the pinned reference runtime
scripts/setup-reference-runtime.sh
node tests/reference/workflow-rust/build-fixtures.mjs --check
```

Or from the repository root: `npm run connection-lego:test`.

## Why the tests can be trusted

The suite contains two **negative controls** that assert a plausible-but-wrong implementation
does *not* satisfy the oracle:

1. a BFS/append traversal order — rejected by `default-main-depth-unlimited`;
2. a positional (index-by-index) connection diff — rejected by `slot-shifted`.

If either control ever passes, the oracle has stopped discriminating and the suite is worthless;
both currently fail as intended.
