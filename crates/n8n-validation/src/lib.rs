//! LEGO 04 — Validation (Rust port, Phase 3).
//!
//! Normative surface (since TASK-408): [`validate_workflow`] — a pure, accumulated rule
//! engine over untyped JSON, specified by
//! `docs/isolation/validation-rust-port-spec.md` (Agent-4, Option B) and accepted by the
//! 14 golden fixtures in `tests/reference/agent-4/validation/fixtures/D*.json`
//! (see `tests/parity.rs` — 14/14, no silent skips).
//!
//! Reference-parity note (spec §1): n8n 2.9.4 itself does NOT reject duplicate names,
//! dangling connections or cycles at save time; these rules are the NEW CAPABILITY agreed
//! in ISSUE-003 Option A and are opt-in — `allow_cycles` defaults to `true`.
//!
//! Determinism (spec §3, contract §11.9): error order never depends on JSON key order —
//! sources iterate in `nodes[]` order first (unknown sources lexically), types lexically,
//! outputs/targets in array order, rules in the order uniqueness → dangling/type → cycles.
//!
//! The legacy fail-fast fns ([`validate_node_uniqueness`],
//! [`validate_dangling_connections`], [`detect_cycles`]) are kept for the existing
//! conformance harnesses; their Display strings are aligned with the frozen TS strings
//! (F5). The accumulated report API is the normative surface.

use indexmap::{IndexMap, IndexSet};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

// ---------------------------------------------------------------------------
// Normative report API (spec §2)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationCode {
    InvalidInput,
    DuplicateNodeName,
    DanglingConnection,
    InvalidConnectionType,
    CycleDetected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub code: ValidationCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationReport {
    pub valid: bool,
    pub errors: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ValidateOptions {
    pub allow_cycles: bool,
}

impl Default for ValidateOptions {
    fn default() -> Self {
        Self { allow_cycles: true }
    }
}

/// Mirrors `NodeConnectionTypes` in n8n 2.9.4 `packages/workflow/src/interfaces.ts:2249`.
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

/// The typed view built by [`validate_workflow`] after the [`ValidationCode::InvalidInput`]
/// gate (spec §2). `node_names` keeps `nodes[]` order with duplicates.
pub struct WorkflowView<'a> {
    pub node_names: Vec<&'a str>,
    pub connections: &'a serde_json::Map<String, Value>,
}

fn issue(code: ValidationCode, message: String, node: Option<String>, path: Option<Vec<String>>) -> ValidationIssue {
    ValidationIssue { code, message, node, path }
}

/// Deterministic source order (spec §3.2): names in `nodes[]` order (first occurrence
/// only) that exist as connection keys, then the remaining keys sorted lexically.
fn ordered_sources<'a>(view: &WorkflowView<'a>) -> Vec<&'a str> {
    let mut ordered: Vec<&'a str> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for name in &view.node_names {
        if seen.insert(name) && view.connections.contains_key(*name) {
            ordered.push(name);
        }
    }
    let mut remaining: Vec<&'a str> = view
        .connections
        .keys()
        .map(String::as_str)
        .filter(|key| !seen.contains(key))
        .collect();
    remaining.sort_unstable();
    ordered.extend(remaining);
    ordered
}

fn is_valid_connection_type(connection_type: &str) -> bool {
    NODE_CONNECTION_TYPES.contains(&connection_type)
}

