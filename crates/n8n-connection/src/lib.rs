//! LEGO 03 — Connection Model (Rust port, Phase 3).
//!
//! Pure connection routing over `IConnections`: traversal (`getConnectedNodes` and its
//! `getChildNodes`/`getParentNodes` aliases), source↔destination inversion
//! (`mapConnectionsByDestination`), the graph utilities (`buildAdjacencyList`,
//! `getRootNodes`, `getLeafNodes`, `getInputEdges`, `getOutputEdges`, `hasPath`,
//! `parseExtractableSubgraphSelection`) and the connection diff (`compareConnections`).
//!
//! Every behaviour below was read off the reference sources, not guessed:
//!
//! | function | reference |
//! | :--- | :--- |
//! | `get_connected_nodes` (+ child/parent) | `common/get-connected-nodes.ts` (+ `get-child-nodes.ts`, `get-parent-nodes.ts`) |
//! | `map_connections_by_destination` | `common/map-connections-by-destination.ts` |
//! | `build_adjacency_list`, roots, leaves, edges, `has_path`, extractable | `graph/graph-utils.ts` |
//! | `compare_connections` | `connections-diff.ts` |
//!
//! Acceptance: `tests/connection_fixtures.rs` runs every pure probe of
//! `tests/reference/connection/*` (32 probes; the `wf.*` probes need the Workflow
//! aggregate and stay Agent 1's) plus the 9 `traversal` cases of
//! `tests/reference/workflow-rust/fixtures.json`. The connection fixtures were
//! pre-verified against the pinned reference runtime (32/32 match) before this
//! port was written, so they pin the reference — not this implementation.
//!
//! Quirks reproduced on purpose (each pinned by a fixture or a unit test):
//!
//! * traversal merges via unshift + splice, so a re-found node moves to the front
//!   and a node that is both a direct and an indirect child appears **twice**
//!   (`A→B, B→C, A→C` yields `[C, C, B]` — there is no dedup pass);
//! * `checkedNodes` is copied **per connection type** and is never extended within
//!   the sibling loop — only ancestors block, siblings do not;
//! * inversion keys the destination map by the **edge item's own `type`**, pads
//!   missing input indexes with `[]`, and records the *source* output key + index
//!   on the inverted edge;
//! * graph utilities (`has_path`, roots, leaves, extractable selection) evaluate
//!   **`main` edges only**, while the adjacency list itself keeps every type;
//! * `has_path` is a stack-based DFS over the adjacency list (not BFS over the maps).

use indexmap::{IndexMap, IndexSet};
use serde::{Deserialize, Serialize};

/// A single edge: `{ node, type, index }` on the wire.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ConnectionItem {
    pub node: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub index: usize,
}

/// One output slot; `null` entries are legal in n8n data and are skipped when traversed.
pub type ConnectionOutput = Option<Vec<ConnectionItem>>;

/// `{ "main": [[…], null, […]] }` — connection type to output lists.
pub type NodeConnections = IndexMap<String, Vec<ConnectionOutput>>;

/// `{ "NodeName": { "main": [[…]] } }` — source (or destination) node name to outputs.
/// An `IndexMap`, so JSON document order survives a parse.
pub type WorkflowConnections = IndexMap<String, NodeConnections>;

/// `Map<string, Set<IConnection>>` in the reference. The reference `Set` holds object
/// references, so it never dedups distinct edge literals — a `Vec` preserves exactly that.
pub type AdjacencyList = IndexMap<String, Vec<ConnectionItem>>;

/// Ordered node-name set (`Set<string>` in the reference, insertion-ordered).
pub type NodeSet = IndexSet<String>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionTypeFilter {
    Type(String),
    All,
    AllNonMain,
}

impl ConnectionTypeFilter {
    pub fn main() -> Self {
        Self::Type("main".to_string())
    }

    /// Parses the wire vocabulary used by the reference (`main`, `ALL`, `ALL_NON_MAIN`, any type).
    pub fn parse(value: &str) -> Self {
        match value {
            "ALL" => Self::All,
            "ALL_NON_MAIN" => Self::AllNonMain,
            other => Self::Type(other.to_string()),
        }
    }
}

impl Default for ConnectionTypeFilter {
    fn default() -> Self {
        Self::main()
    }
}

