//! Start-node computation — SPEC-DEFINED pure function
//! (workflow_spec.md §3.6).
//!
//! The ORIGINAL `Workflow.getStartNode` requires `INodeTypes` (trigger/poll
//! metadata) and is therefore NOT a pure function of (nodes, connections);
//! trigger classification belongs to the `node` LEGO.
//!
//! Pure definition used here (and identically in the reference harness):
//!
//! > A node is a **start node** iff it has **no incoming MAIN connection**.
//!
//! Properties:
//! - deterministic: nodes are returned in lexicographic name order (BTreeMap
//!   iteration);
//! - non-destructive: read-only over nodes and the destination map;
//! - structural: `disabled` nodes are NOT filtered out (disabling is an
//!   execution-runtime concern, not graph structure).

use std::collections::BTreeMap;

use crate::model::{Connections, INode, MAIN};

fn has_incoming_main(by_destination: &Connections, node_name: &str) -> bool {
    let Some(by_type) = by_destination.get(node_name) else {
        return false;
    };
    let Some(slots) = by_type.get(MAIN) else {
        return false;
    };
    slots
        .iter()
        .any(|slot| slot.as_ref().map(|list| !list.is_empty()).unwrap_or(false))
}

/// Spec §3.6: `getStartNodes(nodes, connections) → INode[]`.
///
/// `by_destination` is the destination-side mapping (see `maps.rs`); the
/// function signature takes it pre-built because `Workflow` already holds
/// both views (spec §2 `NodeConnectionMapping`).
pub fn get_start_nodes<'a>(
    nodes: &'a BTreeMap<String, INode>,
    by_destination: &Connections,
) -> Vec<&'a INode> {
    let mut out: Vec<&'a INode> = Vec::new();
    for (name, node) in nodes {
        if !has_incoming_main(by_destination, name) {
            out.push(node);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Connection, MAIN};

    #[test]
    fn isolated_nodes_are_starts() {
        let mut nodes = BTreeMap::new();
        nodes.insert(
            "B".to_string(),
            INode {
                name: "B".to_string(),
                r#type: "t".to_string(),
                type_version: 1.0,
                position: [0, 0],
                disabled: false,
            },
        );
        nodes.insert(
            "A".to_string(),
            INode {
                name: "A".to_string(),
                r#type: "t".to_string(),
                type_version: 1.0,
                position: [0, 0],
                disabled: false,
            },
        );
        let starts = get_start_nodes(&nodes, &BTreeMap::new());
        let names: Vec<String> = starts.iter().map(|n| n.name.clone()).collect();
        assert_eq!(names, vec!["A".to_string(), "B".to_string()]); // sorted
    }

    #[test]
    fn node_with_incoming_main_is_not_start() {
        let mut nodes = BTreeMap::new();
        nodes.insert(
            "B".to_string(),
            INode {
                name: "B".to_string(),
                r#type: "t".to_string(),
                type_version: 1.0,
                position: [0, 0],
                disabled: false,
            },
        );
        let mut by_dest = BTreeMap::new();
        let mut by_type = BTreeMap::new();
        by_type.insert(
            MAIN.to_string(),
            vec![Some(vec![Connection {
                node: "A".to_string(),
                type_: MAIN.to_string(),
                index: 0,
            }])],
        );
        by_dest.insert("B".to_string(), by_type);

        let starts = get_start_nodes(&nodes, &by_dest);
        assert!(starts.is_empty());
    }

    #[test]
    fn non_main_incoming_does_not_disqualify() {
        // B receives only an ai_tool edge ⇒ structurally still a start node
        // (main-only definition).
        let mut nodes = BTreeMap::new();
        nodes.insert(
            "B".to_string(),
            INode {
                name: "B".to_string(),
                r#type: "t".to_string(),
                type_version: 1.0,
                position: [0, 0],
                disabled: false,
            },
        );
        let mut by_dest = BTreeMap::new();
        let mut by_type = BTreeMap::new();
        by_type.insert(
            "ai_tool".to_string(),
            vec![Some(vec![Connection {
                node: "A".to_string(),
                type_: "ai_tool".to_string(),
                index: 0,
            }])],
        );
        by_dest.insert("B".to_string(), by_type);

        let starts = get_start_nodes(&nodes, &by_dest);
        assert_eq!(starts.len(), 1);
    }

    #[test]
    fn empty_slots_do_not_count_as_incoming() {
        let mut nodes = BTreeMap::new();
        nodes.insert(
            "B".to_string(),
            INode {
                name: "B".to_string(),
                r#type: "t".to_string(),
                type_version: 1.0,
                position: [0, 0],
                disabled: false,
            },
        );
        let mut by_dest = BTreeMap::new();
        let mut by_type = BTreeMap::new();
        by_type.insert(MAIN.to_string(), vec![None, Some(Vec::new())]);
        by_dest.insert("B".to_string(), by_type);

        let starts = get_start_nodes(&nodes, &by_dest);
        assert_eq!(starts.len(), 1);
    }
}
