# TASK-403 validation-conformance — result: SUCCESS

Agent-4 / LEGO validation. `n8n-validation` unified on the normative
`workflow-rules.ts` API (contract §4.4/§10), pinned by 34 generated fixtures.

## What changed

- **`crates/n8n-validation` rewritten** (`src/lib.rs`, `Cargo.toml`,
  `tests/validation_fixtures.rs`): exact port of `checkNodeUniqueness` /
  `checkDanglingConnections` / `detectCycles` / `validateWorkflow` with
  `ValidationError{Code,Message,Node,Path}`, `ValidationReport`,
  `ValidateOptions { allow_cycles default true }`, `NODE_CONNECTION_TYPES`
  (13). Fixes two divergences of the old helpers: cycles walked *all* types
  (rule is main-only §11.8) and only the first error was reported (rule is
  collect-all with `INVALID_INPUT` / `INVALID_CONNECTION_TYPE` codes).
- **Inputs are `OrderedValue`** (new `IndexMap`-backed JSON value, manual
  `Deserialize`/`Serialize`), not `serde_json::Value`: collect-all error
  order follows insertion order (fixture X15). `serde_json/preserve_order`
  was tried and reverted — it unifies workspace-wide and silently broke
  `n8n-workflow`'s checksum (canonicalisation relies on the `BTreeMap`
  backend). Observation passed to agent-1 via outbox; LEGO 01 untouched.
- **Fixtures generated, not transcribed**:
  `tests/reference/agent-4/validation/build-fixtures.mjs` executes the D-case
  inputs plus X1–X15 guard probes against `workflow-rules.ts` itself and
  writes `fixtures.json` (`--check` byte-compares, stable). Rust harness
  asserts all 34 + input-immutability + pinned count.
- **Downstream migration** (surgical, noticed): `crates/n8n-workflow/tests/conformance.rs`
  3-line migration to `check_node_uniqueness(...).is_empty()`; dep line kept.

## Evidence

- `cargo test --workspace`: 49 passed / 0 failed (validation: 8 unit + 1 fixture test over 34 cases)
- `cargo check`: no warnings; TS `validation.test.ts`: 6 pass / 4 runtime-skips / 0 fail
- `contract_conformance.mjs`: 24/24; `boundary_audit.py`: PASS
- `phase3-rust-acceptance.sh --force`: PASS (record refreshed; fixtures reproduction byte-exact)
- Doc: `docs/isolation/validation.md` §7; bus: `validation-bus-outbox.json` `A4-MSG-04` (NOT_DELIVERED, orchestrator flush)

## Notes for reviewers

- The acceptance script's fixture-reproduction covers only `workflow-rust/fixtures.json`
  (shared gate tooling, out of scope); validation fixtures are enforced by the
  generator's `--check` convention plus the harness's pinned case count.
- Behavioural surface is additive/opt-in per contract §10 — regression gate unaffected.
