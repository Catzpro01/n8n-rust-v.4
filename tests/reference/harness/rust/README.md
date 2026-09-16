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
