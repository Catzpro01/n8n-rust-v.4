#!/usr/bin/env bash
# Runs the Workflow LEGO isolation tests with the reference runtime wired up.
#
# The equivalence tests need the pinned reference runtime (n8n-workflow) and real
# node descriptions (n8n-nodes-base). They are discovered automatically, or
# provided via LEGO_REFERENCE_PKG / LEGO_NODES_JSON / LEGO_LIVE_RUNTIME.
#
# usage: scripts/run-lego-tests.sh [extra node --test args]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find_runtime() {
  for dir in "${LEGO_LIVE_RUNTIME:-}" "$ROOT/.runtime/node_modules" "/home/user/.n8n-live/node_modules"; do
    [ -n "$dir" ] || continue
    if [ -f "$dir/n8n-workflow/package.json" ] && [ -f "$dir/n8n-nodes-base/package.json" ]; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

if RUNTIME="$(find_runtime)"; then
  export LEGO_LIVE_RUNTIME="$RUNTIME"
  export LEGO_REFERENCE_PKG="${LEGO_REFERENCE_PKG:-$RUNTIME/n8n-workflow}"
  export LEGO_NODES_JSON="${LEGO_NODES_JSON:-$RUNTIME/n8n-nodes-base/dist/types/nodes.json}"
  echo "reference runtime: $RUNTIME"
else
  echo "WARNING: reference runtime not found — equivalence/strict tests will fail with setup instructions." >&2
  echo "         run: scripts/setup-reference-runtime.sh" >&2
fi

cd "$ROOT/packages/workflow-lego"
exec node --test "test/*.test.mjs" "$@"
