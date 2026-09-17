//! Graph utilities, ported from `reference/n8n/packages/workflow/src/graph/graph-utils.ts`
//! (n8n 2.9.4) — the Connection LEGO's extractable-subgraph machinery.
//!
//! Fidelity notes (behaviour that looks odd but is pinned by the golden probes in
//! `tests/reference/connection/*`):
//!
//! * the adjacency list is keyed by **source** node in first-insertion order and each
//!   target list dedupes exact `(node, type, index)` triples while preserving insert order
//!   (JS `Map<string, Set<IConnection>>` + `union`);
//! * `get_root_nodes` collects **all** main non-self targets of graph members — targets
//!   outside the graph still mark the source as non-root (this is what makes `IF` the root
//!   of `{IF,A,B,Merge}`);
//! * `has_path` walks `main` edges only, with a stack: pop → end-check → mark seen → push
//!   unseen targets (a node may sit on the stack twice — reproduced);
//! * `parse_extractable_subgraph_selection` tolerates a loop back into the single input
//!   (`rootNodes` empty + exactly one input node → that node is the root) and mirrors the
//!   reference's error order: input errors, then output errors, then the path error;
//! * error payloads serialise with the reference's wire names (`errorCode`, `node`,
//!   `nodes`, `start`, `end`).

use crate::ConnectionItem;
use indexmap::{IndexMap, IndexSet};
use serde::Serialize;
use std::collections::HashSet;

/// `IConnectionAdjacencyList = Map<string, Set<IConnection>>` with JS iteration order.
pub type ConnectionAdjacencyList = IndexMap<String, Vec<ConnectionItem>>;

/// `ExtractableSubgraphData` — `undefined` fields are absent on the wire (JS drops them).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExtractableSubgraphData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
}

/// One element of the `ExtractableErrorResult` union. `error_code` carries the reference's
/// exact sentence; unused payload fields are omitted, field order mirrors the reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExtractableError {
    #[serde(rename = "errorCode")]
    pub error_code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
}

/// `ExtractableSubgraphData | ExtractableErrorResult[]` — untagged, so JSON is either the
/// `{start?, end?}` object or the bare errors array.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum ExtractableResult {
    Data(ExtractableSubgraphData),
    Errors(Vec<ExtractableError>),
}

/// JS `Set`-style helper: insert at the end unless already present.
fn insert_ordered(target: &mut Vec<String>, value: String) {
    if !target.contains(&value) {
        target.push(value);
    }
}

fn to_ordered_set(values: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for value in values {
        insert_ordered(&mut out, value.clone());
    }
    out
}

fn difference_order(minuend: &[String], subtrahend: &HashSet<&str>) -> Vec<String> {
    minuend
        .iter()
        .filter(|value| !subtrahend.contains(value.as_str()))
        .cloned()
        .collect()
}

/// `buildAdjacencyList` (`graph-utils.ts:170-207`): over `connectionsBySourceNode`, all
/// types, null slots skipped, exact duplicates deduped, insertion order preserved.
pub fn build_adjacency_list(
    connections_by_source_node: &crate::WorkflowConnections,
) -> ConnectionAdjacencyList {
    let mut result: ConnectionAdjacencyList = IndexMap::new();
    for (source_node, by_type) in connections_by_source_node.iter() {
        for lists in by_type.values() {
            for slot in lists {
                let Some(items) = slot else { continue };
                for connection in items {
                    let entry = result
                        .entry(source_node.clone())
                        .or_default();
                    if !entry.contains(connection) {
                        entry.push(connection.clone());
                    }
                }
            }
        }
    }
    result
}

/// `getInputEdges` (`graph-utils.ts:41-60`): edges from outside the selection into it.
/// No type filter here — that happens at the call sites that need it.
pub fn get_input_edges(
    graph_ids: &IndexSet<String>,
    adjacency_list: &ConnectionAdjacencyList,
) -> Vec<(String, ConnectionItem)> {
    let mut result = Vec::new();
    for (from, tos) in adjacency_list.iter() {
        if graph_ids.contains(from) {
            continue;
        }
        for to in tos {
            if graph_ids.contains(&to.node) {
                result.push((from.clone(), to.clone()));
            }
        }
    }
    result
}

