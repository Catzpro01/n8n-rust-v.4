//! Conformance smoke for the golden workflow fixtures.
//!
//! FAIL-LOUD (ISSUE-014 defect 2): a missing or unreadable fixture is a failure, never
//! a skip — deleting golden data turns the suite red. Paths are resolved from
//! `CARGO_MANIFEST_DIR` so the tests run identically from the repo root, the crate dir
//! and the offline rig copy (which mirrors `tests/reference`).

use n8n_node_model::INode;
use n8n_validation::validate_node_uniqueness;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn golden_workflow(name: &str) -> Value {
    let path = repo_root()
        .join("tests")
        .join("reference")
        .join(name)
        .join("workflow.json");
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing golden fixture {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("golden fixture {} is not valid JSON: {error}", path.display()))
}

fn node_names(workflow: &Value) -> Vec<String> {
    let nodes: Vec<INode> = serde_json::from_value(workflow["nodes"].clone())
        .expect("golden nodes deserialise as INode");
    nodes.iter().map(|node| node.name.clone()).collect()
}

#[test]
fn empty_workflow_fixture_is_schema_sound() {
    let workflow = golden_workflow("01-empty-workflow");
    let nodes: Vec<INode> =
        serde_json::from_value(workflow["nodes"].clone()).expect("nodes deserialise");
    assert_eq!(nodes.len(), 0);
    assert!(validate_node_uniqueness(&node_names(&workflow)).is_ok());
}

#[test]
fn linear_workflow_fixture_is_schema_sound() {
    let workflow = golden_workflow("03-linear");
    let nodes: Vec<INode> =
        serde_json::from_value(workflow["nodes"].clone()).expect("nodes deserialise");
    assert_eq!(nodes.len(), 2);
    assert!(validate_node_uniqueness(&node_names(&workflow)).is_ok());
}
