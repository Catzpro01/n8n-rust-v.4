# P3 Slice D — Bounded Runtime Primitive — Evidence (Issue #97, planning #75/#79)

- **Milestone:** P3.3 (mapping on Issue #97) · **Slice:** D — bounded frontier/queue/backpressure (marathon §30; Verification Gate Amendment)
- **Branch:** `feat/p3-bounded-runtime`
- **Baseline (frozen):** protected main `adb94b2bb74a9550676a78d380f5910fbaa2d3a5` (post-Slice-C PR #113; open PRs `[]` at fork)
- **Slice boundary (exactly one coherent boundary):** the capacity-bounded FIFO frontier primitive — required capacity, explicit admission outcomes, bounded drain, observability stats, purity. NOT scheduler wiring, NOT load-shedding policy, NOT priority lanes, NOT memory-emergency sequence (Issue #79 policy layers → resource-protection slice M), NOT an executor.

## §1 Deliverable

New module `apps/n8n-lego/src/lego/bounded-frontier.mjs` — contract **`execution.frontier@0.1.0`** (lock row **34**, owner `agent-1` per Issue #98 bounded-frontier ownership, domain `execution`, no capability/REST surface — no ops/permissions by design):

- **The bound is the policy:** `capacity` is REQUIRED (no default — `createBoundedFrontier()` without it refuses), validated `1..1048576` (`FRONTIER_MAX_CAPACITY`), and pre-allocates a ring of exactly that many slots → **depth ≤ capacity by construction**, enforced on every path (asserted after every offer in a 64-flood loop).
- **Explicit admission (Issue #79):** `offer` returns frozen `{status: 'admitted' | 'backpressure', …}` — backpressure carries the **published** code `lego.backpressure` (errors contract 1.2.0 untouched) and does NOT retain the item (caller still owns it; refusal leaves depth unchanged — asserted).
- **Bounded fan-out / no silent loss:** `offerBatch` admits in input order until full with exact counts; `admitted + backpressured === items.length` always; batch validates ALL items before admitting any (atomic fail-closed on `undefined`).
- **Bounded active set:** `takeBatch(max)` validates `0 ≤ max ≤ capacity` fail-closed BEFORE pulling anything (asserted: refused pull served 0, depth unchanged), returns ≤ requested, ≤ depth, FIFO; `take()` → `undefined` only when empty (not an error).
- **Observability minimum (Issue #79):** `stats()` frozen `{capacity, depth, peakDepth, admitted, backpressured, served}` — counters cannot be mutated from outside (asserted TypeError).
- **Purity:** zero imports, no clock/fs/network/timers/randomness/process (source-scanned in tests) → determinism asserted (identical sequences → identical stats + drain order).
- **Domain boundary held:** execution domain `mustNotDependOn: workflow` — module imports NOTHING (coupling impossible by construction); test asserts `dependsOn` stays without `workflow`, path listed in `execution.paths`, domain status `partial`, capabilities 4 unchanged.
- **One error family:** `BoundedFrontierError`, code `lego.contract_violation` (published). No second error family introduced.
- **Lossless items:** falsy-but-defined payloads (`0`, `null`, `false`, `''`) roundtrip unchanged; `undefined` refused with `field: item/items`.

## §2 Governance edits

- lock row **34** `execution.frontier@0.1.0` appended (R9: execution domain contract 0.1.0 → row 0.1.0); **count-pins 33 → 34** in **9 files** (7 BE: token-usage, runtime-adapter, node-portability, node-creator, mcp-boundary, provider-adapters, provider-declaration + FE34 + the graph suite's own `ROWS.length` pin), each edit anchored on its ORIGINAL message and extended per-context ("P3 Slice D adds the thirty-fourth (execution.frontier)") — no blanket replacement.
- `domains.json#execution.paths` += `src/lego/bounded-frontier.mjs` (capabilities 4, status `partial`, dependsOn/mustNotDependOn untouched — 2+/1− diff only).
- `BACKEND_LEGO.md` changelog +1 (initial-lock row above Slice C).
- `.ai` regenerated with `npm run lego:ai` before `--check` (row set changed → 4 files stale; after regen **64/37/101 in sync**, `lego:ai:check` PASS).

## §3 Validation (this tree)

| gate / suite | result |
| :--- | :--- |
| Focused suite `lego-bounded-frontier.test.mjs` | **10/10 PASS** |
| Graph suite (pin updated) | **29/29 PASS** |
| 7 gates (arch, arch:selftest, foundation, foundation:selftest, capabilities, scaleout, ai:check-after-regen) | **7/7 PASS** |
| backend full suite | **937 tests · 934 pass · 3 fail = PRE-EXISTING `rest.test` 404 only** (same three since P2.22) |
| frontend full suite | **419 · 418 pass · 0 fail · 1 skip** (FE34 pin 34 green) |
| P2 regression (P2.16–P2.26 in the full run) | **fail 0** |
| Failure classification | new regression: **0** · pre-existing: **3 (rest 404)** · environment: 0 · baseline exception: 0 |

Test-authoring fixes during development (all in the TEST, module never bent, no test removed): `takeBatch` bounds are `0..capacity` (not unbounded max), batch-round arithmetic under a capacity-5 ring (retry rounds + drain order), `main: [[link]]` n8n shape was Slice C — here the fixes are the two bounds/order expectations above.

## §4 Performance gate — measured (single-run, Node v20.20.2, indicative; bounds themselves are asserted in-suite)

| metric | measurement |
| :--- | :--- |
| flood: 50,000 distinct ~2 KB-payload offers → capacity 64 | admitted **64** · backpressured **49,936** · depth **64** · peakDepth **64** · last outcome `backpressure` · flood 19 ms |
| memory under flood | RSS 39 → 46 MB (**Δ +7 MB**) · heap 4 → 5 MB (**Δ +1 MB**) — retaining all 50k items would need **~100 MB**; refused work is NOT retained (delta is run noise, not queue growth) |
| queue growth | depth pinned at capacity for the entire flood — **uncontrolled queue growth: impossible** (#79 acceptance direction) |
| admit+drain throughput (capacity 4096 × 100 rounds, 819,200 ops) | ~22.1 M ops/s (pure ring, single-run) |
| recovery-after-pressure | drain → re-offer of the exact refused item admits and arrives intact (asserted) |

Benchmarks never override correctness: every number above is secondary to the deterministic assertions (bound, arithmetic, FIFO, recovery).

## §5 Non-scope held

No scheduler/executor wiring, no active-executor-count tracking (needs executor), no load shedding / priority lanes / memory-emergency sequence / CPU-budget admission (Issue #79 policy layers → resource-protection slice), no checkpoint/spill, no workflow awareness (domain boundary), no persistence, no capability/REST, no n8n-ts/UI change, no P2.27 expansion, no P4+.

**Milestone P3.3 remaining after this slice:** none — single-slice milestone; completion recorded on Issue #97 post-merge.
