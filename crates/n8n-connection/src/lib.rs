use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ConnectionItem {
    pub node: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub index: usize,
}

pub type ConnectionOutput = Option<Vec<ConnectionItem>>;
pub type NodeConnections = IndexMap<String, Vec<ConnectionOutput>>;
pub type WorkflowConnections = IndexMap<String, NodeConnections>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionTypeFilter {
    Type(String),
    All,
    AllNonMain,
}

impl Default for ConnectionTypeFilter {
    fn default() -> Self {
        Self::Type("main".to_string())
    }
}

/// Transitive connected nodes traversal, ported from
/// `reference/n8n/packages/workflow/src/common/get-connected-nodes.ts` (the shared util behind
/// `getConnectedNodes` / `getChildNodes` / `getParentNodes`).
///
/// Ported details that look like bugs but are observable behaviour (golden suites in
/// `tests/reference/connection/**` pin them):
///
/// * `depth` counts down and `-1` is unlimited (`depth: 1` visits direct neighbours only);
/// * results are built with `unshift`, and a node that is re-found later is moved to the
///   front, so the returned array is "closest to the end first" (farthest-first);
/// * `checkedNodes` is copied **per connection type**, which is why `ALL` can reach nodes
///   a `main`-only walk would have marked as visited;
/// * a missing source key yields `[]`.
pub fn get_connected_nodes(
    connections: &WorkflowConnections,
    node_name: &str,
    filter: &ConnectionTypeFilter,
    depth: i64,
) -> Vec<String> {
    let new_depth = if depth == -1 { -1 } else { depth - 1 };
    if depth == 0 {
        // Reached max depth
        return Vec::new();
    }

    let Some(node_outputs) = connections.get(node_name) else {
        // Node does not have connections of its own in this map
        return Vec::new();
    };

    let types: Vec<String> = match filter {
        ConnectionTypeFilter::Type(name) => vec![name.clone()],
        ConnectionTypeFilter::All => node_outputs.keys().cloned().collect(),
        ConnectionTypeFilter::AllNonMain => node_outputs
            .keys()
            .filter(|key| key.as_str() != "main")
            .cloned()
            .collect(),
    };

    let mut return_nodes: Vec<String> = Vec::new();
    for type_name in types {
        let Some(output_lists) = node_outputs.get(&type_name) else {
            continue;
        };

        let mut checked_nodes: Vec<String> = Vec::new();
        if checked_nodes.iter().any(|name| name == node_name) {
            // Node got checked already before
            continue;
        }
        checked_nodes.push(node_name.to_string());

        for slot in output_lists {
            let Some(connections_in_slot) = slot else {
                continue;
            };
            for connection in connections_in_slot {
                if checked_nodes.iter().any(|name| name == &connection.node) {
                    continue;
                }

                return_nodes.insert(0, connection.node.clone());

                let add_nodes = walk_connected(
                    connections,
                    &connection.node,
                    filter,
                    new_depth,
                    &checked_nodes,
                );

                // JS iterates the collected nodes back to front and unshifts each, removing
                // a previous occurrence so the order stays "nearest first".
                for parent_node_name in add_nodes.iter().rev() {
                    if let Some(position) = return_nodes.iter().position(|name| name == parent_node_name)
                    {
                        return_nodes.remove(position);
                    }
                    return_nodes.insert(0, parent_node_name.clone());
                }
            }
        }
    }

    return_nodes
}

/// Recursive step with the `checkedNodes` the reference passes down (the original copies
/// it per type — see [`get_connected_nodes`]).
fn walk_connected(
    connections: &WorkflowConnections,
    node_name: &str,
    filter: &ConnectionTypeFilter,
    depth: i64,
    checked_nodes_incoming: &[String],
) -> Vec<String> {
    let new_depth = if depth == -1 { -1 } else { depth - 1 };
    if depth == 0 {
        return Vec::new();
    }

    let Some(node_outputs) = connections.get(node_name) else {
        return Vec::new();
    };

    let types: Vec<String> = match filter {
        ConnectionTypeFilter::Type(name) => vec![name.clone()],
        ConnectionTypeFilter::All => node_outputs.keys().cloned().collect(),
        ConnectionTypeFilter::AllNonMain => node_outputs
            .keys()
            .filter(|key| key.as_str() != "main")
            .cloned()
            .collect(),
    };

    let mut return_nodes: Vec<String> = Vec::new();
    for type_name in types {
        let Some(output_lists) = node_outputs.get(&type_name) else {
            continue;
        };

        let mut checked_nodes: Vec<String> = checked_nodes_incoming.to_vec();
        if checked_nodes.iter().any(|name| name == node_name) {
            continue;
        }
        checked_nodes.push(node_name.to_string());

        for slot in output_lists {
            let Some(connections_in_slot) = slot else {
                continue;
            };
            for connection in connections_in_slot {
                if checked_nodes.iter().any(|name| name == &connection.node) {
                    continue;
                }

                return_nodes.insert(0, connection.node.clone());

                let add_nodes = walk_connected(
                    connections,
                    &connection.node,
                    filter,
                    new_depth,
                    &checked_nodes,
                );

                for parent_node_name in add_nodes.iter().rev() {
                    if let Some(position) = return_nodes.iter().position(|name| name == parent_node_name)
                    {
                        return_nodes.remove(position);
                    }
                    return_nodes.insert(0, parent_node_name.clone());
                }
            }
        }
    }

    return_nodes
}

