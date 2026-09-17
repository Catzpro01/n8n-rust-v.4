//! Validation LEGO — Rust port of the NEW CAPABILITY rules.
//!
//! Normative source: `tests/reference/agent-4/validation/workflow-rules.ts`
//! (`contracts/validation.contract.md` §4.4/§10). The port is exact:
//!
//! * [`check_node_uniqueness`] / [`check_dangling_connections`] /
//!   [`detect_cycles`] — composable collect-all parts returning
//!   `Vec<ValidationError>` (never just the first error).
//! * [`validate_workflow`] / [`validate_workflow_json`] — `{ valid, errors }`
//!   reports; malformed input yields a single `INVALID_INPUT` error and never
//!   throws (never panics).
//! * Cycle detection walks `main` edges only (contract §11.8), visits roots
//!   in `nodes` order, and reports the first back-edge as a deterministic
//!   `A → B → A` path.
//!
//! ## Why [`OrderedValue`] instead of `serde_json::Value`
//!
//! Collect-all error order follows `Object.entries` insertion order (pinned
//! by fixture `X15-collect-all-insertion-order`). `serde_json::Value` objects
//! keep insertion order only with the `preserve_order` cargo feature, which
//! unifies workspace-wide — parsing into `Value` first would silently depend
//! on that flag. Following the `IndexMap` / `OrderedMap` precedent, this
//! crate therefore parses JSON text directly into the insertion-ordered
//! [`OrderedValue`], whose order guarantee holds however `serde_json` itself
//! is configured.
//!
//! Conformance is pinned by `tests/reference/agent-4/validation/fixtures.json`
//! (generated from `workflow-rules.ts` by `build-fixtures.mjs`, asserted by
//! `tests/validation_fixtures.rs`).

use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde::de::{MapAccess, SeqAccess, Visitor};
use std::collections::{HashMap, HashSet};
use std::fmt;

/// An insertion-ordered JSON value.
///
/// Mirrors `serde_json::Value`, except objects are [`IndexMap`]s, so document
/// order survives a parse however `serde_json` itself is configured. Used for
/// every workflow input so collect-all error order matches the reference.
#[derive(Debug, Clone, PartialEq)]
pub enum OrderedValue {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
    Array(Vec<OrderedValue>),
    Object(IndexMap<String, OrderedValue>),
}

impl OrderedValue {
    pub fn as_object(&self) -> Option<&IndexMap<String, OrderedValue>> {
        match self {
            OrderedValue::Object(map) => Some(map),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&OrderedValue> {
        self.as_object()?.get(key)
    }

    pub fn as_array(&self) -> Option<&Vec<OrderedValue>> {
        match self {
            OrderedValue::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            OrderedValue::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            OrderedValue::Bool(b) => Some(*b),
            _ => None,
        }
    }
}

struct OrderedValueVisitor;

impl<'de> Visitor<'de> for OrderedValueVisitor {
    type Value = OrderedValue;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("any JSON value")
    }

    fn visit_unit<E: serde::de::Error>(self) -> Result<OrderedValue, E> {
        Ok(OrderedValue::Null)
    }

    fn visit_none<E: serde::de::Error>(self) -> Result<OrderedValue, E> {
        Ok(OrderedValue::Null)
    }

    fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<OrderedValue, E> {
        Ok(OrderedValue::Bool(v))
    }

    fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<OrderedValue, E> {
        Ok(OrderedValue::Number(v.into()))
    }

    fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<OrderedValue, E> {
        Ok(OrderedValue::Number(v.into()))
    }

    fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<OrderedValue, E> {
        serde_json::Number::from_f64(v)
            .map(OrderedValue::Number)
            .ok_or_else(|| E::custom("non-finite float"))
    }

    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<OrderedValue, E> {
        Ok(OrderedValue::String(v.to_owned()))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<OrderedValue, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(OrderedValue::Array(items))
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<OrderedValue, M::Error> {
        let mut entries = IndexMap::new();
        while let Some((key, value)) = map.next_entry::<String, OrderedValue>()? {
            entries.insert(key, value);
        }
        Ok(OrderedValue::Object(entries))
    }
}

impl<'de> Deserialize<'de> for OrderedValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(OrderedValueVisitor)
    }
}

