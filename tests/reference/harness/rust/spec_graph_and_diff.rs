
// ===== spec §5 / §6 transcription (agent-3, out-of-tree experiment) =====
use indexmap::IndexSet;

pub type AdjacencyList = IndexMap<String, IndexSet<ConnectionItem>>;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(tag = "errorCode")]
pub enum ExtractableError {
    #[serde(rename = "Multiple Input Nodes")] MultipleInputNodes { nodes: Vec<String> },
    #[serde(rename = "Multiple Output Nodes")] MultipleOutputNodes { nodes: Vec<String> },
    #[serde(rename = "Input Edge To Non-Root Node")] InputEdgeToNonRootNode { node: String },
    #[serde(rename = "Output Edge From Non-Leaf Node")] OutputEdgeFromNonLeafNode { node: String },
    #[serde(rename = "No Continuous Path From Root To Leaf In Selection")] NoContinuousPath { start: String, end: String },
}
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq, Default)]
pub struct ExtractableSubgraphData {
    #[serde(skip_serializing_if = "Option::is_none")] pub start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub end: Option<String>,
}
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ExtractableSelection { Ok(ExtractableSubgraphData), Errors(Vec<ExtractableError>) }

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct DiffValue { pub index: usize, pub connection: ConnectionItem }
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct ConnectionEntry { #[serde(rename = "sourceIndex")] pub source_index: usize, pub value: Option<DiffValue> }
pub type NodeConnectionsDiff = IndexMap<String, Vec<ConnectionEntry>>;
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq, Default)]
pub struct ConnectionsDiff { pub added: IndexMap<String, NodeConnectionsDiff>, pub removed: IndexMap<String, NodeConnectionsDiff> }

fn union(a: &IndexSet<String>, b: &IndexSet<String>) -> IndexSet<String> { let mut r = a.clone(); r.extend(b.iter().cloned()); r }
fn intersection(a: &IndexSet<String>, b: &IndexSet<String>) -> IndexSet<String> { a.iter().filter(|x| b.contains(*x)).cloned().collect() }
fn difference(a: &IndexSet<String>, b: &IndexSet<String>) -> IndexSet<String> { a.iter().filter(|x| !b.contains(*x)).cloned().collect() }
fn main_targets(adj: &AdjacencyList, id: &str, exclude_self: bool) -> IndexSet<String> {
    adj.get(id).map(|s| s.iter().filter(|x| x.connection_type == "main" && (!exclude_self || x.node != id)).map(|x| x.node.clone()).collect()).unwrap_or_default()
}