/// Invert connections from bySource to byDestination with padding per contract §3.3
pub fn map_connections_by_destination(by_source: &WorkflowConnections) -> WorkflowConnections {
    let mut by_dest: WorkflowConnections = IndexMap::new();

    for (src_node, outputs) in by_source {
        for (conn_type, output_slots) in outputs {
            for (out_idx, slot) in output_slots.iter().enumerate() {
                if let Some(items) = slot {
                    for target_item in items {
                        let dest_node = &target_item.node;
                        let input_idx = target_item.index;

                        let dest_map = by_dest.entry(dest_node.clone()).or_default();
                        let input_slots = dest_map.entry(conn_type.clone()).or_default();

                        // Pad missing input indexes with empty slot Some(vec![])
                        while input_slots.len() <= input_idx {
                            input_slots.push(Some(Vec::new()));
                        }

                        if let Some(ref mut input_list) = input_slots[input_idx] {
                            input_list.push(ConnectionItem {
                                node: src_node.clone(),
                                connection_type: conn_type.clone(),
                                index: out_idx,
                            });
                        }
                    }
                }
            }
        }
    }

    by_dest
}

/// Port of `hasPath(start, end, adjacencyList)` from `graph/graph-utils.ts:145-163`:
/// a DFS over **`main` edges only** (non-main connection types never create a path
/// edge — golden `hasPath Model->Agent ignores non-main` is `false` despite the
/// `ai_languageModel` edge), stack-based with a seen-set, `from == to` is trivially true.
pub fn has_path(connections: &WorkflowConnections, from: &str, to: &str) -> bool {
    let mut seen: HashSet<String> = HashSet::new();
    let mut paths: Vec<&str> = vec![from];

    while let Some(next) = paths.pop() {
        if next == to {
            return true;
        }
        seen.insert(next.to_string());

        if let Some(node_outputs) = connections.get(next) {
            if let Some(slots) = node_outputs.get("main") {
                for slot in slots {
                    if let Some(items) = slot {
                        for item in items {
                            if !seen.contains(&item.node) {
                                paths.push(item.node.as_str());
                            }
                        }
                    }
                }
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_farthest_first_get_connected_nodes() {
        // Trigger -> A -> B
        let mut conns = WorkflowConnections::new();
        let mut t_outs = IndexMap::new();
        t_outs.insert(
            "main".into(),
            vec![Some(vec![ConnectionItem {
                node: "A".into(),
                connection_type: "main".into(),
                index: 0,
            }])],
        );
        conns.insert("Trigger".into(), t_outs);

        let mut a_outs = IndexMap::new();
        a_outs.insert(
            "main".into(),
            vec![Some(vec![ConnectionItem {
                node: "B".into(),
                connection_type: "main".into(),
                index: 0,
            }])],
        );
        conns.insert("A".into(), a_outs);

        let filter = ConnectionTypeFilter::default();
        let connected = get_connected_nodes(&conns, "Trigger", &filter, -1);
        // In farthest-first order, B is farthest so it comes before A: ["B", "A"]
        assert_eq!(connected, vec!["B", "A"]);
    }

    #[test]
    fn test_null_slot_and_destination_inversion() {
        let mut by_source = WorkflowConnections::new();
        let mut src_outs = IndexMap::new();
        // Slot 0 is null, slot 1 has connection to Dest
        src_outs.insert(
            "main".into(),
            vec![
                None,
                Some(vec![ConnectionItem {
                    node: "Dest".into(),
                    connection_type: "main".into(),
                    index: 1,
                }]),
            ],
        );
        by_source.insert("Src".into(), src_outs);

        let by_dest = map_connections_by_destination(&by_source);
        assert!(by_dest.contains_key("Dest"));
        let dest_slots = &by_dest["Dest"]["main"];
        // Slot 0 is padded with Some([]), Slot 1 has Src
        assert_eq!(dest_slots.len(), 2);
        assert_eq!(dest_slots[0], Some(vec![]));
        assert_eq!(
            dest_slots[1],
            Some(vec![ConnectionItem {
                node: "Src".into(),
                connection_type: "main".into(),
                index: 1
            }])
        );
    }
}

