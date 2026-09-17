//! Conformance: every node in `tests/reference/agent-2/node-model/fixtures.json`
//! (42 real reference nodes extracted by `build-fixtures.mjs`, `--check`
//! stable) must parse as `INode` with full field fidelity, retain unknown
//! fields verbatim in `extra`, and survive a load/save round-trip
//! semantically unchanged. The corpus's `formFields` node additionally pins
//! `rename_form_fields` against real data.

use n8n_node_model::{rename_form_fields, INode};
use serde_json::Value;
use std::fs;
use std::path::Path;

const KNOWN_FIELDS: [&str; 7] = [
    "id",
    "name",
    "type",
    "typeVersion",
    "position",
    "parameters",
    "disabled",
];

fn load_fixtures() -> Value {
    let path = Path::new("../../tests/reference/agent-2/node-model/fixtures.json");
    let content = fs::read_to_string(path).expect("fixtures.json readable");
    serde_json::from_str(&content).expect("fixtures.json parses")
}

#[test]
fn node_corpus_fidelity_and_round_trip() {
    let root = load_fixtures();
    let nodes = root["nodes"].as_array().expect("nodes array");
    let mut asserted = 0;
    let mut form_fields_cases = 0;
    for entry in nodes {
        let id = entry["id"].as_str().expect("node id");
        let raw = &entry["node"];
        let inode: INode = serde_json::from_value(raw.clone()).expect("node parses");

        // Field fidelity against the source JSON.
        assert_eq!(inode.id, raw["id"].as_str().expect("id"), "{id}");
        assert_eq!(inode.name, raw["name"].as_str().expect("name"), "{id}");
        assert_eq!(inode.node_type, raw["type"].as_str().expect("type"), "{id}");
        assert_eq!(
            serde_json::Value::Number(inode.type_version.clone()),
            raw["typeVersion"],
            "{id} typeVersion representation"
        );
        let pos = |i: usize| match &raw["position"][i] {
            serde_json::Value::Number(n) => n.clone(),
            other => panic!("{id} position must be numbers, got {other}"),
        };
        assert_eq!(
            [inode.position[0].clone(), inode.position[1].clone()],
            [pos(0), pos(1)],
            "{id} position representation"
        );
        assert_eq!(inode.parameters.0, raw["parameters"], "{id} parameters");
        assert_eq!(
            inode.disabled,
            raw.get("disabled").and_then(Value::as_bool),
            "{id} disabled"
        );

        // Unknown-field retention: exact key set + verbatim values.
        let mut extra_keys: Vec<&str> =
            inode.extra.keys().map(String::as_str).collect();
        extra_keys.sort_unstable();
        let mut expected: Vec<&str> = entry["expectExtraKeys"]
            .as_array()
            .expect("expectExtraKeys")
            .iter()
            .map(|v| v.as_str().expect("key"))
            .collect();
        expected.sort_unstable();
        assert_eq!(extra_keys, expected, "{id} extra keys");
        for key in &expected {
            assert_eq!(&inode.extra[*key], &raw[key], "{id} extra[{key}]");
        }
        for known in KNOWN_FIELDS {
            assert!(!inode.extra.contains_key(known), "{id} {known} must not leak into extra");
        }

        // Semantic round-trip: serialising loses nothing (key order aside).
        let back = serde_json::to_value(&inode).expect("serialises");
        assert_eq!(&back, raw, "{id} round-trip");
        let again: INode = serde_json::from_value(back).expect("re-parses");
        assert_eq!(again, inode, "{id} fixpoint");

        // Real-data rename pin on the corpus's formFields node(s).
        if raw["parameters"].get("formFields").is_some() {
            form_fields_cases += 1;
            let mut renamed = inode.clone();
            rename_form_fields(&mut renamed, |_| Value::String("RENAMED".to_owned()));
            let before = raw["parameters"]["formFields"]["values"]
                .as_array()
                .expect("values array");
            let after = renamed.parameters.0["formFields"]["values"]
                .as_array()
                .expect("values array")
                .clone();
            assert_eq!(before.len(), after.len(), "{id} value count");
            for (b, a) in before.iter().zip(after.iter()) {
                let is_html = b.get("fieldType").and_then(Value::as_str) == Some("html")
                    && b.get("html").is_some();
                if is_html {
                    assert_eq!(a["html"], Value::String("RENAMED".to_owned()), "{id} html rewritten");
                    let mut b_rest = b.clone();
                    let mut a_rest = a.clone();
                    b_rest.as_object_mut().expect("obj")["html"] = Value::Null;
                    a_rest.as_object_mut().expect("obj")["html"] = Value::Null;
                    assert_eq!(b_rest, a_rest, "{id} siblings untouched");
                } else {
                    assert_eq!(b, a, "{id} non-html entry untouched");
                }
            }
        }

        asserted += 1;
    }
    assert_eq!(asserted, nodes.len());
    assert!(form_fields_cases >= 1, "corpus must pin rename on real data");
    // Pinned so a re-extracted corpus forces a conscious harness update.
    assert_eq!(nodes.len(), 42, "expected 42 corpus nodes");
}
