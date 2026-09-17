//! Graph traversal — faithful port of the ORIGINAL n8n functions.
//!
//! Upstream behavioral reference (verbatim, type annotations stripped):
//! - `reference/n8n/packages/workflow/src/common/get-connected-nodes.ts`
//! - `reference/n8n/packages/workflow/src/common/get-child-nodes.ts`
//! - `reference/n8n/packages/workflow/src/common/get-parent-nodes.ts`
//!
//! The port preserves the original's exact algorithmic semantics, including
//! the subtle `checkedNodes` copy-per-call behavior (which is what makes
//! sibling subtrees independent and allows a node to appear twice when it is
//! reached through two distinct output indices) and the "move-to-front"
//! dedupe of deeper nodes.
//!
//! Difference from the original (documented, spec §5 determinism):
//! - JS iterates connection-type keys in object insertion order; Rust iterates
//!   `BTreeMap` keys in lexicographic order. Compatibility fixtures list type
//!   keys (and top-level node names) in lexicographic order, so both
//!   iteration orders coincide (see tests/compatibility README).
//! - Output-index level: JS integer-like object keys always iterate in
//!   ascending numeric order — identical to Rust `Vec` index order.

use std::collections::BTreeMap;

use crate::model::Connections;

/// Connection-type filter, mirroring the original `connectionType` argument:
/// a concrete type (e.g. `"main"`), `"ALL"`, or `"ALL_NON_MAIN"`.
pub const ALL: &str = "ALL";
pub const ALL_NON_MAIN: &str = "ALL_NON_MAIN";

/// Faithful port of `getConnectedNodes(connections, nodeName, connectionType,
/// depth, checkedNodesIncoming)` — the core traversal used by both
/// `getChildNodes` (over source connections) and `getParentNodes` (over
/// destination connections).
pub fn get_connected_nodes(
    connections: &Connections,
    node_name: &str,
    connection_type: &str,
    depth: i32,
    checked_nodes_incoming: Option<&[String]>,
) -> Vec<String> {
    let new_depth = if depth == -1 { -1 } else { depth - 1 };
    if depth == 0 {
        // Reached max depth
        return Vec::new();
    }

    let Some(node_conns) = connections.get(node_name) else {
        // Node does not have incoming connections
        return Vec::new();
    };

    // Determine the set of connection types to traverse. BTreeMap ⇒
    // lexicographic order (see module docs).
    let types: Vec<String> = if connection_type == ALL {
        node_conns.keys().cloned().collect()
    } else if connection_type == ALL_NON_MAIN {
        node_conns.keys().filter(|t| **t != crate::model::MAIN).cloned().collect()
    } else {
        vec![connection_type.to_string()]
    };

    let mut return_nodes: Vec<String> = Vec::new();

    for type_ in types {
        let Some(by_index) = node_conns.get(&type_) else {
            // Node does not have incoming connections of given type
            continue;
        };

        // Per-call copy of the checked set (original:
        // `const checkedNodes = checkedNodesIncoming ? [...checkedNodesIncoming] : []`).
        let mut checked: Vec<String> = match checked_nodes_incoming {
            Some(incoming) => incoming.to_vec(),
            None => Vec::new(),
        };

        if checked.iter().any(|n| n == node_name) {
            // Node got checked already before
            continue;
        }

        checked.push(node_name.to_string());

        for slot in by_index {
            let Some(list) = slot else {
                // Sparse / null slot (original: `connectionsByIndex?.forEach`)
                continue;
            };
            for connection in list {
                if checked.iter().any(|n| n == &connection.node) {
                    // Node got checked already before
                    continue;
                }

                return_nodes.insert(0, connection.node.clone());

                let add_nodes = get_connected_nodes(
                    connections,
                    &connection.node,
                    connection_type,
                    new_depth,
                    Some(&checked),
                );

                // Original: `for (i = addNodes.length; i--; i > 0)` — iterates
                // indices n-1 ..= 0 (descending, including 0).
                for i in (0..add_nodes.len()).rev() {
                    let parent_name = &add_nodes[i];
                    if let Some(pos) = return_nodes.iter().position(|n| n == parent_name) {
                        // Node got found before so remove it from current
                        // location that node-order stays correct.
                        return_nodes.remove(pos);
                    }
                    return_nodes.insert(0, parent_name.clone());
                }
            }
        }
    }

    return_nodes
}

