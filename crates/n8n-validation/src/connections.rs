//! Connection integrity validation for workflow DAGs (task `validation/m8-03-dangling-connections`).
//!
//! Ensures every edge in a [`WorkflowConnections`] map is structurally sound:
//!
//! 1. **Dangling source** — an edge bucket whose source node no longer exists in the
//!    workflow (the typical residue after a node is deleted from the editor canvas
//!    without scrubbing its outgoing connections).
//! 2. **Dangling target** — an edge item pointing at a node name that is not part of
//!    the workflow (deleted downstream node).
//! 3. **Non-existent output slot** — a populated slot whose index exceeds the output
//!    capability declared for the source node (e.g. an edge sitting on slot index 1 of
//!    a node that only declares a single `main` output, or any populated slot on a
//!    connection type the node does not expose at all).
//!
//! n8n connection model (see `n8n-connection`): for each source node there is an
//! [`indexmap::IndexMap`] keyed by connection type (`"main"`, `"tool"`, …); each value
//! is a vector indexed by output slot, and each slot is optionally a list of
//! [`n8n_connection::ConnectionItem`] targets. Unpopulated (`None`) slots are inert
//! padding and are never treated as errors.
//!
//! Slot checks are capability-driven: call sites pass an [`OutputSlotSpec`] describing
//! how many output slots each node exposes per connection type. Nodes without a spec
//! entry are validated for dangling edges only — slot information is unknown at this
//! level, never guessed (L1 leniency, documented and unit-tested).

use n8n_connection::WorkflowConnections;
use std::collections::{HashMap, HashSet};

/// Failure modes for connection integrity validation.
///
/// Fail-fast semantics: [`validate_connections`] returns the first violation found.
/// Iteration order is deterministic (insertion order of the underlying `IndexMap`s,
/// then slot order, then in-slot item order), so the reported error is stable for a
/// stable input — matching the crate's existing validators.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConnectionValidationError {
    /// An edge bucket exists for a source node that is not part of the workflow.
    /// String content: the offending source node name.
    #[error(
        "connection bucket for source node '{0}', but that node does not exist in the workflow (deleted node or stale connection)"
    )]
    DanglingSourceNode(String),

    /// An edge item targets a node that is not part of the workflow.
    #[error(
        "connection from '{from}' targets node '{target}', which does not exist in the workflow (deleted node or stale connection)"
    )]
    DanglingTargetNode {
        /// Source node owning the edge.
        from: String,
        /// Non-existent target node.
        target: String,
    },

    /// A populated slot sits beyond the source node's declared output capability.
    #[error(
        "connection from '{node}' uses output slot {slot} of type '{connection_type}', but the node declares only {declared} output slot(s) for that type"
    )]
    NonExistentOutputSlot {
        /// Source node owning the edge.
        node: String,
        /// Connection type key of the offending bucket (e.g. `"main"`).
        connection_type: String,
        /// Offending slot index (0-based).
        slot: usize,
        /// Declared number of output slots for `(node, connection_type)`; `0` means the
        /// node does not expose this connection type at all.
        declared: usize,
    },
}

/// Declared output capability of the workflow's nodes: node name → (connection type →
/// number of output slots that exist for that type).
///
/// A node missing from the map is validated for dangling edges only (slot capability
/// unknown — see module docs). A node present in the map but missing a connection type
/// is treated as exposing **zero** slots for that type, so any populated slot under it
/// is a [`ConnectionValidationError::NonExistentOutputSlot`] with `declared: 0`.
pub type OutputSlotSpec = HashMap<String, HashMap<String, usize>>;

