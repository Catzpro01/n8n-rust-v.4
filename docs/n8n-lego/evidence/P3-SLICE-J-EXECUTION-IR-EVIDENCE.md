# P3 Slice J — Execution IR + Optimization Toggles + LRU Cache — Evidence (Issue #97, planning #75/#91)

- **Milestone:** P3.9 · **Slice:** J — Execution IR (§30 executor planning foundation; #91(c) optimization-toggle oracle primitive)
- **Branch:** `feat/p3-execution-ir` · **Baseline (frozen):** protected main `99c390090f85ba9386e5c91d7cdf3ffc0fab4bcc` (post-Slice-I #123; open PRs `[]`)
- **Slice boundary:** IR module only. NO executor/scheduler, NO optimizer touching workflows (IR-only), no REST/capability.

## §1 Deliverable — `src/lego/execution-ir.mjs` (zero-import) · contract **`execution.ir@1.0.0`** (lock row **37**)

- **`compileExecutionIr(workflow)`** — RAW IR: one step/node in canonical order; deps = predecessor sources in encounter order, **duplicates kept** (dedupe is an optimization, not a compile step); dangling/orphan connection keys excluded (structural truth); fail-closed on malformed/duplicate structure (one error family `ExecutionIrError`).
- **`optimizeExecutionIr(ir, toggles)`** — **independently disableable** (#91(c)): `noopPassthrough` (fixpoint contraction of `n8n-nodes-base.noOp` chains with cycle-guard skip — never corrupts self-deps) + `dedupeDeps` (Set, first-encounter order). **Default = both ON; ALL-OFF = byte-identity to the raw IR (asserted via round-trip deep-equal)** — disabling recovers canonical behavior without workflow conversion. Pure (input untouched), output frozen; unknown toggle keys fail closed.
- **`createIrCache({maxEntries})`** — bounded LRU keyed by caller strings (no hash import → purity kept), promote-on-get, evict-on-overflow, truthful `stats()`; frozen values; `maxEntries`/key/IR validated fail-closed.
- **Purity:** zero import statements (source-scanned), no clock/fs/network.

## §2 Governance edits

- lock row 37 `execution.ir@1.0.0` domain `execution`, **exports as `{file: [names]}` map** (R7 gate schema), consumers/tests corrected after initial draft copied dna values (caught by parity test + gate review); **count-pins 36 → 37 in 12 files** (11 carry-forwards + dna pin message refresh + FE 34-memory) per-file anchored.
- `domains.json#execution.paths` += `src/lego/execution-ir.mjs` · `BACKEND_LEGO.md` changelog +1 · `.ai` regenerated (64/38/102).
- **F16 lesson applied:** contract `id` uses BACKTICKS (foundation scans single-quoted `domain.word` strings as raised codes — errors.contract untouched, 14 codes).

## §3 Validation

| gate / suite | result |
| :--- | :--- |
| Focused `lego-execution-ir.test.mjs` | **9/9 PASS** (contract/parity · raw compile truth · all 4 toggle combinations + all-off identity · validation fail-closed · cycle guard (contract & skip) · LRU bound/promote/stats · fail-closed config · zero-import scan) |
| 7 gates | **7/7 PASS** (arch R7 + foundation F16 fixed in-branch: exports map + backtick id) |
| backend full | **971 · 964 pass · 7 fail → resolved to 3 = PRE-EXISTING rest.test 404** (mid-run gates were red pre-fix; final full re-run green except pre-existing) |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |

## §4 Compatibility gate §6 — held

All-off optimization toggles recover the canonical IR exactly (#91(c)); no workflow conversion required; oracle slice (L) will sweep these toggles.

**Milestone P3.9 remaining:** completion recorded on Issue #97 post-merge.
