//! Fixture-driven tests for the shared data shapes.
//!
//! `n8n-common` owns `BinaryData` and `INodeExecutionData` — the two types that cross every crate
//! boundary, so a silent field drop here corrupts every execution result downstream. The golden
//! source is `tests/reference/execution-data/06-binary-reference`, whose `expected.json` records
//! the exact `IBinaryData` the reference runtime produces. A missing fixture is a hard panic,
//! never an early `return`.

use n8n_common::{BinaryData, INodeExecutionData};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

fn expected(case: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("reference")
        .join("execution-data")
        .join(case)
        .join("expected.json");
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing golden fixture {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("cannot parse {}: {error}", path.display()))
}

/// The first binary item the reference runtime emits, verbatim.
fn golden_binary() -> Value {
    expected("06-binary-reference")["runData"]["BinaryCreate"][0]["main"][0][0]["binary"]["data"]
        .clone()
}

/// `IBinaryData` in default (in-memory) mode: base64 `data`, `mimeType`, `fileName`,
/// `fileExtension`, `fileType`, `fileSize`, `bytes` — and **no** `id`.
#[test]
fn the_golden_binary_payload_round_trips_without_losing_fields() {
    let golden = golden_binary();
    let keys: Vec<&String> = golden.as_object().expect("object").keys().collect();
    assert_eq!(
        keys,
        vec!["mimeType", "fileType", "fileExtension", "data", "fileName", "fileSize", "bytes"],
        "the reference IBinaryData shape drifted"
    );
    assert!(!golden.as_object().expect("object").contains_key("id"), "in-memory mode has no id");

    let parsed: BinaryData = serde_json::from_value(golden.clone()).expect("deserialize BinaryData");
    assert_eq!(parsed.mime_type, "text/plain");
    assert_eq!(parsed.data, "aGVsbG8gMA==");
    assert_eq!(parsed.file_name.as_deref(), Some("f0.txt"));
    assert_eq!(parsed.file_extension.as_deref(), Some("txt"));

    // The point of the test: nothing the runtime produced may be dropped on the way back out.
    let back: Value = serde_json::to_value(&parsed).expect("serialize BinaryData");
    assert_eq!(back, golden, "fields were lost in the BinaryData round trip");
}

/// Both binary items differ only by index — the fixture must be read, not assumed.
#[test]
fn every_binary_item_in_the_golden_fixture_survives() {
    let slot = expected("06-binary-reference")["runData"]["BinaryCreate"][0]["main"][0].clone();
    let items = slot.as_array().expect("output slot");
    assert_eq!(items.len(), 2, "fixture shape drifted");

    for (index, item) in items.iter().enumerate() {
        let payload = item["binary"]["data"].clone();
        let parsed: BinaryData = serde_json::from_value(payload.clone()).expect("BinaryData");
        assert_eq!(
            parsed.file_name,
            Some(format!("f{index}.txt")),
            "item {index}: unexpected fileName"
        );
        assert_eq!(parsed.bytes, Some(7), "item {index}: unexpected byte count");
        let back: Value = serde_json::to_value(&parsed).expect("serialize");
        assert_eq!(back, payload, "item {index}: round trip lost fields");
    }
}

/// `INodeExecutionData` is `{ json, binary?, pairedItem? }` — the two optional keys must be
/// omitted, not emitted as `null`, because `runData` is compared byte-for-byte against the
/// reference in `tests/reference/execution-data/**/expected.json`.
#[test]
fn the_item_envelope_omits_absent_keys() {
    let single = expected("01-single-item")["runData"]["Pass"][0]["main"][0][0].clone();
    assert_eq!(
        single.as_object().expect("object").keys().cloned().collect::<Vec<_>>(),
        vec!["json".to_string(), "pairedItem".to_string()],
        "the reference emits exactly json + pairedItem here"
    );

    let item: INodeExecutionData = serde_json::from_value(single.clone()).expect("item");
    assert_eq!(item.json, json!({"id": 0}));
    assert!(item.binary.is_none());
    assert_eq!(item.paired_item, Some(json!({"item": 0})));

    let back: Value = serde_json::to_value(&item).expect("serialize");
    assert_eq!(back, single, "absent `binary` must not be emitted as null");

    // …and where the reference does emit `binary`, it must be kept.
    let with_binary = expected("06-binary-reference")["runData"]["BinaryCreate"][0]["main"][0][0]
        .clone();
    let item: INodeExecutionData =
        serde_json::from_value(with_binary.clone()).expect("item with binary");
    assert!(item.binary.is_some(), "binary payload was dropped");
    let back: Value = serde_json::to_value(&item).expect("serialize");
    assert_eq!(back, with_binary);
}

/// Item order is observable: three items in, the same three out, same indices
/// (`tests/reference/execution-data/02-multiple-items`).
#[test]
fn item_order_is_preserved() {
    let slot = expected("02-multiple-items")["runData"]["Pass"][0]["main"][0].clone();
    let items: Vec<INodeExecutionData> =
        serde_json::from_value(slot.clone()).expect("item array");
    assert_eq!(items.len(), 3);
    for (index, item) in items.iter().enumerate() {
        assert_eq!(item.json, json!({"id": index}), "item {index} moved");
        assert_eq!(item.paired_item, Some(json!({"item": index})));
    }
    assert_eq!(serde_json::to_value(&items).expect("serialize"), slot);
}
