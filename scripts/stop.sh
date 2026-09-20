#!/usr/bin/env bash
# stop.sh — hentikan baseline (docker + node langsung). Aman jika sudah berhenti.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[stop] $*"; }

PID_FILE="$ROOT/.runtime-ts/server.pid"
COMPOSE="$ROOT/deploy/docker/docker-compose.yml"
STOPPED=0

# 1. Docker compose down (best-effort).
if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE" ]; then
  if docker compose -f "$COMPOSE" down 2>/dev/null; then
    log "docker compose down OK"
    STOPPED=1
  fi
fi

# 2. PID file node langsung.
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || echo "")"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    log "SIGTERM pid $PID..."
    kill "$PID" 2>/dev/null || true
    for _ in $(seq 1 10); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$PID" 2>/dev/null; then
      log "paksa SIGKILL pid $PID"
      kill -9 "$PID" 2>/dev/null || true
    fi
    STOPPED=1
  fi
  rm -f "$PID_FILE"
fi

if [ "$STOPPED" = "1" ]; then
  log "berhenti."
else
  log "tidak ada yang jalan — tidak ada aksi."
fi
exit 0
