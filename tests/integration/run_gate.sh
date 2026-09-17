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

echo; echo "######## STAGE 2c: TASK-RESULT INTEGRITY AUDIT (offline) ########"
# Adopted from the sibling worker cycle (arena/01a0ace3): the audit catches `SUCCESS`
# results with no recorded operations (ISSUE-018 / T1). Findings are gate-fatal so a
# status line can never substitute for evidence.
python3 tests/integration/result_integrity_audit.py || fail=1

echo; echo "######## STAGE 2d: PEER-REVIEW SWEEP (protocol v4, advisory) ########"
# Protocol v4 (origin/main b70413fc) section 3: review is mandatory BEFORE and AFTER
# each task. The gate runs the POST-task sweep; PHASE makes it append evidence to
# results/PEER-REVIEW-LEDGER.md instead of leaving compliance to self-attestation
# (ISSUE-031, mitigation by agent-5 — adopted). Fatal only while a task sits at
# NEEDS_CORRECTION; recusals (own tasks) are reported, never treated as gaps.
PHASE=POST REVIEWER_ID=agent-1 python3 tests/integration/peer_review_rubric.py | tail -3 || fail=1

echo; echo "######## STAGE 2k: PORT vs ENGINE DIFFERENTIAL (offline, needs expr-rig) ########"
# Adopted from agent-5 (arena/01a0ac12 @ 888c9228, ISSUE-028 cycle): the port and the real
# n8n-workflow engine answer the SAME case list and are compared to EACH OTHER — no expected
# values stored anywhere (ISSUE-026 rule: a divergence claim requires BOTH sides executed).
out=$(bash tests/differential/run.sh 2>&1) || fail=1
echo "$out"
case "$out" in
  *"SKIPPED (not a PASS)"*) differential="SKIPPED";;
  *"DIFFERENTIAL: PASS"*)   differential="PASS";;
  *)                        differential="FAIL"; fail=1;;
esac

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
# ISSUE-025 lesson (agent-5, adopted): a skipped stage must be visible in the summary —
# a flat PASS would let "gate PASS" be quoted while cargo never ran.
if [ "$rust_stage" = "NOT RUN" ] && [ $fail -eq 0 ]; then
  echo "OFFLINE STAGES : PASS WITH SKIPS (Stage 2b NOT RUN — rig missing; run tools/rust-offline-rig/setup.sh)"
else
  echo "OFFLINE STAGES : $([ $fail -eq 0 ] && echo PASS || echo FAIL)"
fi
echo "RUST CARGO TEST: $rust_stage"
echo "RESULT INTEGRITY: $([ $fail -ne 0 ] && echo 'SEE ABOVE' || echo PASS)"
if [ "$differential" = "SKIPPED" ]; then
  echo "DIFFERENTIAL 2k : SKIPPED (not a PASS) — install: mkdir -p /tmp/expr-rig"
  echo "                  && cd /tmp/expr-rig && npm init -y && npm install n8n-workflow@2.9.1 n8n-core@2.9.1"
else
  echo "DIFFERENTIAL 2k : $differential (port vs real engine, 38 cases; declared deviations reported, not fatal)"
fi
echo "LIVE 11/11     : $live"
if [ $fail -ne 0 ]; then
  echo ">>> INTEGRATION GATE: BLOCKED <<<"; exit 1
elif [ "$live" != "PASS" ]; then
  echo ">>> INTEGRATION GATE: INCONCLUSIVE (live verification required before merge to main) <<<"; exit 2
else
  echo ">>> INTEGRATION GATE: PASS <<<"; exit 0
fi
