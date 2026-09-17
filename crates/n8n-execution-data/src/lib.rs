//! Execution-data item helpers — exact ports of the pure leaves in
//! `reference/n8n/packages/core/src/execution-engine/node-execution-context/utils/`:
//!
//! * [`return_json_array`] ← `return-json-array.ts`
//! * [`normalize_items`] ← `normalize-items.ts`
//! * [`construct_execution_metadata`] ← `construct-execution-metadata.ts`
//! * [`copy_input_items`] ← `copy-input-items.ts` (`deepCopy` is `Value::clone`
//!   on JSON: no Dates, no cycles, no `toJSON` hooks can occur)
//!
//! Quirks are ported, not fixed: falsy-`json` wrapping, the rest-spread that
//! lets a pre-existing `pairedItem` win, the binary-only reshape, and the
//! short-circuit order that decides between `Inconsistent item format` and a
//! `TypeError` when `null` elements are present.
//!
//! Conformance is pinned by `tests/reference/agent-3/execution-data/fixtures.json`
//! (25 literal in-reference jest cases + 14 code-derived X-probes, asserted by
//! `tests/execution_fixtures.rs`). The error type mirrors `ApplicationError`
//! (`error_name()` + message parity).

use n8n_common::INodeExecutionData;
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ExecutionDataError {
    /// Reference `ApplicationError('Inconsistent item format')`.
    #[error("Inconsistent item format")]
    InconsistentItemFormat,
    /// Reference raw `TypeError`s (property access on `null`, `.every` on a
    /// non-array, `in` on `null`) plus envelope shapes the typed model cannot
    /// represent (malformed `binary`). Messages are descriptive — V8 texts are
    /// engine-specific and deliberately not mimicked.
    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

impl ExecutionDataError {
    /// Reference error class name (`error.constructor.name`).
    pub fn error_name(&self) -> &'static str {
        match self {
            ExecutionDataError::InconsistentItemFormat => "ApplicationError",
            ExecutionDataError::InvalidInput(_) => "TypeError",
        }
    }
}

fn invalid_input(message: impl Into<String>) -> ExecutionDataError {
    ExecutionDataError::InvalidInput(message.into())
}

/// JavaScript truthiness over JSON values (`[]`/`{}` are truthy; `0`/`""`/
/// `false`/`null` are falsy).
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// Mirrors `typeof item === 'object' && key in item`: primitives (and JSON
/// arrays, which never carry these keys) report `false`, while `null` throws
/// a `TypeError` in the reference — mapped to [`ExecutionDataError::InvalidInput`].
fn has_key(item: &Value, key: &str) -> Result<bool, ExecutionDataError> {
    match item {
        Value::Null => Err(invalid_input(format!(
            "cannot use the `in` operator on null (key `{key}`)"
        ))),
        Value::Object(map) => Ok(map.contains_key(key)),
        _ => Ok(false),
    }
}

fn envelope(json: Value) -> INodeExecutionData {
    INodeExecutionData { json, binary: None, paired_item: None, extra: Default::default() }
}

fn parse_envelope(value: Value) -> Result<INodeExecutionData, ExecutionDataError> {
    serde_json::from_value(value)
        .map_err(|e| invalid_input(format!("envelope shape not representable ({e})")))
}

/// Takes generic input data and brings it into the `{ json }` format n8n uses.
///
/// Non-arrays are wrapped; items with a truthy `json` key are spread through
/// as-is (no double wrapping, extra props preserved); everything else becomes
/// `{ json: item }`. Total like the reference — the only failure is an
/// envelope shape the typed model cannot represent (malformed `binary`).
pub fn return_json_array(data: &Value) -> Result<Vec<INodeExecutionData>, ExecutionDataError> {
    let items: Vec<&Value> = match data {
        Value::Array(items) => items.iter().collect(),
        single => vec![single],
    };
    items
        .into_iter()
        .map(|item| {
            if item.get("json").map(is_truthy).unwrap_or(false) {
                // `{ ...data, json: data.json }` — the explicit set is a no-op
                // that documents the spread-then-set order.
                parse_envelope(item.clone())
            } else {
                Ok(envelope(item.clone()))
            }
        })
        .collect()
}

