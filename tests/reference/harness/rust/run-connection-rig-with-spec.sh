#!/usr/bin/env bash
set -euo pipefail
RIG=/tmp/rust-rig; REPO=${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}; BUILD=$RIG/build/spec
rm -rf "$BUILD"; mkdir -p "$BUILD/.cargo"
cp -a "$REPO/Cargo.toml" "$BUILD/"; cp -a "$REPO/crates" "$BUILD/"; mkdir -p "$BUILD/tests"; cp -a "$REPO/tests/reference" "$BUILD/tests/"
sed -i '/n8n-expression/d' "$BUILD/Cargo.toml"; rm -rf "$BUILD/crates/n8n-expression"
printf '[source.crates-io]\nreplace-with = "vendored"\n[source.vendored]\ndirectory = "%s/vendor"\n[net]\noffline = true\n' "$RIG" > "$BUILD/.cargo/config.toml"
cat $REPO/tests/reference/harness/rust/spec_get_connected_nodes.rs $REPO/tests/reference/harness/rust/spec_graph_and_diff.rs >> "$BUILD/crates/n8n-connection/src/lib.rs"
mkdir -p "$BUILD/crates/n8n-connection/tests"; cp $REPO/tests/reference/harness/rust/connection_reference_fixtures_full.rs "$BUILD/crates/n8n-connection/tests/reference_fixtures.rs"
export PATH="$RIG/rust/package/rustc/bin:$RIG/cargo/package/cargo/bin:$PATH" CARGO_HOME=$RIG/cargo-home CARGO_TARGET_DIR=$RIG/target
cd "$BUILD"; exec cargo --offline "$@"
