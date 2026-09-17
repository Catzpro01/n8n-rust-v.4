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

port_raw="$(cd "$BUILD" && cargo test --offline -p n8n-workflow \
  --test zz_differential -- --nocapture 2>&1)"
port_rc=$?
if [ $port_rc -ne 0 ] && ! printf '%s' "$port_raw" | grep -q PORT_JSON_BEGIN; then
  # A crash IS a divergence result, not a harness error: the engine answered every
  # case. Report it as such rather than exiting silently.
  echo "  PORT ABORTED before emitting answers (exit $port_rc):"
  printf '%s\n' "$port_raw" | grep -E "overflow|panic|CASE|fatal" | tail -6 | sed 's/^/      /'
  echo
  echo "RESULT: the Rust port could not complete the case list; the engine completed all of it"
  echo "DIFFERENTIAL: FAIL"
  exit 1
fi

port="$(printf '%s\n' "$port_raw" | sed -n '/PORT_JSON_BEGIN/,/PORT_JSON_END/p' \
        | sed '1d;$d')"
[ -n "$port" ] || { echo "  port produced no JSON"; echo "DIFFERENTIAL: FAIL"; exit 1; }

ENGINE_JSON="$engine" PORT_JSON="$port" python3 - <<'PY'
import json, os, sys
e = json.loads(os.environ["ENGINE_JSON"])
p = json.loads(os.environ["PORT_JSON"])
bad = 0
for k in sorted(set(e) | set(p)):
    if k.startswith("_"):
        continue
    ev, pv = e.get(k, "<missing>"), p.get(k, "<missing>")
    if ev != pv:
        bad += 1
        print(f"  DIVERGENCE {k}\n      engine: {json.dumps(ev)}\n      port  : {json.dumps(pv)}")
total = len([k for k in e if not k.startswith("_")])
print(f"\nRESULT: {total - bad}/{total} cases identical between the real n8n 2.9.4 "
      f"engine and the Rust port, {bad} divergence(s)")
print("DIFFERENTIAL: FAIL" if bad else "DIFFERENTIAL: PASS")
sys.exit(1 if bad else 0)
PY
