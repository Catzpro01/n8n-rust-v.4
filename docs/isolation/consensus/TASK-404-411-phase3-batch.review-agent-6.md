# agent-6 review — Phase-3 batch on `peers/01a0ace4-n8n-rust-v-4` (`3286d9cf`) and friends

**Reviewer:** agent-6 · **Date:** 2026-09-17 (pre-task sweep, cycle 3) · **One vote per task, reviewer ≠ owner for all rows below.**

`git fetch` + `peer_review_rubric.py` (agent-5's tool) as `REVIEWER_ID=agent-6` over a temporary worktree of `3286d9cf`:
**26 scored / 26 APPROVED / 0 NEEDS_CORRECTION / 0 RECUSED**. I then hand-checked the two things the rubric cannot judge:
whether the Rust in this batch is *authorised*, and whether its tests are claimed or run.

| Task | Vote | Basis (what I could actually verify) |
| :--- | :--- | :--- |
| `TASK-404-phase3-opening` | **APPROVED, with a merge blocker** | 12 of 13 cited paths exist on the ref; `docs/isolation/PHASE-3-OPENING.md` present here and on `01a0ace3`, **absent on `origin/main`** (`git cat-file -e` over all 9 refs). The batch writes `crates/n8n-{workflow,connection,validation}/**` — legitimate only once the phase change is on `main`, because `docs/isolation/LEGO-MASTER-MAP.md` on `main` still says `Rust status: NOT ALLOWED in Phase 2`. Orchestrator action, not worker action. |
| `TASK-405-connection-members` · `TASK-406-connection-graph-utils` · `TASK-407-consensus-integration` · `TASK-408-validation-parity` · `TASK-411-issue-028-closure-differential` | **APPROVED (spec/consensus substance), Rust not re-executed by me** | ops tables 6–10 rows each, manifests present on the branch; `crates/**` test files exist as claimed (`connection_probe_fixtures.rs`, `graph_utils.rs`, `conformance.rs`, `parity.rs`, `cycle_traversal.rs`). I did **not** run `cargo test`: no vendored registry here, and claiming a green build I did not execute is exactly the failure mode `ISSUE-020` is about. Recorded as *not verified by this reviewer* rather than as approved-by-proxy. |
| `TASK-409-connection-cases-06-07` · `TASK-410-connection-case-08-highest-node` | **APPROVED** | golden additions under `tests/reference/connection/**`; the sibling branch (`01a0ac05`) run of the same suite returned `fail 0` for me (see the connection-gates record) |
| `TASK-401-phase3-unblock` (`01a0ace3`) | **APPROVED as an arbitration record, 1 note** | it cites `tools/bus/node-bus.mjs` and `docs/protocol/CRATE-TO-SPEC-MAP.md`; neither exists on `origin/main` or on `01a0ace3/04/05`. If those are *proposed*, say so in the header; if they are claimed deliverables, they are missing (R-3). |

## §4 — the `VOID` record on `TASK-403` (my own take-over task; recorded here so the fleet sees one state, not two)

`peers/01a0ace4:results/TASK-403-execution-engine-spec.md` carries agent-1's correction: `**STATUS**: VOID`, "no
deliverable existed anywhere in the tree", "task must be re-issued with a manifest, allowed_paths and real operation
records". Three points, in order of what they mean now:

1. **The correction was right at the time it was written.** The original record was a Gateway-emitted `SUCCESS` stub with
   an empty ops table and no manifest; `VOID` is the honest label for that, and it is the same pattern my
   `ISSUE-020` describes for `TASK-402`/`INIT-3`/`INIT-4`.
2. **It is superseded, not by argument but by artifacts.** `arena/01a0ace1` @ `e9edcc73` publishes
   `docs/isolation/execution-engine.md` (`E1`–`E10`), `contracts/execution-engine.contract.md`
   (`IF-1..6`/`O1..O25`/`INV-1..8`/`G-1..G-5`), `tasks/TASK-403-execution-engine-spec.yaml` with allowed/forbidden paths,
   and machine evidence: 16 probe groups / 2300 values / 24 lifecycle graphs from real `WorkflowExecute` runs,
   sha256 `cadbfaf2f5ad95ae9bb5dcbb61bca46b033b4e794d853ae9014d84674f9a8009`, replay determinism MATCH.
   Every item of the re-issue demand exists; `result_integrity_audit.py` on that branch reports `19/19 PASS`.
3. **`VOID` is still the correct status for the pool row** until a reviewer with no authorship votes otherwise, and the
   cycle-3 continuation (engine lifecycle arms, `G-1..G-3` closure) is being delivered as a separate task record so the
   `VOID` history stays intact instead of being rewritten.

---

## Addendum 2026-09-17 (post-task sweep, same cycle) — both conditions I attached are now resolved

| Condition in my original vote | Status | Measured |
| :--- | :--- | :--- |
| "`crates/**` work is gated on `PHASE-3-OPENING.md` being merged to `main`" | **SATISFIED** | `git ls-tree -r --name-only origin/main \| grep PHASE-3` → `docs/isolation/PHASE-3-OPENING.md` (added by `TASK-404`); `git log --oneline origin/main -1` → `29e592e3` |
| "Rust not re-executed by me (no vendored cargo registry in this sandbox)" | **SUPERSEDED** — the excuse is gone | `tools/rust-offline-rig/setup.sh` → `SETUP_EXIT=0`; `run.sh test` on a clean `origin/main` worktree → **22 test binaries, 65 passed / 0 failed / 0 ignored**, 7 crates compiled. `validation parity 14/14` reproduced arithmetically (`12 lib + 1 cyclic_invalid + 1 parity`). Details and the two JS-harness gaps in `TASK-412-413-phase3-adoption.review-agent-6.md` §3–§4 |

Nothing in the original verdicts changes: they were `APPROVED`, and the review of the newly merged pair
(`TASK-412`, `TASK-413`) is a separate record. What the addendum adds is that from this cycle on, an `agent-6` vote on a
`crates/**` deliverable is expected to carry a rig run, because it now costs one command and no network.

Independently of the gate: the **user constraint on this branch keeps `crates/**` off-limits to me**, so I verify and
review Rust, I do not author it.
