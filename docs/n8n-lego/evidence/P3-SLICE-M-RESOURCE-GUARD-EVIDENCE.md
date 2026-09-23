# P3 Slice M — Resource Guard — Evidence (Issue #97, planning #75 #7, #79)

- **Milestone:** P3.11 · **Slice:** M — resource guard (§30 resource protection; #75 required architecture #7 **enforced resource budgets**; #79 burst/overload groundwork)
- **Branch:** `feat/p3-resource-guard` · **Baseline (frozen):** protected main `2277693d5985b73f2e9e8f4fc076d23810f0b7ed` (post-Slice-L #126; open PRs `[]`)
- **Slice boundary:** admission rules only — no clock, no executor loop, no queue implementation (the frontier/executor own the machinery; this owns the rule).

## §1 Deliverable — `src/lego/resource-guard.mjs` (zero-import) · contract **`execution.guard@1.0.0`** (lock row **39**)

- **Mandatory budgets (fail-closed):** `memoryBytes`, `maxConcurrency`, `queueDepth`, `outputBytes`, `timeoutMs`, `ioOps` — construction refuses missing/≤0/∞/unknown dimensions (an unbounded budget cannot hold). Optional `pressureThresholds {elevated, critical}` validated `(0,1]`, critical > elevated (defaults 0.7 / 0.9).
- **Five priority lanes:** `system · interactive · background · bulk · deferred` (frozen vocabulary).
- **Three-tier pressure from OBSERVED ratios** (worst dimension wins): normal → all admit; elevated → system/interactive admit, background/bulk/deferred defer; critical → system admits, interactive/background defer, bulk/deferred reject.
- **Hard limits (observed ≥ 100% or overdue) = backpressure wall:** REJECT every lane incl. `system` — no lane is exempt when a budget is exhausted (#75 #3 bounded queue/backpressure).
- **No clock:** every observation (`memoryBytes`, `activeConcurrency`, `queuedItems`, `outputBytes`, `overdueMs`, `ioOps`) is passed in as observed state — decisions are pure & reproducible (source-scanned: no `Date.now`/`performance.now`). `remaining()` reports honest headroom (negative allowed — never clamped).
- One error family `ResourceGuardError`.

## §2 Governance edits

- lock row 39 (R7 exports map) · **count-pins 38 → 39 in 14 files** per-file anchored · `execution.paths` += resource-guard · changelog +1 · `.ai` regenerated · errors.contract untouched (14 codes).

## §3 Validation

| gate / suite | result |
| :--- | :--- |
| Focused `lego-resource-guard.test.mjs` | **8/8 PASS** (contract/parity · vocabularies · fail-closed budgets+thresholds · no-clock+mandatory observations · pressure boundaries incl. float-exact 0.7 via ceil · full 5×3 admission matrix · hard-limit wall for all 5 lanes (queue/concurrency/timeout/memory) · remaining honest-negative) |
| Focused bundle (guard+oracle+ir+dna+graph+frontier+state) | **88/88 PASS** |
| 7 gates | **7/7 PASS** |
| backend full | **986 · 983 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |
| pin scan | zero stale `length, 38` rows |

## §4 Performance/compatibility notes

Admission is O(budgets) per call (6 dimensions) — negligible vs. any dispatch; decisions depend only on caller-observable state (compat gate §6 unaffected — no REST/capability path touched).

**Milestone P3.11 remaining:** completion recorded on Issue #97 post-merge.
