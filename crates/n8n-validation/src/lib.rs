use n8n_connection::{is_node_connection_type, WorkflowConnections};
use std::collections::{HashMap, HashSet};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ValidationError {
    #[error("Node with name '{0}' is duplicated")]
    DuplicateNodeName(String),
    #[error("Connection targets non-existent node '{0}'")]
    DanglingConnection(String),
    #[error("Unknown connection type \"{connection_type}\" on node \"{node}\"")]
    InvalidConnectionType { node: String, connection_type: String },
    #[error("Cycle detected: {0}")]
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
        for (type_key, list) in outputs {
            // `workflow-rules.ts:89` — the *type key* on the source must be a known
            // NodeConnectionType, else `INVALID_CONNECTION_TYPE`.
            if !is_node_connection_type(type_key) {
                return Err(ValidationError::InvalidConnectionType {
                    node: source.clone(),
                    connection_type: type_key.clone(),
                });
            }
            for slot in list {
                if let Some(items) = slot {
                    for item in items {
                        if !node_set.contains(item.node.as_str()) {
                            return Err(ValidationError::DanglingConnection(item.node.clone()));
                        }
                        // `workflow-rules.ts:103` — an edge's own `type` string must also be known.
                        if !is_node_connection_type(&item.connection_type) {
                            return Err(ValidationError::InvalidConnectionType {
                                node: source.clone(),
                                connection_type: item.connection_type.clone(),
                            });
                        }
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

    // Contract §4.4 / `workflow-rules.ts` `detectCycles`: the DFS runs over the **`main`**
    // graph only (`byType.main`), edges to unknown nodes are not followed, and edges from
    // unknown sources are not followed (they are reported by the dangling check instead).
    for (src, outputs) in connections {
        if !adj.contains_key(src.as_str()) {
            continue;
        }
        for (type_key, list) in outputs {
            if type_key != "main" {
                continue;
            }
            for slot in list {
                if let Some(items) = slot {
                    for item in items {
                        if adj.contains_key(item.node.as_str()) {
                            adj.entry(src.as_str()).or_default().push(item.node.as_str());
                        }
                    }
                }
            }
        }
    }

    let mut visited = HashSet::new();
    let mut rec_stack = HashSet::new();
    let mut path_stack: Vec<&str> = Vec::new();

    fn dfs<'a>(
        node: &'a str,
        adj: &HashMap<&'a str, Vec<&'a str>>,
        visited: &mut HashSet<&'a str>,
        rec_stack: &mut HashSet<&'a str>,
        path_stack: &mut Vec<&'a str>,
    ) -> Option<Vec<String>> {
        visited.insert(node);
        rec_stack.insert(node);
        path_stack.push(node);

        if let Some(neighbors) = adj.get(node) {
            for &next_node in neighbors {
                if !visited.contains(next_node) {
                    if let Some(mut cycle) = dfs(next_node, adj, visited, rec_stack, path_stack) {
                        path_stack.pop();
                        return Some(cycle);
                    }
                } else if rec_stack.contains(next_node) {
                    // First back-edge: the cycle is the path from the grey node to here,
                    // closed back onto it — same shape as `workflow-rules.ts` detectCycles.
                    let start = path_stack
                        .iter()
                        .position(|name| *name == next_node)
                        .unwrap_or(0);
                    let mut cycle: Vec<String> = path_stack[start..]
                        .iter()
                        .map(|name| name.to_string())
                        .collect();
                    cycle.push(next_node.to_string());
                    path_stack.pop();
                    return Some(cycle);
                }
            }
        }

        rec_stack.remove(node);
        path_stack.pop();
        None
    }

    for n in nodes {
        let name = n.as_str();
        if !visited.contains(name) {
            if let Some(cycle) = dfs(name, &adj, &mut visited, &mut rec_stack, &mut path_stack) {
                return Err(ValidationError::CycleDetected(cycle.join(" → ")));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;

    #[test]
    fn test_node_uniqueness_pass() {
        let nodes = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        assert!(validate_node_uniqueness(&nodes).is_ok());
    }

    #[test]
    fn test_node_uniqueness_fail() {
        let nodes = vec!["A".to_string(), "B".to_string(), "A".to_string()];
        assert_eq!(
            validate_node_uniqueness(&nodes),
            Err(ValidationError::DuplicateNodeName("A".to_string()))
        );
    }

    #[test]
    fn test_cycle_detection_pass() {
        let nodes = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        let mut conns = WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert("main".into(), vec![Some(vec![n8n_connection::ConnectionItem {
            node: "B".into(),
            connection_type: "main".into(),
            index: 0,
        }])]);
        conns.insert("A".into(), a_outs);

        let mut b_outs = IndexMap::new();
        b_outs.insert("main".into(), vec![Some(vec![n8n_connection::ConnectionItem {
            node: "C".into(),
            connection_type: "main".into(),
            index: 0,
        }])]);
        conns.insert("B".into(), b_outs);

        assert!(detect_cycles(&nodes, &conns).is_ok());
    }

    #[test]
    fn test_cycle_detection_fail() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();
        
        let mut a_outs = IndexMap::new();
        a_outs.insert("main".into(), vec![Some(vec![n8n_connection::ConnectionItem {
            node: "B".into(),
            connection_type: "main".into(),
            index: 0,
        }])]);
        conns.insert("A".into(), a_outs);

        let mut b_outs = IndexMap::new();
        b_outs.insert("main".into(), vec![Some(vec![n8n_connection::ConnectionItem {
            node: "A".into(),
            connection_type: "main".into(),
            index: 0,
        }])]);
        conns.insert("B".into(), b_outs);

        assert!(detect_cycles(&nodes, &conns).is_err());
    }

    // Golden case D5 (`docs/isolation/validation-golden-cases.md`): a connection type
    // outside `NodeConnectionTypes` must be rejected with `INVALID_CONNECTION_TYPE`.
    #[test]
    fn test_unknown_connection_type_key_is_rejected() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert(
            "foo".into(),
            vec![Some(vec![n8n_connection::ConnectionItem {
                node: "B".into(),
                connection_type: "foo".into(),
                index: 0,
            }])],
        );
        conns.insert("A".into(), a_outs);

        assert_eq!(
            validate_dangling_connections(&nodes, &conns),
            Err(ValidationError::InvalidConnectionType {
                node: "A".to_string(),
                connection_type: "foo".to_string(),
            })
        );
    }

    // A known `ai_*` type key with an unknown edge-level type is rejected too
    // (`workflow-rules.ts:103`).
    #[test]
    fn test_unknown_edge_connection_type_is_rejected() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert(
            "ai_tool".into(),
            vec![Some(vec![n8n_connection::ConnectionItem {
                node: "B".into(),
                connection_type: "ai_widget".into(),
                index: 0,
            }])],
        );
        conns.insert("A".into(), a_outs);

        assert_eq!(
            validate_dangling_connections(&nodes, &conns),
            Err(ValidationError::InvalidConnectionType {
                node: "A".to_string(),
                connection_type: "ai_widget".to_string(),
            })
        );
    }

    // Golden case D8: a cycle carried by `ai_tool` edges only is invisible to cycle
    // detection — the DFS runs over the `main` graph only (contract §4.4).
    #[test]
    fn test_non_main_cycle_is_not_detected() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert(
            "ai_tool".into(),
            vec![Some(vec![n8n_connection::ConnectionItem {
                node: "B".into(),
                connection_type: "ai_tool".into(),
                index: 0,
            }])],
        );
        conns.insert("A".into(), a_outs);

        let mut b_outs = IndexMap::new();
        b_outs.insert(
            "ai_tool".into(),
            vec![Some(vec![n8n_connection::ConnectionItem {
                node: "A".into(),
                connection_type: "ai_tool".into(),
                index: 0,
            }])],
        );
        conns.insert("B".into(), b_outs);

        assert!(detect_cycles(&nodes, &conns).is_ok());
    }

    // Golden case D7: the error message is the deterministic cycle path
    // `Cycle detected: A → B → A`.
    #[test]
    fn test_cycle_message_is_the_path() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert("main".into(), vec![Some(vec![n8n_connection::ConnectionItem {
            node: "B".into(),
            connection_type: "main".into(),
            index: 0,
        }])]);
        conns.insert("A".into(), a_outs);

        let mut b_outs = IndexMap::new();
        b_outs.insert("main".into(), vec![Some(vec![n8n_connection::ConnectionItem {
            node: "A".into(),
            connection_type: "main".into(),
            index: 0,
        }])]);
        conns.insert("B".into(), b_outs);

        assert_eq!(
            detect_cycles(&nodes, &conns),
            Err(ValidationError::CycleDetected("A → B → A".to_string()))
        );
    }
}