/// Port of `getConnectedNodes` (`common/get-connected-nodes.ts`).
/// `depth` is `-1` for unlimited; `depth == 0` yields `[]`.
/// `checked` is the incoming visited list (ancestors); each connection type starts
/// from a fresh copy of it.
pub fn get_connected_nodes(
    connections: &WorkflowConnections,
    node_name: &str,
    filter: &ConnectionTypeFilter,
    depth: i64,
    checked_incoming: Option<&[String]>,
) -> Vec<String> {
    let new_depth = if depth == -1 { -1 } else { depth - 1 };
    if depth == 0 {
        // Reached max depth
        return Vec::new();
    }

    let Some(node_outputs) = connections.get(node_name) else {
        // Node does not have connections of its own
        return Vec::new();
    };

    let types: Vec<String> = match filter {
        ConnectionTypeFilter::All => node_outputs.keys().cloned().collect(),
        ConnectionTypeFilter::AllNonMain => node_outputs
            .keys()
            .filter(|key| key.as_str() != "main")
            .cloned()
            .collect(),
        ConnectionTypeFilter::Type(name) => vec![name.clone()],
    };

    let mut return_nodes: Vec<String> = Vec::new();

    for type_name in types {
        let Some(output_lists) = node_outputs.get(&type_name) else {
            // Node does not have connections of the given type
            continue;
        };

        // Fresh copy per type: `ALL` can reach nodes `main` alone would have marked.
        let mut checked: Vec<String> = checked_incoming.map(|names| names.to_vec()).unwrap_or_default();
        if checked.iter().any(|name| name == node_name) {
            // Node got checked already before
            continue;
        }
        checked.push(node_name.to_string());

        for slot in output_lists {
            let Some(items) = slot else {
                continue;
            };
            for connection in items {
                if checked.iter().any(|name| name == &connection.node) {
                    // Node got checked already before
                    continue;
                }

                return_nodes.insert(0, connection.node.clone());

                let add_nodes = get_connected_nodes(
                    connections,
                    &connection.node,
                    filter,
                    new_depth,
                    Some(&checked),
                );

                // `for (i = addNodes.length; i--; )` walks back to front and unshifts
                // each name, splicing a previous occurrence so the order stays correct.
                for parent_node_name in add_nodes.iter().rev() {
                    if let Some(position) = return_nodes.iter().position(|name| name == parent_node_name) {
                        return_nodes.remove(position);
                    }
                    return_nodes.insert(0, parent_node_name.clone());
                }
            }
        }
    }

    return_nodes
}

/// Port of `getChildNodes`: traversal over the source-keyed map.
pub fn get_child_nodes(
    connections_by_source: &WorkflowConnections,
    node_name: &str,
    filter: &ConnectionTypeFilter,
    depth: i64,
) -> Vec<String> {
    get_connected_nodes(connections_by_source, node_name, filter, depth, None)
}

/// Port of `getParentNodes`: traversal over the destination-keyed map.
pub fn get_parent_nodes(
    connections_by_destination: &WorkflowConnections,
    node_name: &str,
    filter: &ConnectionTypeFilter,
    depth: i64,
) -> Vec<String> {
    get_connected_nodes(connections_by_destination, node_name, filter, depth, None)
}

/// Port of `mapConnectionsByDestination` (`common/map-connections-by-destination.ts`).
///
/// The destination map is keyed by the **edge item's own `type`** (not the source
/// output key); missing input indexes are padded with `[]`; the inverted edge keeps
/// the source output key as its `type` and the source output index as its `index`.
pub fn map_connections_by_destination(by_source: &WorkflowConnections) -> WorkflowConnections {
    let mut by_destination: WorkflowConnections = IndexMap::new();

    for (source_node, outputs) in by_source {
        for (connection_type, output_lists) in outputs {
            for (source_index, slot) in output_lists.iter().enumerate() {
                let Some(items) = slot else {
                    continue;
                };
                for connection in items {
                    let destination = by_destination.entry(connection.node.clone()).or_default();
                    let input_slots = destination.entry(connection.connection_type.clone()).or_default();

                    // JS: `maxIndex = length - 1; for (j = maxIndex; j < index; j++) push([])`
                    // → pads the array so that slot `index` exists.
                    while input_slots.len() <= connection.index {
                        input_slots.push(Some(Vec::new()));
                    }
                    // The reference `?.push`es: a missing slot is skipped silently.
                    // After padding the slot always exists, so this is total in practice.
                    if let Some(target_slot) = input_slots.get_mut(connection.index) {
                        target_slot.get_or_insert_with(Vec::new).push(ConnectionItem {
                            node: source_node.clone(),
                            connection_type: connection_type.clone(),
                            index: source_index,
                        });
                    }
                }
            }
        }
    }

    by_destination
}

