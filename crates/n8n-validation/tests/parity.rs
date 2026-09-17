//! Parity acceptance test (spec §10.1, `docs/isolation/validation-rust-port-spec.md`).
//!
//! Loads EVERY `tests/reference/agent-4/validation/fixtures/D*.json`, runs
//! `validate_workflow(&fx["input"]["workflow"], fx["input"]["options"])` and asserts the
//! serialised report equals `fx["expected"]` exactly (serde_json map keys are sorted, so
//! the comparison is canonical). 14/14 with zero diffs — the shared TS/Rust oracle.
//!
//! No silent skips: a missing fixture directory panics, a zero-count glob panics, and the
//! expected fixture count (14) is asserted so shrinkage fails loudly.

use n8n_validation::{validate_workflow, ValidateOptions};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const EXPECTED_FIXTURES: usize = 14;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/reference/agent-4/validation/fixtures")
}

#[test]
fn rust_report_matches_the_ts_oracle_on_every_d_fixture() {
    let dir = fixtures_dir();
    assert!(
        dir.is_dir(),
        "parity fixtures missing at {} — the acceptance oracle must be present (spec §10.1)",
        dir.display()
    );

    let mut names: Vec<String> = fs::read_dir(&dir)
        .expect("read fixtures dir")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with('D') && name.ends_with(".json"))
        .collect();
    names.sort();
    assert!(
        !names.is_empty(),
        "no D*.json fixtures found in {} — oracle vanished",
        dir.display()
    );
    assert_eq!(
        names.len(),
        EXPECTED_FIXTURES,
        "fixture count drifted: expected {EXPECTED_FIXTURES}, got {} — re-sync with the TS oracle owner",
        names.len()
    );

    let mut failures: Vec<String> = Vec::new();
    for name in &names {
        let path = dir.join(name);
        let text = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
        let fixture: Value = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("invalid JSON in {}: {error}", path.display()));

        let id = fixture["id"].as_str().unwrap_or(name);
        let workflow = &fixture["input"]["workflow"];
        let options: ValidateOptions = fixture["input"]["options"]
            .as_object()
            .map(|options| {
                serde_json::from_value(Value::Object(options.clone()))
                    .expect("fixture options must parse as ValidateOptions")
            })
            .unwrap_or_default();

        let report = validate_workflow(workflow, options);
        let actual = serde_json::to_value(&report).expect("report serialises");
        let expected = &fixture["expected"];

        if actual == *expected {
            println!("  OK {id}");
        } else {
            failures.push(format!(
                "{id}\n    expected: {expected}\n    actual:   {actual}"
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "\n{} parity failure(s) against the TS oracle:\n  {}",
        failures.len(),
        failures.join("\n  ")
    );
}
