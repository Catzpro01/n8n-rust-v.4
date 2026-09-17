//! Probe runner for `tests/reference/connection/01..05` (Agent-3 golden cases, pinned against
//! the n8n 2.9.4 runtime). Implements the `wf.*` / traversal / map ops the Workflow LEGO owns
//! (per `docs/isolation/connection-workflow-members-spec.md` — the five members hand-off) and
//! the graph-utils ops the Connection LEGO owns (`n8n_connection::graph_utils`).
//!
//! No silent skips: every probe is EXECUTED, and an unknown op FAILS the run. All 46 probes
//! across the five cases are expected to execute — shrinkage or op-drift fails loudly.

use n8n_connection::graph_utils;
use n8n_workflow::{compare_connections, ConnectionTypeFilter, Workflow};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const CASES: [&str; 8] = [
    "01-linear",
    "02-multi-output",
    "03-connection-types",
    "04-cycle",
    "05-connections-diff",
    // Adopted from agent-3/worker-05 (arena/01a0ac05 @ 7037e3d5): rename-staleness (D-08)
    // and the full getParentMainInputNode climb through an ai_tool sub-node (harness stub).
    "06-rename-stale-destination",
    "07-parent-main-input-ai-tool",
    // Adopted from agent-3/worker-05 (arena/01a0ac05 @ 4eec6791): traversal depth pinning
    // (diamond dedupe, unbounded farthest-first) + ALL/ALL_NON_MAIN type filters + byDest
    // insertion-order + getHighestNode/getParentNodesByDepth/getNodeConnectionIndexes.
    "08-traversal-depth-and-type-filter",
];

/// Expected probe totals: 46 total, all executable (no tracked skips remain since
/// TASK-406 ported the graph-utils ops).
const PROBE_TOTAL: usize = 88;

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

fn graph_ids_of(probe: &Value) -> indexmap::IndexSet<String> {
    probe["graph"]
        .as_array()
        .expect("probe graph array")
        .iter()
        .map(|id| id.as_str().expect("graph id").to_string())
        .collect()
}

/// `{"undefined": true}` is how the TS harness renders an `undefined` result.

/// The reference harness's node-type stub (`tests/reference/harness/connection.js`):
/// node types are constructed as `type: <node name>` and `SubTool*` nodes declare an
/// `ai_tool` output while everything else declares `main`. This is the CD-05 seam the
/// climb needs — the registry stays OUTSIDE the Workflow LEGO.
fn harness_declared_outputs(name: &str) -> Vec<String> {
    if name.starts_with("SubTool") {
        vec!["ai_tool".to_string()]
    } else {
        vec!["main".to_string()]
    }
}
fn undefined_marker() -> Value {
    json!({ "undefined": true })
}