/// Automatically puts objects under a `json` key; throws
/// `Inconsistent item format` when some items carry `json`/`binary` and
/// others don't. Binary-only arrays are reshaped to
/// `{ json: <keys except binary>, binary }`.
///
/// The `.every`/`.some` short-circuit order is simulated exactly, so a `null`
/// element throws `TypeError` (mapped to `InvalidInput`) only when evaluation
/// actually reaches it — e.g. `[{json}, {plain}, null]` still reports
/// `Inconsistent item format`.
pub fn normalize_items(data: &Value) -> Result<Vec<INodeExecutionData>, ExecutionDataError> {
    let items: Vec<&Value> = match data {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => {
            if data.get("json").map(is_truthy).unwrap_or(false) {
                vec![data]
            } else {
                // `[{ json: executionData }]` trivially passes the first
                // `.every` below, so return it directly.
                return Ok(vec![envelope(data.clone())]);
            }
        }
        _ => {
            return Err(invalid_input(
                "expected an object or array (reference throws TypeError)",
            ))
        }
    };

    let mut all_json = true;
    for item in &items {
        if !has_key(item, "json")? {
            all_json = false;
            break;
        }
    }
    if all_json {
        return items.into_iter().cloned().map(parse_envelope).collect();
    }

    let mut any_json = false;
    for item in &items {
        if has_key(item, "json")? {
            any_json = true;
            break;
        }
    }
    if any_json {
        return Err(ExecutionDataError::InconsistentItemFormat);
    }

    let mut all_binary = true;
    for item in &items {
        if !has_key(item, "binary")? {
            all_binary = false;
            break;
        }
    }
    if all_binary {
        return items
            .into_iter()
            .map(|item| {
                let mut json = serde_json::Map::new();
                let mut binary = Value::Null;
                if let Value::Object(map) = item {
                    for (key, value) in map {
                        if key == "binary" {
                            binary = value.clone();
                        } else {
                            json.insert(key.clone(), value.clone());
                        }
                    }
                }
                parse_envelope(serde_json::json!({ "json": json, "binary": binary }))
            })
            .collect();
    }

    for item in &items {
        if has_key(item, "binary")? {
            return Err(ExecutionDataError::InconsistentItemFormat);
        }
    }

    Ok(items.into_iter().map(|item| envelope(item.clone())).collect())
}

/// Brings input data into the `{ json, pairedItem }` format n8n uses.
///
/// Quirk ported as-is: the reference spreads `...rest` AFTER `pairedItem`,
/// so a pre-existing `pairedItem` on the input wins over `item_data`.
pub fn construct_execution_metadata(
    input_data: &[INodeExecutionData],
    item_data: &Value,
) -> Vec<INodeExecutionData> {
    input_data
        .iter()
        .map(|data| {
            let mut out = data.clone();
            out.paired_item = Some(item_data.clone());
            if let Some(original) = data.paired_item.clone() {
                out.paired_item = Some(original);
            }
            out
        })
        .collect()
}

/// Returns copies of the items containing only `json`, and of that only the
/// listed properties. Missing properties (and properties of a non-object
/// `json`) become `null`, mirroring `item.json[p] === undefined → null`.
/// Values are deep-cloned (`Value::clone` is `deepCopy` on JSON).
///
/// Deliberate no-throw mapping: the reference throws a `TypeError` when
/// `item.json` is `null` (`null[p]`); here that yields `null` like any other
/// missing property (pinned by an X-probe).
pub fn copy_input_items(
    items: &[INodeExecutionData],
    properties: &[String],
) -> Vec<Value> {
    items
        .iter()
        .map(|item| {
            let mut picked = serde_json::Map::new();
            for property in properties {
                picked.insert(
                    property.clone(),
                    item.json.get(property).cloned().unwrap_or(Value::Null),
                );
            }
            Value::Object(picked)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_error_names_match_reference_classes() {
        assert_eq!(
            ExecutionDataError::InconsistentItemFormat.error_name(),
            "ApplicationError"
        );
        assert_eq!(
            invalid_input("x").error_name(),
            "TypeError"
        );
        assert_eq!(
            ExecutionDataError::InconsistentItemFormat.to_string(),
            "Inconsistent item format"
        );
    }

    #[test]
    fn test_js_truthiness() {
        assert!(!is_truthy(&json!(null)));
        assert!(!is_truthy(&json!(false)));
        assert!(!is_truthy(&json!(0)));
        assert!(!is_truthy(&json!(0.0)));
        assert!(!is_truthy(&json!("")));
        assert!(is_truthy(&json!(true)));
        assert!(is_truthy(&json!(1)));
        assert!(is_truthy(&json!("x")));
        assert!(is_truthy(&json!([])));
        assert!(is_truthy(&json!({})));
        assert!(is_truthy(&json!({"a": 1})));
    }

    #[test]
    fn test_copy_clones_independently() {
        let items = vec![INodeExecutionData {
            json: json!({ "a": { "b": [1, 2] } }),
            ..Default::default()
        }];
        let mut out =
            copy_input_items(&items, &[String::from("a")]);
        assert_eq!(out, vec![json!({ "a": { "b": [1, 2] } })]);
        out[0]["a"]["b"][0] = json!(99);
        assert_eq!(items[0].json, json!({ "a": { "b": [1, 2] } }));
    }

    #[test]
    fn test_return_json_array_never_double_wraps() {
        let once = return_json_array(&json!({ "name": "Ann" })).expect("ok");
        assert_eq!(once[0].json, json!({ "name": "Ann" }));
        let envelope = serde_json::to_value(&once[0]).expect("value");
        let twice = return_json_array(&envelope).expect("ok");
        assert_eq!(twice, once);
    }
}
