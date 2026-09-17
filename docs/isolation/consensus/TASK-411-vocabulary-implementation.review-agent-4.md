# Agent-4 review — TASK-411-connection-types-vocabulary-implementation (orchestrator-workflow-owner, `arena/01a0ace3` @ `52a3b440`/`d05bbe94`)

Reviewer: agent-4 — spec/oracle owner of `crates/n8n-validation` (Option B, not the implementer). Single vote for the implementation record (distinct from my earlier vote on the *frame*).

## Vote: **NEEDS_CORRECTION** (one concrete, mechanical fix — the design itself is right)

### What is correct ✅
- Option A implemented as ratified: `n8n-connection` is the single Rust owner of `NODE_CONNECTION_TYPES` (`lib.rs:19`, 13 values verbatim); `n8n-validation` does `pub use n8n_connection::NODE_CONNECTION_TYPES` and drops its local copy.
- `tests/connection_types_vocabulary.rs` pins the exact ordered 13-list and rejects `""`, `"unknown"`, `"AI_AGENT"`, `"ai_output_parser"`. Rubrik 1: only `crates/n8n-connection/**`, `crates/n8n-validation/**`, `results/` touched; no `reference/`, `contracts/`, `tests/reference/agent-4/**`. ✅

### What must be corrected ❌
1. **Wrong base — the increment regresses TASK-408.** `52a3b440` sits on `b70413fc` (merge-base with main), i.e. **before** PR #3 landed on main (`29e592e3`). Its `crates/n8n-validation/src/lib.rs` is the pre-TASK-408 file (508 lines, legacy `#[error("Node with name '{0}' is duplicated")]` at L9, no `tests/parity.rs`, no `tests/cyclic_invalid.rs`); main's is the TASK-408 file (879 lines, report API, `parity.rs` 14/14). Merging this branch as-is would either conflict or silently drop the 14/14 D-fixture parity that made the crate TESTED. **Fix:** rebase/merge onto main `29e592e3`, re-apply the 3-line change (`pub use n8n_connection::NODE_CONNECTION_TYPES;` + delete local const) to the TASK-408 `lib.rs`, keep `parity.rs`/`cyclic_invalid.rs`, and re-run `tools/rust-offline-rig/run.sh test` — parity must still print `OK D01…OK D14`.
2. **Mutation test does not exercise the validator through the oracle.** The frame's acceptance says "a mutation test must exist proving the *validator* rejects removing one entry". `connection_types_vocabulary.rs` compares the const to a second hard-coded list — that detects drift of the const, but not that `validate_workflow` depends on it. Per my ratification note: with one entry removed, `parity.rs` must fail on `D05-invalid-connection-type` and `D08-ai-edges-ignored`. Once rebased on main this is automatically true (parity.rs consumes the shared const); state it in the record with the observed failing fixture names from a one-off mutation run.

### Rubrik 3 note
`run.sh test` "59 ok" was observed on the stale base; the number is meaningless until re-run on the rebased tree (main's baseline is 57 + your 2 new tests = 59 *plus* parity/cyclic tests). cargo is unavailable here, so I will accept the re-run record once it names `parity.rs` in the output.

Work-stealing (protocol §4): if the author is busy, agent-1 (Rust owner of TASK-408) may apply the rebase; agent-4 cannot (NO-RUST).
