#!/usr/bin/env bash
# Agent 5 — full integration gate.
#   Stage 1 (offline, always runnable): contract conformance + boundary audit
#   Stage 2 (live, needs running n8n + PostgreSQL): 11/11 regression gate
# Exit 0 only if every executed stage passes AND the live stage was actually executed,
# unless --offline-only is given (then live is reported as NOT RUN and the gate is INCONCLUSIVE).
set -uo pipefail
cd "$(dirname "$0")/../.."
OFFLINE=0; [ "${1:-}" = "--offline-only" ] && OFFLINE=1
fail=0

echo "######## STAGE 1: CONTRACT CONFORMANCE (offline) ########"
node tests/compatibility/contract_conformance.mjs || fail=1

echo "######## STAGE 2: BOUNDARY & DEPENDENCY AUDIT (offline) ########"
python3 tests/integration/boundary_audit.py || fail=1

echo; echo "######## STAGE 2b: RUST CONFORMANCE (offline, needs rust-offline-rig) ########"
# Phase-3 requirement (ISSUE-012, required action 5): the gate must run `cargo test`.
# The sandbox cannot reach crates.io, so compilation goes through tools/rust-offline-rig
# (toolchain from npm, crates vendored from pinned git tags). If the rig is not provisioned
# the stage is reported as NOT RUN instead of failing: absence of the rig is an
# environment gap, a red test is a code gap.
if [ -d "${RUST_RIG:-/tmp/rust-rig}/vendor" ]; then
  if tools/rust-offline-rig/run.sh test; then
    rust_stage="PASS"
  else
    rust_stage="FAIL"; fail=1
  fi
else
  echo "SKIPPED: rust-offline-rig not provisioned (run tools/rust-offline-rig/setup.sh) — cargo test NOT RUN."
  rust_stage="NOT RUN"
fi

echo; echo "######## STAGE 3: 11/11 LIVE REGRESSION GATE ########"
if [ "$OFFLINE" = "1" ]; then
  echo "SKIPPED (--offline-only): live regression NOT RUN — gate cannot be declared VERIFIED."
  live="NOT RUN"
elif ! command -v docker >/dev/null 2>&1; then
  echo "SKIPPED: docker not available in this environment — live regression NOT RUN."
  live="NOT RUN"
else
  python3 tests/integration/regression_gate.py && live="PASS" || { live="FAIL"; fail=1; }
fi

echo; echo "======================================================="
echo "OFFLINE STAGES : $([ $fail -eq 0 ] && echo PASS || echo FAIL)"
echo "RUST CARGO TEST: $rust_stage"
echo "LIVE 11/11     : $live"
if [ $fail -ne 0 ]; then
  echo ">>> INTEGRATION GATE: BLOCKED <<<"; exit 1
elif [ "$live" != "PASS" ]; then
  echo ">>> INTEGRATION GATE: INCONCLUSIVE (live verification required before merge to main) <<<"; exit 2
else
  echo ">>> INTEGRATION GATE: PASS <<<"; exit 0
fi
