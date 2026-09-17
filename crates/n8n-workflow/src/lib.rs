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
//! Deliberate divergence to be decided at contract level: `getStartNode` is ported structurally
//! (highest node lookup + first trigger-ish node) but the reference's node-type heuristics are not
//! reproduced yet; see `docs/isolation/workflow-rust-port-review.md` §6.

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

/// `STARTING_NODE_TYPES` — `reference/n8n/packages/workflow/src/constants.ts:53-59`, references
/// resolved. The fallback loop of `__getStartNode` (`workflow.ts:846-858`) only accepts these five
/// types; `scheduleTrigger` / `cron` / `start` are **not** members, and the list order is
/// observable (it is the sort key). The previous port constant listed three types that are not in
/// the reference list and omitted three that are — pinned by `tests/reference/start-node` case D-11.
pub const STARTING_NODE_TYPES: [&str; 5] = [
    "n8n-nodes-base.manualTrigger",
    "n8n-nodes-base.executeWorkflowTrigger",
    "n8n-nodes-base.errorTrigger",
    "n8n-nodes-base.evaluationTrigger",
    "n8n-nodes-base.formTrigger",
];

/// `MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE` — `constants.ts:87`. `__getStartNode` skips it
/// (`workflow.ts:834`).
pub const MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE: &str = "@n8n/n8n-nodes-langchain.manualChatTrigger";

/// The slice of the node-type registry `__getStartNode` consults (`workflow.ts:830-843`).
///
/// The registry itself is **host input**, not part of this LEGO (`contracts/workflow.contract.md`
/// §4: "Node-type registry — host input (`HostContext.nodeTypes`), not a LEGO seam"), so the port
/// takes it as an argument instead of owning it. Without a registry the trigger/poll loop of
/// `__getStartNode` cannot run and only the `STARTING_NODE_TYPES` fallback applies.
pub trait NodeTypes {
    /// `(description.name, is_trigger, is_poll)` for a node type, mirroring
    /// `nodeTypes.getByNameAndVersion(type, typeVersion)`.
    fn describe(&self, node_type: &str, type_version: f64) -> Option<(String, bool, bool)>;
}

/// Registry that knows nothing — `getByNameAndVersion` returns `undefined` for every type.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoNodeTypes;

