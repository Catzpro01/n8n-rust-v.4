//! Conformance: every case in `tests/reference/agent-3/execution-data/fixtures.json`
//! must reproduce the reference leaf behavior. R/N/C/P cases are literal
//! copies of the in-reference jest cases (cited per case); X-probes pin
//! quirk branches the jest suites never cover. Error cases assert the error
//! class name always, and the message when the reference message is stable
//! (`ApplicationError`; raw `TypeError` texts are engine-specific, so only
//! the name is pinned for those).

use n8n_common::INodeExecutionData;
use n8n_execution_data::{
    construct_execution_metadata, copy_input_items, normalize_items, return_json_array,
};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn load_fixtures() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("reference")
        .join("agent-3")
        .join("execution-data")
        .join("fixtures.json");
    let content = fs::read_to_string(path).expect("fixtures.json readable");
    serde_json::from_str(&content).expect("fixtures.json parses")
}

fn envelopes(value: Value) -> Vec<INodeExecutionData> {
    serde_json::from_value(value).expect("test envelopes parse")
}

fn assert_error(id: &str, err: n8n_execution_data::ExecutionDataError, want: &Value) {
    assert_eq!(err.error_name(), want["name"].as_str().expect("name"), "{id} error name");
    if let Some(message) = want.get("message").and_then(Value::as_str) {
        assert_eq!(err.to_string(), message, "{id} error message");
    }
}

#[test]
fn execution_fixtures_match_reference_leaves() {
    let root = load_fixtures();
    let cases = root["cases"].as_array().expect("cases array");
    let mut asserted = 0;
    for case in cases {
        let id = case["id"].as_str().expect("case id");
        let input = &case["input"];
        match case["fn"].as_str().expect("case fn") {
            "returnJsonArray" => match return_json_array(input) {
                Ok(got) => {
                    let want = case.get("expect").expect("{id} expect");
                    assert_eq!(&serde_json::to_value(&got).expect("value"), want, "{id}");
                }
                Err(err) => assert_error(
                    id,
                    err,
                    case.get("expectError").expect("{id} expectError"),
                ),
            },
            "normalizeItems" => match normalize_items(input) {
                Ok(got) => {
                    let want = case.get("expect").expect("{id} expect");
                    assert_eq!(&serde_json::to_value(&got).expect("value"), want, "{id}");
                }
                Err(err) => assert_error(
                    id,
                    err,
                    case.get("expectError").expect("{id} expectError"),
                ),
            },
            "constructExecutionMetaData" => {
                let items = envelopes(input.clone());
                let item_data = case.get("itemData").expect("{id} itemData");
                let got = construct_execution_metadata(&items, item_data);
                let want = case.get("expect").expect("{id} expect");
                assert_eq!(&serde_json::to_value(&got).expect("value"), want, "{id}");
            }
            "copyInputItems" => {
                let items = envelopes(input.clone());
                let properties: Vec<String> = case["properties"]
                    .as_array()
                    .expect("{id} properties")
                    .iter()
                    .map(|p| p.as_str().expect("prop").to_owned())
                    .collect();
                let got = copy_input_items(&items, &properties);
                let want = case.get("expect").expect("{id} expect");
                assert_eq!(&Value::Array(got), want, "{id}");
            }
            other => panic!("unknown fixture fn {other} in case {id}"),
        }
        asserted += 1;
    }
    assert_eq!(asserted, cases.len());
    // Pinned so a changed fixture set forces a conscious harness update.
    assert_eq!(cases.len(), 39, "expected 39 fixture cases");
}
