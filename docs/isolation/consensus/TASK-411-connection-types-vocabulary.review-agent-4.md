# Agent-4 review — TASK-411-connection-types-vocabulary (frame task, orchestrator-workflow-owner, `arena/01a0ace3` @ `40ca8e84`)

Reviewer: agent-4 — named co-owner of the joint surface ("connection + validation"). This is a review of the **frame** (manifest + evidence), not of an implementation; I have not claimed the task and cast no vote on my own future work. (Third task now numbered 411 — agent-1 has `TASK-411-issue-028-closure`; mediator remap.)

## Vote on the frame: **APPROVED** — with the owner ratification the manifest asks for

| Rubrik | Evidence |
| :--- | :--- |
| 1 Paths | Frame touches only `tasks/`, `results/`, `docs/isolation/consensus-votes/`. `forbidden_paths` correctly protects `tests/reference/agent-4/**` (oracle) and `contracts/**`. |
| 2 Oracle | Duplication evidence (grep, 4 locations) is accurate. Adding the TS side for completeness: the vocabulary also lives in `packages/validation-lego/src/rules/workflow-rules.ts` and `packages/connection-lego/src/kernel/vocabulary.ts` — **both already drift-checked against the reference at test time** (`validation-lego/test/03-equivalence.test.mjs:37` asserts `NODE_CONNECTION_TYPES` == `NodeConnectionTypeSchema` enum recorded from n8n-workflow 2.9.x; connection-lego pins it too). So on the TS side "grep is the only detector" is not the case; on the Rust side it is. |
| 3 Evidence | Acceptance criteria are falsifiable (single Rust definition + mutation test proving the validator rejects a removed entry). Real deliverable expected, not a report. |

## Owner ratification (validation side)
- **Option A ratified**: `n8n-connection` owns `pub const NODE_CONNECTION_TYPES: [&str; 13]` (it already does, verbatim from `interfaces.ts:2249`); `n8n-validation` must **import** it and delete its local copy. This mirrors the TS seam plan (validation consumes the vocabulary through `P-CONNECTION-GRAPH`, contract CD-06). Option B (`n8n-common`) is acceptable only if agent-3 objects to being the owner.
- Required mutation test (spec §10 addendum): with one entry removed from the canonical list, `crates/n8n-validation/tests/parity.rs` must fail on `D05-invalid-connection-type` **and** on at least one positive fixture that uses the removed type (`D08-ai-edges-ignored` covers `ai_tool`). No new fixture is needed — the 14 D-fixtures already pin the full set through `INVALID_CONNECTION_TYPE`.
- Implementer: under Option B (NO-RUST for agent-4) this is agent-1's or agent-3's claim; agent-4 reviews the result against the criteria above.
