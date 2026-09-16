# Connection LEGO — Rust crate conformance review (Phase 3, first cut)

| Field | Value |
| :--- | :--- |
| Reviewer | `agent-3` — Connection & Graph Traversal Engineer |
| Subject | `crates/n8n-connection` (+ its consumers) as committed in `c912866b` "feat(phase-3): initialize Rust workspace" |
| Against | `contracts/connection.contract.md` (§1–§3, §8), `tests/reference/connection/{01..05}` (pinned on n8n 2.9.4 runtime) |
| Method | **static read only** — `cargo` is not installed in the agent-3 sandbox, so nothing was compiled or run. Every finding below cites a line in the crate and a line in the contract/reference. |
| Scope rule | agent-3 did **not** edit `crates/**` (still a forbidden path in `tasks/TASK-30X-connection.yaml`). This document is a hand-off; fixes need an explicit task manifest. |

## 0. Verdict

**NOT CONFORMANT yet — 3 blocking, 3 advisory.** The crate is a reasonable skeleton, but as written it
cannot deserialize 4 of the 5 pinned fixtures and its only traversal function has different semantics
from the reference `getConnectedNodes`. Nothing here is surprising for a first cut; it is listed so the
Rust work converges on the contract rather than on the TypeScript *names*.

## 1. Blocking (reference tests would fail)

### R-01 — `null` output slots are not representable

| | |
| :--- | :--- |
| Crate | `crates/n8n-connection/src/lib.rs:12-14` — `NodeConnections = HashMap<String, Vec<ConnectionOutput>>`, `ConnectionOutput = Vec<ConnectionItem>` |
| Reference | `interfaces.ts:404` — `NodeInputConnections = Array<IConnection[] \| null>` |
| Contract | §1 data schema; §3 invariant 3 "Sparse output slots (`[]`, `null`) are valid and preserved" |
| Evidence | `tests/reference/connection/02-multi-output/case.json:237` (`"Sparse": { "main": [ [], null, [...] ] }`); same shape in cases 03, 04, 05 |
| Effect | `serde_json` will reject `null` where `Vec<ConnectionItem>` is expected → cases 02–05 fail at load time |
| Fix shape | `ConnectionOutput = Option<Vec<ConnectionItem>>` (or a custom `Slot` enum). `mapConnectionsByDestination` must then pad missing input indexes with `[]`, not `None` (contract §3.3, pinned in case 02 `expected.json`) |

### R-02 — `get_connected_nodes` is not the reference `getConnectedNodes`

| | |
| :--- | :--- |
| Crate | `lib.rs:16-29` — `(connections, source_node) -> Vec<String>`; one hop; unions **all** connection types; dedup by first-seen |
| Reference | `common/get-connected-nodes.ts:11-18` — `(connections, nodeName, connectionType = 'main' \| 'ALL' \| 'ALL_NON_MAIN', depth = -1, checkedNodesIncoming?)`; **transitive** (depth −1 = unlimited), cycle-safe via `checkedNodes`, result order = farthest-first (recursion result is prepended) |
| Contract | §2 input table; §3 invariant 5 "deduplicated, farthest-first, depth-bounded, terminate on cycles"; invariant 7 (type filtering) |
| Evidence | case 01 `expected.json` (`getChildNodes("Start")` lists the whole downstream chain, farthest first); case 03 (`'ALL'` vs `'ALL_NON_MAIN'` vs default `main`); case 04 (cycle terminates) |
| Effect | Wrong result for any graph deeper than one hop; wrong result for any AI-typed edge under the default; `crates/n8n-workflow/src/lib.rs:65-67` inherits the defect for `get_child_nodes` |
| Fix shape | Port `get-connected-nodes.ts` line-by-line (it is 60 lines, pure), with an enum `ConnectionTypeFilter { Type(String), All, AllNonMain }` and `depth: i64` (−1 = unlimited). Keep the "prepend recursive result" ordering exactly |

### R-03 — Iteration order is `HashMap` order → non-deterministic output

