//! Fixture-driven expression tests.
//!
//! Source of truth: `tests/reference/expression/**/{case,expected}.json`, produced by the pinned
//! n8n runtime. This suite is deliberately split in two:
//!
//! * the first tests assert what the port **does** reproduce today;
//! * `unsupported_probes_are_recorded_not_faked` lists, by name, every probe the port cannot yet
//!   evaluate, and fails if a probe silently moves off that list or a new one appears.
//!
//! Recording the gap is the point. A suite that only tests the supported subset would go green
//! while the port still cannot evaluate most of the reference's expression surface, and nothing
//! would say so. A missing fixture is a hard panic, never an early `return`.

use n8n_expression::{evaluate_simple_json_path, is_expression, resolve_template};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

fn case_file(case: &str, file: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("reference")
        .join("expression")
        .join(case)
        .join(file);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing golden fixture {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("cannot parse {}: {error}", path.display()))
}

fn probes(case: &str) -> Vec<Value> {
    case_file(case, "case.json")["probes"].as_array().expect("probes").clone()
}

fn expected(case: &str) -> Value {
    case_file(case, "expected.json")
}

/// `is_expression` must agree with the reference over every **string-valued** golden probe that
/// carries `{{ … }}`. Probes that are whole parameter trees (objects / arrays) are skipped —
/// `is_expression` only takes a `&str` — and the bare-`=` probes are handled by the dedicated
/// divergence test below, not here.
#[test]
fn is_expression_agrees_with_the_reference_over_every_braced_probe() {
    let mut checked = 0usize;
    for case in [
        "01-json-access",
        "02-input-access",
        "03-node-data-access",
        "04-multiple-items",
        "05-missing-property",
        "06-expression-inside-parameter",
    ] {
        for probe in probes(case) {
            let Some(value) = probe["value"].as_str() else { continue };
            if !value.contains("{{") {
                continue;
            }
            let name = probe["name"].as_str().expect("probe name");
            assert!(
                is_expression(value),
                "{case} / {name}: {value:?} bears braces but was not recognised"
            );
            checked += 1;
        }
    }
    // Without this the loop could silently classify nothing at all.
    assert!(checked >= 40, "only {checked} braced probes were checked — fixture drift");

    // And the negatives: plain strings stay plain.
    assert!(!is_expression("hello"));
    assert!(!is_expression("Price: 10 {{"));
}

/// A recorded divergence, not a passing case.
///
/// `tests/reference/expression/06-expression-inside-parameter` pins three results the reference
/// produces from the leading `=`:
///
/// | probe value            | reference | `resolve_template` |
/// | :--------------------- | :-------- | :----------------- |
/// | `"="`                  | `""`      | `""` ✔            |
/// | `"=just text"`         | `"just text"` | `"just text"` ✔ |
/// | `"a {{ b"` (escaped)   | `"a {{ b"` | `"a {{ b"` ✔     |
///
/// …but `is_expression("=")` returns `false`, while the reference treats the bare `=` as an
/// expression marker. Anything gated on `is_expression` therefore skips a value the reference
/// would resolve. This test holds that line so the gap cannot widen unnoticed.
#[test]
fn the_bare_equals_sign_is_a_recorded_divergence() {
    let expected = expected("06-expression-inside-parameter");
    assert_eq!(expected["leading '=' with no braces -> empty string"], json!(""));
    assert_eq!(expected["'=' followed by literal text"], json!("just text"));
    assert_eq!(expected["escaped-looking braces are literal"], json!("a {{ b"));

    // resolve_template already matches all three.
    assert_eq!(resolve_template("=", &json!({})), "");
    assert_eq!(resolve_template("=just text", &json!({})), "just text");
    assert_eq!(resolve_template("a {{ b", &json!({})), "a {{ b");

    // is_expression does not. Pinned as false so the day it is fixed, this test asks for the
    // callers to be reviewed rather than passing silently.
    assert!(!is_expression("="), "if this now returns true, audit every is_expression caller");
}