impl Serialize for OrderedValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            OrderedValue::Null => serializer.serialize_unit(),
            OrderedValue::Bool(b) => serializer.serialize_bool(*b),
            OrderedValue::Number(n) => n.serialize(serializer),
            OrderedValue::String(s) => serializer.serialize_str(s),
            OrderedValue::Array(items) => {
                use serde::ser::SerializeSeq;
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            OrderedValue::Object(map) => {
                use serde::ser::SerializeMap;
                let mut out = serializer.serialize_map(Some(map.len()))?;
                for (key, value) in map {
                    out.serialize_entry(key, value)?;
                }
                out.end()
            }
        }
    }
}

/// Mirrors `nodeConnectionTypes` in n8n 2.9.4 `packages/workflow/src/interfaces.ts`
/// (`NODE_CONNECTION_TYPES` in `workflow-rules.ts`).
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

fn is_known_connection_type(t: &str) -> bool {
    NODE_CONNECTION_TYPES.contains(&t)
}

/// Error codes of [`ValidationError`], mirroring `ValidationErrorCode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationErrorCode {
    InvalidInput,
    DuplicateNodeName,
    DanglingConnection,
    InvalidConnectionType,
    CycleDetected,
}

/// A single rule violation. Field order mirrors the `workflow-rules.ts` object
/// literal shape (`{ code, node?, path?, message }`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationError {
    pub code: ValidationErrorCode,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub path: Option<Vec<String>>,
    pub message: String,
}

/// The `{ valid, errors }` report of [`validate_workflow`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationReport {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
}

/// Options for [`validate_workflow`]. Reference parity: n8n allows runtime
/// loops (Loop Over Items), so `allow_cycles` defaults to `true`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidateOptions {
    pub allow_cycles: bool,
}

impl Default for ValidateOptions {
    fn default() -> Self {
        Self { allow_cycles: true }
    }
}

fn err(
    code: ValidationErrorCode,
    node: Option<&str>,
    path: Option<Vec<&str>>,
    message: String,
) -> ValidationError {
    ValidationError {
        code,
        node: node.map(str::to_owned),
        path: path.map(|p| p.into_iter().map(str::to_owned).collect()),
        message,
    }
}

/// Reports every duplicated node name (`DUPLICATE_NODE_NAME`), in `nodes`
/// order. Disabled nodes still count — only the name list is consulted.
pub fn check_node_uniqueness(node_names: &[String]) -> Vec<ValidationError> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut errors = Vec::new();
    for (i, name) in node_names.iter().enumerate() {
        if seen.contains(name.as_str()) {
            errors.push(err(
                ValidationErrorCode::DuplicateNodeName,
                Some(name),
                Some(vec!["nodes", &i.to_string(), "name"]),
                format!("Duplicate node name \"{name}\""),
            ));
        }
        seen.insert(name.as_str());
    }
    errors
}

