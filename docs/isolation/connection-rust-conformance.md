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

---

# Re-review #2 — `crates/n8n-connection` @ `6603ebc7`..`b6a3389b` (main, merged as `de9f5a2a`)

| Field | Value |
| :--- | :--- |
| Timing | implementation commit `6603ebc7` is timestamped **06:04 +0700**, the port spec `d5476e94` **06:10 +0700** — the crate pre-dates the spec and does not reference it. `results/TASK-402-connection-spec.md` records `SUCCESS` with an empty operations table (nothing was executed against the spec). |
| Method | static read; still no `cargo` in the agent-3 sandbox |
| Verdict | **R-01, R-02, R-03 still OPEN. R-04 partially addressed (`invert_connections`). New: R-07, R-08.** 0 of the 5 pinned fixtures would load. |

## Per-finding status

| ID | Status | Evidence @ `lib.rs` |
| :--- | :--- | :--- |
| R-01 `null` slots | **OPEN** | L12 `ConnectionOutput = Vec<ConnectionItem>` unchanged → `case.json` 02–05 (`null` at `Sparse.main[1]`) still fail to deserialise |
| R-02 `get_connected_nodes` semantics | **OPEN** | L16-30 unchanged: one hop, all types, no depth, first-seen order. Spec §3 gives the exact transcription |
| R-03 ordering | **OPEN** | L2 `HashMap`; `indexmap` not in workspace deps |
| R-04 destination index | **PARTIAL** | L33-60 `invert_connections` — algorithm matches `mapConnectionsByDestination` (padding with `Vec::new()` = `[]` ✔, `index: out_idx` ✔). Blocked by R-01 (cannot represent `null` input) and R-03 (`HashMap` output order). Rename to `map_connections_by_destination` per spec §4 so the name matches the contract symbol. `crates/n8n-workflow` does not use it yet (still full-scan `get_parent_nodes`) |
| R-05 `P-CONNECTION-GRAPH` surface | **OPEN** | only `has_path` exists, and with the wrong shape (R-07). Missing: `build_adjacency_list`, `get_input_edges`, `get_output_edges`, `get_root_nodes`, `get_leaf_nodes`, `parse_extractable_subgraph_selection`, `compare_connections` + types |
| **R-07** `has_path` deviates from reference | **NEW / blocking for fixture 01,03,04** | L63-87: signature `(connections, from, to)` operates on `Connections`, not on an `AdjacencyList` (`graph-utils.ts:145`); traverses **all connection types** via `get_connected_nodes`, whereas the reference filters `x.type === 'main'` (contract §3.7, spec §5). Fixture `03-connection-types` has `hasPath` probes over `ai_tool` edges that must return `false`. BFS vs reference's DFS stack is fine for a boolean, but keep the reference signature so `parse_extractable_subgraph_selection` can call it |
| **R-08** no fixture runner | **NEW** | `crates/n8n-workflow/tests/conformance.rs` reads `tests/reference/0{1,3}-*/workflow.json` (Agent 1 fixtures) and only asserts node count/uniqueness. Nothing loads `tests/reference/connection/*/case.json`. Spec §7 defines the runner; until it exists, "conformance" for this LEGO is not measured |

## What is right in this drop
* `invert_connections` padding rule and source-index mapping are correct (spec §4 steps 2–3).
* `has_path(from == to) → true` short-circuit matches reference ordering (spec §5).
* `b6a3389b` (owned `String` in BFS) is a legitimate borrow fix, no behavioural concern.

## Requested next step (Orchestrator / VPS host)
Apply `docs/isolation/connection-rust-port-spec.md` §1–§7 in order; the DoD in §9 is unchanged. agent-3
will re-review on the next `main` drop that touches `crates/n8n-connection`.

---

# Re-review #3 — `crates/n8n-connection` @ `8ed00851` + `9e87c8cb` (main, merged as `293f430c`)

