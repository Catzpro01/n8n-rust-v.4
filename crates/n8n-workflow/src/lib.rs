//! LEGO 01 — Workflow Model (Rust port, Phase 3).
//!
//! The port is driven by `tests/reference/workflow-rust/fixtures.json`, which is derived from the
//! pinned n8n runtime (`build-fixtures.mjs --check` re-derives it). Every behaviour below was read
//! off the reference sources, not guessed — including the ones that look like bugs and are
//! reproduced on purpose (see the module docs of `traversal`, `rename` and `ordered`).
//!
//! Frozen surface (15 symbols, `contracts/workflow.contract.md` §6): `getNode`, `getNodes`,
//! `getChildNodes`, `getParentNodes`, `getConnectedNodes`, `getStartNode`, `setNodes`,
//! `setConnections`, `renameNode`, `getTimezone`, `calculateWorkflowChecksum`,
//! `compareConnections` plus the three connection/node helpers. Rust naming:
//!
//! | reference | port |
//! | :--- | :--- |
//! | `getNode(name)` | [`Workflow::get_node`] |
//! | `getNodes(names)` | [`Workflow::get_nodes`] |
//! | `getChildNodes(name, type, depth)` | [`Workflow::get_child_nodes`] |
//! | `getParentNodes(name, type, depth)` | [`Workflow::get_parent_nodes`] |
//! | `getConnectedNodes(name, type, depth)` | [`Workflow::get_connected_nodes`] |
//! | `getStartNode(destination?)` | [`Workflow::get_start_node`] |
//! | `setNodes(nodes)` / `setConnections(c)` | [`Workflow::set_nodes`] / [`Workflow::set_connections`] |
//! | `renameNode(current, new)` | [`Workflow::rename_node`] |
//! | `timezone` getter | [`Workflow::get_timezone`] |
//! | `calculateWorkflowChecksum(snapshot)` | [`calculate_workflow_checksum`] |
//! | `compareConnections(prev, next)` | [`compare_connections`] |
//!
//! Documented divergence: `getStartNode` reproduces the reference's candidate walk,
//! single-candidate rule, `STARTING_NODE_TYPES` scan and fallback, but not the trigger/poll
//! loop (`workflow.ts:828-844`) which needs the node-type registry the Workflow LEGO does not
//! own; see `docs/isolation/workflow-rust-port-review.md` §6.

pub mod checksum;
pub mod connections;
pub mod diff;
pub mod ordered;
pub mod rename;
pub mod traversal;

pub use checksum::calculate_workflow_checksum;
pub use connections::{
    map_connections_by_destination, Connection, Connections, NodeOutputs, OutputLists,
};
pub use diff::{compare_connections, ConnectionsDiff};
pub use n8n_common::IDataObject;
pub use n8n_node_model::{INode, INodeParameters};
pub use ordered::OrderedMap;
pub use rename::{is_restricted_node_name, WorkflowError};
pub use traversal::{get_connected_nodes, ConnectionTypeFilter};

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};

/// Result of `getNodeConnectionIndexes` (`workflow.ts:793-798`). Field names are the wire
/// names of the reference (`sourceIndex` / `destinationIndex`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NodeConnectionIndexes {
    #[serde(rename = "sourceIndex")]
    pub source_index: usize,
    #[serde(rename = "destinationIndex")]
    pub destination_index: usize,
}

/// `IConnectedNode` (`interfaces.ts`) — the reference's misspelled field `indicies`
/// is reproduced verbatim, including the JSON serialization order `name, indicies, depth`
/// (pinned by the `getParentNodesByDepth` probes).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IConnectedNode {
    pub name: String,
    pub indicies: Vec<usize>,
    pub depth: u32,
}

/// The reference keeps settings as an open bag (`IWorkflowSettings` plus unknown keys that are
/// passed through untouched — language-server additions, `executionOrder`, …), so the port keeps
/// them verbatim instead of modelling a closed struct.
pub type WorkflowSettings = Value;

/// Reference default: `getGlobalState().defaultTimezone` as resolved by the pinned runtime the
/// fixtures were derived from. Kept as a constant so the port is deterministic instead of
/// depending on the host's `TZ`/`Intl` data.
pub const DEFAULT_TIMEZONE: &str = "America/New_York";

