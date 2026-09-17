# TASK-408 — Suite strength audit (mutation testing): result record

- Manifest: `tasks/TASK-408-suite-strength-audit.yaml`
- Code commit: `22290d4f` (manifest + VL4 pin; suite 99 → 100)
- Method: 28 mutants (4 per crate × 7 crates), one live at a time, full
  `tools/rust-offline-rig/run.sh test` per mutant, immediate
  `git checkout -- <file>` + `git status --porcelain -- <file>` assert per
  mutant (runner: `/tmp/mutate.py`, scratch, never committed; raw verdicts:
  `/tmp/mutation.log`, scratch).
- Baseline before audit: 99/99 green at `9c7dc8d7`.
- Final state: **100/100**, `contract_conformance.mjs` 43/43,
  `rust_conformance_audit.py` 7/7, `boundary_audit.py` PASS,
  `phase3-rust-acceptance.sh` PASS (record refreshed, head `22290d4f`).

## Score

- 26/28 killed outright by the 99-suite (all kills genuine behavioral test
  failures; zero `KILLED-compile`, zero `UNCLEAR`, zero `SETUP-FAIL` — every
  pattern matched exactly once).
- 1 survivor = real gap (VL4) → pinned with a unit test, kill-verified
  (mutant re-applied on the committed pin: new test FAILS, exit 101;
  reverted, tree pristine).
- 1 survivor = equivalent mutant (CM2) → documented, no pin.
- Effective: **27/28 meaningful kills (96.4%)**.

## Mutant table (ground truth from the runner + log)

| ID | Crate | Mutation (class) | Verdict | Killer(s) |
|----|-------|------------------|---------|-----------|
| CM1 | common | remove `#[serde(flatten)]` on `extra` (defensive-code removal) | KILLED (3) | `every_binary_item_in_the_golden_fixture_survives`, `the_golden_binary_payload_round_trips_without_losing_fields`, `the_item_envelope_omits_absent_keys` |
| CM2 | common | `BinaryItem` field reorder (`data` first → serde key order) (order change) | SURVIVED → EQUIVALENT | — |
| CM3 | common | drop `rename = "pairedItem"` (key rename removal) | KILLED (2) | `item_order_is_preserved`, `the_item_envelope_omits_absent_keys` |
| CM4 | common | drop `skip_serializing_if` on `fileSize` (branch removal) | KILLED (1) | `execution_fixtures_match_reference_leaves` |
| WF1 | workflow/checksum | drop `sort_object_keys` (defensive-code removal) | KILLED (1) | `checksum_matches_the_reference_runtime` |
| WF2 | workflow/checksum | `.get(field)` → `.get(field).filter(!null)` (boundary shift: absent≡null) | KILLED (1) | `checksum::tests::payload_skips_absent_fields_and_keeps_nulls` |
| WF3 | workflow | rename rebuilds destination index (removes D-08 stale-index quirk) (branch removal) | KILLED (1) | `tests::rename_rewrites_expressions_and_keeps_the_destination_index_stale` |
| WF4 | workflow | `disabled == Some(false)` → `!= Some(true)` (comparison flip) | KILLED (1) | `highest_node_matches_the_reference_runtime` |
| CN1 | connection | child `insert(0, …)` → `push(…)` (order change) | KILLED (2) | `tests::diamond_keeps_reference_order`, `tests::direct_and_indirect_child_appears_twice_like_the_reference` |
| CN2 | connection | `key != "main"` → `key == "main"` (comparison flip) | KILLED (2) | `connection_fixtures_match_the_reference`, `workflow_traversal_cases_cross_check` |
| CN3 | connection | drop `depth == 0` early return (branch removal) | KILLED (1) | `tests::depth_zero_yields_nothing_and_depth_one_yields_direct_only` |
| CN4 | connection | inversion keyed by source key instead of edge type (key swap) | KILLED (1) | `tests::inversion_keys_by_edge_type_not_source_key` |
| VL1 | validation | `!allow_cycles` → `allow_cycles` (comparison flip) | KILLED (2) | `cyclic_fixture_is_accepted_under_the_reference_default`, `cyclic_fixture_is_rejected_when_cycles_are_not_allowed` |
| VL2 | validation | duplicate path index `i` → `i + 1` (boundary shift) | KILLED (1) | `tests::test_duplicate_reports_second_index_path` |
| VL3 | validation | default `allow_cycles` true → false (default swap) | KILLED (1) | `tests::test_default_options_allow_cycles` |
| VL4 | validation | early return when uniqueness errors non-empty (short-circuit) | SURVIVED → REAL GAP → PINNED | new `tests::test_collect_all_reports_uniqueness_and_dangling_together` (kill-verified) |
| NM1 | node-model | drop `skip_serializing_if` on `Option` (branch removal) | KILLED (2) | `tests::test_disabled_absent_stays_absent`, `tests::test_unknown_fields_land_in_extra_verbatim` |
| NM2 | node-model | remove `#[serde(flatten)]` on `extra` (defensive-code removal) | KILLED (6) | extra-keys family, incl. `test_node_deserialize`, `test_unknown_fields_land_in_extra_verbatim`, `test_rename_form_fields_rewrites_html_only` |
| NM3 | node-model | `position: [Number; 2]` → `Vec<Number>` (type loosening) | KILLED (1) | `tests::test_strict_boundary_required_fields_reject` (predicted SURVIVE — suite stronger than expected: fixed arity is pinned) |
| NM4 | node-model | `"formFields"` → `"formField"` (key flip) | KILLED (1) | `tests::test_rename_form_fields_rewrites_html_only` |
| ED1 | execution-data | `parse_envelope(item)` → `Ok(envelope(item))` double-wrap (branch removal) | KILLED (1) | `tests::test_return_json_array_never_double_wraps` |
| ED2 | execution-data | error-name swap `ApplicationError` ↔ `TypeError` (error-variant swap) | KILLED (1) | `tests::test_error_names_match_reference_classes` |
| ED3 | execution-data | `has_key` null arm `Err` → `Ok(false)` (error-variant swap) | KILLED (1) | `execution_fixtures_match_reference_leaves` |
| ED4 | execution-data | drop original-`pairedItem`-wins (branch removal) | KILLED (1) | `execution_fixtures_match_reference_leaves` |
| EX1 | expression | `starts_with('=')` → `contains("{{") && contains("}}")` (comparison flip) | KILLED (3) | `test_is_expression_is_the_first_char_gate`, `test_leaf_identity_and_object_flag`, `test_leaf_maps_function_returns_and_strings` |
| EX2 | expression | constructor-call guard → `false` (defensive-code removal) | KILLED (1) | `tests::test_leaf_rejects_constructor_calls` |
| EX3 | expression | drop `", "` / `": "` spacing normalization (defensive-code removal) | KILLED (2) | `test_convert_object_spacing_and_type_names`, `test_leaf_identity_and_object_flag` |
| EX4 | expression | `return_object_as_string` → `false` (branch removal) | KILLED (1) | `walk_preserves_structure_with_a_stub_evaluator` |

