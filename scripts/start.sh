#!/usr/bin/env bash
# start.sh — start n8n-ts baseline (foreground or background)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a || true

HOST="${N8N_TS_HOST:-0.0.0.0}"
PORT="${N8N_TS_PORT:-${PORT:-5678}}"
PID_FILE="${N8N_TS_PID_FILE:-run/n8n-ts.pid}"
LOG_FILE="${N8N_TS_LOG_FILE:-run/n8n-ts.log}"
SERVER="$ROOT/apps/n8n-ts/src/server.mjs"
FG=0

for arg in "$@"; do
  case "$arg" in
    --fg|--foreground|-f) FG=1 ;;
    --help|-h)
      echo "Usage: $0 [--fg]"
      echo "  --fg   run in foreground (default: background daemon)"
      exit 0
      ;;
  esac
done

log() { printf '[start] %s\n' "$*"; }
err() { printf '[start] ERROR: %s\n' "$*" >&2; }

if [[ ! -f "$SERVER" ]]; then
  err "server entry missing: $SERVER (run ./scripts/install.sh)"
  exit 1
fi

mkdir -p "$(dirname "$ROOT/$PID_FILE")"
mkdir -p "$(dirname "$ROOT/$LOG_FILE")"
# Allow absolute paths
if [[ "$PID_FILE" = /* ]]; then PID_PATH="$PID_FILE"; else PID_PATH="$ROOT/$PID_FILE"; fi
if [[ "$LOG_FILE" = /* ]]; then LOG_PATH="$LOG_FILE"; else LOG_PATH="$ROOT/$LOG_FILE"; fi

if [[ -f "$PID_PATH" ]]; then
  OLD_PID="$(cat "$PID_PATH" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    err "already running (pid $OLD_PID). Use ./scripts/stop.sh first."
    exit 1
  fi
  rm -f "$PID_PATH"
fi

export N8N_TS_HOST="$HOST"
export N8N_TS_PORT="$PORT"
export NODE_ENV="${NODE_ENV:-production}"

if [[ "$FG" -eq 1 ]]; then
  log "foreground on ${HOST}:${PORT}"
  exec node "$SERVER"
fi

log "background on ${HOST}:${PORT}"
log "log: $LOG_PATH  pid: $PID_PATH"
nohup node "$SERVER" >>"$LOG_PATH" 2>&1 &
echo $! >"$PID_PATH"
sleep 0.4

if ! kill -0 "$(cat "$PID_PATH")" 2>/dev/null; then
  err "process exited immediately; see $LOG_PATH"
  tail -n 40 "$LOG_PATH" >&2 || true
  exit 1
fi

# Wait for health
READY=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.2
done

if [[ "$READY" -ne 1 ]]; then
  err "server did not become healthy on port $PORT"
  tail -n 40 "$LOG_PATH" >&2 || true
  exit 1
fi

log "ready  pid=$(cat "$PID_PATH")  http://127.0.0.1:${PORT}/healthz"
