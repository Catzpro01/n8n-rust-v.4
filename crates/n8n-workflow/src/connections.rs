//! Connection maps, ported from `reference/n8n/packages/workflow/src/common/map-connections-by-destination.ts`
//! and the `IConnections` shape in `interfaces.ts`.
//!
//! Wire shape (document order preserved, see `ordered.rs`):
//!
//! ```text
//! connections[sourceNodeName][connectionType][sourceOutputIndex] = [ {node, type, index}, … ]
//! ```
//!
//! The aggregate keeps two maps: `connectionsBySourceNode` (as wired) and
//! `connectionsByDestinationNode` (derived once, at `setConnections` time — the
//! reference never re-derives it on rename, which is deliberate per D-08).

use crate::ordered::OrderedMap;
use serde::{Deserialize, Serialize};

/// A single edge as stored in the source map. In the destination map, `index` is the
/// *source* output index (see `map_connections_by_destination`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Connection {
    pub node: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub index: usize,
}

/// One output slot; `null` entries are legal in n8n data and are skipped when traversed.
pub type ConnectionSlot = Option<Vec<Connection>>;

/// `[[…], null, […]]` — indexed by source output index.
pub type OutputLists = Vec<ConnectionSlot>;

/// `{ "main": [[…]] }` — connection type to output lists.
pub type NodeOutputs = OrderedMap<OutputLists>;

/// `{ "NodeName": { "main": [[…]] } }` — source or destination node name to outputs.
pub type Connections = OrderedMap<NodeOutputs>;

/// Port of `mapConnectionsByDestination`.
pub fn map_connections_by_destination(connections: &Connections) -> Connections {
    let mut by_destination: Connections = OrderedMap::new();

    for (source_node, outputs) in connections.iter() {
        for (connection_type, output_lists) in outputs.iter() {
            for (source_index, slot) in output_lists.iter().enumerate() {
                let Some(connections_in_slot) = slot else {
                    continue;
                };
                for connection in connections_in_slot {
                    let destination = by_destination.entry_or_insert_default(&connection.node);
                    let lists = destination.entry_or_insert_default(&connection.connection_type);

                    // JS: maxIndex = length - 1; for (j = maxIndex; j < index; j++) push([])
                    // → pads the array so that slot `index` exists. The reference pads with
                    // EMPTY ARRAYS (`[]`), never `null` — the byDestination probes in
                    // tests/reference/connection/02 pin `[[…], [], […]]`.
                    while lists.len() <= connection.index {
                        lists.push(Some(Vec::new()));
                    }
                    if let Some(target_slot) = lists.get_mut(connection.index) {
                        target_slot.get_or_insert_with(Vec::new).push(Connection {
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

impl Connections {
    /// All `(sourceNode, type, sourceIndex, connection)` tuples in document order.
    pub fn edges(&self) -> Vec<(String, String, usize, Connection)> {
        let mut out = Vec::new();
        for (source, outputs) in self.iter() {
            for (connection_type, lists) in outputs.iter() {
                for (source_index, slot) in lists.iter().enumerate() {
                    if let Some(slot) = slot {
                        for connection in slot {
                            out.push((
                                source.clone(),
                                connection_type.clone(),
                                source_index,
                                connection.clone(),
                            ));
                        }
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection(node: &str, index: usize) -> Connection {
        Connection {
            node: node.into(),
            connection_type: "main".into(),
            index,
        }
    }

    #[test]
    fn destination_map_inverts_the_source_map() {
        let mut outputs = NodeOutputs::new();
        outputs.insert("main".into(), vec![Some(vec![connection("B", 0)])]);
        let mut source: Connections = OrderedMap::new();
        source.insert("A".into(), outputs);

        let destination = map_connections_by_destination(&source);
        let b = destination.get("B").expect("B is a destination");
        let main = b.get("main").expect("main slot");
        assert_eq!(main.len(), 1);
        assert_eq!(
            main[0].as_ref().unwrap()[0],
            Connection {
                node: "A".into(),
                connection_type: "main".into(),
                index: 0
            }
        );
    }

    #[test]
    fn destination_slots_are_padded_to_the_destination_input_index() {
        let mut outputs = NodeOutputs::new();
        outputs.insert("main".into(), vec![None, Some(vec![connection("B", 1)])]);
        let mut source: Connections = OrderedMap::new();
        source.insert("A".into(), outputs);

        let destination = map_connections_by_destination(&source);
        let b = destination.get("B").unwrap();
        let main = b.get("main").unwrap();
        // The edge's `index` field is B's *destination input index* → slot 1;
        // the stored index is the *source output index* (A's output 1).
        // Padding is `[]` (empty arrays), matching the reference
        // (`getConnectionsByDestination` pushes `[]`, never `null`).
        assert_eq!(main.len(), 2);
        assert_eq!(main[0], Some(Vec::new()));
        assert_eq!(main[1].as_ref().unwrap()[0].index, 1);
    }

    // Golden trace from tests/reference/connection/02-multi-output (IF out 1 → B):
    // B sits at destination input 0 even though the edge lives in IF's output slot 1,
    // and the stored index keeps the source output index.
    #[test]
    fn destination_slot_is_the_edge_index_not_the_source_slot() {
        let mut if_outputs = NodeOutputs::new();
        if_outputs.insert(
            "main".into(),
            vec![
                Some(vec![connection("A", 0)]),
                Some(vec![connection("B", 0), connection("Merge", 1)]),
            ],
        );
        let mut source: Connections = OrderedMap::new();
        source.insert("IF".into(), if_outputs);

        let destination = map_connections_by_destination(&source);
        let b = destination.get("B").unwrap();
        assert_eq!(
            b.get("main").unwrap(),
            &vec![Some(vec![Connection {
                node: "IF".into(),
                connection_type: "main".into(),
                index: 1,
            }])]
        );
        let merge = destination.get("Merge").unwrap();
        assert_eq!(
            merge.get("main").unwrap(),
            &vec![
                Some(Vec::new()), // padded with [], per the reference
                Some(vec![Connection {
                    node: "IF".into(),
                    connection_type: "main".into(),
                    index: 1,
                }])
            ]
        );
    }
}
