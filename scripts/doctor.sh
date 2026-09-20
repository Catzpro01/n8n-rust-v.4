#!/usr/bin/env bash
# doctor.sh — preflight + live health for n8n-ts baseline
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a || true

PORT="${N8N_TS_PORT:-${PORT:-5678}}"
PID_FILE="${N8N_TS_PID_FILE:-run/n8n-ts.pid}"
if [[ "$PID_FILE" = /* ]]; then PID_PATH="$PID_FILE"; else PID_PATH="$ROOT/$PID_FILE"; fi

log() { printf '[doctor] %s\n' "$*"; }
pass() { printf '[doctor] PASS  %s\n' "$*"; }
fail() { printf '[doctor] FAIL  %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0

log "n8n-ts baseline doctor"
log "root=$ROOT"

if command -v node >/dev/null 2>&1; then
  pass "node $(node -v)"
else
  fail "node missing"
fi

if [[ -f "$ROOT/apps/n8n-ts/src/doctor-check.mjs" ]]; then
  if node "$ROOT/apps/n8n-ts/src/doctor-check.mjs"; then
    pass "in-process doctor-check"
  else
    fail "in-process doctor-check"
  fi
else
  fail "doctor-check.mjs missing"
fi

# Scripts executable?
for s in install start stop upgrade rollback doctor; do
  f="$ROOT/scripts/${s}.sh"
  if [[ -x "$f" || -f "$f" ]]; then
    pass "script $s.sh"
  else
    fail "script $s.sh missing"
  fi
done

# Live process?
if [[ -f "$PID_PATH" ]] && kill -0 "$(cat "$PID_PATH")" 2>/dev/null; then
  pass "process running pid=$(cat "$PID_PATH")"
  if curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null; then
    BODY="$(curl -sf "http://127.0.0.1:${PORT}/healthz")"
    pass "live healthz: $BODY"
  else
    fail "healthz not responding on :$PORT"
  fi
else
  log "process not running (ok if not started yet)"
  log "hint: ./scripts/start.sh"
fi

# Docker files present?
if [[ -f "$ROOT/deploy/docker/Dockerfile.n8n-ts" ]]; then
  pass "Dockerfile.n8n-ts"
else
  fail "Dockerfile.n8n-ts missing"
fi

if [[ "$FAILURES" -gt 0 ]]; then
  log "doctor finished with $FAILURES failure(s)"
  exit 1
fi
log "doctor OK"
exit 0
