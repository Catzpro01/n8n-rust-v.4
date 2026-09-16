#!/usr/bin/env bash
# local variant of tools/rust-offline-rig/run.sh: excludes n8n-expression (needs regex, not vendored)
set -euo pipefail
RIG=/tmp/rust-rig; REPO=/home/user/n8n-rust-v.4; BUILD=$RIG/build/conn
rm -rf "$BUILD"; mkdir -p "$BUILD/.cargo"
cp -a "$REPO/Cargo.toml" "$BUILD/"; cp -a "$REPO/crates" "$BUILD/"; mkdir -p "$BUILD/tests"; cp -a "$REPO/tests/reference" "$BUILD/tests/"
sed -i '/n8n-expression/d' "$BUILD/Cargo.toml"; rm -rf "$BUILD/crates/n8n-expression"
printf '[source.crates-io]\nreplace-with = "vendored"\n[source.vendored]\ndirectory = "%s/vendor"\n[net]\noffline = true\n' "$RIG" > "$BUILD/.cargo/config.toml"
export PATH="$RIG/rust/package/rustc/bin:$RIG/cargo/package/cargo/bin:$PATH" CARGO_HOME=$RIG/cargo-home CARGO_TARGET_DIR=$RIG/target
mkdir -p "$BUILD/crates/n8n-connection/tests"; cp $REPO/tests/reference/harness/rust/connection_reference_fixtures.rs "$BUILD/crates/n8n-connection/tests/"; cd "$BUILD"; exec cargo "$@" --offline
