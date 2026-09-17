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

echo; echo "######## STAGE 3: DOCKER + POSTGRES SMOKE (5 checks, needs a running n8n) ########"
# Snapshot the offline result before any live stage can touch it, so the summary line still
# reports the offline stages on their own merits.
offline_fail=$fail
# NOTE: this stage was previously titled "11/11 LIVE REGRESSION GATE". That title was wrong.
# tests/integration/regression_gate.py implements 5 checks (total_checks = 5) against a running
# n8n on 127.0.0.1:5678 plus `docker exec n8n-db-1 psql`. The "11/11" the repo cites is gate G11
# of the 11 in tools/workflow-isolation-gate.mjs — a different mechanism that needs no docker.
# Conflating the two meant this stage could only ever print NOT RUN, which made the whole gate
# permanently INCONCLUSIVE even when all 11 real gates passed. See ISSUE-029.
if [ "$OFFLINE" = "1" ]; then
  echo "SKIPPED (--offline-only): docker/Postgres smoke NOT RUN."
  smoke="NOT RUN"
elif ! command -v docker >/dev/null 2>&1; then
  echo "SKIPPED: docker not available in this environment — docker/Postgres smoke NOT RUN."
  smoke="NOT RUN"
else
  python3 tests/integration/regression_gate.py && smoke="PASS" || { smoke="FAIL"; fail=1; }
fi

echo; echo "######## STAGE 3b: 11/11 LIVE GATE EVIDENCE (G01..G11, provenance-checked) ########"
# The real live regression: tools/workflow-isolation-gate.mjs runs 11 gates, G11 being live
# verification with the reference execution engine (load / save / 1-node / linear / webhook /
# execution record). It needs .runtime, not docker. This stage consumes its evidence and only
# accepts it when the evidence is attributable to the tree being gated — recorded headCommit
# plus an unchanged diff over the paths the gates read (same freshness rule as Stage 2b).
REPORT=docs/isolation/evidence/gate-report.json
if [ "$OFFLINE" = "1" ]; then
  echo "SKIPPED (--offline-only): 11/11 live gate NOT RUN — gate cannot be declared VERIFIED."
  live="NOT RUN"
elif [ ! -f "$REPORT" ]; then
  echo "MISSING: $REPORT — run: npm run verify"
  live="MISSING"; fail=1
else
  live=$(python3 - "$REPORT" <<'PY'
import json, subprocess, sys

report_path = sys.argv[1]
try:
    d = json.load(open(report_path))
except Exception as exc:
    print(f"UNREADABLE ({exc})"); sys.exit(0)

git = d.get("git") or {}
totals = d.get("totals") or {}
gates = d.get("gates") or []
live_gate = next((g for g in gates if g.get("id") == "G11"), None)

problems = []
if totals.get("gates") != 11 or totals.get("passed") != 11:
    problems.append(f"totals are {totals.get('passed')}/{totals.get('gates')}, want 11/11")
if d.get("behaviorChange") != "NONE DETECTED":
    problems.append(f"behaviorChange is {d.get('behaviorChange')!r}")
if live_gate is None:
    problems.append("no G11 entry in the report")
elif live_gate.get("status") != "PASS":
    problems.append(f"G11 status is {live_gate.get('status')!r}")

head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
recorded = git.get("headCommit") or ""
if not recorded or recorded == "unknown":
    problems.append("evidence carries no headCommit — regenerate with: npm run verify")
else:
    paths = git.get("inputPaths") or []
    diff = subprocess.run(["git", "diff", "--quiet", recorded, "HEAD", "--", *paths],
                          capture_output=True, text=True)
    if diff.returncode != 0:
        problems.append(f"inputs changed since {recorded[:8]} — re-run: npm run verify")
    if git.get("dirtyInputs"):
        problems.append(f"uncommitted changes in gate inputs: {git['dirtyInputs'][:3]}")
    # dirtyInputs is what the tree looked like when the report was WRITTEN. Check the tree as
    # it is NOW too, or an edit made after the run is accepted as fresh evidence.
    now_dirty = subprocess.run(
        ["git", "status", "--porcelain", "--", *paths], capture_output=True, text=True
    ).stdout.strip()
    if now_dirty:
        first = [ln.strip() for ln in now_dirty.splitlines()[:3]]
        problems.append(f"gate inputs have uncommitted changes now: {first}")

if problems:
    print("STALE/FAILED (" + "; ".join(problems) + ")")
else:
    print(f"PASS (11/11 at {recorded[:8]}, G11 live verified)")
PY
)
  echo "11/11 LIVE GATE : $live"
  case "$live" in
    PASS*) : ;;
    *) fail=1 ;;
  esac
fi

echo; echo "======================================================="
echo "OFFLINE STAGES : $([ $offline_fail -eq 0 ] && echo PASS || echo FAIL)"
echo "LIVE 11/11     : $live"
echo "DOCKER SMOKE   : ${smoke:-NOT RUN}"
if [ $fail -ne 0 ]; then
  echo ">>> INTEGRATION GATE: BLOCKED <<<"; exit 1
elif [ "${live%% *}" != "PASS" ]; then
  echo ">>> INTEGRATION GATE: INCONCLUSIVE (live verification required before merge to main) <<<"; exit 2
else
  echo ">>> INTEGRATION GATE: PASS <<<"; exit 0
fi
