//! Golden-fixture conformance for the shared kernel types (R1).
//!
//! `INodeExecutionData` / `BinaryData` / `IDataObject` are the wire shapes every other
//! crate builds on; this pins them against values OBSERVED on the pinned runtime
//! (`tests/reference/execution-data/**`) and the workflow goldens.

use n8n_common::{BinaryData, IDataObject, INodeExecutionData};
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
fn engine_item_envelope_deserialises_and_round_trips() {
    let expected = read_json("tests/reference/execution-data/01-single-item/expected.json");
    let item_json = &expected["runData"]["Pass"][0]["main"][0][0];

    let item: INodeExecutionData =
        serde_json::from_value(item_json.clone()).expect("engine item deserialises");
    assert_eq!(item.json["id"], Value::from(0));
    assert_eq!(item.paired_item.as_ref().expect("pairedItem"), &expected["runData"]["Pass"][0]["main"][0][0]["pairedItem"]);

    let back = serde_json::to_value(&item).expect("item serialises");
    assert_eq!(&back, item_json, "envelope round-trips verbatim");
}

#[test]
fn binary_data_deserialises_from_the_runtime_shape() {
    let expected = read_json("tests/reference/execution-data/06-binary-reference/expected.json");
    let binary_json = &expected["runData"]["BinaryCreate"][0]["main"][0][0]["binary"]["data"];

    let data: BinaryData =
        serde_json::from_value(binary_json.clone()).expect("binary data deserialises");
    assert_eq!(data.mime_type, "text/plain");
    assert_eq!(data.data, "aGVsbG8gMA==");
    assert_eq!(data.file_name.as_deref(), Some("f0.txt"));
    assert_eq!(data.file_extension.as_deref(), Some("txt"));
}

#[test]
fn idata_object_keeps_parameter_objects_verbatim() {
    let workflow = read_json("tests/reference/03-linear/workflow.json");
    let parameters = &workflow["nodes"][1]["parameters"];

    let object: IDataObject =
        serde_json::from_value(parameters.clone()).expect("parameters deserialise");
    let back: Value = serde_json::to_value(&object).expect("IDataObject serialises");
    assert_eq!(&back, parameters, "parameter objects survive a round-trip verbatim");
}
