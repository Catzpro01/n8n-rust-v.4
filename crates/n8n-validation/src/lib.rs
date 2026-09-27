//! n8n-validation — pre-execution validation for workflow DAGs.
//!
//! Individual validators:
//! - [`validate_node_uniqueness`] — no two nodes share a name;
//! - [`validate_dangling_connections`] — legacy dangling-endpoint check;
//! - [`detect_cycles`] — the workflow graph must stay acyclic;
//! - [`connections::validate_connections`] (m8-03) — connection integrity:
//!   dangling edges to deleted nodes and populated edges on non-existent output slots;
//! - [`parameters::validate_parameters`] (m8-04) — required parameters present and
//!   non-empty on every node.
//!
//! The single pre-execution gate is [`validate_workflow`] (EXT m8-05): one call that
//! runs every validator in a fixed, deterministic order (uniqueness → connection
//! integrity → cycles → parameters) and returns the first violation found.

use n8n_connection::WorkflowConnections;
use std::collections::{HashMap, HashSet};

pub mod connections;
pub mod parameters;

pub use connections::{validate_connections, ConnectionValidationError, OutputSlotSpec};
pub use parameters::{
    validate_parameters, NodeParameterView, ParameterSpecSet, ParameterValidationError,
    RequiredParameter,
};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ValidationError {
    #[error("Node with name '{0}' is duplicated")]
    DuplicateNodeName(String),
    #[error("Connection targets non-existent node '{0}'")]
    DanglingConnection(String),
    #[error("Workflow contains cycle involving node '{0}'")]
    CycleDetected(String),
    /// Connection integrity violation (m8-03): a dangling edge to a deleted node, or a
    /// populated edge on an output slot the source node does not have.
    #[error(transparent)]
    Connection(#[from] ConnectionValidationError),
    /// Required-parameter violation (m8-04): a parameter declared required for the
    /// node's type is missing or empty.
    #[error(transparent)]
    Parameter(#[from] ParameterValidationError),
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
            for slot in list {
                if let Some(items) = slot {
                    for item in items {
                        if !node_set.contains(item.node.as_str()) {
                            return Err(ValidationError::DanglingConnection(item.node.clone()));
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

    for (src, outputs) in connections {
        for list in outputs.values() {
            for slot in list {
                if let Some(items) = slot {
                    for item in items {
                        adj.entry(src.as_str())
                            .or_default()
                            .push(item.node.as_str());
                    }
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

/// The single pre-execution validation gate (EXT m8-05).
///
/// Runs every validator in a fixed, deterministic order and returns the first
/// violation found, so the reported error is stable for a stable input:
///
/// 1. [`validate_node_uniqueness`] — identity sanity before any graph reasoning;
/// 2. [`connections::validate_connections`] — edge structural integrity (deleted
///    source/target nodes, non-existent output slots) checked *before* topology is
///    trusted downstream;
/// 3. [`detect_cycles`] — graph shape;
/// 4. [`parameters::validate_parameters`] — per-node required configuration.
///
/// `output_slots` and `parameter_specs` may be empty maps to run the corresponding
/// gates in their documented lenient mode (see the m8-03 and m8-04 modules).
pub fn validate_workflow(
    nodes: &[String],
    connections: &WorkflowConnections,
    output_slots: &OutputSlotSpec,
    parameter_nodes: &[NodeParameterView<'_>],
    parameter_specs: &ParameterSpecSet,
) -> Result<(), ValidationError> {
    validate_node_uniqueness(nodes)?;
    validate_connections(nodes, connections, output_slots)?;
    detect_cycles(nodes, connections)?;
    validate_parameters(parameter_nodes, parameter_specs)?;
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
        a_outs.insert(
            "main".into(),
            vec![Some(vec![n8n_connection::ConnectionItem {
                node: "B".into(),
                connection_type: "main".into(),
                index: 0,
            }])],
        );
        conns.insert("A".into(), a_outs);

        let mut b_outs = IndexMap::new();
        b_outs.insert(
            "main".into(),
            vec![Some(vec![n8n_connection::ConnectionItem {
                node: "C".into(),
                connection_type: "main".into(),
                index: 0,
            }])],
        );
        conns.insert("B".into(), b_outs);

        assert!(detect_cycles(&nodes, &conns).is_ok());
    }

    #[test]
    fn test_cycle_detection_fail() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();

        let mut a_outs = IndexMap::new();
        a_outs.insert(
            "main".into(),
            vec![Some(vec![n8n_connection::ConnectionItem {
                node: "B".into(),
                connection_type: "main".into(),
                index: 0,
            }])],
        );
        conns.insert("A".into(), a_outs);

        let mut b_outs = IndexMap::new();
        b_outs.insert(
            "main".into(),
            vec![Some(vec![n8n_connection::ConnectionItem {
                node: "A".into(),
                connection_type: "main".into(),
                index: 0,
            }])],
        );
        conns.insert("B".into(), b_outs);

        assert!(detect_cycles(&nodes, &conns).is_err());
    }
}

#[cfg(test)]
mod workflow_tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn nodes() -> Vec<String> {
        vec!["A".to_string(), "B".to_string()]
    }

    fn conns_from(edges: &[(&str, usize, &str)]) -> WorkflowConnections {
        let mut conns = WorkflowConnections::new();
        for (source, slot, target) in edges {
            let outs = conns.entry((*source).to_string()).or_default();
            let slots = outs.entry("main".to_string()).or_default();
            while slots.len() <= *slot {
                slots.push(None);
            }
            slots[*slot] = Some(vec![n8n_connection::ConnectionItem {
                node: (*target).to_string(),
                connection_type: "main".into(),
                index: 0,
            }]);
        }
        conns
    }

    fn slots_spec(entries: &[(&str, usize)]) -> OutputSlotSpec {
        entries
            .iter()
            .map(|(node, count)| {
                let mut per_type = HashMap::new();
                per_type.insert("main".to_string(), *count);
                ((*node).to_string(), per_type)
            })
            .collect()
    }

    fn param_specs() -> ParameterSpecSet {
        [("t".to_string(), vec![RequiredParameter::new("url")])]
            .into_iter()
            .collect()
    }

    fn pnodes(params: &serde_json::Value) -> [NodeParameterView<'_>; 2] {
        [
            NodeParameterView {
                name: "A",
                node_type: "t",
                parameters: params,
            },
            NodeParameterView {
                name: "B",
                node_type: "t",
                parameters: params,
            },
        ]
    }

    #[test]
    fn valid_workflow_passes_all_four_gates() {
        let params = json!({ "url": "https://example.com" });
        assert!(validate_workflow(
            &nodes(),
            &conns_from(&[("A", 0, "B")]),
            &slots_spec(&[("A", 1)]),
            &pnodes(&params),
            &param_specs(),
        )
        .is_ok());
    }

    #[test]
    fn gate_1_duplicate_node_name_rejected() {
        let dup = vec!["A".to_string(), "A".to_string()];
        assert_eq!(
            validate_workflow(
                &dup,
                &conns_from(&[]),
                &OutputSlotSpec::new(),
                &[],
                &ParameterSpecSet::new()
            ),
            Err(ValidationError::DuplicateNodeName("A".into()))
        );
    }

    #[test]
    fn gate_2_dangling_target_rejected() {
        let params = json!({ "url": "u" });
        assert_eq!(
            validate_workflow(
                &nodes(),
                &conns_from(&[("A", 0, "Ghost")]),
                &slots_spec(&[("A", 1)]),
                &pnodes(&params),
                &param_specs(),
            ),
            Err(ValidationError::Connection(
                ConnectionValidationError::DanglingTargetNode {
                    from: "A".into(),
                    target: "Ghost".into(),
                }
            ))
        );
    }

    #[test]
    fn gate_2_non_existent_output_slot_rejected() {
        let params = json!({ "url": "u" });
        assert_eq!(
            validate_workflow(
                &nodes(),
                &conns_from(&[("A", 1, "B")]),
                &slots_spec(&[("A", 1)]),
                &pnodes(&params),
                &param_specs(),
            ),
            Err(ValidationError::Connection(
                ConnectionValidationError::NonExistentOutputSlot {
                    node: "A".into(),
                    connection_type: "main".into(),
                    slot: 1,
                    declared: 1,
                }
            ))
        );
    }

    #[test]
    fn gate_3_cycle_rejected_after_connections_integrity_passes() {
        let params = json!({ "url": "u" });
        let result = validate_workflow(
            &nodes(),
            &conns_from(&[("A", 0, "B"), ("B", 0, "A")]),
            &slots_spec(&[("A", 1), ("B", 1)]),
            &pnodes(&params),
            &param_specs(),
        );
        assert!(matches!(result, Err(ValidationError::CycleDetected(_))));
    }

    #[test]
    fn gate_4_missing_required_parameter_rejected() {
        let params = json!({});
        assert_eq!(
            validate_workflow(
                &nodes(),
                &conns_from(&[("A", 0, "B")]),
                &slots_spec(&[("A", 1)]),
                &pnodes(&params),
                &param_specs(),
            ),
            Err(ValidationError::Parameter(
                ParameterValidationError::MissingRequiredParameter {
                    node: "A".into(),
                    node_type: "t".into(),
                    path: "url".into(),
                    label: "url".into(),
                }
            ))
        );
    }

    #[test]
    fn gate_order_is_deterministic_duplicate_beats_cycle_and_parameter() {
        // Workflow violating gates 1, 3 and 4 simultaneously: the error must be the
        // gate-1 failure — order is part of the contract.
        let params = json!({});
        let dup = vec!["A".to_string(), "A".to_string(), "B".to_string()];
        assert_eq!(
            validate_workflow(
                &dup,
                &conns_from(&[("A", 0, "B"), ("B", 0, "A")]),
                &OutputSlotSpec::new(),
                &pnodes(&params),
                &param_specs(),
            ),
            Err(ValidationError::DuplicateNodeName("A".into()))
        );
    }
}