/// Validates connection-map integrity against the workflow's node set and, where
/// specified, each node's declared output capability.
///
/// # Arguments
///
/// * `nodes` — names of every node currently in the workflow; an edge bucket or edge
///   item referencing anything outside this set is a dangling connection (deleted
///   node residue).
/// * `connections` — the workflow's connection map to validate.
/// * `output_slots` — declared output capability per node (see [`OutputSlotSpec`]).
///   Pass an empty map to run dangling checks only.
///
/// # Errors
///
/// Returns the first violation found: [`ConnectionValidationError::DanglingSourceNode`],
/// [`ConnectionValidationError::DanglingTargetNode`], or
/// [`ConnectionValidationError::NonExistentOutputSlot`].
///
/// # Examples
///
/// ```ignore
/// use n8n_validation::connections::{validate_connections, OutputSlotSpec};
///
/// let nodes = vec!["A".to_string(), "B".to_string()];
/// let connections = WorkflowConnections::new();
/// let spec = OutputSlotSpec::new();
/// assert!(validate_connections(&nodes, &connections, &spec).is_ok());
/// ```
pub fn validate_connections(
    nodes: &[String],
    connections: &WorkflowConnections,
    output_slots: &OutputSlotSpec,
) -> Result<(), ConnectionValidationError> {
    let node_set: HashSet<&str> = nodes.iter().map(String::as_str).collect();

    for (source, node_connections) in connections {
        // (1) The edge bucket itself may be residue of a deleted source node.
        if !node_set.contains(source.as_str()) {
            return Err(ConnectionValidationError::DanglingSourceNode(source.clone()));
        }

        // Slot capability for this source, if the caller has metadata for it.
        // `None` => unknown capability, slot checks skipped (documented L1 leniency).
        let source_spec = output_slots.get(source);

        for (connection_type, slots) in node_connections {
            // Number of declared output slots for (source, connection_type). `Some(0)`
            // means the source is specced but does not expose this connection type,
            // so any populated slot under it is invalid.
            let declared = source_spec.map(|per_type| per_type.get(connection_type).copied().unwrap_or(0));

            for (slot_index, slot) in slots.iter().enumerate() {
                let Some(items) = slot else {
                    continue; // unpopulated slot — inert padding, never an error
                };

                // (3) Populated slot must exist on the source node.
                if let Some(declared) = declared {
                    if slot_index >= declared {
                        return Err(ConnectionValidationError::NonExistentOutputSlot {
                            node: source.clone(),
                            connection_type: connection_type.clone(),
                            slot: slot_index,
                            declared,
                        });
                    }
                }

                // (2) Every target must be an existing node.
                for item in items {
                    if !node_set.contains(item.node.as_str()) {
                        return Err(ConnectionValidationError::DanglingTargetNode {
                            from: source.clone(),
                            target: item.node.clone(),
                        });
                    }
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use n8n_connection::ConnectionItem;

    fn item(node: &str, index: usize) -> ConnectionItem {
        ConnectionItem {
            node: node.into(),
            connection_type: "main".into(),
            index,
        }
    }

    fn edge(connections: &mut WorkflowConnections, source: &str, slot: usize, target: &str) {
        let per_type: &mut IndexMap<String, Vec<Option<Vec<ConnectionItem>>>> =
            connections.entry(source.into()).or_default();
        let slots = per_type.entry("main".into()).or_default();
        while slots.len() <= slot {
            slots.push(None);
        }
        slots[slot] = Some(vec![item(target, 0)]);
    }

    fn spec(node: &str, connection_type: &str, count: usize) -> (String, HashMap<String, usize>) {
        let mut per_type = HashMap::new();
        per_type.insert(connection_type.to_string(), count);
        (node.to_string(), per_type)
    }

    #[test]
    fn valid_dag_passes() {
        let nodes = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        let mut conns = WorkflowConnections::new();
        edge(&mut conns, "A", 0, "B");
        edge(&mut conns, "B", 0, "C");
        let spec: OutputSlotSpec = [spec("A", "main", 1), spec("B", "main", 1)].into_iter().collect();
        assert!(validate_connections(&nodes, &conns, &spec).is_ok());
    }

    #[test]
    fn multi_output_node_with_all_slots_used_passes() {
        // IF-style node: two declared `main` outputs (true/false branches).
        let nodes = vec!["If".to_string(), "T".to_string(), "F".to_string()];
        let mut conns = WorkflowConnections::new();
        edge(&mut conns, "If", 0, "T");
        edge(&mut conns, "If", 1, "F");
        let spec: OutputSlotSpec = [spec("If", "main", 2)].into_iter().collect();
        assert!(validate_connections(&nodes, &conns, &spec).is_ok());
    }

    #[test]
    fn edge_bucket_of_deleted_source_node_is_rejected() {
        let nodes = vec!["B".to_string()]; // "A" was deleted from the workflow
        let mut conns = WorkflowConnections::new();
        edge(&mut conns, "A", 0, "B");
        let spec = OutputSlotSpec::new();
        assert_eq!(
            validate_connections(&nodes, &conns, &spec),
            Err(ConnectionValidationError::DanglingSourceNode("A".into()))
        );
    }

    #[test]
    fn edge_to_deleted_target_node_is_rejected() {
        let nodes = vec!["A".to_string()]; // "Ghost" was deleted
        let mut conns = WorkflowConnections::new();
        edge(&mut conns, "A", 0, "Ghost");
        let spec = OutputSlotSpec::new();
        assert_eq!(
            validate_connections(&nodes, &conns, &spec),
            Err(ConnectionValidationError::DanglingTargetNode {
                from: "A".into(),
                target: "Ghost".into(),
            })
        );
    }

    #[test]
    fn populated_slot_beyond_declared_outputs_is_rejected() {
        // Node declares ONE `main` output, but an edge sits on slot index 1.
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();
        edge(&mut conns, "A", 1, "B");
        let spec: OutputSlotSpec = [spec("A", "main", 1)].into_iter().collect();
        assert_eq!(
            validate_connections(&nodes, &conns, &spec),
            Err(ConnectionValidationError::NonExistentOutputSlot {
                node: "A".into(),
                connection_type: "main".into(),
                slot: 1,
                declared: 1,
            })
        );
    }

    #[test]
    fn populated_slot_on_unexposed_connection_type_is_rejected() {
        // Node is specced for `main` only; a populated `tool` bucket is invalid.
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();
        let mut buckets = IndexMap::new();
        buckets.insert("tool".to_string(), vec![Some(vec![item("B", 0)])]);
        conns.insert("A".to_string(), buckets);
        let spec: OutputSlotSpec = [spec("A", "main", 1)].into_iter().collect();
        assert_eq!(
            validate_connections(&nodes, &conns, &spec),
            Err(ConnectionValidationError::NonExistentOutputSlot {
                node: "A".into(),
                connection_type: "tool".into(),
                slot: 0,
                declared: 0,
            })
        );
    }

    #[test]
    fn empty_slots_are_inert_and_never_flagged() {
        // Trailing `None` padding beyond declared capability carries no edge.
        let nodes = vec!["A".to_string()];
        let mut conns = WorkflowConnections::new();
        let mut buckets = IndexMap::new();
        buckets.insert("main".to_string(), vec![None, None, None]);
        conns.insert("A".to_string(), buckets);
        let spec: OutputSlotSpec = [spec("A", "main", 1)].into_iter().collect();
        assert!(validate_connections(&nodes, &conns, &spec).is_ok());
    }

    #[test]
    fn nodes_without_slot_spec_skip_slot_validation_but_keep_dangling_checks() {
        // No metadata for "A": slot count is unknown, never guessed (L1 leniency)…
        let nodes = vec!["A".to_string(), "B".to_string()];
        let mut conns = WorkflowConnections::new();
        edge(&mut conns, "A", 7, "B"); // unknown capability — not validated
        let spec = OutputSlotSpec::new();
        assert!(validate_connections(&nodes, &conns, &spec).is_ok());

        // …but dangling targets are still caught.
        let mut conns = WorkflowConnections::new();
        edge(&mut conns, "A", 7, "Ghost");
        assert_eq!(
            validate_connections(&nodes, &conns, &spec),
            Err(ConnectionValidationError::DanglingTargetNode {
                from: "A".into(),
                target: "Ghost".into(),
            })
        );
    }

    #[test]
    fn empty_connection_map_passes() {
        let nodes = vec!["A".to_string()];
        let conns = WorkflowConnections::new();
        let spec = OutputSlotSpec::new();
        assert!(validate_connections(&nodes, &conns, &spec).is_ok());
    }
}
