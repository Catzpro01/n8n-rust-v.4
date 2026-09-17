#!/usr/bin/env bash
# Runs the reconstructed-engine gates with the reference runtime wired up.
#
# Gates 00-06 and the goldens are offline-safe: fixtures/*.json were RECORDED from
# the pinned reference and committed, so `npm test` proves behaviour without npm
# install. Gate 07 (falsification) re-runs the suite over mutated copies, and gate 10
# (oracle) re-derives the same probes from the live runtime; both want the runtime.
#
# usage: scripts/run-engine-tests.sh [extra node --test args]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find_runtime() {
  # ENGINE_NO_RUNTIME=1 makes the offline path reproducible on a machine that DOES have
  # .runtime (the evidence recorder needs both modes in one session, and `.runtime`
  # cannot be renamed from inside a script without racing other lanes).
  if [ "${ENGINE_NO_RUNTIME:-0}" = "1" ]; then
    return 1
  fi
  for dir in "${LEGO_LIVE_RUNTIME:-}" "$ROOT/.runtime" "/home/user/.n8n-live"; do
    [ -n "$dir" ] || continue
    if [ -f "$dir/node_modules/n8n-workflow/package.json" ] && [ -f "$dir/node_modules/n8n-core/package.json" ]; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

ARGS=()
if RUNTIME="$(find_runtime)"; then
  export LEGO_LIVE_RUNTIME="$RUNTIME"
  echo "reference runtime: $RUNTIME/node_modules"
  ARGS+=("test/oracle/*.test.mjs")
else
  if [ "${ENGINE_NO_RUNTIME:-0}" = "1" ]; then
    # Deliberate offline mode, not a missing dependency: say so on stdout so the captured
    # transcript proves WHICH environment the suite ran in (gate 08 asserts this line).
    echo "reference runtime: suppressed by ENGINE_NO_RUNTIME=1 (offline mode on purpose)"
  else
    echo "WARNING: reference runtime not found — oracle gate will fail with setup instructions." >&2
    echo "         run: scripts/setup-reference-runtime.sh" >&2
    echo "         (or set ENGINE_ALLOW_NO_ORACLE=1 to turn it into a loud diagnostic)" >&2
  fi
  if [ "${ENGINE_ALLOW_NO_ORACLE:-0}" = "1" ]; then
    ARGS+=("test/oracle/*.test.mjs")
  fi
fi

cd "$ROOT/packages/reconstructed-engine"
# --test-force-exit: importing n8n-core leaves a live handle (its DI logger), which
# would otherwise hang the runner after the last assertion has already passed.
exec node --test --test-force-exit "test/0"*.test.mjs "${ARGS[@]}" "$@"
