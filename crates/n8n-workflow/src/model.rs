//! Pure workflow domain model.
//!
//! Upstream behavioral reference: `reference/n8n/packages/workflow/src/workflow.ts`
//! (n8n v2.9.4). This module keeps only the PURE part of the original
//! `Workflow` class — data structures and deterministic graph accessors.
//!
//! Decoupling boundaries (docs/isolation/workflow_spec.md §4):
//! - Node type metadata (`INodeTypes`), expression evaluation, execution and
//!   persistence are NOT part of this model. They are separate LEGO
//!   components (node / expression / persistence) reached through explicit
//!   interfaces.
//!
//! Golden invariants enforced here:
//! - DETERMINISM: every container is a `BTreeMap`/`Vec` — the same graph
//!   input always yields the same adjacency structures and iteration order
//!   (lexicographic). No `HashMap` anywhere in this crate.
//! - ZERO SIDE EFFECTS: construction and queries never perform IO, HTTP,
//!   DB or file access and never touch global state.
//! - NON-DESTRUCTIVE: cycle detection and all queries are read-only.

use std::collections::BTreeMap;

use crate::cycles::{detect_cycles, find_cycle, CycleScope};
use crate::graph::{get_child_nodes_typed, get_parent_nodes_typed};
use crate::json::Json;
use crate::maps::{build_connection_maps, map_connections_by_destination};
use crate::start::get_start_nodes;

/// The default connection type, mirroring `NodeConnectionTypes.Main`
/// from `reference/n8n/packages/workflow/src/interfaces.ts`.
pub const MAIN: &str = "main";

/// A single connection entry (`IConnection` in n8n):
/// the destination node, the type of the destination input, and the
/// destination input index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connection {
    pub node: String,
    /// Renamed `type` → `type_` (Rust keyword). JSON field stays `type`.
    pub type_: String,
    pub index: usize,
}

/// `IConnections` from n8n: `node → type → sparse array over output index
/// of connection lists`.
///
/// - The output-index level is a `Vec<Option<...>>` so sparse indices are
///   preserved exactly like the JS object's integer-like keys (which may be
///   non-contiguous) and are always iterated in ascending numeric order.
/// - `BTreeMap` levels give deterministic (lexicographic) key iteration.
pub type Connections = BTreeMap<String, BTreeMap<String, Vec<Option<Vec<Connection>>>>>;

/// A pure node (`INode` reduced to the fields the graph domain needs).
///
/// `parameters`, `credentials`, `webhookId`, ... belong to the `node` LEGO
/// and are deliberately excluded from the pure model.
///
/// (No `Eq` derive: `type_version` is `f64` — `PartialEq` only.)
#[derive(Debug, Clone, PartialEq)]
pub struct INode {
    pub name: String,
    /// Renamed `type` → `r#type` (Rust keyword). JSON field stays `type`.
    pub r#type: String,
    pub type_version: f64,
    pub position: [i64; 2],
    pub disabled: bool,
}

/// Result of `build_connection_maps` (spec §3.1): the graph expressed both
/// from the source side and the destination side.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NodeConnectionMapping {
    pub by_source: Connections,
    pub by_destination: Connections,
}

/// Constructor input (spec §2 `WorkflowParameters`, pure subset).
#[derive(Debug, Clone, Default)]
pub struct WorkflowParameters {
    pub id: Option<String>,
    pub name: Option<String>,
    pub nodes: Vec<INode>,
    pub connections: Connections,
    pub active: bool,
    /// Opaque settings bag (e.g. `timezone`, `executionOrder`); typed access
    /// is provided via `Workflow::timezone`.
    pub settings: BTreeMap<String, Json>,
    /// Opaque static data bag (persistence LEGO serializes it).
    pub static_data: BTreeMap<String, Json>,
    /// Opaque pin data (node → pinned execution data), `None` when absent.
    pub pin_data: Option<BTreeMap<String, Json>>,
}

