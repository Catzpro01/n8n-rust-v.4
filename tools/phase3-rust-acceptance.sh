#!/usr/bin/env bash
# Agent 5 — Phase-3 Rust acceptance (closes the MSG-14 / MSG-19 gate work).
#
# Phase 2 (no workspace manifest at the repo root): SKIP, exit 0.
# Phase 3: run the Rust test suite — real `cargo test` when a toolchain is on
# PATH (the VPS), otherwise the offline rig (tools/rust-offline-rig) — plus the
# reference-integrity check (G04), and record the outcome in
# docs/isolation/evidence/rust-test-record.json, which the conformance harness
# asserts fresh on every run ("FAIL when crates/** exists but cargo test has
# never run").
#
# The live run is skipped when the recorded evidence is already fresh for this
# exact tree state (same HEAD + same fixtures hash + PASS); pass --force to
# re-run unconditionally.
#
# Usage: bash tools/phase3-rust-acceptance.sh [--force]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RECORD="docs/isolation/evidence/rust-test-record.json"
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1

if ! grep -q '\[workspace\]' Cargo.toml 2>/dev/null; then
  echo "Phase-3 Rust acceptance: SKIP (Phase 2 — no workspace manifest at the repo root)"
  exit 0
fi

HEAD="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
FIXSHA="$(sha256sum tests/reference/workflow-rust/fixtures.json 2>/dev/null | awk '{print $1}')"
RUST_INPUTS_DIRTY="$(git status --porcelain -- crates Cargo.toml Cargo.lock tests/reference/workflow-rust tools/rust-offline-rig tools/phase3-rust-acceptance.sh 2>/dev/null | head -n 5)"
if [ -n "$RUST_INPUTS_DIRTY" ]; then
  echo "!! WARNING: Rust inputs have uncommitted changes — the record will attest"
  echo "!! HEAD ($HEAD), so commit first and re-run for a meaningful attestation:"
  echo "$RUST_INPUTS_DIRTY" | sed 's/^/!!   /'
fi

# Freshness = record PASS + Rust inputs unchanged since the recorded commit +
# same fixtures hash + G04 PASS. The record commit itself (record + results
# files) never invalidates evidence; any Rust-input change does.
if [ "$FORCE" -eq 0 ] && [ -f "$RECORD" ]; then
  REC_HEAD="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('headCommit',''))" "$RECORD" 2>/dev/null || true)"
  INPUTS_SAME=1
  if [ -n "$REC_HEAD" ] && [ "$REC_HEAD" != "unknown" ]; then
    git diff --quiet "$REC_HEAD" HEAD -- crates Cargo.toml Cargo.lock tests/reference/workflow-rust tools/rust-offline-rig tools/phase3-rust-acceptance.sh 2>/dev/null && INPUTS_SAME=0
  fi
  if [ "$INPUTS_SAME" -eq 0 ] && python3 - "$RECORD" "$FIXSHA" <<'EOF' 2>/dev/null; then
import json, sys
record = json.load(open(sys.argv[1]))
sys.exit(0 if (record.get("result") == "PASS"
               and record.get("fixturesSha256") == sys.argv[2]
               and record.get("referenceIntegrity") == "PASS") else 1)
EOF
    echo "Phase-3 Rust acceptance: FRESH EVIDENCE (Rust inputs unchanged since ${REC_HEAD}) — live run skipped (pass --force to re-run)"
    exit 0
  fi
fi

RUNNER=""; TEST_OUT=""; TEST_RC=1
if command -v cargo >/dev/null 2>&1; then
  RUNNER="cargo $(cargo --version | awk '{print $2}') (PATH)"
  echo "== runner: $RUNNER"
  set +e
  TEST_OUT="$(cargo test --workspace 2>&1)"; TEST_RC=$?
  set -e
