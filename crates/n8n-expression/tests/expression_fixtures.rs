//! Golden-fixture conformance for the Expression port (R1).
//!
//! Consumes `tests/reference/expression/01-json-access/`: `case.json` declares the
//! workflow, the connection input data and the probe expressions; `expected.json` holds
//! the values OBSERVED on the pinned runtime.
//!
//! Scope is honest: this crate implements `is_expression`, `$json`-path resolution and
//! template interpolation. Probes that need full JavaScript evaluation (`$json.a + 1`),
//! JS type preservation, the `$data` alias, or `ExpressionError` envelopes are NOT
//! asserted — they are recorded skips, pinned by count so the list cannot drift silently.

use n8n_expression::{evaluate_simple_json_path, is_expression, resolve_template};
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

/// Probes this crate cannot answer honestly (full JS evaluation / type coercion /
/// engine-generated `ExpressionError` envelopes), pinned so growth is explicit.
const UNPORTED_PROBES: [&str; 8] = [
    "single expression keeps number type",
    "single expression returns object",
    "object inside text becomes [object Object]",
    "boolean",
    "null",
    "$data alias of $json",
    "$json out of range item index",
    "$json with empty input",
];

#[test]
fn json_access_probes_match_the_reference() {
    let case = read_json("tests/reference/expression/01-json-access/case.json");
    let expected = read_json("tests/reference/expression/01-json-access/expected.json");
    let input = case["connectionInputData"]
        .as_array()
        .expect("connectionInputData array");

    let mut asserted = 0usize;
    for probe in case["probes"].as_array().expect("probes array") {
        let name = probe["name"].as_str().expect("probe name");
        assert!(expected.get(name).is_some(), "expected value for `{name}` exists");

        if UNPORTED_PROBES.contains(&name) {
            continue;
        }
        let value = probe["value"].as_str().expect("probe value");
        let item_index = probe.get("itemIndex").and_then(Value::as_u64).unwrap_or(0) as usize;
        let context = &input[item_index]["json"];
        let expected_value = &expected[name];

        // A value not starting with `=` is not an expression at all (reference
        // `isExpression`) and is passed through untouched.
        if !value.starts_with('=') {
            assert!(!is_expression(value), "probe `{name}` must not be an expression");
            assert_eq!(
                resolve_template(value, context),
                expected_value.as_str().expect("string golden"),
                "probe `{name}`"
            );
            asserted += 1;
            continue;
        }

        assert!(is_expression(value), "probe `{name}` must be an expression");
        let rendered = resolve_template(value, context);
        // Goldens are typed (`10`, not `"10"`); the crate's interpolation API is
        // string-valued, so compare the rendered text with the golden's text form.
        let golden_text = match expected_value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        assert_eq!(rendered, golden_text, "probe `{name}`");
        asserted += 1;
    }

    assert_eq!(asserted, 5, "asserted probe count drifted");
    assert_eq!(
        case["probes"].as_array().expect("probes").len() - asserted,
        UNPORTED_PROBES.len(),
        "skip count drifted — either a probe was ported (shrink UNPORTED_PROBES) or one was lost"
    );
}

/// `$json` path resolution against the *engine-shaped* input data declared by the case:
/// every `json` leaf is reachable through the path evaluator used by `resolve_template`.
#[test]
fn path_resolution_matches_connection_input_data() {
    let case = read_json("tests/reference/expression/01-json-access/case.json");
    let input = case["connectionInputData"]
        .as_array()
        .expect("connectionInputData array");
    let goldens = [10, 20, 30];

    for (index, golden) in goldens.iter().enumerate() {
        let context = &input[index]["json"];
        let resolved = evaluate_simple_json_path(context, "$json.a")
            .unwrap_or_else(|| panic!("item {index}: $json.a resolves"));
        assert_eq!(resolved.as_i64().expect("number"), *golden, "item {index}");
    }
}
