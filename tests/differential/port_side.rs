//! Differential harness — PORT side. Injected into the offline rig's build copy by
//! tests/differential/run.sh, so the repository's crates/ is never modified.
//!
//! Answers are STREAMED one line per case (`PORT_CASE <id> <json>`) and flushed
//! immediately. A stack overflow aborts the whole process and cannot be caught, so
//! streaming is what lets the harness keep every answer produced *before* the crash
//! and identify exactly which case died. `DIFF_SKIP` (comma-separated ids) lets the
//! driver re-run past a known-crashing case to reach the ones behind it.
use n8n_workflow::*;
use serde_json::{json, Value};
use std::io::Write;

#[test]
fn emit_port_answers() {
    let spec: Value =
        serde_json::from_str(include_str!("../../../tests/differential/cases.json")).unwrap();
    let skip: Vec<String> = std::env::var("DIFF_SKIP")
        .unwrap_or_default()
        .split(',')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    for c in spec["cases"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap().to_string();
        if skip.contains(&id) {
            continue;
        }
        // Announce the case BEFORE running it: if the process aborts, the last
        // announced id is the culprit.
        eprintln!("PORT_ENTER {}", id);
        std::io::stderr().flush().ok();

        let nodes: Vec<Value> = c["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| {
                let n = pair[0].as_str().unwrap();
                let mut v = json!({"id": n, "name": n, "type": "t", "typeVersion": 1,
                                   "position": [0,0], "parameters": {}});
                if !pair[1].is_null() {
                    v["disabled"] = pair[1].clone();
                }
                v
            })
            .collect();

        let wire = json!({"id": id, "name": id, "nodes": nodes,
                          "connections": c["connections"], "active": false});
        let w = Workflow::from_wire(&wire).expect("parses");

        let depth = c["depth"].as_i64().unwrap_or(-1) as i32;
        let filter = ConnectionTypeFilter::parse(c["filter"].as_str().unwrap_or("main"));
        let dest = c["dest"].as_str();

        let v: Value = match c["op"].as_str().unwrap() {
            "getStartNode" => w
                .get_start_node(dest)
                .map(|n| json!(n.name))
                .unwrap_or(Value::Null),
            "getChildNodes" => {
                let mut r = w.get_child_nodes(dest.unwrap(), filter, depth);
                r.sort();
                json!(r)
            }
            "getParentNodes" => {
                let mut r = w.get_parent_nodes(dest.unwrap(), filter, depth);
                r.sort();
                json!(r)
            }
            _ => json!({"error": "unknown op"}),
        };

        println!("PORT_CASE {} {}", id, serde_json::to_string(&v).unwrap());
        std::io::stdout().flush().ok();
    }
    println!("PORT_DONE");
}
