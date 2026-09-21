#!/usr/bin/env bash
# Run cargo against the *repository* crates using the offline rig (see setup.sh).
#
# The repository itself is never written to: the sources are copied into
# $RUST_RIG/build/repo, where the generated .cargo/config.toml points cargo at the
# vendored crate directory. That keeps build artefacts, Cargo.lock and cargo's
# target/ directory out of the tree under review.
#
# Members listed in EXCLUDE_MEMBERS are dropped from the copied manifest because their
# dependency closure is not vendored (see setup.sh) — the run covers every other crate.
#
# Usage:
#   tools/rust-offline-rig/run.sh check   # cargo check --workspace --all-targets
#   tools/rust-offline-rig/run.sh test    # cargo test  --workspace
#   tools/rust-offline-rig/run.sh <any cargo subcommand ...>
set -euo pipefail

RIG="${RUST_RIG:-/tmp/rust-rig}"
REPO="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
MODE="${1:-check}"; shift || true

# Workspace members whose dependency closure is not vendored. `n8n-nodes-rust` pulls tokio
# (dev-dependency, ~20 further crates incl. target-gated ones) which `setup.sh` deliberately
# leaves out; the VPS / CI build it with a real registry. Set RIG_INCLUDE_ALL=1 to try anyway.
EXCLUDE_MEMBERS=("n8n-nodes-rust")

[ -d "$RIG/vendor" ] || { echo "rig missing: run tools/rust-offline-rig/setup.sh first" >&2; exit 2; }

BUILD="$RIG/build/repo"
rm -rf "$BUILD"
mkdir -p "$BUILD/.cargo"
cp -a "$REPO/Cargo.toml" "$BUILD/"
cp -a "$REPO/crates" "$BUILD/"
if [ "${RIG_INCLUDE_ALL:-0}" != "1" ] && [ "${#EXCLUDE_MEMBERS[@]}" -gt 0 ]; then
  python3 - "$BUILD/Cargo.toml" "${EXCLUDE_MEMBERS[@]}" <<'PYEOF'
import re, sys
manifest, *excluded = sys.argv[1:]
text = open(manifest).read()
for member in excluded:
    text = re.sub(r'\n\s*"crates/%s",' % re.escape(member), "", text, count=1)
open(manifest, "w").write(text)
print("rig: excluded workspace members: " + ", ".join(excluded))
PYEOF
fi
# integration tests read the reference fixtures/goldens relative to the manifest dir
if [ -d "$REPO/tests/reference" ]; then
  mkdir -p "$BUILD/tests"
  cp -a "$REPO/tests/reference" "$BUILD/tests/"
fi
# The lock pins the resolutions, so the rig builds the same versions CI does. Its `checksum`
# entries have to go: a directory source made of git checkouts cannot reproduce crates.io
# tarball checksums, and cargo refuses a package whose locked checksum it cannot verify.
if [ -f "$REPO/Cargo.lock" ]; then
  sed '/^checksum = /d' "$REPO/Cargo.lock" > "$BUILD/Cargo.lock"
fi

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
