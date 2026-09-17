//! ISSUE-012 / R5 compatibility test: `tests/reference/05-cyclic-invalid/` must be *consumed*,
//! not just stored. A dropped or regressed `CYCLE_DETECTED` rule has to fail here loudly.
//!
//! The expected error (contract shape in `expected.json`): `CYCLE_DETECTED` with the
//! deterministic path message `Cycle detected: A → B → C → A` (`workflow-rules.ts`
//! `detectCycles`, golden case D7).

use n8n_connection::WorkflowConnections;
use n8n_validation::{detect_cycles_fail_fast, validate_dangling_connections, validate_node_uniqueness, ValidationError};
use serde_json::Value;
use std::fs;
use std::path::Path;

#[test]
fn cyclic_fixture_is_rejected_with_the_reference_path_message() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/reference/05-cyclic-invalid");
    for name in ["case.json", "expected.json"] {
        let path = root.join(name);
        assert!(
            path.exists(),
            "negative fixture missing: {} — the gate cannot trust a green cyclic test without it",
            path.display()
        );
    }
    let case: Value = serde_json::from_str(
        &fs::read_to_string(root.join("case.json")).expect("cannot read case.json"),
    )
    .expect("case.json is not valid JSON");
    let expected: Value = serde_json::from_str(
        &fs::read_to_string(root.join("expected.json")).expect("cannot read expected.json"),
    )
    .expect("expected.json is not valid JSON");

    let nodes: Vec<String> = case["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .map(|n| n["name"].as_str().expect("node name").to_string())
        .collect();
    let connections: WorkflowConnections =
        serde_json::from_value(case["connections"].clone()).expect("connections");

    // The fixture is structurally valid: ONLY the cycle rule may fire.
    assert!(validate_node_uniqueness(&nodes).is_ok());
    assert!(validate_dangling_connections(&nodes, &connections).is_ok());

    // …and the cycle must be reported with the reference's deterministic path message
    // (the `message` field of the contract-shaped error in expected.json).
    let expected_message = expected["errors"][0]["message"]
        .as_str()
        .expect("expected.json errors[0].message");
    let expected_code = expected["errors"][0]["code"].as_str().expect("errors[0].code");

    let error = detect_cycles_fail_fast(&nodes, &connections).expect_err("cycle fixture must be rejected");
    assert_eq!(expected_code, "CYCLE_DETECTED");
    assert_eq!(
        error.to_string(),
        expected_message,
        "cycle message diverges from the reference trace"
    );
    match &error {
        ValidationError::CycleDetected(path) => {
            assert_eq!(path, "A → B → C → A");
        }
        other => panic!("expected CycleDetected, got {other:?}"),
    }
}