/// The pure `Workflow` domain model.
#[derive(Debug, Clone)]
pub struct Workflow {
    pub id: String,
    pub name: Option<String>,
    /// `name → INode` (`INodes` in n8n). BTreeMap ⇒ deterministic order.
    pub nodes: BTreeMap<String, INode>,
    pub connections_by_source_node: Connections,
    pub connections_by_destination_node: Connections,
    pub active: bool,
    pub settings: BTreeMap<String, Json>,
    pub static_data: BTreeMap<String, Json>,
    pub pin_data: Option<BTreeMap<String, Json>>,
    /// Original: `settings.timezone ?? getGlobalState().defaultTimezone`.
    /// Pure model: the global-state lookup is replaced by the constant
    /// `"DEFAULT"` (no global state may be read — zero side effects).
    pub timezone: String,
}

impl Workflow {
    /// Pure construction (spec §5: no IO, no HTTP, no DB, no global state).
    ///
    /// Mirrors `Workflow` constructor's node/connection bookkeeping:
    /// `setNodes` (index by name, last duplicate wins) and `setConnections`
    /// (store source map + derive destination map).
    ///
    /// The original also resolves node types, injects default parameters and
    /// builds an `Expression` engine — those are OUT of the pure model
    /// (LEGO `node` / `expression`).
    pub fn new(parameters: WorkflowParameters) -> Workflow {
        let WorkflowParameters {
            id,
            name,
            nodes,
            connections,
            active,
            settings,
            static_data,
            pin_data,
        } = parameters;

        let timezone = settings
            .get("timezone")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "DEFAULT".to_string());

        let mut wf = Workflow {
            id: id.unwrap_or_default(),
            name,
            nodes: BTreeMap::new(),
            connections_by_source_node: Connections::new(),
            connections_by_destination_node: Connections::new(),
            active: active || false,
            settings,
            static_data,
            pin_data,
            timezone,
        };
        wf.set_nodes(nodes);
        wf.set_connections(connections);
        wf
    }

    /// Save nodes as a map keyed by name (original `setNodes`).
    pub fn set_nodes(&mut self, nodes: Vec<INode>) {
        let mut map: BTreeMap<String, INode> = BTreeMap::new();
        for node in nodes {
            // Duplicate names: last one wins (same as the original object
            // assignment `this.nodes[node.name] = node`).
            map.insert(node.name.clone(), node);
        }
        self.nodes = map;
    }

    /// Store source connections and derive the destination mapping
    /// (original `setConnections`).
    pub fn set_connections(&mut self, connections: Connections) {
        // Derive first (immutable borrow), then move the source map in.
        let derived = map_connections_by_destination(&connections);
        self.connections_by_source_node = connections;
        self.connections_by_destination_node = derived;
    }

    /// Returns the node with the given name, or `None` (original `getNode`).
    pub fn get_node(&self, node_name: &str) -> Option<&INode> {
        get_node(&self.nodes, node_name)
    }

    /// All (transitive) children of a node, main connections, unlimited depth
    /// (original `getChildNodes`).
    pub fn get_child_nodes(&self, node_name: &str) -> Vec<String> {
        get_child_nodes_typed(&self.connections_by_source_node, node_name, MAIN, -1)
    }

    /// Children with explicit type/depth (original `getChildNodes(type, depth)`).
    pub fn get_child_nodes_typed(
        &self,
        node_name: &str,
        connection_type: &str,
        depth: i32,
    ) -> Vec<String> {
        get_child_nodes_typed(
            &self.connections_by_source_node,
            node_name,
            connection_type,
            depth,
        )
    }

    /// All (transitive) parents of a node, main connections, unlimited depth
    /// (original `getParentNodes`).
    pub fn get_parent_nodes(&self, node_name: &str) -> Vec<String> {
        get_parent_nodes_typed(&self.connections_by_destination_node, node_name, MAIN, -1)
    }

    /// Parents with explicit type/depth (original `getParentNodes(type, depth)`).
    pub fn get_parent_nodes_typed(
        &self,
        node_name: &str,
        connection_type: &str,
        depth: i32,
    ) -> Vec<String> {
        get_parent_nodes_typed(
            &self.connections_by_destination_node,
            node_name,
            connection_type,
            depth,
        )
    }

    /// Start nodes: nodes with no incoming MAIN connection (spec §3.6, pure
    /// definition — see `start.rs` docs). Deterministic sorted order.
    pub fn get_start_nodes(&self) -> Vec<&INode> {
        get_start_nodes(&self.nodes, &self.connections_by_destination_node)
    }

    /// Contract invariant (contracts/workflow.contract.md §2): the graph must
    /// be acyclic. Deterministic DFS, read-only.
    pub fn has_cycle(&self, scope: CycleScope) -> bool {
        detect_cycles(&self.connections_by_source_node, scope)
    }

    /// Deterministic cycle path (contract diagnostics), `None` when acyclic.
    pub fn find_cycle(&self, scope: CycleScope) -> Option<Vec<String>> {
        find_cycle(&self.connections_by_source_node, scope)
    }

    /// Original `Workflow.getConnectionsByDestination` (static).
    pub fn connections_by_destination(connections: &Connections) -> Connections {
        map_connections_by_destination(connections)
    }

    /// Spec §3.1: build the dual mapping from source connections.
    pub fn build_connection_maps(connections: &Connections) -> NodeConnectionMapping {
        build_connection_maps(connections)
    }
}

