use n8n_connection::WorkflowConnections;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ValidationError {
    #[error("Node with name '{0}' is duplicated")]
    DuplicateNodeName(String),
    #[error("Connection targets non-existent node '{0}'")]
    DanglingConnection(String),
    #[error("Workflow contains cycle involving node '{0}'")]
    CycleDetected(String),
    #[error("Unknown connection type '{connection_type}' on node '{node}'")]
    InvalidConnectionType { node: String, connection_type: String },
}

/// Mirrors `nodeConnectionTypes` in n8n 2.9.4 `packages/workflow/src/interfaces.ts`
/// (`NodeConnectionTypes`). The connection-type vocabulary every rule check validates against.
/// Same list as `contracts/validation.contract.md` and the reference implementation
/// `tests/reference/agent-4/validation/workflow-rules.ts`.
pub const NODE_CONNECTION_TYPES: [&str; 13] = [
    "ai_agent",
    "ai_chain",
    "ai_document",
    "ai_embedding",
    "ai_languageModel",
    "ai_memory",
    "ai_outputParser",
    "ai_retriever",
    "ai_reranker",
    "ai_textSplitter",
    "ai_tool",
    "ai_vectorStore",
    "main",
];

pub fn is_connection_type(value: &str) -> bool {
    NODE_CONNECTION_TYPES.contains(&value)
}