/// Port of `buildAdjacencyList` (`graph/graph-utils.ts`).
/// Every connection type is included (filtering to `main` happens at the call sites).
pub fn build_adjacency_list(connections_by_source: &WorkflowConnections) -> AdjacencyList {
    let mut adjacency: AdjacencyList = IndexMap::new();
    for (source_node, outputs) in connections_by_source {
        for output_lists in outputs.values() {
            for slot in output_lists {
                let Some(items) = slot else {
                    continue;
                };
                for connection in items {
                    adjacency
                        .entry(source_node.clone())
                        .or_default()
                        .push(connection.clone());
                }
            }
        }
    }
    adjacency
}

/// Port of `getRootNodes`: selection members with no incoming `main` edge from another
/// member (self-edges excluded). Order follows `graph_ids`.
pub fn get_root_nodes(graph_ids: &NodeSet, adjacency: &AdjacencyList) -> Vec<String> {
    let mut inner: NodeSet = NodeSet::new();
    for node_id in graph_ids {
        if let Some(edges) = adjacency.get(node_id) {
            for edge in edges
                .iter()
                .filter(|edge| edge.connection_type == "main" && edge.node != *node_id)
            {
                inner.insert(edge.node.clone());
            }
        }
    }
    graph_ids
        .iter()
        .filter(|node_id| !inner.contains(*node_id))
        .cloned()
        .collect()
}

/// Port of `getLeafNodes`: selection members with no outgoing `main` edge to another
/// member (self-edges excluded). Order follows `graph_ids`.
pub fn get_leaf_nodes(graph_ids: &NodeSet, adjacency: &AdjacencyList) -> Vec<String> {
    let mut leaves = Vec::new();
    for node_id in graph_ids {
        let has_inner_main_target = adjacency
            .get(node_id)
            .map(|edges| {
                edges.iter().any(|edge| {
                    edge.connection_type == "main" && edge.node != *node_id && graph_ids.contains(&edge.node)
                })
            })
            .unwrap_or(false);
        if !has_inner_main_target {
            leaves.push(node_id.clone());
        }
    }
    leaves
}

/// Port of `getInputEdges`: `[from, edge]` pairs leading from outside the selection in.
pub fn get_input_edges(graph_ids: &NodeSet, adjacency: &AdjacencyList) -> Vec<(String, ConnectionItem)> {
    let mut result = Vec::new();
    for (from, edges) in adjacency {
        if graph_ids.contains(from) {
            continue;
        }
        for edge in edges {
            if graph_ids.contains(&edge.node) {
                result.push((from.clone(), edge.clone()));
            }
        }
    }
    result
}

/// Port of `getOutputEdges`: `[from, edge]` pairs leading from inside the selection out.
pub fn get_output_edges(graph_ids: &NodeSet, adjacency: &AdjacencyList) -> Vec<(String, ConnectionItem)> {
    let mut result = Vec::new();
    for (from, edges) in adjacency {
        if !graph_ids.contains(from) {
            continue;
        }
        for edge in edges {
            if !graph_ids.contains(&edge.node) {
                result.push((from.clone(), edge.clone()));
            }
        }
    }
    result
}

/// Port of `hasPath`: stack-based DFS over the adjacency list, **`main` edges only**.
/// `start == end` is `true` (the reference checks before visiting).
pub fn has_path(start: &str, end: &str, adjacency: &AdjacencyList) -> bool {
    let mut seen: NodeSet = NodeSet::new();
    let mut paths: Vec<String> = vec![start.to_string()];
    loop {
        let Some(next) = paths.pop() else {
            return false;
        };
        if next == end {
            return true;
        }
        seen.insert(next.clone());
        if let Some(edges) = adjacency.get(&next) {
            for edge in edges.iter().filter(|edge| edge.connection_type == "main") {
                if !seen.contains(&edge.node) {
                    paths.push(edge.node.clone());
                }
            }
        }
    }
}

/// `{ start?, end? }` — both absent serializes as `{}` like the reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtractableSelection {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub end: Option<String>,
}