#[test]
fn connection_golden_probes_match_the_pinned_runtime() {
    let mut executed: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for case in CASES {
        let dir = repo_root().join("tests/reference/connection").join(case);
        let raw_text = fs::read_to_string(dir.join("case.json"))
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.join("case.json").display()));
        let case_json = load(&dir.join("case.json"));
        let expected = load(&dir.join("expected.json"));
        // Document-order construction (`from_wire_str`): connection keys keep their JSON
        // document order, matching the reference harness's JS object semantics.
        let mut workflow =
            Workflow::from_wire_str(&raw_text).unwrap_or_else(|e| panic!("{case}: {e}"));
        // The TS harness applies `renameNode(from, to)` right after construction
        // (`connection.js:27`) — case 06 pins the D-08 staleness against exactly that.
        if let Some(rename) = case_json.get("rename") {
            workflow
                .rename_node(
                    rename["from"].as_str().expect("rename.from"),
                    rename["to"].as_str().expect("rename.to"),
                )
                .expect("rename is legal in the reference");
        }
        // Adjacency must follow DOCUMENT order too — `serde_json::from_value::<
        // WorkflowConnections>` would sort the source keys, so parse the connections
        // straight from text into the (document-ordered) IndexMap type.
        #[derive(serde::Deserialize)]
        struct CaseConnections {
            #[serde(default)]
            connections: n8n_connection::WorkflowConnections,
        }
        let case_connections: CaseConnections = serde_json::from_str(&raw_text)
            .unwrap_or_else(|e| panic!("{case}: connections do not parse: {e}"));
        let adjacency_list = graph_utils::build_adjacency_list(&case_connections.connections);

        let probes = case_json["probes"].as_array().expect("probes array").clone();
        assert!(!probes.is_empty(), "{case}: no probes");

        for probe in probes {
            let name = probe["name"].as_str().expect("probe name").to_string();
            let op = probe["op"].as_str().expect("probe op").to_string();

            let Some(expected_value) = expected.get(&name) else {
                failures.push(format!("{case}/{name}: missing expected value"));
                continue;
            };

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
                        .map(|indexes| serde_json::to_value(indexes).expect("serialise indexes"))
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
                        .get_parent_main_input_node_with(
                            probe["node"].as_str().expect("node"),
                            &harness_declared_outputs,
                        )
                        .map(|node| node.name.clone()),
                )
                .unwrap(),
                // case 06 uses the wf.-prefixed aliases (Workflow methods, not the
                // graph-utils pure fns the bare ops map to).
                "wf.getChildNodes" => serde_json::to_value(workflow.get_child_nodes(
                    probe["node"].as_str().expect("node"),
                    filter_of(&probe),
                    depth_of(&probe),
                ))
                .unwrap(),
                "wf.getParentNodes" => serde_json::to_value(workflow.get_parent_nodes(
                    probe["node"].as_str().expect("node"),
                    filter_of(&probe),
                    depth_of(&probe),
                ))
                .unwrap(),
                "wf.sourceKeys" => {
                    serde_json::to_value(workflow.connections_by_source_node.key_names()).unwrap()
                }
                "wf.destKeys" => serde_json::to_value(
                    workflow.connections_by_destination_node.key_names(),
                )
                .unwrap(),
                "wf.rebuildThenGetParentNodes" => {
                    // `setConnections(connectionsBySourceNode)` re-derives the destination
                    // map, then the probe re-runs getParentNodes against the fresh index.
                    let rebuilt = workflow.connections_by_source_node.clone();
                    workflow.set_connections(rebuilt);
                    serde_json::to_value(workflow.get_parent_nodes(
                        probe["node"].as_str().expect("node"),
                        filter_of(&probe),
                        depth_of(&probe),
                    ))
                    .unwrap()
                }
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
                "hasPath" => serde_json::to_value(graph_utils::has_path(
                    probe["start"].as_str().expect("start"),
                    probe["end"].as_str().expect("end"),
                    &adjacency_list,
                ))
                .unwrap(),
                "getRootNodes" => {
                    serde_json::to_value(graph_utils::get_root_nodes(&graph_ids_of(&probe), &adjacency_list))
                        .unwrap()
                }
                "getLeafNodes" => {
                    serde_json::to_value(graph_utils::get_leaf_nodes(&graph_ids_of(&probe), &adjacency_list))
                        .unwrap()
                }
                "getInputEdges" => {
                    serde_json::to_value(graph_utils::get_input_edges(&graph_ids_of(&probe), &adjacency_list))
                        .unwrap()
                }
                "getOutputEdges" => {
                    serde_json::to_value(graph_utils::get_output_edges(&graph_ids_of(&probe), &adjacency_list))
                        .unwrap()
                }
                "parseExtractable" => serde_json::to_value(
                    graph_utils::parse_extractable_subgraph_selection(&graph_ids_of(&probe), &adjacency_list),
                )
                .unwrap(),
                other => {
                    failures.push(format!(
                        "{case}/{name}: op `{other}` is not implemented — add it or justify a SKIP with an owner"
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
        "\n=== connection probes: {} executed / {PROBE_TOTAL} expected (all executable since TASK-406) ===",
        executed.len()
    );

    // Failures first — a count mismatch must never hide the actual diffs.
    assert!(
        failures.is_empty(),
        "\n\n{} probe failure(s):\n  {}",
        failures.len(),
        failures.join("\n  ")
    );

    // Every probe must have been executed: no silent skips.
    assert_eq!(
        executed.len(),
        PROBE_TOTAL,
        "executed probe count drifted: {executed_count} != {PROBE_TOTAL} — a probe is missing, added, or skipped",
        executed_count = executed.len()
    );
}