/// Entry point (spec §2/§8). Takes untyped JSON on purpose: malformed input is a *report*,
/// never an `Err` or a panic.
pub fn validate_workflow(workflow: &Value, opts: ValidateOptions) -> ValidationReport {
    // --- §4 input gate -----------------------------------------------------
    let Some(nodes) = workflow.get("nodes").and_then(Value::as_array) else {
        return ValidationReport {
            valid: false,
            errors: vec![issue(
                ValidationCode::InvalidInput,
                "Workflow must be an object with a `nodes` array of named nodes".to_string(),
                None,
                None,
            )],
        };
    };
    let mut node_names: Vec<&str> = Vec::with_capacity(nodes.len());
    for node in nodes {
        match node.get("name").and_then(Value::as_str) {
            Some(name) => node_names.push(name),
            None => {
                return ValidationReport {
                    valid: false,
                    errors: vec![issue(
                        ValidationCode::InvalidInput,
                        "Workflow must be an object with a `nodes` array of named nodes".to_string(),
                        None,
                        None,
                    )],
                };
            }
        }
    }

    let empty_connections = serde_json::Map::new();
    let connections: &serde_json::Map<String, Value> = match workflow.get("connections") {
        None => &empty_connections,
        Some(Value::Object(map)) => map,
        Some(_) => {
            return ValidationReport {
                valid: false,
                errors: vec![issue(
                    ValidationCode::InvalidInput,
                    "`connections` must be an object".to_string(),
                    None,
                    Some(vec!["connections".to_string()]),
                )],
            };
        }
    };

    let view = WorkflowView {
        node_names,
        connections,
    };

    // --- §8 composition: uniqueness → dangling/type → cycles ---------------
    let mut errors: Vec<ValidationIssue> = Vec::new();
    errors.extend(check_node_uniqueness(&view));
    errors.extend(check_dangling_connections(&view));
    if !opts.allow_cycles {
        errors.extend(detect_cycles(&view));
    }

    ValidationReport {
        valid: errors.is_empty(),
        errors,
    }
}

/// Spec §5: every duplicate (second and later occurrence) is reported.
pub fn check_node_uniqueness(view: &WorkflowView<'_>) -> Vec<ValidationIssue> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut errors: Vec<ValidationIssue> = Vec::new();
    for (index, name) in view.node_names.iter().enumerate() {
        if !seen.insert(name) {
            errors.push(issue(
                ValidationCode::DuplicateNodeName,
                format!("Duplicate node name \"{name}\""),
                Some(name.to_string()),
                Some(vec![
                    "nodes".to_string(),
                    index.to_string(),
                    "name".to_string(),
                ]),
            ));
        }
    }
    errors
}

