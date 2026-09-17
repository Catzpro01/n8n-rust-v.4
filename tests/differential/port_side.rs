//! Differential harness — PORT side. Injected into the offline rig's build copy by
//! tests/differential/run.sh, so the repository's crates/ is never modified.
//! Emits a JSON map of answers for tests/differential/cases.json.
use n8n_workflow::*;
use serde_json::{json, Value};

#[test]
fn emit_port_answers() {
    let spec: Value =
        serde_json::from_str(include_str!("../../../tests/differential/cases.json")).unwrap();
    let mut out = serde_json::Map::new();

    for c in spec["cases"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap().to_string();
        eprintln!("CASE {}", id);
        let nodes: Vec<Value> = c["nodes"].as_array().unwrap().iter().map(|pair| {
            let n = pair[0].as_str().unwrap();
            let mut v = json!({"id": n, "name": n, "type": "t", "typeVersion": 1,
                               "position": [0,0], "parameters": {}});
            if !pair[1].is_null() { v["disabled"] = pair[1].clone(); }
            v
        }).collect();

        let wire = json!({"id": id, "name": id, "nodes": nodes,
                          "connections": c["connections"], "active": false});
        let w = Workflow::from_wire(&wire).expect("parses");
        let dest = c["dest"].as_str().unwrap();

        let v: Value = match c["op"].as_str().unwrap() {
            "getStartNode" => w.get_start_node(Some(dest))
                .map(|n| json!(n.name)).unwrap_or(Value::Null),
            "getChildNodes" => {
                let mut r = w.get_child_nodes(dest, ConnectionTypeFilter::main(), -1);
                r.sort(); json!(r)
            }
            "getParentNodes" => {
                let mut r = w.get_parent_nodes(dest, ConnectionTypeFilter::main(), -1);
                r.sort(); json!(r)
            }
            _ => json!({"error": "unknown op"}),
        };
        out.insert(id, v);
    }
    println!("PORT_JSON_BEGIN");
    println!("{}", serde_json::to_string(&Value::Object(out)).unwrap());
    println!("PORT_JSON_END");
}
