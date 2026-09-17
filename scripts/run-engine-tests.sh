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

FILES=("test/0"*.test.mjs)
ORACLE=0
if RUNTIME="$(find_runtime)"; then
  export LEGO_LIVE_RUNTIME="$RUNTIME"
  echo "reference runtime: $RUNTIME/node_modules"
  ORACLE=1
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
fi
if [ "${ENGINE_ALLOW_NO_ORACLE:-0}" = "1" ] || [ "$ORACLE" = "1" ]; then
  FILES+=("test/oracle/"*.test.mjs)
fi

cd "$ROOT/packages/reconstructed-engine"

# One process per gate file, and the totals are ours, not the runner's.
#
# Why: `--test-force-exit` is required (importing n8n-core leaves its DI logger handle
# open, so the runner would otherwise hang after the last assertion), and it is also
# lossy — observed runs of this very suite reported `# tests 97/100/102 / fail 0` for 103
# tests, because results still in flight when the process is killed never reach either the
# ok lines or the summary. A green summary can therefore under-report. Running one file at a
# time makes the count checkable per file (declared vs printed), which is what catches that
# class of silence; the aggregate below is then computed from the files, not trusted.
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0
FAILED_FILES=()
for file in "${FILES[@]}"; do
  LOG="$(mktemp)"
  # Every count below must survive `set -e`: grep exits 1 when it matched nothing, which is
  # a RESULT (zero tests), not a shell error. Losing the script to it would hide the real
  # verdict — the same failure shape as the truncated summaries this loop exists to catch.
  STATUS=0
  node --test --test-force-exit "$file" >"$LOG" 2>&1 || STATUS=$?
  DECLARED=$(sed -n 's/^# tests \([0-9]*\)$/\1/p' "$LOG" | tail -1)
  SEEN=$(grep -cE '^(ok|not ok) [0-9]+ - ' "$LOG" || true)
  FILE_FAIL=$(sed -n 's/^# fail \([0-9]*\)$/\1/p' "$LOG" | tail -1)
  FILE_SKIP=$(sed -n 's/^# skipped \([0-9]*\)$/\1/p' "$LOG" | tail -1)
  DECLARED=${DECLARED:-0}; SEEN=${SEEN:-0}; FILE_FAIL=${FILE_FAIL:-0}; FILE_SKIP=${FILE_SKIP:-0}

  # Per-file tally lines are dropped: the aggregate at the end is the only count a
  # reader (or the evidence recorder) should see, so the two can never disagree.
  grep -vE '^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ' "$LOG" || true
  rm -f "$LOG"

  if [ "$DECLARED" != "$SEEN" ]; then
    echo "RESULT INTEGRITY FAILED in $file: runner declared $DECLARED tests, output holds $SEEN results." >&2
    echo "  With --test-force-exit a truncated run still prints 'fail 0'; re-running the file alone" >&2
    echo "  distinguishes a flaky summary from a real failure." >&2
    FAILED_FILES+=("$file (truncated summary)")
    continue
  fi
  if [ "$DECLARED" = "0" ]; then
    FAILED_FILES+=("$file (no tests reported — did the file fail to load?)")
    continue
  fi
  TOTAL=$((TOTAL + DECLARED))
  FAILED=$((FAILED + FILE_FAIL))
  SKIPPED=$((SKIPPED + FILE_SKIP))
  PASSED=$((PASSED + DECLARED - FILE_FAIL - FILE_SKIP))
  if [ "$STATUS" -ne 0 ] && [ "$FILE_FAIL" = "0" ]; then
    FAILED_FILES+=("$file (exit $STATUS with no reported failure)")
  fi
done

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
  for f in "${FAILED_FILES[@]}"; do echo "  FAILED: $f" >&2; done
fi

echo "# tests $TOTAL"
echo "# suites 0"
echo "# pass $PASSED"
echo "# fail $FAILED"
echo "# cancelled 0"
echo "# skipped $SKIPPED"
echo "# todo 0"

if [ "$FAILED" -ne 0 ] || [ ${#FAILED_FILES[@]} -gt 0 ]; then
  exit 1
fi
exit 0
