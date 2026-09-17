//! Regression for ISSUE-028 (agent-5, Stage 2k differential): the Rust port used to
//! STACK-OVERFLOW on a cyclic graph (`A → B → A`) where the real engine returns
//! normally. Root cause: the port's traversal had no `checkedNodes` accumulator.
//! Fixed in TASK-410 (`get_highest_node_inner` — shared, mutating `checkedNodes`,
//! mirroring `workflow.ts:514-545`).
//!
//! Expected answers below were produced by the REAL engine side
//! (`tests/differential/engine_side.mjs`, n8n-workflow@2.9.1) in the two-sided run
//! recorded in TASK-411: 14/14 identical, 0 divergences. This test keeps that pin
//! enforced even in sandboxes where the expr-rig (and therefore the differential
//! stage) is not installed.
use n8n_workflow::Workflow;
use serde_json::json;

fn cyclic_workflow() -> Workflow {
    let wire = json!({
        "id": "cycle-start", "name": "cycle-start", "active": false,
        "nodes": [
            {"id": "A", "name": "A", "type": "t", "typeVersion": 1, "position": [0, 0], "parameters": {}},
            {"id": "B", "name": "B", "type": "t", "typeVersion": 1, "position": [1, 0], "parameters": {}}
        ],
        "connections": {
            "A": {"main": [[{"node": "B", "type": "main", "index": 0}]]},
            "B": {"main": [[{"node": "A", "type": "main", "index": 0}]]}
        }
    });
    Workflow::from_wire(&wire).expect("cyclic wire parses")
}

#[test]
fn cycle_start_matches_the_engine_no_stack_overflow() {
    let workflow = cyclic_workflow();
    // Engine answer (recorded in ISSUE-028): getStartNode('B') -> "A".
    let start = workflow
        .get_start_node(Some("B"))
        .expect("engine returns a start node, so must the port");
    assert_eq!(start.name, "A");
}

#[test]
fn cycle_highest_node_matches_the_engine_no_stack_overflow() {
    let workflow = cyclic_workflow();
    // Engine answer (recorded in ISSUE-028): getHighestNode('B') -> ["A"].
    assert_eq!(
        workflow.get_highest_node("B", None, None),
        vec!["A".to_string()]
    );
    // The reciprocal query terminates too.
    assert_eq!(
        workflow.get_highest_node("A", None, None),
        vec!["B".to_string()]
    );
}
