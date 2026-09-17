//! Cycle detection — SPEC-DEFINED pure function (workflow_spec.md §3.5).
//!
//! The ORIGINAL n8n does not detect cycles at workflow load time (execution
//! fails later at runtime); the cycle-acyclicity requirement comes from our
//! contract (`contracts/workflow.contract.md` §2: "Graph must be acyclic for
//! execution traversal"). This module provides that invariant check as a
//! deterministic, non-destructive pure function.
//!
//! Deterministic algorithm (identical in the Node.js reference harness —
//! `tests/compatibility/reference/harness.mjs`):
//! 1. Domain = sorted union of all connection source names and all
//!    connection destination names.
//! 2. Adjacency per node = all destination names of its edges (scope-
//!    filtered), duplicates kept, then sorted lexicographically.
//! 3. Three-color DFS (white/gray/black) over nodes in sorted order,
//!    neighbors in sorted order. The first gray-edge hit yields the cycle
//!    path = current DFS stack from that node onward (start not repeated).
//!
//! Read-only over `Connections` — the original graph is never mutated
//! (golden invariant: non-destructive validation).

use std::collections::BTreeMap;

use crate::model::Connections;

/// Which edge types participate in the cycle check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CycleScope {
    /// Only `main` connections (the execution-traversal semantics of the
    /// contract).
    Main,
    /// Every connection type.
    All,
}

impl CycleScope {
    fn includes(&self, connection_type: &str) -> bool {
        match self {
            CycleScope::Main => connection_type == crate::model::MAIN,
            CycleScope::All => true,
        }
    }
}

fn build_adjacency(connections: &Connections, scope: CycleScope) -> (Vec<String>, BTreeMap<String, Vec<String>>) {
    let mut seen: BTreeMap<String, ()> = BTreeMap::new();
    let mut adj: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for (source, by_type) in connections {
        seen.entry(source.clone()).or_insert(());
        for (type_, by_index) in by_type {
            if !scope.includes(type_) {
                continue;
            }
            for slot in by_index {
                let Some(list) = slot else {
                    continue;
                };
                for conn in list {
                    adj.entry(source.clone()).or_default().push(conn.node.clone());
                    seen.entry(conn.node.clone()).or_insert(());
                }
            }
        }
    }

    for neighbors in adj.values_mut() {
        neighbors.sort();
    }
    let names: Vec<String> = seen.into_keys().collect(); // BTreeMap ⇒ sorted
    (names, adj)
}

const WHITE: u8 = 0;
const GRAY: u8 = 1;
const BLACK: u8 = 2;

struct Dfs<'a> {
    adj: &'a BTreeMap<String, Vec<String>>,
    color: BTreeMap<String, u8>,
    stack: Vec<String>,
}

impl<'a> Dfs<'a> {
    fn visit(&mut self, node: &str) -> Option<Vec<String>> {
        self.color.insert(node.to_string(), GRAY);
        self.stack.push(node.to_string());

        let neighbors: Vec<String> = self
            .adj
            .get(node)
            .cloned()
            .unwrap_or_default();
        for next in neighbors {
            let color = *self.color.get(&next).unwrap_or(&WHITE);
            if color == GRAY {
                let pos = self
                    .stack
                    .iter()
                    .position(|n| n == &next)
                    .expect("gray node is always on the stack");
                return Some(self.stack[pos..].to_vec());
            }
            if color == WHITE {
                if let Some(cycle) = self.visit(&next) {
                    return Some(cycle);
                }
            }
        }

        self.stack.pop();
        self.color.insert(node.to_string(), BLACK);
        None
    }
}

/// Spec §3.5: `detectCycles(nodes, connections) → boolean`.
///
/// `nodes` (the fixture node list) is not needed for the check itself — the
/// connection edges already define the graph domain (superset semantics:
/// edges referencing nodes missing from `nodes` are still traversed, like
/// the original `getConnectedNodes` which ignores node existence).
pub fn detect_cycles(connections: &Connections, scope: CycleScope) -> bool {
    find_cycle(connections, scope).is_some()
}

/// Deterministic cycle path (first found under the fixed traversal order),
/// or `None` when the graph is acyclic.
pub fn find_cycle(connections: &Connections, scope: CycleScope) -> Option<Vec<String>> {
    let (names, adj) = build_adjacency(connections, scope);
    let mut dfs = Dfs {
        adj: &adj,
        color: BTreeMap::new(),
        stack: Vec::new(),
    };
    for name in &names {
        let color = *dfs.color.get(name).unwrap_or(&WHITE);
        if color == WHITE {
            if let Some(cycle) = dfs.visit(name) {
                return Some(cycle);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Connection, MAIN};

    fn edge(src: &str, dst: &str) -> (String, BTreeMap<String, Vec<Option<Vec<Connection>>>>) {
        let mut by_type = BTreeMap::new();
        by_type.insert(
            MAIN.to_string(),
            vec![Some(vec![Connection {
                node: dst.to_string(),
                type_: MAIN.to_string(),
                index: 0,
            }])],
        );
        (src.to_string(), by_type)
    }

    fn insert_edge(conns: &mut BTreeMap<String, BTreeMap<String, Vec<Option<Vec<Connection>>>>>, src: &str, dst: &str) {
        let (k, v) = edge(src, dst);
        conns.insert(k, v);
    }

    #[test]
    fn acyclic_graph() {
        let mut conns = BTreeMap::new();
        insert_edge(&mut conns, "A", "B");
        insert_edge(&mut conns, "B", "C");
        assert!(!detect_cycles(&conns, CycleScope::Main));
        assert!(find_cycle(&conns, CycleScope::Main).is_none());
    }

    #[test]
    fn detects_three_node_cycle() {
        let mut conns = BTreeMap::new();
        insert_edge(&mut conns, "A", "B");
        insert_edge(&mut conns, "B", "C");
        insert_edge(&mut conns, "C", "A");
        assert!(detect_cycles(&conns, CycleScope::Main));
        assert_eq!(
            find_cycle(&conns, CycleScope::Main),
            Some(vec!["A".to_string(), "B".to_string(), "C".to_string()])
        );
    }

    #[test]
    fn self_loop_is_a_cycle() {
        let mut conns = BTreeMap::new();
        insert_edge(&mut conns, "A", "A");
        assert!(detect_cycles(&conns, CycleScope::Main));
        assert_eq!(find_cycle(&conns, CycleScope::Main), Some(vec!["A".to_string()]));
    }

    #[test]
    fn scope_main_ignores_non_main_edges() {
        let mut by_type = BTreeMap::new();
        by_type.insert(
            "ai_tool".to_string(),
            vec![Some(vec![Connection {
                node: "A".to_string(),
                type_: "ai_tool".to_string(),
                index: 0,
            }])],
        );
        let mut conns = BTreeMap::new();
        conns.insert("A".to_string(), by_type);
        // A → A via ai_tool only.
        assert!(!detect_cycles(&conns, CycleScope::Main));
        assert!(detect_cycles(&conns, CycleScope::All));
    }

    #[test]
    fn duplicate_edges_do_not_false_positive() {
        let mut by_type = BTreeMap::new();
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
        assert!(!detect_cycles(&conns, CycleScope::Main));
    }
}
