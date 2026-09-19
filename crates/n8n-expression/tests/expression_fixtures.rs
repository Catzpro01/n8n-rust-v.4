//! Fixture-driven expression tests.
//!
//! Source of truth: `tests/reference/expression/**/{case,expected}.json`, produced by the pinned
//! n8n runtime. The suite has three layers:
//!
//! * the shell pins assert what the port **does** reproduce today: the exact `is_expression`
//!   gate (contract E1), the constructor rejection and the recursive walk, each against the
//!   runtime's own answer where one exists;
//! * `every_probe_is_either_covered_or_recorded` classifies **all 90 probes**: each is either
//!   covered by a test or named in the gap table with the reason the limited backend cannot
//!   reproduce it. Recording the gap is the point — a suite that only tests the supported
//!   subset would go green while the port still cannot evaluate most of the reference's
//!   expression surface, and nothing would say so.
//!
//! A missing fixture is a hard panic, never an early `return`.

use n8n_expression::{
    evaluate_simple_json_path, is_expression, resolve_leaf, resolve_template, resolve_value,
    simple_backend_evaluate, EvalValue,
};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

const CASES: [&str; 6] = [
    "01-json-access",
    "02-input-access",
    "03-node-data-access",
    "04-multiple-items",
    "05-missing-property",
    "06-expression-inside-parameter",
];

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

fn item_json(case: &str, index: usize) -> Value {
    case_file(case, "case.json")["connectionInputData"][index]["json"].clone()
}

fn probe_value(case: &str, name: &str) -> Value {
    probes(case)
        .into_iter()
        .find(|p| p["name"] == json!(name))
        .unwrap_or_else(|| panic!("{case}: no probe named {name:?}"))["value"]
        .clone()
}

/// Contract E1 over every string probe in all six cases: only strings whose first character is
/// `=` are expressions — and the reference observably agrees, returning every other string
/// byte-identical while processing every `=` string into something different.
#[test]
fn e1_only_leading_equals_strings_are_expressions() {
    // Adversarial literals first: braces without `=` are NOT expressions (the old
    // brace-sniffing gate returned true here), and the bare `=` IS one.
    assert!(!is_expression("a {{ $json.a }}"));
    assert!(!is_expression("Hello {{ $json.name }}!"));
    assert!(!is_expression("Price: 10 {{"));
    assert!(!is_expression(""));
    assert!(is_expression("="));

    let mut checked = 0usize;
    for case in CASES {
        let fixture = expected(case);
        for probe in probes(case) {
            let name = probe["name"].as_str().expect("probe name").to_string();
            let Some(value) = probe["value"].as_str() else { continue };
            assert_eq!(
                is_expression(value),
                value.starts_with('='),
                "{case} / {name}: the gate must be exactly the leading-`=` rule"
            );
            if value.starts_with('=') {
                assert_ne!(
                    fixture[&name], json!(value),
                    "{case} / {name}: the reference processed this `=` string"
                );
            } else {
                assert_eq!(
                    fixture[&name],
                    json!(value),
                    "{case} / {name}: non-`=` strings come back byte-identical"
                );
            }
            checked += 1;
        }
    }
    // Exact: 90 probes minus the 3 object probes in 06. A new probe forces a re-audit.
    assert_eq!(checked, 87, "string-probe count drifted — re-run the audit");
}

/// The bare `=` is an expression (it resolves to `""`), full stop. The old gate returned
/// `false` here; the flip was made with the caller audit the old pin demanded: `is_expression`
/// has zero callers outside this crate's own tests, and the only in-crate caller,
/// `resolve_leaf`, treats `true` exactly as the reference does (strip `=`, evaluate the rest).
#[test]
fn the_bare_equals_sign_is_an_expression() {
    let fixture = expected("06-expression-inside-parameter");
    assert_eq!(fixture["leading '=' with no braces -> empty string"], json!(""));
    assert_eq!(fixture["'=' followed by literal text"], json!("just text"));
    assert_eq!(fixture["escaped-looking braces are literal"], json!("a {{ b"));

    assert!(is_expression("="));
    assert_eq!(resolve_template("=", &json!({})), "");
    assert_eq!(resolve_template("=just text", &json!({})), "just text");
    assert_eq!(resolve_template("a {{ b", &json!({})), "a {{ b");

    // End to end through the shell, against the runtime oracles.
    let current = item_json("06-expression-inside-parameter", 0);
    for name in ["leading '=' with no braces -> empty string", "'=' followed by literal text"] {
        let value = probe_value("06-expression-inside-parameter", name);
        let got = resolve_value(&value, false, &|body| simple_backend_evaluate(body, &current))
            .expect("shell resolves");
        assert_eq!(got, fixture[name], "{name}");
    }
}

