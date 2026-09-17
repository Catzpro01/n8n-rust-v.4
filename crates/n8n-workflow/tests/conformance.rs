//! Golden-fixture conformance for the Workflow port.
//!
//! Every fixture is **required**: a missing file is a hard failure, never an early `return`.
//! An early `return` is a PASS in cargo's eyes, so "skip when absent" silently turned a deleted
//! golden fixture into a green suite (`docs/isolation/CROSS-AGENT-ISSUES.md`, ISSUE-014 defect 2).

use n8n_node_model::INode;
use n8n_validation::{check_node_uniqueness, detect_cycles, OrderedValue};
use n8n_workflow::Workflow;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn fixture(name: &str) -> Value {
    // `CARGO_MANIFEST_DIR` rather than a relative path, so the suite behaves the same whether
    // cargo runs it from the crate directory or from the workspace root.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("reference")
        .join(name)
        .join("workflow.json");
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing golden fixture {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("cannot parse {}: {error}", path.display()))
}

fn nodes_of(json: &Value) -> Vec<INode> {
    serde_json::from_value(json["nodes"].clone()).expect("fixture nodes")
}

#[test]
fn test_fixture_empty_workflow() {
    let json = fixture("01-empty-workflow");
    let nodes = nodes_of(&json);
    let node_names: Vec<String> = nodes.iter().map(|n| n.name.clone()).collect();

    assert_eq!(nodes.len(), 0);
    assert!(check_node_uniqueness(&node_names).is_empty());
}

#[test]
fn test_fixture_linear_workflow() {
    let json = fixture("03-linear");
    let nodes = nodes_of(&json);
    let node_names: Vec<String> = nodes.iter().map(|n| n.name.clone()).collect();

    assert_eq!(nodes.len(), 2);
    assert!(check_node_uniqueness(&node_names).is_empty());
}

/// The golden linear workflow, driven through the aggregate: two nodes, one `main` edge, and the
/// destination index derived at construction.
#[test]
fn test_fixture_linear_workflow_traverses() {
    let json = fixture("03-linear");
    let workflow = Workflow::from_wire(&json).expect("wire parses");

    assert_eq!(workflow.node_count(), 2);
    assert_eq!(
        workflow
            .get_child_nodes("Manual Trigger", n8n_workflow::ConnectionTypeFilter::main(), -1),
        vec!["Code"]
    );
    assert_eq!(
        workflow.get_parent_nodes("Code", n8n_workflow::ConnectionTypeFilter::main(), -1),
        vec!["Manual Trigger"]
    );
}

/// The one-node golden fixture: a single node is its own start node (`workflow.ts:825-829`,
/// pinned by `tests/reference/start-node` case D-06).
#[test]
fn test_fixture_one_node_starts_at_itself() {
    let json = fixture("02-one-node");
    let workflow = Workflow::from_wire(&json).expect("wire parses");
    let nodes = nodes_of(&json);
    assert_eq!(nodes.len(), 1);

    let start = workflow
        .get_start_node(None, None)
        .expect("getStartNode")
        .expect("a single enabled node is its own start node");
    assert_eq!(start.name, nodes[0].name);
}

/// The disabled-node golden fixture: the disabled trigger must **not** be the start node
/// (`workflow.ts:839`), and the walk from the leaf reports no enabled ancestor.
#[test]
fn test_fixture_disabled_node_is_not_a_start_node() {
    let json = fixture("04-disabled-node");
    let workflow = Workflow::from_wire(&json).expect("wire parses");

    let disabled = workflow.get_node("Manual Trigger").expect("trigger exists");
    assert_eq!(disabled.disabled, Some(true));

    assert!(
        workflow.get_start_node(None, None).expect("getStartNode").is_none(),
        "a disabled trigger must not start the workflow (ISSUE-017)"
    );
    assert_eq!(
        workflow.get_highest_node("Code").expect("getHighestNode"),
        Vec::<String>::new()
    );

    let node_names: Vec<String> = nodes_of(&json).iter().map(|n| n.name.clone()).collect();
    assert!(check_node_uniqueness(&node_names).is_empty());
}

/// Negative golden fixture: `A -> B -> C -> A` MUST be rejected. Without this, a `detect_cycles`
/// hardcoded to `Ok(())` would pass every fixture-driven test (ISSUE-012 / R5).
#[test]
fn test_fixture_cyclic_workflow_is_rejected() {
    let json = fixture("05-cyclic-invalid");
    let nodes = nodes_of(&json);
    let node_names: Vec<String> = nodes.iter().map(|n| n.name.clone()).collect();
    assert_eq!(node_names, vec!["A", "B", "C"]);

    let connections: OrderedValue =
        serde_json::from_value(json["connections"].clone()).expect("connections");
    let errors = detect_cycles(&node_names, &connections);
    assert!(!errors.is_empty(), "the negative fixture must be rejected as cyclic");
    assert!(
        errors
            .iter()
            .all(|e| e.code == n8n_validation::ValidationErrorCode::CycleDetected),
        "unexpected errors: {errors:?}"
    );
}
