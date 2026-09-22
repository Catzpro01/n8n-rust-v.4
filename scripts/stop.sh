#!/usr/bin/env bash
# Stop the TypeScript runtime.
#
#   bash scripts/stop.sh [--quiet] [--timeout N] [--help]
#
# Idempotent: stopping an already stopped runtime exits 0.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

QUIET=0
TIMEOUT=15

usage() {
  cat <<EOF
usage: bash scripts/stop.sh [options]

  --quiet         print nothing on success
  --timeout <sec> seconds to wait for a clean exit before SIGKILL (default 15)
  -h, --help      show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --quiet) QUIET=1 ;;
    --timeout) shift; TIMEOUT="${1:-15}" ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

load_env
PID_FILE="$(runtime_pid_file)"
PORT="$(runtime_port)"

say() { [ "$QUIET" -eq 1 ] || info "$@"; }

PID="$(running_pid || true)"

if [ -z "$PID" ]; then
  PORT_OWNER="$(port_owner "$PORT")"
  if [ -n "$PORT_OWNER" ]; then
    # something else owns the port: find a runtime process bound to it, if any
    PID=""
    if [ -r /proc ]; then
      for candidate in $(pgrep -f "n8n-ts/src/server" 2>/dev/null || true); do
        PID="$candidate"
        break
      done
    fi
    if [ -z "$PID" ]; then
      warn "port $PORT is used by: $PORT_OWNER (not managed by these scripts)"
      [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
      exit 0
    fi
    say "pid file was missing but a runtime process was found (pid $PID)"
  else
    say "runtime is not running"
    [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
    exit 0
  fi
fi

say "stopping runtime (pid $PID)"
kill -TERM "$PID" 2>/dev/null || true

waited=0
while [ "$waited" -lt "$TIMEOUT" ]; do
  if ! pid_alive "$PID"; then break; fi
  sleep 1
  waited=$((waited + 1))
done

if pid_alive "$PID"; then
  warn "pid $PID did not exit within ${TIMEOUT}s — sending SIGKILL"
  kill -KILL "$PID" 2>/dev/null || true
  sleep 1
fi

if pid_alive "$PID"; then
  fail "pid $PID is still alive after SIGKILL"
  exit 1
fi

rm -f "$PID_FILE"
if pid_is_runtime "$PID"; then :; fi

if [ -n "$(port_owner "$PORT")" ]; then
  warn "port $PORT is still occupied by: $(port_owner "$PORT")"
fi

say "runtime stopped (port $PORT free)"
exit 0
