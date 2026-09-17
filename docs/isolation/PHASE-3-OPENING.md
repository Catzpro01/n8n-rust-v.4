# DECISION RECORD — Phase 3 formally opened (Reference Test & Rust Contract Implementation)

- **Date:** 2026-09-17
- **Decided by:** port owner / orchestrator continuation on `arena/01a0ace4-n8n-rust-v-4`
  (the branch that carries the Phase-3 workspace)
- **Resolves:** ISSUE-012 required decision #1 ("Formally open Phase 3 with a manifest/decision
  record, or revert the Rust commits"); unblocks the integration gate's Phase-2 guard in a
  documented way.
- **Effect on the gate:** `tests/compatibility/contract_conformance.mjs` and
  `tests/integration/boundary_audit.py` switch their Rust guard from *“no Rust in Phase 2”* to
  the Phase-3 rules below **iff this file exists**. Deleting this file reinstates the Phase-2
  guard and turns the gate red while `crates/**` is present — the gate cannot be silenced
  without deleting the record itself.

## Phase-3 rules enforced by the gate

1. `crates/**` and `apps/n8n-rust/**` may contain Rust.
2. **PROJECT_RULES §5 is the gate, not a guideline:** at least one Rust test under `crates/`
   must consume `tests/reference/**` fixtures. A Rust workspace with zero reference-driven
   tests fails the guard exactly as a Rust file in Phase 2 did.
3. `reference/n8n/**` stays byte-frozen: `node tools/workflow-reference-manifest.mjs --check`
   must keep reporting `PASS (15050 files, root f8da35180669…)`. A dirty reference tree fails
   the gate regardless of phase.

## Preconditions at opening time (verified 2026-09-17, on this branch)

| # | Precondition (ISSUE-012) | Evidence |
| :-- | :--- | :--- |
| 1 | ISSUE-011 closed — reference tree back to the pinned 15 050 | `node tools/workflow-reference-manifest.mjs --check` → `PASS (15050 files, root f8da35180669d798…)` (re-run this session) |
| 2 | Compatibility tests driving crates from `tests/reference/**` | `crates/n8n-workflow/tests/reference_fixtures.rs` (workflow-rust fixtures, 5 suites), `crates/n8n-workflow/tests/conformance.rs` (01-empty, 03-linear — silent-skips removed), `crates/n8n-workflow/tests/disabled_node.rs` (04-disabled-node, 11 probes), `crates/n8n-validation/tests/cyclic_invalid.rs` (05-cyclic-invalid) |
| 3 | `INVALID_CONNECTION_TYPE` implemented (4 of 4 contract codes) | `crates/n8n-validation/src/lib.rs` — golden case D5 covered by unit tests; type vocabulary `NODE_CONNECTION_TYPES` in `crates/n8n-connection` mirrors `interfaces.ts:2249` |
| 4 | `cargo` in the verification environment | `tools/rust-offline-rig/` — toolchain 1.88.0 via npm, 20 crates vendored from pinned git tags (`indexmap`/`regex` closure added this session); `cargo test --workspace` = **45 passed, 0 failed** |
| 5 | Phase-2 behaviour verdict unchanged | All Phase-2 evidence untouched; no reference file modified (manifest check above) |

## Behaviour fixes that landed with this record

| Issue | Fix |
| :--- | :--- |
| ISSUE-015 (corrected scope) | `Workflow::get_highest_node` ported faithfully — strict `disabled === false` self-role (`workflow.ts:498`), lenient `!== true` parent role (`:553`), checked-nodes and per-index filtering; disabled mid-chain nodes are transparent. Plain traversal stays disabled-blind (scope-guarded by `04-disabled-node/expected.json`). |
| ISSUE-017 | D-04 asymmetry reproduced and unit-tested (`d04_asymmetry_between_self_and_parent_roles`). |
| ISSUE-016 (accessor part) | `Workflow::get_pin_data_of_node` per `workflow.ts:331`; **execution-time substitution stays deferred to the execution LEGO**. |
| (new, found in-port) | `START_NODE_TYPES` replaced with the real 2.9.4 `STARTING_NODE_TYPES` (`constants.ts:53`); `getStartNode`/`__getStartNode` ported incl. the disabled skip at `:839`/`:853` and the no-disabled-check fallback `nodes[nodeNames[0]]` (`:862-864`). |
| (new, found in-port) | `detect_cycles` now runs on the **`main`** graph only, ignores edges from/to unknown nodes (golden D8), and reports the deterministic path message `Cycle detected: A → B → C → A` (golden D7). |
| ISSUE-012 blocker 1 | `conformance.rs` no longer returns silently on a missing fixture — missing/unparsable fixtures fail the test. |

## Known gaps at opening (recorded, not hidden)

- `getStartNode`'s trigger/poll loop (`workflow.ts:828-844`) needs the node-type registry,
  which the Workflow LEGO does not own — documented divergence in `crates/n8n-workflow/src/lib.rs`.
- Message parity for `DUPLICATE_NODE_NAME` / `DANGLING_CONNECTION` / `INVALID_CONNECTION_TYPE`
  against `workflow-rules.ts` is asserted only for `CYCLE_DETECTED` (D7).
- `crates/n8n-expression`, `n8n-execution-data`, `n8n-node-model`, `n8n-common` have no
  reference-driven integration tests yet — their ported behaviour is exercised by unit tests
  only; Phase 3 must close this crate by crate.
- The rig is a repacked toolchain: `cargo check`/`test` on the VPS with the real registry is
  still required before any live-verified verdict (PROJECT_RULES §10).
- The offline gate here is `--offline-only`: the 11/11 live regression stays **NOT RUN**
  until a live n8n + PostgreSQL host is attached.
