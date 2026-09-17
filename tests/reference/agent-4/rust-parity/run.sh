#!/usr/bin/env bash
# Agent 4 — executable parity probe for crates/n8n-validation (read-only w.r.t. crates/**).
# Builds a throw-away workspace in $A4_BUILD (default /tmp/a4-build) from copies of
# crates/n8n-common, n8n-connection, n8n-validation plus this probe crate, using Agent 1's
# offline rig (tools/rust-offline-rig/setup.sh must have run; indexmap/equivalent/hashbrown
# are vendored on demand because the rig's PLAN predates 8ed00851).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"; RIG="${RUST_RIG:-/tmp/rust-rig}"; B="${A4_BUILD:-/tmp/a4-build}"
[ -x "$RIG/cargo/package/cargo/bin/cargo" ] || { echo "run tools/rust-offline-rig/setup.sh first"; exit 2; }
# --- vendor the 3 crates the rig lacks (out-of-tree; does not modify tools/) ---
for spec in indexmap-rs/indexmap:2.2.6 indexmap-rs/equivalent:v1.0.1 rust-lang/hashbrown:v0.14.5; do
  repo="${spec%:*}"; tag="${spec#*:}"; name="$(basename "$repo")"
  [ -d "$RIG/vendorsrc/$name" ] || git clone -q --depth 1 --branch "$tag" "https://github.com/$repo" "$RIG/vendorsrc/$name"
done
if [ ! -d "$RIG/vendor/indexmap" ]; then
  sed 's|    ("unicode-ident", "unicode-ident", "1.0.14"),\n\]|&|' "$REPO/tools/rust-offline-rig/vendor_prep.py" > /tmp/a4-vendor_prep.py
  python3 - <<PY
p='/tmp/a4-vendor_prep.py'; s=open(p).read()
s=s.replace('    ("unicode-ident", "unicode-ident", "1.0.14"),\n]','    ("unicode-ident", "unicode-ident", "1.0.14"),\n    ("indexmap", "indexmap", "2.2.6"),\n    ("equivalent", "equivalent", "1.0.1"),\n    ("hashbrown", "hashbrown", "0.14.5"),\n]')
open(p,'w').write(s)
PY
  python3 /tmp/a4-vendor_prep.py "$RIG/vendorsrc" "$RIG/vendor" >/dev/null
fi
# --- assemble probe workspace ---
rm -rf "$B"; mkdir -p "$B/.cargo" "$B/crates/a4-parity/src" "$B/crates/a4-parity/tests" "$B/tests"
cp -a "$REPO/crates/n8n-common" "$REPO/crates/n8n-connection" "$REPO/crates/n8n-validation" "$B/crates/"
cp -a "$REPO/tests/reference" "$B/tests/"
cp "$REPO/tests/reference/agent-4/rust-parity/Cargo.toml.probe" "$B/crates/a4-parity/Cargo.toml"
cp "$REPO/tests/reference/agent-4/rust-parity/"*.rs "$B/crates/a4-parity/tests/"; : > "$B/crates/a4-parity/src/lib.rs"
cat > "$B/Cargo.toml" <<TOML
[workspace]
resolver = "2"
members = ["crates/n8n-common", "crates/n8n-connection", "crates/n8n-validation", "crates/a4-parity"]
[workspace.package]
version = "0.1.0"
edition = "2021"
authors = ["n8n-rust team"]
license = "Apache-2.0"
[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
indexmap = { version = "=2.2.6", features = ["serde"] }
TOML
printf '[source.crates-io]\nreplace-with = "vendored"\n[source.vendored]\ndirectory = "%s/vendor"\n[net]\noffline = true\n' "$RIG" > "$B/.cargo/config.toml"
export PATH="$RIG/rust/package/rustc/bin:$RIG/cargo/package/cargo/bin:$PATH" CARGO_HOME="${CARGO_HOME:-$RIG/cargo-home}"
cd "$B" && cargo test --offline -p a4-parity -- --nocapture "$@"
