//! Pins for ISSUE-029 (fixed-by-verification) and ISSUE-030 (declared deviation `D-09`
//! in `contracts/workflow.contract.md`), both filed by Agent 5 from the Stage 2k
//! differential. Every expected value below was produced by the REAL engine side
//! (`tests/differential/engine_side.mjs`, n8n-workflow@2.9.1) in the recorded two-sided
//! run: **37/38 identical, the single divergence being the declared `D-09`**.
use n8n_workflow::START_NODE_TYPES;
use n8n_workflow::Workflow;
use serde_json::json;

fn wire(id: &str, nodes: serde_json::Value, connections: serde_json::Value) -> Workflow {
    Workflow::from_wire(&json!({
        "id": id, "name": id, "active": false, "nodes": nodes, "connections": connections
    }))
    .expect("parses")
}

fn plain(name: &str, disabled: Option<bool>) -> serde_json::Value {
    let mut v = json!({"id": name, "name": name, "type": "t", "typeVersion": 1,
                       "position": [0, 0], "parameters": {}});
    if let Some(d) = disabled {
        v["disabled"] = json!(d);
    }
    v
}

/// ISSUE-029: `getStartNode()` with NO destination must return `undefined` when nothing
/// qualifies — the engine has NO "first node in insertion order" fallback
/// (`workflow.ts:889` → `__getStartNode` → `return undefined`). The old port invented
/// that fallback on the no-destination branch; the destination branch keeps the real
/// `nodes[nodeNames[0]]` fallback (`workflow.ts:884`).
#[test]
fn no_destination_chain_of_plain_nodes_returns_none() {
    // Engine: nodest-chain -> null.
    let workflow = wire(
        "nodest-chain",
        json!([plain("T", None), plain("M", None)]),
        json!({"T": {"main": [[{"node": "M", "type": "main", "index": 0}] ]}}),
    );
    assert!(workflow.get_start_node(None).is_none());
}

#[test]
fn no_destination_single_plain_node_is_returned() {
    // Engine: nodest-single -> "T" (single-candidate rule, workflow.ts:819-826).
    let workflow = wire("nodest-single", json!([plain("T", None)]), json!({}));
    assert_eq!(workflow.get_start_node(None).expect("engine says T").name, "T");
}

#[test]
fn no_destination_single_disabled_node_returns_none() {
    // Engine: nodest-first-disabled -> null (single candidate is skipped when disabled).
    let workflow = wire("nodest-first-disabled", json!([plain("T", Some(true))]), json!({}));
    assert!(workflow.get_start_node(None).is_none());
}

#[test]
fn destination_fallback_returns_the_destination_itself_when_all_parents_disabled() {
    // Engine: all-parents-disabled-start -> "C" (T and M both disabled => getHighestNode
    // finds nothing => the DESTINATION-path fallback `nodes[nodeNames[0]]`
    // (`workflow.ts:884`) returns C itself). NOTE: that fallback exists ONLY on this
    // branch — ISSUE-029 is about the no-destination branch, which has none.
    let workflow = wire(
        "all-parents-disabled-start",
        json!([plain("T", Some(true)), plain("M", Some(true)), plain("C", None)]),
        json!({"T": {"main": [[{"node": "M", "type": "main", "index": 0}] ]},
               "M": {"main": [[{"node": "C", "type": "main", "index": 0}] ]}}),
    );
    assert_eq!(
        workflow
            .get_start_node(Some("C"))
            .expect("engine returns C itself")
            .name,
        "C"
    );
}

/// ISSUE-030 / `D-09` (declared deviation): an UNKNOWN destination returns `None` while
/// the engine throws an incidental `TypeError` (unguarded `this.nodes[nodeName].disabled`).
/// The port deliberately does NOT reproduce the incidental crash — see the contract.
#[test]
fn unknown_destination_returns_none_deviation_d09() {
    let workflow = wire("unknown-node-start", json!([plain("T", None)]), json!({}));
    assert!(workflow.get_start_node(Some("NOPE")).is_none());
    // Same deviation class on the highest-node query.
    assert!(workflow.get_highest_node("NOPE", None, None).is_empty());
}

/// Agent 5's follow-up question from ISSUE-029: the port's start-type list must equal the
/// reference `STARTING_NODE_TYPES` (constants.ts:53-59) — 5 entries, same order.
#[test]
fn start_node_types_match_reference_starting_node_types() {
    assert_eq!(
        START_NODE_TYPES,
        [
            "n8n-nodes-base.manualTrigger",
            "n8n-nodes-base.executeWorkflowTrigger",
            "n8n-nodes-base.errorTrigger",
            "n8n-nodes-base.evaluationTrigger",
            "n8n-nodes-base.formTrigger",
        ]
    );
}