/// Free function (spec §3.2): `getNode(nodes, name)`.
pub fn get_node<'a>(nodes: &'a BTreeMap<String, INode>, name: &str) -> Option<&'a INode> {
    nodes.get(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(name: &str) -> INode {
        INode {
            name: name.to_string(),
            r#type: "n8n-nodes-base.code".to_string(),
            type_version: 2.0,
            position: [0, 0],
            disabled: false,
        }
    }

    fn conn(node: &str, index: usize) -> Connection {
        Connection {
            node: node.to_string(),
            type_: MAIN.to_string(),
            index,
        }
    }

    fn linear_connections() -> Connections {
        let mut a = BTreeMap::new();
        a.insert(MAIN.to_string(), vec![Some(vec![conn("B", 0)])]);
        let mut b = BTreeMap::new();
        b.insert(MAIN.to_string(), vec![Some(vec![conn("C", 0)])]);
        let mut conns = BTreeMap::new();
        conns.insert("A".to_string(), a);
        conns.insert("B".to_string(), b);
        conns
    }

    #[test]
    fn construction_is_pure_and_indexed() {
        let params = WorkflowParameters {
            id: Some("wf-1".to_string()),
            name: Some("Test".to_string()),
            nodes: vec![node("C"), node("A"), node("B")],
            connections: linear_connections(),
            active: false,
            ..Default::default()
        };
        let wf = Workflow::new(params);
        assert_eq!(wf.id, "wf-1");
        assert_eq!(wf.nodes.len(), 3);
        assert!(wf.get_node("A").is_some());
        assert!(wf.get_node("nope").is_none());
        assert_eq!(wf.timezone, "DEFAULT");
        // Destination map derived.
        assert!(wf.connections_by_destination_node.contains_key("B"));
        assert!(wf.connections_by_destination_node.contains_key("C"));
    }

    #[test]
    fn duplicate_node_names_last_wins() {
        let mut first = node("A");
        first.position = [1, 1];
        let mut second = node("A");
        second.position = [2, 2];
        let wf = Workflow::new(WorkflowParameters {
            nodes: vec![first, second],
            ..Default::default()
        });
        assert_eq!(wf.nodes.len(), 1);
        assert_eq!(wf.get_node("A").unwrap().position, [2, 2]);
    }

    #[test]
    fn graph_accessors_match_spec() {
        let wf = Workflow::new(WorkflowParameters {
            nodes: vec![node("A"), node("B"), node("C")],
            connections: linear_connections(),
            ..Default::default()
        });
        assert_eq!(wf.get_child_nodes("A"), vec!["C".to_string(), "B".to_string()]);
        assert_eq!(wf.get_child_nodes("B"), vec!["C".to_string()]);
        assert!(wf.get_child_nodes("C").is_empty());
        assert!(wf.get_parent_nodes("A").is_empty());
        assert_eq!(wf.get_parent_nodes("C"), vec!["A".to_string(), "B".to_string()]);
        let starts: Vec<String> = wf.get_start_nodes().iter().map(|n| n.name.clone()).collect();
        assert_eq!(starts, vec!["A".to_string()]);
        assert!(!wf.has_cycle(CycleScope::Main));
    }

    #[test]
    fn timezone_from_settings() {
        use crate::json::Json;
        let mut settings = BTreeMap::new();
        settings.insert(
            "timezone".to_string(),
            Json::Str("Asia/Jakarta".to_string()),
        );
        let wf = Workflow::new(WorkflowParameters {
            settings,
            ..Default::default()
        });
        assert_eq!(wf.timezone, "Asia/Jakarta");
    }
}