/// `STARTING_NODE_TYPES` verbatim from n8n 2.9.4
/// (`reference/n8n/packages/workflow/src/constants.ts:53`) — the order is behavioural:
/// `getStartNode` scans nodes sorted by their index in this list (missing types sort first,
/// as `indexOf` returns `-1`).
pub const START_NODE_TYPES: [&str; 5] = [
    "n8n-nodes-base.manualTrigger",
    "n8n-nodes-base.executeWorkflowTrigger",
    "n8n-nodes-base.errorTrigger",
    "n8n-nodes-base.evaluationTrigger",
    "n8n-nodes-base.formTrigger",
];

#[derive(Debug, Clone, PartialEq)]
pub struct Workflow {
    pub id: Option<String>,
    pub name: Option<String>,
    pub active: bool,
    /// Open settings bag; defaults to `{}` (reference: `this.settings.timezone ?? …`).
    pub settings: WorkflowSettings,
    /// Defaults to `{}` — observable, see the `golden-01-empty` fixture.
    pub static_data: Value,
    pub pin_data: Option<Value>,
    pub meta: Option<Value>,
    pub timezone: String,

    /// Name-keyed map with JS-object key semantics (see [`ordered::OrderedMap`]).
    nodes: OrderedMap<INode>,
    /// As wired: `connections[source][type][outputIndex] = [edges]`.
    pub connections_by_source_node: Connections,
    /// Derived once by [`Workflow::set_connections`]; **not** re-derived by `rename_node` (D-08).
    pub connections_by_destination_node: Connections,
}

