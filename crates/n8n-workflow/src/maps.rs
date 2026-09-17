//! Connection map derivation — faithful port of the ORIGINAL n8n function
//! `mapConnectionsByDestination`
//! (`reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts`,
//! also present as `Workflow.getConnectionsByDestination` in `workflow.ts`).
//!
//! Semantics preserved exactly:
//! - destination entries are padded with empty lists up to the destination
//!   input index (`for (j = maxIndex; j < connectionInfo.index; j++) push([])`);
//! - the stored entry records the SOURCE node, the SOURCE connection type,
//!   and the SOURCE output index (parsed from the array index key);
//! - duplicate edges are preserved (traversal, not the map, dedupes).

use std::collections::BTreeMap;

use crate::model::{Connection, Connections, NodeConnectionMapping};

/// Original `mapConnectionsByDestination(connections)`.
pub fn map_connections_by_destination(connections: &Connections) -> Connections {
    let mut out: Connections = BTreeMap::new();

    for (source_node, by_type) in connections {
        for (type_, by_index) in by_type {
            for (input_index, slot) in by_index.iter().enumerate() {
                let Some(list) = slot else {
                    continue;
                };
                for conn in list {
                    let dest = out.entry(conn.node.clone()).or_default();
                    let dest_slots = dest.entry(conn.type_.clone()).or_default();

                    // Original padding loop:
                    // `maxIndex = arr.length - 1;
                    //  for (j = maxIndex; j < connectionInfo.index; j++) arr.push([]);`
                    // Padded slots are EMPTY LISTS (Some(empty)), exactly like
                    // the JS `[]` — the destination map never contains null
                    // slots (only source maps parsed from JSON can).
                    while dest_slots.len() <= conn.index {
                        dest_slots.push(Some(Vec::new()));
                    }

                    dest_slots[conn.index]
                        .get_or_insert_with(Vec::new)
                        .push(Connection {
                            node: source_node.clone(),
                            type_: type_.clone(),
                            index: input_index,
                        });
                }
            }
        }
    }

    out
}

/// Spec §3.1: `buildConnectionMaps(connections) → NodeConnectionMapping`.
/// The source side is kept as-is; the destination side is derived.
pub fn build_connection_maps(connections: &Connections) -> NodeConnectionMapping {
    NodeConnectionMapping {
        by_source: connections.clone(),
        by_destination: map_connections_by_destination(connections),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MAIN;

    fn source_map() -> Connections {
        let mut by_type: BTreeMap<String, Vec<Option<Vec<Connection>>>> = BTreeMap::new();
        // Sparse output index 0 (null), index 1 → B input 2.
        by_type.insert(
            MAIN.to_string(),
            vec![
                None,
                Some(vec![Connection {
                    node: "B".to_string(),
                    type_: MAIN.to_string(),
                    index: 2,
                }]),
            ],
        );
        let mut conns = BTreeMap::new();
        conns.insert("A".to_string(), by_type);
        conns
    }

    #[test]
    fn pads_destination_to_input_index() {
        let out = map_connections_by_destination(&source_map());
        let b_main = out.get("B").and_then(|t| t.get(MAIN)).cloned().unwrap();
        assert_eq!(b_main.len(), 3);
        assert_eq!(b_main[0].as_ref(), Some(&Vec::new()));
        assert_eq!(b_main[1].as_ref(), Some(&Vec::new()));
        let second = b_main[2].as_ref().cloned().unwrap();
        assert_eq!(
            second,
            vec![Connection {
                node: "A".to_string(),
                type_: MAIN.to_string(),
                index: 1, // SOURCE output index (from the array key), not dest index
            }]
        );
    }

    #[test]
    fn duplicates_are_preserved_in_map() {
        let mut by_type: BTreeMap<String, Vec<Option<Vec<Connection>>>> = BTreeMap::new();
        by_type.insert(
            MAIN.to_string(),
            vec![Some(vec![
                Connection {
                    node: "B".to_string(),
                    type_: MAIN.to_string(),
                    index: 0,
                },
                Connection {
                    node: "B".to_string(),
                    type_: MAIN.to_string(),
                    index: 0,
                },
            ])],
        );
        let mut conns = BTreeMap::new();
        conns.insert("A".to_string(), by_type);
        let out = map_connections_by_destination(&conns);
        let b_main = out.get("B").and_then(|t| t.get(MAIN)).cloned().unwrap();
        assert_eq!(b_main[0].as_ref().unwrap().len(), 2);
    }

    #[test]
    fn build_maps_is_dual_view() {
        let mapping = build_connection_maps(&source_map());
        assert!(mapping.by_source.contains_key("A"));
        assert!(mapping.by_destination.contains_key("B"));
        assert!(!mapping.by_destination.contains_key("A"));
    }

    #[test]
    fn empty_in_empty_out() {
        assert!(map_connections_by_destination(&BTreeMap::new()).is_empty());
    }
}
