# Workflow Rust Compatibility Tests (Differential)

This directory is the **compatibility-test gate** for the `workflow` LEGO
(Phase 3 → 4: RUST IMPLEMENTED → COMPATIBILITY TESTED). It compares the Rust
port against the ORIGINAL n8n implementation, line by line, on identical
inputs.

## Components

| Path | Role |
| :--- | :--- |
| `fixtures/*.json` | Golden reference workflows + query lists (10 fixtures: empty, single node, linear, diamond, chain w/ depth, cycle, multi I/O, sparse indices, non-main types, duplicate edges). |
| `reference/harness.mjs` | Node.js harness running the **verbatim original n8n functions** (`getConnectedNodes`, `getChildNodes`, `getParentNodes`, `mapConnectionsByDestination` from `reference/n8n/packages/workflow/src/common/`, n8n v2.9.4) plus the spec-defined `detectCycles`/`findCycle`/`getStartNodes`. No npm packages required (Node ≥ 18). |
| `golden/*.expected.txt` | Reference outputs captured from the harness (canonical JSON, one line per query: `<query>\t<json>`). |
| `gen_rust_golden.py` | Regenerates `golden/` and embeds it into `crates/n8n-workflow/tests/compat_golden.rs` (byte-exact). |
| `run.sh` | Full differential driver: Node reference vs `cargo run -p n8n-workflow --bin n8n-workflow-compat` per fixture, then `cargo test`. |

## How it works

1. Both sides read the same fixture JSON.
2. Both sides execute the same query grammar (see `crates/n8n-workflow/src/compat_engine.rs` — mirrored 1:1 in the harness).
3. Both sides emit **canonical JSON** (object keys sorted at every level,
   compact separators, standard escaping) so a plain `diff` is a strict,
   order-sensitive comparison.
4. The Rust crate ALSO embeds all fixtures + expected outputs as golden
   tests (`crates/n8n-workflow/tests/compat_golden.rs`), so `cargo test`
   alone is a self-contained compatibility gate (no Node required).

## Running

```bash
# Full gate (Node reference diff + cargo test):
bash tests/compatibility/run.sh

# Rust side only (self-contained golden tests):
cargo test -p n8n-workflow

# Rust compat binary on one fixture (manual diff):
cargo run -p n8n-workflow --bin n8n-workflow-compat -- tests/compatibility/fixtures/04-diamond.json
node tests/compatibility/reference/harness.mjs tests/compatibility/fixtures/04-diamond.json
```

## Fixture conventions (determinism contract)

The original JS iterates connection object keys in **insertion order**, while
the Rust port iterates `BTreeMap` keys in **lexicographic order** (golden
invariant: the same input must always yield the same adjacency list). To make
both iteration orders coincide — so outputs are directly comparable — fixtures
MUST follow:

1. Top-level connection node names appear in lexicographic (code-point)
   order.
2. Per-node connection-type keys appear in lexicographic order
   (e.g. `ai_tool` before `main`).
3. Index levels (integer-like keys) are unaffected: JS always iterates them
   in ascending numeric order, identical to the Rust `Vec` order.
4. Node/type strings must not contain `:` (query separator).
5. Content is UTF-8 text (real n8n names can be non-ASCII, e.g. curly
   quotes — see fixture `11-unicode-name`). Strings must not contain raw
   control characters. BMP-only names are recommended: the JS harness sorts
   by UTF-16 code units while Rust/Python sort by code point — identical for
   BMP text, potentially different for supplementary-plane characters.

## Adding a fixture

1. Create `fixtures/<NN-name>.json` (schema below) following the conventions.
2. Run `python3 tests/compatibility/gen_rust_golden.py` (re-captures golden
   outputs from the Node harness and regenerates the Rust golden tests).
3. Run `bash tests/compatibility/run.sh`.

Fixture schema:

```json
{
  "name": "nn-name",
  "nodes": [
    { "name": "A", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1,
      "position": [0, 0], "disabled": false }
  ],
  "connections": {
    "A": { "main": [[{ "node": "B", "type": "main", "index": 0 }]] }
  },
  "queries": [
    "mapByDestination",
    "getChild:A",
    "getChild:A:ALL:2",
    "getParent:B:main:1",
    "getConnected:A",
    "getNode:A",
    "getAllNodes",
    "detectCycles:main",
    "findCycle:all",
    "getStartNodes"
  ]
}
```

## Current status

- Phase 3 (RUST IMPLEMENTED): crate complete — `crates/n8n-workflow`.
- Reference harness verified locally on Node (golden outputs captured).
- Rust execution (compile + `cargo test` + differential `run.sh`): to be run
  in the VPS pipeline (this sandbox's network policy blocks
  `static.rust-lang.org`/`crates.io`, so no Rust toolchain is available
  here). The crate is dependency-free (std only), so any stable toolchain
  ≥ 1.70 suffices.
