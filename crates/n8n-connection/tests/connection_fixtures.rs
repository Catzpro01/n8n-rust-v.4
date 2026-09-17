//! Golden-fixture conformance for the Connection port (R1).
//!
//! Consumes the probe-driven suites under `tests/reference/connection/**`: `case.json`
//! declares the graph and the probes, `expected.json` holds the values OBSERVED on the
//! pinned reference runtime. The crate is only asserted for the operations it actually
//! implements; probes for `Workflow`-methods (`wf.*`) and unported graph-utils helpers
//! are skipped — and the skip counts are pinned too, so neither list can drift silently.
//!
//! FAIL-LOUD: a missing fixture is a failure, never a skip.

use n8n_connection::{
    get_connected_nodes, has_path, map_connections_by_destination, ConnectionTypeFilter,
    WorkflowConnections,
};
use serde_json::{json, Value};
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

fn filter_of(probe: &Value) -> ConnectionTypeFilter {
    match probe.get("type").and_then(Value::as_str) {
        None | Some("main") => ConnectionTypeFilter::default(),
        Some("ALL") => ConnectionTypeFilter::All,
        Some("ALL_NON_MAIN") => ConnectionTypeFilter::AllNonMain,
        Some(other) => ConnectionTypeFilter::Type(other.to_string()),
    }
}

/// Run the probes of one case directory against the crate, returning (asserted, skipped)
/// counts. Skipped ops are the ones this crate does not own (see the header).
fn run_case(dir: &str, expected_asserts: usize, expected_skips: usize) {
    let case = read_json(&format!("tests/reference/connection/{dir}/case.json"));
    let expected = read_json(&format!("tests/reference/connection/{dir}/expected.json"));
    let connections: WorkflowConnections = serde_json::from_value(case["connections"].clone())
        .unwrap_or_else(|error| panic!("{dir}: connections deserialise: {error}"));

    let mut asserted = 0usize;
    let mut skipped = 0usize;

    for probe in case["probes"].as_array().expect("probes array") {
        let name = probe["name"].as_str().expect("probe name");
        let actual: Value = match probe["op"].as_str().expect("probe op") {
            "byDestination" => {
                let inverted = map_connections_by_destination(&connections);
                match probe.get("node").and_then(Value::as_str) {
                    Some(node) => serde_json::to_value(inverted.get(node)).expect("serialise"),
                    None => serde_json::to_value(&inverted).expect("serialise"),
                }
            }
            "getChildNodes" | "getConnectedNodes" => {
                let node = probe["node"].as_str().expect("node");
                let depth = probe.get("depth").and_then(Value::as_i64).unwrap_or(-1);
                json!(get_connected_nodes(&connections, node, &filter_of(probe), depth))
            }
            "getParentNodes" => {
                let node = probe["node"].as_str().expect("node");
                let depth = probe.get("depth").and_then(Value::as_i64).unwrap_or(-1);
                let inverted = map_connections_by_destination(&connections);
                json!(get_connected_nodes(&inverted, node, &filter_of(probe), depth))
            }
            "hasPath" => {
                json!(has_path(
                    &connections,
                    probe["start"].as_str().expect("start"),
                    probe["end"].as_str().expect("end"),
                ))
            }
            // Owned by the Workflow crate (`wf.*`) or graph-utils helpers this crate
            // does not port yet — recorded skips, pinned by count below.
            _ => {
                skipped += 1;
                continue;
            }
        };

        asserted += 1;
        let expected_value = &expected[name];
        assert_eq!(actual, *expected_value, "{dir} probe `{name}`");
    }

    assert_eq!(asserted, expected_asserts, "{dir}: asserted probe count drifted");
    assert_eq!(skipped, expected_skips, "{dir}: skipped probe count drifted");
}

#[test]
fn linear_chain_matches_the_reference() {
    // byDestination, children/parents (farthest-first), unknown node, hasPath both ways.
    run_case("01-linear", 8, 4);
}

#[test]
fn connection_types_and_filters_match_the_reference() {
    // byDestination(all types), parents/children per type incl. ALL / ALL_NON_MAIN,
    // hasPath main-only semantics (ai_languageModel edge creates no path).
    run_case("03-connection-types", 8, 3);
}
