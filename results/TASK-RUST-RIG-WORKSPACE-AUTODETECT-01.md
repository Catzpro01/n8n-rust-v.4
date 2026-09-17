# TASK RESULT: TASK-RUST-RIG-WORKSPACE-AUTODETECT-01

- **STATUS**: `SUCCESS`
- **AGENT**: `arena/01a0b103-n8n-rust-v-4`
- **LEGO COMPONENT**: `rust-offline-rig`
- **TIMESTAMP**: `2026-09-18 Asia/Novosibirsk`

Extended `tools/rust-offline-rig/run.sh` to auto-detect the Rust workspace source in three modes: explicit `RUST_LEGACY`, archived `legacy/rust-port`, then active root `Cargo.toml` + `crates/`. This keeps the offline rig runnable both on current Phase-3 branches with root Rust artifacts and on ZERO-RUST archive branches without writing build artifacts to the repository. Evidence: `npm run rust:check-offline` PASS, `npm run rust:test-offline` PASS (37 Rust tests), and `RUST_LEGACY=/tmp/rust-legacy-probe npm run rust:check-offline` PASS against an out-of-tree copied workspace.
