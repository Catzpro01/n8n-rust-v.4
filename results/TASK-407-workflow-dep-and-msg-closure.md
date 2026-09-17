# TASK-407-workflow-dep-and-msg-closure — Result

**Status:** SUCCESS — two surveyed open loops closed, zero behaviour change.
**Branch:** `arena/01a0aff6-n8n-rust-v-4` (Rust campaign; no aff7 porting).

## Scope

A survey of the Rust line (issues, bus inbox, review residue) found the
substantive campaign complete (99/99 green, all gates passing) with two
small open loops. This micro-task closes exactly those two.

## Changes

- **Dep hygiene** (`crates/n8n-workflow/Cargo.toml` only; src/tests
  untouched): `n8n-validation` moved from `[dependencies]` to
  `[dev-dependencies]`. The review (§2.5) said no line uses it — true
  for `src/` (verified by grep), but `tests/conformance.rs`
  cross-checks fixtures with `check_node_uniqueness`/`detect_cycles`,
  so a drop would break the build (verified: E0432 before the fix).
  The production LEGO graph no longer shows a Workflow → Validation
  edge; the test-only edge is documented in a comment.
- **Bus closure** (`C3-MSG-06` → agent-1, closes MSG-02/10/12): the
  requested DEPENDENCY_RESPONSE, never previously sent. Accepted A
  for Phase 3, fulfilled on the Rust side (12 symbols ported, pinned,
  declared in contract CD-02); the JS file move stays deferred per
  the digest baseline with no objection; the traversal/diff
  dual-implementation is recorded as a convergence PROPOSAL awaiting
  agent-1's ACK (their crate — no unilateral refactor).

## Evidence

- `cargo test --workspace`: 99 passed / 0 failed (unchanged)
- `cargo check --workspace --all-targets`: no warnings
- `contract_conformance.mjs`: 43/43; `rust_conformance_audit.py`: PASS 7/7
- `boundary_audit.py`: PASS; `run_gate.sh --offline-only`: offline PASS
  (live 11/11 NOT RUN — no docker, as before)
- `phase3-rust-acceptance.sh --force`: PASS (record refreshed post-commit)
- Bus: `connection-bus-outbox.json` `C3-MSG-06` (NOT_DELIVERED, orchestrator flush)

## Notes for reviewers

- Survey findings that needed NO action: ISSUE-017 CLOSED in-doc with
  the D-04 pin live; ISSUE-022 correction 1 already reflected in port,
  test, and golden; checksum/D-08/timezone review items all landed;
  ISSUE-021 and the aff7 scheduler track are out of this line's scope.
