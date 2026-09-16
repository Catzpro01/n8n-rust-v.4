use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
}