/// Reports dangling connections and unknown connection types, in insertion
/// order: unknown source node, unknown per-type key, malformed target
/// (missing/non-string `node`), unknown target node, and unknown per-target
/// `type`.
///
/// `connections` is walked as an [`OrderedValue`] so every guard in
/// `checkDanglingConnections` (`isObject`, `Array.isArray`, `?? []`) is
/// reproduced; a non-object value behaves as `{}`. [`validate_workflow`]
/// pre-validates the shape and reports `INVALID_INPUT` instead.
pub fn check_dangling_connections(
    node_names: &[String],
    connections: &OrderedValue,
) -> Vec<ValidationError> {
    let names: HashSet<&str> = node_names.iter().map(String::as_str).collect();
    let mut errors = Vec::new();
    let Some(by_source) = connections.as_object() else {
        return errors;
    };
    for (source, by_type) in by_source {
        if !names.contains(source.as_str()) {
            errors.push(err(
                ValidationErrorCode::DanglingConnection,
                Some(source),
                Some(vec!["connections", source]),
                format!("Connection from unknown node \"{source}\""),
            ));
        }
        let Some(by_type) = by_type.as_object() else {
            continue;
        };
        for (conn_type, outputs) in by_type {
            if !is_known_connection_type(conn_type) {
                errors.push(err(
                    ValidationErrorCode::InvalidConnectionType,
                    Some(source),
                    Some(vec!["connections", source, conn_type]),
                    format!("Unknown connection type \"{conn_type}\" on node \"{source}\""),
                ));
            }
            let Some(outputs) = outputs.as_array() else {
                continue;
            };
            for (oi, output) in outputs.iter().enumerate() {
                let empty = Vec::new();
                let targets = output.as_array().unwrap_or(&empty);
                for (ti, target) in targets.iter().enumerate() {
                    let oi_s = oi.to_string();
                    let ti_s = ti.to_string();
                    let path =
                        vec!["connections", source.as_str(), conn_type.as_str(), &oi_s, &ti_s];
                    let Some(target_node) = target.get("node").and_then(OrderedValue::as_str)
                    else {
                        errors.push(err(
                            ValidationErrorCode::DanglingConnection,
                            Some(source),
                            Some(path),
                            format!("Malformed connection target from \"{source}\""),
                        ));
                        continue;
                    };
                    if !names.contains(target_node) {
                        errors.push(err(
                            ValidationErrorCode::DanglingConnection,
                            Some(source),
                            Some(path.clone()),
                            format!(
                                "Connection from \"{source}\" to unknown node \"{target_node}\""
                            ),
                        ));
                    }
                    if let Some(target_type) =
                        target.get("type").and_then(OrderedValue::as_str)
                    {
                        if !is_known_connection_type(target_type) {
                            let mut type_path = path.clone();
                            type_path.push("type");
                            errors.push(err(
                                ValidationErrorCode::InvalidConnectionType,
                                Some(source),
                                Some(type_path),
                                format!(
                                    "Unknown connection type \"{target_type}\" on node \"{source}\""
                                ),
                            ));
                        }
                    }
                }
            }
        }
    }
    errors
}

struct DfsFrame {
    node: String,
    next: usize,
}

/// Reports the first `main`-only cycle as `CYCLE_DETECTED` with a
/// deterministic `A → B → A` path, or no errors when acyclic.
///
/// Iterative DFS with white/grey/black colouring over `main` edges only;
/// roots are visited in `nodes` order and edges in output/index order, so the
/// reported cycle is deterministic for a given workflow.
pub fn detect_cycles(
    node_names: &[String],
    connections: &OrderedValue,
) -> Vec<ValidationError> {
    // Owned keys: duplicate names collapse exactly like the TS `Map.set` overwrite.
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for name in node_names {
        adj.insert(name.clone(), Vec::new());
    }
    if let Some(by_source) = connections.as_object() {
        for (source, by_type) in by_source {
            let Some(outputs) = by_type.get("main").and_then(OrderedValue::as_array) else {
                continue;
            };
            if !adj.contains_key(source) {
                continue;
            }
            for output in outputs {
                let Some(targets) = output.as_array() else {
                    continue;
                };
                for target in targets {
                    if let Some(name) = target.get("node").and_then(OrderedValue::as_str) {
                        if adj.contains_key(name) {
                            adj.get_mut(source).expect("source known").push(name.to_owned());
                        }
                    }
                }
            }
        }
    }

    const WHITE: u8 = 0;
    const GREY: u8 = 1;
    const BLACK: u8 = 2;
    let mut color: HashMap<String, u8> = HashMap::new();
    for name in node_names {
        color.insert(name.clone(), WHITE);
    }

    for root in node_names {
        if color[root.as_str()] != WHITE {
            continue;
        }
        let mut stack = vec![DfsFrame { node: root.clone(), next: 0 }];
        let mut path_stack: Vec<String> = vec![root.clone()];
        color.insert(root.clone(), GREY);
        while let Some(frame) = stack.pop() {
            let edges_len = adj.get(&frame.node).map(Vec::len).unwrap_or(0);
            if frame.next < edges_len {
                let to = adj[&frame.node][frame.next].clone();
                stack.push(DfsFrame { node: frame.node.clone(), next: frame.next + 1 });
                let c = color[to.as_str()];
                if c == GREY {
                    let idx = path_stack
                        .iter()
                        .position(|n| n == &to)
                        .expect("grey node is always on the path stack");
                    let mut cycle: Vec<String> = path_stack[idx..].to_vec();
                    cycle.push(to.clone());
                    return vec![err(
                        ValidationErrorCode::CycleDetected,
                        Some(&to),
                        Some(vec!["connections", &frame.node, "main"]),
                        format!("Cycle detected: {}", cycle.join(" → ")),
                    )];
                }
                if c == WHITE {
                    color.insert(to.clone(), GREY);
                    stack.push(DfsFrame { node: to.clone(), next: 0 });
                    path_stack.push(to);
                }
            } else {
                color.insert(frame.node.clone(), BLACK);
                path_stack.pop();
            }
        }
    }
    Vec::new()
}

