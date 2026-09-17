# Consensus review — TASK-405-connection-members (agent-1)

| Field | Value |
|---|---|
| Reviewer | `agent-3` (LEGO 03 `connection`; author of the consumed hand-off `connection-workflow-members-spec.md` and of the pinned fixtures) |
| Reviewed artefact | `arena/01a0ace4-n8n-rust-v-4` @ `6535009f` — `crates/n8n-workflow/{src/connections.rs,src/lib.rs,tests/connection_probe_fixtures.rs}`, `results/TASK-405-connection-members.md`, `tasks/TASK-405-connection-members.yaml` |
| Protocol | `STANDING-WORKER-PROTOCOL.md` Tahap 2 — written rubric, re-executed |
| **VOTE** | **APPROVED** |

## Rubric

### 1. Aturan jalur berkas — PASS
`git show --stat 6535009f` → 8 files: `crates/n8n-workflow/**` (3), `results/` (3), `tasks/TASK-405-*.yaml`, `docs/isolation/CROSS-AGENT-ISSUES.md` (ISSUE-018 entry). All inside the task's declared `allowed_paths`; `crates/n8n-connection/src/lib.rs`, `contracts/**`, `reference/n8n/**`, `tests/reference/connection/**` untouched by this commit (fixtures consumed, not mutated — `git diff --stat origin/main..6535009f -- tests/reference/connection` is empty).

### 2. Integritas golden oracle (n8n 2.9.4) — PASS, independently re-executed
- **D-11 closed exactly as reported** (`connections.rs:48`: `lists.push(None)` → `lists.push(Some(Vec::new()))`; the reference `mapConnectionsByDestination` pads with `[]`). The crate's own unit test was updated in the same direction (`main[0] == Some(Vec::new())`), not weakened.
- Re-ran **my** out-of-tree runner (`tests/reference/harness/rust/run-workflow-crate-vs-connection-fixtures.sh`, offline rig rustc 1.88) against `6535009f`:
  `n8n-workflow vs connection fixtures: 20 ok / 0 mismatch / 26 skipped` — previously `21 ok / 1 mismatch (D-11)`. Zero mismatches against the expected.json pinned on the real 2.9.x runtime.
- Skip list in `connection_probe_fixtures.rs` is explicit (`SKIPPED_OPS`, owner = Connection LEGO graph-utils ops); an op that is neither implemented nor listed fails the test (`:165`) — no silent skips, as claimed.
- Spec fidelity spot-checks: `get_node_connection_indexes` emits `destinationIndex` = slot position (matches spec §1 / fixture `Merge <- Loop` `{0,1}`); `get_parent_nodes_by_depth` merges `indicies` into the emitted object with wire names `sourceIndex/indicies/depth` (spec §4, fixture `IF.indicies=[1,0]`); `get_parent_main_input_node` implements the early-return path only, honestly labelled "full climb awaits CD-05" — consistent with the spec's "NOT YET PINNED beyond early return / case 07 needs an ai_tool-output registry".

### 3. Keberadaan bukti nyata — PASS
```
$ cargo --offline test -p n8n-workflow          (offline rig, detached worktree of 6535009f)
test connection_golden_probes_match_the_pinned_runtime ... ok
test result: ok. 20 passed … / 2 passed / 1 passed / 3 passed / 5 passed   (0 failed)
```
Physical deliverable: +60/+163/+210 lines of Rust, real probe runner, results record with populated evidence.

## Non-blocking notes
1. Case 07 (`getParentMainInputNode` climbing `ai_tool`) is still on the skip side; it needs the node-type registry from LEGO 02 (CD-05). Suggest naming CD-05 in `SKIPPED_OPS` owner text so the audit tool attributes it correctly (currently "Connection LEGO").
2. With D-11 closed, `docs/isolation/connection-rust-conformance.md` will be updated by me to record `n8n-workflow` = 0 mismatches at `6535009f` (my area; no action for agent-1).
