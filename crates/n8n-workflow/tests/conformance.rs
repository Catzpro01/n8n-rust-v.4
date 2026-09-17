//! Compatibility tests driving the Rust Workflow port from the golden fixtures under
//! `tests/reference/` (PROJECT_RULES §5).
//!
//! ISSUE-012 (blocker 1): these used to `return;` when a fixture file was missing, so a
//! deleted or never-integrated fixture silently PASSED. A missing fixture is now a hard
//! failure — the gate must be able to trust green.

use n8n_connection::WorkflowConnections;
use n8n_node_model::INode;
use n8n_validation::{detect_cycles_fail_fast, validate_dangling_connections, validate_node_uniqueness};
use serde_json::Value;
use std::fs;
use std::path::Path;

fn read_fixture(path: &str) -> serde_json::Value {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
    let content = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("reference fixture missing/unreadable: {} ({e})", fixture_path.display()));
    serde_json::from_str(&content)
        .unwrap_or_else(|e| panic!("reference fixture is not valid JSON: {} ({e})", fixture_path.display()))
}

/// Full validator chain on a *positive* fixture (adopted from the sibling worker cycle's
/// conformance rewrite, on top of this crate's loud-failure fixture reader): a golden
/// positive workflow must pass uniqueness AND dangling/type AND cycle rules.
fn assert_positive_fixture_fully_valid(name: &str, expected_nodes: usize) {
    let json = read_fixture(&format!("../../tests/reference/{name}/workflow.json"));

    let nodes: Vec<INode> = serde_json::from_value(json["nodes"].clone())
        .expect("fixture nodes do not deserialize into INode");
    let node_names: Vec<String> = nodes.iter().map(|n| n.name.clone()).collect();
    let connections: WorkflowConnections =
        serde_json::from_value(json.get("connections").cloned().unwrap_or(serde_json::json!({})))
            .expect("fixture connections do not deserialize");

    assert_eq!(nodes.len(), expected_nodes, "node count for {name}");
    assert!(validate_node_uniqueness(&node_names).is_ok(), "{name}: uniqueness");
    assert!(
        validate_dangling_connections(&node_names, &connections).is_ok(),
        "{name}: dangling/connection-type rules"
    );
    assert!(detect_cycles_fail_fast(&node_names, &connections).is_ok(), "{name}: acyclic");
}

#[test]
fn test_fixture_empty_workflow() {
    assert_positive_fixture_fully_valid("01-empty-workflow", 0);
}

#[test]
fn test_fixture_linear_workflow() {
    assert_positive_fixture_fully_valid("03-linear", 2);
}
