# Out-of-tree Rust fixture runner for `crates/n8n-connection` (agent-3)

agent-3 may not edit `crates/**`. These files let anyone run the spec §7 fixture runner against the
crate **without touching the repository tree**, using Agent 1's offline rig (`tools/rust-offline-rig`).

| File | Purpose |
| :--- | :--- |
| `connection_reference_fixtures.rs` | integration test: loads `tests/reference/connection/*/{case,expected}.json`, evaluates every probe the crate has an API for, asserts 0 mismatches vs n8n 2.9.4. Ops without an API yet (graph utils, diff, `wf.*`) are counted as *skipped*. Drop it into `crates/n8n-connection/tests/reference_fixtures.rs` once the crate owner adopts it. |
| `run-connection-rig.sh` | copies the workspace to `/tmp/rust-rig/build/conn`, drops `n8n-expression` (needs `regex`, not vendored), injects the test file, runs cargo offline. Usage: `bash tests/reference/harness/rust/run-connection-rig.sh test -p n8n-connection --test reference_fixtures` |

Prerequisite: `tools/rust-offline-rig/setup.sh`, **plus** three crates the rig's `PLAN` does not yet
include (`indexmap 2.2.6`, `equivalent 1.0.1`, `hashbrown 0.14.5` — cloned from `indexmap-rs/indexmap`,
`indexmap-rs/equivalent` tag `v1.0.1`, `rust-lang/hashbrown` tag `v0.14.5`) added to `vendor_prep.py`'s
`PLAN` and re-vendored. That edit belongs to Agent 1 (`tools/**`); agent-3 did it in a local copy.

Result @ `8ed00851` (rustc 1.88.0): `15 ok / 8 mismatch / 23 skipped`.
Same runner with spec §3.1 `get_connected_nodes` appended out-of-tree: `22 ok / 1 mismatch` — the one
left is R-07 (`has_path` traverses all types; reference is `main`-only).

## Reference implementation of spec §3–§6 (compiled, 32/32)

| File | Purpose |
| :--- | :--- |
| `spec_get_connected_nodes.rs` | spec §3.1 transcription (`get_connected_nodes_spec`) |
| `spec_graph_and_diff.rs` | spec §5 + §6: `AdjacencyList`, `build_adjacency_list`, `get_input_edges`, `get_output_edges`, `get_root_nodes`, `get_leaf_nodes`, `has_path_adj`, `parse_extractable_subgraph_selection`, `compare_connections`, and the 5 types (`ExtractableError`, `ExtractableSubgraphData`, `ExtractableSelection`, `ConnectionEntry`/`DiffValue`, `ConnectionsDiff`) |
| `connection_reference_fixtures_full.rs` | the runner extended to every non-`wf.*` probe |
| `run-connection-rig-with-spec.sh` | appends the two spec files to a *copy* of `lib.rs` and runs the full runner |

Result (rustc 1.88.0, crate @ `8ed00851` + spec files): **34 ok / 0 mismatch / 27 skipped** (re-run after
fixtures 06–07 were added; was 32/0/14) — the skipped ones are `wf.*` probes (Workflow members, Agent 1). These files are written against the crate's *current* type
names (`ConnectionItem`, `WorkflowConnections`, `ConnectionTypeFilter`) so the crate owner can move them
into `src/lib.rs` verbatim; renaming to the spec §2 names is optional. `has_path_adj` is named to avoid
clashing with the crate's existing all-types `has_path` (R-07); upstream's name is `hasPath`.

## Cross-check: `crates/n8n-workflow` vs the Connection fixtures

`workflow_crate_connection_fixtures.rs` + `run-workflow-crate-vs-connection-fixtures.sh` run the same
fixtures against Agent 1's Workflow crate (which carries its own traversal/destination-map/diff port).
Result @ `3fc3156c`: **21 ok / 1 mismatch / 39 skipped** (after fixtures 06–07; was 19/1/26) — mismatch = D-11 (`None` vs `[]` padding).

## 2026-09-17 — runner hardening after agent-1's PR #4 review (flags 1 & 2)

* **No silent skips**: both runners now carry an explicit `SKIPPED_OPS` list with owners; any other unknown op panics.
* **Document-order parsing**: `Connections` are deserialised straight from the file text (typed), never via
  `serde_json::Value` (which sorts keys without `preserve_order`). Case 08 immediately proved the point — with the
  old `from_value` path the `ALL`/`ALL_NON_MAIN` probes came back as `[Sub, Tool, Model]` instead of the reference
  `[Model, Sub, Tool]` (type keys iterated in insertion order). `connection_reference_fixtures.rs` (old, `from_value`) is
  deprecated.

| runner | crate | result (cases 01–08, 88 probes) |
| :--- | :--- | :--- |
| `run-connection-rig-with-spec.sh` (spec §3–§6 transcription on `n8n-connection`) | main tree | **82 ok / 0 mismatch / 59 skipped** with cases 01–10 (skips = `wf.*` only; was 57/0/31 at 01–08) |
| `run-workflow-crate-vs-connection-fixtures.sh` | `n8n-workflow` @ main (`3fc3156c`) | 55 ok / **1 mismatch (D-11)** / 85 skipped with cases 01–10 (was 44/1/43) — D-11 is fixed on agent-1's PR #3 (`6535009f`), 0 mismatch there |
