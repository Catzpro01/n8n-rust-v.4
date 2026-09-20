#!/usr/bin/env bash
# stop.sh — stop n8n-ts baseline
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a || true

PID_FILE="${N8N_TS_PID_FILE:-run/n8n-ts.pid}"
if [[ "$PID_FILE" = /* ]]; then PID_PATH="$PID_FILE"; else PID_PATH="$ROOT/$PID_FILE"; fi

log() { printf '[stop] %s\n' "$*"; }
err() { printf '[stop] ERROR: %s\n' "$*" >&2; }

if [[ ! -f "$PID_PATH" ]]; then
  log "no pid file ($PID_PATH) — nothing to stop"
  # Best-effort: kill listeners on default port if env set
  exit 0
fi

PID="$(cat "$PID_PATH" 2>/dev/null || true)"
if [[ -z "${PID:-}" ]]; then
  rm -f "$PID_PATH"
  log "empty pid file removed"
  exit 0
fi

if ! kill -0 "$PID" 2>/dev/null; then
  log "process $PID not running; removing stale pid file"
  rm -f "$PID_PATH"
  exit 0
fi

log "sending SIGTERM to $PID"
kill -TERM "$PID" 2>/dev/null || true

for i in $(seq 1 20); do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_PATH"
    log "stopped"
    exit 0
  fi
  sleep 0.25
done

log "SIGKILL $PID"
kill -KILL "$PID" 2>/dev/null || true
rm -f "$PID_PATH"
log "stopped (forced)"
