#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Differential compatibility driver — ORIGINAL n8n (Node) vs RUST PORT.
#
#   1. Runs the Node reference harness (verbatim original n8n functions) on
#      every fixture.
#   2. Runs the Rust crate's compat binary on the same fixtures.
#   3. Diffs both outputs line-by-line (strict, order-sensitive).
#   4. Runs the full Rust test suite (unit + embedded golden tests).
#
# Usage (from anywhere):
#   bash tests/compatibility/run.sh
#
# Exit code 0 = all fixtures match AND cargo test passes.
# ─────────────────────────────────────────────────────────────────────────────
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAIL=0
PASS=0

for f in "$SCRIPT_DIR"/fixtures/*.json; do
  name="$(basename "$f" .json)"
  ref_out="$TMP/${name}.ref.txt"
  rust_out="$TMP/${name}.rust.txt"

  if ! node "$SCRIPT_DIR/reference/harness.mjs" "$f" > "$ref_out" 2> "$TMP/${name}.ref.err"; then
    echo "[ERROR] ${name}: reference harness crashed"
    cat "$TMP/${name}.ref.err"
    FAIL=$((FAIL + 1))
    continue
  fi

  if ! (cd "$ROOT" && cargo run --quiet -p n8n-workflow --bin n8n-workflow-compat -- "$f") > "$rust_out" 2> "$TMP/${name}.rust.err"; then
    echo "[ERROR] ${name}: rust compat binary failed"
    cat "$TMP/${name}.rust.err"
    FAIL=$((FAIL + 1))
    continue
  fi

  if diff -u "$ref_out" "$rust_out" > "$TMP/${name}.diff"; then
    echo "[PASS] ${name}"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] ${name} — divergence from original n8n:"
    cat "$TMP/${name}.diff"
    FAIL=$((FAIL + 1))
  fi
done

echo "────────────────────────────────────────────"
echo "differential fixtures: ${PASS} passed, ${FAIL} failed"
echo "────────────────────────────────────────────"

echo "=== [RUST] cargo test (unit + embedded golden) ==="
if (cd "$ROOT" && cargo test -p n8n-workflow); then
  CARGO=0
else
  echo "[FAIL] cargo test"
  CARGO=1
fi

if [ "$FAIL" -eq 0 ] && [ "$CARGO" -eq 0 ]; then
  echo ">>> WORKFLOW RUST COMPATIBILITY: PASS <<<"
  exit 0
else
  echo ">>> WORKFLOW RUST COMPATIBILITY: FAIL <<<"
  exit 1
fi
