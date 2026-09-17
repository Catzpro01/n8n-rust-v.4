//! Agent 4 parity probe: runs the CURRENT crates/n8n-validation API against the
//! language-neutral fixtures tests/reference/agent-4/validation/fixtures/D*.json
//! and reports, per fixture, whether the crate's observable verdict matches the oracle.
//! The crate has no `validate_workflow`, so an adapter emulates the closest possible
//! composition (uniqueness → dangling → cycles-if-!allowCycles). Codes are mapped from
//! the thiserror variants; messages/paths cannot be compared (crate has none).
use n8n_connection::WorkflowConnections;
use n8n_validation::*;
use serde_json::Value;
use std::path::Path;

fn adapter(wf: &Value, allow_cycles: bool) -> Result<(bool, Vec<&'static str>), String> {
    let nodes = wf.get("nodes").and_then(Value::as_array).ok_or("INVALID_INPUT not representable")?;
    let names: Vec<String> = nodes.iter().map(|n| n["name"].as_str().unwrap_or("").to_string()).collect();
    let conns: WorkflowConnections = match wf.get("connections") {
        None | Some(Value::Null) => WorkflowConnections::new(),
        Some(c) => serde_json::from_value(c.clone()).map_err(|e| format!("typed connections deserialisation failed: {e}"))?,
    };
    let mut codes = vec![];
    if let Err(ValidationError::DuplicateNodeName(_)) = validate_node_uniqueness(&names) { codes.push("DUPLICATE_NODE_NAME"); }
    if let Err(ValidationError::DanglingConnection(_)) = validate_dangling_connections(&names, &conns) { codes.push("DANGLING_CONNECTION"); }
    if !allow_cycles { if let Err(ValidationError::CycleDetected(_)) = detect_cycles(&names, &conns) { codes.push("CYCLE_DETECTED"); } }
    Ok((codes.is_empty(), codes))
}

#[test]
fn parity_against_ts_oracle_fixtures() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/reference/agent-4/validation/fixtures");
    assert!(dir.exists(), "fixtures missing: {}", dir.display());
    let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.file_name().unwrap().to_str().unwrap().starts_with('D')).collect();
    files.sort();
    let (mut pass, mut fail) = (0, 0);
    for p in &files {
        let fx: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
        let id = fx["id"].as_str().unwrap();
        let allow = fx["input"]["options"]["allowCycles"].as_bool().unwrap_or(true);
        let exp_valid = fx["expected"]["valid"].as_bool().unwrap();
        let mut exp_codes: Vec<&str> = fx["expected"]["errors"].as_array().unwrap().iter().map(|e| e["code"].as_str().unwrap()).collect();
        exp_codes.dedup();
        let verdict = match adapter(&fx["input"]["workflow"], allow) {
            Err(why) => format!("FAIL  {id}: crate cannot process input ({why}); oracle expects valid={exp_valid} codes={exp_codes:?}"),
            Ok((valid, codes)) => {
                let mut ec: Vec<&str> = exp_codes.clone(); ec.sort(); ec.dedup();
                let mut gc = codes.clone(); gc.sort();
                if valid == exp_valid && ec == gc { format!("ok    {id}: valid={valid} codes={codes:?}") }
                else { format!("FAIL  {id}: crate valid={valid} codes={codes:?} | oracle valid={exp_valid} codes={exp_codes:?}") }
            }
        };
        if verdict.starts_with("ok") { pass += 1 } else { fail += 1 }
        eprintln!("{verdict}");
    }
    eprintln!("== parity {pass}/{} (fail {fail}) — message/path/order parity not even attempted (crate exposes none) ==", files.len());
    assert_eq!(files.len(), 14);
    assert_eq!(fail, 0, "crates/n8n-validation is NON-CONFORMANT: {fail}/{} fixtures diverge", files.len());
}