/// Result-flavoured variant of the connection-type rule, mirroring
/// [`validate_node_uniqueness`]/[`validate_dangling_connections`]: checks every OUTPUT type key
/// and every connection `type` field against [`NODE_CONNECTION_TYPES`].
pub fn validate_connection_types(connections: &WorkflowConnections) -> Result<(), ValidationError> {
    for (source, outputs) in connections {
        for (conn_type, lists) in outputs {
            if !is_connection_type(conn_type) {
                return Err(ValidationError::InvalidConnectionType {
                    node: source.clone(),
                    connection_type: conn_type.clone(),
                });
            }
            for slot in lists {
                if let Some(items) = slot {
                    for item in items {
                        if !is_connection_type(&item.connection_type) {
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
                        adj.entry(src.as_str()).or_default().push(item.node.as_str());
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

/* -------------------------------------------------------------------------- */
/* Contract aggregate: validateWorkflow (contracts/validation.contract.md §3) */
/* -------------------------------------------------------------------------- */
///
/// Port of the Agent-5-approved reference implementation
/// `tests/reference/agent-4/validation/workflow-rules.ts` (TASK-306, APPROVED):
/// `validateWorkflow(workflow, { allowCycles }) → { valid, errors[] }`.
/// Never returns an Err: malformed input becomes `INVALID_INPUT` issues, and rule
/// violations accumulate — the function reports ALL of them.
///
/// `allow_cycles` defaults to `true` for reference parity (n8n allows runtime loops,
/// e.g. Loop Over Items); pass `Some(false)` for strict DAG semantics (contract §11.7).

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationCode {
    InvalidInput,
    DuplicateNodeName,
    DanglingConnection,
    InvalidConnectionType,
    CycleDetected,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ValidationIssue {
    pub code: ValidationCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ValidationReport {
    pub valid: bool,
    pub errors: Vec<ValidationIssue>,
}

fn issue(code: ValidationCode, message: String, node: Option<String>, path: Vec<String>) -> ValidationIssue {
    ValidationIssue { code, message, node, path: Some(path) }
}

/// `checkNodeUniqueness` — duplicates are reported with their array position.
pub fn check_node_uniqueness(nodes: &[Value]) -> Vec<ValidationIssue> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut errors = Vec::new();
    for (index, node) in nodes.iter().enumerate() {
        let Some(name) = node.get("name").and_then(Value::as_str) else {
            continue;
        };
        if seen.contains(name) {
            errors.push(issue(
                ValidationCode::DuplicateNodeName,
                format!("Duplicate node name \"{name}\""),
                Some(name.to_string()),
                vec!["nodes".into(), index.to_string(), "name".into()],
            ));
        }
        seen.insert(name);
    }
    errors
}

/// `checkDanglingConnections` — reports unknown sources/targets, malformed targets and
/// unknown connection types, mirroring the exact tolerance of the TS reference
/// (non-object type maps and non-array output lists are SKIPPED, not errored).
pub fn check_dangling_connections(node_names: &HashSet<&str>, connections: Option<&Value>) -> Vec<ValidationIssue> {
    let mut errors = Vec::new();
    let Some(Value::Object(by_source)) = connections else {
        return errors;
    };
    for (source, by_type) in by_source {
        if !node_names.contains(source.as_str()) {
            errors.push(issue(
                ValidationCode::DanglingConnection,
                format!("Connection from unknown node \"{source}\""),
                Some(source.clone()),
                vec!["connections".into(), source.clone()],
            ));
        }
        let Value::Object(outputs_by_type) = by_type else { continue };
        for (conn_type, outputs) in outputs_by_type {
            if !is_connection_type(conn_type) {
                errors.push(issue(
                    ValidationCode::InvalidConnectionType,
                    format!("Unknown connection type \"{conn_type}\" on node \"{source}\""),
                    Some(source.clone()),
                    vec!["connections".into(), source.clone(), conn_type.clone()],
                ));
            }
            let Value::Array(slots) = outputs else { continue };
            for (output_index, slot) in slots.iter().enumerate() {
                let Value::Array(targets) = slot else { continue };
                for (target_index, target) in targets.iter().enumerate() {
                    let path = vec![
                        "connections".into(),
                        source.clone(),
                        conn_type.clone(),
                        output_index.to_string(),
                        target_index.to_string(),
                    ];
                    let target_node = target.get("node").and_then(Value::as_str);
                    match target_node {
                        None => errors.push(issue(
                            ValidationCode::DanglingConnection,
                            format!("Malformed connection target from \"{source}\""),
                            Some(source.clone()),
                            path,
                        )),
                        Some(name) => {
                            if !node_names.contains(name) {
                                errors.push(issue(
                                    ValidationCode::DanglingConnection,
                                    format!("Connection from \"{source}\" to unknown node \"{name}\""),
                                    Some(source.clone()),
                                    path.clone(),
                                ));
                            }
                            if let Some(target_type) = target.get("type").and_then(Value::as_str) {
                                if !is_connection_type(target_type) {
                                    let mut type_path = path.clone();
                                    type_path.push("type".into());
                                    errors.push(issue(
                                        ValidationCode::InvalidConnectionType,
                                        format!("Unknown connection type \"{target_type}\" on node \"{source}\""),
                                        Some(source.clone()),
                                        type_path,
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    errors
}

/// `detectCycles` over `main` edges only (contract §11.8) — iterative colour-marked DFS
/// in node order; the first back-edge is reported as a deterministic path `A → B → A`.
pub fn check_cycles(node_names: &[String], connections: Option<&Value>) -> Vec<ValidationIssue> {
    const WHITE: u8 = 0;
    const GREY: u8 = 1;
    const BLACK: u8 = 2;

    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for name in node_names {
        adj.insert(name.as_str(), Vec::new());
    }
    if let Some(Value::Object(by_source)) = connections {
        for (source, by_type) in by_source {
            // Reference: unknown sources do not participate in the cycle graph.
            if !adj.contains_key(source.as_str()) {
                continue;
            }
            let Some(outputs) = by_type.get("main").and_then(Value::as_array) else { continue };
            for slot in outputs {
                let Some(targets) = slot.as_array() else { continue };
                for target in targets {
                    if let Some(name) = target.get("node").and_then(Value::as_str) {
                        if adj.contains_key(name) {
                            adj.entry(source.as_str()).or_default().push(name);
                        }
                    }
                }
            }
        }
    }

    let mut color: HashMap<&str, u8> = node_names.iter().map(|n| (n.as_str(), WHITE)).collect();
    for root in node_names {
        if color[root.as_str()] != WHITE {
            continue;
        }
        color.insert(root.as_str(), GREY);
        let mut stack: Vec<(&str, usize)> = vec![(root.as_str(), 0)];
        let mut path_stack: Vec<&str> = vec![root.as_str()];
        while let Some((frame, next)) = stack.last().copied() {
            let edges = &adj[frame];
            if next < edges.len() {
                stack.last_mut().expect("frame").1 += 1;
                let to = edges[next];
                match color[to] {
                    GREY => {
                        let start = path_stack.iter().position(|n| *n == to).unwrap_or(0);
                        let mut cycle: Vec<&str> = path_stack[start..].to_vec();
                        cycle.push(to);
                        return vec![issue(
                            ValidationCode::CycleDetected,
                            format!("Cycle detected: {}", cycle.join(" → ")),
                            Some(to.to_string()),
                            vec!["connections".into(), frame.to_string(), "main".into()],
                        )];
                    }
                    WHITE => {
                        color.insert(to, GREY);
                        stack.push((to, 0));
                        path_stack.push(to);
                    }
                    _ => {}
                }
            } else {
                color.insert(frame, BLACK);
                stack.pop();
                path_stack.pop();
            }
        }
    }
    Vec::new()
}

/// `validateWorkflow(workflow, { allowCycles })` — contract §3 / §7:
/// never throws, accumulates all errors, malformed input → single `INVALID_INPUT`.
pub fn validate_workflow(workflow: &Value, allow_cycles: Option<bool>) -> ValidationReport {
    let invalid = |message: &str, path: Option<Vec<String>>| ValidationReport {
        valid: false,
        errors: vec![ValidationIssue {
            code: ValidationCode::InvalidInput,
            message: message.to_string(),
            node: None,
            path,
        }],
    };

    let Some(nodes) = workflow.get("nodes").and_then(Value::as_array) else {
        return invalid(
            "Workflow must be an object with a `nodes` array of named nodes",
            None,
        );
    };
    if !workflow.is_object() || nodes.iter().any(|node| !node.get("name").is_some_and(Value::is_string)) {
        return invalid(
            "Workflow must be an object with a `nodes` array of named nodes",
            None,
        );
    }
    let connections = workflow.get("connections");
    if connections.is_some_and(|c| !c.is_object()) {
        return invalid("`connections` must be an object", Some(vec!["connections".into()]));
    }

    let names: Vec<String> = nodes
        .iter()
        .map(|node| node["name"].as_str().unwrap_or_default().to_string())
        .collect();
    let name_set: HashSet<&str> = names.iter().map(String::as_str).collect();

    let mut errors = check_node_uniqueness(nodes);
    errors.extend(check_dangling_connections(&name_set, connections));
    if allow_cycles == Some(false) {
        errors.extend(check_cycles(&names, connections));
    }
    ValidationReport { valid: errors.is_empty(), errors }
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
    fn test_invalid_connection_type_key_is_rejected() {
        let mut conns = WorkflowConnections::new();
        let mut outs = IndexMap::new();
        outs.insert("bogus".into(), vec![Some(vec![n8n_connection::ConnectionItem {
            node: "B".into(),
            connection_type: "bogus".into(),
            index: 0,
        }])]);
        conns.insert("A".into(), outs);

        assert_eq!(
            validate_connection_types(&conns),
            Err(ValidationError::InvalidConnectionType {
                node: "A".to_string(),
                connection_type: "bogus".to_string(),
            })
        );
    }

    #[test]
    fn test_valid_connection_types_pass() {
        for conn_type in NODE_CONNECTION_TYPES {
            let mut conns = WorkflowConnections::new();
            let mut outs = IndexMap::new();
            outs.insert(conn_type.into(), vec![Some(vec![n8n_connection::ConnectionItem {
                node: "B".into(),
                connection_type: conn_type.into(),
                index: 0,
            }])]);
            conns.insert("A".into(), outs);
            assert!(validate_connection_types(&conns).is_ok(), "{conn_type} must be accepted");
        }
    }

    #[test]
    fn test_validate_workflow_malformed_input() {
        let report = validate_workflow(&serde_json::json!({"connections": {}}), None);
        assert!(!report.valid);
        assert_eq!(report.errors.len(), 1);
        assert_eq!(report.errors[0].code, ValidationCode::InvalidInput);
        assert_eq!(
            report.errors[0].message,
            "Workflow must be an object with a `nodes` array of named nodes"
        );

        let report = validate_workflow(&serde_json::json!({"nodes": [], "connections": "oops"}), None);
        assert!(!report.valid);
        assert_eq!(report.errors[0].code, ValidationCode::InvalidInput);
        assert_eq!(report.errors[0].message, "`connections` must be an object");
    }

    #[test]
    fn test_validate_workflow_accumulates_contract_codes() {
        let workflow = serde_json::json!({
            "nodes": [
                {"name": "A"}, {"name": "A"}, {"name": "B"}
            ],
            "connections": {
                "Ghost": { "main": [[{"node": "B", "type": "main", "index": 0}]] },
                "A": {
                    "bogus": [[{"node": "B", "type": "bogus", "index": 0}]],
                    "main": [[null]]
                },
                "B": { "main": "not-an-array" },
                "C": { "main": "also-not-an-array" }
            }
        });
        let report = validate_workflow(&workflow, None);
        assert!(!report.valid);
        let codes: Vec<ValidationCode> = report.errors.iter().map(|error| error.code).collect();
        assert!(codes.contains(&ValidationCode::DuplicateNodeName), "{codes:?}");
        assert!(codes.contains(&ValidationCode::DanglingConnection), "{codes:?}");
        assert!(codes.contains(&ValidationCode::InvalidConnectionType), "{codes:?}");
        // every message from the contract vocabulary
        assert!(report.errors.iter().any(|e| e.message == "Duplicate node name \"A\""));
        assert!(report.errors.iter().any(|e| e.message == "Connection from unknown node \"Ghost\""));
        assert!(report.errors.iter().any(|e| e.message == "Unknown connection type \"bogus\" on node \"A\""));
        assert!(report.errors.iter().any(|e| e.message == "Malformed connection target from \"A\""));
    }

    #[test]
    fn test_validate_workflow_cycle_semantics() {
        let workflow = serde_json::json!({
            "nodes": [{"name": "A"}, {"name": "B"}],
            "connections": {
                "A": { "main": [[{"node": "B", "type": "main", "index": 0}]] },
                "B": { "main": [[{"node": "A", "type": "main", "index": 0}]] }
            }
        });
        // contract §11.7: default allows cycles (reference parity — runtime loops are legal)
        assert!(validate_workflow(&workflow, None).valid);
        assert!(validate_workflow(&workflow, Some(true)).valid);

        let strict = validate_workflow(&workflow, Some(false));
        assert!(!strict.valid);
        assert_eq!(strict.errors[0].code, ValidationCode::CycleDetected);
        assert_eq!(strict.errors[0].message, "Cycle detected: A → B → A");
        assert_eq!(strict.errors[0].node.as_deref(), Some("A"));
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
}
