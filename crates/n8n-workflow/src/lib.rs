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
//! Deliberate divergence to be decided at contract level: `getStartNode` / `getHighestNode` are
//! ported faithfully (including the `disabled` asymmetry and the disabled-returning final
//! fallback — ISSUE-017), but the registry branch of `__getStartNode` (`nodeType.trigger/poll`)
//! is not reproducible inside the Workflow LEGO; see `docs/isolation/PHASE-3-OPENING.md` and
//! `docs/isolation/workflow-rust-port-review.md` §6.

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

use serde_json::{json, Map, Value};

/// The reference keeps settings as an open bag (`IWorkflowSettings` plus unknown keys that are
/// passed through untouched — language-server additions, `executionOrder`, …), so the port keeps
/// them verbatim instead of modelling a closed struct.
pub type WorkflowSettings = Value;

/// Reference default: `getGlobalState().defaultTimezone` as resolved by the pinned runtime the
/// fixtures were derived from. Kept as a constant so the port is deterministic instead of
/// depending on the host's `TZ`/`Intl` data.
pub const DEFAULT_TIMEZONE: &str = "America/New_York";

/// `STARTING_NODE_TYPES` from `reference/n8n/packages/workflow/src/constants.ts:53-59`.
/// **Order matters**: `__getStartNode` sorts all nodes by this index (stable), so the
/// first enabled node whose type appears earliest in this list wins. Types not in the
/// list sort to the front (`indexOf === -1`) but are skipped by the membership check.
///
/// Replaces the earlier guessed list (`start`, `scheduleTrigger`, `cron`) — those types
/// are picked up by the reference's *registry* branch (`nodeType.trigger/poll`), not by
/// this constant, see the divergence note on [`Workflow::get_start_node`].
pub const STARTING_NODE_TYPES: [&str; 5] = [
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

    /// Reference `getStartNode(destinationNode?)` (`workflow.ts:862-884`).
    ///
    /// Faithful port, including the final fallback `this.nodes[nodeNames[0]]` which returns
    /// the node **even when it is disabled** (a disabled lone destination is its own start
    /// node — see fixture case `start-disabled-fallback`).
    ///
    /// NOT ported (recorded divergence, same as before): the registry branch of
    /// `__getStartNode` (`workflow.ts:830-842`) that resolves `nodeType.trigger/poll` and
    /// skips the manual-chat trigger. The Workflow LEGO has no node-type registry, so a
    /// schedule/cron/poll trigger is only honoured if it also appears in
    /// [`STARTING_NODE_TYPES`]. Documented in `docs/isolation/PHASE-3-OPENING.md`.
    pub fn get_start_node(&self, destination_node: Option<&str>) -> Option<&INode> {
        match destination_node {
            Some(destination) => {
                // Find the highest parent nodes of the given one.
                let mut node_names = self.get_highest_nodes(destination, None);
                if node_names.is_empty() {
                    // No parents found — only the destination-node is in the tree.
                    node_names.push(destination.to_string());
                }
                // Check which node to return as start node.
                if let Some(node) = self.get_start_node_inner(&node_names) {
                    return Some(node);
                }
                // None found — return the first parent node in the list. The reference
                // does this unconditionally: `return this.nodes[nodeNames[0]];`
                self.nodes.get(&node_names[0])
            }
            None => self.get_start_node_inner(&self.node_keys()),
        }
    }

    /// Reference `__getStartNode` (`workflow.ts:818-860`). See the divergence note on
    /// [`Workflow::get_start_node`] for the unported registry branch (step 2).
    fn get_start_node_inner(&self, node_names: &[String]) -> Option<&INode> {
        // Single candidate, lenient check: `node && !node.disabled` (`:824`). A node that
        // omits `disabled` qualifies; a disabled one falls through to step 3.
        if node_names.len() == 1 {
            if let Some(node) = self.nodes.get(&node_names[0]) {
                if node.disabled != Some(true) {
                    return Some(node);
                }
            }
        }

        // Step 2 (`:830-842`, registry `trigger`/`poll` scan + manual-chat skip): NOT ported.

        // All nodes sorted by their STARTING_NODE_TYPES index (`:844-848`). Unknown types
        // get index -1 and sort first but are skipped by the membership check. The sort is
        // stable, matching JS Array.prototype.sort on equal indexes.
        let mut sorted: Vec<&INode> = self.nodes.values().collect();
        sorted.sort_by_key(|node| {
            STARTING_NODE_TYPES
                .iter()
                .position(|starting| *starting == node.node_type)
                .map(|index| index as i64)
                .unwrap_or(-1)
        });
        for node in sorted {
            if STARTING_NODE_TYPES.contains(&node.node_type.as_str()) {
                // `if (node.disabled === true) continue;` (`:853`)
                if node.disabled == Some(true) {
                    continue;
                }
                return Some(node);
            }
        }

        None
    }

    /// Reference `getHighestNode(nodeName, nodeConnectionIndex?, checkedNodes?)`
    /// (`workflow.ts:492-563`) — highest parent nodes of the given node.
    ///
    /// Three behaviours a naive rewrite silently "fixes" (ISSUE-017):
    ///
    /// * **asymmetry (D-04)**: the node itself is admitted only with `disabled === false`
    ///   (strict, `:498`), while a parent is admitted with `disabled !== true` (lenient,
    ///   `:553`). A node that OMITS `disabled` is therefore never its own highest node,
    ///   yet IS admitted as another node's highest parent.
    /// * when main-type incoming connections exist, the node's own `currentHighest` entry
    ///   is **discarded** — only the highest ancestors are returned (`:561`).
    /// * recursion order and first-seen dedupe are observable in the returned array.
    pub fn get_highest_nodes(&self, node_name: &str, node_connection_index: Option<usize>) -> Vec<String> {
        fn inner(
            workflow: &Workflow,
            node_name: &str,
            node_connection_index: Option<usize>,
            checked_nodes: &mut Vec<String>,
        ) -> Vec<String> {
            let mut current_highest: Vec<String> = Vec::new();
            // `:498` — strict: an omitted `disabled` does NOT count as enabled.
            if workflow
                .nodes
                .get(node_name)
                .map(|node| node.disabled == Some(false))
                .unwrap_or(false)
            {
                current_highest.push(node_name.to_string());
            }

            // Node does not have incoming connections.
            let Some(outputs) = workflow.connections_by_destination_node.get(node_name) else {
                return current_highest;
            };
            // Node does not have incoming connections of the given type.
            let Some(main_lists) = outputs.get("main") else {
                return current_highest;
            };
            // Node got checked already before.
            if checked_nodes.iter().any(|name| name == node_name) {
                return current_highest;
            }
            checked_nodes.push(node_name.to_string());

            let mut return_nodes: Vec<String> = Vec::new();
            for (connection_index, slot) in main_lists.iter().enumerate() {
                // If a connection-index is given ignore all other ones.
                if let Some(index_filter) = node_connection_index {
                    if index_filter != connection_index {
                        continue;
                    }
                }
                let Some(connections_by_index) = slot else {
                    continue;
                };
                for connection in connections_by_index {
                    if checked_nodes.iter().any(|name| name == &connection.node) {
                        continue;
                    }
                    // Ignore connections for nodes that don't exist in this workflow.
                    let Some(connection_node) = workflow.nodes.get(&connection.node) else {
                        continue;
                    };

                    let mut add_nodes = inner(workflow, &connection.node, None, checked_nodes);
                    if add_nodes.is_empty() {
                        // The checked node does not have any further parents so add it
                        // if it is not disabled — lenient: `disabled !== true` (`:553`).
                        if connection_node.disabled != Some(true) {
                            add_nodes = vec![connection.node.clone()];
                        }
                    }
                    for name in add_nodes {
                        // Only add if node is not on the list already anyway.
                        if !return_nodes.contains(&name) {
                            return_nodes.push(name);
                        }
                    }
                }
            }
            // NOTE: `currentHighest` is discarded on this path, exactly like the reference.
            return_nodes
        }

        inner(self, node_name, node_connection_index, &mut Vec::new())
    }

    pub fn get_timezone(&self) -> &str {
        &self.timezone
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
