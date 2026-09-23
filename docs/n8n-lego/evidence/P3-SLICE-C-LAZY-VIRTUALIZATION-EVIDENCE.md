# P3 Slice C — Lazy Materialization / Virtualization — Evidence (Issue #97, planning #75)

- **Milestone:** P3.2 (mapping recorded on Issue #97) · **Slice:** C — store port + bounded HOT cache + lifecycle/residency (marathon §30, Verification Gate Amendment)
- **Branch:** `feat/p3-lazy-virtualization`
- **Baseline (frozen):** protected main `454ef1d3ea65eec7bf3ec8dd074529d5790ab4a6` (= origin/main after Slice B, PR #112; open PRs `[]` at fork time)
- **Slice boundary (exactly one coherent boundary):** materialization control of the logical graph — store port (memory/lazy), bounded HOT cache `maxCachedChunks`, residency HOT/WARM/COLD, `evictChunk` / `residencyOf` / `cacheStats`, `GRAPH_NODE_LIFECYCLE` + `lifecycleOf`, measured working-set. NOT execution runtime, NOT fs persistence, NOT tiering policy beyond the two ports.

## §1 Deliverable

`apps/n8n-lego/src/lego/workflow-graph.mjs` (same contract row, **additive exports**):

- **Store port (internal seam):** every payload read goes through `readNodeChunk/readEdgeChunk/isResident/evict/stats` — never direct array access.
  - `memory` (default): raw chunks always WARM = the exact Slice A baseline footprint; no cold tier (`evict` declines — honest, no fictional COLD);
  - `lazy`: raw chunks load from the immutable source into a resident window bounded by the SAME `maxCachedChunks` knob; window misses evict back to **COLD** (future persistence adapter swaps `source` for a file-backed medium behind the same port — no contract change).
- **Bounded HOT cache:** LRU of the PARSED payload, bound `maxCachedChunks` (default `GRAPH_HOT_CACHE_DEFAULT_CHUNKS = 8`, validated 0..65536, `0` disables). Peak resident parsed chunks never exceed the bound regardless of logical size (asserted on 63-chunk and 79-chunk walks; LRU invariant `evictions = misses − bound` asserted exactly).
- **Residency API:** `residencyOf(i)` → `HOT` (parsed resident) / `WARM` (raw resident) / `COLD` (source only). `evictChunk(i)` drops HOT (+ window entry on the lazy port), returns whether anything dropped, idempotent-safe. `cacheStats()` reports `{maxCachedChunks, hot, hits, misses, evictions, storeKind, storeResident, storeLoads, storeEvictions}` frozen.
- **Lifecycle:** export `GRAPH_NODE_LIFECYCLE` = DECLARED→INDEXED→RESOLVED→MATERIALIZED→READY→EXECUTING→COMMITTED→EVICTABLE→EVICTED (frozen, exact order asserted). `lifecycleOf(name)` derives the current stage from chunk residency: HOT→MATERIALIZED · re-read warm→RESOLVED · cold never-evicted→INDEXED · explicit evict→EVICTED until next payload read. READY/EXECUTING/COMMITTED reserved for executor slices (declared, not faked).
- **Lossless virtualization (chunk granularity):** a COLD node keeps full identity (`hasNode` answers from the index with 0 payload resident); payload materializes on demand; `exportDefinition` is a SOURCE-level full read — deep-equal + n8n checksum survive arbitrary load/evict/reload churn (asserted on sample + 5,000-node graphs). Accessor payloads are **frozen** (shared immutable resident state; mutation attempt refused — asserted).
- **Unchanged invariants:** one-chunk logical read discipline (`readStats.chunkReads` counts logical reads including HOT hits), reverse index semantics (Slice B tests untouched, still green), fail-closed bundle digest, no node ceiling, one error family (new validations: `maxCachedChunks`, `lazy` fields), zero fs/network/clock.

## §2 Governance edits

- lock row 33 `workflow.graph@0.1.0`: **exports 8 → 11** (+`GRAPH_HOT_CACHE_DEFAULT_CHUNKS`, `GRAPH_NODE_LIFECYCLE`, `GRAPH_RESIDENCY`), notes += Slice C; version stays 0.1.0 (additive, pre-1.0; R9 harmony with domain 0.1.0 preserved). **Row count still 33 → zero count-pin churn** (7 pin files untouched).
- `BACKEND_LEGO.md` changelog +1 line (Slice C, above Slice A).
- `domains.json` untouched (same surface file; capabilities 4; status `partial`).
- `.ai`: `lego:ai:check` PASS without regen (row set unchanged → artifacts in sync; 64/37/101).
- Test edits: import + lock-parity map extended to the real 11 exports (parity now stronger, `locked.length === 11` pinned); section H = 8 new tests. No test deleted/weakened/renumbered.

## §3 Validation (this tree)

| gate / suite | result |
| :--- | :--- |
| Focused suite `lego-workflow-graph.test.mjs` | **29/29 PASS** (21 A/B + 8 C) |
| 7 gates (arch, arch:selftest, foundation, foundation:selftest, capabilities, scaleout, ai:check) | **7/7 PASS** |
| backend full suite | **927 tests · 924 pass · 3 fail = PRE-EXISTING `rest.test` 404 only** (nodes.json, node-versions.json, node-types — documented since P2.22, untouched) |
| frontend full suite | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression (P2.16–P2.26 suites inside the full run) | **fail 0** |
| Failure classification | new regression: **0** · pre-existing: **3 (rest 404)** · environment: 0 · baseline exception: 0 |

Test-authoring fix during development: chain-edge nesting in the new lazy-wide fixture (`main: [[link]]`, the real n8n shape) — TEST expectation fixed, module never bent, no test removed.

## §4 Performance gate — measured working-set (single-run, Node, indicative; deterministic bounds are asserted in the suite)

Method: `node --input-type=module` script (reproducible): build `100,000` nodes × `{payload}` at `chunkSize 256` → **391 logical chunks**, `maxCachedChunks 8`, `lazy: true`; scan all chunks ×3; 10,000 random `getNode`; cold vs hot `getChunk`; deliberate full parse via `exportDefinition`.

| metric | measurement |
| :--- | :--- |
| logical vs resident | 100,000 nodes / 391 chunks logical · **peak HOT = 8** · **peak raw window = 8** (bound never crossed) |
| build | 423 ms · RSS 158 MB (raw source) · heap 106 MB |
| scan ×3 (1,173 chunk reads) | 794 ms · `storeLoads = 1,173 = 391×3` (honest reloads, window can't retain) |
| RSS after 3× full scan | **145 MB ≤ 158 MB after build** — repeated full walks add no resident growth |
| lookup cost | random `getNode` ≈ 0.646 ms/op (cold-dominated across 391 chunks at bound 8 — no locality in the pattern; expected) |
| chunk materialize cost | cold miss 522.9 µs vs HOT hit 60.8 µs (≈8.6× on this run) |
| deliberate full parse (export) | 227 ms — rare by design, bypasses the window on purpose |
| cache counters | misses 11,174 · hits 1 · evictions 11,166 (LRU invariant `evictions = misses − 8` holds: 11,166 = 11,174 − 8) |

Benchmark numbers never override correctness: lossless export + integrity re-verified after every measured phase in the suite.

## §5 Non-scope held

No executor, no READY/EXECUTING/COMMITTED behaviour (declared only), no fs/network persistence adapter (port seam ready), no hot/warm/cold multi-tier storage policy (Slice G), no bounded runtime/frontier (Slice D), no checkpoint, no fusion/optimization, no oracle, no resource budgets enforcement (Slice M), no n8n-ts/UI/capability change, no count-pin churn, no P2.27 expansion, no P4+.

**Milestone P3.2 remaining after this slice:** none — P3.2 = this single-slice milestone; completion evidence recorded on Issue #97 post-merge.
