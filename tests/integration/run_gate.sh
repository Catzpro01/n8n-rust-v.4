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

echo; echo "######## STAGE 2: BOUNDARY & DEPENDENCY AUDIT (offline) ########"
python3 tests/integration/boundary_audit.py || fail=1

echo; echo "######## STAGE 2b: PHASE-3 RUST ACCEPTANCE (evidence-gated) ########"
bash tools/phase3-rust-acceptance.sh || fail=1

echo; echo "######## STAGE 2c: RUST CONFORMANCE AUDIT (offline, static) ########"
# Static complement to 2b: 2b proves the recorded evidence is fresh, this proves the port is
# structurally tied to the reference (every crate reads tests/reference, no silent skips, and at
# least one negative fixture is exercised). See docs/isolation/PHASE-3-OPENING.md.
if [ -d crates ] && [ -f docs/isolation/PHASE-3-OPENING.md ]; then
  python3 tests/integration/rust_conformance_audit.py || fail=1
else
  echo "SKIPPED: no crates/ or no Phase-3 record — nothing to audit."
fi

echo; echo "######## STAGE 2d: MERGE-ORDER SAFETY TOOLING SELF-TEST (offline) ########"
# The cross-branch collision detector (tools/branch-collision-check.mjs, contributed under
# ISSUE-024) is what warns us when two agents wrote different content to the same path. A tool
# that answers "safe to merge in any order" for a ref it could not read is worse than no tool,
# so its own exit-code contract is tested here on every gate run. See ISSUE-026.
if [ -f tools/branch-collision-check.mjs ]; then
  node tools/branch-collision-check.test.mjs || fail=1
else
  echo "SKIPPED: tools/branch-collision-check.mjs not present on this tree."
fi

echo; echo "######## STAGE 2e: DESTRUCTIVE-DELETION SURVEY (advisory, does not fail the gate) ########"
# Delete/modify conflicts across branches: a path one branch deleted and another still ships.
# This is deliberately ADVISORY and never sets fail=1. ISSUE-027 is live right now — PR #16
# really does delete crates/ while this branch and main still ship it — so a blocking check
# would be permanently red until the orchestrator resolves that merge order, and a permanently
# red gate teaches everyone to ignore it. It becomes a blocking stage once ISSUE-027 is closed.
# Its own correctness is enforced by the self-test below (that one does fail the gate).
if [ -f tools/destructive-deletion-check.mjs ]; then
  node tools/destructive-deletion-check.test.mjs || fail=1
  refs=$(git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v '/HEAD$' | wc -l)
  if [ "$refs" -ge 2 ]; then
    # shellcheck disable=SC2046
    node tools/destructive-deletion-check.mjs $(git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v '/HEAD$' | tr '\n' ' ') \
      || echo "  ^ advisory: destructive deletions exist between branches — resolve before merging (ISSUE-027). Not failing the gate."
  else
    echo "SKIPPED: fewer than two origin refs in this clone (fetch the branches to survey them)."
  fi
else
  echo "SKIPPED: tools/destructive-deletion-check.mjs not present on this tree."
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
echo "LIVE 11/11     : $live"
if [ $fail -ne 0 ]; then
  echo ">>> INTEGRATION GATE: BLOCKED <<<"; exit 1
elif [ "$live" != "PASS" ]; then
  echo ">>> INTEGRATION GATE: INCONCLUSIVE (live verification required before merge to main) <<<"; exit 2
else
  echo ">>> INTEGRATION GATE: PASS <<<"; exit 0
fi
