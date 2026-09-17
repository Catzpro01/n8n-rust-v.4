#!/usr/bin/env bash
# Agent 5 — STAGE 2k: port-vs-engine differential.
#
# Runs tests/differential/cases.json through BOTH implementations and compares their
# answers to EACH OTHER. No expected values are stored anywhere, so this harness
# cannot encode a wrong expectation — the only way it passes is if the two agree.
#
# Implements the ISSUE-026 rule: a divergence claim requires BOTH sides executed.
# ISSUE-017 was filed, escalated and carried for cycles on evidence from one side only.
#
# crates/ is never modified: the port-side test is copied into the offline rig's
# build directory, which run.sh recreates from scratch on every invocation.
#
# CRASH HANDLING. A Rust stack overflow aborts the process and cannot be caught, so a
# single crashing case would otherwise hide every case behind it. The port streams one
# answer per line and the driver re-runs it with DIFF_SKIP set to the ids that have
# already crashed, until the list completes. Each crashed case is reported as its own
# divergence (`<crash: ...>`) rather than as a harness error.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RIG="${RUST_RIG:-/tmp/rust-rig}"
EXPR="${EXPR_RIG:-/tmp/expr-rig}"

echo "=== [AGENT 5] PORT vs ENGINE DIFFERENTIAL ==="
echo "compares two executed implementations; stores no expected values"
echo

if [ ! -d "$EXPR/node_modules/n8n-workflow" ]; then
  echo "  SKIP: reference engine not installed at $EXPR"
  echo "DIFFERENTIAL: SKIPPED (not a PASS)"; exit 0
fi
if [ ! -d "$RIG/vendor" ]; then
  echo "  SKIP: rust rig not built at $RIG (tools/rust-offline-rig/setup.sh)"
  echo "DIFFERENTIAL: SKIPPED (not a PASS)"; exit 0
fi

engine="$(node "$REPO/tests/differential/engine_side.mjs" "$REPO")" || {
  echo "  engine side failed"; echo "DIFFERENTIAL: FAIL"; exit 1; }

# Build the port side inside the rig, injecting the probe as a crate test.
BUILD="$RIG/build/repo"
rm -rf "$BUILD"; mkdir -p "$BUILD/.cargo"
cp -a "$REPO/Cargo.toml" "$BUILD/"
cp -a "$REPO/crates" "$BUILD/"
mkdir -p "$BUILD/tests/differential"
cp -a "$REPO/tests/differential/cases.json" "$BUILD/tests/differential/"
[ -d "$REPO/tests/reference" ] && cp -a "$REPO/tests/reference" "$BUILD/tests/"
mkdir -p "$BUILD/crates/n8n-workflow/tests"
cp "$REPO/tests/differential/port_side.rs" \
   "$BUILD/crates/n8n-workflow/tests/zz_differential.rs"
cat > "$BUILD/.cargo/config.toml" <<CFG
[source.crates-io]
replace-with = "vendored"
[source.vendored]
directory = "$RIG/vendor"
[net]
offline = true
CFG

export PATH="$RIG/rust/package/rustc/bin:$RIG/cargo/package/cargo/bin:$PATH"
export CARGO_HOME="${CARGO_HOME:-$RIG/cargo-home}"
export CARGO_TARGET_DIR="$RIG/target"

answers="$(mktemp)"; crashes="$(mktemp)"
trap 'rm -f "$answers" "$crashes"' EXIT
skip=""

# Re-run the port, skipping already-crashed cases, until it reaches PORT_DONE.
for attempt in $(seq 1 40); do
  raw="$(cd "$BUILD" && DIFF_SKIP="$skip" cargo test --offline -p n8n-workflow \
         --test zz_differential -- --nocapture 2>&1)"
  printf '%s\n' "$raw" | grep '^PORT_CASE ' >> "$answers"
  if printf '%s\n' "$raw" | grep -q '^PORT_DONE'; then
    break
  fi
  # Last announced case is the one that killed the process.
  culprit="$(printf '%s\n' "$raw" | grep '^PORT_ENTER ' | tail -1 | awk '{print $2}')"
  reason="$(printf '%s\n' "$raw" | grep -Eio 'has overflowed its stack|panicked at.*' \
            | head -1 | cut -c1-80)"
  [ -n "$culprit" ] || { echo "  port produced no output at all:"; \
      printf '%s\n' "$raw" | tail -15 | sed 's/^/      /'; \
      echo "DIFFERENTIAL: FAIL"; exit 1; }
  echo "$culprit|${reason:-aborted}" >> "$crashes"
  echo "  PORT ABORTED on case '$culprit' (${reason:-aborted}) — retrying past it"
  skip="${skip:+$skip,}$culprit"
done
echo

# contract-declared deviations (D-09 workflow-LEGO, ISSUE-030): reported, not fatal.
DECLARED_DEVIATIONS='{"unknown-node-start": "D-09 (workflow-LEGO) contracts/workflow.contract.md - engine TypeError is an incidental unguarded deref; port returns None by decision (ISSUE-030)"}'
ENGINE_JSON="$engine" ANSWERS="$answers" CRASHES="$crashes" DECLARED_DEVIATIONS="$DECLARED_DEVIATIONS" python3 - <<'PY'
import json, os, sys
e = json.loads(os.environ["ENGINE_JSON"])

p = {}
for line in open(os.environ["ANSWERS"]):
    if not line.startswith("PORT_CASE "):
        continue
    _, cid, payload = line.rstrip("\n").split(" ", 2)
    p[cid] = json.loads(payload)

crashes = {}
for line in open(os.environ["CRASHES"]):
    cid, _, reason = line.rstrip("\n").partition("|")
    crashes[cid] = reason

# Deviations the WORKFLOW CONTRACT explicitly declares (never silent). A divergence on
# one of these cases is reported separately and is not gate-fatal; anything undeclared
# still is. Keep in lockstep with contracts/workflow.contract.md (D-09 = ISSUE-030).
DECLARED_DEVIATIONS = json.loads(os.environ.get("DECLARED_DEVIATIONS") or "{}")

bad, declared_hits = 0, []
for k in sorted(k for k in set(e) | set(p) | set(crashes) if not k.startswith("_")):
    ev = e.get(k, "<missing>")
    if k in crashes:
        pv = f"<crash: {crashes[k]}>"
    else:
        pv = p.get(k, "<missing>")
    if k in crashes or ev != pv:
        if k in DECLARED_DEVIATIONS and k not in crashes:
            declared_hits.append(k)
            print(f"  DECLARED DEVIATION {k} -> {DECLARED_DEVIATIONS[k]}")
            print(f"      engine: {json.dumps(ev)}")
            print(f"      port  : {json.dumps(pv)}")
        else:
            bad += 1
            print(f"  DIVERGENCE {k}")
            print(f"      engine: {json.dumps(ev)}")
            print(f"      port  : {pv if k in crashes else json.dumps(pv)}")

total = len([k for k in e if not k.startswith("_")])
print(f"\nRESULT: {total - bad}/{total} cases identical between the real n8n 2.9.4 "
      f"engine and the Rust port; {bad} undeclared divergence(s), "
      f"{len(declared_hits)} declared deviation(s) {sorted(declared_hits)}"
      + (f", {len(crashes)} process abort(s)" if crashes else ""))
if bad:
    print("DIFFERENTIAL: FAIL")
elif declared_hits:
    print("DIFFERENTIAL: PASS (with declared deviations - contract refs above)")
else:
    print("DIFFERENTIAL: PASS")
sys.exit(1 if bad else 0)
PY