## Survivor judgments

### CM2 — EQUIVALENT (no pin)

Reordering `BinaryItem` fields changes only serde's serialization key order.
Key order is unobservable through the entire contract surface:

- every round-trip assert is `assert_eq!(Value, Value)` (`serde_json::Value
  ==` ignores object key order);
- no exact-serialized-bytes assert exists anywhere (`common` tests, `tests/`,
  rig — grepped, zero `to_string() ==` comparisons);
- the normative reference compares parsed structures (deep-equal), never
  key order; JSON objects are unordered (RFC 8259 §4), and field order is
  incidental in the reference runtime, not contractual.

A key-order pin would ossify incidental behavior beyond the reference
contract, so none was added.

### VL4 — REAL GAP (pinned)

`validateWorkflow`'s normative source spreads both check parts
unconditionally (`workflow-rules.ts`:
`[...checkNodeUniqueness(wf), ...checkDanglingConnections(wf)]`), but no
test fed `validate_workflow` a graph with a duplicate name AND a dangling
connection simultaneously — the early-return mutant survived the 99-suite.
Pin (`crates/n8n-validation/src/lib.rs`,
`test_collect_all_reports_uniqueness_and_dangling_together`, unit-level,
inline JSON, no fixtures): duplicate `A` + `A → Ghost` main edge under
default options must report `[DUPLICATE_NODE_NAME, DANGLING_CONNECTION]`
in reference spread order. Kill-verified: mutant re-applied on the
committed pin → new test FAILS (exit 101) → reverted → tree pristine.

## Evidence refresh (pins landed → refresh per manifest)

- `bash tools/phase3-rust-acceptance.sh` (live run, inputs changed since
  `bd3e6950`): PASS, 100/100, `headCommit 22290d4f`.
- `fixturesReproduction` carried forward as `PASS (re-derived byte-exactly)`:
  `tests/reference/workflow-rust/fixtures.json` is byte-identical to the
  `55bdfc00` attestation (sha256 `8d9d7b9c…046a60` verified equal before
  and after), and no pinned runtime exists in this sandbox to re-derive —
  downgrading the peer's valid attestation to NOT RUN would have destroyed
  genuine evidence.
- No reference/fixture/Cargo changes; `tasks/` + `results/` + one unit test
  + the regenerated record only.

## Process notes

- Per-mutant revert was machine-verified (`git checkout --` with
  `check=True` + `git status --porcelain -- <file>` assert); final tree
  clean except the new manifest.
- The keeper pin was committed (`22290d4f`) BEFORE its kill-verification
  re-application, so the verification revert could only restore committed
  state. (An earlier uncommitted copy of the pin was wiped by a
  verification `checkout --` and re-applied identically — hence the
  commit-first discipline, now recorded.)
