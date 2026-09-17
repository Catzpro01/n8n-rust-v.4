#!/usr/bin/env bash
set -euo pipefail

RIG="${RUST_RIG:-/tmp/rust-rig}"
RUST_VERSION="1.88.0"
NPM_HOST="https://registry.npmjs.org"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
  "dtolnay/anyhow:1.0.98"
  "indexmap-rs/indexmap:2.2.6"
  "petgraph/petgraph:petgraph@v0.6.5"
  "rust-lang/hashbrown:v0.14.5"
  "petgraph/fixedbitset:0.4.2"
  "indexmap-rs/equivalent:1.0.1"
  "rust-lang/regex:1.10.0"
  "BurntSushi/aho-corasick:1.1.0"
)

mkdir -p "$RIG/dl" "$RIG/vendorsrc"

fetch_npm() {
  local pkg="$1"
  local url="$2"
  local out="$RIG/dl/$(basename "$url")"
  if [ -f "$out" ]; then echo "have   $(basename "$out")"; return; fi
  echo "fetch  $pkg"
  curl -sSL --retry 3 --retry-delay 2 -o "$out" "$url"
}

extract_npm() {
  local tgz="$1"
  local dest="$2"
  [ -d "$dest" ] && { echo "have   $(basename "$dest")"; return; }
  mkdir -p "$dest"
  tar -xzf "$tgz" -C "$dest"
}

echo "== rig root: $RIG"

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
echo "rustc  $($SYSDIR/bin/rustc --version)"
echo "cargo  $($RIG/cargo/package/cargo/bin/cargo --version)"

for spec in "${CRATES[@]}"; do
  repo="${spec%:*}"; tag="${spec#*:}"
  name="$(basename "$repo")"
  if [ -d "$RIG/vendorsrc/$name" ]; then echo "have   $name"; continue; fi
  echo "clone  $repo @ $tag"
  if git clone -q --depth 1 --branch "$tag" "https://github.com/$repo" "$RIG/vendorsrc/$name" 2>/dev/null; then
    echo "  cloned as branch $tag"
  else
    echo "  branch $tag not found, trying tag checkout"
    git clone -q --depth 1 "https://github.com/$repo" "$RIG/vendorsrc/$name"
    cd "$RIG/vendorsrc/$name"
    git fetch -q --depth 1 origin tag "$tag" 2>/dev/null || git fetch -q --tags --depth 1 2>&1 | tail
    git checkout -q "$tag" 2>/dev/null || git checkout -q "tags/$tag" 2>/dev/null || echo "  warning: could not checkout $tag, using HEAD"
    cd - >/dev/null
  fi
done

# Handle regex sub-crates that are in same repo - always ensure they are fresh from regex 1.10.0
if [ -d "$RIG/vendorsrc/regex" ]; then
  echo "copy   regex-automata from regex repo (1.10.0)"
  rm -rf "$RIG/vendorsrc/regex-automata"
  cp -a "$RIG/vendorsrc/regex/regex-automata" "$RIG/vendorsrc/regex-automata"
  echo "copy   regex-syntax from regex repo (1.10.0)"
  rm -rf "$RIG/vendorsrc/regex-syntax"
  cp -a "$RIG/vendorsrc/regex/regex-syntax" "$RIG/vendorsrc/regex-syntax"
fi

if [ ! -d "$RIG/vendor" ] || [ -z "$(ls -A "$RIG/vendor" 2>/dev/null)" ]; then
  python3 "$HERE/vendor_prep.py" "$RIG/vendorsrc" "$RIG/vendor"
else
  python3 "$HERE/vendor_prep.py" "$RIG/vendorsrc" "$RIG/vendor"
fi

echo
echo "ready. next: tools/rust-offline-rig/run.sh check   (or: run.sh test)"
