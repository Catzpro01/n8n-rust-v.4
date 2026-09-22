#!/usr/bin/env bash
# Run cargo against the *repository* crates using the offline rig (see setup.sh).
#
# The repository itself is never written to: the sources are copied into
# $RUST_RIG/build/repo, where the generated .cargo/config.toml points cargo at the
# vendored crate directory. That keeps build artefacts, Cargo.lock and cargo's
# target/ directory out of the tree under review.
#
# The whole workspace is copied: since `setup.sh` vendors the complete dependency closure,
# no member has to be dropped (EXCLUDE_MEMBERS is an empty escape hatch for the opposite case).
#
# Usage:
#   tools/rust-offline-rig/run.sh check   # cargo check --workspace --all-targets
#   tools/rust-offline-rig/run.sh test    # cargo test  --workspace
#   tools/rust-offline-rig/run.sh <any cargo subcommand ...>
set -euo pipefail

RIG="${RUST_RIG:-/tmp/rust-rig}"
REPO="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
MODE="${1:-check}"; shift || true

# Members are built as-is: `setup.sh` vendors the whole dependency closure of the workspace
# (including tokio's `rt` + `macros` closure for `n8n-nodes-rust` / `n8n-workflow`).
EXCLUDE_MEMBERS=()

# Crates whose vendored git-tag version differs from the one in `Cargo.lock`: their lock block
# is dropped so cargo re-resolves them from the directory source. A tag is the only offline
# source for a crate, and a published patch release does not always get one — `tokio-macros`
# 2.7.2 (the locked version) has no tag, the `tokio-1.53.1` tag ships 2.7.1.
LOCK_DRIFT=("tokio-macros")

[ -d "$RIG/vendor" ] || { echo "rig missing: run tools/rust-offline-rig/setup.sh first" >&2; exit 2; }

BUILD="$RIG/build/repo"
rm -rf "$BUILD"
mkdir -p "$BUILD/.cargo"
cp -a "$REPO/Cargo.toml" "$BUILD/"
cp -a "$REPO/crates" "$BUILD/"
if [ "${#EXCLUDE_MEMBERS[@]}" -gt 0 ]; then
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
# The lock pins the resolutions, so the rig builds the same versions CI does, with two edits.
# `checksum` entries have to go: a directory source made of git checkouts cannot reproduce
# crates.io tarball checksums, and cargo refuses a package whose locked checksum it cannot
# verify. And a crate listed in LOCK_DRIFT loses its block, because the version the lock pins
# is not the one its git tag carries (see LOCK_DRIFT).
if [ -f "$REPO/Cargo.lock" ]; then
  python3 - "$REPO/Cargo.lock" "$BUILD/Cargo.lock" "${LOCK_DRIFT[@]}" <<'PYEOF'
import re, sys

src, dst, *drift = sys.argv[1:]
text = open(src, encoding="utf-8").read()
blocks = re.split(r"(?=\[\[package\]\])", text)
kept, dropped = [], []
version = re.compile(r'^version = "([^"]+)"', re.M)
for block in blocks:
    name = re.search(r'^name = "([^"]+)"', block, re.M)
    if block.startswith("[[package]]") and name and name.group(1) in drift:
        dropped.append(name.group(1) + " " + version.search(block).group(1))
        continue
    kept.append(block)
open(dst, "w", encoding="utf-8").write(re.sub(r"^checksum = .*\n", "", "".join(kept), flags=re.M))
if dropped:
    print("rig: re-resolving out-of-lock crates: " + ", ".join(dropped))
PYEOF
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
# `--workspace` is the default scope, but it must not be forced on a caller who narrowed the
# selection themselves (`run.sh test -p n8n-expression`): cargo ignores the narrower flag when
# both are present, so the run would silently test everything.
for arg in "$@"; do
  case "$arg" in
    -p|--package|--exclude|--lib|--bins|--examples|--tests|--test|--benches|--bench|--all)
      selection=1 ;;
  esac
done
[ "${selection:-0}" = 1 ] || set -- --workspace "$@"

case "$MODE" in
  check) exec cargo check --offline --all-targets "$@" ;;
  test)  exec cargo test  --offline "$@" ;;
  *)     exec cargo "$MODE" --offline "$@" ;;
esac