/// Validates a parsed workflow value: `{ valid, errors }`.
///
/// Malformed input (not an object, `nodes` not an array of named nodes, or
/// `connections` present but not an object) yields a single `INVALID_INPUT`
/// error instead of throwing. Otherwise all uniqueness and dangling errors
/// are accumulated, plus cycle detection when `allow_cycles` is `false`.
/// See [`validate_workflow_json`] for the JSON-text entry point.
pub fn validate_workflow(
    workflow: &OrderedValue,
    options: &ValidateOptions,
) -> ValidationReport {
    const NOT_NODES: &str = "Workflow must be an object with a `nodes` array of named nodes";
    let invalid_input = || ValidationReport {
        valid: false,
        errors: vec![err(ValidationErrorCode::InvalidInput, None, None, NOT_NODES.to_owned())],
    };
    let Some(obj) = workflow.as_object() else {
        return invalid_input();
    };
    let Some(nodes) = obj.get("nodes").and_then(OrderedValue::as_array) else {
        return invalid_input();
    };
    if !nodes
        .iter()
        .all(|n| n.get("name").and_then(OrderedValue::as_str).is_some())
    {
        return invalid_input();
    }
    if let Some(conns) = obj.get("connections") {
        if conns.as_object().is_none() {
            return ValidationReport {
                valid: false,
                errors: vec![err(
                    ValidationErrorCode::InvalidInput,
                    None,
                    Some(vec!["connections"]),
                    "`connections` must be an object".to_owned(),
                )],
            };
        }
    }

    let node_names: Vec<String> = nodes
        .iter()
        .map(|n| {
            n.get("name")
                .and_then(OrderedValue::as_str)
                .expect("names checked")
                .to_owned()
        })
        .collect();
    let null = OrderedValue::Null;
    let conns = obj.get("connections").unwrap_or(&null);
    let mut errors = check_node_uniqueness(&node_names);
    errors.extend(check_dangling_connections(&node_names, conns));
    if !options.allow_cycles {
        errors.extend(detect_cycles(&node_names, conns));
    }
    ValidationReport { valid: errors.is_empty(), errors }
}

