# P3 Slice B — Indexed Node/Edge Access — Evidence (Issue #97, planning #75)

- **Slice:** B — indexed edge access on `workflow.graph` · branch `feat/p3-graph-index`
- **Baseline:** protected main `ef751c5b` (Slice A merged, PR #110).
- **Contract delta:** NONE to the lock — module export set unchanged
  (`workflow.graph@0.1.0` row 33 stands); new capability lives on the graph
  object returned by `createWorkflowGraph`, evolving the same slice file.

## §1 Deliverable

Lazy **reverse edge index** added to `apps/n8n-lego/src/lego/workflow-graph.mjs`:

- `getIncoming(name)` — indexed dest → `[{source, type, index}]` where `index`
  = which output bundle (`main[k]`) produced the edge; deterministic order
  (chunk order × declaration order); rows + arrays **frozen**;
- **Lazy:** not built at construction (asserted `hasReverseIndex()===false`,
  `readStats===0`); first `getIncoming` materializes by reading each **non-empty
  edge bucket exactly once** (asserted equal to `edgeChunks.filter(≠'')`);
  subsequent lookups are **pure index hits — 0 chunk reads** (asserted);
- **Derived + droppable:** `releaseReverseIndex()` evicts (evict →
  rematerialize residency primitive); the index **never rides the durable
  bundle** (asserted absent from `exportBundle` keys); bundle roundtrip starts
  without it and rebuilds on demand;
- **Identity rule:** connection targets that are not graph nodes (dangling)
  are **never indexed** (`hasNode('Dangling')===false`), while the canonical
  connections payload still roundtrips losslessly (asserted deep-equal);
  unknown dest refuses with `unknown-node` (same family as `getNode`).

## §2 Validation

| gate / suite | result |
| :--- | :--- |
| 7 gates (arch, arch:selftest, foundation, foundation:selftest, capabilities, scaleout, ai:check) | PASS |
| backend full suite | 912 pass · 3 fail = pre-existing rest.test 404s only |
| frontend full suite | 418 pass · 0 fail · 1 skip |
| `lego-workflow-graph.test.mjs` | **21/21 PASS** (17 A + 4 B) |
| P2.16–P2.26 regression | fail 0 |

Test-authoring fixes during development: empty-bucket read arithmetic
(non-empty buckets only — honest reads) and `Set B` edge index = output-bundle
position 1. No test deleted; module semantics never bent.

## §3 Non-scope held

No executor, no fusion/cache, no checkpoint, no persistence adapter, no
engine/n8n-ts/UI change, no new lock row (no count-pin churn), no P2.27
expansion. Next per §30: **Slice C — lazy/virtualization**.