impl NodeTypes for NoNodeTypes {
    fn describe(&self, _node_type: &str, _type_version: f64) -> Option<(String, bool, bool)> {
        None
    }
}

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

    /// Reference `getStartNode(destinationNode?)` — `workflow.ts:865-891`.
    ///
    /// With a destination the reference walks up through `getHighestNode`, falls back to the
    /// destination itself when that yields nothing, and — if `__getStartNode` finds no trigger —
    /// returns the **first** candidate even when it is disabled (`workflow.ts:884`). Without a
    /// destination there is no such fallback: `__getStartNode` returning nothing means `undefined`.
    pub fn get_start_node(
        &self,
        destination_node: Option<&str>,
        node_types: Option<&dyn NodeTypes>,
    ) -> Result<Option<&INode>, WorkflowError> {
        let candidates: Vec<String> = match destination_node {
            Some(destination) => {
                let mut names = self.get_highest_nodes(destination)?;
                if names.is_empty() {
                    names.push(destination.to_string());
                }
                names
            }
            None => self.node_keys(),
        };

        if let Some(node) = self.select_start_node(&candidates, node_types)? {
            return Ok(Some(node));
        }

        // `workflow.ts:884` — only the destination branch falls back to the first candidate.
        Ok(match destination_node {
            Some(_) => candidates.first().and_then(|name| self.nodes.get(name)),
            None => None,
        })
    }

    /// Reference `__getStartNode(nodeNames)` — `workflow.ts:821-861`.
    fn select_start_node(
        &self,
        node_names: &[String],
        node_types: Option<&dyn NodeTypes>,
    ) -> Result<Option<&INode>, WorkflowError> {
        // `workflow.ts:825-829` — a single candidate is returned unless it is disabled.
        // Note the loose test here (`!node.disabled`): an *omitted* key still qualifies,
        // unlike the `=== true` / `=== false` tests below.
        if node_names.len() == 1 {
            if let Some(node) = self.nodes.get(&node_names[0]) {
                if node.disabled != Some(true) {
                    return Ok(Some(node));
                }
            }
        }

        // `workflow.ts:831-844` — first trigger/poll node in candidate order, skipping disabled.
        if let Some(registry) = node_types {
            for name in node_names {
                let Some(node) = self.nodes.get(name) else {
                    continue;
                };
                let Some((description_name, is_trigger, is_poll)) =
                    registry.describe(&node.node_type, node.type_version)
                else {
                    continue;
                };
                if description_name == MANUAL_CHAT_TRIGGER_LANGCHAIN_NODE_TYPE {
                    continue;
                }
                if (is_trigger || is_poll) && node.disabled != Some(true) {
                    return Ok(Some(node));
                }
            }
        }

        // `workflow.ts:846-858` — every node sorted by its index in STARTING_NODE_TYPES
        // (unknown types sort first with index -1, which is harmless because the loop below
        // filters by membership), then the first enabled member of the list wins.
        let mut sorted: Vec<&INode> = self.nodes.values().collect();
        sorted.sort_by_key(|node| starting_node_type_rank(&node.node_type));
        for node in sorted {
            if STARTING_NODE_TYPES.contains(&node.node_type.as_str()) && node.disabled != Some(true)
            {
                return Ok(Some(node));
            }
        }

        Ok(None)
    }

    /// Reference `getHighestNode(nodeName, nodeConnectionIndex?, checkedNodes?)` —
    /// `workflow.ts:491-568`.
    ///
    /// Two asymmetries are reproduced on purpose (fixture cases D-04/D-05/D-06):
    ///
    /// * the **starting** node counts as its own highest only when `disabled === false`
    ///   (`workflow.ts:498`), so a node that *omits* the key does not;
    /// * a **parent** counts when `disabled !== true` (`workflow.ts:553`), so a node that omits
    ///   the key does.
    ///
    /// `currentHighest` is only ever returned from the early exits — a node with incoming `main`
    /// connections never reports itself.
    pub fn get_highest_node(&self, node_name: &str) -> Result<Vec<String>, WorkflowError> {
        self.get_highest_node_at(node_name, None, &mut Vec::new())
    }

    fn get_highest_nodes(&self, node_name: &str) -> Result<Vec<String>, WorkflowError> {
        self.get_highest_node(node_name)
    }

    fn get_highest_node_at(
        &self,
        node_name: &str,
        node_connection_index: Option<usize>,
        checked_nodes: &mut Vec<String>,
    ) -> Result<Vec<String>, WorkflowError> {
        // `workflow.ts:498` dereferences `this.nodes[nodeName].disabled` unguarded → TypeError.
        let node = self.nodes.get(node_name).ok_or_else(|| WorkflowError::UnknownNode {
            name: node_name.to_string(),
        })?;

        let mut current_highest: Vec<String> = Vec::new();
        if node.disabled == Some(false) {
            current_highest.push(node_name.to_string());
        }

        let Some(by_type) = self.connections_by_destination_node.get(node_name) else {
            return Ok(current_highest);
        };
        let Some(slots) = by_type.get("main") else {
            return Ok(current_highest);
        };
        if checked_nodes.contains(&node_name.to_string()) {
            return Ok(current_highest);
        }
        checked_nodes.push(node_name.to_string());

        let mut return_nodes: Vec<String> = Vec::new();
        for (connection_index, slot) in slots.iter().enumerate() {
            if let Some(wanted) = node_connection_index {
                if wanted != connection_index {
                    continue;
                }
            }
            let Some(connections_in_slot) = slot else {
                continue;
            };
            for connection in connections_in_slot {
                if checked_nodes.contains(&connection.node) {
                    continue;
                }
                // `workflow.ts:544` — dangling references are ignored.
                let Some(parent) = self.nodes.get(&connection.node) else {
                    continue;
                };
                let mut add_nodes =
                    self.get_highest_node_at(&connection.node, None, checked_nodes)?;
                if add_nodes.is_empty() && parent.disabled != Some(true) {
                    add_nodes.push(connection.node.clone());
                }
                for name in add_nodes {
                    if !return_nodes.contains(&name) {
                        return_nodes.push(name);
                    }
                }
            }
        }

        Ok(return_nodes)
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

/// `STARTING_NODE_TYPES.indexOf(type)` — `-1` for non-members, exactly like JS.
fn starting_node_type_rank(node_type: &str) -> i32 {
    STARTING_NODE_TYPES
        .iter()
        .position(|candidate| *candidate == node_type)
        .map(|index| index as i32)
        .unwrap_or(-1)
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
