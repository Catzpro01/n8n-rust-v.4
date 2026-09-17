#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Reference-side cross-check: Node harness (verbatim original n8n) vs
# independent Python oracle (crosscheck.py) — plus golden-file consistency.
#
#   A. fixtures:  python output  vs  golden/*.expected.txt (node-captured)
#   B. real workflows (tests/reference/*/workflow.json):
#      node harness  vs  python output  on an adapted fixture
#
# Usage:  bash tests/compatibility/run_crosscheck.sh
# Exit 0 = both sides agree everywhere.
# ─────────────────────────────────────────────────────────────────────────────
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAIL=0
PASS=0

echo "=== [A] python oracle vs golden files (node harness captures) ==="
for f in "$SCRIPT_DIR"/fixtures/*.json; do
  name="$(basename "$f" .json)"
  if python3 "$SCRIPT_DIR/reference/crosscheck.py" "$f" > "$TMP/${name}.py.txt" 2> "$TMP/${name}.py.err"; then
    if diff -u "$SCRIPT_DIR/golden/${name}.expected.txt" "$TMP/${name}.py.txt" > "$TMP/${name}.pydiff"; then
      echo "[PASS] ${name}"
      PASS=$((PASS + 1))
    else
      echo "[FAIL] ${name} — python oracle diverges from node golden:"
      cat "$TMP/${name}.pydiff"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "[FAIL] ${name} — python oracle crashed:"
    cat "$TMP/${name}.py.err"
    FAIL=$((FAIL + 1))
  fi
done

echo "=== [B] real reference workflows: node harness vs python oracle ==="
shopt -s nullglob
for wf in "$ROOT"/tests/reference/*/workflow.json; do
  name="$(basename "$(dirname "$wf")")"
  fx="$TMP/${name}.fixture.json"
  if ! python3 "$SCRIPT_DIR/reference/crosscheck.py" --emit-fixture "$wf" "$fx" > /dev/null; then
    echo "[FAIL] ${name} — fixture adaptation failed"
    FAIL=$((FAIL + 1))
    continue
  fi
  if ! node "$SCRIPT_DIR/reference/harness.mjs" "$fx" > "$TMP/${name}.node.txt" 2> "$TMP/${name}.node.err"; then
    echo "[FAIL] ${name} — node harness crashed on real workflow:"
    cat "$TMP/${name}.node.err"
    FAIL=$((FAIL + 1))
    continue
  fi
  if python3 "$SCRIPT_DIR/reference/crosscheck.py" "$fx" > "$TMP/${name}.py2.txt" 2> /dev/null; then
    if diff -u "$TMP/${name}.node.txt" "$TMP/${name}.py2.txt" > "$TMP/${name}.realdiff"; then
      echo "[PASS] ${name}"
      PASS=$((PASS + 1))
    else
      echo "[FAIL] ${name} — node vs python divergence on real workflow:"
      cat "$TMP/${name}.realdiff"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "[FAIL] ${name} — python oracle crashed on real workflow"
    FAIL=$((FAIL + 1))
  fi
done

echo "────────────────────────────────────────────"
echo "cross-check: ${PASS} passed, ${FAIL} failed"
echo "────────────────────────────────────────────"

if [ "$FAIL" -eq 0 ]; then
  echo ">>> REFERENCE CROSS-CHECK: PASS (node verbatim == python oracle == goldens) <<<"
  exit 0
else
  echo ">>> REFERENCE CROSS-CHECK: FAIL <<<"
  exit 1
fi
