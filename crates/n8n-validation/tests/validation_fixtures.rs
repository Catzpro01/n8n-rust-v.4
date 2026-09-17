//! Conformance: every case in `tests/reference/agent-4/validation/fixtures.json`
//! (generated from `workflow-rules.ts` by `build-fixtures.mjs`, `--check`
//! stable) must reproduce identical reports. The fixture file is parsed as an
//! [`OrderedValue`] so workflow key order survives; the input value must be
//! unmodified after the call (mirrors the TS `pure: input is not mutated`
//! test; the borrow checker enforces it, this asserts it).

use n8n_validation::{
    check_dangling_connections, check_node_uniqueness, detect_cycles, validate_workflow,
    OrderedValue, ValidateOptions, ValidationError, ValidationReport,
};
use std::fs;
use std::path::Path;

fn load_fixtures() -> OrderedValue {
    let path = Path::new("../../tests/reference/agent-4/validation/fixtures.json");
    let content = fs::read_to_string(path).expect("fixtures.json readable");
    serde_json::from_str(&content).expect("fixtures.json parses")
}

fn node_names(workflow: &OrderedValue) -> Vec<String> {
    workflow
        .get("nodes")
        .and_then(OrderedValue::as_array)
        .expect("part-case nodes well-formed")
        .iter()
        .map(|n| {
            n.get("name")
                .and_then(OrderedValue::as_str)
                .expect("named node")
                .to_owned()
        })
        .collect()
}

fn decode_report(expect: &OrderedValue) -> ValidationReport {
    let plain = serde_json::to_value(expect).expect("expect serialises");
    serde_json::from_value(plain).expect("report decodes")
}

fn decode_errors(expect: &OrderedValue) -> Vec<ValidationError> {
    let errors = expect.get("errors").expect("errors field");
    let plain = serde_json::to_value(errors).expect("errors serialise");
    serde_json::from_value(plain).expect("errors decode")
}

#[test]
fn validation_fixtures_match_reference_rules() {
    let root = load_fixtures();
    let cases = root.get("cases").and_then(OrderedValue::as_array).expect("cases array");
    let null = OrderedValue::Null;
    let mut asserted = 0;
    for case in cases {
        let id = case.get("id").and_then(OrderedValue::as_str).expect("case id");
        let workflow = case.get("workflow").expect("case workflow");
        let before = workflow.clone();
        match case.get("fn").and_then(OrderedValue::as_str).expect("case fn") {
            "validateWorkflow" => {
                let allow = case
                    .get("options")
                    .and_then(|o| o.get("allowCycles"))
                    .and_then(OrderedValue::as_bool)
                    .unwrap_or(true);
                let got = validate_workflow(workflow, &ValidateOptions { allow_cycles: allow });
                let want = decode_report(case.get("expect").expect("expect"));
                assert_eq!(got, want, "case {id}");
            }
            "checkNodeUniqueness" => {
                let got = check_node_uniqueness(&node_names(workflow));
                let want = decode_errors(case.get("expect").expect("expect"));
                assert_eq!(got, want, "case {id}");
            }
            "checkDanglingConnections" => {
                let conns = workflow.get("connections").unwrap_or(&null);
                let got = check_dangling_connections(&node_names(workflow), conns);
                let want = decode_errors(case.get("expect").expect("expect"));
                assert_eq!(got, want, "case {id}");
            }
            "detectCycles" => {
                let conns = workflow.get("connections").unwrap_or(&null);
                let got = detect_cycles(&node_names(workflow), conns);
                let want = decode_errors(case.get("expect").expect("expect"));
                assert_eq!(got, want, "case {id}");
            }
            other => panic!("unknown fixture fn {other} in case {id}"),
        }
        assert_eq!(&before, workflow, "case {id} leaves input unmodified");
        asserted += 1;
    }
    assert_eq!(asserted, cases.len());
    // Pinned so a regenerated fixture set forces a conscious harness update.
    assert_eq!(cases.len(), 34, "expected 34 generated cases");
}
