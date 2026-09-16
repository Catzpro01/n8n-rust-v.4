use n8n_connection::WorkflowConnections;
use std::collections::{HashMap, HashSet};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ValidationError {
    #[error("Node with name '{0}' is duplicated")]
    DuplicateNodeName(String),
    #[error("Connection targets non-existent node '{0}'")]
    DanglingConnection(String),
    #[error("Workflow contains cycle involving node '{0}'")]
    CycleDetected(String),
}

pub fn validate_node_uniqueness(nodes: &[String]) -> Result<(), ValidationError> {
    let mut seen = HashSet::new();
    for name in nodes {
        if !seen.insert(name) {
            return Err(ValidationError::DuplicateNodeName(name.clone()));
        }
    }
    Ok(())
}

pub fn validate_dangling_connections(
    nodes: &[String],
    connections: &WorkflowConnections,
) -> Result<(), ValidationError> {
    let node_set: HashSet<&str> = nodes.iter().map(|s| s.as_str()).collect();
    for (source, outputs) in connections {
        if !node_set.contains(source.as_str()) {
            return Err(ValidationError::DanglingConnection(source.clone()));
        }
        for list in outputs.values() {
            for sublist in list {
                for item in sublist {
                    if !node_set.contains(item.node.as_str()) {
                        return Err(ValidationError::DanglingConnection(item.node.clone()));
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn detect_cycles(
    nodes: &[String],
    connections: &WorkflowConnections,
) -> Result<(), ValidationError> {
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for n in nodes {
        adj.insert(n.as_str(), Vec::new());
    }

    for (src, outputs) in connections {
        for list in outputs.values() {
            for sublist in list {
                for item in sublist {
                    adj.entry(src.as_str()).or_default().push(item.node.as_str());
                }
            }
        }
    }

    let mut visited = HashSet::new();
    let mut rec_stack = HashSet::new();

    fn dfs<'a>(
        node: &'a str,
        adj: &HashMap<&'a str, Vec<&'a str>>,
        visited: &mut HashSet<&'a str>,
        rec_stack: &mut HashSet<&'a str>,
    ) -> Option<&'a str> {
        visited.insert(node);
        rec_stack.insert(node);

        if let Some(neighbors) = adj.get(node) {
            for &next_node in neighbors {
                if !visited.contains(next_node) {
                    if let Some(cycle_node) = dfs(next_node, adj, visited, rec_stack) {
                        return Some(cycle_node);
                    }
                } else if rec_stack.contains(next_node) {
                    return Some(next_node);
                }
            }
        }

        rec_stack.remove(node);
        None
    }

    for n in nodes {
        let name = n.as_str();
        if !visited.contains(name) {
            if let Some(cycle_node) = dfs(name, &adj, &mut visited, &mut rec_stack) {
                return Err(ValidationError::CycleDetected(cycle_node.to_string()));
            }
        }
    }

    Ok(())
}
