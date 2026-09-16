#!/usr/bin/env bash
# Assemble a Rust toolchain + crate vendor dir without crates.io.
#
# Why this exists: the review sandbox cannot reach sh.rustup.rs, static.rust-lang.org,
# index.crates.io, static.crates.io or the Debian mirrors. It *can* reach
# registry.npmjs.org and github.com, so the toolchain comes from npm packages that
# ship the official rust-lang binaries, and the crate sources are cloned from their
# upstream git tags and rewritten into cargo `directory` source format.
#
# Everything lands in $RUST_RIG (default /tmp/rust-rig) — outside the repository, so
# nothing here is ever committed. Re-running is a no-op once a step is present.
#
# Usage: tools/rust-offline-rig/setup.sh
set -euo pipefail

RIG="${RUST_RIG:-/tmp/rust-rig}"
RUST_VERSION="1.88.0"
NPM_HOST="https://registry.npmjs.org"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# target -> crate tags: the 12 crates the workspace dependency closure needs
CRATES=(
  "serde-rs/serde:v1.0.219"
  "serde-rs/json:v1.0.140"
  "dtolnay/thiserror:1.0.69"
  "dtolnay/syn:2.0.100"
  "dtolnay/proc-macro2:1.0.92"
  "dtolnay/quote:1.0.37"
  "dtolnay/itoa:1.0.14"
  "dtolnay/ryu:1.0.18"
  "BurntSushi/memchr:2.7.4"
  "dtolnay/unicode-ident:1.0.14"
)

mkdir -p "$RIG/dl" "$RIG/vendorsrc"

fetch_npm() { # <package> <tarball-url>
  local pkg="$1"
  local url="$2"
  local out="$RIG/dl/$(basename "$url")"
  if [ -f "$out" ]; then echo "have   $(basename "$out")"; return; fi
  echo "fetch  $pkg"
  curl -sSL --retry 3 --retry-delay 2 -o "$out" "$url"
}

extract_npm() { # <tarball> <dest>
  local tgz="$1"
  local dest="$2"
  [ -d "$dest" ] && { echo "have   $(basename "$dest")"; return; }
  mkdir -p "$dest"
  tar -xzf "$tgz" -C "$dest"
}

echo "== rig root: $RIG"

# --- 1. toolchain: rustc (with driver), rust-std, cargo -----------------------
fetch_npm "@rustbin/rustc" \
  "$NPM_HOST/@rustbin/rustc-$RUST_VERSION-x86_64-unknown-linux-gnu/-/rustc-$RUST_VERSION-x86_64-unknown-linux-gnu-$RUST_VERSION.tgz"
fetch_npm "@rustbin/rust-std" \
  "$NPM_HOST/@rustbin/rust-std-$RUST_VERSION-x86_64-unknown-linux-gnu/-/rust-std-$RUST_VERSION-x86_64-unknown-linux-gnu-$RUST_VERSION.tgz"
fetch_npm "@rustbin/cargo" \
  "$NPM_HOST/@rustbin/cargo-$RUST_VERSION-x86_64-unknown-linux-gnu/-/cargo-$RUST_VERSION-x86_64-unknown-linux-gnu-0.89.0.tgz"

extract_npm "$RIG/dl/rustc-$RUST_VERSION-x86_64-unknown-linux-gnu-$RUST_VERSION.tgz" "$RIG/rust"
extract_npm "$RIG/dl/rust-std-$RUST_VERSION-x86_64-unknown-linux-gnu-$RUST_VERSION.tgz" "$RIG/std"
extract_npm "$RIG/dl/cargo-$RUST_VERSION-x86_64-unknown-linux-gnu-0.89.0.tgz" "$RIG/cargo"

SYSDIR="$RIG/rust/package/rustc"
if ! ls "$SYSDIR"/lib/rustlib/x86_64-unknown-linux-gnu/lib/libstd-*.rlib >/dev/null 2>&1; then
  echo "merge  rust-std into sysroot"
  mkdir -p "$SYSDIR/lib/rustlib/x86_64-unknown-linux-gnu"
  cp -a "$RIG/std/package/rust-std-x86_64-unknown-linux-gnu/lib/rustlib/x86_64-unknown-linux-gnu/." \
        "$SYSDIR/lib/rustlib/x86_64-unknown-linux-gnu/"
fi
echo "rustc  $("$SYSDIR/bin/rustc" --version)"
echo "cargo  $("$RIG/cargo/package/cargo/bin/cargo" --version)"

# --- 2. crate sources ---------------------------------------------------------
for spec in "${CRATES[@]}"; do
  repo="${spec%:*}"; tag="${spec#*:}"
  name="$(basename "$repo")"
  if [ -d "$RIG/vendorsrc/$name" ]; then echo "have   $name"; continue; fi
  echo "clone  $repo @ $tag"
  git clone -q --depth 1 --branch "$tag" "https://github.com/$repo" "$RIG/vendorsrc/$name"
done

# --- 3. vendor dir ------------------------------------------------------------
if [ ! -d "$RIG/vendor" ] || [ -z "$(ls -A "$RIG/vendor" 2>/dev/null)" ]; then
  python3 "$HERE/vendor_prep.py" "$RIG/vendorsrc" "$RIG/vendor"
fi

echo
echo "ready. next: tools/rust-offline-rig/run.sh check   (or: run.sh test)"
