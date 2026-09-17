//! `getStartNode` / `getHighestNode` conformance — ISSUE-017.
//!
//! The golden values come from `tests/reference/start-node/fixtures.json`, derived from the pinned
//! reference runtime by `tests/reference/start-node/build-fixtures.mjs` (`--check` re-derives and
//! fails on drift). They exist because the reference is **asymmetric** about `disabled`:
//!
//! * `workflow.ts:498` — the starting node is its own highest only when `disabled === false`;
//! * `workflow.ts:553` — a parent counts when `disabled !== true`;
//! * `workflow.ts:825` — a single start candidate counts when `!disabled`;
//! * `workflow.ts:839` / `:853` — trigger/poll and `STARTING_NODE_TYPES` candidates are skipped
//!   when `disabled === true`.
//!
//! A port that collapses those into one `!disabled` test passes a hand-written fixture and fails
//! this one. Case counts are asserted so a growing fixture file cannot be silently skipped, and a
//! missing fixture file is a hard failure rather than an early `return` (ISSUE-014 defect 2).

use n8n_workflow::{NodeTypes, Workflow, WorkflowError};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const CASES: usize = 14;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

fn fixtures() -> Value {
    let path = repo_root().join("tests/reference/start-node/fixtures.json");
    let text = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "missing golden fixture {}: {error}. Run `node tests/reference/start-node/build-fixtures.mjs`.",
            path.display()
        )
    });
    serde_json::from_str(&text).expect("start-node fixtures parse")
}

/// The registry the fixture declares: `triggerTypes` are triggers, everything else is unknown to
/// the registry except that `__getStartNode` needs a `description.name` for every lookup it makes.
/// The reference harness (`tests/reference/harness/connection.js`) answers for every type, so the
/// port's stand-in does the same and reports `trigger` exactly for the declared list.
struct FixtureRegistry {
    triggers: HashMap<String, bool>,
}

impl NodeTypes for FixtureRegistry {
    fn describe(&self, node_type: &str, _type_version: f64) -> Option<(String, bool, bool)> {
        let is_trigger = self.triggers.get(node_type).copied().unwrap_or(false);
        Some((node_type.to_string(), is_trigger, false))
    }
}

fn workflow_from_case(kase: &Value) -> Workflow {
    Workflow::new(
        Some("wf-start-node".into()),
        Some("Start Node".into()),
        serde_json::from_value(kase["nodes"].clone()).expect("case nodes"),
        serde_json::from_value(kase["connections"].clone()).expect("case connections"),
        false,
        Some(json!({})),
        None,
        None,
    )
}

fn registry_from_case(kase: &Value) -> FixtureRegistry {
    let mut triggers = HashMap::new();
    for node in kase["nodes"].as_array().expect("nodes array") {
        let node_type = node["type"].as_str().expect("node type").to_string();
        let declared = kase["triggerTypes"]
            .as_array()
            .expect("triggerTypes")
            .iter()
            .any(|declared| declared.as_str() == Some(node_type.as_str()));
        triggers.insert(node_type, declared);
    }
    FixtureRegistry { triggers }
}

#[test]
fn start_node_matches_the_reference_runtime() {
    let fixtures = fixtures();
    let cases = fixtures["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), CASES, "start-node case count");

    for kase in cases {
        let id = kase["id"].as_str().expect("id");
        let workflow = workflow_from_case(kase);
        let registry = registry_from_case(kase);

        let expected = kase["startNode"].as_str();
        let actual = workflow
            .get_start_node(None, Some(&registry))
            .unwrap_or_else(|error| panic!("{id}: getStartNode() failed: {error}"))
            .map(|node| node.name.clone());
        assert_eq!(actual.as_deref(), expected, "{id}: getStartNode()");

        if let Some(destination) = kase.get("destination").and_then(Value::as_str) {
            let expected = kase["startNodeOfDestination"].as_str();
            let actual = workflow
                .get_start_node(Some(destination), Some(&registry))
                .unwrap_or_else(|error| panic!("{id}: getStartNode({destination}) failed: {error}"))
                .map(|node| node.name.clone());
            assert_eq!(actual.as_deref(), expected, "{id}: getStartNode({destination})");
        }
    }
}

#[test]
fn highest_node_matches_the_reference_runtime() {
    let fixtures = fixtures();
    let cases = fixtures["cases"].as_array().expect("cases");

    let mut checked = 0usize;
    for kase in cases {
        let id = kase["id"].as_str().expect("id");
        let workflow = workflow_from_case(kase);

        if let Some(name) = kase.get("highestOf").and_then(Value::as_str) {
            let expected: Vec<String> = serde_json::from_value(kase["highestNodes"].clone())
                .expect("highestNodes");
            let actual = workflow
                .get_highest_node(name)
                .unwrap_or_else(|error| panic!("{id}: getHighestNode({name}) failed: {error}"));
            assert_eq!(actual, expected, "{id}: getHighestNode({name})");
            checked += 1;
        }

        if let Some(name) = kase.get("highestOfSelf").and_then(Value::as_str) {
            let expected: Vec<String> = serde_json::from_value(kase["highestNodesOfSelf"].clone())
                .expect("highestNodesOfSelf");
            let actual = workflow
                .get_highest_node(name)
                .unwrap_or_else(|error| panic!("{id}: getHighestNode({name}) failed: {error}"));
            assert_eq!(actual, expected, "{id}: getHighestNode({name}) — the D-04 asymmetry");
            checked += 1;
        }

        if let Some(name) = kase.get("highestOfUnknown").and_then(Value::as_str) {
            let expected = kase["highestUnknownThrows"].as_str().expect("throws a TypeError");
            let error = workflow
                .get_highest_node(name)
                .expect_err(&format!("{id}: getHighestNode({name}) must throw"));
            assert_eq!(error.error_name(), expected, "{id}: error class");
            assert!(matches!(error, WorkflowError::UnknownNode { .. }));
            checked += 1;
        }
    }

    // Guard against the assertions above silently covering nothing.
    assert!(checked >= 10, "expected at least 10 highest-node assertions, ran {checked}");
}
