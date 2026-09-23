# P3 Slice K — Execution Optimizer (fusion + semantics-safe cache) — Evidence (Issue #97 scope: "semantics-safe node fusion/elimination/caching where proven")

- **Milestone:** P3.13 · **Slice:** K — execution optimizer (completes the IR letter-pair J+K: J shipped compile/toggles/identity; K ships fusion + proven-pure caching)
- **Branch:** `feat/p3-executor` · **Baseline (frozen):** protected main `46956d3ea54b1f80a3ffcb0b15f073f8fc4c3169` (post-Slice-N #129; open PRs `[]`)
- **Slice boundary:** IR transforms + result cache ONLY — no DAG loop (contract §5 single-engine rule untouched: the app still delegates execution to the reconstructed engine), canonical definition never mutated.

## §1 Deliverable — `src/lego/execution-optimizer.mjs` (zero-import) · contract **`execution.optimizer@1.0.0`** (lock row **40**)

| export | safety rule ("where proven" = this, not vibes) |
| :--- | :--- |
| `OPTIMIZER_PURE_TYPES` | whitelist = `n8n-nodes-base.noOp`, `n8n-nodes-base.set` ONLY (http/code/credential nodes never touched) |
| `fusionPlan(ir)` | maximal chains requiring **single-consumer AND single-dep** at each hop + both types whitelisted; deterministic ordinal order; overlap/dangling/duplicate fail closed |
| `applyFusion(ir, plan)` | head-ward collapse: consumers of removed members rewire to head (dedup), `fused` member audit trail kept, input IR untouched (asserted deep-equal before/after), frozen output |
| `createNodeResultCache({maxEntries})` | **exact fingerprint or nothing** (wrong key = miss, never a guess), pure-type whitelist enforced (impure `refused` counter), bounded LRU, frozen values, fail-closed config |
| `OPTIMIZER_TRANSFORMS = ['fusion']` | oracle `toggleSweep({toggleNames:['fusion']})` interop — enable/disable equivalence judged in Slice L, never claimed here (#91 Security rule) |

**Elimination stays in Slice J** (`noopPassthrough` toggle, all-off = canonical identity asserted) — K does not re-implement it (single responsibility; no second truth).

## §2 Governance edits

- lock row 40 (R7 exports map) · **count-pins 39 → 40 in 15 files** per-file anchored · `execution.paths` += execution-optimizer · changelog +1 · `.ai` regenerated · errors.contract untouched (14 codes).

## §3 Validation

| gate / suite | result |
| :--- | :--- |
| Focused `lego-execution-optimizer.test.mjs` | **8/8 PASS** (contract/parity · chain preconditions (impure stops chain, fan-out root never collapses) · apply purity + rewiring incl. fork consumer + #91(c) identity still holds after fusion · fail-closed plans (bad/unknown/overlap/dangling/duplicate) · cache exact-key LRU frozen · refused-impure counter + config validation · zero-import + toggle name) |
| Focused bundle (optimizer+ir+guard+oracle+stress+dna+graph+frontier+state) | **102/102 PASS** |
| 7 gates | **7/7 PASS** |
| backend full | **1000 · 997 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |
| pin scan | zero stale `length, 39` rows |

## §4 Compatibility gate §6 — held

Canonical definition untouched; fusion output is derived/disposable/reconstructible (recompile from canonical ⇒ original); equivalence of toggle states is the oracle's job (L) and is wired via `OPTIMIZER_TRANSFORMS`.

**Milestone P3.13 remaining:** completion recorded on Issue #97 post-merge.