/// `01-json-access`, the interpolation probes: `=Value: {{ $json.a }}!` and the two-expression
/// concatenation are exactly what the limited backend implements, so they are compared against
/// the runtime's own answer rather than a hand-written expectation.
#[test]
fn interpolation_probes_match_the_reference() {
    let fixture = expected("01-json-access");
    let current = item_json("01-json-access", 0);

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
    // reference keeps the number type (`11` for `$json.a + 1`), which the backend cannot
    // express. Recorded as unsupported below, not papered over.
    let probe = by_name("$json.a item 0");
    assert_eq!(resolve_template(probe["value"].as_str().expect("value"), &current), "10");
    assert_eq!(fixture["$json.a item 0"], json!(10), "the reference keeps the number");
}

/// The remaining backend matches: identity for the plain string, and `""` substitution for a
/// missing path inside surrounding text. Both go through the shell to prove the wiring.
#[test]
fn newly_covered_probes_match_the_reference() {
    let plain = probe_value("01-json-access", "plain string (no '=' prefix) is returned as-is");
    let current = item_json("01-json-access", 0);
    let got = resolve_value(&plain, false, &|body| simple_backend_evaluate(body, &current))
        .expect("shell resolves");
    assert_eq!(got, expected("01-json-access")["plain string (no '=' prefix) is returned as-is"]);

    let missing = probe_value("05-missing-property", "missing inside text -> empty");
    let current = item_json("05-missing-property", 0);
    let got = resolve_value(&missing, false, &|body| simple_backend_evaluate(body, &current))
        .expect("shell resolves");
    assert_eq!(got, expected("05-missing-property")["missing inside text -> empty"]);
}

/// The shell reproduces two runtime errors exactly: the constructor pre-check fires on the `05`
/// probe and — via `$now.constructor.name` — on the `06` DateTime probe. Name and message are
/// compared against the runtime oracles, not hand-written.
#[test]
fn constructor_rejections_match_the_runtime_errors() {
    for (case, name) in [
        ("05-missing-property", "constructor access blocked"),
        ("06-expression-inside-parameter", "$now is DateTime"),
    ] {
        let value = probe_value(case, name);
        let oracle = expected(case)[name].clone();
        let boom = |_: &str| -> Result<EvalValue, n8n_expression::EvalFault> {
            panic!("the evaluator must not run once the constructor check fires")
        };
        let err = resolve_leaf(&value, false, &boom).expect_err("constructor call rejected");
        assert_eq!(err.error_name(), oracle["error"].as_str().expect("error class"), "{name}");
        assert_eq!(err.to_string(), oracle["message"].as_str().expect("message"), "{name}");
    }
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

/// The `06` object probes walked with a stub evaluator: keys, order, nesting, arrays and every
/// non-expression leaf (strings, numbers, booleans, null) must survive exactly. The stub marks
/// each routed leaf so a leaf the walk skipped — or routed twice — fails loudly.
#[test]
fn walk_preserves_structure_with_a_stub_evaluator() {
    let stub = |body: &str| -> Result<EvalValue, n8n_expression::EvalFault> {
        Ok(EvalValue::Value(Value::String(format!("<span:{body}>"))))
    };
    let walked = |name: &str| {
        resolve_value(&probe_value("06-expression-inside-parameter", name), false, &stub)
            .expect("walk resolves")
    };

    assert_eq!(
        walked("nested parameter object"),
        json!({
            "value": "<span:{{ $json.a }}>",
            "nested": {"deep": "<span:{{ $json.a * 2 }}>", "static": "text"},
            "list": ["<span:{{ $json.a }}>", "plain", 7],
            "num": 5,
            "bool": true,
            "nul": null
        })
    );
    assert_eq!(
        walked("array of objects"),
        json!([{"k": "<span:{{ $itemIndex }}>"}, {"k": "<span:{{ $json.a }}>"}])
    );
    assert_eq!(
        walked("resource locator object"),
        json!({"__rl": true, "mode": "id", "value": "<span:{{ $json.a }}>"})
    );

    // Key order is preserved through the rebuild (contract §3).
    let rebuilt = walked("nested parameter object");
    let keys: Vec<&str> = rebuilt
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, vec!["value", "nested", "list", "num", "bool", "nul"]);

    // `returnObjectAsString` renders the rebuilt top-level object (no fixture covers the flag;
    // the shape is transcribed from `convertObjectValueToString`).
    let rendered = resolve_value(&json!({"b": 2, "a": 1}), true, &stub).expect("walk resolves");
    assert_eq!(rendered, json!("[Object: {\"b\": 2, \"a\": 1}]"));
}

