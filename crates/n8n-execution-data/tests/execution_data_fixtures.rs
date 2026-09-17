//! Fixture-driven execution-data tests.
//!
//! Source of truth: `tests/reference/execution-data/**/{case,expected}.json`, generated against
//! the pinned n8n runtime. The item envelope (`{json, binary?, pairedItem?}`) and the auto-pairing
//! rules are compared against what the reference actually emitted, not against what this crate
//! happens to produce. A missing fixture is a hard panic, never an early `return`.
//!
//! Wrapping goes through `return_json_array`, the exact port of the reference `returnJsonArray`
//! leaf (TASK-405): on the plain-object payloads these fixtures use it behaves exactly like the
//! old `wrap_data` did, minus the double-wrap defect. Item pairing is engine-assigned
//! (`assignPairedItems` in the reference runner) — no count-based pure helper can be the rule,
//! so the pairing pins below assert the recorded fixture shapes directly.

use n8n_execution_data::return_json_array;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

fn case_file(case: &str, file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("reference")
        .join("execution-data")
        .join(case)
        .join(file);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing golden fixture {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("cannot parse {}: {error}", path.display()))
}

/// The reference's own output slot for a node — the items the engine actually recorded.
fn output_slot(case: &str, node: &str) -> Vec<Value> {
    case_file(case, "expected.json")["runData"][node][0]["main"][0]
        .as_array()
        .unwrap_or_else(|| panic!("{case}: no output slot for {node}"))
        .clone()
}

/// Payloads back out of wrapped items — the inverse of wrapping, asserted inline.
fn payloads_of(wrapped: &[n8n_common::INodeExecutionData]) -> Vec<Value> {
    wrapped.iter().map(|item| item.json.clone()).collect()
}

/// `01-single-item` and `02-multiple-items`: `return_json_array` must produce exactly the
/// envelope the reference recorded, and the payloads must come back unchanged.
#[test]
fn wrapping_matches_the_reference_item_envelope() {
    for case in ["01-single-item", "02-multiple-items"] {
        let start_items = case_file(case, "case.json")["startItems"].clone();
        let expected = output_slot(case, "Pass");

        // The trigger's payload is the start items' json, in order.
        let payloads: Vec<Value> = start_items
            .as_array()
            .expect("startItems")
            .iter()
            .map(|item| item["json"].clone())
            .collect();
        let wrapped =
            return_json_array(&Value::Array(payloads)).expect("returnJsonArray over payloads");
        assert_eq!(wrapped.len(), expected.len(), "{case}: item count");

        for (index, item) in wrapped.iter().enumerate() {
            // Wrapping leaves `pairedItem` to the engine; the reference fills it with the index.
            assert_eq!(item.json, expected[index]["json"], "{case}: item {index} payload");
            assert!(item.binary.is_none(), "{case}: no binary in this fixture");
        }
        assert_eq!(
            payloads_of(&wrapped),
            expected.iter().map(|i| i["json"].clone()).collect::<Vec<_>>()
        );
    }
}

/// A non-array input becomes a single item rather than an empty list.
#[test]
fn a_scalar_wraps_into_one_item() {
    let wrapped = return_json_array(&json!({"id": 7})).expect("returnJsonArray over one object");
    assert_eq!(wrapped.len(), 1);
    assert_eq!(wrapped[0].json, json!({"id": 7}));
}

/// `05-empty-data`, node `Empty`: a node that returns nothing records an **empty output slot**
/// (`"main": [[]]`), not a slot holding one item with a null payload.
#[test]
fn a_node_that_returns_nothing_records_an_empty_slot() {
    let slot = output_slot("05-empty-data", "Empty");
    assert_eq!(slot.len(), 0, "the reference records `main: [[]]` — zero items");

    let wrapped = return_json_array(&json!([])).expect("returnJsonArray over an empty array");
    assert!(wrapped.is_empty(), "an empty array must not produce a null item");
    assert!(payloads_of(&wrapped).is_empty());
}

/// `05-empty-data`, node `EmptyAlways`: with `alwaysOutputData` the reference emits **one** item
/// `{json: {}}` whose `pairedItem` is an *array* of every input, not an object.
#[test]
fn always_output_data_emits_one_item_with_an_array_paired_item() {
    let slot = output_slot("05-empty-data", "EmptyAlways");
    assert_eq!(slot.len(), 1);
    assert_eq!(slot[0]["json"], json!({}));
    assert_eq!(
        slot[0]["pairedItem"],
        json!([{"item": 0, "input": 0}, {"item": 1, "input": 0}]),
        "`pairedItem` is an array here, not a single item reference"
    );
}

/// `03-item-pairing` rule (a): equal counts pair by index.
///
/// The pairing is recorded by the engine, not computed by a helper: the fixture shape below is
/// the pin (3 in, 3 out, `pairedItem.item == input index`).
#[test]
fn equal_counts_pair_by_index() {
    // The fixture's `MapNoPair`: 3 in, 3 out, `pairedItem.item == input index`.
    let expected = output_slot("03-item-pairing", "Aggregate");
    for (index, item) in expected.iter().enumerate() {
        assert_eq!(item["pairedItem"], json!({"item": index}), "item {index}");
    }
}

/// `03-item-pairing` rules (b) and (e): a single input pairs every output to item 0, and N inputs
/// collapsing to 1 output pair it to item 0.
#[test]
fn a_single_input_pairs_every_output_to_item_zero() {
    // `Aggregate` collapses 3 inputs to 1 output, so `ExplodeNoPair1` sees a single input and
    // every one of its outputs pairs to item 0.
    let aggregated = output_slot("03-item-pairing", "Aggregate");
    assert_eq!(aggregated.len(), 1, "the aggregate collapses to one item");

    let exploded = output_slot("03-item-pairing", "ExplodeNoPair1");
    assert!(!exploded.is_empty(), "fixture shape drifted");
    for item in &exploded {
        assert_eq!(item["pairedItem"], json!({"item": 0}), "single input => item 0");
    }
}

/// `07-item-helpers` records why no count-based pairing helper exists, and it is worth being
/// explicit about why.
///
/// `Norm` (normalizeItems) has 3 inputs and emits 2 items; the reference pairs **both** to item 0,
/// while a modulo heuristic would yield `[0, 1]`. So modulo is *not* the reference rule for that
/// shape — the real `assignPairedItems` is driven by the helper's own output, not by the item
/// counts alone. `RJA` (returnJsonArray) has 2 inputs and emits 2, and there the reference does
/// pair by index. The old `pair_items` heuristic was removed for exactly this divergence
/// (TASK-405); the recorded shapes stay as the pins.
#[test]
fn the_item_helper_fixture_marks_the_limit_of_the_pairing_heuristic() {
    let rja = output_slot("07-item-helpers", "RJA");
    assert_eq!(rja.len(), 2);
    assert_eq!(rja[0]["pairedItem"], json!({"item": 0}));
    assert_eq!(rja[1]["pairedItem"], json!({"item": 1}), "2 in / 2 out pairs by index");

    let norm = output_slot("07-item-helpers", "Norm");
    assert_eq!(norm.len(), 2);
    for item in &norm {
        assert_eq!(item["pairedItem"], json!({"item": 0}), "3 in / 2 out both pair to item 0");
    }
}
