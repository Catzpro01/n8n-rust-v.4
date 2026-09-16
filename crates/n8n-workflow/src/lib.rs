use n8n_connection::{get_connected_nodes, WorkflowConnections};
use n8n_node_model::INode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSettings {
    #[serde(rename = "saveExecutionProgress", skip_serializing_if = "Option::is_none")]
    pub save_execution_progress: Option<bool>,
    #[serde(rename = "saveManualExecutions", skip_serializing_if = "Option::is_none")]
    pub save_manual_executions: Option<bool>,
    #[serde(rename = "timezone", skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: Option<String>,
    pub name: Option<String>,
    pub active: bool,
    pub nodes: HashMap<String, INode>,
    #[serde(rename = "connectionsBySourceNode")]
    pub connections_by_source_node: WorkflowConnections,
    pub settings: Option<WorkflowSettings>,
    #[serde(rename = "staticData", skip_serializing_if = "Option::is_none")]
    pub static_data: Option<serde_json::Value>,
    #[serde(rename = "pinData", skip_serializing_if = "Option::is_none")]
    pub pin_data: Option<serde_json::Value>,
}

impl Workflow {
    pub fn new(
        id: Option<String>,
        name: Option<String>,
        active: bool,
        nodes: Vec<INode>,
        connections: WorkflowConnections,
        settings: Option<WorkflowSettings>,
    ) -> Self {
        let mut node_map = HashMap::new();
        for node in nodes {
            node_map.insert(node.name.clone(), node);
        }

        Self {
            id,
            name,
            active,
            nodes: node_map,
            connections_by_source_node: connections,
            settings,
            static_data: None,
            pin_data: None,
        }
    }

    pub fn get_node(&self, name: &str) -> Option<&INode> {
        self.nodes.get(name)
    }

    pub fn get_nodes(&self) -> Vec<&INode> {
        self.nodes.values().collect()
    }

    pub fn get_child_nodes(&self, node_name: &str) -> Vec<String> {
        get_connected_nodes(&self.connections_by_source_node, node_name)
    }

    pub fn get_parent_nodes(&self, node_name: &str) -> Vec<String> {
        let mut parents = Vec::new();
        for (src, outputs) in &self.connections_by_source_node {
            for list in outputs.values() {
                for sublist in list {
                    for item in sublist {
                        if item.node == node_name && !parents.contains(src) {
                            parents.push(src.clone());
                        }
                    }
                }
            }
        }
        parents
    }

    pub fn rename_node(&mut self, old_name: &str, new_name: &str) -> bool {
        if !self.nodes.contains_key(old_name) || self.nodes.contains_key(new_name) {
            return false;
        }

        if let Some(mut node) = self.nodes.remove(old_name) {
            node.name = new_name.to_string();
            self.nodes.insert(new_name.to_string(), node);
        }

        if let Some(conns) = self.connections_by_source_node.remove(old_name) {
            self.connections_by_source_node.insert(new_name.to_string(), conns);
        }

        for outputs in self.connections_by_source_node.values_mut() {
            for list in outputs.values_mut() {
                for sublist in list.iter_mut() {
                    for item in sublist.iter_mut() {
                        if item.node == old_name {
                            item.node = new_name.to_string();
                        }
                    }
                }
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workflow_node_rename_and_graph() {
        let node1 = INode {
            id: "1".into(),
            name: "Start".into(),
            node_type: "manualTrigger".into(),
            type_version: 1.0,
            position: [0.0, 0.0],
            parameters: Default::default(),
            disabled: None,
        };

        let node2 = INode {
            id: "2".into(),
            name: "Code".into(),
            node_type: "code".into(),
            type_version: 1.0,
            position: [100.0, 100.0],
            parameters: Default::default(),
            disabled: None,
        };

        let mut conns = WorkflowConnections::new();
        let mut outputs = HashMap::new();
        outputs.insert(
            "main".into(),
            vec![vec![n8n_connection::ConnectionItem {
                node: "Code".into(),
                connection_type: "main".into(),
                index: 0,
            }]],
        );
        conns.insert("Start".into(), outputs);

        let mut wf = Workflow::new(Some("wf-1".into()), Some("Test".into()), true, vec![node1, node2], conns, None);

        assert_eq!(wf.get_child_nodes("Start"), vec!["Code"]);
        assert_eq!(wf.get_parent_nodes("Code"), vec!["Start"]);

        assert!(wf.rename_node("Code", "NewCode"));
        assert_eq!(wf.get_child_nodes("Start"), vec!["NewCode"]);
        assert_eq!(wf.get_parent_nodes("NewCode"), vec!["Start"]);
    }
}
