use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ConnectionItem {
    pub node: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub index: usize,
}

pub type ConnectionOutput = Vec<ConnectionItem>;
pub type NodeConnections = HashMap<String, Vec<ConnectionOutput>>;
pub type WorkflowConnections = HashMap<String, NodeConnections>;

pub fn get_connected_nodes(connections: &WorkflowConnections, source_node: &str) -> Vec<String> {
    let mut targets = Vec::new();
    if let Some(outputs) = connections.get(source_node) {
        for list in outputs.values() {
            for sublist in list {
                for item in sublist {
                    if !targets.contains(&item.node) {
                        targets.push(item.node.clone());
                    }
                }
            }
        }
    }
    targets
}

/// Invert connections from bySource to byDestination
pub fn invert_connections(by_source: &WorkflowConnections) -> WorkflowConnections {
    let mut by_dest: WorkflowConnections = HashMap::new();

    for (src_node, outputs) in by_source {
        for (conn_type, output_lists) in outputs {
            for (out_idx, target_list) in output_lists.iter().enumerate() {
                for target_item in target_list {
                    let dest_node = &target_item.node;
                    let input_idx = target_item.index;

                    let dest_map = by_dest.entry(dest_node.clone()).or_default();
                    let input_lists = dest_map.entry(conn_type.clone()).or_default();

                    while input_lists.len() <= input_idx {
                        input_lists.push(Vec::new());
                    }

                    input_lists[input_idx].push(ConnectionItem {
                        node: src_node.clone(),
                        connection_type: conn_type.clone(),
                        index: out_idx,
                    });
                }
            }
        }
    }

    by_dest
}

/// Check if there is a directed path from source to target
pub fn has_path(connections: &WorkflowConnections, from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }

    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(from);
    visited.insert(from);

    while let Some(current) = queue.pop_front() {
        for next in get_connected_nodes(connections, current) {
            if next == to {
                return true;
            }
            if !visited.contains(next.as_str()) {
                visited.insert(next.as_str());
                queue.push_back(next.as_str());
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_connected_nodes() {
        let mut conns = WorkflowConnections::new();
        let mut outputs = HashMap::new();
        outputs.insert(
            "main".into(),
            vec![
                vec![ConnectionItem {
                    node: "NodeB".into(),
                    connection_type: "main".into(),
                    index: 0,
                }],
                vec![ConnectionItem {
                    node: "NodeC".into(),
                    connection_type: "main".into(),
                    index: 0,
                }],
            ],
        );
        conns.insert("NodeA".into(), outputs);

        let connected = get_connected_nodes(&conns, "NodeA");
        assert_eq!(connected, vec!["NodeB", "NodeC"]);
    }

    #[test]
    fn test_invert_connections_and_path() {
        let mut by_source = WorkflowConnections::new();
        let mut t_outs = HashMap::new();
        t_outs.insert(
            "main".into(),
            vec![vec![ConnectionItem {
                node: "A".into(),
                connection_type: "main".into(),
                index: 0,
            }]],
        );
        by_source.insert("Trigger".into(), t_outs);

        let mut a_outs = HashMap::new();
        a_outs.insert(
            "main".into(),
            vec![vec![ConnectionItem {
                node: "B".into(),
                connection_type: "main".into(),
                index: 0,
            }]],
        );
        by_source.insert("A".into(), a_outs);

        assert!(has_path(&by_source, "Trigger", "B"));
        assert!(!has_path(&by_source, "B", "Trigger"));

        let by_dest = invert_connections(&by_source);
        assert!(by_dest.contains_key("A"));
        assert!(by_dest.contains_key("B"));
        assert_eq!(by_dest["B"]["main"][0][0].node, "A");
    }
}
