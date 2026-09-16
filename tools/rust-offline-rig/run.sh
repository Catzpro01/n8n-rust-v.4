#!/usr/bin/env bash
# Run cargo against the *repository* crates using the offline rig (see setup.sh).
#
# The repository itself is never written to: the sources are copied into
# $RUST_RIG/build/repo, where the generated .cargo/config.toml points cargo at the
# vendored crate directory. That keeps build artefacts, Cargo.lock and cargo's
# target/ directory out of the tree under review.
#
# Usage:
#   tools/rust-offline-rig/run.sh check   # cargo check --workspace --all-targets
#   tools/rust-offline-rig/run.sh test    # cargo test  --workspace
#   tools/rust-offline-rig/run.sh <any cargo subcommand ...>
set -euo pipefail

RIG="${RUST_RIG:-/tmp/rust-rig}"
REPO="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
MODE="${1:-check}"; shift || true

[ -d "$RIG/vendor" ] || { echo "rig missing: run tools/rust-offline-rig/setup.sh first" >&2; exit 2; }

BUILD="$RIG/build/repo"
rm -rf "$BUILD"
mkdir -p "$BUILD/.cargo"
cp -a "$REPO/Cargo.toml" "$BUILD/"
cp -a "$REPO/crates" "$BUILD/"
# integration tests read the reference fixtures/goldens relative to the manifest dir
if [ -d "$REPO/tests/reference" ]; then
  mkdir -p "$BUILD/tests"
  cp -a "$REPO/tests/reference" "$BUILD/tests/"
fi
[ -f "$REPO/Cargo.lock" ] && cp -a "$REPO/Cargo.lock" "$BUILD/"

cat > "$BUILD/.cargo/config.toml" <<EOF
[source.crates-io]
replace-with = "vendored"

[source.vendored]
directory = "$RIG/vendor"

[net]
offline = true
EOF

export PATH="$RIG/rust/package/rustc/bin:$RIG/cargo/package/cargo/bin:$PATH"
export CARGO_HOME="${CARGO_HOME:-$RIG/cargo-home}"
export CARGO_TARGET_DIR="$RIG/target"
mkdir -p "$CARGO_HOME"

cd "$BUILD"
case "$MODE" in
  check) exec cargo check --offline --workspace --all-targets "$@" ;;
  test)  exec cargo test  --offline --workspace "$@" ;;
  *)     exec cargo "$MODE" --offline "$@" ;;
esac
