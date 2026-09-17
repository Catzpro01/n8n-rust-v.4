use n8n_connection::WorkflowConnections;
use n8n_node_model::INode;
use n8n_validation::{
    detect_cycles, validate_connection_types, validate_dangling_connections,
    validate_node_uniqueness,
};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/reference")
        .join(name)
        .join("workflow.json")
}

fn read_fixture(name: &str) -> Value {
    let path = fixture_path(name);
    let content = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("required reference fixture {}: {error}", path.display()));
    serde_json::from_str(&content)
        .unwrap_or_else(|error| panic!("invalid reference fixture {}: {error}", path.display()))
}

fn fixture_parts(name: &str) -> (Vec<INode>, Vec<String>, WorkflowConnections) {
    let json = read_fixture(name);
    let nodes: Vec<INode> = serde_json::from_value(
        json.get("nodes")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
    )
    .unwrap_or_else(|error| panic!("invalid nodes in {name}: {error}"));
    let node_names = nodes.iter().map(|node| node.name.clone()).collect();
    let connections: WorkflowConnections = serde_json::from_value(
        json.get("connections")
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default())),
    )
    .unwrap_or_else(|error| panic!("invalid connections in {name}: {error}"));
    (nodes, node_names, connections)
}

fn assert_valid_workflow_fixture(name: &str, expected_nodes: usize) {
    let (nodes, node_names, connections) = fixture_parts(name);
    assert_eq!(nodes.len(), expected_nodes, "node count for {name}");
    assert!(
        validate_node_uniqueness(&node_names).is_ok(),
        "duplicate node name in {name}"
    );
    assert!(
        validate_dangling_connections(&node_names, &connections).is_ok(),
        "dangling connection in {name}"
    );
    assert!(
        validate_connection_types(&connections).is_ok(),
        "invalid connection type in {name}"
    );
    assert!(
        detect_cycles(&node_names, &connections).is_ok(),
        "unexpected cycle in {name}"
    );
}

#[test]
fn reference_empty_workflow_is_consumed_and_validated() {
    assert_valid_workflow_fixture("01-empty-workflow", 0);
}

#[test]
fn reference_linear_workflow_is_consumed_and_validated() {
    assert_valid_workflow_fixture("03-linear", 2);
}

#[test]
fn reference_negative_cycle_fixture_is_rejected() {
    let (nodes, node_names, connections) = fixture_parts("05-cyclic-invalid");
    assert_eq!(nodes.len(), 3);
    assert!(validate_node_uniqueness(&node_names).is_ok());
    assert!(validate_dangling_connections(&node_names, &connections).is_ok());
    assert!(validate_connection_types(&connections).is_ok());
    assert!(
        detect_cycles(&node_names, &connections).is_err(),
        "negative fixture was accepted as acyclic"
    );
}