/// The `06` object probes walked with the real backend at each probe's item context: every
/// identity leaf must equal the runtime oracle, and every expression leaf must equal the
/// backend's documented output — stringified where the reference keeps the type, literal where
/// the span needs JS evaluation or proxy context. Per-leaf gaps, not a blanket waiver.
#[test]
fn walk_with_the_backend_documents_per_leaf_gaps() {
    let item0 = item_json("06-expression-inside-parameter", 0);
    let item1 = item_json("06-expression-inside-parameter", 1);
    let at = |name: &str, current: &Value| {
        resolve_value(
            &probe_value("06-expression-inside-parameter", name),
            false,
            &|body| simple_backend_evaluate(body, current),
        )
        .expect("walk resolves")
    };

    // Item context 0 (`{"a": 10}`): identity leaves match the oracle exactly.
    let nested = at("nested parameter object", &item0);
    let oracle = &expected("06-expression-inside-parameter")["nested parameter object"];
    assert_eq!(nested["nested"]["static"], oracle["nested"]["static"]);
    assert_eq!(nested["list"][1], oracle["list"][1]);
    assert_eq!(nested["list"][2], oracle["list"][2]);
    assert_eq!(nested["num"], oracle["num"]);
    assert_eq!(nested["bool"], oracle["bool"]);
    assert_eq!(nested["nul"], oracle["nul"]);
    // Expression leaves: the documented backend outputs (oracle keeps number / evaluates).
    assert_eq!(nested["value"], json!("10"), "type-preservation gap");
    assert_eq!(nested["list"][0], json!("10"), "type-preservation gap");
    assert_eq!(
        nested["nested"]["deep"],
        json!("{{ $json.a * 2 }}"),
        "js-eval gap: the span stays literal"
    );

    // Item context 1 (`{"a": 20}`, `$itemIndex` 1): both leaves diverge, each for its reason.
    let array = at("array of objects", &item1);
    assert_eq!(
        array[0]["k"],
        json!("{{ $itemIndex }}"),
        "graph-context gap: $itemIndex needs the engine"
    );
    assert_eq!(array[1]["k"], json!("20"), "type-preservation gap");

    let locator = at("resource locator object", &item0);
    assert_eq!(locator["__rl"], json!(true));
    assert_eq!(locator["mode"], json!("id"));
    assert_eq!(locator["value"], json!("10"), "type-preservation gap");
}

