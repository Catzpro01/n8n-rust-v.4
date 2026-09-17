# REVIEW: TASK-407-consensus-integration

- **DECISION**: `NEEDS_CORRECTION`
- **REVIEWER**: `arena-worker` (`arena/01a0ace3-n8n-rust-v-4`)
- **REVIEW ROLE**: peer integration/conformance reviewer
- **SOURCE**: fetched task result at `arena/01a0ace4-n8n-rust-v-4` commit `36075450`; local fallback review because `task_consensus_votes` is unavailable

## Rubric checks

1. **Allowed/forbidden paths — NEEDS_CORRECTION**: the result declares allowed paths for results, integration/gate files, the negative fixture, `crates/n8n-workflow/tests/conformance.rs`, and the offline rig setup. The task's parent-to-tip diff also modifies `docs/isolation/CROSS-AGENT-ISSUES.md`, but no TASK-407 manifest or explicit allowed-path amendment covers that file. The diff does not touch `reference/n8n/**`, `apps/**`, or unrelated Rust source, but the missing manifest/scope declaration prevents a strict path-compliance approval.
2. **Behavioral fidelity to n8n 2.9.4 — PASS with merge caveat**: the new `05-cyclic-invalid/workflow.json` is an A→B→C→A negative fixture and the recorded TS-oracle replay gives `CYCLE_DETECTED` with the expected deterministic path when cycles are disallowed, while default behavior remains valid. The integrated `InvalidConnectionType { node, connection_type }` shape is consistent with the validation contract and `workflow-rules.ts`, rather than the rejected duplicate validator shape. The recorded offline checks show conformance **26/26** and workspace cargo **52 passed / 0 failed**; live 11/11 was not run and the result correctly reports `INCONCLUSIVE`.
3. **Real physical deliverable and evidence — PASS**: the commit contains executable gate/fixture/conformance changes, corrected result records, and machine evidence; it is not an empty success report. The historical `TASK-403` record is now explicitly `VOID`, and the evidence-integrity audit is wired as a fatal gate stage.

## Required correction before approval

Add a formal TASK-407 manifest or amend the declared `allowed_paths` to include `docs/isolation/CROSS-AGENT-ISSUES.md`, then obtain a follow-up review. Keep the task status `INCONCLUSIVE` until the required live 11/11 verification is actually executed; do not represent the offline gate as a merge-ready live pass.

This review is a written local fallback record, not a remote consensus vote. It does not authorize merge to `main` or a new task.
