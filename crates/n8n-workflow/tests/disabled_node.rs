//! ISSUE-015 (corrected scope) + ISSUE-017 compatibility test.
//!
//! Drives `tests/reference/04-disabled-node/` — a contract-sourced golden pair whose
//! expectations are hand-traced from `reference/n8n/packages/workflow/src/workflow.ts`:
//!
//! * `getHighestNode` — `:498` strict `disabled === false` for the starting node,
//!   `:553` lenient `disabled !== true` for parents (the D-04 asymmetry);
//! * `getStartNode` — `:824` `!node.disabled`, `:839`/`:853` skip disabled start nodes;
//! * plain `getParentNodes` / `getChildNodes` must stay **disabled-blind** (the reference's
//!   graph-utils.ts has no disabled branch — asserting otherwise would be a divergence).

use n8n_workflow::{ConnectionTypeFilter, Workflow};
use serde_json::Value;
use std::fs;
use std::path::Path;

fn load(path: &Path) -> Value {
    let content = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&content).unwrap_or_else(|e| panic!("invalid JSON in {}: {e}", path.display()))
}

#[test]
fn disabled_node_golden_probes_match_the_reference() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/reference/04-disabled-node");
    let case = load(&root.join("case.json"));
    let expected = load(&root.join("expected.json"));

    let workflow = Workflow::from_wire(&case).expect("case.json does not load into the Workflow port");

    let probes = case["probes"]
        .as_array()
        .expect("case.json has no probes array")
        .clone();
    assert!(!probes.is_empty(), "no probes in 04-disabled-node/case.json");

    for probe in &probes {
        let name = probe["name"].as_str().expect("probe without name");
        let op = probe["op"].as_str().expect("probe without op");
        let node = probe["node"].as_str().expect("probe without node");

        let expected_value = expected
            .get(name)
            .unwrap_or_else(|| panic!("probe {name:?} has no expected value — fixture is incomplete"));

        let actual: Value = match op {
            "wf.getHighestNode" => serde_json::to_value(workflow.get_highest_node(node, None, None)).unwrap(),
            "wf.getStartNode" => serde_json::to_value(
                workflow
                    .get_start_node(Some(node))
                    .map(|n| n.name.clone()),
            )
            .unwrap(),
            "getParentNodes" => serde_json::to_value(
                workflow.get_parent_nodes(node, ConnectionTypeFilter::main(), -1),
            )
            .unwrap(),
            "getChildNodes" => serde_json::to_value(
                workflow.get_child_nodes(node, ConnectionTypeFilter::main(), -1),
            )
            .unwrap(),
            other => panic!("probe {name:?} uses an op the port does not implement: {other}"),
        };

        assert_eq!(
            actual,
            *expected_value,
            "probe {name:?} diverges from the reference trace"
        );
    }

    // The scope warning must stay in place: if anyone deletes it, the fixture has lost its
    // guard against "fixing" plain traversal into disabled-filtering.
    assert!(
        expected.get("_scope_warning").is_some(),
        "04-disabled-node/expected.json lost its _scope_warning"
    );
}

/// D-04 in isolation, independent of the fixture files: a node that *omits* `disabled`
/// is not its own highest node (strict `=== false`) but IS included as a parent
/// (lenient `!== true`).
#[test]
fn d04_asymmetry_between_self_and_parent_roles() {
    let case = serde_json::json!({
        "nodes": [
            { "id": "z", "name": "Z", "type": "x", "typeVersion": 1, "position": [0, 0] }
        ],
        "connections": {}
    });
    let workflow = Workflow::from_wire(&case).unwrap();

    // self role: omitted flag → NOT pushed
    assert_eq!(workflow.get_highest_node("Z", None, None), Vec::<String>::new());

    let case = serde_json::json!({
        "nodes": [
            { "id": "z", "name": "Z", "type": "x", "typeVersion": 1, "position": [0, 0] },
            { "id": "y", "name": "Y", "type": "x", "typeVersion": 1, "position": [0, 0] }
        ],
        "connections": {
            "Z": { "main": [[{ "node": "Y", "type": "main", "index": 0 }]] }
        }
    });
    let workflow = Workflow::from_wire(&case).unwrap();

    // parent role: same omitted flag → included
    assert_eq!(workflow.get_highest_node("Y", None, None), vec!["Z".to_string()]);
    // and the explicitly-disabled parent is excluded
    let case = serde_json::json!({
        "nodes": [
            { "id": "z", "name": "Z", "type": "x", "typeVersion": 1, "position": [0, 0], "disabled": true },
            { "id": "y", "name": "Y", "type": "x", "typeVersion": 1, "position": [0, 0] }
        ],
        "connections": {
            "Z": { "main": [[{ "node": "Y", "type": "main", "index": 0 }]] }
        }
    });
    let workflow = Workflow::from_wire(&case).unwrap();
    assert_eq!(workflow.get_highest_node("Y", None, None), Vec::<String>::new());
}

/// ISSUE-016: `pin_data` must be consultable, not just storable
/// (`getPinDataOfNode`, workflow.ts:331-333).
#[test]
fn get_pin_data_of_node_returns_the_pinned_payload() {
    let case = serde_json::json!({
        "nodes": [
            { "id": "a", "name": "A", "type": "x", "typeVersion": 1, "position": [0, 0] }
        ],
        "connections": {},
        "pinData": { "A": [ { "json": { "foo": 1 } } ] }
    });
    let workflow = Workflow::from_wire(&case).unwrap();

    let pinned = workflow
        .get_pin_data_of_node("A")
        .expect("pinData for A must be returned");
    assert_eq!(pinned[0]["json"]["foo"], serde_json::json!(1));

    assert!(workflow.get_pin_data_of_node("missing").is_none());

    let case = serde_json::json!({
        "nodes": [
            { "id": "a", "name": "A", "type": "x", "typeVersion": 1, "position": [0, 0] }
        ],
        "connections": {}
    });
    let workflow = Workflow::from_wire(&case).unwrap();
    assert!(workflow.get_pin_data_of_node("A").is_none());
}
