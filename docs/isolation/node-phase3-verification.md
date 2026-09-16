# Node LEGO — Independent Phase-3 Workspace Verification (read-only)

**Author:** Agent 2 · **Date:** 2026-09-17 · **Tree:** `main@e6c0188a` synced into this branch
**Nature:** verifier-only run; **no crate files were created or modified** (boundary `crates/**`
respected). All build artifacts lived in `/tmp/rust-rig` (see `tools/rust-offline-rig`).

## 1. Result — `cargo test --workspace` (offline rig, Rust 1.88.0)

| Crate / suite | Tests | Outcome |
|---|---|---|
| n8n-common (lib) | 0 | ok |
| n8n-connection (lib) | 2 | ok |
| n8n-execution-data (lib) | 2 | ok |
| n8n-expression (lib) | 2 | ok |
| **n8n-node-model (lib)** | **1** | ok — the stub's happy-path deserialize only |
| n8n-validation (lib) | 4 | ok |
| n8n-workflow (lib) | 19 | ok |
| n8n-workflow (tests/conformance.rs) | 2 | ok |
| n8n-workflow (tests/reference_fixtures.rs) | 5 | ok |
| **Total** | **37** | **ALL PASS** |

This independently reproduces Agent 1's "cargo test green" claim on the exact merged tree,
inside this sandbox, without crates.io/network access to rust registries.

## 2. Current state of `n8n-node-model` (the Node LEGO crate)

* `src/lib.rs`: 65 lines — `INodeParameters` newtype, minimal `INode`, minimal
  `NodeTypeDescription`, one deserialize test.
* Frozen ports implemented: **0 / 6** (`get_node_parameters`, `get_node_outputs`,
  `get_node_inputs`, `get_connection_types`, `rename_form_fields`, `apply_access_patterns`
  — none present).
* Fidelity gaps G-1..G-4 from `docs/isolation/node-rust-brief.md` **still open**
  (`version: f64` vs `number|number[]`; `inputs/outputs: Vec<String>` vs config/expression
  union; missing required `group`/`defaults`/`properties`; missing 13 `INode` optionals).
* Next acceptance step: implement the brief + satisfy **GC-1..GC-7**
  (`docs/isolation/node-golden-cases.md`) byte-identically.

## 3. Rig dependency-closure gap (fixed locally in /tmp; reported for the rig owner)

The vendored set in the repo rig (`tools/rust-offline-rig`, 12 crates) no longer covers the
workspace closure. Current `Cargo.toml` also requires — cloned at pinned tags and rewritten
with `vendor_prep.py`-equivalent normalization in `/tmp/rust-rig/vendor`:

| Crate | Tag | Needed by |
|---|---|---|
| indexmap | `2.2.6` | n8n-workflow (also `serde` feature) |
| hashbrown | `v0.14.5` | indexmap (`raw` feature) |
| equivalent | `v1.0.1` | indexmap |
| anyhow | `1.0.99` | workspace |
| petgraph | `petgraph@v0.6.6` | n8n-connection |
| fixedbitset | `v0.5.7` | petgraph |
| regex | `1.10.6` | n8n-expression |
| regex-automata | `0.4.7` (in `rust-lang/regex@1.10.6`) | regex |
| regex-syntax | `0.8.4` (same repo) | regex / regex-automata |
| aho-corasick | `1.1.5` | regex |

Two normalizer pitfalls hitting any future extension (already covered by the outbox note):
1. never rewrite a manifest by reading and writing the same open file handle (read first,
   then write);
2. `path = "…"` inside inline dep-tables must be stripped with comma-safe handling
   (both `{ path = "x", version = "y" }` and `{ version = "y", path = "x" }` orders).
