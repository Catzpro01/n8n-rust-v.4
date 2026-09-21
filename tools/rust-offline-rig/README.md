# Rust offline rig

Assembles a working **rustc + rust-std + cargo** toolchain and a **vendored crate
directory** inside a sandbox that cannot reach crates.io, so the Phase-3 workspace can
actually be compiled and tested here instead of only on the VPS.

| Reachable from this sandbox | Unreachable |
| :--- | :--- |
| `registry.npmjs.org`, `github.com`, `pypi.org` | `sh.rustup.rs`, `static.rust-lang.org`, `index.crates.io`, `static.crates.io`, Debian mirrors |

## How it works

1. **Toolchain from npm.** `@rustbin/rustc-1.88.0-x86_64-unknown-linux-gnu` (official
   rustc binary + driver), `@rustbin/rust-std-1.88.0-x86_64-unknown-linux-gnu` (libstd,
   merged into the rustc sysroot — the rustc package alone has no `libstd`) and
   `@rustbin/cargo-1.88.0-x86_64-unknown-linux-gnu`.
2. **Crates from git.** The 24 crates in the workspace dependency closure are cloned at the
   tags `Cargo.lock` resolves to (`serde`/`serde_derive`/`serde_core` 1.0.229, `serde_json`
   1.0.151, `zmij` 1.0.23, `thiserror` 1.0.69, `syn` 2.0.119 **and** 3.0.6, `proc-macro2`,
   `quote`, `itoa`, `ryu`, `memchr`, `unicode-ident`, `indexmap`, `hashbrown`, `equivalent`,
   `async-trait`, `anyhow`, `regex`/`regex-automata`/`regex-syntax`, `aho-corasick`), because
   crate downloads are blocked.
3. **Cargo `directory` source.** Clones carry `path = ...` deps and `workspace = true`
   inheritance, which cargo rejects in a directory source (crates.io publishes a
   normalised manifest, git does not). `vendor_prep.py` rewrites each manifest — inherited
   dependencies get the version from the crate's own `[workspace.dependencies]`, path keys
   are stripped, `[workspace]`/`[patch.*]`/`[dev-dependencies]` tables are dropped, features
   that only referenced a dropped dev-dependency are emptied — and writes a
   `.cargo-checksum.json` per crate.

Everything lands in `$RUST_RIG` (default `/tmp/rust-rig`), **outside the repository**:
the rig is a build environment, not a source artefact, and nothing from it is committed.

## Usage

```bash
tools/rust-offline-rig/setup.sh          # ~1 min on first run (npm tarballs + ~1 GB of clones)
tools/rust-offline-rig/run.sh check      # cargo check --workspace --all-targets
tools/rust-offline-rig/run.sh test       # cargo test  --workspace
tools/rust-offline-rig/run.sh fmt        # any other cargo subcommand
RIG_REVENDOR=1 tools/rust-offline-rig/setup.sh   # re-run vendor_prep.py after a PLAN edit
```

`run.sh` copies `Cargo.toml` + `crates/` + `tests/reference/` into `$RUST_RIG/build/repo`
and runs cargo there, so `target/` and any generated file stay out of the tree under
review. The lock *is* copied — with its `checksum` lines removed, since a directory source
made of git checkouts cannot reproduce crates.io tarball hashes — so the rig resolves the
same versions CI does.

`n8n-nodes-rust` is left out of the copied workspace manifest (`EXCLUDE_MEMBERS` in
`run.sh`, `RIG_INCLUDE_ALL=1` to override): its `tokio` dev-dependency drags in ~20 further
crates, several of them target-gated, that `setup.sh` does not vendor. Everything else,
including all of `crates/n8n-workflow`'s integration tests, is built and run.

## Status

| Date | Command | Result |
| :--- | :--- | :--- |
| 2026-09-17 | `run.sh check` on `crates/**` @ `014471e6` (Phase-3 workspace) | **PASS** — `Finished dev profile … in 6.26s`, 12 vendored deps compiled, 5 workspace crates checked |
| 2026-09-18 | `run.sh check` + `run.sh test` on the Phase-3 workspace | **PASS** — 24 vendored deps @ the `Cargo.lock` versions, 7 of 8 crates, **79 tests green** (`n8n-workflow` 52 unit + 3 integration suites) |
| 2026-09-21 | `run.sh check` + `run.sh test` @ `9307836` (PR #41) | **PASS** — 27 vendored deps, full 8 crates, **151 passed, 0 failed** (incl. 4 new tokio `runtime_runner` tests; `n8n-nodes-rust` built in-rig for the first time) |

The 2026-09-18 run replaced the previous vendor set: the older `PLAN` stopped one crate
short of the closure (`regex`/`indexmap` were missing, `syn` was a single version), so
`cargo check --workspace --all-targets` could not build `n8n-workflow` at all.

## Caveats

* **Version drift.** The npm `rustc`/`rust-std`/`cargo` packages are third-party repacks
  of the official 1.88.0 binaries; the crate tags are pinned to the versions the
  workspace's `1.0`-style requirements resolve to. A build here is evidence about the
  code, not about the exact dependency versions the VPS will resolve. Run `cargo check`
  / `cargo test` on the VPS (real registry) before merging anything that depends on it.
* **Rewritten manifests.** Vendored manifests are not the upstream ones (see step 3).
  If a crate is added or upgraded, extend `PLAN` in `vendor_prep.py` *and* `CRATES` in
  `setup.sh`, then re-run with `RIG_REVENDOR=1`.
* **tokio-macros relabel.** Upstream has no `tokio-macros-2.7.2` tag, so the 2.7.1
  sources from tag `tokio-1.53.1` are relabelled to the locked 2.7.2 (`FORCE_VERSION` in
  `vendor_prep.py`). The delta is a syn 2→3 requirement bump; cargo re-resolves the
  vendored syn 2.0.119 for this crate instead of the locked 3.0.6. Macro expansion
  (`#[tokio::test]`) is unaffected.
* **No rustup.** `rust-toolchain.toml` files are dropped from vendored crates, and
  toolchain selection env vars (`RUSTUP_TOOLCHAIN`) have no effect here.
* **Ephemeral.** `/tmp` is outside the snapshot, so the rig can disappear between
  sessions; `setup.sh` is idempotent and cheap to re-run.