/// The honest gap list, now complete: every probe the port cannot reproduce is named here with
/// the reason, and the test fails if a probe is neither covered by a test nor recorded here —
/// or if a recorded probe stops existing.
#[test]
fn every_probe_is_either_covered_or_recorded() {
    // (case, probe name, why the limited backend cannot reproduce the oracle)
    let gaps: &[(&str, &str, &str)] = &[
        // 01-json-access: 10 of 13 (plain string + 2 interpolations covered above).
        ("01-json-access", "$json.a item 0", "type-preservation: single span keeps the number"),
        ("01-json-access", "$json.a item 1", "type-preservation: single span keeps the number"),
        ("01-json-access", "single expression keeps number type", "js-eval: arithmetic in the span"),
        ("01-json-access", "single expression returns object", "type-preservation: single span keeps the object"),
        ("01-json-access", "object inside text becomes [object Object]", "text-coercion: objects render as [object Object]"),
        ("01-json-access", "boolean", "js-eval: comparison in the span"),
        ("01-json-access", "null", "type-preservation: single span keeps null"),
        ("01-json-access", "$data alias of $json", "input-proxy: $data alias"),
        ("01-json-access", "$json out of range item index", "error-taxonomy: proxy-owned pairedItemInvalidIndex message"),
        ("01-json-access", "$json with empty input", "input-proxy: empty-input no_execution_data"),
        // 02-input-access: all 14 need the input side of the proxy.
        ("02-input-access", "$input.item.json.a", "input-proxy"),
        ("02-input-access", "$input.item.json.a item 2", "input-proxy"),
        ("02-input-access", "$input.first().json.a", "input-proxy"),
        ("02-input-access", "$input.last().json.a", "input-proxy"),
        ("02-input-access", "$input.all().length", "input-proxy"),
        ("02-input-access", "$input.all() map", "input-proxy"),
        ("02-input-access", "$input.first(1) rejects arguments", "input-proxy: argument rejection"),
        ("02-input-access", "$input.params (params of previous node)", "input-proxy: executeData.source"),
        ("02-input-access", "$input.item with empty input", "input-proxy: empty-input error"),
        ("02-input-access", "$input.params without executeData", "input-proxy: executeData.source"),
        ("02-input-access", "$input.item.pairedItem visible", "input-proxy: engine-rewritten pairedItem"),
        ("02-input-access", "$thisItem alias", "input-proxy: $thisItem alias"),
        ("02-input-access", "$itemIndex / $position", "graph-context: run indices"),
        ("02-input-access", "$prevNode", "graph-context: executeData.source"),
        // 03-node-data-access: all 22 need runData (+ graph for pairing/branch).
        ("03-node-data-access", "$('Start').item.json.name item 1 (1 hop pairing)", "node-proxy: pairing walk"),
        ("03-node-data-access", "$('Start').pairedItem().json.name item 2", "node-proxy: pairing walk"),
        ("03-node-data-access", "$('Start').itemMatching(0).json.name", "node-proxy: pairing walk"),
        ("03-node-data-access", "$('Start').first().json.name", "node-proxy: runData"),
        ("03-node-data-access", "$('Start').last().json.name", "node-proxy: runData"),
        ("03-node-data-access", "$('Start').all().length", "node-proxy: runData"),
        ("03-node-data-access", "$('Start').isExecuted", "node-proxy: runData presence"),
        ("03-node-data-access", "$('End').isExecuted (self, not run)", "node-proxy: runData presence"),
        ("03-node-data-access", "$('Start').params", "node-proxy: resolved parameters"),
        ("03-node-data-access", "$node['Start'].json.name uses itemIndex", "node-proxy: positional access"),
        ("03-node-data-access", "$node['Set'].json.a", "node-proxy: positional access"),
        ("03-node-data-access", "$items('Start').length (legacy)", "node-proxy: legacy alias"),
        ("03-node-data-access", "$item(1).$node['Start'].json.name (legacy)", "node-proxy: legacy alias"),
        ("03-node-data-access", "$('Nope') unknown node", "node-proxy: nodeNotFound error"),
        ("03-node-data-access", "$node['Nope'] unknown node", "node-proxy: nodeNotFound error"),
        ("03-node-data-access", "$('End').first() node not executed", "node-proxy: no_execution_data error"),
        ("03-node-data-access", "$node['End'].json node not executed", "node-proxy: no_execution_data error"),
        ("03-node-data-access", "$('Start').item without pairedItem on input", "node-proxy: paired_item_no_info error"),
        ("03-node-data-access", "$('Start').item without executeData.source", "node-proxy: source error"),
        ("03-node-data-access", "$('Start').first() with runExecutionData=null", "node-proxy: null runData"),
        ("03-node-data-access", "$('Set').first(1) branch out of range", "node-proxy: branch-range error"),
        ("03-node-data-access", "$('Start').first(0, 5) run out of range", "node-proxy: run-range error"),
        // 04-multiple-items: all 15.
        ("04-multiple-items", "$json.n per item 0", "type-preservation: single span keeps the number"),
        ("04-multiple-items", "$json.n per item 1", "type-preservation: single span keeps the number"),
        ("04-multiple-items", "$('Start').item.json.n item 0 (2 hops via IF output 0)", "node-proxy: pairing walk"),
        ("04-multiple-items", "$('Start').item.json.n item 1 (2 hops)", "node-proxy: pairing walk"),
        ("04-multiple-items", "$('IF').item.json.n item 1", "node-proxy: pairing walk"),
        ("04-multiple-items", "$('IF').all() default branch = connected output 0", "node-proxy: graph-default branch"),
        ("04-multiple-items", "$('IF').all(1) explicit other branch", "node-proxy: runData"),
        ("04-multiple-items", "$('IF').first(1).json.n", "node-proxy: runData"),
        ("04-multiple-items", "$('IF').all(2) branch missing", "node-proxy: branch-range error"),
        ("04-multiple-items", "$node['IF'].json.n item 0 via graph output index", "node-proxy: positional access"),
        ("04-multiple-items", "$('Start').all().length", "node-proxy: runData"),
        ("04-multiple-items", "$input.all().length", "input-proxy"),
        ("04-multiple-items", "$('FalseBranch').first() unexecuted", "node-proxy: no_execution_data error"),
        ("04-multiple-items", "$('FalseBranch').item not connected upstream", "node-proxy: paired_item_no_connection error"),
        ("04-multiple-items", "$jmespath over $input.all()", "graph-context: $jmespath helper"),
        // 05-missing-property: 10 of 12 (missing-in-text + constructor covered above).
        ("05-missing-property", "$json.missing", "undefined-result: missing property"),
        ("05-missing-property", "$json.missing.deep (optional chaining by proxy)", "undefined-result: missing property"),
        ("05-missing-property", "$json.a.notAFunction()", "undefined-result: backend swallows the TypeError"),
        ("05-missing-property", "syntax error", "js-eval: syntax detection (shell mapping unit-pinned)"),
        ("05-missing-property", "undefined variable", "undefined-result: unknown identifier"),
        ("05-missing-property", "$('Start').first().json.missing", "node-proxy: runData"),
        ("05-missing-property", "$vars without provider", "undefined-result: additionalKeys passthrough"),
        ("05-missing-property", "$env access denied (no provider)", "datetime-extensions-env: env provider"),
        ("05-missing-property", "$binary when item has none", "input-proxy: $binary metadata"),
        ("05-missing-property", "runExecutionData null: $json still works from input", "type-preservation: single span keeps the number"),
        // 06-expression-inside-parameter: 8 strings + 3 object probes (see the walk tests).
        ("06-expression-inside-parameter", "escaped-looking braces are literal", "nested-eval: inner span evaluates first"),
        ("06-expression-inside-parameter", "$parameter of active node (End has none)", "graph-context: sibling parameters"),
        ("06-expression-inside-parameter", "$('Set').params", "node-proxy: resolved parameters"),
        ("06-expression-inside-parameter", "$now.toFormat", "datetime-extensions-env: luxon DateTime"),
        ("06-expression-inside-parameter", "extension method .toUpperCase() on node data", "node-proxy: runData"),
        ("06-expression-inside-parameter", "n8n extension .isEmpty()", "datetime-extensions-env: extendSyntax"),
        ("06-expression-inside-parameter", "$workflow", "graph-context: workflow metadata"),
        ("06-expression-inside-parameter", "$runIndex / $mode / $nodeVersion / $nodeId", "graph-context: run metadata"),
        ("06-expression-inside-parameter", "nested parameter object", "walk-leaves: structure pinned, expression leaves diverge per leaf"),
        ("06-expression-inside-parameter", "array of objects", "walk-leaves: structure pinned, expression leaves diverge per leaf"),
        ("06-expression-inside-parameter", "resource locator object", "walk-leaves: structure pinned, expression leaves diverge per leaf"),
    ];
    // (case, probe name) covered by a test above — value matches and shell-error matches.
    let covered: &[(&str, &str)] = &[
        ("01-json-access", "plain string (no '=' prefix) is returned as-is"),
        ("01-json-access", "string interpolation"),
        ("01-json-access", "two expressions concatenate to string"),
        ("05-missing-property", "missing inside text -> empty"),
        ("05-missing-property", "constructor access blocked"),
        ("06-expression-inside-parameter", "leading '=' with no braces -> empty string"),
        ("06-expression-inside-parameter", "'=' followed by literal text"),
        ("06-expression-inside-parameter", "$now is DateTime"),
    ];

    let mut total = 0usize;
    for case in CASES {
        let names: Vec<String> = probes(case)
            .iter()
            .map(|p| p["name"].as_str().expect("name").to_string())
            .collect();
        for name in &names {
            let recorded = gaps.iter().any(|(c, n, _)| c == &case && n == name);
            let is_covered = covered.iter().any(|(c, n)| c == &case && n == name);
            assert!(
                recorded ^ is_covered,
                "{case} / {name}: exactly one of covered/recorded must hold"
            );
            total += 1;
        }
    }
    // And nothing may linger on the gap list once the port learns it.
    for (case, name, _) in gaps {
        assert!(
            probes(case).iter().any(|p| p["name"] == json!(name)),
            "{case} / {name} no longer exists in the fixture"
        );
    }
    assert_eq!(total, 90, "probe count drifted — re-run the audit");
    assert_eq!(gaps.len(), 82, "gap count drifted — re-run the audit");
    eprintln!(
        "expression port covers {}/{} probes ({} value + {} shell-error); {} recorded gaps",
        covered.len(),
        total,
        covered.len() - 2,
        2,
        gaps.len()
    );
}
