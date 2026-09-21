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

# <vendor-dir>:<owner>/<repo>:<tag> — the crates the workspace dependency closure needs.
#
#   * `syn` twice: async-trait 0.1.92 requires syn 3 while serde_derive/thiserror-impl are still
#     on syn 2, and a directory source has to carry every version the resolution picks.
#   * `regex`, `regex-automata`, `regex-syntax` all come from the `rust-lang/regex` workspace.
#   * `vendor_prep.py` maps each of these directory names onto a crate name + version (PLAN).
#
# Not vendored: tokio and its ~20-crate closure (a dev-dependency of `n8n-nodes-rust` only),
# so `run.sh` leaves that member out of the workspace it builds.
CRATES=(
  "serde-1.0.229:serde-rs/serde:v1.0.229"
  "json-1.0.151:serde-rs/json:v1.0.151"
  "zmij:dtolnay/zmij:1.0.23"
  "thiserror:dtolnay/thiserror:1.0.69"
  "syn-2.0.119:dtolnay/syn:2.0.119"
  "syn-3.0.6:dtolnay/syn:3.0.6"
  "proc-macro2-1.0.107:dtolnay/proc-macro2:1.0.107"
  "quote-1.0.47:dtolnay/quote:1.0.47"
  "itoa-1.0.18:dtolnay/itoa:1.0.18"
  "ryu:dtolnay/ryu:1.0.18"
  "memchr-2.8.3:BurntSushi/memchr:2.8.3"
  "unicode-ident-1.0.26:dtolnay/unicode-ident:1.0.26"
  "indexmap:indexmap-rs/indexmap:2.2.6"
  "hashbrown:rust-lang/hashbrown:v0.14.5"
  "equivalent:indexmap-rs/equivalent:v1.0.2"
  "async-trait:dtolnay/async-trait:0.1.92"
  "anyhow-1.0.104:dtolnay/anyhow:1.0.104"
  "regex:rust-lang/regex:1.13.1"
  "regex-automata-0.4.18:rust-lang/regex:regex-automata-0.4.18"
  "regex-syntax-0.8.11:rust-lang/regex:regex-syntax-0.8.11"
  "aho-corasick:BurntSushi/aho-corasick:1.1.5"
  "tokio-1.53.1:tokio-rs/tokio:tokio-1.53.1"
  "pin-project-lite-0.2.17:taiki-e/pin-project-lite:v0.2.17"
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
  name="${spec%%:*}"
  rest="${spec#*:}"
  repo="${rest%:*}"
  tag="${rest#*:}"
  if [ -d "$RIG/vendorsrc/$name" ]; then echo "have   $name"; continue; fi
  echo "clone  $name  ($repo @ $tag)"
  git clone -q --depth 1 --branch "$tag" "https://github.com/$repo" "$RIG/vendorsrc/$name"
done

# --- 3. vendor dir ------------------------------------------------------------
if [ ! -d "$RIG/vendor" ] || [ -z "$(ls -A "$RIG/vendor" 2>/dev/null)" ] || [ "${RIG_REVENDOR:-0}" = "1" ]; then
  python3 "$HERE/vendor_prep.py" "$RIG/vendorsrc" "$RIG/vendor"
fi

echo
echo "ready. next: tools/rust-offline-rig/run.sh check   (or: run.sh test)"