/// `01-json-access`, the interpolation probes: `=Value: {{ $json.a }}!` and the two-expression
/// concatenation are exactly what `resolve_template` implements, so they are compared against the
/// runtime's own answer rather than a hand-written expectation.
#[test]
fn interpolation_probes_match_the_reference() {
    let fixture = expected("01-json-access");
    let items = case_file("01-json-access", "case.json")["connectionInputData"]
        .as_array()
        .expect("connectionInputData")
        .clone();
    let current = items[0]["json"].clone();

    let by_name = |name: &str| -> Value {
        probes("01-json-access")
            .into_iter()
            .find(|p| p["name"] == json!(name))
            .unwrap_or_else(|| panic!("no probe named {name:?}"))
    };

    // "=Value: {{ $json.a }}!" -> "Value: 10!"
    let probe = by_name("string interpolation");
    assert_eq!(resolve_template(probe["value"].as_str().expect("value"), &current), "Value: 10!");
    assert_eq!(fixture["string interpolation"], json!("Value: 10!"));

    // "={{ $json.a }}-{{ $json.a }}" -> "10-10"
    let probe = by_name("two expressions concatenate to string");
    assert_eq!(resolve_template(probe["value"].as_str().expect("value"), &current), "10-10");
    assert_eq!(fixture["two expressions concatenate to string"], json!("10-10"));

    // A single `{{ $json.a }}` with no surrounding text still renders as a string here — the
    // reference keeps the number type (`11` for `$json.a + 1`), which `resolve_template` cannot
    // express. Recorded as unsupported below, not papered over.
    let probe = by_name("$json.a item 0");
    assert_eq!(resolve_template(probe["value"].as_str().expect("value"), &current), "10");
    assert_eq!(fixture["$json.a item 0"], json!(10), "the reference keeps the number");
}

/// Path evaluation, against the reference's `$json` payloads.
#[test]
fn simple_json_paths_resolve_against_the_golden_payload() {
    let doc = case_file("01-json-access", "case.json");
    let items = doc["connectionInputData"].as_array().expect("connectionInputData");
    let current = &items[0]["json"];

    let ten = json!(10);
    assert_eq!(evaluate_simple_json_path(current, "$json.a"), Some(&ten));
    assert_eq!(evaluate_simple_json_path(current, "$json.missing"), None);
    // `$json` alone, and a nested walk.
    assert_eq!(evaluate_simple_json_path(current, "$json"), Some(current));
    let nested = json!({"a": {"b": {"c": 3}}});
    let deep = evaluate_simple_json_path(&nested, "$json.a.b.c").cloned();
    assert_eq!(deep, Some(json!(3)));
}

/// The honest gap list. Every probe the port cannot evaluate is named here; the test fails if the
/// reference fixture grows a probe that is neither covered above nor listed here.
#[test]
fn unsupported_probes_are_recorded_not_faked() {
    // Probes whose semantics `resolve_template` / `evaluate_simple_json_path` do not implement:
    // arithmetic, comparison, `$input`/`$node`/`$data` aliases, `null` literals, type-preserving
    // single expressions, and out-of-range / empty-input error behaviour.
    let known_unsupported: &[&str] = &[
        "$json.a item 1",
        "single expression keeps number type",
        "single expression returns object",
        "object inside text becomes [object Object]",
        "boolean",
        "null",
        "$data alias of $json",
        "$json out of range item index",
        "$json with empty input",
    ];
    let covered: &[&str] = &[
        "plain string (no '=' prefix) is returned as-is",
        "$json.a item 0",
        "string interpolation",
        "two expressions concatenate to string",
    ];

    let names: Vec<String> = probes("01-json-access")
        .iter()
        .map(|p| p["name"].as_str().expect("name").to_string())
        .collect();

    for name in &names {
        let accounted =
            known_unsupported.contains(&name.as_str()) || covered.contains(&name.as_str());
        assert!(
            accounted,
            "probe {name:?} is neither covered by a test nor recorded as unsupported — \
             classify it explicitly rather than leaving it untested"
        );
    }
    // And nothing may linger on the unsupported list once the port learns it.
    for name in known_unsupported {
        assert!(names.contains(&name.to_string()), "{name:?} no longer exists in the fixture");
    }

    let total = names.len();
    let gaps = known_unsupported.len();
    assert_eq!(total, covered.len() + gaps, "probe accounting drifted");
    eprintln!(
        "expression port covers {}/{} probes of 01-json-access; {gaps} recorded as unsupported",
        total - gaps,
        total
    );
}
