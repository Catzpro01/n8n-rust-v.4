//! Executable evidence for review findings against the CURRENT crates/n8n-validation (main @ e6c0188a).
//! f3_*/f2_* PASS = the non-conformant behaviour is reproduced. f6_* PASS = the cycle witness is
//! deterministic since the IndexMap switch (8ed00851) — F6 is DOWNGRADED by this evidence.
use n8n_connection::WorkflowConnections;
use n8n_validation::*;
fn conns(json: &str) -> WorkflowConnections { serde_json::from_str(json).unwrap() }
fn s(v: &[&str]) -> Vec<String> { v.iter().map(|x| x.to_string()).collect() }

#[test]
fn f3_fail_fast_reports_one_duplicate_of_three() {
    let r = validate_node_uniqueness(&s(&["A", "A", "B", "B", "C", "C"]));
    assert_eq!(r, Err(ValidationError::DuplicateNodeName("A".into())), "contract §4.4 requires all 3 duplicates accumulated");
}

#[test]
fn f2_ai_tool_edges_counted_as_cycle() {
    let c = conns(r#"{"A":{"ai_tool":[[{"node":"B","type":"ai_tool","index":0}]]},"B":{"ai_tool":[[{"node":"A","type":"ai_tool","index":0}]]}}"#);
    assert!(detect_cycles(&s(&["A", "B"]), &c).is_err(), "contract §11.8: only main edges form cycles → must be Ok");
}

#[test]
fn f6_cycle_witness_depends_on_hashmap_order() {
    // 3 independent 2-cycles; the reported node should be deterministic (oracle: first in nodes[] order = "A").
    let c = conns(r#"{"A":{"main":[[{"node":"B","type":"main","index":0}]]},"B":{"main":[[{"node":"A","type":"main","index":0}]]},
                     "C":{"main":[[{"node":"D","type":"main","index":0}]]},"D":{"main":[[{"node":"C","type":"main","index":0}]]},
                     "E":{"main":[[{"node":"F","type":"main","index":0}]]},"F":{"main":[[{"node":"E","type":"main","index":0}]]}}"#);
    let nodes = s(&["A", "B", "C", "D", "E", "F"]);
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..64 {
        // fresh process-independent HashMap RandomState each call → root iteration order varies
        if let Err(ValidationError::CycleDetected(n)) = detect_cycles(&nodes, &c) { seen.insert(n); }
    }
    eprintln!("cycle witnesses observed across 64 runs: {seen:?}");
    assert_eq!(seen.len(), 1, "non-deterministic witness set {seen:?} (oracle always reports the same first back-edge)");
}

#[test]
fn f6_revisit_neighbor_order_follows_json_key_order_not_nodes_order() {
    // A has two main outputs: [0]→B (B→A cycle) and [1]→C (C→A cycle). Oracle: first back-edge is via B (output order).
    // Here we instead vary the *source key order* of connections; crate adjacency is built from IndexMap iteration.
    let nodes = s(&["A", "B", "C"]);
    let c1 = conns(r#"{"A":{"main":[[{"node":"B","type":"main","index":0}],[{"node":"C","type":"main","index":0}]]},"B":{"main":[[{"node":"A","type":"main","index":0}]]},"C":{"main":[[{"node":"A","type":"main","index":0}]]}}"#);
    let c2 = conns(r#"{"C":{"main":[[{"node":"A","type":"main","index":0}]]},"B":{"main":[[{"node":"A","type":"main","index":0}]]},"A":{"main":[[{"node":"B","type":"main","index":0}],[{"node":"C","type":"main","index":0}]]}}"#);
    let (r1, r2) = (detect_cycles(&nodes, &c1), detect_cycles(&nodes, &c2));
    eprintln!("key-order 1 → {r1:?}; key-order 2 → {r2:?}");
    assert_eq!(r1, r2, "same graph, different JSON key order → different witness");
}