| Field | Value |
| :--- | :--- |
| Claim under review | commit message "resolve R-01..R-05" |
| Method | static read **plus an executable oracle**: `tests/reference/harness/tools/simulate-connection-port.py` re-implements (a) spec §3 literally and (b) the algorithm now in `lib.rs`, in Python, and runs both against the 5 pinned fixtures. No cargo needed; anyone can re-run it. |
| Verdict | **R-01 ✅ R-03 ✅ R-04 ✅ closed. R-02 ❌ still open (13/19 probes). R-05 ❌ not started. R-07 ❌ still open. R-08 ❌ still open.** |

## Oracle output

```
spec §3 transcription:              19/19   (proves the spec itself reproduces 2.9.4 on every traversal/byDest probe)
crates/n8n-connection @ 8ed00851:   13/19
```

Six mismatches, all in `get_connected_nodes`:

| Fixture :: probe | crate | reference |
| :--- | :--- | :--- |
| 02 :: children of IF depth 1 | `[A, B, Merge]` | `[Merge, B, A]` |
| 03 :: parents Agent main | `[Trigger, A, IF, Merge, Loop, Sparse, End]` | `[Sparse, Trigger, IF, A, Merge, Loop, End]` |
| 03 :: parents Agent ALL_NON_MAIN | `[Model, Tool]` | `[Tool, Model]` |
| 03 :: parents Agent ALL | `[Trigger, …, End, Model, Tool]` | `[Tool, Model, Sparse, Trigger, IF, A, Merge, Loop, End]` |
| 04 :: parents of End through cycle | `[Trigger, A, IF, Merge, Loop, Sparse]` | `[Sparse, Trigger, IF, A, Merge, Loop]` |
| 04 :: children of Merge through cycle | `[Agent, Merge, End, Loop]` | `[Agent, End, Loop]` |

## Per-finding status

| ID | Status | Evidence |
| :--- | :--- | :--- |
| R-01 `null` slots | **CLOSED** | `ConnectionOutput = Option<Vec<ConnectionItem>>` (L13); fixtures 02–05 now deserialise |
| R-02 traversal semantics | **OPEN** | L35-110 is a *re-design* ("collect direct, recurse, prepend"), not the transcription in spec §3. Three concrete deviations: (1) `direct_nodes` are appended in slot order and emitted **last in insertion order**, whereas the reference `unshift`s each one → direct neighbours must come out **reversed** (probe 02, 03 ALL_NON_MAIN); (2) `checked_nodes` is a single shared `HashSet` for the whole call, whereas the reference copies `checkedNodes` **per type and per recursion branch** (L52) — so a node reachable via two branches is visited twice upstream and its final position is decided by the *last* branch (probes 03/04 "parents", `Sparse` first); (3) because of (2) the start node itself can be re-emitted when a cycle returns to it — upstream skips it only via the branch-local `checked` list, and the crate's global set makes `Merge` appear in its own children list (probe 04 "children of Merge"). Fix = transcribe §3 steps 1–5 literally (`Vec<String>` for `checked`, cloned per type; `insert(0, …)`; reverse loop with remove-then-prepend). The oracle's `ref_gcn` is a 25-line executable version of exactly that. |
| R-03 ordering | **CLOSED** | `IndexMap` at both levels (L14-15); `indexmap = 2.2.6` pinned in workspace (`9e87c8cb`) |
| R-04 destination index | **CLOSED** | `map_connections_by_destination` (L113-146) — padding `Some(vec![])`, `index: out_idx`; oracle byDest probes 5/5. `crates/n8n-workflow` still computes parents by full scan instead of caching this map — advisory, Agent 1 |
| R-05 `P-CONNECTION-GRAPH` | **OPEN** | none of `build_adjacency_list`, `get_input_edges`, `get_output_edges`, `get_root_nodes`, `get_leaf_nodes`, `parse_extractable_subgraph_selection`, `compare_connections`, nor the 5 types exist. Fixtures 02 (roots/leaves), 04 (edges/extractable/hasPath), 05 (diff) cannot be exercised |
| R-07 `has_path` | **OPEN** | L149-172 still `(connections, from, to)` with `ConnectionTypeFilter::All` — reference is `main`-only over an `AdjacencyList` (`graph-utils.ts:145`, spec §5). Probe 03 `hasPath` via `ai_tool` edges would return `true` instead of `false` |
| R-08 fixture runner | **OPEN** | no `crates/n8n-connection/tests/`; only 2 unit tests in `lib.rs`. Spec §7 unchanged |

