# P3 Slice N — Scale Stress + Mandatory #75 Documents — Evidence (Issue #97, planning #75)

- **Milestone:** P3.12 · **Slice:** N — 1M in-process stress proof + Issue #75's required documentation set
- **Branch:** `feat/p3-scale-stress` · **Baseline (frozen):** protected main `af64f861a5ee37845533adae5d429ad4075269b0` (post-Slice-M #127; open PRs `[]`)
- **Slice boundary:** test suite + documents only — **no lock row, no module** (pins stay 39, zero manifest churn).

## §1 Deliverable

### Stress suite — `apps/n8n-lego/test/lego-scale-stress.test.mjs` (**6/6 PASS**, ~18 s file time)

| test | proof |
| :--- | :--- |
| DNA at 1M (runs first, fixture freed) | DNA ≤ **4,096 bytes**; roots = 999,999 (structural truth) with **sample capped 64**; env-guard timing only |
| STREAMED 1M construct + index | one giant `JSON.stringify(definition)` **empirically OOM-aborts this 2 GB runner** (the #75 anti-pattern, reproduced) → suite constructs node strings streamed; full 1M indexed; digest verified by `graphFromBundle` |
| point access | `getNode` Root/mid/last = ≤ 2/≤ 6 chunk reads — **no whole-graph scan** |
| HOT bound over 50-chunk walk | `cacheStats().hot ≤ maxCachedChunks` (8) always |
| readyAfter at scale | 999,999 ready from 1-batch (`|satisfied|×fan-out`); leaf-batch query < 50 ms |
| identity at 1M | fanOut(Root)=999,999, fanIn leaf=1, frozen payloads, lifecycle vocabulary unclaimed for executor stages, initialReady pagination EOF |

### Mandatory #75 documentation (all four directives)

1. **`docs/n8n-lego/P3-UNLIMITED-NODES-PLAN.md`** — official 514-line planning doc **PRESERVED byte-for-byte** (initial draft of this slice wrongly overwrote it; restored from HEAD, net diff = **+54 lines / −0**: status pointer + `§P3.12 IMPLEMENTATION ADDENDUM` with slice map, measured stress results, P2.27 boundary reaffirmation).
2. **`docs/n8n-lego/P3-BENCHMARK-ACCEPTANCE-MATRIX.md`** (new) — 15 #75 benchmark dimensions × measured values × evidence links; acceptance gates table; runner context.
3. **P2.27 dependency boundary** — addendum §C + matrix (P2.27 code = ZERO, no P3 import path, Issue-first if ever needed).
4. **Single source-of-truth stress target** — plan body `§Stress Target` tiers T1/T2/T3 + workload shape (1 root → N−1 leaves, 1,000 links/output) referenced by matrix.

## §2 Stress honesty (T1/T2/T3 — the point of this slice)

| tier | result | detail |
| :--- | :--- | :--- |
| **T1 1,000,000** | **PASS** | full correctness 6/6 in-process, default heap |
| **T2 5,000,000** | **ENV-LIMIT — NOT PASS** | independent probe: **SIGABRT/exit 134** during streamed string phase (~16 s; V8 old-space ≈ **943 MB** observed on ≈2 GB runner, no swap) |
| **T3 10,000,000** | **ENV-LIMIT — NOT PASS** | same abort profile (~16 s, exit 134) during string build |

No tier was relabeled PASS without a run; re-probe required on a larger runner. Anti-pattern "weaken correctness to survive stress" not applied — T1 asserts full correctness.

## §3 Validation

| gate / suite | result |
| :--- | :--- |
| Focused stress | **6/6 PASS** · focused bundle (stress+guard+oracle+ir+dna+graph+frontier+state) **94/94 PASS** |
| 7 gates | **7/7 PASS** |
| backend full | **992 · 989 pass · 3 fail = PRE-EXISTING rest.test 404 only** (stress 6/6 inside) |
| frontend full | 419 · 418 · 0 fail · 1 skip |
| P2 regression | fail 0 (suite runs in full command; pre-existing 3× rest 404 only elsewhere) |
| classification | new 0 · pre-existing 3 · env probes recorded as ENV-LIMIT rows above (not suite failures) |

**Milestone P3.12 remaining:** completion recorded on Issue #97 post-merge.
