# P3 Benchmark & Acceptance Matrix (Issues #75/#97)

Companion to [P3-UNLIMITED-NODES-PLAN.md](./P3-UNLIMITED-NODES-PLAN.md)
(§Stress Target = single source of truth for workload shape & tiers).
Every number below is a **measurement recorded in the slice evidence file**
linked in the row — none are estimates, none are FAIL→PASS relabels.
"env guard" ceilings are anti-hang protections, NOT performance claims.

## §A Required benchmark dimensions (#75) × measured status

| # | Dimension (#75) | Measured at | Value / status | Evidence |
| :-- | :--- | :--- | :--- | :--- |
| 1 | Logical node count (invariant tier) | Slice N suite | **1,000,000 PASS** (full correctness); 5M/10M = **ENV-LIMIT** (SIGABRT exit 134 at string phase, V8 old-space ≈ 943 MB, 2 GB runner) — recorded, never claimed PASS | N |
| 2 | Serialized graph size | Slice A (bundle format) | bundle = verbatim node strings + digest; scales linearly with content (string bytes only — no object-per-node resident form) | A |
| 3 | Index size | Slice A/B | name→ordinal Map only (integers, not objects); reverse index = lazy, droppable, 0 reads/hit after build | A/B |
| 4 | Validation peak RSS | Slice N | 1M streamed construction completes under default heap on the 2 GB runner (one-shot stringify OOMs — anti-pattern proven empirically) | N |
| 5 | Execution peak RSS | executor slices | bounded by frontier capacity + state-stream ring buffers + HOT cache bound (8 chunks default) — mechanism merged; end-to-end numbers await executor completion (K onward) | D/F/G |
| 6 | Active frontier size | Slice D | capacity-bound batches (config ≤ capacity asserted) | D |
| 7 | Queue depth | Slice D + M | frontier bound + guard `queueDepth` budget = hard wall for ALL lanes | D/M |
| 8 | Persisted execution-state size | Slice F | 100k events → snapshot 241 ms / **24.1 MB**; resume 219 ms; post-resume backpressure 0.024 ms/event | F |
| 9 | Time-to-first-progress | Slice D | first batch admitted within capacity in focused timing (env-guard bounds only — benchmark harness = future work item, recorded honestly) | D |
| 10 | Throughput | executor slices | see rows 5–7 mechanisms; sustained throughput number = after K (executor) lands | — |
| 11 | Checkpoint cost | Slice F | 100k events: **241 ms** snapshot | F |
| 12 | Crash-resume time | Slice F | **219 ms** resume + lossless continuation | F |
| 13 | CPU | all | single-process, no child processes, no network — CPU bounded by the algorithms above (timings per row) | — |
| 14 | I/O volume | all | zero filesystem/network I/O in graph/IR/guard/oracle paths (source-scanned purity tests) | H/J/L/M |
| 15 | Failure under pressure | Slices G/M/N | tier relief 8→HOT in **0.144 ms**, rematerialize 0.564 ms (lossless); guard hard wall rejects all 5 lanes at budget exhaustion; 1M stress = full correctness | G/M/N |

## §B Acceptance matrix (per-slice gates actually run)

| Gate | Requirement | Status |
| :--- | :--- | :--- |
| 7 governance gates (`lego:arch`, `arch:selftest`, `foundation`, `foundation:selftest`, `capabilities`, `scaleout`, `ai:check`) | PASS on protected main after every merge | PASS (last post-merge run) |
| Backend full suite | ≥ all non-environment tests green; exactly the 3 pre-existing REST 404s allowed | PASS (3 pre-existing only) |
| Frontend full suite | 0 fail (1 documented skip) | PASS |
| P2 regression (P2 suite) | fail = 0 | PASS |
| Compatibility gate §6 | oracle modes/observables locked; metamorphic/identity properties asserted where in slice scope; errors.contract untouched (14 codes) | PASS |
| Performance gate §7 | per-slice measured rows above, linked to evidence | PASS where measured; executor end-to-end pending K (honest gap, tracked in §A rows 5/10) |
| Stress target §Stress Target | T1 MUST PASS; T2/T3 env-limit honesty | T1 PASS · T2/T3 ENV-LIMIT recorded |

## §C Runner context (comparability)

- Runner: Linux container, **≈2 GB RAM total**, Node v20, 1 process, no swap.
- All timings single-run (no warmup, no averaging) — honest samples, ceilings
  are env guards. Re-run + update rows when the runner class changes.
- Numbers never override equivalence: any future optimizer claim must first
  pass `compatibility.oracle` (Issue #91 Security rule).
