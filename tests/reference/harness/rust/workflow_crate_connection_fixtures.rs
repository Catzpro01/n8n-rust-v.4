//! agent-3: run tests/reference/connection fixtures against n8n-workflow's own traversal/diff port.
use n8n_workflow::{compare_connections, get_connected_nodes, map_connections_by_destination, ConnectionTypeFilter, Connections};
use serde_json::{json, Value};
use std::{fs, path::Path};
#[test]
fn connection_fixtures_via_n8n_workflow() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/reference/connection");
    let (mut ok, mut bad, mut skipped) = (0, 0, 0);
    let mut dirs: Vec<_> = fs::read_dir(&root).unwrap().flatten().map(|e| e.path()).collect(); dirs.sort();
    for dir in dirs {
        let case: Value = serde_json::from_str(&fs::read_to_string(dir.join("case.json")).unwrap()).unwrap();
        let expected: Value = serde_json::from_str(&fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();
        let conn: Connections = serde_json::from_value(case["connections"].clone()).unwrap();
        let by_dest = map_connections_by_destination(&conn);
        for p in case["probes"].as_array().unwrap() {
            let name = p["name"].as_str().unwrap();
            let depth = p.get("depth").and_then(|d| d.as_i64()).unwrap_or(-1) as i32;
            let node = p.get("node").and_then(|n| n.as_str()).unwrap_or("");
            let filt = p.get("type").and_then(|v| v.as_str()).map(ConnectionTypeFilter::parse).unwrap_or_default();
            let got: Value = match p["op"].as_str().unwrap() {
                "byDestination" => if node.is_empty() { json!(by_dest) } else { match by_dest.get(node) { Some(v) => json!(v), None => json!({"undefined": true}) } },
                "getChildNodes" | "getConnectedNodes" => json!(get_connected_nodes(&conn, node, &filt, depth, None)),
                "getParentNodes" => json!(get_connected_nodes(&by_dest, node, &filt, depth, None)),
                "compareConnections" => { let nx: Connections = serde_json::from_value(p["next"].clone()).unwrap(); json!(compare_connections(&conn, &nx)) },
                _ => { skipped += 1; continue; }
            };
            if got == expected[name] { ok += 1 } else { bad += 1; eprintln!("MISMATCH {} :: {}\n   got {}\n   exp {}", dir.file_name().unwrap().to_string_lossy(), name, got, expected[name]); }
        }
    }
    eprintln!("n8n-workflow vs connection fixtures: {ok} ok / {bad} mismatch / {skipped} skipped");
    assert_eq!(bad, 0);
}