/// The five `ExtractableErrorResult` shapes, keyed by `errorCode` exactly as wired.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "errorCode")]
pub enum ExtractableError {
    #[serde(rename = "Multiple Input Nodes")]
    MultipleInputNodes { nodes: Vec<String> },
    #[serde(rename = "Multiple Output Nodes")]
    MultipleOutputNodes { nodes: Vec<String> },
    #[serde(rename = "Input Edge To Non-Root Node")]
    InputEdgeToNonRootNode { node: String },
    #[serde(rename = "Output Edge From Non-Leaf Node")]
    OutputEdgeFromNonLeafNode { node: String },
    #[serde(rename = "No Continuous Path From Root To Leaf In Selection")]
    NoContinuousPath { start: String, end: String },
}

/// `ExtractableSubgraphData | ExtractableErrorResult[]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ExtractableResult {
    Selection(ExtractableSelection),
    Errors(Vec<ExtractableError>),
}

/// Port of `parseExtractableSubgraphSelection` (`graph/graph-utils.ts`).
pub fn parse_extractable_subgraph_selection(
    graph_ids: &NodeSet,
    adjacency: &AdjacencyList,
) -> ExtractableResult {
    let mut errors: Vec<ExtractableError> = Vec::new();

    // 0-1 input nodes (sub-node edges filtered: only `main` counts here).
    let input_edges = get_input_edges(graph_ids, adjacency);
    let input_nodes: NodeSet = input_edges
        .iter()
        .filter(|(_, edge)| edge.connection_type == "main")
        .map(|(_, edge)| edge.node.clone())
        .collect();
    // Supporting cases with one input and a loop back to it from within the selection.
    let mut root_nodes: NodeSet = get_root_nodes(graph_ids, adjacency).into_iter().collect();
    if root_nodes.is_empty() && input_nodes.len() == 1 {
        root_nodes = input_nodes.clone();
    }
    for input_node in input_nodes.iter().filter(|node| !root_nodes.contains(*node)) {
        errors.push(ExtractableError::InputEdgeToNonRootNode {
            node: input_node.clone(),
        });
    }
    let root_input_nodes: NodeSet = root_nodes
        .iter()
        .filter(|node| input_nodes.contains(*node))
        .cloned()
        .collect();
    if root_input_nodes.len() > 1 {
        errors.push(ExtractableError::MultipleInputNodes {
            nodes: root_input_nodes.iter().cloned().collect(),
        });
    }

    // 0-1 output nodes.
    let output_edges = get_output_edges(graph_ids, adjacency);
    let output_nodes: NodeSet = output_edges
        .iter()
        .filter(|(_, edge)| edge.connection_type == "main")
        .map(|(from, _)| from.clone())
        .collect();
    let mut leaf_nodes: NodeSet = get_leaf_nodes(graph_ids, adjacency).into_iter().collect();
    if leaf_nodes.is_empty() && output_nodes.len() == 1 {
        leaf_nodes = output_nodes.clone();
    }
    for output_node in output_nodes.iter().filter(|node| !leaf_nodes.contains(*node)) {
        errors.push(ExtractableError::OutputEdgeFromNonLeafNode {
            node: output_node.clone(),
        });
    }
    let leaf_output_nodes: NodeSet = leaf_nodes
        .iter()
        .filter(|node| output_nodes.contains(*node))
        .cloned()
        .collect();
    if leaf_output_nodes.len() > 1 {
        errors.push(ExtractableError::MultipleOutputNodes {
            nodes: leaf_output_nodes.iter().cloned().collect(),
        });
    }

    // Continuous path between input and output nodes, when both exist.
    let start = root_input_nodes.iter().next().cloned();
    let end = leaf_output_nodes.iter().next().cloned();
    if let (Some(start_name), Some(end_name)) = (start.clone(), end.clone()) {
        if !has_path(&start_name, &end_name, adjacency) {
            errors.push(ExtractableError::NoContinuousPath {
                start: start_name,
                end: end_name,
            });
        }
    }

    if errors.is_empty() {
        ExtractableResult::Selection(ExtractableSelection { start, end })
    } else {
        ExtractableResult::Errors(errors)
    }
}

/// One diffed edge: its position inside the output slot plus the edge itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffValue {
    pub index: usize,
    pub connection: ConnectionItem,
}

/// `{ sourceIndex, value }` — `value` is `null` in the reference type but never
/// `null` at runtime (both push sites always pass `{ index, connection }`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffEntry {
    #[serde(rename = "sourceIndex")]
    pub source_index: usize,
    pub value: DiffValue,
}

