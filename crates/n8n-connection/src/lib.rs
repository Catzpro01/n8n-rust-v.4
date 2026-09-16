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
