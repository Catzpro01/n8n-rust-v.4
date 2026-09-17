//! Negative-fixture conformance for the validation rules.
//!
//! `validation_fixtures.rs` proves the port reproduces the reference's *reports* over 34 generated
//! cases. This file does the complementary job: it runs the two **negative** golden workflows under
//! `tests/reference/` through the public entry point and asserts they are rejected, for the right
//! reason and in the reference's order.
//!
//! A rule set exercised only against valid workflows cannot fail, so it cannot be evidence. These
//! are the cases that make `CYCLE_DETECTED` and `INVALID_CONNECTION_TYPE` falsifiable.
//!
//! A missing fixture is a hard panic, never an early `return` — an early `return` is a PASS in
//! cargo's eyes, so "skip when absent" turns a deleted golden fixture into a green suite
//! (`docs/isolation/CROSS-AGENT-ISSUES.md`, ISSUE-014 defect 2).

use n8n_validation::{validate_workflow_json, OrderedValue, ValidateOptions, ValidationErrorCode};
use std::fs;
use std::path::PathBuf;

fn workflow_text(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("reference")
        .join(name)
        .join("workflow.json");
    fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing golden fixture {}: {error}", path.display()))
}

/// `ValidationError::path` is `Option<Vec<String>>`; compare it against `&str` literals.
fn strs(path: &[String]) -> Vec<&str> {
    path.iter().map(String::as_str).collect()
}

fn codes(report: &n8n_validation::ValidationReport) -> Vec<ValidationErrorCode> {
    report.errors.iter().map(|e| e.code.clone()).collect()
}

/// `tests/reference/05-cyclic-invalid`: `A -> B -> C -> A` must be rejected — and only once the
/// caller opts into cycle checking, because n8n allows runtime loops by default
/// (`ValidateOptions::allow_cycles` defaults to `true`).
#[test]
fn cyclic_fixture_is_rejected_when_cycles_are_not_allowed() {
    let text = workflow_text("05-cyclic-invalid");

    let report = validate_workflow_json(&text, &ValidateOptions { allow_cycles: false });
    assert!(!report.valid, "the negative fixture must be rejected");
    assert!(
        codes(&report).contains(&ValidationErrorCode::CycleDetected),
        "expected CYCLE_DETECTED, got {:?}",
        report.errors
    );

    // The same workflow with the back edge removed must be accepted — otherwise the detector is
    // rejecting everything and the assertion above proves nothing.
    let parsed: OrderedValue = serde_json::from_str(&text).expect("parses");
    let mut acyclic = serde_json::to_value(&parsed).expect("serialises");
    acyclic["connections"].as_object_mut().expect("connections").remove("C");
    let report = validate_workflow_json(
        &serde_json::to_string(&acyclic).expect("re-serialises"),
        &ValidateOptions { allow_cycles: false },
    );
    assert!(report.valid, "back edge removed => valid, got {:?}", report.errors);
}

/// The reference default is `allow_cycles: true` (Loop Over Items is legal at runtime), so the
/// same fixture must be *accepted* by default. Pinning both directions is what stops someone
/// "fixing" the default and silently changing behaviour.
#[test]
fn cyclic_fixture_is_accepted_under_the_reference_default() {
    let report = validate_workflow_json(&workflow_text("05-cyclic-invalid"), &ValidateOptions::default());
    assert!(
        report.valid,
        "n8n allows runtime loops by default; got {:?}",
        report.errors
    );
}

/// `tests/reference/06-invalid-connection-type` carries two distinct violations, and the reference
/// reports them in `Object.entries` order (`workflow-rules.ts:78-107`): the edge type under the
/// earlier key first, then the later key itself.
#[test]
fn invalid_connection_type_fixture_reports_both_sites_in_document_order() {
    let report = validate_workflow_json(&workflow_text("06-invalid-connection-type"), &ValidateOptions::default());
    assert!(!report.valid, "the negative fixture must be rejected");

    let offenders: Vec<&n8n_validation::ValidationError> = report
        .errors
        .iter()
        .filter(|e| e.code == ValidationErrorCode::InvalidConnectionType)
        .collect();
    assert_eq!(offenders.len(), 2, "expected exactly two offenders, got {:?}", report.errors);

    // Site 1: the edge under `main` declares `"type": "bogus"`. The path locates the edge by
    // OUTPUT and TARGET INDEX (`workflow-rules.ts:94` builds
    // `['connections', source, type, String(oi), String(ti)]`, and `:103` appends `'type'`) —
    // it does *not* name the offending value. Pinned by generated fixture `X7-target-type-bad-only`.
    assert_eq!(
        offenders[0].path.as_deref().map(strs),
        Some(["connections", "A", "main", "0", "0", "type"].to_vec()),
        "first offender is the edge type"
    );
    assert_eq!(offenders[0].node.as_deref(), Some("A"));
    assert!(offenders[0].message.contains("bogus"), "message names the value: {}", offenders[0].message);

    // Site 2: the output key `ai_magic` is not a NodeConnectionTypes value. The path stops at the
    // key — it does not descend to the slot indices (`workflow-rules.ts:89`).
    assert_eq!(
        offenders[1].path.as_deref().map(strs),
        Some(["connections", "A", "ai_magic"].to_vec()),
        "second offender is the output key"
    );
    assert_eq!(offenders[1].node.as_deref(), Some("A"));
    assert!(offenders[1].message.contains("ai_magic"), "message names the key: {}", offenders[1].message);

    // Nothing else about this workflow is wrong: it is acyclic, uniquely named and undangling.
    assert_eq!(
        offenders.len(),
        report.errors.len(),
        "unexpected extra errors: {:?}",
        report.errors
    );
}

/// The positive golden fixtures must all pass under the reference default.
#[test]
fn positive_fixtures_are_accepted() {
    for name in ["01-empty-workflow", "02-one-node", "03-linear", "04-disabled-node"] {
        let report = validate_workflow_json(&workflow_text(name), &ValidateOptions::default());
        assert!(report.valid, "{name} should be valid, got {:?}", report.errors);
        assert!(report.errors.is_empty());
    }
}

/// `04-disabled-node`: a disabled node is still a node. `disabled` is runtime behaviour, not a
/// validation rule (`contracts/validation.contract.md` §5), so the fixture stays valid.
#[test]
fn a_disabled_node_is_not_a_validation_error() {
    let report =
        validate_workflow_json(&workflow_text("04-disabled-node"), &ValidateOptions::default());
    assert!(report.valid, "disabled is not a validation rule: {:?}", report.errors);
}
