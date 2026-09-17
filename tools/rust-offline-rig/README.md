# Rust offline rig

Assembles a working **rustc + rust-std + cargo** toolchain and a **vendored crate
directory** inside a sandbox that cannot reach crates.io, so the Phase-3 workspace can
actually be compiled and tested here instead of only on the VPS.

| Reachable from this sandbox | Unreachable |
| :--- | :--- |
| `registry.npmjs.org`, `github.com`, `pypi.org` | `sh.rustup.rs`, `static.rust-lang.org`, `index.crates.io`, `static.crates.io`, Debian mirrors |

## How it works

1. **Toolchain from npm.** `@rustbin/rustc-1.88.0-x86_64-unknown-linux-gnu`,
   `@rustbin/rust-std-1.88.0-x86_64-unknown-linux-gnu` and
   `@rustbin/cargo-1.88.0-x86_64-unknown-linux-gnu` provide the official Rust binaries
   without using rustup.
2. **Crates from git.** The 19 crates in the workspace dependency closure are cloned at
   pinned upstream tags. This includes the direct dependencies (`serde`, `serde_json`,
   `thiserror`, `indexmap`, `regex`) and the transitive runtime crates required by
   `indexmap` and `regex` (`hashbrown`, `equivalent`, `regex-automata`, `regex-syntax`,
   `aho-corasick`, and their small support crates).
3. **Cargo `directory` source.** `vendor_prep.py` rewrites each manifest — inherited
   dependencies get explicit versions, path dependencies are removed, dev-only tables
   and excluded test/bench targets are dropped, and a `.cargo-checksum.json` is written.
   The setup script stores a plan marker so a previously-created incomplete vendor tree
   is rebuilt when the dependency plan changes.

Everything lands in `$RUST_RIG` (default `/tmp/rust-rig`), **outside the repository**:
`Cargo.lock`, `target/`, downloaded archives, cloned sources, and the generated vendor
directory are not committed.

## Usage

```bash
tools/rust-offline-rig/setup.sh          # idempotent; refreshes the vendor plan when needed
tools/rust-offline-rig/run.sh check      # cargo check --workspace --all-targets
tools/rust-offline-rig/run.sh test       # cargo test  --workspace
tools/rust-offline-rig/run.sh metadata  # any other installed cargo subcommand
```

`run.sh` copies `Cargo.toml`, `crates/`, and `tests/reference/` into a temporary build
root before invoking cargo. The repository itself is never written by the rig.

## Status

| Date | Command | Result |
| :--- | :--- | :--- |
| 2026-09-17 | `run.sh check` at current Phase-3 workspace | **PASS** — 19 vendored crates, all 7 workspace crates checked |
| 2026-09-17 | `run.sh test` at current Phase-3 workspace | **PASS** — 39 tests passed, 0 failed; reference fixtures consumed by integration tests |

## Caveats

* **Version drift.** The npm `rustc`/`rust-std`/`cargo` packages are third-party repacks
  of the official 1.88.0 binaries; the crate tags are pinned to the versions the
  workspace's `1.0`-style requirements resolve to. A build here is evidence about the
  code, not about the exact dependency versions the VPS will resolve. Run `cargo check`
  / `cargo test` on the VPS (real registry) before merging anything that depends on it.
* **Production-only manifests.** The vendor preparation intentionally removes upstream
  dev dependencies and test/bench targets. It verifies the workspace/library build; it
  is not a replacement for each upstream crate's own test suite.
* **No rustup.** `rust-toolchain.toml` files are dropped from vendored crates, and
  toolchain selection env vars (`RUSTUP_TOOLCHAIN`) have no effect here.
* **Ephemeral.** `/tmp` is outside the snapshot, so the rig can disappear between
  sessions; `setup.sh` is idempotent and cheap to re-run.
