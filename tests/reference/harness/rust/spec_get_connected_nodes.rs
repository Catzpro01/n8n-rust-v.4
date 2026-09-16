pub fn get_connected_nodes_spec(
    connections: &WorkflowConnections,
    node_name: &str,
    connection_type: &ConnectionTypeFilter,
    depth: i64,
    checked_nodes_incoming: Option<&[String]>,
) -> Vec<String> {
    let new_depth = if depth == -1 { -1 } else { depth - 1 };
    if depth == 0 { return Vec::new(); }
    let Some(by_type) = connections.get(node_name) else { return Vec::new(); };
    let types: Vec<String> = match connection_type {
        ConnectionTypeFilter::All => by_type.keys().cloned().collect(),
        ConnectionTypeFilter::AllNonMain => by_type.keys().filter(|t| t.as_str() != "main").cloned().collect(),
        ConnectionTypeFilter::Type(t) => vec![t.clone()],
    };
    let mut return_nodes: Vec<String> = Vec::new();
    for type_name in &types {
        let Some(slots) = by_type.get(type_name) else { continue; };
        let mut checked: Vec<String> = checked_nodes_incoming.map(|c| c.to_vec()).unwrap_or_default();
        if checked.iter().any(|c| c == node_name) { continue; }
        checked.push(node_name.to_string());
        for slot in slots {
            for connection in slot.iter().flatten() {
                if checked.iter().any(|c| c == &connection.node) { continue; }
                return_nodes.insert(0, connection.node.clone());
                let add_nodes = get_connected_nodes_spec(connections, &connection.node, connection_type, new_depth, Some(&checked));
                for i in (0..add_nodes.len()).rev() {
                    let parent = &add_nodes[i];
                    if let Some(pos) = return_nodes.iter().position(|n| n == parent) { return_nodes.remove(pos); }
                    return_nodes.insert(0, parent.clone());
                }
            }
        }
    }
    return_nodes
}