/// Spec §6: dangling sources/targets plus `INVALID_CONNECTION_TYPE` on the type key and
/// on each well-formed target's `type` string. Unknown type keys do NOT stop target
/// checking (D05 pins two issues for `A --foo--> B`).
pub fn check_dangling_connections(view: &WorkflowView<'_>) -> Vec<ValidationIssue> {
    let names: HashSet<&str> = view.node_names.iter().copied().collect();
    let mut errors: Vec<ValidationIssue> = Vec::new();

    for source in ordered_sources(view) {
        let Some(by_type) = view.connections.get(source).and_then(Value::as_object) else {
            // Unknown source with a non-object body was already reported above; a known
            // node whose body is not an object has nothing to walk (spec: `continue`).
            if !names.contains(source) {
                errors.push(issue(
                    ValidationCode::DanglingConnection,
                    format!("Connection from unknown node \"{source}\""),
                    Some(source.to_string()),
                    Some(vec!["connections".to_string(), source.to_string()]),
                ));
            }
            continue;
        };

        if !names.contains(source) {
            errors.push(issue(
                ValidationCode::DanglingConnection,
                format!("Connection from unknown node \"{source}\""),
                Some(source.to_string()),
                Some(vec!["connections".to_string(), source.to_string()]),
            ));
        }

        let mut type_keys: Vec<&str> = by_type.keys().map(String::as_str).collect();
        type_keys.sort_unstable();
        for ty in type_keys {
            let outputs = &by_type[ty];
            if !is_valid_connection_type(ty) {
                errors.push(issue(
                    ValidationCode::InvalidConnectionType,
                    format!("Unknown connection type \"{ty}\" on node \"{source}\""),
                    Some(source.to_string()),
                    Some(vec![
                        "connections".to_string(),
                        source.to_string(),
                        ty.to_string(),
                    ]),
                ));
            }
            let Some(output_list) = outputs.as_array() else {
                continue;
            };
            for (output_index, output) in output_list.iter().enumerate() {
                let Some(targets) = output.as_array() else {
                    if !output.is_null() {
                        errors.push(issue(
                            ValidationCode::DanglingConnection,
                            format!("Malformed connection output from \"{source}\""),
                            Some(source.to_string()),
                            Some(vec![
                                "connections".to_string(),
                                source.to_string(),
                                ty.to_string(),
                                output_index.to_string(),
                            ]),
                        ));
                    }
                    continue;
                };
                for (target_index, target) in targets.iter().enumerate() {
                    let path = vec![
                        "connections".to_string(),
                        source.to_string(),
                        ty.to_string(),
                        output_index.to_string(),
                        target_index.to_string(),
                    ];
                    let target_node = target.get("node").and_then(Value::as_str);
                    let Some(target_node) = target_node else {
                        errors.push(issue(
                            ValidationCode::DanglingConnection,
                            format!("Malformed connection target from \"{source}\""),
                            Some(source.to_string()),
                            Some(path),
                        ));
                        continue;
                    };
                    if !names.contains(target_node) {
                        errors.push(issue(
                            ValidationCode::DanglingConnection,
                            format!("Connection from \"{source}\" to unknown node \"{target_node}\""),
                            Some(source.to_string()),
                            Some(path.clone()),
                        ));
                    }
                    if let Some(target_type) = target.get("type").and_then(Value::as_str) {
                        if !is_valid_connection_type(target_type) {
                            let mut type_path = path.clone();
                            type_path.push("type".to_string());
                            errors.push(issue(
                                ValidationCode::InvalidConnectionType,
                                format!("Unknown connection type \"{target_type}\" on node \"{source}\""),
                                Some(source.to_string()),
                                Some(type_path),
                            ));
                        }
                    }
                }
            }
        }
    }

    errors
}