| | |
| :--- | :--- |
| Crate | `WorkflowConnections = HashMap<String, NodeConnections>` (`lib.rs:13-14`); `get_parent_nodes` in `crates/n8n-workflow/src/lib.rs:69-82` iterates it |
| Reference | JS objects iterate in insertion order (`Object.keys`), and every pinned `expected.json` depends on that |
| Contract | §8.2 invariant 3 "Deterministic ordering … no sorting is performed" |
| Effect | Test results differ run-to-run; `compareConnections` diff keys and traversal lists cannot be compared to fixtures |
| Fix shape | `indexmap::IndexMap` (with `serde` feature) for both map levels; keep slot vectors as `Vec` |

## 2. Advisory (correct today, will bite in the next step)

### R-04 — No destination-keyed index

`Workflow` in Rust only holds `connections_by_source_node` (`crates/n8n-workflow/src/lib.rs:22-23`) and
computes parents by a full scan. The reference keeps `connectionsByDestinationNode` built by
`mapConnectionsByDestination` (contract §1 C1 — lossless inversion; case 02 pins the padding rule).
Two consequences: (a) `getParentNodes` in the reference takes `type`/`depth` like children do; (b) the
inversion function is part of the Connection surface and has its own fixture. Recommend adding
`map_connections_by_destination` to `n8n-connection` and letting `n8n-workflow` cache it. Note the Rust
`rename_node` (`lib.rs:84-110`) rewrites targets in place — that is actually *better* than the reference
(**D-08**: reference `renameNode` leaves `connectionsByDestinationNode` stale). Keep the better behaviour,
but document it as a deliberate deviation from 2.9.4, not silently.

### R-05 — `P-CONNECTION-GRAPH` surface absent

None of the 13 exports declared in `contracts/connection.contract.md` §8.1 exist yet
(`build_adjacency_list`, `get_root_nodes`, `get_leaf_nodes`, `get_input_edges`, `get_output_edges`,
`has_path`, `parse_extractable_subgraph_selection`, `compare_connections` + 5 types). Expected for a
skeleton; listing so the crate's `lib.rs` grows toward that table. `compare_connections` identity rule =
JSON of `{node,type,index}` (contract §3.8, case 05).

### R-06 — Cycle detection placement

`crates/n8n-validation/src/lib.rs:46-99` `detect_cycles` returns `Err` on any cycle. That matches
ISSUE-003 Option A (**enforcement capability owned by Validation**) — but contract §3 invariant 6 says
cycles are **legal** in 2.9.4 (Loop nodes; case 04). So `detect_cycles` must be opt-in and must never be
called from `Workflow::new` or from the default validate path. It also ignores connection type; the
reference partial-execution SCC logic works on `main` edges only (`docs/isolation/connection.md` §6).
Owner: Agent 4 — flagged, not fixed.

## 3. Things that are right

* Dependency direction `n8n-workflow → n8n-connection` (`crates/n8n-workflow/Cargo.toml`) matches
  **Option A** (Connection provides, Workflow consumes) — the same direction as `P-CONNECTION-GRAPH`.
* `ConnectionItem { node, type (serde rename), index: usize }` matches `IConnection` exactly.
* `n8n-connection` depends only on `n8n-common` + serde/thiserror — no coupling to node-model or
  expression, consistent with contract §8.2 invariant 1.

## 4. Suggested test wiring (no code written here)

The five fixtures under `tests/reference/connection/*/case.json` + `expected.json` are runtime-pinned
against n8n 2.9.4 (`node tests/reference/harness/run.js connection`, 5/5). A Rust integration test that
loads `case.json`, runs the same `calls[]` list, and compares JSON to `expected.json` is the cheapest
way to make R-01…R-03 objectively green; that is the equivalent of Agent 1's `beforeVsAfter` for this LEGO.

## 5. Reproduce

```bash
git show c912866b --stat
sed -n 12,29p crates/n8n-connection/src/lib.rs
sed -n 404p reference/n8n/packages/workflow/src/interfaces.ts
sed -n 11,60p reference/n8n/packages/workflow/src/common/get-connected-nodes.ts
grep -n null tests/reference/connection/*/case.json
```
