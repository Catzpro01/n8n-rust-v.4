# Consensus review — TASK-406-connection-graph-utils (agent-1, on loan to LEGO 03)

| Field | Value |
|---|---|
| Reviewer | `agent-3` (LEGO 03 owner; author of `connection-rust-port-spec.md` §3–§6 and the pinned fixtures) |
| Reviewed artefact | `arena/01a0ace4-n8n-rust-v-4` @ `b3a2566f` — `crates/n8n-connection/src/graph_utils.rs` (+479), `lib.rs` (+2, `pub mod`), `crates/n8n-workflow/tests/connection_probe_fixtures.rs`, results/tasks |
| Protocol | `STANDING-WORKER-PROTOCOL.md` Tahap 2 — written rubric, re-executed in the offline rig (rustc 1.88) |
| **VOTE** | **APPROVED** |

## Rubric

### 1. Aturan jalur berkas — PASS
6 files, exactly the manifest's `allowed_paths`. `git diff --stat 6535009f b3a2566f -- reference contracts crates/n8n-workflow/src tests/reference/connection` → empty (forbidden paths untouched; fixtures consumed, not mutated).

### 2. Integritas golden oracle (n8n 2.9.4) — PASS, independently re-executed
- `cargo --offline test --workspace` in a detached worktree of `b3a2566f`: all suites 0 failed (7 graph_utils unit tests; probe runner `46 executed / 46 expected`).
- Fidelity notes in the manifest match `graph-utils.ts` as I documented them in `connection-rust-port-spec.md`: adjacency = insertion-ordered map of insertion-ordered sets with `(node,type,index)` dedupe; `getRootNodes` disqualified by main targets outside the selection; `hasPath` main-only; `parseExtractableSubgraphSelection` error ordering. Pinned values reproduced: `hasPath Merge→Merge` (via Loop) = true, `Model→Agent` = false, roots `{IF,A,B,Merge}` = `[IF]`, extractable `{Merge,Loop}` = `{start: Merge, end: Loop}`.
- **Extra check beyond the task's scope**: I extended their runner to my cases 06–07 (not on their branch yet). Result 51/60 — the 9 misses are all `wf.*` ops outside TASK-406 (`wf.sourceKeys/destKeys/getChildNodes/getParentNodes/rebuildThenGetParentNodes` not wired in the runner; `getNodeConnectionIndexes` after rename differs only because the runner does not apply `case.rename` before probing; `getParentMainInputNode` climb = known CD-05 gap). **Zero graph-utils probe fails.** So the port itself is clean; the misses are runner coverage for cases 06/07, tracked below.

### 3. Keberadaan bukti nyata — PASS
479 lines of Rust + 7 unit tests + probe runner asserting 46/46 with hard failure on unknown ops. Results record has real evidence (`cargo test --workspace` 52/0, `workflow-reference-manifest --check` PASS).

## Ownership note (for the record, not a vote condition)
Per the core directive and TASK-303 (Option A), `crates/n8n-connection` bodies for graph-utils now live in the Connection crate — this is the direction I argued in MSG-18. Agent-1 doing it "on loan" under a manifest with LEGO 03 paths is consistent with the protocol ("peran melekat pada task"). With this, R-05/R-07 of my re-review of `n8n-connection@8ed00851` are closed; R-02 (`getConnectedNodes` type filter `ALL`/`ALL_NON_MAIN`) and R-08 remain open until the traversal port lands there too.

## Non-blocking follow-ups
1. Runner: add cases 06–07 once they reach main (they are on `arena/01a0ac05`); apply `case.rename` via `rename_node` before probing, and wire `wf.sourceKeys/destKeys/getChildNodes/getParentNodes/rebuildThenGetParentNodes` (all already in `n8n-workflow`).
2. `to_ordered_set` is dead code (compiler warning) — drop or use.
3. `SKIPPED_OPS` owner text for the CD-05 climb should read LEGO 02 (registry), not Connection.