/// Connection type → entries of one node.
pub type InputDiff = IndexMap<String, Vec<DiffEntry>>;
/// Node name → input diffs.
pub type ConnectionsDiffMap = IndexMap<String, InputDiff>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ConnectionsDiff {
    pub added: ConnectionsDiffMap,
    pub removed: ConnectionsDiffMap,
}

/// Union of two maps' keys: `prev` order first, then `next`-only keys.
fn union_keys<V, W>(prev: &IndexMap<String, V>, next: &IndexMap<String, W>) -> Vec<String> {
    let mut keys: Vec<String> = prev.keys().cloned().collect();
    for key in next.keys() {
        if !prev.contains_key(key) {
            keys.push(key.clone());
        }
    }
    keys
}

/// One slot's edges keyed by serialised form. JS `Map.set` keeps an existing key's
/// position but takes the new value — duplicate edges in a slot collapse that way.
fn collect_slot(slot: Option<&Vec<ConnectionItem>>) -> Vec<(String, DiffValue)> {
    let mut entries: Vec<(String, DiffValue)> = Vec::new();
    for (index, connection) in slot.map(|list| list.as_slice()).unwrap_or(&[]).iter().enumerate() {
        let key = serde_json::to_string(connection).unwrap_or_default();
        let value = DiffValue {
            index,
            connection: connection.clone(),
        };
        match entries.iter_mut().find(|(existing, _)| *existing == key) {
            Some((_, slot)) => *slot = value,
            None => entries.push((key, value)),
        }
    }
    entries
}

