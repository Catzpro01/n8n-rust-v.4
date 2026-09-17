# 05-cyclic-invalid — NEGATIVE golden fixture

`A → B → C → A`. This workflow is **structurally fine but must be REJECTED** by
`CycleDetection` (Validation LEGO, contract §4.4 / §11.8 — `main` edges only).

Per the `-invalid` directory convention (see `tests/compatibility/contract_conformance.mjs`),
a fixture with this suffix is a negative case: the gate treats the acyclic assertion as
inverted — the cycle MUST be detected, and accepting the fixture is a failure.

Consumed by: `crates/n8n-validation/tests/validation_fixtures.rs`
(cycle detection from disk, `validate_workflow` strict vs. default) and the offline
contract-conformance gate.
