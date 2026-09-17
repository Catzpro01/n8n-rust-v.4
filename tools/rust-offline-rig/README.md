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
2. **Crates from git.** The 12 crates in the workspace dependency closure
   (`serde`, `serde_derive`, `serde_json`, `thiserror`, `thiserror-impl`, `syn`,
   `proc-macro2`, `quote`, `itoa`, `ryu`, `memchr`, `unicode-ident`) are cloned at pinned
   upstream tags, because crate downloads are blocked.
3. **Cargo `directory` source.** Clones carry `path = ...` deps and `workspace = true`
   inheritance, which cargo rejects in a directory source (crates.io publishes a
   normalised manifest, git does not). `vendor_prep.py` rewrites each manifest — inherited
   dependencies get explicit versions, path keys are stripped, `[workspace]`/`[patch.*]`
   tables are dropped — and writes a `.cargo-checksum.json` per crate.

Everything lands in `$RUST_RIG` (default `/tmp/rust-rig`), **outside the repository**:
the rig is a build environment, not a source artefact, and nothing from it is committed.

## Usage

```bash
tools/rust-offline-rig/setup.sh          # ~15 s on first run (≈175 MB of npm tarballs + clones)
tools/rust-offline-rig/run.sh check      # cargo check --workspace --all-targets
tools/rust-offline-rig/run.sh test       # cargo test  --workspace
tools/rust-offline-rig/run.sh fmt        # any other cargo subcommand
```

`run.sh` copies `Cargo.toml` + `crates/` into `$RUST_RIG/build/repo` and runs cargo
there, so `Cargo.lock`, `target/` and any generated file stay out of the tree under
review.

## Status

| Date | Command | Result |
| :--- | :--- | :--- |
| 2026-09-17 | `run.sh check` on `crates/**` @ `014471e6` (Phase-3 workspace) | **PASS** — `Finished dev profile … in 6.26s`, 12 vendored deps compiled, 5 workspace crates checked |
| 2026-09-17 | `run.sh test` after extending the vendor closure | **PASS** — 45 tests / 0 failed across the 7-crate workspace. Added to the closure: `indexmap 2.2.6` (+ `equivalent 1.0.1`, `hashbrown 0.14.5`, `allocator-api2 0.2.18`), `regex 1.11.1` (+ `regex-automata 0.4.9`, `regex-syntax 0.8.5`, `aho-corasick 1.1.3`); `vendor_prep.py` now also strips table-style `path = …` keys inside `[dependencies.*]` and drops `[[test]]`/`[[bench]]` target sections (the regex manifests tripped the old rewriter). |

## Caveats

* **Version drift.** The npm `rustc`/`rust-std`/`cargo` packages are third-party repacks
  of the official 1.88.0 binaries; the crate tags are pinned to the versions the
  workspace's `1.0`-style requirements resolve to. A build here is evidence about the
  code, not about the exact dependency versions the VPS will resolve. Run `cargo check`
  / `cargo test` on the VPS (real registry) before merging anything that depends on it.
* **Rewritten manifests.** Vendored manifests are not the upstream ones (see step 3).
  If a crate is added or upgraded, extend `PLAN` in `vendor_prep.py`.
* **No rustup.** `rust-toolchain.toml` files are dropped from vendored crates, and
  toolchain selection env vars (`RUSTUP_TOOLCHAIN`) have no effect here.
* **Ephemeral.** `/tmp` is outside the snapshot, so the rig can disappear between
  sessions; `setup.sh` is idempotent and cheap to re-run.
