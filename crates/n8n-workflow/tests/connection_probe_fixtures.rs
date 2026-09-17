//! Probe runner for `tests/reference/connection/01..05` (Agent-3 golden cases, pinned against
//! the n8n 2.9.4 runtime). Implements the `wf.*` / traversal / map ops the Workflow LEGO owns
//! (per `docs/isolation/connection-workflow-members-spec.md` — the five members hand-off).
//!
//! No silent skips: every probe must be either EXECUTED or on the explicit SKIP list (with
//! owner + reason). An unknown op FAILS the run.

use n8n_workflow::{compare_connections, ConnectionTypeFilter, Workflow};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const CASES: [&str; 5] = [
    "01-linear",
    "02-multi-output",
    "03-connection-types",
    "04-cycle",
    "05-connections-diff",
];

/// Ops owned by the Connection graph-utils LEGO (Agent 3, `n8n-connection` / graph-utils.ts) —
/// not the Workflow port's to implement. Tracked so their absence is visible, not silent.
const SKIPPED_OPS: [(&str, &str); 6] = [
    ("hasPath", "Connection LEGO (graph-utils.ts) — Agent 3"),
    ("parseExtractable", "Connection LEGO (graph-utils.ts) — Agent 3"),
    ("getInputEdges", "Connection LEGO (graph-utils.ts) — Agent 3"),
    ("getOutputEdges", "Connection LEGO (graph-utils.ts) — Agent 3"),
    ("getRootNodes", "Connection LEGO (graph-utils.ts) — Agent 3"),
    ("getLeafNodes", "Connection LEGO (graph-utils.ts) — Agent 3"),
];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn load(path: &Path) -> Value {
    let text = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("invalid JSON in {}: {e}", path.display()))
}

fn filter_of(probe: &Value) -> ConnectionTypeFilter {
    ConnectionTypeFilter::parse(probe.get("type").and_then(Value::as_str).unwrap_or("main"))
}

fn depth_of(probe: &Value) -> i32 {
    probe.get("depth").and_then(Value::as_i64).unwrap_or(-1) as i32
}

/// `{"undefined": true}` is how the TS harness renders an `undefined` result.
fn undefined_marker() -> Value {
    json!({ "undefined": true })
}

#[test]
fn connection_golden_probes_match_the_pinned_runtime() {
    let mut executed: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for case in CASES {
        let dir = repo_root().join("tests/reference/connection").join(case);
        let case_json = load(&dir.join("case.json"));
        let expected = load(&dir.join("expected.json"));
        let workflow =
            Workflow::from_wire(&case_json).unwrap_or_else(|e| panic!("{case}: {e}"));

        let probes = case_json["probes"].as_array().expect("probes array").clone();
        assert!(!probes.is_empty(), "{case}: no probes");

        for probe in probes {
            let name = probe["name"].as_str().expect("probe name").to_string();
            let op = probe["op"].as_str().expect("probe op").to_string();

            let Some(expected_value) = expected.get(&name) else {
                failures.push(format!("{case}/{name}: missing expected value"));
                continue;
            };

            if let Some((_, owner)) = SKIPPED_OPS.iter().find(|(op_known, _)| *op_known == op) {
                skipped.push(format!("{case}/{name} [{op}] — owner: {owner}"));
                continue;
            }

            let actual: Value = match op.as_str() {
                "byDestination" => match probe.get("node").and_then(Value::as_str) {
                    Some(node) => serde_json::to_value(
                        workflow
                            .connections_by_destination_node
                            .get(node)
                            .cloned()
                            .unwrap_or_default(),
                    )
                    .unwrap(),
                    None => serde_json::to_value(&workflow.connections_by_destination_node).unwrap(),
                },
                "getChildNodes" => serde_json::to_value(workflow.get_child_nodes(
                    probe["node"].as_str().expect("node"),
                    filter_of(&probe),
                    depth_of(&probe),
                ))
                .unwrap(),
                "getParentNodes" => serde_json::to_value(workflow.get_parent_nodes(
                    probe["node"].as_str().expect("node"),
                    filter_of(&probe),
                    depth_of(&probe),
                ))
                .unwrap(),
                "getConnectedNodes" => serde_json::to_value(workflow.get_connected_nodes(
                    &workflow.connections_by_source_node,
                    probe["node"].as_str().expect("node"),
                    filter_of(&probe),
                    depth_of(&probe),
                ))
                .unwrap(),
                "wf.getHighestNode" => serde_json::to_value(workflow.get_highest_node(
                    probe["node"].as_str().expect("node"),
                    None,
                    None,
                ))
                .unwrap(),
                "wf.getStartNode" => serde_json::to_value(
                    workflow
                        .get_start_node(Some(probe["node"].as_str().expect("node")))
                        .map(|node| node.name.clone()),
                )
                .unwrap(),
                "wf.getNodeConnectionIndexes" => {
                    let node = probe["node"].as_str().expect("node");
                    let parent = probe["parent"].as_str().expect("parent");
                    let connection_type = probe.get("type").and_then(Value::as_str).unwrap_or("main");
                    workflow
                        .get_node_connection_indexes(node, parent, connection_type)
                        .map(|indexes| {
                            serde_json::to_value(indexes).expect("serialise indexes")
                        })
                        .unwrap_or_else(undefined_marker)
                }
                "wf.getParentNodesByDepth" => {
                    serde_json::to_value(workflow.get_parent_nodes_by_depth(
                        probe["node"].as_str().expect("node"),
                        depth_of(&probe),
                    ))
                    .unwrap()
                }
                "wf.getParentMainInputNode" => serde_json::to_value(
                    workflow
                        .get_parent_main_input_node(probe["node"].as_str().expect("node"))
                        .map(|node| node.name.clone()),
                )
                .unwrap(),
                "compareConnections" => {
                    let next: n8n_workflow::Connections = serde_json::from_value(
                        probe.get("next").cloned().expect("compareConnections next"),
                    )
                    .expect("next connections");
                    let prev: n8n_workflow::Connections = serde_json::from_value(
                        case_json.get("connections").cloned().expect("case connections"),
                    )
                    .expect("prev connections");
                    serde_json::to_value(compare_connections(&prev, &next)).unwrap()
                }
                other => {
                    failures.push(format!(
                        "{case}/{name}: op `{other}` is neither implemented nor on the SKIP list"
                    ));
                    continue;
                }
            };

            if &actual == expected_value {
                executed.push(format!("{case}/{name}"));
            } else {
                failures.push(format!(
                    "{case}/{name} [{op}]\n    expected: {expected_value}\n    actual:   {actual}"
                ));
            }
        }
    }

    println!(
        "\n=== connection probes: {} executed, {} skipped (tracked, owned by Connection LEGO) ===",
        executed.len(),
        skipped.len()
    );
    for entry in &skipped {
        println!("  SKIP {entry}");
    }

    // Failures first — a count mismatch must never hide the actual diffs.
    assert!(
        failures.is_empty(),
        "\n\n{} probe failure(s):\n  {}",
        failures.len(),
        failures.join("\n  ")
    );

    // The counts are asserted so shrinkage cannot pass silently. 14 = the `wf.*` members
    // hand-off (docs/isolation/connection-workflow-members-spec.md); 34 = 46 total - 12 skips.
    assert_eq!(
        executed.len() + skipped.len(),
        46,
        "probe total drifted: expected 46 (34 executed + 12 tracked skips)"
    );
    assert!(
        executed.len() >= 34,
        "executed probes regressed: {} < 34",
        executed.len()
    );
}