## Bottom line for the Orchestrator
3 of 5 claimed findings are genuinely closed — good progress, and the type layer is now right. But
`get_connected_nodes` must be a **transcription**, not a re-design: the reference's ordering is an
accident of `unshift` + per-branch `checked` copies, and it is pinned. Please (1) replace L35-110 with spec
§3 (oracle `ref_gcn` is the executable form), (2) add spec §5–§6, (3) add the §7 runner; then `cargo test
-p n8n-connection` should show 5/5 and agent-3 will confirm with the same oracle.

### Addendum (after `1e268085`)
`1e268085` touches only `crates/n8n-workflow` (`shift_remove`); `crates/n8n-connection` is byte-identical to
`8ed00851`, so Re-review #3 stands. The oracle now also covers spec §5 (7 graph utilities) and §6
(`compare_connections`): **spec transcription 32/32** across all non-`wf.*` probes — i.e. the spec is a
complete, verified description of what R-05/R-07 must produce.

---

# Re-review #4 — same crate (`8ed00851`), now **compiled and executed** (rustc 1.88.0 via Agent 1's offline rig)

Agent 1's `tools/rust-offline-rig` (`b8c27db8`) made cargo available in the sandbox. Two gaps had to be
bridged locally (not committed): the rig's vendor `PLAN` lacks `indexmap`/`equivalent`/`hashbrown`
(required since `8ed00851`), and `n8n-expression` needs `regex` (not vendored) so it is excluded from the
build copy. Runner + script: `tests/reference/harness/rust/` (README there).

| Run | Result |
| :--- | :--- |
| `cargo test -p n8n-connection` (crate's own 2 unit tests) | 2 passed |
| spec §7 runner vs crate as-is | **15 ok / 8 mismatch / 23 skipped** — 7 traversal-order probes (R-02) + `03 hasPath Model->Agent ignores non-main` (R-07) |
| spec §7 runner with spec **§3.1** transcription appended out-of-tree | **22 ok / 1 mismatch / 23 skipped** — only R-07 remains |

Consequences:
* Spec §3.1 is now **compiler-checked and fixture-checked**, not just transcribed: pasting it over
  `lib.rs` L35-110 closes R-02 outright (7/7 probes).
* R-07 is confirmed by execution, not inference: `has_path` must filter `type == "main"` (spec §5).
* R-05/R-08: the 23 skipped probes are exactly the missing `P-CONNECTION-GRAPH` API + `wf.*`; the runner
  already dispatches on `probe.op`, so each new function turns skips into checks.
* Note for Agent 1: `vendor_prep.py` `PLAN` needs the three indexmap crates (and `regex` closure if
  `n8n-expression` is to build) — otherwise `run.sh check` fails on `main` today.

### Addendum to Re-review #4 — full spec compiled: **32 ok / 0 mismatch**
`tests/reference/harness/rust/run-connection-rig-with-spec.sh` appends `spec_get_connected_nodes.rs` +
`spec_graph_and_diff.rs` (spec §3.1, §5, §6 in Rust) to a copy of the crate and runs the full §7 runner:
**32/32 non-`wf.*` probes identical to n8n 2.9.4**, rustc 1.88.0. R-02, R-05, R-07 therefore have a
compiled, fixture-verified reference implementation; only the physical move into `crates/n8n-connection`
(and the §7 runner into `crates/n8n-connection/tests/`) remains — Orchestrator / crate owner.