/// Port of `compareConnections` (`connections-diff.ts`).
pub fn compare_connections(prev: &WorkflowConnections, next: &WorkflowConnections) -> ConnectionsDiff {
    let mut diff = ConnectionsDiff::default();

    for node_name in union_keys(prev, next) {
        // `prev[nodeName] ?? {}`
        let empty_node = NodeConnections::new();
        let prev_node = prev.get(&node_name).unwrap_or(&empty_node);
        let next_node = next.get(&node_name).unwrap_or(&empty_node);

        for input_name in union_keys(prev_node, next_node) {
            let prev_input = prev_node.get(&input_name);
            let next_input = next_node.get(&input_name);

            let max_length = prev_input
                .map(|lists| lists.len())
                .unwrap_or(0)
                .max(next_input.map(|lists| lists.len()).unwrap_or(0));

            for source_index in 0..max_length {
                let prev_connections = prev_input
                    .and_then(|lists| lists.get(source_index))
                    .and_then(|slot| slot.as_ref());
                let next_connections = next_input
                    .and_then(|lists| lists.get(source_index))
                    .and_then(|slot| slot.as_ref());

                let prev_map = collect_slot(prev_connections);
                let next_map = collect_slot(next_connections);

                for (key, value) in &next_map {
                    if !prev_map.iter().any(|(existing, _)| existing == key) {
                        diff.added
                            .entry(node_name.clone())
                            .or_default()
                            .entry(input_name.clone())
                            .or_default()
                            .push(DiffEntry {
                                source_index,
                                value: value.clone(),
                            });
                    }
                }

                for (key, value) in &prev_map {
                    if !next_map.iter().any(|(existing, _)| existing == key) {
                        diff.removed
                            .entry(node_name.clone())
                            .or_default()
                            .entry(input_name.clone())
                            .or_default()
                            .push(DiffEntry {
                                source_index,
                                value: value.clone(),
                            });
                    }
                }
            }
        }
    }

    diff
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge(node: &str) -> ConnectionItem {
        ConnectionItem {
            node: node.into(),
            connection_type: "main".into(),
            index: 0,
        }
    }

    fn source(outputs: &[(&str, Vec<ConnectionOutput>)]) -> WorkflowConnections {
        let mut connections = WorkflowConnections::new();
        for (node, lists) in outputs {
            let mut node_outputs = NodeConnections::new();
            node_outputs.insert("main".into(), lists.clone());
            connections.insert((*node).into(), node_outputs);
        }
        connections
    }

    #[test]
    fn linear_chain_reports_farthest_first() {
        // Trigger -> A -> B
        let conns = source(&[
            ("Trigger", vec![Some(vec![edge("A")])]),
            ("A", vec![Some(vec![edge("B")])]),
        ]);
        assert_eq!(
            get_connected_nodes(&conns, "Trigger", &ConnectionTypeFilter::default(), -1, None),
            vec!["B", "A"]
        );
    }

    #[test]
    fn diamond_keeps_reference_order() {
        // A -> B, A -> C, B -> D, C -> D — ground-truthed via node: [D, C, B].
        let conns = source(&[
            ("A", vec![Some(vec![edge("B")]), Some(vec![edge("C")])]),
            ("B", vec![Some(vec![edge("D")])]),
            ("C", vec![Some(vec![edge("D")])]),
        ]);
        assert_eq!(
            get_connected_nodes(&conns, "A", &ConnectionTypeFilter::default(), -1, None),
            vec!["D", "C", "B"]
        );
    }

    #[test]
    fn direct_and_indirect_child_appears_twice_like_the_reference() {
        // A -> B, B -> C, A -> C — ground-truthed via node: [C, C, B] (no dedup pass).
        let conns = source(&[
            ("A", vec![Some(vec![edge("B")]), Some(vec![edge("C")])]),
            ("B", vec![Some(vec![edge("C")])]),
        ]);
        assert_eq!(
            get_connected_nodes(&conns, "A", &ConnectionTypeFilter::default(), -1, None),
            vec!["C", "C", "B"]
        );
    }

    #[test]
    fn depth_zero_yields_nothing_and_depth_one_yields_direct_only() {
        let conns = source(&[
            ("Trigger", vec![Some(vec![edge("A")])]),
            ("A", vec![Some(vec![edge("B")])]),
        ]);
        let filter = ConnectionTypeFilter::default();
        assert!(get_connected_nodes(&conns, "Trigger", &filter, 0, None).is_empty());
        assert_eq!(
            get_connected_nodes(&conns, "Trigger", &filter, 1, None),
            vec!["A"]
        );
    }

    #[test]
    fn null_slot_skipped_and_destination_inversion_padded() {
        let mut by_source = WorkflowConnections::new();
        let mut src_outs = NodeConnections::new();
        // Slot 0 is null, slot 1 has connection to Dest
        src_outs.insert(
            "main".into(),
            vec![
                None,
                Some(vec![ConnectionItem {
                    node: "Dest".into(),
                    connection_type: "main".into(),
                    index: 1,
                }]),
            ],
        );
        by_source.insert("Src".into(), src_outs);

        let by_dest = map_connections_by_destination(&by_source);
        assert!(by_dest.contains_key("Dest"));
        let dest_slots = &by_dest["Dest"]["main"];
        // Slot 0 is padded with [], slot 1 carries the inverted edge.
        assert_eq!(dest_slots.len(), 2);
        assert_eq!(dest_slots[0], Some(vec![]));
        assert_eq!(
            dest_slots[1],
            Some(vec![ConnectionItem {
                node: "Src".into(),
                connection_type: "main".into(),
                index: 1
            }])
        );
    }

    #[test]
    fn inversion_keys_by_edge_type_not_source_key() {
        // Output key `main` but the edge item claims `ai_tool`: the destination
        // map must key by the item's own type (reference behaviour).
        let mut by_source = WorkflowConnections::new();
        let mut src_outs = NodeConnections::new();
        src_outs.insert(
            "main".into(),
            vec![Some(vec![ConnectionItem {
                node: "Agent".into(),
                connection_type: "ai_tool".into(),
                index: 0,
            }])],
        );
        by_source.insert("Tool".into(), src_outs);

        let by_dest = map_connections_by_destination(&by_source);
        assert!(by_dest["Agent"].contains_key("ai_tool"));
        assert!(!by_dest["Agent"].contains_key("main"));
        // …while the inverted edge keeps the source output key as its type.
        assert_eq!(by_dest["Agent"]["ai_tool"][0].as_ref().unwrap()[0].connection_type, "main");
    }

    #[test]
    fn has_path_ignores_non_main_edges() {
        // Model -ai_languageModel-> Agent: no MAIN path.
        let mut conns = WorkflowConnections::new();
        let mut outs = NodeConnections::new();
        outs.insert(
            "ai_languageModel".into(),
            vec![Some(vec![ConnectionItem {
                node: "Agent".into(),
                connection_type: "ai_languageModel".into(),
                index: 0,
            }])],
        );
        conns.insert("Model".into(), outs);
        let adj = build_adjacency_list(&conns);
        // …but the adjacency list itself keeps the edge.
        assert_eq!(adj["Model"].len(), 1);
        assert!(!has_path("Model", "Agent", &adj));
        assert!(has_path("Model", "Model", &adj));
    }
}