impl Workflow {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: Option<String>,
        name: Option<String>,
        nodes: Vec<INode>,
        connections: Connections,
        active: bool,
        settings: Option<WorkflowSettings>,
        static_data: Option<Value>,
        pin_data: Option<Value>,
    ) -> Self {
        let settings = settings.unwrap_or_else(|| json!({}));
        let mut workflow = Self {
            id,
            name,
            active,
            timezone: timezone_for(&settings),
            settings,
            static_data: static_data.unwrap_or_else(|| json!({})),
            pin_data,
            meta: None,
            nodes: OrderedMap::new(),
            connections_by_source_node: Connections::new(),
            connections_by_destination_node: Connections::new(),
        };
        workflow.set_nodes(nodes);
        workflow.set_connections(connections);
        workflow
    }

    /// Port of `setNodes` — including its two JS-object quirks:
    ///
    /// * a duplicate name overwrites the earlier node but keeps its position (`last node wins`),
    /// * a node literally named `__proto__` is swallowed (`obj['__proto__'] = node` sets the
    ///   prototype, so `Object.keys` never shows it). Reproduced deliberately: the fixture
    ///   `restricted-name-overwrite` asserts the reference behaviour.
    pub fn set_nodes(&mut self, nodes: Vec<INode>) {
        for node in nodes {
            if node.name == "__proto__" {
                continue;
            }
            self.nodes.insert(node.name.clone(), node);
        }
    }

    /// Port of `setConnections`: the destination index is derived here and only here.
    pub fn set_connections(&mut self, connections: Connections) {
        self.connections_by_destination_node = map_connections_by_destination(&connections);
        self.connections_by_source_node = connections;
    }

    pub fn get_node(&self, node_name: &str) -> Option<&INode> {
        self.nodes.get(node_name)
    }

    /// Port of `getNodes(nodeNames)`: missing names are skipped (the reference logs a warning).
    pub fn get_nodes(&self, node_names: &[String]) -> Vec<&INode> {
        node_names
            .iter()
            .filter_map(|name| self.nodes.get(name))
            .collect()
    }

    pub fn get_nodes_in_order(&self) -> Vec<&INode> {
        self.nodes.values().collect()
    }

    /// `Object.keys(this.nodes)` — first-insertion order.
    pub fn node_keys(&self) -> Vec<String> {
        self.nodes.key_names()
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn get_child_nodes(&self, node_name: &str, filter: ConnectionTypeFilter, depth: i32) -> Vec<String> {
        get_connected_nodes(
            &self.connections_by_source_node,
            node_name,
            &filter,
            depth,
            None,
        )
    }

    /// Uses the **derived** destination map — which `rename_node` does not refresh (D-08).
    pub fn get_parent_nodes(&self, node_name: &str, filter: ConnectionTypeFilter, depth: i32) -> Vec<String> {
        get_connected_nodes(
            &self.connections_by_destination_node,
            node_name,
            &filter,
            depth,
            None,
        )
    }

    /// Reference `getConnectedNodes` takes the map as an argument; the port keeps that shape.
    pub fn get_connected_nodes(
        &self,
        connections: &Connections,
        node_name: &str,
        filter: ConnectionTypeFilter,
        depth: i32,
    ) -> Vec<String> {
        get_connected_nodes(connections, node_name, &filter, depth, None)
    }

    /// Port of `getStartNode(destinationNode?)` (`workflow.ts:816-867`).
    ///
    /// With a destination: walk up the non-disabled parents (`getHighestNode`), fall back to
    /// the destination itself when no parent survives, then apply the reference
    /// `__getStartNode` rules and — if those find nothing — return `nodes[nodeNames[0]]`
    /// **regardless of its `disabled` flag** (`workflow.ts:862-864`, no check there).
    ///
    /// Without a destination: `__getStartNode(Object.keys(this.nodes))` with **no** fallback
    /// (`workflow.ts:866`).
    ///
    /// Documented divergence: the reference's trigger/poll loop (`workflow.ts:833-844`) consults
    /// the node-type registry, which the Workflow LEGO does not own; the port goes straight to
    /// the `STARTING_NODE_TYPES` branch (`workflow.ts:846-855`), which is the only reachable
    /// outcome for the start types themselves.
    pub fn get_start_node(&self, destination_node: Option<&str>) -> Option<&INode> {
        match destination_node {
            Some(destination) => {
                let mut names = self.get_highest_node(destination, None, None);
                if names.is_empty() {
                    // If no parent nodes have been found then only the destination-node
                    // is in the tree so add that one (`workflow.ts:821-825`).
                    names.push(destination.to_string());
                }
                self.get_start_node_from_candidates(&names)
                    .or_else(|| self.nodes.get(names[0].as_str()))
            }
            None => self.get_start_node_from_candidates(&self.node_keys()),
        }
    }

    /// Port of `__getStartNode(nodeNames)` (`workflow.ts:811-859`), minus the trigger/poll
    /// loop that needs the node-type registry (see [`Workflow::get_start_node`]).
    pub fn get_start_node_from_candidates(&self, node_names: &[String]) -> Option<&INode> {
        // If there is exactly one candidate it is returned **unless disabled**
        // (`workflow.ts:819-826`): `!node.disabled` — an omitted flag passes.
        if node_names.len() == 1 {
            if let Some(node) = self.nodes.get(&node_names[0]) {
                if node.disabled != Some(true) {
                    return Some(node);
                }
            }
        }

        // The trigger/poll loop (`workflow.ts:828-844`) needs `nodeTypes` — not ported.
        // `STARTING_NODE_TYPES` branch (`workflow.ts:846-855`): scan **all** nodes sorted by
        // their index in `STARTING_NODE_TYPES` (absent types first, `-1` in the reference),
        // stable — and skip disabled start-type nodes.
        let mut sorted: Vec<&INode> = self.nodes.values().collect();
        sorted.sort_by_key(|node| {
            START_NODE_TYPES
                .iter()
                .position(|t| *t == node.node_type)
                .map(|index| index as isize)
                .unwrap_or(-1)
        });
        for node in sorted {
            if START_NODE_TYPES.contains(&node.node_type.as_str()) {
                if node.disabled == Some(true) {
                    continue;
                }
                return Some(node);
            }
        }

        None
    }

    /// Port of `getHighestNode(nodeName, nodeConnectionIndex?, checkedNodes?)`
    /// (`workflow.ts:487-565`), preserving the reference's deliberate **asymmetry** (D-04,
    /// `docs/isolation/CROSS-AGENT-ISSUES.md` ISSUE-015 CORRECTION):
    ///
    /// * the *starting* node is its own highest node only when `disabled === false`
    ///   **strictly** (`workflow.ts:498`) — a node that merely omits the flag is NOT pushed;
    /// * a *parent* is included when `disabled !== true` (`workflow.ts:553`) — an omitted
    ///   flag IS included.
    ///
    /// A disabled node mid-chain is transparent: traversal continues *through* it to its own
    /// parents, it just never appears in the result.
    pub fn get_highest_node(
        &self,
        node_name: &str,
        node_connection_index: Option<usize>,
        checked_nodes: Option<&[String]>,
    ) -> Vec<String> {
        let mut current_highest: Vec<String> = Vec::new();

        // `workflow.ts:498` — strict `=== false` for the starting node itself.
        // (The reference dereferences `this.nodes[nodeName].disabled` and would throw on an
        // unknown node; the port returns empty instead of panicking — documented divergence.)
        match self.nodes.get(node_name) {
            Some(node) if node.disabled == Some(false) => {
                current_highest.push(node_name.to_string());
            }
            None => return current_highest,
            _ => {}
        }

        let Some(node_inputs) = self.connections_by_destination_node.get(node_name) else {
            // Node does not have incoming connections
            return current_highest;
        };
        let Some(main_inputs) = node_inputs.get("main") else {
            // Node does not have incoming connections of the given type
            return current_highest;
        };

        let mut checked_nodes: Vec<String> = checked_nodes.unwrap_or_default().to_vec();
        if checked_nodes.iter().any(|name| name == node_name) {
            // Node got checked already before
            return current_highest;
        }
        checked_nodes.push(node_name.to_string());

        let mut return_nodes: Vec<String> = Vec::new();

        for (connection_index, slot) in main_inputs.iter().enumerate() {
            if let Some(wanted) = node_connection_index {
                // If a connection-index is given ignore all other ones
                if wanted != connection_index {
                    continue;
                }
            }
            let Some(connections) = slot else { continue };
            for connection in connections {
                if checked_nodes.iter().any(|name| name == &connection.node) {
                    // Node got checked already before
                    continue;
                }
                // Ignore connections for nodes that don't exist in this workflow
                if !self.nodes.contains_key(&connection.node) {
                    continue;
                }

                let mut add_nodes =
                    self.get_highest_node(&connection.node, None, Some(&checked_nodes));

                if add_nodes.is_empty() {
                    // The checked node does not have any further parents so add it
                    // if it is not disabled (`workflow.ts:553` — lenient `!== true`).
                    let disabled = self
                        .nodes
                        .get(&connection.node)
                        .and_then(|node| node.disabled);
                    if disabled != Some(true) {
                        add_nodes = vec![connection.node.clone()];
                    }
                }

                // Only add if node is not on the list already anyway
                for name in add_nodes {
                    if !return_nodes.contains(&name) {
                        return_nodes.push(name);
                    }
                }
            }
        }

        return_nodes
    }

    /// Port of `getNodeConnectionIndexes(nodeName, parentNodeName, type = 'main')`
    /// (`workflow.ts:746-807`). BFS **upward** over the destination map; returns
    /// `{ sourceIndex, destinationIndex }` where `sourceIndex` is the edge's stored
    /// source-output index and `destinationIndex` is the edge's *position inside the
    /// destination slot* — NOT the slot (input) index (see the probe pins in
    /// `tests/reference/connection/02`: `IF -> B` → `{1, 0}`).
    pub fn get_node_connection_indexes(
        &self,
        node_name: &str,
        parent_node_name: &str,
        connection_type: &str,
    ) -> Option<NodeConnectionIndexes> {
        // `workflow.ts:750-754` — unknown parent → undefined.
        if self.get_node(parent_node_name).is_none() {
            return None;
        }

        let mut visited_nodes: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<String> = VecDeque::new();
        queue.push_back(node_name.to_string());

        while let Some(current_node_name) = queue.pop_front() {
            if visited_nodes.contains(&current_node_name) {
                continue;
            }
            visited_nodes.insert(current_node_name.clone());

            let Some(type_connections) = self
                .connections_by_destination_node
                .get(&current_node_name)
                .and_then(|outputs| outputs.get(connection_type))
            else {
                continue;
            };

            for slot in type_connections {
                let Some(connections_by_index) = slot else {
                    continue;
                };
                for (destination_index, connection) in connections_by_index.iter().enumerate() {
                    if parent_node_name == connection.node {
                        return Some(NodeConnectionIndexes {
                            source_index: connection.index,
                            destination_index,
                        });
                    }
                    if !visited_nodes.contains(&connection.node) {
                        queue.push_back(connection.node.clone());
                    }
                }
            }
        }

        None
    }

    /// Port of `getParentNodesByDepth(nodeName, maxDepth = -1)` → `searchNodesBFS`
    /// (`workflow.ts:620-685`): BFS by depth levels over the **destination** map, `main` only.
    /// A node reached again later is NOT re-emitted; the new indices are merged (deduped,
    /// first-occurrence order) into the **already-emitted** object — pinned by the probe
    /// `parents by depth of Merge` → `IF` carries `indicies: [1, 0]` at depth 1.
    /// The source node itself is never emitted.
    pub fn get_parent_nodes_by_depth(&self, node_name: &str, max_depth: i32) -> Vec<IConnectedNode> {
        // `visited` mirrors the JS object: name → (emitted depth, merged indices).
        let mut visited: HashMap<String, (u32, Vec<usize>)> = HashMap::new();
        let mut emission_order: Vec<String> = Vec::new();

        // JS queue entries carry their own `indicies` AND their own `depth` — a node is
        // emitted with the depth attached when it was PUSHED (the level of its parent's
        // expansion), not the loop level at which it is dequeued. A re-visit merges.
        let mut queue: Vec<(String, Vec<usize>, u32)> = vec![(node_name.to_string(), Vec::new(), 0)];

        let mut depth: i32 = 0;
        while !queue.is_empty() {
            if max_depth != -1 && depth > max_depth {
                break;
            }
            depth += 1;

            let to_add = std::mem::take(&mut queue);
            for (name, indicies, entry_depth) in to_add {
                if let Some((_, existing)) = visited.get_mut(&name) {
                    // Merge into the ALREADY-EMITTED object: dedupe(concat), first-occurrence
                    // order preserved (`dedupe` in the reference is `[...new Set(...)]`).
                    for index in indicies {
                        if !existing.contains(&index) {
                            existing.push(index);
                        }
                    }
                    continue;
                }

                let is_source = name == node_name;
                visited.insert(name.clone(), (entry_depth, indicies.clone()));
                if !is_source {
                    emission_order.push(name.clone());
                }

                let Some(lists) = self
                    .connections_by_destination_node
                    .get(&name)
                    .and_then(|outputs| outputs.get("main"))
                else {
                    continue;
                };
                for slot in lists {
                    let Some(connections) = slot else { continue };
                    for connection in connections {
                        queue.push((connection.node.clone(), vec![connection.index], depth as u32));
                    }
                }
            }
        }

        emission_order
            .into_iter()
            .map(|name| {
                let (depth, indicies) = &visited[&name];
                IConnectedNode {
                    name,
                    indicies: indicies.clone(),
                    depth: *depth,
                }
            })
            .collect()
    }

    /// Port of `getParentMainInputNode(node)` (`workflow.ts:687-743`).
    ///
    /// Divergence (needs the node-type registry, CD-05 / Agent 2): the reference resolves the
    /// node's declared outputs and, when non-`main` outputs exist, climbs from the first
    /// connected sub-node. The Workflow port owns no registry, so — exactly like the reference
    /// test harness stub (`tests/reference/harness/connection.js`, every node declares
    /// `outputs: ['main']`) — every node is treated as having only a `main` output and the
    /// pinned early-return path applies: the node is its own parent-main-input node.
    pub fn get_parent_main_input_node(&self, node_name: &str) -> Option<&INode> {
        // With the stub semantics (`outputs: ['main']`) `nonMainConnectionTypes` is always
        // empty and the reference returns the node itself (`workflow.ts:742`).
        self.get_node(node_name)
    }

    pub fn get_timezone(&self) -> &str {
        &self.timezone
    }

    /// Port of `getPinDataOfNode(nodeName)` (`workflow.ts:331-333`): returns the pinData of
    /// the node with the given name if it exists. Execution behaviour (substituting a node's
    /// real output with its pinned data) belongs to the execution LEGO and stays deferred
    /// (ISSUE-016); the accessor closes the "declared but never consulted" gap.
    pub fn get_pin_data_of_node(&self, node_name: &str) -> Option<&Value> {
        self.pin_data.as_ref().and_then(|pin| pin.get(node_name))
    }


    /// Port of `renameNode` — see `rename.rs` for the parameter rewriting, and `D-08` in
    /// `contracts/workflow.contract.md` §7 for why the destination index stays stale.
    pub fn rename_node(&mut self, current_name: &str, new_name: &str) -> Result<(), WorkflowError> {
        if is_restricted_node_name(new_name) {
            return Err(WorkflowError::RestrictedNodeName {
                name: new_name.to_string(),
            });
        }

        // Rename the node itself. JS: `nodes[new] = nodes[current]; delete nodes[current]` —
        // a re-used key keeps its position, a fresh key goes to the end.
        if let Some(mut node) = self.nodes.remove(current_name) {
            node.name = new_name.to_string();
            self.nodes.insert(new_name.to_string(), node);
        }

        // Update the expressions which reference the node with its old name.
        for node in self.nodes.values_mut() {
            let parameters =
                rename::rename_node_in_parameter_value(&node.parameters.0, current_name, new_name, false);
            node.parameters = INodeParameters(parameters);
            rename::rename_node_extra_content(node, current_name, new_name);
        }

        // Change all source connections (re-key).
        if self.connections_by_source_node.contains_key(current_name) {
            if let Some(outputs) = self.connections_by_source_node.remove(current_name) {
                self.connections_by_source_node
                    .insert(new_name.to_string(), outputs);
            }
        }

        // Change all destination connections inside the source map. The derived destination
        // index is intentionally left untouched (D-08).
        for outputs in self.connections_by_source_node.values_mut() {
            for lists in outputs.values_mut() {
                for slot in lists.iter_mut() {
                    if let Some(list) = slot {
                        for connection in list.iter_mut() {
                            if connection.node == current_name {
                                connection.node = new_name.to_string();
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Entity/API wire shape: `nodes` is an **array** here — the aggregate is a map.
    /// (The reference has no `toJSON`; this adapter exists for round-trip fidelity and for the
    /// checksum, whose whitelist is defined over this shape.)
    pub fn from_wire(value: &Value) -> Result<Self, serde_json::Error> {
        let nodes: Vec<INode> = serde_json::from_value(
            value
                .get("nodes")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
        )?;
        let connections: Connections = serde_json::from_value(
            value
                .get("connections")
                .cloned()
                .unwrap_or_else(|| json!({})),
        )?;

        Ok(Workflow::new(
            value.get("id").and_then(Value::as_str).map(str::to_string),
            value.get("name").and_then(Value::as_str).map(str::to_string),
            nodes,
            connections,
            value.get("active").and_then(Value::as_bool).unwrap_or(false),
            value.get("settings").cloned(),
            value.get("staticData").cloned(),
            value.get("pinData").cloned(),
        ))
    }

    pub fn to_wire(&self) -> Value {
        let mut out = Map::new();
        if let Some(id) = &self.id {
            out.insert("id".into(), Value::String(id.clone()));
        }
        if let Some(name) = &self.name {
            out.insert("name".into(), Value::String(name.clone()));
        }
        out.insert("active".into(), Value::Bool(self.active));
        out.insert(
            "nodes".into(),
            Value::Array(
                self.nodes
                    .values()
                    .map(|node| serde_json::to_value(node).unwrap_or(Value::Null))
                    .collect(),
            ),
        );
        out.insert(
            "connections".into(),
            serde_json::to_value(&self.connections_by_source_node).unwrap_or(Value::Null),
        );
        out.insert("settings".into(), self.settings.clone());
        out.insert("staticData".into(), self.static_data.clone());
        if let Some(pin_data) = &self.pin_data {
            out.insert("pinData".into(), pin_data.clone());
        }
        Value::Object(out)
    }
}

fn timezone_for(settings: &WorkflowSettings) -> String {
    settings
        .get("timezone")
        .and_then(Value::as_str)
        .filter(|timezone| !timezone.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| DEFAULT_TIMEZONE.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(name: &str) -> INode {
        serde_json::from_value(json!({
            "id": format!("id-{name}"),
            "name": name,
            "type": "n8n-nodes-base.noOp",
            "typeVersion": 1,
            "position": [0, 0],
            "parameters": {}
        }))
        .expect("node")
    }

    fn chain() -> Workflow {
        let connections: Connections = serde_json::from_value(json!({
            "A": { "main": [[{"node": "B", "type": "main", "index": 0}]] },
            "B": { "main": [[{"node": "C", "type": "main", "index": 0}]] }
        }))
        .expect("connections");
        Workflow::new(
            Some("wf-rename".into()),
            Some("Rename".into()),
            vec![node("A"), node("B"), node("C"), node("D")],
            connections,
            false,
            None,
            None,
            None,
        )
    }

    #[test]
    fn wire_shape_round_trips_and_rejects_a_nodes_map() {
        let wire = json!({
            "id": "wf-1",
            "name": "Wire",
            "active": false,
            "nodes": [
                {"id": "id-A", "name": "A", "type": "n8n-nodes-base.noOp", "typeVersion": 1,
                 "position": [0, 0], "parameters": {"keep": true}, "webhookId": "kept-too"}
            ],
            "connections": {"A": {"main": [[{"node": "B", "type": "main", "index": 0}]]}},
            "settings": {"executionOrder": "v1"},
            "staticData": {"lastId": 42}
        });

        let workflow = Workflow::from_wire(&wire).expect("wire parses");
        assert_eq!(workflow.node_count(), 1);
        let a = workflow.get_node("A").expect("A");
        assert_eq!(a.extra.get("webhookId"), Some(&json!("kept-too")));
        assert_eq!(workflow.to_wire()["nodes"][0]["parameters"]["keep"], json!(true));

        // The Phase-3 skeleton deserialised `nodes` as a map; n8n wires an array.
        let bad = json!({"nodes": {"A": {"id": "id-A", "name": "A"}}});
        assert!(Workflow::from_wire(&bad).is_err());
    }

    #[test]
    fn rename_rewrites_expressions_and_keeps_the_destination_index_stale() {
        let mut workflow = chain();
        workflow.rename_node("B", "Beta").expect("rename");

        // JS: `nodes["Beta"] = nodes["B"]; delete nodes["B"]` — the new key goes to the END
        assert_eq!(workflow.node_keys(), vec!["A", "C", "D", "Beta"]);
        assert_eq!(
            workflow
                .connections_by_source_node
                .key_names()
                .iter()
                .filter(|name| name.as_str() != "C")
                .count(),
            2
        );
        // D-08: the derived index still answers for the old name.
        assert!(workflow
            .get_parent_nodes("Beta", ConnectionTypeFilter::main(), -1)
            .is_empty());
        assert_eq!(
            workflow.get_parent_nodes("B", ConnectionTypeFilter::main(), -1),
            vec!["A"]
        );

        workflow.set_connections(workflow.connections_by_source_node.clone());
        assert_eq!(
            workflow.get_parent_nodes("Beta", ConnectionTypeFilter::main(), -1),
            vec!["A"]
        );
    }

    #[test]
    fn restricted_names_are_rejected_case_insensitively() {
        let mut workflow = chain();
        let error = workflow.rename_node("D", "HasOwnProperty").unwrap_err();
        assert_eq!(error.error_name(), "UserError");
        assert_eq!(
            error.to_string(),
            "Node name \"HasOwnProperty\" is a restricted name."
        );
    }

    #[test]
    fn duplicate_node_names_overwrite_in_place_and_proto_is_swallowed() {
        let connections: Connections = Connections::new();
        let workflow = Workflow::new(
            None,
            None,
            vec![node("A"), node("__proto__")],
            connections,
            false,
            None,
            None,
            None,
        );
        assert_eq!(workflow.node_keys(), vec!["A"]);
        assert_eq!(workflow.node_count(), 1);
    }
}