pub fn build_adjacency_list(by_source: &WorkflowConnections) -> AdjacencyList {           // L170-204
    let mut adj = AdjacencyList::new();
    for (src, by_type) in by_source { for (_t, slots) in by_type { for slot in slots { for c in slot.iter().flatten() {
        adj.entry(src.clone()).or_default().insert(c.clone());
    }}}}
    adj
}
pub fn get_input_edges(g: &IndexSet<String>, adj: &AdjacencyList) -> Vec<(String, ConnectionItem)> {   // L41-56
    let mut r = Vec::new();
    for (from, tos) in adj { if g.contains(from) { continue; } for to in tos { if g.contains(&to.node) { r.push((from.clone(), to.clone())); } } }
    r
}
pub fn get_output_edges(g: &IndexSet<String>, adj: &AdjacencyList) -> Vec<(String, ConnectionItem)> {  // L62-76
    let mut r = Vec::new();
    for (from, tos) in adj { if !g.contains(from) { continue; } for to in tos { if !g.contains(&to.node) { r.push((from.clone(), to.clone())); } } }
    r
}
pub fn get_root_nodes(g: &IndexSet<String>, adj: &AdjacencyList) -> IndexSet<String> {   // L103-118
    let mut inner = IndexSet::new();
    for id in g { inner = union(&inner, &main_targets(adj, id, true)); }
    difference(g, &inner)
}
pub fn get_leaf_nodes(g: &IndexSet<String>, adj: &AdjacencyList) -> IndexSet<String> {   // L123-140
    g.iter().filter(|id| intersection(&main_targets(adj, id, true), g).is_empty()).cloned().collect()
}
pub fn has_path_adj(start: &str, end: &str, adj: &AdjacencyList) -> bool {                // L145-160
    let mut seen: IndexSet<String> = IndexSet::new();
    let mut paths: Vec<String> = vec![start.to_string()];
    loop {
        let Some(next) = paths.pop() else { return false; };
        if next == end { return true; }
        seen.insert(next.clone());
        paths.extend(difference(&main_targets(adj, &next, false), &seen));
    }
}
pub fn parse_extractable_subgraph_selection(g: &IndexSet<String>, adj: &AdjacencyList) -> ExtractableSelection { // L209-273
    let mut errors = Vec::new();
    let input_nodes: IndexSet<String> = get_input_edges(g, adj).iter().filter(|e| e.1.connection_type == "main").map(|e| e.1.node.clone()).collect();
    let mut roots = get_root_nodes(g, adj);
    if roots.is_empty() && input_nodes.len() == 1 { roots = input_nodes.clone(); }
    for n in difference(&input_nodes, &roots) { errors.push(ExtractableError::InputEdgeToNonRootNode { node: n }); }
    let root_input = intersection(&roots, &input_nodes);
    if root_input.len() > 1 { errors.push(ExtractableError::MultipleInputNodes { nodes: root_input.iter().cloned().collect() }); }
    let output_nodes: IndexSet<String> = get_output_edges(g, adj).iter().filter(|e| e.1.connection_type == "main").map(|e| e.0.clone()).collect();
    let mut leaves = get_leaf_nodes(g, adj);
    if leaves.is_empty() && output_nodes.len() == 1 { leaves = output_nodes.clone(); }
    for n in difference(&output_nodes, &leaves) { errors.push(ExtractableError::OutputEdgeFromNonLeafNode { node: n }); }
    let leaf_output = intersection(&leaves, &output_nodes);
    if leaf_output.len() > 1 { errors.push(ExtractableError::MultipleOutputNodes { nodes: leaf_output.iter().cloned().collect() }); }
    let start = root_input.first().cloned();
    let end = leaf_output.first().cloned();
    if let (Some(s), Some(e)) = (&start, &end) { if !has_path_adj(s, e, adj) { errors.push(ExtractableError::NoContinuousPath { start: s.clone(), end: e.clone() }); } }
    if errors.is_empty() { ExtractableSelection::Ok(ExtractableSubgraphData { start, end }) } else { ExtractableSelection::Errors(errors) }
}
pub fn compare_connections(prev: &WorkflowConnections, next: &WorkflowConnections) -> ConnectionsDiff { // connections-diff.ts L15-87
    let mut out = ConnectionsDiff::default();
    let empty_nc = NodeConnections::new();
    let mut all_nodes: IndexSet<&String> = prev.keys().collect(); all_nodes.extend(next.keys());
    for node in all_nodes {
        let p = prev.get(node).unwrap_or(&empty_nc); let n = next.get(node).unwrap_or(&empty_nc);
        let mut all_types: IndexSet<&String> = p.keys().collect(); all_types.extend(n.keys());
        for t in all_types {
            let ps = p.get(t).cloned().unwrap_or_default(); let ns = n.get(t).cloned().unwrap_or_default();
            for si in 0..ps.len().max(ns.len()) {
                let pc = ps.get(si).cloned().flatten().unwrap_or_default();
                let nc = ns.get(si).cloned().flatten().unwrap_or_default();
                let pm: IndexMap<String, DiffValue> = pc.iter().enumerate().map(|(i, c)| (serde_json::to_string(c).unwrap(), DiffValue { index: i, connection: c.clone() })).collect();
                let nm: IndexMap<String, DiffValue> = nc.iter().enumerate().map(|(i, c)| (serde_json::to_string(c).unwrap(), DiffValue { index: i, connection: c.clone() })).collect();
                for (k, v) in &nm { if !pm.contains_key(k) { out.added.entry(node.clone()).or_default().entry(t.clone()).or_default().push(ConnectionEntry { source_index: si, value: Some(v.clone()) }); } }
                for (k, v) in &pm { if !nm.contains_key(k) { out.removed.entry(node.clone()).or_default().entry(t.clone()).or_default().push(ConnectionEntry { source_index: si, value: Some(v.clone()) }); } }
            }
        }
    }
    out
}
