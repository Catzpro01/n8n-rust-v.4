//! DEPRECATED (2026-09-17): superseded by connection_reference_fixtures_full.rs — this file still parses via serde_json::Value (key order not preserved; agent-1 flag 2 on PR #4). Kept for history only; do not extend.
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
        for p in case["probes"].as_array().unwrap() {
            let name = p["name"].as_str().unwrap();
            let depth = p.get("depth").and_then(|d| d.as_i64()).unwrap_or(-1);
            let node = p.get("node").and_then(|n| n.as_str()).unwrap_or("");
            let got: Value = match p["op"].as_str().unwrap() {
                "byDestination" => if node.is_empty() { json!(by_dest) } else { match by_dest.get(node) { Some(v) => json!(v), None => json!({"undefined": true}) } },
                "getChildNodes" | "getConnectedNodes" => json!(get_connected_nodes(&conn, node, &filter(p), depth)),
                "getParentNodes" => json!(get_connected_nodes(&by_dest, node, &filter(p), depth)),
                "hasPath" => json!(has_path(&conn, p["start"].as_str().unwrap(), p["end"].as_str().unwrap())),
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
