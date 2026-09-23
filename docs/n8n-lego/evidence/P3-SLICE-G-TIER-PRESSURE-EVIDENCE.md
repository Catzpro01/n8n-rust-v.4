# P3 Slice G — Hot/Warm/Cold Tier Pressure — Evidence (Issue #97, planning #75/#79)

- **Milestone:** P3.6 · **Slice:** G — coordinated tier relief (§30 hot/warm/cold; #79 memory-emergency step 3 "evict cold/warm representations")
- **Branch:** `feat/p3-tier-pressure` · **Baseline (frozen):** protected main `2b90bf7339523e43903370aaa0c88c2178286cd9` (post-Slice-F #119; open PRs `[]` at fork)
- **Slice boundary:** tier policy OPS on the existing C tiers (census + bulk relief). NOT the tiers themselves (Slice C), NOT window policy (C), NOT emergency state machine/budgets (Slice M next wave), no new exports (pure methods → **zero lock/changelog/.ai churn**).

## §1 Deliverable (additive methods on `workflow.graph`)

- **`residencySummary()`** → frozen census `{HOT, WARM, COLD, chunkCount, reverseIndexResident}` — partitions the graph exactly (`HOT+WARM+COLD = chunkCount` asserted); honest reverse-index flag.
- **`applyPressure({targetHotChunks=0, releaseReverseIndex=true})`** → frozen `{hotBefore, hotAfter, released, reverseIndexReleased, targetHotChunks}`:
  - demotes the **OLDEST** HOT entries first (LRU order — asserted: refreshed survivor stays);
  - every release is EXPLICIT → `EVICTED` lifecycle marker until re-read (same semantics as `evictChunk`);
  - default = **full emergency relief** (HOT→0 + derived index off) per #79 step 3;
  - raw/WARM tier untouched (memory port) / window untouched (lazy port) — Slice C owns those;
  - fail-closed validation (`targetHotChunks ∈ 0..maxCachedChunks`, boolean flag, plain options — one error family);
  - lossless by construction: `exportDefinition` deep-equal + `integrity().ok` asserted through the full pressure→reload cycle; reverse index rebuilds on demand.

## §2 Validation

| gate / suite | result |
| :--- | :--- |
| Focused graph suite | **32/32 PASS** (29 + 3 G) · state-stream 10/10 · frontier 10/10 |
| 7 gates | **7/7 PASS** |
| backend full | **950 · 947 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |

Test-authoring fix: two stray placeholder assertions removed (TEST-side junk, never module behavior); no test deleted or weakened.

## §3 Performance gate — measured (single-run, indicative; census/trim bounds asserted in-suite)

| metric (50k nodes · 196 chunks · bound 8) | measurement |
| :--- | :--- |
| before relief (full scan, bound held) | HOT **8** · WARM 188 · COLD 0 · index n/a |
| full `applyPressure()` | released **8** → HOT **0**, WARM 196 (raw tier intact), **0.144 ms** |
| recovery | single cold-ish rematerialize **0.564 ms** → HOT 1, lossless export holds |

## §4 Non-scope held

No new exports/rows/pins (methods only), no window-tier changes, no emergency FSM/budgets/lanes (M), no fs, no capability/REST, no P4+.

**Milestone P3.6 remaining:** none — completion recorded on Issue #97 post-merge.
