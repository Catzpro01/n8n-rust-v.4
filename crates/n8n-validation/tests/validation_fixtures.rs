//! Golden-fixture conformance for the Validation port (R1/R5).
//!
//! FAIL-LOUD like the sibling harnesses: a missing fixture is a test failure, not a
//! skip. The negative fixture `tests/reference/05-cyclic-invalid/` is read from disk:
//! editing that JSON or stubbing `detect_cycles` to `Ok(())` turns the suite red
//! (R5 — a cycle detector that accepts everything cannot pass).

use n8n_validation::{
    check_cycles, check_dangling_connections, detect_cycles, validate_node_uniqueness,
    validate_workflow, ValidationCode, ValidationError,
};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn read_json(relative: &str) -> Value {
    let path = repo_root().join(relative);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing fixture {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("fixture {} is not valid JSON: {error}", path.display()))
}

fn names_of(workflow: &Value) -> Vec<String> {
    workflow["nodes"]
        .as_array()
        .expect("golden nodes array")
        .iter()
        .map(|node| node["name"].as_str().expect("golden node name").to_string())
        .collect()
}

/// R5: the cyclic negative fixture MUST be rejected — both by the Result-flavoured
/// detector (typed connections) and by the contract aggregate's strict mode.
#[test]
fn cyclic_fixture_is_rejected_with_cycle_detected() {
    let workflow = read_json("tests/reference/05-cyclic-invalid/workflow.json");
    let expected = read_json("tests/reference/05-cyclic-invalid/expected.json");
    let names = names_of(&workflow);

    // strict aggregate mode (allowCycles: false)
    let strict = validate_workflow(&workflow, Some(false));
    assert!(!strict.valid, "cyclic fixture must be invalid in strict mode");
    assert_eq!(
        strict.errors[0].code,
        ValidationCode::CycleDetected,
        "first error must be the cycle"
    );
    let golden = &expected["cases"]["cycle-detected"]["expected"];
    assert_eq!(strict.errors[0].node.as_deref(), golden["node"].as_str());
    assert!(
        strict.errors[0]
            .message
            .starts_with(golden["message_prefix"].as_str().expect("prefix")),
        "message must match the contract shape: {}",
        strict.errors[0].message
    );

    // typed detector over the deserialised connection map
    let connections = serde_json::from_value(workflow["connections"].clone())
        .expect("golden connections deserialise");
    assert!(matches!(
        detect_cycles(&names, &connections),
        Err(ValidationError::CycleDetected(_))
    ));
}

/// The positive counterpart: the same file under the contract's DEFAULT options
/// validates clean (cycles are legal by default — contract §11.7), and the declared
/// `validate-workflow-default-allows-cycles` case agrees.
#[test]
fn cyclic_fixture_passes_under_reference_default_options() {
    let workflow = read_json("tests/reference/05-cyclic-invalid/workflow.json");
    let expected = read_json("tests/reference/05-cyclic-invalid/expected.json");
    let golden = &expected["cases"]["validate-workflow-default-allows-cycles"]["expected"];
    assert_eq!(golden["valid"], Value::Bool(true));

    let report = validate_workflow(&workflow, None);
    assert!(report.valid, "default options must allow cycles: {:?}", report.errors);
}

/// Guard the guard: the linear golden stays accepted — the negative assertion above is
/// not vacuous because an always-rejecting validator fails here.
#[test]
fn acyclic_fixture_is_accepted() {
    let workflow = read_json("tests/reference/03-linear/workflow.json");
    let names = names_of(&workflow);
    let name_set: HashSet<&str> = names.iter().map(String::as_str).collect();

    assert!(validate_node_uniqueness(&names).is_ok());
    assert!(check_dangling_connections(&name_set, workflow.get("connections")).is_empty());
    assert!(check_cycles(&names, workflow.get("connections")).is_empty());
    assert!(validate_workflow(&workflow, Some(false)).valid);
}

/// The four contract codes all have fixture coverage somewhere in the suite: the gate
/// review (ISSUE-012/P3) found the port implementing 3 of 4 — `INVALID_CONNECTION_TYPE`
/// is exercised here against a golden-shaped connection map.
#[test]
fn invalid_connection_type_fixture_shape_is_rejected() {
    let workflow = serde_json::json!({
        "nodes": [{"name": "A"}, {"name": "B"}],
        "connections": {
            "A": { "bogus": [[{"node": "B", "type": "bogus", "index": 0}]] }
        }
    });
    let report = validate_workflow(&workflow, None);
    assert!(!report.valid);
    let codes: Vec<ValidationCode> = report.errors.iter().map(|e| e.code).collect();
    assert_eq!(
        codes.iter().filter(|c| **c == ValidationCode::InvalidConnectionType).count(),
        2,
        "the type key AND the target type are both reported: {codes:?}"
    );
}
