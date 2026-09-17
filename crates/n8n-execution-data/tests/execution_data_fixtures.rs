//! Golden-fixture conformance for the Execution Data port (R1).
//!
//! Consumes `tests/reference/execution-data/**`: `case.json` declares the start items a
//! trigger would emit, `expected.json` holds the run data OBSERVED on the pinned
//! runtime. Scope is the item envelope only — engine fields (`source`,
//! `executionStatus`, `lastNodeExecuted`) belong to the execution engine, not to this
//! crate, and are deliberately not asserted.

use n8n_common::INodeExecutionData;
use n8n_execution_data::{extract_json, wrap_data};
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

#[test]
fn single_item_envelope_matches_the_reference() {
    let case = read_json("tests/reference/execution-data/01-single-item/case.json");
    let expected = read_json("tests/reference/execution-data/01-single-item/expected.json");

    // startItems wrapped by the crate carry the same json payloads the Trigger stored.
    let start_json = Value::Array(
        case["startItems"]
            .as_array()
            .expect("startItems array")
            .iter()
            .map(|item| item["json"].clone())
            .collect(),
    );
    let wrapped = wrap_data(start_json);
    assert_eq!(wrapped.len(), 1, "one item in, one envelope out");

    let trigger_item = &expected["runData"]["Trigger"][0]["main"][0][0];
    assert_eq!(extract_json(&wrapped), vec![trigger_item["json"].clone()], "json payload");

    // The engine envelope (pairedItem assigned by the engine) deserialises losslessly.
    let engine_item: INodeExecutionData =
        serde_json::from_value(expected["runData"]["Pass"][0]["main"][0][0].clone())
            .expect("engine envelope deserialises");
    assert_eq!(engine_item.json, trigger_item["json"].clone());
    assert_eq!(
        engine_item.paired_item.expect("pairedItem preserved"),
        trigger_item["pairedItem"].clone()
    );
}

#[test]
fn binary_reference_envelope_deserialises() {
    let expected = read_json("tests/reference/execution-data/06-binary-reference/expected.json");
    let binary_item: INodeExecutionData = serde_json::from_value(
        expected["runData"]["BinaryCreate"][0]["main"][0][0].clone(),
    )
    .expect("binary envelope deserialises");

    let binary = binary_item.binary.expect("binary map present");
    let data = binary.get("data").expect("binary.data entry");
    assert_eq!(data.mime_type, "text/plain");
    assert_eq!(data.data, "aGVsbG8gMA==");
    assert_eq!(data.file_name.as_deref(), Some("f0.txt"));
    assert_eq!(binary_item.json["i"], Value::from(0));
}