/// Original `getChildNodes(connectionsBySourceNode, nodeName, type, depth)`.
pub fn get_child_nodes_typed(
    connections_by_source: &Connections,
    node_name: &str,
    connection_type: &str,
    depth: i32,
) -> Vec<String> {
    get_connected_nodes(
        connections_by_source,
        node_name,
        connection_type,
        depth,
        None,
    )
}

/// Original `getParentNodes(connectionsByDestinationNode, nodeName, type,
/// depth)`.
pub fn get_parent_nodes_typed(
    connections_by_destination: &Connections,
    node_name: &str,
    connection_type: &str,
    depth: i32,
) -> Vec<String> {
    get_connected_nodes(
        connections_by_destination,
        node_name,
        connection_type,
        depth,
        None,
    )
}

/// Build a small linear graph A → B → C (test helper).
#[cfg(test)]
pub(crate) fn linear_connections() -> Connections {
    use crate::model::{Connection, MAIN};
    let mut a: BTreeMap<String, Vec<Option<Vec<Connection>>>> = BTreeMap::new();
    a.insert(
        MAIN.to_string(),
        vec![Some(vec![Connection {
            node: "B".to_string(),
            type_: MAIN.to_string(),
            index: 0,
        }])],
    );
    let mut b: BTreeMap<String, Vec<Option<Vec<Connection>>>> = BTreeMap::new();
    b.insert(
        MAIN.to_string(),
        vec![Some(vec![Connection {
            node: "C".to_string(),
            type_: MAIN.to_string(),
            index: 0,
        }])],
    );
    let mut conns = BTreeMap::new();
    conns.insert("A".to_string(), a);
    conns.insert("B".to_string(), b);
    conns
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MAIN;

    /// Diamond: A→B, A→C, B→D, C→D (C feeds D's second input).
    fn diamond() -> Connections {
        use crate::model::{Connection, MAIN};
        let c = |node: &str, index: usize| Connection {
            node: node.to_string(),
            type_: MAIN.to_string(),
            index,
        };
        let mut conns = BTreeMap::new();
        let mut a = BTreeMap::new();
        a.insert(MAIN.to_string(), vec![Some(vec![c("B", 0)]), Some(vec![c("C", 0)])]);
        let mut b = BTreeMap::new();
        b.insert(MAIN.to_string(), vec![Some(vec![c("D", 0)])]);
        let mut c2 = BTreeMap::new();
        c2.insert(MAIN.to_string(), vec![Some(vec![c("D", 1)])]);
        conns.insert("A".to_string(), a);
        conns.insert("B".to_string(), b);
        conns.insert("C".to_string(), c2);
        conns
    }

    #[test]
    fn child_nodes_linear_matches_original() {
        let conns = linear_connections();
        assert_eq!(
            get_child_nodes_typed(&conns, "A", MAIN, -1),
            vec!["C".to_string(), "B".to_string()]
        );
        assert_eq!(
            get_child_nodes_typed(&conns, "B", MAIN, -1),
            vec!["C".to_string()]
        );
        assert!(get_child_nodes_typed(&conns, "C", MAIN, -1).is_empty());
        assert!(get_child_nodes_typed(&conns, "Ghost", MAIN, -1).is_empty());
    }

    #[test]
    fn diamond_child_order_is_original_semantics() {
        // Golden (from original n8n via reference harness): ["D","C","B"]
        let conns = diamond();
        assert_eq!(
            get_child_nodes_typed(&conns, "A", MAIN, -1),
            vec!["D".to_string(), "C".to_string(), "B".to_string()]
        );
    }

    #[test]
    fn depth_limitation() {
        let conns = linear_connections();
        assert_eq!(
            get_child_nodes_typed(&conns, "A", MAIN, 1),
            vec!["B".to_string()]
        );
    }

    #[test]
    fn cycles_terminate() {
        // A → B → C → A must terminate (checkedNodes breaks the loop).
        use crate::model::{Connection, MAIN};
        let c = |node: &str| Connection {
            node: node.to_string(),
            type_: MAIN.to_string(),
            index: 0,
        };
        let mut conns = BTreeMap::new();
        for (s, d) in [("A", "B"), ("B", "C"), ("C", "A")] {
            let mut m = BTreeMap::new();
            m.insert(MAIN.to_string(), vec![Some(vec![c(d)])]);
            conns.insert(s.to_string(), m);
        }
        assert_eq!(
            get_child_nodes_typed(&conns, "A", MAIN, -1),
            vec!["C".to_string(), "B".to_string()]
        );
    }
}