/// `getOutputEdges` (`graph-utils.ts:62-81`): edges from inside the selection out of it.
pub fn get_output_edges(
    graph_ids: &IndexSet<String>,
    adjacency_list: &ConnectionAdjacencyList,
) -> Vec<(String, ConnectionItem)> {
    let mut result = Vec::new();
    for (from, tos) in adjacency_list.iter() {
        if !graph_ids.contains(from) {
            continue;
        }
        for to in tos {
            if !graph_ids.contains(&to.node) {
                result.push((from.clone(), to.clone()));
            }
        }
    }
    result
}

/// Main-type, non-self targets of `node_id` (the filter both root/leaf helpers apply).
fn main_targets_excluding_self(
    node_id: &str,
    adjacency_list: &ConnectionAdjacencyList,
) -> Vec<String> {
    adjacency_list
        .get(node_id)
        .map(|tos| {
            tos.iter()
                .filter(|to| to.connection_type == "main" && to.node != node_id)
                .map(|to| to.node.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// `getRootNodes` (`graph-utils.ts:103-121`): graph members that are not the target of a
/// `main` edge from another graph member. Targets outside the graph still disqualify.
pub fn get_root_nodes(
    graph_ids: &IndexSet<String>,
    adjacency_list: &ConnectionAdjacencyList,
) -> Vec<String> {
    let mut inner_nodes: Vec<String> = Vec::new();
    for node_id in graph_ids {
        for target in main_targets_excluding_self(node_id, adjacency_list) {
            insert_ordered(&mut inner_nodes, target);
        }
    }
    let inner: HashSet<&str> = inner_nodes.iter().map(String::as_str).collect();
    let ordered_ids: Vec<String> = graph_ids.iter().cloned().collect();
    difference_order(&ordered_ids, &inner)
}

/// `getLeafNodes` (`graph-utils.ts:123-143`): graph members whose `main` non-self targets
/// intersected with the selection are empty.
pub fn get_leaf_nodes(
    graph_ids: &IndexSet<String>,
    adjacency_list: &ConnectionAdjacencyList,
) -> Vec<String> {
    let mut result = Vec::new();
    for node_id in graph_ids {
        let targets: Vec<String> = main_targets_excluding_self(node_id, adjacency_list);
        let inside: Vec<String> = targets
            .into_iter()
            .filter(|target| graph_ids.contains(target))
            .collect();
        if inside.is_empty() {
            result.push(node_id.clone());
        }
    }
    result
}

/// `hasPath` (`graph-utils.ts:145-166`): stack walk over `main` edges. Pop → end check →
/// mark seen → push unseen targets. Exactly the reference's order of operations, including
/// `start == end` being true on the first pop.
pub fn has_path(start: &str, end: &str, adjacency_list: &ConnectionAdjacencyList) -> bool {
    let mut seen: HashSet<String> = HashSet::new();
    let mut paths: Vec<String> = vec![start.to_string()];
    loop {
        let Some(next) = paths.pop() else {
            return false;
        };
        if next == end {
            return true;
        }
        seen.insert(next.clone());
        if let Some(tos) = adjacency_list.get(&next) {
            for to in tos {
                if to.connection_type == "main" && !seen.contains(&to.node) {
                    paths.push(to.node.clone());
                }
            }
        }
    }
}

/// `parseExtractableSubgraphSelection` (`graph-utils.ts:209-302`).
pub fn parse_extractable_subgraph_selection(
    graph_ids: &IndexSet<String>,
    adjacency_list: &ConnectionAdjacencyList,
) -> ExtractableResult {
    let mut errors: Vec<ExtractableError> = Vec::new();

    // 0-1 Input nodes
    let input_edges = get_input_edges(graph_ids, adjacency_list);
    // This filters out e.g. sub-nodes, which are technically parents
    let input_nodes: Vec<String> = {
        let mut nodes = Vec::new();
        for (_, connection) in &input_edges {
            if connection.connection_type == "main" {
                insert_ordered(&mut nodes, connection.node.clone());
            }
        }
        nodes
    };
    let mut root_nodes = get_root_nodes(graph_ids, adjacency_list);

    // This enables supporting cases where we have one input and a loop back to it
    // from within the selection
    if root_nodes.is_empty() && input_nodes.len() == 1 {
        root_nodes = input_nodes.clone();
    }
    let root_set: HashSet<&str> = root_nodes.iter().map(String::as_str).collect();
    for input_node in difference_order(&input_nodes, &root_set) {
        errors.push(ExtractableError {
            error_code: "Input Edge To Non-Root Node",
            node: Some(input_node),
            nodes: None,
            start: None,
            end: None,
        });
    }
    let input_set: HashSet<&str> = input_nodes.iter().map(String::as_str).collect();
    let root_input_nodes: Vec<String> = root_nodes
        .iter()
        .filter(|node| input_set.contains(node.as_str()))
        .cloned()
        .collect();
    if root_input_nodes.len() > 1 {
        errors.push(ExtractableError {
            error_code: "Multiple Input Nodes",
            node: None,
            nodes: Some(root_input_nodes.clone()),
            start: None,
            end: None,
        });
    }

    // 0-1 Output nodes
    let output_edges = get_output_edges(graph_ids, adjacency_list);
    let output_nodes: Vec<String> = {
        let mut nodes = Vec::new();
        for (from, connection) in &output_edges {
            if connection.connection_type == "main" {
                insert_ordered(&mut nodes, from.clone());
            }
        }
        nodes
    };
    let mut leaf_nodes = get_leaf_nodes(graph_ids, adjacency_list);
    // If we have no leaf nodes, and only one output node, we can tolerate this output node
    // and connect to it.
    if leaf_nodes.is_empty() && output_nodes.len() == 1 {
        leaf_nodes = output_nodes.clone();
    }

    let leaf_set: HashSet<&str> = leaf_nodes.iter().map(String::as_str).collect();
    for output_node in difference_order(&output_nodes, &leaf_set) {
        errors.push(ExtractableError {
            error_code: "Output Edge From Non-Leaf Node",
            node: Some(output_node),
            nodes: None,
            start: None,
            end: None,
        });
    }

    let output_node_set: HashSet<&str> = output_nodes.iter().map(String::as_str).collect();
    let leaf_output_nodes: Vec<String> = leaf_nodes
        .iter()
        .filter(|node| output_node_set.contains(node.as_str()))
        .cloned()
        .collect();
    if leaf_output_nodes.len() > 1 {
        errors.push(ExtractableError {
            error_code: "Multiple Output Nodes",
            node: None,
            nodes: Some(leaf_output_nodes.clone()),
            start: None,
            end: None,
        });
    }

    let start = root_input_nodes.first().cloned();
    let end = leaf_output_nodes.first().cloned();

    if let (Some(start), Some(end)) = (&start, &end) {
        if !has_path(start, end, adjacency_list) {
            errors.push(ExtractableError {
                error_code: "No Continuous Path From Root To Leaf In Selection",
                node: None,
                nodes: None,
                start: Some(start.clone()),
                end: Some(end.clone()),
            });
        }
    }

    if errors.is_empty() {
        ExtractableResult::Data(ExtractableSubgraphData { start, end })
    } else {
        ExtractableResult::Errors(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WorkflowConnections;

    /// Golden trace of `tests/reference/connection/04-cycle` (pinned against the runtime):
    /// the Merge<->Loop workflow with an IF fan-out, an AI sub-chain and a sparse source.
    fn cycle_case() -> (IndexSet<String>, ConnectionAdjacencyList) {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/reference/connection/04-cycle/case.json"
        ))
        .expect("04-cycle case.json");
        let case: serde_json::Value = serde_json::from_str(&text).expect("valid JSON");
        let connections: WorkflowConnections =
            serde_json::from_value(case["connections"].clone()).expect("connections");
        (
            IndexSet::new(),
            build_adjacency_list(&connections),
        )
    }

    fn graph(ids: &[&str]) -> IndexSet<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    #[test]
    fn has_path_walks_main_edges_only_and_terminates_on_cycles() {
        let (_, adj) = cycle_case();
        // pinned: "hasPath Merge->Merge via Loop" → true
        assert!(has_path("Loop", "Merge", &adj));
        assert!(has_path("Merge", "Loop", &adj));
        // pinned (03-connection-types): "hasPath Model->Agent ignores non-main" → false
        assert!(!has_path("Model", "Agent", &adj));
        assert!(has_path("Model", "Model", &adj));
    }

    #[test]
    fn root_and_leaf_nodes_follow_the_reference_definitions() {
        let (_, adj) = cycle_case();
        // pinned (02-multi-output): "root nodes of {IF,A,B,Merge}" → ["IF"]
        assert_eq!(
            get_root_nodes(&graph(&["IF", "A", "B", "Merge"]), &adj),
            vec!["IF".to_string()]
        );
        // pinned: "leaf nodes of {IF,A,B,Merge}" → ["B", "Merge"]
        assert_eq!(
            get_leaf_nodes(&graph(&["IF", "A", "B", "Merge"]), &adj),
            vec!["B".to_string(), "Merge".to_string()]
        );
    }

    #[test]
    fn extractable_traces_match_the_pinned_probes() {
        let (_, adj) = cycle_case();

        // pinned: "extractable {Merge,Loop}" → {"start":"Merge","end":"Loop"}
        // (Loop's back-edge into Merge is tolerated: rootNodes empty + 1 input node)
        assert_eq!(
            parse_extractable_subgraph_selection(&graph(&["Merge", "Loop"]), &adj),
            ExtractableResult::Data(ExtractableSubgraphData {
                start: Some("Merge".into()),
                end: Some("Loop".into()),
            })
        );

        // pinned: "extractable {A}" → {"start":"A","end":"A"}
        assert_eq!(
            parse_extractable_subgraph_selection(&graph(&["A"]), &adj),
            ExtractableResult::Data(ExtractableSubgraphData {
                start: Some("A".into()),
                end: Some("A".into()),
            })
        );

        // pinned: "extractable {IF,A} output from non-leaf" → [Output Edge From Non-Leaf IF]
        assert_eq!(
            parse_extractable_subgraph_selection(&graph(&["IF", "A"]), &adj),
            ExtractableResult::Errors(vec![ExtractableError {
                error_code: "Output Edge From Non-Leaf Node",
                node: Some("IF".into()),
                nodes: None,
                start: None,
                end: None,
            }])
        );

        // pinned: "extractable {A,B} multiple inputs" → [Multiple Input Nodes [A,B]]
        assert_eq!(
            parse_extractable_subgraph_selection(&graph(&["A", "B"]), &adj),
            ExtractableResult::Errors(vec![ExtractableError {
                error_code: "Multiple Input Nodes",
                node: None,
                nodes: Some(vec!["A".into(), "B".into()]),
                start: None,
                end: None,
            }])
        );
    }

    #[test]
    fn input_and_output_edges_match_the_pinned_probes() {
        let (_, adj) = cycle_case();
        let ids = graph(&["A", "Merge"]);

        let input_edges = get_input_edges(&ids, &adj);
        let inputs: Vec<(String, String, usize)> = input_edges
            .iter()
            .map(|(from, to)| (from.clone(), to.node.clone(), to.index))
            .collect();
        assert_eq!(
            inputs,
            vec![
                ("IF".to_string(), "A".to_string(), 0),
                ("IF".to_string(), "Merge".to_string(), 1),
                ("Loop".to_string(), "Merge".to_string(), 0),
            ]
        );

        let output_edges = get_output_edges(&ids, &adj);
        let outputs: Vec<(String, String)> = output_edges
            .iter()
            .map(|(from, to)| (from.clone(), to.node.clone()))
            .collect();
        assert_eq!(outputs, vec![("Merge".to_string(), "Loop".to_string())]);
    }

    #[test]
    fn to_ordered_set_dedupes_preserving_first_occurrence() {
        assert_eq!(
            to_ordered_set(&["a".into(), "b".into(), "a".into()]),
            vec!["a".to_string(), "b".to_string()]
        );
    }
}
