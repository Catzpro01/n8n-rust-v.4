//! agent-3: run tests/reference/connection fixtures against n8n-workflow's own traversal/diff port.
use n8n_workflow::{compare_connections, get_connected_nodes, map_connections_by_destination, ConnectionTypeFilter, Connections};
use serde_json::{json, Value};
use std::{fs, path::Path};
/// Ops this runner deliberately does not execute (owner in parentheses). Mirrors the discipline of
/// agent-1's `crates/n8n-workflow/tests/connection_probe_fixtures.rs`.
const SKIPPED_OPS: &[(&str, &str)] = &[
    ("wf.getNodeConnectionIndexes", "Workflow class, LEGO 01 (ported in TASK-405)"),
    ("wf.getHighestNode", "Workflow class, LEGO 01"),
    ("wf.getStartNode", "Workflow class, LEGO 01"),
    ("wf.getParentMainInputNode", "Workflow class, LEGO 01 + CD-05 registry (LEGO 02)"),
    ("wf.getParentNodesByDepth", "Workflow class, LEGO 01"),
    ("wf.getChildNodes", "Workflow class wrapper, LEGO 01"),
    ("wf.getParentNodes", "Workflow class wrapper, LEGO 01"),
    ("wf.sourceKeys", "Workflow map lifecycle, LEGO 01"),
    ("wf.destKeys", "Workflow map lifecycle, LEGO 01"),
    ("wf.rebuildThenGetParentNodes", "Workflow.setConnections, LEGO 01"),
    ("adjacencyKeys", "graph-utils (executed by the full spec runner / crates/n8n-connection graph_utils)"),
    ("getRootNodes", "graph-utils"), ("getLeafNodes", "graph-utils"), ("getInputEdges", "graph-utils"),
    ("getOutputEdges", "graph-utils"), ("hasPath", "graph-utils"), ("parseExtractable", "graph-utils"),
];
#[test]
fn connection_fixtures_via_n8n_workflow() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/reference/connection");
    let (mut ok, mut bad, mut skipped) = (0, 0, 0);
    let mut dirs: Vec<_> = fs::read_dir(&root).unwrap().flatten().map(|e| e.path()).collect(); dirs.sort();
    for dir in dirs {
        let case_text = fs::read_to_string(dir.join("case.json")).unwrap();
        let case: Value = serde_json::from_str(&case_text).unwrap();
        // agent-1 flag 2 (PR #4): `Value` without `preserve_order` sorts object keys; parse the typed
        // maps straight from the text so key order == document order (IConnections semantics).
        #[derive(serde::Deserialize)] struct CaseTyped { connections: Connections, #[serde(default)] probes: Vec<ProbeTyped> }
        #[derive(serde::Deserialize)] struct ProbeTyped { #[serde(default)] next: Option<Connections> }
        let typed: CaseTyped = serde_json::from_str(&case_text).unwrap();
        let conn: Connections = typed.connections;
        let expected: Value = serde_json::from_str(&fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();
        let by_dest = map_connections_by_destination(&conn);
        for (pi, p) in case["probes"].as_array().unwrap().iter().enumerate() {
            let name = p["name"].as_str().unwrap();
            let depth = p.get("depth").and_then(|d| d.as_i64()).unwrap_or(-1) as i32;
            let node = p.get("node").and_then(|n| n.as_str()).unwrap_or("");
            let filt = p.get("type").and_then(|v| v.as_str()).map(ConnectionTypeFilter::parse).unwrap_or_default();
            let got: Value = match p["op"].as_str().unwrap() {
                "byDestination" => if node.is_empty() { json!(by_dest) } else { match by_dest.get(node) { Some(v) => json!(v), None => json!({"undefined": true}) } },
                "getChildNodes" | "getConnectedNodes" => json!(get_connected_nodes(&conn, node, &filt, depth, None)),
                "getParentNodes" => json!(get_connected_nodes(&by_dest, node, &filt, depth, None)),
                "compareConnections" => { let nx: Connections = typed.probes[pi].next.clone().expect("next"); json!(compare_connections(&conn, &nx)) },
                // agent-1 flag 1 (PR #4): no silent skips — only ops on this explicit list may be skipped,
                // and each names its owner; anything else is a hard failure.
                op if SKIPPED_OPS.iter().any(|(k, _)| *k == op) => { skipped += 1; continue; }
                op => panic!("{}/{}: op `{op}` is neither implemented nor on SKIPPED_OPS", dir.file_name().unwrap().to_string_lossy(), name),
            };
            if got == expected[name] { ok += 1 } else { bad += 1; eprintln!("MISMATCH {} :: {}\n   got {}\n   exp {}", dir.file_name().unwrap().to_string_lossy(), name, got, expected[name]); }
        }
    }
    eprintln!("n8n-workflow vs connection fixtures: {ok} ok / {bad} mismatch / {skipped} skipped");
    assert_eq!(bad, 0);
}
