//! Golden-fixture conformance for the Node Model port (R1).
//!
//! The Node crate is the aggregate's node type: `INode` must parse golden workflow
//! nodes 1:1, preserve unknown fields verbatim, and round-trip to the wire WITHOUT
//! growing fields the reference never wrote (load/save must be byte-stable).

use n8n_node_model::INode;
use serde_json::Value;
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

/// JS numbers are all doubles, so `240` from `JSON.parse` serialises back as `240`; Rust
/// `f64` prints `240.0`. The wire claim is *semantic* byte-stability — no keys added or
/// dropped and every value equal as a JS number — so this compares numbers via `as_f64`
/// (the JSON text may carry a `.0` tail that is representation, not data).
fn assert_js_eq(actual: &Value, expected: &Value, label: &str, name: &str) {
    match (actual, expected) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{label}: `{name}` key count differs (added or dropped keys)");
            for (key, value) in b {
                assert!(
                    a.get(key).is_some(),
                    "{label}: `{name}` missing key `{key}` after round-trip"
                );
                assert_js_eq(&a[key], value, label, name);
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{label}: `{name}` array length differs");
            for (item_a, item_b) in a.iter().zip(b.iter()) {
                assert_js_eq(item_a, item_b, label, name);
            }
        }
        (Value::Number(a), Value::Number(b)) => {
            assert!(
                (a.as_f64().expect("number") - b.as_f64().expect("number")).abs() < f64::EPSILON,
                "{label}: `{name}` number differs: {a} vs {b}"
            );
        }
        _ => assert_eq!(actual, expected, "{label}: `{name}` differs"),
    }
}

#[test]
fn golden_nodes_round_trip_verbatim() {
    // 03-linear: plain nodes (Code node keeps its code parameter).
    let workflow = read_json("tests/reference/03-linear/workflow.json");
    // 04-disabled-node: the disabled-flag golden (explicit true / omitted).
    let disabled = read_json("tests/reference/04-disabled-node/workflow.json");

    for (label, doc) in [("03-linear", workflow), ("04-disabled-node", disabled)] {
        let nodes = doc["nodes"].as_array().expect("golden nodes array");
        assert!(!nodes.is_empty(), "{label}: golden must contain nodes");
        for original in nodes {
            let node: INode = serde_json::from_value(original.clone())
                .unwrap_or_else(|error| panic!("{label}: node parses: {error}"));
            let back = serde_json::to_value(&node).expect("node serialises");
            assert_js_eq(&back, original, label, &node.name);
        }
    }
}

#[test]
fn disabled_flag_parses_like_the_reference_declares_it() {
    let doc = read_json("tests/reference/04-disabled-node/workflow.json");
    let nodes = doc["nodes"].as_array().expect("golden nodes array");
    let parsed: Vec<INode> = nodes
        .iter()
        .map(|node| serde_json::from_value(node.clone()).expect("node parses"))
        .collect();

    let by_name = |name: &str| parsed.iter().find(|node| node.name == name).expect(name);
    assert_eq!(by_name("Manual Trigger").disabled, Some(true), "explicit true");
    assert_eq!(by_name("Code").disabled, None, "omitted stays None — NOT Some(false) (ISSUE-017 asymmetry)");
    assert_eq!(by_name("Solo").disabled, None, "omitted stays None");
}

#[test]
fn node_fields_match_the_golden_shape() {
    let doc = read_json("tests/reference/03-linear/workflow.json");
    let code: INode = serde_json::from_value(doc["nodes"][1].clone()).expect("node parses");

    assert_eq!(code.id, "node-2");
    assert_eq!(code.name, "Code");
    assert_eq!(code.node_type, "n8n-nodes-base.code");
    assert_eq!(code.type_version, 2.0);
    assert_eq!(code.position, [460.0, 300.0]);
    assert_eq!(
        code.parameters.0["jsCode"],
        Value::String("return [{ json: { status: 'ok', count: 42 } }];".to_string()),
        "parameters are preserved, not normalised away"
    );
}
