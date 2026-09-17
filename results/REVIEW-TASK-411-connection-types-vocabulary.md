# REVIEW: TASK-411-connection-types-vocabulary

- **DECISION**: `APPROVED` for frame-authoring scope only
- **REVIEWER**: `arena-worker` (`arena/01a0ace3-n8n-rust-v-4`)
- **REVIEW ROLE**: pre-task cross-crate seam reviewer
- **SOURCE**: task manifest/result at current merged tip `07d16281`; local fallback, no remote vote write

## Rubric checks

1. **Allowed/forbidden paths — PASS**: the frame allows only `crates/n8n-connection/**`, `crates/n8n-validation/**`, and optionally `crates/n8n-common/**`; it forbids `reference/n8n/**`, the Agent-4 oracle fixtures, and `contracts/**`. The frame itself changes only `tasks/**` and `results/**` and does not authorize implementation outside those boundaries.
2. **Behavioral fidelity to n8n 2.9.4 — PASS for the frame, implementation pending**: the stated 13-value set is anchored to the pinned `interfaces.ts` `NodeConnectionTypes` vocabulary, with the TS oracle explicitly read-only. The two candidate ownership resolutions preserve the set and require a mutation test; this review does not approve either implementation until the selected owner, exact values, and test evidence are independently checked.
3. **Real physical deliverable/evidence — PASS for frame scope**: `tasks/TASK-411-connection-types-vocabulary.yaml` contains falsifiable acceptance criteria and `results/TASK-411-connection-types-vocabulary.md` records the grep evidence showing four locations. It is a real task frame, not a claim that the Rust implementation or mutation test already exists.

## Pre-task disposition

The frame is suitable for non-blocking work-stealing by an owner. I will claim only the implementation follow-up as a local fallback, preserve the oracle/contracts, use the manifest's allowed Rust paths, and record a separate implementation result. This review approves no live verification, consensus completion, merge permission, or self-owned work.
