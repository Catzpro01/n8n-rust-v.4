//! Connection LEGO fixture conformance.
//!
//! Runs every pure probe of `tests/reference/connection/*` (32 probes across 5
//! fixtures) against this crate, plus the 9 `traversal` cases of
//! `tests/reference/workflow-rust/fixtures.json` as a cross-check that this
//! crate's traversal converged on the same pinned semantics as the Workflow
//! crate's (MSG-18).
//!
//! The connection fixtures were pre-verified against the pinned reference
//! runtime (32/32 match) before this port was written, so they pin the
//! reference — not this implementation. Probe counts are asserted per fixture,
//! so a growing fixture file cannot be silently skipped.
//!
//! Skipped on purpose (with per-fixture counts asserted):
//!
//! * every `wf.*` probe — `getNodeConnectionIndexes`, `getHighestNode`,
//!   `getStartNode`, `getParentMainInputNode`, `getParentNodesByDepth` need the
//!   Workflow aggregate (+ node types) and are Agent 1's, consumed read-only
//!   per `contracts/connection.contract.md` CD-04.

use indexmap::IndexSet;
use n8n_connection::{
    build_adjacency_list, compare_connections, get_child_nodes, get_connected_nodes,
    get_input_edges, get_leaf_nodes, get_output_edges, get_parent_nodes, get_root_nodes, has_path,
    map_connections_by_destination, parse_extractable_subgraph_selection, ConnectionTypeFilter,
    NodeSet, WorkflowConnections,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn read_text(path: &PathBuf) -> String {
    fs::read_to_string(path).unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

/// Parsed straight from JSON text so the `IndexMap`s keep document order
/// (a `serde_json::Value` round-trip would sort the keys).
#[derive(Deserialize)]
struct CaseFile {
    connections: WorkflowConnections,
    probes: Vec<Probe>,
}

#[derive(Deserialize)]
struct Probe {
    name: String,
    op: String,
    node: Option<String>,
    #[serde(rename = "type")]
    connection_type: Option<String>,
    depth: Option<i64>,
    start: Option<String>,
    end: Option<String>,
    graph: Option<Vec<String>>,
    next: Option<WorkflowConnections>,
}

/// (fixture dir, executed pure probes, skipped wf.* probes)
const FIXTURES: [(&str, usize, usize); 5] = [
    ("01-linear", 8, 4),
    ("02-multi-output", 6, 4),
    ("03-connection-types", 8, 3),
    ("04-cycle", 9, 3),
    ("05-connections-diff", 1, 0),
];

fn node_set(graph: &[String]) -> NodeSet {
    graph.iter().cloned().collect::<IndexSet<String>>()
}

#[test]
fn connection_fixtures_match_the_reference() {
    let root = repo_root().join("tests/reference/connection");
    let mut total_executed = 0;
    let mut total_skipped = 0;

    for (dir, want_executed, want_skipped) in FIXTURES {
        let case: CaseFile = serde_json::from_str(&read_text(&root.join(dir).join("case.json")))
            .unwrap_or_else(|error| panic!("cannot parse {dir}/case.json: {error}"));
        let expected: Value = serde_json::from_str(&read_text(&root.join(dir).join("expected.json")))
            .unwrap_or_else(|error| panic!("cannot parse {dir}/expected.json: {error}"));

        let by_destination = map_connections_by_destination(&case.connections);
        let adjacency = build_adjacency_list(&case.connections);
        let mut executed = 0;
        let mut skipped = 0;

        for probe in &case.probes {
            if probe.op.starts_with("wf.") {
                skipped += 1;
                continue;
            }
            let filter = probe
                .connection_type
                .as_deref()
                .map(ConnectionTypeFilter::parse)
                .unwrap_or_default();
            let depth = probe.depth.unwrap_or(-1);

            let actual = match probe.op.as_str() {
                "byDestination" => match &probe.node {
                    Some(node) => json!(by_destination.get(node).cloned().unwrap_or_default()),
                    None => json!(by_destination),
                },
                "getChildNodes" => json!(get_child_nodes(
                    &case.connections,
                    probe.node.as_deref().expect("node"),
                    &filter,
                    depth
                )),
                "getParentNodes" => json!(get_parent_nodes(
                    &by_destination,
                    probe.node.as_deref().expect("node"),
                    &filter,
                    depth
                )),
                // Reference takes either map; the harness uses the source map.
                // (Only probed with an unknown node, which yields [] on both.)
                "getConnectedNodes" => json!(get_connected_nodes(
                    &case.connections,
                    probe.node.as_deref().expect("node"),
                    &filter,
                    depth,
                    None
                )),
                "hasPath" => json!(has_path(
                    probe.start.as_deref().expect("start"),
                    probe.end.as_deref().expect("end"),
                    &adjacency
                )),
                "getRootNodes" => {
                    json!(get_root_nodes(&node_set(probe.graph.as_ref().expect("graph")), &adjacency))
                }
                "getLeafNodes" => {
                    json!(get_leaf_nodes(&node_set(probe.graph.as_ref().expect("graph")), &adjacency))
                }
                "getInputEdges" => {
                    json!(get_input_edges(&node_set(probe.graph.as_ref().expect("graph")), &adjacency))
                }
                "getOutputEdges" => {
                    json!(get_output_edges(&node_set(probe.graph.as_ref().expect("graph")), &adjacency))
                }
                "parseExtractable" => json!(parse_extractable_subgraph_selection(
                    &node_set(probe.graph.as_ref().expect("graph")),
                    &adjacency
                )),
                "compareConnections" => json!(compare_connections(
                    &case.connections,
                    probe.next.as_ref().expect("next")
                )),
                other => panic!("unknown probe op `{other}` in {dir}"),
            };

            assert_eq!(
                actual,
                expected[probe.name.as_str()],
                "[{dir}] probe `{}`",
                probe.name
            );
            executed += 1;
        }

        assert_eq!(executed, want_executed, "[{dir}] executed probe count");
        assert_eq!(skipped, want_skipped, "[{dir}] skipped wf.* probe count");
        total_executed += executed;
        total_skipped += skipped;
    }

    assert_eq!(total_executed, 32, "total executed probes");
    assert_eq!(total_skipped, 14, "total skipped wf.* probes");
}

const TRAVERSAL_CASES: usize = 9;

#[test]
fn workflow_traversal_cases_cross_check() {
    // The same shared graph the Workflow crate's harness builds, so both
    // traversals answer the same 9 pinned questions (MSG-18 convergence).
    let text = read_text(&repo_root().join("tests/reference/workflow-rust/fixtures.json"));
    let fixtures: Value = serde_json::from_str(&text).expect("parse fixtures.json");
    let cases = fixtures["traversal"].as_array().expect("traversal cases");
    assert_eq!(cases.len(), TRAVERSAL_CASES, "traversal case count");

    let graph: WorkflowConnections = serde_json::from_str(
        r#"{
            "A": {
                "main": [[{"node": "B", "type": "main", "index": 0}]],
                "ai_languageModel": [[{"node": "M", "type": "ai_languageModel", "index": 0}]]
            },
            "B": {"main": [[{"node": "C", "type": "main", "index": 0}]]},
            "C": {"main": [[{"node": "D", "type": "main", "index": 0}]]},
            "D": {},
            "M": {}
        }"#,
    )
    .expect("parse traversal graph");

    for case in cases {
        let id = case["id"].as_str().expect("id");
        let from = case["from"].as_str().expect("from");
        let filter = ConnectionTypeFilter::parse(case["type"].as_str().expect("type"));
        let depth = case["depth"].as_i64().expect("depth");

        let actual = get_connected_nodes(&graph, from, &filter, depth, None);
        assert_eq!(json!(actual), case["result"], "traversal case `{id}`");
    }
}