/// Validates JSON text directly, parsing into [`OrderedValue`] so insertion
/// order survives. Text that is not valid JSON maps to the same single
/// `INVALID_INPUT` error as any other malformed input.
pub fn validate_workflow_json(text: &str, options: &ValidateOptions) -> ValidationReport {
    match serde_json::from_str::<OrderedValue>(text) {
        Ok(workflow) => validate_workflow(&workflow, options),
        Err(_) => ValidationReport {
            valid: false,
            errors: vec![err(
                ValidationErrorCode::InvalidInput,
                None,
                None,
                "Workflow must be an object with a `nodes` array of named nodes".to_owned(),
            )],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn parse(text: &str) -> OrderedValue {
        serde_json::from_str(text).expect("test JSON parses")
    }

    #[test]
    fn test_node_connection_types_match_reference() {
        assert_eq!(NODE_CONNECTION_TYPES.len(), 13);
        assert!(NODE_CONNECTION_TYPES.contains(&"main"));
        assert!(NODE_CONNECTION_TYPES.contains(&"ai_tool"));
        assert!(NODE_CONNECTION_TYPES.contains(&"ai_languageModel"));
        assert!(!NODE_CONNECTION_TYPES.contains(&"foo"));
    }

    #[test]
    fn test_default_options_allow_cycles() {
        assert!(ValidateOptions::default().allow_cycles);
    }

    #[test]
    fn test_ordered_value_keeps_document_order() {
        let v = parse(r#"{"z": 1, "a": {"y": 2, "b": 3}, "m": [3, 2]}"#);
        let keys: Vec<&str> = v
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, vec!["z", "a", "m"]);
        let inner: Vec<&str> = v
            .get("a")
            .expect("key a")
            .as_object()
            .expect("inner")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(inner, vec!["y", "b"]);
    }

    #[test]
    fn test_unique_nodes_ok() {
        assert!(check_node_uniqueness(&names(&["A", "B"])).is_empty());
    }

    #[test]
    fn test_duplicate_reports_second_index_path() {
        let errors = check_node_uniqueness(&names(&["Code", "Code"]));
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].code, ValidationErrorCode::DuplicateNodeName);
        assert_eq!(errors[0].node.as_deref(), Some("Code"));
        assert_eq!(
            errors[0].path,
            Some(vec!["nodes".to_owned(), "1".to_owned(), "name".to_owned()])
        );
    }

    #[test]
    fn test_collect_all_reports_uniqueness_and_dangling_together() {
        // TASK-408/VL4 pin: the normative source spreads both check parts
        // unconditionally (`workflow-rules.ts`: `[...checkNodeUniqueness(wf),
        // ...checkDanglingConnections(wf)]`), so a uniqueness error must not
        // suppress the dangling check. The mutation audit found no test
        // covering the co-occurrence (early-return mutant survived).
        let report = validate_workflow_json(
            r#"{"nodes": [{"name": "A"}, {"name": "A"}],
                "connections": {
                    "A": {"main": [[{"node": "Ghost", "type": "main", "index": 0}]]}}}"#,
            &ValidateOptions::default(),
        );
        assert!(!report.valid);
        let codes: Vec<ValidationErrorCode> = report.errors.iter().map(|e| e.code).collect();
        assert_eq!(
            codes,
            vec![
                ValidationErrorCode::DuplicateNodeName,
                ValidationErrorCode::DanglingConnection
            ]
        );
    }

    #[test]
    fn test_cycles_are_main_only() {
        let strict = ValidateOptions { allow_cycles: false };
        let report = validate_workflow_json(
            r#"{"nodes": [{"name": "A"}, {"name": "B"}],
                "connections": {
                    "A": {"ai_tool": [[{"node": "B", "type": "ai_tool", "index": 0}]]},
                    "B": {"ai_tool": [[{"node": "A", "type": "ai_tool", "index": 0}]]}}}"#,
            &strict,
        );
        assert_eq!(report, ValidationReport { valid: true, errors: vec![] });
    }

    #[test]
    fn test_malformed_input_never_panics() {
        let opts = ValidateOptions::default();
        for bad in [
            "\"garbage\"",
            "null",
            "{}",
            "{\"nodes\": \"x\"}",
            "{\"nodes\": [null]}",
            "{\"nodes\": []}",
            "not even json",
        ] {
            let _ = validate_workflow_json(bad, &opts);
        }
        assert!(!validate_workflow_json("\"garbage\"", &opts).valid);
        assert!(!validate_workflow_json("nope", &opts).valid);
        assert!(validate_workflow_json("{\"nodes\": []}", &opts).valid);
    }

    #[test]
    fn test_invalid_connections_shape_points_at_connections() {
        let report = validate_workflow_json(
            "{\"nodes\": [], \"connections\": []}",
            &ValidateOptions::default(),
        );
        assert!(!report.valid);
        assert_eq!(report.errors[0].code, ValidationErrorCode::InvalidInput);
        assert_eq!(report.errors[0].path, Some(vec!["connections".to_owned()]));
    }
}
