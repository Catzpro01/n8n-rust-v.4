# Connection LEGO — Rust port specification for `crates/n8n-connection`

| Field | Value |
| :--- | :--- |
| Author | `agent-3` — Connection & Graph Traversal Engineer |
| Executor | **Orchestrator on the VPS host** (`cargo test -p n8n-connection`). agent-3 does not touch `crates/**` (manifest boundary). |
| Source of truth | n8n 2.9.4 `reference/n8n/packages/workflow/src/{common/**, graph/graph-utils.ts, connections-diff.ts, interfaces.ts}` — every algorithm below is transcribed from those files, with line refs |
| Contract | `contracts/connection.contract.md` §1–§3, §8 |
| Oracle | `python3 tests/reference/harness/tools/simulate-connection-port.py` — a literal Python transcription of §3–§6 that scores **32/32** on every non-`wf.*` probe of the 5 fixtures (no cargo needed). If the Rust port and the oracle disagree, diff the Rust against the oracle function of the same name. |
| Acceptance | the 5 runtime-pinned fixtures `tests/reference/connection/{01..05}/{case,expected}.json` pass through the fixture runner in §7 — byte-identical JSON after canonicalisation |
| Fixes | `docs/isolation/connection-rust-conformance.md` R-01, R-02, R-03, R-04, R-05 (R-06 is Agent 4's) |
| Baseline reviewed | `crates/n8n-connection/src/lib.rs` @ `182df8de` (30 lines + 1 unit test) |

Conventions: Rust names are `snake_case` of the TypeScript name. JSON shape on the wire is **the TypeScript
shape** (serde renames), because fixtures and the future engine both speak that shape.

---

## 1. Cargo

```toml
[dependencies]
n8n-common = { path = "../n8n-common" }
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
indexmap = { version = "2", features = ["serde"] }   # NEW — R-03: JS objects iterate in insertion order
```

`indexmap` should be added to `[workspace.dependencies]` in the root `Cargo.toml` (Agent 1/Orchestrator).
No other new dependency. **Do not** use `petgraph` here: the reference algorithms are ~300 lines of plain
loops and their *ordering* is part of the contract; a generic graph library would change it.

---

## 2. Types (`interfaces.ts:396-419`, `graph-utils.ts:29-36,165`, `connections-diff.ts:3-13`)

```rust
use indexmap::{IndexMap, IndexSet};
use serde::{Deserialize, Serialize};

/// interfaces.ts — IConnection { node, type, index }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Connection {
    pub node: String,
    #[serde(rename = "type")]
    pub connection_type: String,      // NodeConnectionType is a closed string union; keep String (contract CD-07 type-only)
    pub index: usize,
}

/// interfaces.ts:404 — NodeInputConnections = Array<IConnection[] | null>
/// R-01: a slot may be `null`, `[]`, or a list. `None` <=> JSON null. MUST round-trip unchanged.
pub type Slot = Option<Vec<Connection>>;
pub type NodeInputConnections = Vec<Slot>;

/// interfaces.ts:412 — INodeConnections = { [type]: NodeInputConnections }
pub type NodeConnections = IndexMap<String, NodeInputConnections>;

/// interfaces.ts:416 — IConnections = { [nodeName]: INodeConnections }  (source-keyed OR destination-keyed)
pub type Connections = IndexMap<String, NodeConnections>;

/// get-connected-nodes.ts:7 — connectionType: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN'
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeFilter { Type(String), All, AllNonMain }
impl Default for TypeFilter { fn default() -> Self { TypeFilter::Type("main".into()) } }

/// graph-utils.ts:36 — Map<string, Set<IConnection>>  (insertion-ordered set: JS Set semantics)
pub type AdjacencyList = IndexMap<String, IndexSet<Connection>>;

/// graph-utils.ts:29
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "errorCode")]
pub enum ExtractableError {
    #[serde(rename = "Multiple Input Nodes")]  MultipleInputNodes { nodes: Vec<String> },   // Set -> Vec in insertion order
    #[serde(rename = "Multiple Output Nodes")] MultipleOutputNodes { nodes: Vec<String> },
    #[serde(rename = "Input Edge To Non-Root Node")] InputEdgeToNonRootNode { node: String },
    #[serde(rename = "Output Edge From Non-Leaf Node")] OutputEdgeFromNonLeafNode { node: String },
    #[serde(rename = "No Continuous Path From Root To Leaf In Selection")] NoContinuousPath { start: String, end: String },
}

/// graph-utils.ts:165 — { start?: string; end?: string }
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct ExtractableSubgraphData {
    #[serde(skip_serializing_if = "Option::is_none")] pub start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub end: Option<String>,
}

/// graph-utils.ts:209 return type
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ExtractableSelection { Ok(ExtractableSubgraphData), Errors(Vec<ExtractableError>) }

/// connections-diff.ts:3-13
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiffValue { pub index: usize, pub connection: Connection }
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ConnectionEntry {
    #[serde(rename = "sourceIndex")] pub source_index: usize,
    pub value: Option<DiffValue>,                       // typed `| null` upstream; in practice always Some
}
pub type NodeConnectionsDiff = IndexMap<String, Vec<ConnectionEntry>>;   // keyed by connection type
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct ConnectionsDiff {
    pub added:   IndexMap<String, NodeConnectionsDiff>,
    pub removed: IndexMap<String, NodeConnectionsDiff>,
}
```

Migration note for existing consumers (`crates/n8n-workflow/src/lib.rs:1,22-23,65-110`,
`crates/n8n-validation/src/lib.rs:24-99`): `ConnectionItem → Connection`, `WorkflowConnections →
Connections`, and every inner loop gains one level: `for slot in list { for item in slot.iter().flatten() {…} }`.
Keep the old names as `pub type` aliases for one release if you want a zero-diff migration.

---

## 3. `get_connected_nodes` (`common/get-connected-nodes.ts:4-96`) — fixes R-02

```rust
pub fn get_connected_nodes(
    connections: &Connections,       // source-keyed => children; destination-keyed => parents
    node_name: &str,
    connection_type: &TypeFilter,    // default TypeFilter::Type("main")
    depth: i64,                      // -1 = unlimited (default)
    checked_nodes_incoming: Option<&[String]>,
) -> Vec<String>
```

Algorithm — transcribe **exactly**, ordering is contractual (`expected.json` 01 "children of Trigger (order:
farthest first)"):

1. `new_depth = if depth == -1 { -1 } else { depth - 1 }`; `if depth == 0 { return vec![] }` (L18-22).
2. `let Some(by_type) = connections.get(node_name) else { return vec![] }` (L24-27).
3. `types`: `All` → all keys of `by_type` in map order; `AllNonMain` → same minus `"main"`; `Type(t)` → `[t]` (L29-37).
4. `return_nodes: Vec<String> = []`. For each `type` in `types` (L45-92):
   1. skip if `by_type` has no key `type`.
   2. `checked = checked_nodes_incoming.cloned() or []`; if `checked.contains(node_name)` → skip this type (`continue`, not return); `checked.push(node_name)`. **Note:** `checked` is per-type (created inside the loop) — replicate that.
   3. For each `slot` in `by_type[type]` (skip `None`), for each `connection` in slot:
      - if `checked.contains(&connection.node)` → skip.
      - `return_nodes.insert(0, connection.node.clone())` (**unshift**, L67).
      - `add_nodes = get_connected_nodes(connections, &connection.node, connection_type, new_depth, Some(&checked))`.
      - for `i` in `(0..add_nodes.len()).rev()` (L77 — iterates from last to first): `name = add_nodes[i]`; if `return_nodes` contains `name`, remove it at its current position (L86); then `return_nodes.insert(0, name)` (L89).
5. Return `return_nodes`.

Semantics checklist (all pinned): transitive by default; result deduplicated; farthest ancestor/descendant first;
depth 1 = direct neighbours only (`02 "children of IF depth 1"`); cycle terminates via `checked`
(`04 "parents of End through cycle terminate"`); unknown node → `[]` (`01 "unknown node"`); `ALL`
unions all types, `ALL_NON_MAIN` excludes `main` (`03`).

Convenience wrappers (`common/get-child-nodes.ts`, `get-parent-nodes.ts` — both are one-liners):

```rust
pub fn get_child_nodes(by_source: &Connections, n: &str, t: &TypeFilter, depth: i64) -> Vec<String>
    { get_connected_nodes(by_source, n, t, depth, None) }
pub fn get_parent_nodes(by_destination: &Connections, n: &str, t: &TypeFilter, depth: i64) -> Vec<String>
    { get_connected_nodes(by_destination, n, t, depth, None) }
```

`getNodeByName` (`common/get-node-by-name.ts`) is `nodes.iter().find(|n| n.name == name)` — trivially
belongs to whichever crate owns `INode`; not part of this port.

---

## 4. `map_connections_by_destination` (`common/map-connections-by-destination.ts:5-49`) — fixes R-04

```rust
pub fn map_connections_by_destination(connections: &Connections) -> Connections
```

For each `(source_node, by_type)` in map order; for each `(type, slots)` in map order; for each
`(input_index, slot)` in `slots.iter().enumerate()`; for each `info` in `slot.iter().flatten()`:

1. `entry = ret[info.node][info.connection_type]` (create `IndexMap` / `Vec` on first touch).
2. **Padding rule** (L38-41): `max_index = entry.len() as i64 - 1; for _ in max_index..info.index { entry.push(Some(vec![])) }` — i.e. pad with **`Some([])`, never `None`**, until `entry.len() == info.index + 1`. Fixture: `02 "byDest End (dest index 2 padded with [])"` → `[[…], [], […]]`.
3. `entry[info.index].get_or_insert_with(Vec::new).push(Connection { node: source_node, connection_type: type, index: input_index })` (L43-47; upstream uses `?.push` which is a no-op on `null` — unreachable after step 2, but keep the `Option` handling).

Note (L21-25): upstream uses `for…in` over the array, which **skips holes but visits `null`**; `?? []` then
turns `null` into no-op. `iter().enumerate()` + `flatten()` is equivalent because JSON has no holes.

Invariant C1 (contract §1): source→destination inversion is lossless; `01 "byDestination"` pins the full map.

---

## 5. Graph utilities (`graph/graph-utils.ts`) — fixes R-05 (part 1)

All take `graph_ids: &IndexSet<String>` (JS `Set<string>`) and `adj: &AdjacencyList`; ordering of every
returned `Vec`/`IndexSet` = iteration order of the inputs. Private helpers `intersection`, `union`,
`difference` (L73-98) keep **left-operand order**.

| Rust | Source | Algorithm |
| :--- | :--- | :--- |
| `build_adjacency_list(by_source: &Connections) -> AdjacencyList` | L170-204 | for `source` in map order, for `type` in map order, for `slot` in order, for `conn` in `slot.iter().flatten()`: `adj.entry(source).or_default().insert(conn.clone())` — `IndexSet::insert` gives JS-`Set` dedup + insertion order. **All connection types are included.** Only sources with ≥1 non-`null` connection get a key. |
| `get_input_edges(graph_ids, adj) -> Vec<(String, Connection)>` | L41-56 | for `(from, tos)` in adj: `if graph_ids.contains(from) continue`; push `(from, to)` for each `to` with `graph_ids.contains(&to.node)`. Serialise as JSON array `[from, {node,type,index}]` (tuple) — see `04 "getInputEdges"`. |
| `get_output_edges(graph_ids, adj) -> Vec<(String, Connection)>` | L62-76 | mirror: `from` **in** graph, `to.node` **not** in graph. |
| `get_root_nodes(graph_ids, adj) -> IndexSet<String>` | L103-118 | `inner = ⋃_{id ∈ graph_ids} { x.node : x ∈ adj[id], x.type == "main", x.node != id }`; return `difference(graph_ids, inner)`. **`main`-only, self-loops ignored** (contract §3.7). |
| `get_leaf_nodes(graph_ids, adj) -> IndexSet<String>` | L123-140 | `id` is a leaf iff `{ x.node : x ∈ adj[id], x.type=="main", x.node != id } ∩ graph_ids == ∅`. |
| `has_path(start, end, adj) -> bool` | L145-160 | DFS with an explicit **stack** (`Vec`, `pop()` = last): `paths = [start]`; loop: `next = paths.pop()`; `if next == end → true`; `if None → false`; `seen.insert(next)`; `paths.extend(difference({x.node : x ∈ adj[next], x.type=="main"}, seen))`. Note `start == end` returns `true` immediately (`04 "hasPath Merge->Merge via Loop"` relies on the check happening **before** expansion). `main`-only. |
| `parse_extractable_subgraph_selection(graph_ids, adj) -> ExtractableSelection` | L209-273 | see below |

`parse_extractable_subgraph_selection`, in order (error order is part of the output, `04 "parseExtractable"`):

1. `input_edges = get_input_edges`; `input_nodes = { e.1.node : e.1.type == "main" }` (IndexSet, edge order).
2. `root_nodes = get_root_nodes`; `if root_nodes.is_empty() && input_nodes.len() == 1 { root_nodes = input_nodes.clone() }`.
3. for `n` in `difference(input_nodes, root_nodes)` → push `InputEdgeToNonRootNode { node: n }`.
4. `root_input = intersection(root_nodes, input_nodes)`; `if root_input.len() > 1` → push `MultipleInputNodes { nodes: root_input }`.
5. `output_edges = get_output_edges`; `output_nodes = { e.0 : e.1.type == "main" }`.
6. `leaf_nodes = get_leaf_nodes`; `if leaf_nodes.is_empty() && output_nodes.len() == 1 { leaf_nodes = output_nodes.clone() }`.
7. for `n` in `difference(output_nodes, leaf_nodes)` → push `OutputEdgeFromNonLeafNode { node: n }`.
8. `leaf_output = intersection(leaf_nodes, output_nodes)`; `if leaf_output.len() > 1` → push `MultipleOutputNodes { nodes: leaf_output }`.
9. `start = root_input.first()`, `end = leaf_output.first()`; if both `Some` and `!has_path(start, end, adj)` → push `NoContinuousPath { start, end }`.
10. `if errors non-empty { Errors(errors) } else { Ok(ExtractableSubgraphData { start, end }) }` — note upstream returns `{ start, end }` with `undefined` fields **omitted** in JSON, hence `skip_serializing_if`.

---

## 6. `compare_connections` (`connections-diff.ts:15-87`) — fixes R-05 (part 2)

```rust
pub fn compare_connections(prev: &Connections, next: &Connections) -> ConnectionsDiff
```

1. `all_nodes = keys(prev) ∪ keys(next)` in that order (IndexSet).
2. For each `node`: `prev_types = prev.get(node) or empty`, `next_types` likewise; `all_types = keys(prev_types) ∪ keys(next_types)`.
3. For each `type`: `prev_slots`, `next_slots` (or empty); `max_len = max(len)`; for `source_index in 0..max_len`: `prev_c = prev_slots.get(i).flatten() or []`, `next_c` likewise (`?? []` covers both out-of-range and `null`, L43-44).
4. Identity key = **`serde_json::to_string(&Connection)` with field order `node, type, index`** (`JSON.stringify(conn)`, L47-58). Build `prev_map`, `next_map: IndexMap<String, DiffValue{index: idx, connection}>` — later duplicates overwrite earlier ones, same as `new Map(...)`.
5. `for (key, value) in next_map: if !prev_map.contains(key) → added[node][type].push(ConnectionEntry{source_index, value: Some(value)})` (L60-70); then the mirror for `removed` (L72-82).
6. Nodes/types with no differences must **not** appear as empty maps (created lazily, L63-64).

Pinned by `05 "diff"`. Caveat (contract §3.8): because the key is the *serialised* connection, any
re-ordering of struct fields or float formatting changes the diff — keep `Connection` field order and
`usize` index.

---

## 7. Fixture runner (integration test, `crates/n8n-connection/tests/reference_fixtures.rs`)

Load every `tests/reference/connection/*/case.json` (path relative to `CARGO_MANIFEST_DIR/../../`), build
`by_dest = map_connections_by_destination(&conn)` and `adj = build_adjacency_list(&conn)` once, then evaluate
`case.probes[]` and compare each `out[probe.name]` to `expected.json[probe.name]` as `serde_json::Value`.

| `probe.op` | Rust call | Result → JSON |
| :--- | :--- | :--- |
| `byDestination` | `by_dest.get(node)` (or whole map if `node` absent) | `Connections` as-is; missing node → skip probe ¹ |
| `getChildNodes` | `get_child_nodes(&conn, node, &filter(type), depth.unwrap_or(-1))` | `Vec<String>` |
| `getParentNodes` | `get_parent_nodes(&by_dest, node, &filter(type), depth.unwrap_or(-1))` | `Vec<String>` |
| `getConnectedNodes` | `get_connected_nodes(&conn, node, &filter(type), depth.unwrap_or(-1), None)` | `Vec<String>` |
| `adjacencyKeys` | `adj.keys()` (harness op, currently unused by fixtures) | `Vec<String>` |
| `getRootNodes` / `getLeafNodes` | `(IndexSet::from(probe.graph), &adj)` | `Vec<String>` (Set → array) |
| `getInputEdges` / `getOutputEdges` | idem | `[[from, {node,type,index}], …]` |
| `hasPath` | `has_path(start, end, &adj)` | `bool` |
| `parseExtractable` | `parse_extractable_subgraph_selection` | `ExtractableSelection` (Set fields → arrays) |
| `compareConnections` | `compare_connections(&conn, &probe.next)` | `ConnectionsDiff` |
| `wf.*` (`getNodeConnectionIndexes`, `getHighestNode`, `getStartNode`, `getParentMainInputNode`, `getParentNodesByDepth`) | **skip in this crate** — these are `Workflow` members (Agent 1, `crates/n8n-workflow`); their expected values stay in the fixture for the workflow crate to consume later | — |

`filter(type)`: `None → Type("main")`, `"ALL" → All`, `"ALL_NON_MAIN" → AllNonMain`, other → `Type(s)`.
¹ upstream returns `undefined` → harness writes `{"undefined": true}`; mirror that literal if you prefer full parity.

Canonicalisation: compare `serde_json::Value`s directly — `IndexMap` + serde preserves insertion order,
so object key order also matches (the JS harness's `plain()` did the same via `JSON.parse(JSON.stringify)`).

Expected count after this spec: **5/5 cases, 0 skipped probes other than `wf.*`**. If any probe differs,
the fixture wins — it is observed 2.9.4 runtime behaviour (`UPDATE=1 node tests/reference/harness/run.js`
regenerates it), never hand-written.

---

## 8. Explicitly out of scope for this crate

* `Workflow` members (`getNodeConnectionIndexes` BFS, `getHighestNode`, `getStartNode`, `getParentMainInputNode`,
  `getParentNodesByDepth`) — Agent 1, `crates/n8n-workflow`, consumes §3–§4 via Option A / `P-CONNECTION-GRAPH`.
* Port-count validation (`NodeHelpers.getNodeInputs/getNodeOutputs`, trailing `Error` output) — Agent 2 (CD-05).
* Cycle detection / topological sort — `crates/n8n-validation::detect_cycles` (Agent 4, ISSUE-003 Option A).
  Must stay opt-in: cycles are legal in 2.9.4 (`04-cycle` fixture executes, contract §3.6). See R-06.
* Any `Workflow::renameNode` behaviour (D-08) — the Rust `rename_node` already rewrites both directions; record
  it as a deliberate improvement over 2.9.4 in `crates/n8n-workflow`, not here.

## 9. Definition of done (for the Orchestrator's `cargo test`)

- [ ] `cargo test -p n8n-connection` green, including `tests/reference_fixtures.rs` 5/5.
- [ ] `cargo test --workspace` green (n8n-workflow / n8n-validation migrated to `Slot = Option<Vec<_>>`).
- [ ] No `HashMap` left in the public types of `n8n-connection`.
- [ ] `docs/isolation/connection-rust-conformance.md` R-01…R-05 marked closed with the commit hash; agent-3 re-reviews on request.
