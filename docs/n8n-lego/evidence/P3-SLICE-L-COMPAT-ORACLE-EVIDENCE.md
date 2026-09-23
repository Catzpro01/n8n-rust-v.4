# P3 Slice L — Compatibility Oracle — Evidence (Issue #97, planning #91)

- **Milestone:** P3.10 · **Slice:** L — compatibility oracle (§30 oracle; **"canonical workflow behavior = the oracle"**)
- **Branch:** `feat/p3-compat-oracle` · **Baseline (frozen):** protected main `b5b5e587c5f84782a27c6a961bc0ef178697bf76` (post-Slice-J #125; open PRs `[]`)
- **Slice boundary:** comparison toolkit only — never executes workflows, never imports graph/IR/executor (`compatibility` domain `mustNotDependOn: [workflow, execution]` honored STRUCTURALLY by zero imports). No REST/capability changes.

## §1 Deliverable — `src/compat/oracle.mjs` (zero-import) · contract **`compatibility.oracle@1.0.0`** (lock row **38**)

| export | meaning |
| :--- | :--- |
| `ORACLE_MODES` | the four #91 modes: `differential`, `virtualization-equivalence`, `optimization-toggles`, `metamorphic` |
| `ORACLE_OBSERVABLES` | the nine #91 checks: finalStatus, outputs, errorClassMessage, nodeExecutionOrder, retryBehavior, sideEffectBoundaries, executionMetadata, credentialBehavior, partialFailureSemantics |
| `differentialPlan(ref, cand, opts)` | freezes ordered comparison intent (mode + observables) before execution — cheap, no walk |
| `compareCanonical(ref, cand, opts)` | deep structural equivalence over chosen observables: objects key-order-insensitive, **arrays order-sensitive** (node order IS observable), **absent observable on either side = failure (fail-closed, never a silent skip)**, first difference reported as `{path, expected, actual}` |
| `toggleSweep({canonical, apply, toggleNames})` | #91(c): applies **every subset** (2^n, n ≤ 8 → ≤ 256 rows bounded), compares each to canonical; **`identityRecovered` true only when all-off reproduces canonical exactly** — a cheating `apply` surfaces `identityRecovered: false` (asserted) |
| `CompatibilityOracleError` | single error family |

## §2 Governance edits

- lock row 38 (exports `{file: [names]}` map per R7) · **count-pins 37 → 38 in 13 files** per-file anchored · `compatibility.paths` already covers `src/compat` (directory — no manifest edit needed) · changelog +1 · `.ai` regenerated.
- errors.contract untouched (14 codes); oracle not in F16's `src/lego` scan scope yet still uses one consistent code family.

## §3 Validation

| gate / suite | result |
| :--- | :--- |
| Focused `compat.oracle.test.mjs` | **7/7 PASS** (contract/parity · 4 modes + 9 observables · plan freeze + validation · equivalence/path-reporting/absent fail-closed · sweep 4 rows + identity + cheat-exposed · fail-closed config incl. 8-toggle 256-row cap · zero-import/purity scan) |
| Focused bundle (oracle+ir+dna+graph+frontier+state) | **80/80 PASS** |
| 7 gates | **7/7 PASS** |
| backend full | **978 · 975 pass · 3 fail = PRE-EXISTING rest.test 404 only** |
| frontend full | **419 · 418 pass · 0 fail · 1 skip** |
| P2 regression | **fail 0** |
| classification | new 0 · pre-existing 3 · env 0 · baseline-exception 0 |
| pin scan | zero stale  rows |

## §4 Security rule held

Benchmark improvement alone can never pass: `compareCanonical` is the only equivalence admitted, and absent data fails closed.

**Milestone P3.10 remaining:** completion recorded on Issue #97 post-merge.
