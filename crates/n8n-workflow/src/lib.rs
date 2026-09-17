//! # n8n-workflow — LEGO `workflow` (pure domain model)
//!
//! Rust port of the PURE part of n8n's workflow domain model.
//!
//! | Property | Value |
//! | :--- | :--- |
//! | LEGO ID | `workflow` |
//! | Owner | agent-1 |
//! | Lifecycle phase | 3 — RUST IMPLEMENTED |
//! | Upstream reference | `reference/n8n/packages/workflow/src/workflow.ts` + `src/common/*.ts` (n8n v2.9.4) |
//! | Spec | `docs/isolation/workflow_spec.md` |
//! | Contract | `contracts/workflow.contract.md` |
//! | Differential tests | `tests/compatibility/` (Node reference harness + golden outputs) |
//!
//! Golden invariants (enforced by design, see spec §5):
//! - **Determinism** — only `BTreeMap`/`Vec`; same input always yields the
//!   same adjacency structures and iteration order.
//! - **Zero side effects** — no IO/HTTP/DB/global state anywhere.
//! - **Non-destructive** — all validation and queries are read-only.
//!
//! Zero external dependencies (std only) by design.

pub mod compat_engine;
pub mod cycles;
pub mod graph;
pub mod json;
pub mod maps;
pub mod model;
pub mod start;

pub use cycles::{detect_cycles, find_cycle, CycleScope};
pub use graph::{get_child_nodes_typed, get_connected_nodes, get_parent_nodes_typed, ALL, ALL_NON_MAIN};
pub use json::{canonicalize, parse_document, Json};
pub use maps::{build_connection_maps, map_connections_by_destination};
pub use model::{
    get_node, Connection, Connections, INode, NodeConnectionMapping, Workflow, WorkflowParameters,
    MAIN,
};
pub use start::get_start_nodes;
