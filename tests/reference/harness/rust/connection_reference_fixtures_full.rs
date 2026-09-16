//! Spec §7 fixture runner (agent-3, run out-of-tree). Covers the ops the crate exposes today.
use n8n_connection::*;
use serde_json::{json, Value};
use std::{fs, path::Path};

fn filter(p: &Value) -> ConnectionTypeFilter {
    match p.get("type").and_then(|v| v.as_str()) {
        None => ConnectionTypeFilter::default(),
        Some("ALL") => ConnectionTypeFilter::All,
        Some("ALL_NON_MAIN") => ConnectionTypeFilter::AllNonMain,
        Some(s) => ConnectionTypeFilter::Type(s.to_string()),
    }
}

#[test]
fn reference_fixtures() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/reference/connection");
    let (mut ok, mut bad, mut skipped) = (0, 0, 0);
    let mut dirs: Vec<_> = fs::read_dir(&root).unwrap().flatten().map(|e| e.path()).collect();
    dirs.sort();
    for dir in dirs {
        let case: Value = serde_json::from_str(&fs::read_to_string(dir.join("case.json")).unwrap()).unwrap();
        let expected: Value = serde_json::from_str(&fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();
        let conn: WorkflowConnections = serde_json::from_value(case["connections"].clone())
            .unwrap_or_else(|e| panic!("{}: R-01 deserialise failed: {e}", dir.display()));
        let by_dest = map_connections_by_destination(&conn);
        let adj = build_adjacency_list(&conn);
        let gset = |p: &Value| -> indexmap::IndexSet<String> { p["graph"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect() };
        for p in case["probes"].as_array().unwrap() {
            let name = p["name"].as_str().unwrap();
            let depth = p.get("depth").and_then(|d| d.as_i64()).unwrap_or(-1);
            let node = p.get("node").and_then(|n| n.as_str()).unwrap_or("");
            let got: Value = match p["op"].as_str().unwrap() {
                "byDestination" => if node.is_empty() { json!(by_dest) } else { match by_dest.get(node) { Some(v) => json!(v), None => json!({"undefined": true}) } },
                "getChildNodes" | "getConnectedNodes" => json!(get_connected_nodes_spec(&conn, node, &filter(p), depth, None)),
                "getParentNodes" => json!(get_connected_nodes_spec(&by_dest, node, &filter(p), depth, None)),
                "hasPath" => json!(has_path_adj(p["start"].as_str().unwrap(), p["end"].as_str().unwrap(), &adj)),
                "getRootNodes" => json!(get_root_nodes(&gset(p), &adj)),
                "getLeafNodes" => json!(get_leaf_nodes(&gset(p), &adj)),
                "getInputEdges" => json!(get_input_edges(&gset(p), &adj)),
                "getOutputEdges" => json!(get_output_edges(&gset(p), &adj)),
                "parseExtractable" => json!(parse_extractable_subgraph_selection(&gset(p), &adj)),
                "compareConnections" => { let nx: WorkflowConnections = serde_json::from_value(p["next"].clone()).unwrap(); json!(compare_connections(&conn, &nx)) },
                "adjacencyKeys" => json!(adj.keys().collect::<Vec<_>>()),
                _ => { skipped += 1; continue; }
            };
            if got == expected[name] { ok += 1; } else {
                bad += 1;
                eprintln!("MISMATCH {} :: {}\n   got {}\n   exp {}", dir.file_name().unwrap().to_string_lossy(), name, got, expected[name]);
            }
        }
    }
    eprintln!("connection fixtures: {ok} ok / {bad} mismatch / {skipped} skipped (no API yet)");
    assert_eq!(bad, 0, "{bad} probe(s) differ from n8n 2.9.4");
}
