//! Fixture-driven node-model tests.
//!
//! The point of these is the **round-trip**: a real workflow must survive load → save without a
//! single byte changing shape. `INode` uses `#[serde(flatten)] extra` for exactly that reason, and
//! the golden fixtures are what prove it works rather than merely compiles. A missing fixture is a
//! hard panic, never an early `return`.

use n8n_node_model::INode;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn fixture_doc(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("reference")
        .join(name)
        .join("workflow.json");
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing golden fixture {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("cannot parse {}: {error}", path.display()))
}

fn fixture_nodes(name: &str) -> Vec<INode> {
    serde_json::from_value(fixture_doc(name)["nodes"].clone()).expect("nodes array")
}

/// Every golden fixture's node list must deserialize, and re-serializing must reproduce the
/// original JSON values exactly — including key order, which `preserve_order` now guarantees.
#[test]
fn every_golden_fixture_node_round_trips_byte_identically() {
    for name in [
        "01-empty-workflow",
        "02-one-node",
        "03-linear",
        "04-disabled-node",
        "05-cyclic-invalid",
        "06-invalid-connection-type",
    ] {
        let original = fixture_doc(name)["nodes"].as_array().expect("nodes").clone();
        let nodes = fixture_nodes(name);
        assert_eq!(nodes.len(), original.len(), "{name}: node count");

        for (node, expected) in nodes.iter().zip(original.iter()) {
            let actual: Value = serde_json::to_value(node).expect("serialize INode");
            assert_eq!(&actual, expected, "{name}: node `{}` did not round-trip", node.name);
            // `to_string` catches key-order drift that `to_value` comparison would miss.
            assert_eq!(
                serde_json::to_string(node).expect("to_string"),
                serde_json::to_string(expected).expect("to_string expected"),
                "{name}: node `{}` key order drifted",
                node.name
            );
        }
    }
}

/// `tests/reference/04-disabled-node`: `disabled: true` must survive as `Some(true)`, and a node
/// that omits the key must stay `None` — not `Some(false)`. The start-node algorithm reads these
/// three states differently (`workflow.ts:498` vs `:553` vs `:825`).
#[test]
fn the_disabled_flag_keeps_its_three_states() {
    let nodes = fixture_nodes("04-disabled-node");
    let by_name = |n: &str| nodes.iter().find(|node| node.name == n).expect("node exists").clone();

    assert_eq!(by_name("Manual Trigger").disabled, Some(true));
    assert_eq!(by_name("Code").disabled, None, "an omitted `disabled` must stay None");

    // Serializing must not invent a `disabled: false` that the source never had — that would
    // rewrite every workflow the user opens.
    let code_json: Value = serde_json::to_value(by_name("Code")).expect("serialize");
    assert!(
        !code_json.as_object().expect("object").contains_key("disabled"),
        "an absent `disabled` must not be emitted as false"
    );
}

/// `position` is a 2-tuple of floats and `typeVersion` a float — the wire keeps `1`, the port must
/// not coerce it to an integer type that would fail on `1.1`.
#[test]
fn position_and_type_version_are_floats() {
    let nodes = fixture_nodes("03-linear");
    assert_eq!(nodes.len(), 2);
    for node in &nodes {
        assert_eq!(node.position.len(), 2);
        assert!(
            node.node_type.starts_with("n8n-nodes-base."),
            "{} is not a base node",
            node.node_type
        );
    }
    // `typeVersion` is 1 for the trigger and 2 for `code` in this fixture. The field is a
    // `serde_json::Number` (not `f64`) precisely so `1` survives as `1` and `4.6` as `4.6`.
    assert_eq!(nodes[0].type_version, serde_json::Number::from(1));
    assert_eq!(nodes[1].type_version, serde_json::Number::from(2));
    assert_eq!(nodes[0].position, [serde_json::Number::from(240), serde_json::Number::from(300)]);

    // A fractional version must survive too — an `f64` field would have made `1` come back `1.0`.
    let fractional: INode = serde_json::from_str(
        r#"{"id":"n","name":"N","type":"n8n-nodes-base.noOp","typeVersion":4.6,
            "position":[1.5,2],"parameters":{}}"#,
    )
    .expect("fractional typeVersion parses");
    assert_eq!(fractional.type_version.as_f64(), Some(4.6));

    let rendered = serde_json::to_string(&nodes[1]).expect("serialize");
    assert!(
        rendered.contains("\"typeVersion\":2"),
        "integral typeVersion rendered as a float: {rendered}"
    );
    assert!(
        rendered.contains("\"position\":[460,300]"),
        "integral position rendered as floats: {rendered}"
    );
    assert!(
        serde_json::to_string(&fractional).expect("serialize").contains("\"typeVersion\":4.6"),
        "fractional typeVersion lost precision"
    );
}

/// Unknown fields must not be dropped: a node carrying `credentials` / `webhookId` has to come
/// back out unchanged, or saving a loaded workflow silently destroys user data.
#[test]
fn unknown_fields_survive_the_round_trip() {
    let text = r#"{
        "id": "node-1",
        "name": "Webhook",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": [0, 0],
        "parameters": {},
        "credentials": { "httpHeaderAuth": { "id": "7", "name": "hdr" } },
        "webhookId": "9b1c",
        "notesInFlow": true,
        "alwaysOutputData": false
    }"#;
    let node: INode = serde_json::from_str(text).expect("deserialize");
    let back: Value = serde_json::to_value(&node).expect("serialize");
    let original: Value = serde_json::from_str(text).expect("parse original");
    assert_eq!(back, original, "unknown fields were dropped on the round trip");
    assert!(node.extra.contains_key("credentials"));
    assert!(node.extra.contains_key("webhookId"));
}
