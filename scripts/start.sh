#!/usr/bin/env bash
# Start the TypeScript runtime.
#
#   bash scripts/start.sh [--foreground] [--health-timeout N] [--help]
#
# Background mode writes a pid file and appends to logs/runtime.log.
# Foreground mode `exec`s node, so systemd/docker keep signal handling correct.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

FOREGROUND=0
HEALTH_TIMEOUT=30

usage() {
  cat <<EOF
usage: bash scripts/start.sh [options]

  --foreground            run in the foreground and exec node (for systemd/docker)
  --health-timeout <sec>  how long to wait for /healthz (default 30)
  -h, --help              show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --foreground) FOREGROUND=1 ;;
    --health-timeout) shift; HEALTH_TIMEOUT="${1:-30}" ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

ensure_dirs
load_env

if ! have_cmd node; then die "node is not installed"; fi
if ! node_version_ok; then die "Node.js $(node -v) is too old — >= ${RUNTIME_MIN_NODE_MAJOR}.${RUNTIME_MIN_NODE_MINOR} required"; fi

PORT="$(runtime_port)"

if [ "$FOREGROUND" -eq 1 ]; then
  step "Starting runtime in the foreground on port $PORT"
  exec node "$SERVER_ENTRY"
fi

# --------------------------------------------------------- already running?
PID_FILE="$(runtime_pid_file)"
if EXISTING="$(running_pid)"; then
  if health_ok 3; then
    ok "runtime already running (pid $EXISTING) on port $PORT — nothing to do"
    exit 0
  fi
  warn "pid $EXISTING is alive but /healthz does not answer — restarting it"
  bash "$SCRIPT_DIR/stop.sh" --quiet || true
elif [ -f "$PID_FILE" ]; then
  warn "removing stale pid file $PID_FILE"
  rm -f "$PID_FILE"
fi

# ------------------------------------------------------- port availability?
OWNER="$(port_owner "$PORT")"
if [ -n "$OWNER" ]; then
  fail "port $PORT is already in use by: $OWNER"
  info "set another port in .env (N8N_TS_PORT) or stop the other process"
  exit 1
fi

step "Starting runtime on port $PORT"
setsid nohup node "$SERVER_ENTRY" >>"$LOG_FILE" 2>&1 </dev/null &
STARTED_PID=$!
printf '%s\n' "$STARTED_PID" > "$PID_FILE"
ok "pid $STARTED_PID written to $PID_FILE"

if wait_for_health "$HEALTH_TIMEOUT"; then
  ok "healthz: $(health_body 3)"
  info "console : http://127.0.0.1:$PORT/"
  info "log file: $LOG_FILE"
  exit 0
fi

fail "runtime did not become healthy within ${HEALTH_TIMEOUT}s"
info "last log lines:"
tail_log 20
info "diagnostics: bash scripts/doctor.sh"
exit 1
