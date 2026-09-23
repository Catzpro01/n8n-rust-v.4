# P3 Slice A — Persistent Logical Graph — Evidence (Issue #97, planning #75/#75/#76)

- **Slice:** A (marathon §30) — persistent logical graph · branch `feat/p3-persistent-graph`
- **Issues:** #97 (mandate), #75 (Unlimited Nodes), #91 (lossless reference for the oracle)
- **Baseline:** forked from protected main `dd19441a` (after the P3 preflight PR #102).

## §1 Deliverable

`apps/n8n-lego/src/lego/workflow-graph.mjs` — contract **`workflow.graph@0.1.0`**
(lock row **33** at **0.1.0** (R9: the `workflow` domain declares contract 0.1.0), owner `agent-1` per Issue #98, domain `workflow`, no
capability/REST surface by design):

- **Canonical stays authoritative (§6):** the module READS the canonical n8n
  definition and derives a disposable graph; input never mutated (asserted
  byte-identical); n8n-ts WorkflowStore remains the document store.
- **Chunked resident form:** nodes stored as verbatim JSON **strings** in
  fixed-size chunks (default 1024, manifest-recorded); connections bucketed by
  source node into the same chunk → partial reads address one chunk.
- **Index:** resident index is `name → ordinal` (integer), never name → node
  object; addressing scheme recorded in the manifest
  (`chunk=floor(o/size), offset=o%size`).
- **One-chunk discipline:** `getNode` / `getChunk` / `getOutgoingConnections`
  each increment `readStats().chunkReads` by exactly 1 — asserted on a
  3,000-node graph (lookup of the LAST node = 1 chunk read → no scan).
- **Durable bundle (persistence-ready):** `exportBundle` ⇄ `graphFromBundle`
  survives JSON wire serialization; import is **fail-closed** on chunk-digest
  mismatch (`integrity-mismatch`), bundle-version mismatch and node-count
  mismatch; `integrity()` re-verifies resident digest chunk-by-chunk.
- **Lossless (§7):** `exportDefinition` is `deepStrictEqual` to the original —
  including top-level header fields (settings/meta/pinData/active), orphan
  connection keys (`Ghost`) and connection payloads; manifest checksum =
  `calculateWorkflowChecksum` = the n8n-editor contract checksum (imported
  from `src/checksum.mjs`, unchanged); deep-equality holds after bundle
  roundtrip too.
- **Determinism:** two builds → deep-equal manifests (checksum + chunkDigest).
- **No artificial node ceiling (anti-pattern 13):** `WORKFLOW_GRAPH_LIMITS`
  has no `maxNodes`; 5,000-node build + indexed tail lookup asserted.
- **One error family:** `WorkflowGraphError`, code `lego.contract_violation`
  (published, errors contract 1.2.0 untouched); details carry `field`/`reason`
  only — no user values echoed.
- **Zero fs/network/clock** in the module (governed seam; persistence adapters
  arrive with later slices).

## §2 Governance edits (established patterns only)

- lock row 33 `workflow.graph`; count-pins **32 → 33** in 7 files (6 BE +
  FE34), each with a per-context P3 message (no blanket replacement);
- `domains.json#workflow.paths` += `src/lego/workflow-graph.mjs` (capabilities
  still 4, status still `partial`);
- `BACKEND_LEGO.md` changelog +1 line;
- `.ai` regenerated with `node tools/lego/ai-pack.mjs` before `--check`
  (64/37/101 in sync);
- test-authoring fixes during development were in the TEST (edge-count
  arithmetic; orphan-identity rule) — module semantics never bent, no test
  deleted.

## §3 Validation (this tree)

| gate / suite | result |
| :--- | :--- |
| `lego:arch` + selftest | PASS (33 contracts) |
| `lego:foundation` + selftest | PASS (F16: quoted code published) |
| `lego:capabilities` | PASS (23 REST features; no capability added) |
| `lego:scaleout` | PASS |
| `lego:ai:check` | OK 64/37/101 in sync |
| backend full suite | **898+17 tests · 895+17 pass · 3 fail = pre-existing rest.test 404s only** |
| frontend full suite | 419 · 418 pass · 0 fail · 1 skip (FE34 pin 33 green) |
| **Slice A suite** | **17/17 PASS** (`lego-workflow-graph.test.mjs`) |
| P2 regression slices | fail 0 |

Known pre-existing: `rest.test` 404 ×3 (documented since P2.22) — untouched.

## §4 Non-scope held (next slices)

No executor, no optimizer, no virtual-node layer, no node fusion/cache, no
checkpoint/resume yet, no file persistence adapter (bundle = durable form now),
no workflow/execution engine rewrite, no n8n-ts changes, no UI change, no
P2.27 expansion, no crates/Rust change. Next marathon slices: **B — index
(reverse adjacency + compact forms)**, C — lazy/virtualization, D — bounded
runtime, per §30 order.
