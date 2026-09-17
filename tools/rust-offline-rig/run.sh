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

# Source workspace discovery:
#   1. RUST_LEGACY=/path/to/workspace explicitly overrides everything.
#   2. legacy/rust-port is preferred when the ZERO-RUST archive is present.
#   3. Fall back to the active repository root for Phase-3 branches that still
#      carry Cargo.toml + crates/ at top level.
if [ -n "${RUST_LEGACY:-}" ]; then
  SOURCE="$RUST_LEGACY"
elif [ -f "$REPO/legacy/rust-port/Cargo.toml" ] && [ -d "$REPO/legacy/rust-port/crates" ]; then
  SOURCE="$REPO/legacy/rust-port"
elif [ -f "$REPO/Cargo.toml" ] && [ -d "$REPO/crates" ]; then
  SOURCE="$REPO"
else
  echo "no Rust workspace found: expected RUST_LEGACY, legacy/rust-port, or root Cargo.toml + crates/" >&2
  exit 2
fi
[ -f "$SOURCE/Cargo.toml" ] || { echo "missing Cargo.toml under $SOURCE" >&2; exit 2; }
[ -d "$SOURCE/crates" ] || { echo "missing crates/ under $SOURCE" >&2; exit 2; }

BUILD="$RIG/build/repo"
rm -rf "$BUILD"
mkdir -p "$BUILD/.cargo"
cp -a "$SOURCE/Cargo.toml" "$BUILD/"
cp -a "$SOURCE/crates" "$BUILD/"
# integration tests read the reference fixtures/goldens relative to the manifest dir
if [ -d "$REPO/tests/reference" ]; then
  mkdir -p "$BUILD/tests"
  cp -a "$REPO/tests/reference" "$BUILD/tests/"
fi
[ -f "$SOURCE/Cargo.lock" ] && cp -a "$SOURCE/Cargo.lock" "$BUILD/"

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