else
  RUNNER="tools/rust-offline-rig (rustc 1.88.0, vendored crates)"
  echo "== runner: $RUNNER"
  if [ ! -d "${RUST_RIG:-/tmp/rust-rig}/vendor" ]; then
    echo "== rig missing — running setup (needs npm + github egress)..."
    bash tools/rust-offline-rig/setup.sh || { echo "RIG SETUP FAILED"; exit 1; }
  fi
  set +e
  TEST_OUT="$(bash tools/rust-offline-rig/run.sh test 2>&1)"; TEST_RC=$?
  set -e
fi

echo "$TEST_OUT" | tail -n 15

# reference integrity (G04) at the same tree state
REF_LINE=""; REF_RC=1
set +e
REF_LINE="$(node tools/workflow-reference-manifest.mjs --check 2>&1 | tail -n 3 | tr '\n' ' ' | sed 's/  */ /g')"; REF_RC=$?
set -e
echo "== reference integrity: $([ $REF_RC -eq 0 ] && echo PASS || echo FAIL)"

# fixtures reproduction when the pinned runtime is installed (informational:
# recorded, never a failure on its own — the Rust harness asserts the counts)
FIXTURES_CHECK="NOT RUN (pinned runtime not installed)"
if [ -f tests/reference/workflow-rust/fixtures.json ] && { [ -d .runtime/node_modules/n8n-workflow ] || [ -n "${LEGO_LIVE_RUNTIME:-}" ]; }; then
  set +e
  node tests/reference/workflow-rust/build-fixtures.mjs --check >/dev/null 2>&1
  [ $? -eq 0 ] && FIXTURES_CHECK="PASS (re-derived byte-exactly)" || FIXTURES_CHECK="FAIL (drift vs pinned runtime)"
  set -e
fi
echo "== fixtures reproduction: $FIXTURES_CHECK"

RESULT="FAIL"; [ $TEST_RC -eq 0 ] && [ $REF_RC -eq 0 ] && RESULT="PASS"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$(dirname "$RECORD")"
export ACCEPT_NOW="$NOW" ACCEPT_RUNNER="$RUNNER" ACCEPT_RESULT="$RESULT"
export ACCEPT_TEST_RC="$TEST_RC" ACCEPT_REF_RC="$REF_RC"
export ACCEPT_REF_LINE="$REF_LINE" ACCEPT_FIXTURES="$FIXTURES_CHECK"
export ACCEPT_HEAD="$HEAD" ACCEPT_FIXSHA="$FIXSHA" ACCEPT_TAIL="$(echo "$TEST_OUT" | tail -n 15)"
export ACCEPT_SUMMARY="$(echo "$TEST_OUT" | grep -E '^test result' || true)"
python3 - "$RECORD" <<'EOF'
import json, os, sys
record = {
    "generatedAt": os.environ["ACCEPT_NOW"],
    "phase": "phase-3",
    "runner": os.environ["ACCEPT_RUNNER"],
    "result": os.environ["ACCEPT_RESULT"],
    "cargoTestExit": int(os.environ["ACCEPT_TEST_RC"]),
    "referenceIntegrity": "PASS" if os.environ["ACCEPT_REF_RC"] == "0" else "FAIL",
    "referenceDetail": os.environ["ACCEPT_REF_LINE"].strip(),
    "fixturesReproduction": os.environ["ACCEPT_FIXTURES"],
    "headCommit": os.environ["ACCEPT_HEAD"],
    "fixturesSha256": os.environ["ACCEPT_FIXSHA"],
    "testSummary": [l for l in os.environ["ACCEPT_SUMMARY"].strip().splitlines() if l],
    "testTail": os.environ["ACCEPT_TAIL"].strip().splitlines(),
}
json.dump(record, open(sys.argv[1], "w"), indent=2)
open(sys.argv[1], "a").write("\n")
print(f"record written: {sys.argv[1]}")
EOF

[ "$RESULT" = "PASS" ] && { echo "PHASE-3 RUST ACCEPTANCE: PASS"; exit 0; } || { echo "PHASE-3 RUST ACCEPTANCE: FAIL"; exit 1; }