/// Spec §7: iterative DFS over the `main` graph in `nodes[]` order; reports exactly one
/// `CYCLE_DETECTED` (the first back-edge in deterministic order). Only runs when
/// `allow_cycles == false` (spec §8). Edges from/to unknown nodes are skipped.
pub fn detect_cycles(view: &WorkflowView<'_>) -> Vec<ValidationIssue> {
    // Adjacency in nodes[] order; first occurrence wins for duplicate names.
    let mut adj: IndexMap<&str, Vec<&str>> = IndexMap::new();
    for name in &view.node_names {
        adj.entry(name).or_default();
    }
    for source in ordered_sources(view) {
        if !adj.contains_key(source) {
            continue; // unknown source — its edges are never followed (spec §7)
        }
        let Some(by_type) = view.connections.get(source).and_then(Value::as_object) else {
            continue;
        };
        let Some(output_list) = by_type.get("main").and_then(Value::as_array) else {
            continue;
        };
        let mut targets: Vec<&str> = Vec::new();
        for output in output_list {
            let Some(targets_in_slot) = output.as_array() else { continue };
            for target in targets_in_slot {
                if let Some(node) = target.get("node").and_then(Value::as_str) {
                    if adj.contains_key(node) {
                        targets.push(node);
                    }
                }
            }
        }
        adj.entry(source).or_default().extend(targets);
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Colour {
        White,
        Grey,
        Black,
    }
    let mut colour: IndexMap<&str, Colour> =
        adj.keys().copied().map(|name| (name, Colour::White)).collect();

    // Iterative DFS with an explicit stack: (node, next-neighbour index).
    let mut stack: Vec<(&str, usize)> = Vec::new();
    let mut path_stack: Vec<&str> = Vec::new();

    for root in adj.keys().copied().collect::<Vec<_>>() {
        if colour.get(root) != Some(&Colour::White) {
            continue;
        }
        colour.insert(root, Colour::Grey);
        stack.push((root, 0));
        path_stack.push(root);

        while let Some(frame) = stack.last_mut() {
            let node = frame.0;
            let neighbours: Vec<&str> = adj.get(node).cloned().unwrap_or_default();
            if frame.1 < neighbours.len() {
                let to = neighbours[frame.1];
                frame.1 += 1;
                if colour.get(to) == Some(&Colour::Grey) {
                    let start = path_stack
                        .iter()
                        .position(|name| *name == to)
                        .unwrap_or(0);
                    let mut cycle: Vec<String> =
                        path_stack[start..].iter().map(|name| name.to_string()).collect();
                    cycle.push(to.to_string());
                    return vec![issue(
                        ValidationCode::CycleDetected,
                        format!("Cycle detected: {}", cycle.join(" \u{2192} ")),
                        Some(to.to_string()),
                        Some(vec![
                            "connections".to_string(),
                            node.to_string(),
                            "main".to_string(),
                        ]),
                    )];
                }
                if colour.get(to) == Some(&Colour::White) {
                    colour.insert(to, Colour::Grey);
                    stack.push((to, 0));
                    path_stack.push(to);
                }
            } else {
                colour.insert(node, Colour::Black);
                stack.pop();
                path_stack.pop();
            }
        }
    }

    Vec::new()
}

// ---------------------------------------------------------------------------
// Legacy fail-fast API — kept for the existing conformance harnesses; Display
// strings aligned with the frozen TS oracle strings (spec F5).
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ValidationError {
    #[error("Duplicate node name \"{0}\"")]
    DuplicateNodeName(String),
    /// Payload is the full frozen TS message string.
    #[error("{0}")]
    DanglingConnection(String),
    #[error("Unknown connection type \"{connection_type}\" on node \"{node}\"")]
    InvalidConnectionType { node: String, connection_type: String },
    #[error("Cycle detected: {0}")]
    CycleDetected(String),
}

/// Fail-fast uniqueness (legacy harness API). Prefer [`validate_workflow`] /
/// [`check_node_uniqueness`] — the accumulated, contract-shaped surface.
pub fn validate_node_uniqueness(nodes: &[String]) -> Result<(), ValidationError> {
    let mut seen = HashSet::new();
    for name in nodes {
        if !seen.insert(name) {
            return Err(ValidationError::DuplicateNodeName(name.clone()));
        }
    }
    Ok(())
}

/// Fail-fast dangling/type check (legacy harness API) over the §3 deterministic order.
pub fn validate_dangling_connections(
    nodes: &[String],
    connections: &n8n_connection::WorkflowConnections,
) -> Result<(), ValidationError> {
    let node_set: HashSet<&str> = nodes.iter().map(String::as_str).collect();

    // §3 source order: nodes[] order first, then unknown sources lexically.
    let mut ordered: Vec<&String> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for name in nodes {
        if seen.insert(name.as_str()) && connections.contains_key(name) {
            ordered.push(name);
        }
    }
    let mut remaining: Vec<&String> = connections
        .keys()
        .filter(|key| !seen.contains(key.as_str()))
        .collect();
    remaining.sort();

    for source in ordered.into_iter().chain(remaining) {
        let outputs = &connections[source];
        if !node_set.contains(source.as_str()) {
            return Err(ValidationError::DanglingConnection(format!(
                "Connection from unknown node \"{source}\""
            )));
        }
        for (type_key, list) in outputs {
            if !is_valid_connection_type(type_key) {
                return Err(ValidationError::InvalidConnectionType {
                    node: source.clone(),
                    connection_type: type_key.clone(),
                });
            }
            for slot in list {
                if let Some(items) = slot {
                    for item in items {
                        if !node_set.contains(item.node.as_str()) {
                            return Err(ValidationError::DanglingConnection(format!(
                                "Connection from \"{source}\" to unknown node \"{}\"",
                                item.node
                            )));
                        }
                        if !is_valid_connection_type(&item.connection_type) {
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

/// Fail-fast cycle detection over the `main` graph (legacy harness API, named *_fail_fast
/// because the normative accumulated [`detect_cycles`] now owns the plain name); the error
/// message is the deterministic cycle path joined with ` → `.
pub fn detect_cycles_fail_fast(
    nodes: &[String],
    connections: &n8n_connection::WorkflowConnections,
) -> Result<(), ValidationError> {
    // Adjacency in nodes[] order; edges only from/to known nodes; `main` only.
    let mut adj: IndexMap<&str, Vec<&str>> = IndexMap::new();
    for n in nodes {
        adj.entry(n.as_str()).or_default();
    }

    let mut ordered: Vec<&String> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for name in nodes {
        if seen.insert(name.as_str()) && connections.contains_key(name) {
            ordered.push(name);
        }
    }
    let mut remaining: Vec<&String> = connections
        .keys()
        .filter(|key| !seen.contains(key.as_str()))
        .collect();
    remaining.sort();

    for src in ordered {
        let outputs = &connections[src];
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
    for src in remaining {
        // Unknown sources have no adjacency entry — their edges are never followed (§7).
        let _ = src;
    }

    let mut visited: IndexSet<&str> = IndexSet::new();
    let mut rec_stack: HashSet<&str> = HashSet::new();
    let mut path_stack: Vec<&str> = Vec::new();

    fn dfs<'a>(
        node: &'a str,
        adj: &IndexMap<&'a str, Vec<&'a str>>,
        visited: &mut IndexSet<&'a str>,
        rec_stack: &mut HashSet<&'a str>,
        path_stack: &mut Vec<&'a str>,
    ) -> Option<Vec<String>> {
        visited.insert(node);
        rec_stack.insert(node);
        path_stack.push(node);

        if let Some(neighbors) = adj.get(node) {
            for &next_node in neighbors {
                if !visited.contains(next_node) {
                    if let Some(cycle) = dfs(next_node, adj, visited, rec_stack, path_stack) {
                        path_stack.pop();
                        return Some(cycle);
                    }
                } else if rec_stack.contains(next_node) {
                    let start = path_stack
                        .iter()
                        .position(|name| *name == next_node)
                        .unwrap_or(0);
                    let mut cycle: Vec<String> =
                        path_stack[start..].iter().map(|name| name.to_string()).collect();
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
                return Err(ValidationError::CycleDetected(cycle.join(" \u{2192} ")));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use serde_json::json;

    fn workflow_value(nodes: Value, connections: Value) -> Value {
        json!({ "nodes": nodes, "connections": connections })
    }

    /// Compare `issue.path` (`Option<Vec<String>>`) against string slices.
    fn path_of(issue: &ValidationIssue) -> Option<Vec<&str>> {
        issue.path.as_ref().map(|path| path.iter().map(String::as_str).collect())
    }

    #[test]
    fn invalid_input_gates_match_the_spec() {
        // not an object / nodes missing / node without a name
        for garbage in [
            json!("garbage"),
            json!([]),
            json!({}),
            json!({ "nodes": [{}] }),
            json!({ "nodes": [{ "name": 7 }] }),
        ] {
            let report = validate_workflow(&garbage, ValidateOptions::default());
            assert!(!report.valid);
            assert_eq!(report.errors.len(), 1);
            assert_eq!(report.errors[0].code, ValidationCode::InvalidInput);
            assert_eq!(
                report.errors[0].message,
                "Workflow must be an object with a `nodes` array of named nodes"
            );
            assert!(report.errors[0].node.is_none() && report.errors[0].path.is_none());
        }

        // connections present but not an object
        let report = validate_workflow(
            &workflow_value(json!([{ "name": "A" }]), json!([])),
            ValidateOptions::default(),
        );
        assert_eq!(report.errors.len(), 1);
        assert_eq!(report.errors[0].message, "`connections` must be an object");
        assert_eq!(path_of(&report.errors[0]), Some(vec!["connections"]));
    }

    #[test]
    fn uniqueness_reports_every_duplicate_with_the_frozen_message() {
        let report = validate_workflow(
            &workflow_value(
                json!([{ "name": "A" }, { "name": "A" }, { "name": "A" }]),
                json!({}),
            ),
            ValidateOptions::default(),
        );
        assert!(!report.valid);
        assert_eq!(report.errors.len(), 2);
        assert_eq!(report.errors[0].message, "Duplicate node name \"A\"");
        assert_eq!(report.errors[0].node.as_deref(), Some("A"));
        assert_eq!(path_of(&report.errors[0]), Some(vec!["nodes", "1", "name"]));
        assert_eq!(path_of(&report.errors[1]), Some(vec!["nodes", "2", "name"]));
    }

    #[test]
    fn unknown_type_key_produces_two_issues_and_still_checks_targets() {
        // A --foo--> Ghost: INVALID_CONNECTION_TYPE (type key), then DANGLING_CONNECTION
        // (target unknown), then INVALID_CONNECTION_TYPE (target type) — spec §6 order
        // within the target iteration. D05 (known target) pins the two-issue variant.
        let report = validate_workflow(
            &workflow_value(
                json!([{ "name": "A" }]),
                json!({ "A": { "foo": [[ { "node": "Ghost", "type": "foo", "index": 0 } ]] } }),
            ),
            ValidateOptions::default(),
        );
        assert_eq!(report.errors.len(), 3);
        assert_eq!(report.errors[0].code, ValidationCode::InvalidConnectionType);
        assert_eq!(path_of(&report.errors[0]), Some(vec!["connections", "A", "foo"]));
        assert_eq!(report.errors[1].code, ValidationCode::DanglingConnection);
        assert_eq!(
            report.errors[1].message,
            "Connection from \"A\" to unknown node \"Ghost\""
        );
        assert_eq!(report.errors[2].code, ValidationCode::InvalidConnectionType);
        assert_eq!(
            path_of(&report.errors[2]),
            Some(vec!["connections", "A", "foo", "0", "0", "type"])
        );
    }

    #[test]
    fn sources_follow_nodes_order_then_lexical_unknowns() {
        // Connection keys deliberately out of lexicographic order; "Nope" is unknown.
        let report = validate_workflow(
            &workflow_value(
                json!([{ "name": "B" }, { "name": "A" }]),
                json!({
                    "Nope": { "main": [[]] },
                    "B": { "main": [[ { "node": "Ghost", "type": "main", "index": 0 } ]] },
                    "A": { "main": [[ { "node": "Ghost2", "type": "main", "index": 0 } ]] }
                }),
            ),
            ValidateOptions::default(),
        );
        // Spec §3.2: sources iterate in nodes[] order first (B, then A); unknown
        // sources follow lexically. The connections map is deliberately scrambled.
        let nodes: Vec<Option<&String>> =
            report.errors.iter().map(|error| error.node.as_ref()).collect();
        assert_eq!(
            nodes,
            vec![
                Some(&"B".to_string()),
                Some(&"A".to_string()),
                Some(&"Nope".to_string())
            ]
        );
    }

    #[test]
    fn cycles_single_issue_self_loop_and_path_message() {
        let report = validate_workflow(
            &workflow_value(
                json!([{ "name": "A" }]),
                json!({ "A": { "main": [[ { "node": "A", "type": "main", "index": 0 } ]] } }),
            ),
            ValidateOptions { allow_cycles: false },
        );
        assert_eq!(report.errors.len(), 1);
        assert_eq!(
            report.errors[0].message,
            "Cycle detected: A \u{2192} A"
        );
        assert_eq!(path_of(&report.errors[0]), Some(vec!["connections", "A", "main"]));
    }

    #[test]
    fn malformed_output_slot_is_reported_not_panic() {
        let report = validate_workflow(
            &workflow_value(
                json!([{ "name": "A" }, { "name": "B" }]),
                json!({ "A": { "main": [1] } }),
            ),
            ValidateOptions::default(),
        );
        assert_eq!(report.errors.len(), 1);
        assert_eq!(
            report.errors[0].message,
            "Malformed connection output from \"A\""
        );
        assert_eq!(path_of(&report.errors[0]), Some(vec!["connections", "A", "main", "0"]));
    }

    #[test]
    fn never_panics_on_arbitrary_garbage() {
        let garbage = json!({
            "nodes": [1, "x", null, { "name": "ok" }],
            "connections": { "ok": { "main": [null, "x", [null, { "node": 3 }]] } }
        });
        let _ = validate_workflow(&garbage, ValidateOptions { allow_cycles: false });
        let _ = validate_workflow(&garbage, ValidateOptions::default());
    }

    // --- legacy harness API ----------------------------------------------

    fn item(node: &str, connection_type: &str, index: usize) -> n8n_connection::ConnectionItem {
        n8n_connection::ConnectionItem {
            node: node.into(),
            connection_type: connection_type.into(),
            index,
        }
    }

    #[test]
    fn legacy_dangling_orders_sources_by_nodes_then_lexical() {
        let mut conns: n8n_connection::WorkflowConnections = IndexMap::new();
        let mut outputs = IndexMap::new();
        outputs.insert("main".into(), vec![Some(vec![item("Ghost", "main", 0)])]);
        conns.insert("B".into(), outputs.clone());
        conns.insert("A".into(), outputs);

        let nodes = vec!["A".to_string(), "B".to_string()];
        // §3 order: A first (nodes[] order), so the error node is "A", not "B".
        assert_eq!(
            validate_dangling_connections(&nodes, &conns),
            Err(ValidationError::DanglingConnection(
                "Connection from \"A\" to unknown node \"Ghost\"".to_string()
            ))
        );
    }

    #[test]
    fn legacy_cycle_message_is_the_path() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = n8n_connection::WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert("main".into(), vec![Some(vec![item("B", "main", 0)])]);
        conns.insert("A".into(), a_outs);
        let mut b_outs = IndexMap::new();
        b_outs.insert("main".into(), vec![Some(vec![item("A", "main", 0)])]);
        conns.insert("B".into(), b_outs);

        assert_eq!(
            detect_cycles_fail_fast(&nodes, &conns),
            Err(ValidationError::CycleDetected("A \u{2192} B \u{2192} A".to_string()))
        );
        assert_eq!(
            detect_cycles_fail_fast(&nodes, &conns).unwrap_err().to_string(),
            "Cycle detected: A \u{2192} B \u{2192} A"
        );
    }

    // Golden case D5 at the unit level (invalid type key).
    #[test]
    fn test_unknown_connection_type_key_is_rejected() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = n8n_connection::WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert(
            "foo".into(),
            vec![Some(vec![item("B", "foo", 0)])],
        );
        conns.insert("A".into(), a_outs);

        assert_eq!(
            validate_dangling_connections(&nodes, &conns),
            Err(ValidationError::InvalidConnectionType {
                node: "A".to_string(),
                connection_type: "foo".to_string(),
            })
        );
        assert_eq!(
            validate_dangling_connections(&nodes, &conns)
                .unwrap_err()
                .to_string(),
            "Unknown connection type \"foo\" on node \"A\""
        );
    }

    #[test]
    fn test_unknown_edge_connection_type_is_rejected() {
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = n8n_connection::WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert("ai_tool".into(), vec![Some(vec![item("B", "ai_widget", 0)])]);
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
        let mut conns = n8n_connection::WorkflowConnections::new();
        let mut a_outs = IndexMap::new();
        a_outs.insert("ai_tool".into(), vec![Some(vec![item("B", "ai_tool", 0)])]);
        conns.insert("A".into(), a_outs);
        let mut b_outs = IndexMap::new();
        b_outs.insert("ai_tool".into(), vec![Some(vec![item("A", "ai_tool", 0)])]);
        conns.insert("B".into(), b_outs);

        assert!(detect_cycles_fail_fast(&nodes, &conns).is_ok());
    }
}
