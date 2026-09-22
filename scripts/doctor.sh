#!/usr/bin/env bash
# Diagnose the TypeScript runtime installation.
#
#   bash scripts/doctor.sh [--quick] [--json] [--help]
#
# Exit codes: 0 healthy · 1 warnings · 2 critical (see the summary at the end).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

QUICK=0
JSON=0

usage() {
  cat <<EOF
usage: bash scripts/doctor.sh [options]

  --quick   skip the slower probes (log tail, disk usage, docker)
  --json    emit machine-readable JSON instead of the report
  -h, --help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --quick) QUICK=1 ;;
    --json) JSON=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

load_env

CRITICAL=0
WARNINGS=0
declare -a LINES=()

record() { # level message [hint]
  local level="$1" message="$2" hint="${3:-}"
  case "$level" in
    FAIL) CRITICAL=$((CRITICAL + 1)) ;;
    WARN) WARNINGS=$((WARNINGS + 1)) ;;
  esac
  LINES+=("${level}|${message}|${hint}")
}

# ------------------------------------------------------------------ runtime
if ! have_cmd node; then
  record FAIL "node is not installed" "install Node.js >= ${RUNTIME_MIN_NODE_MAJOR}.${RUNTIME_MIN_NODE_MINOR}"
else
  if node_version_ok; then
    record PASS "node $(node -v)"
  else
    record FAIL "node $(node -v) is older than ${RUNTIME_MIN_NODE_MAJOR}.${RUNTIME_MIN_NODE_MINOR}" "upgrade Node.js"
  fi
fi

if have_cmd npm; then record PASS "npm $(npm -v)"; else record WARN "npm is missing" "typecheck unavailable"; fi

if [ -f "$SERVER_ENTRY" ]; then record PASS "runtime entry point present"; else record FAIL "missing $SERVER_ENTRY" "re-clone the repository"; fi

# --------------------------------------------------------------------- repo
if [ -d "$REPO_ROOT/.git" ]; then
  if git_is_dirty; then
    record WARN "git working tree has local changes ($(git_branch) @ $(git_ref))" "upgrades may refuse to fast-forward"
  else
    record PASS "git clean ($(git_branch) @ $(git_ref))"
  fi
else
  record WARN "$REPO_ROOT is not a git checkout" "upgrade/rollback are unavailable"
fi

# ---------------------------------------------------------------------- env
if [ -f "$ENV_FILE" ]; then
  record PASS ".env present ($(grep -c '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" 2>/dev/null || echo 0) variables)"
else
  record WARN ".env is missing (defaults are used)" "bash scripts/install.sh"
fi
if [ -n "${N8N_TS_API_KEY:-}" ]; then
  record PASS "API key configured (N8N_TS_API_KEY=$(mask_value "$N8N_TS_API_KEY"))"
else
  record WARN "N8N_TS_API_KEY is not set — /api/v1 is open" "set it before exposing the runtime publicly"
fi
if [ "${N8N_TS_ALLOW_CODE_EVAL:-false}" = "true" ]; then
  record WARN "N8N_TS_ALLOW_CODE_EVAL=true — user JavaScript runs in-process" "use only for trusted workflows"
fi
if [ "${N8N_TS_ENV:-development}" != "production" ]; then
  record WARN "N8N_TS_ENV=${N8N_TS_ENV:-development}" "set N8N_TS_ENV=production on the VPS"
fi
if [ "$(runtime_host)" = "0.0.0.0" ]; then
  record PASS "listening on 0.0.0.0:$(runtime_port) (reachable behind a proxy)"
else
  record PASS "listening on $(runtime_host):$(runtime_port)"
fi

# --------------------------------------------------------------------- data
DATA_DIR="$(runtime_data_dir)"
if [ -d "$DATA_DIR" ]; then
  if [ -w "$DATA_DIR" ]; then
    record PASS "data dir writable: $DATA_DIR"
  else
    record FAIL "data dir is not writable: $DATA_DIR" "fix permissions (chown/chmod)"
  fi
else
  record WARN "data dir does not exist yet: $DATA_DIR" "it is created on install/start"
fi

# ------------------------------------------------------------------ process
PID="$(running_pid || true)"
PID_FILE="$(runtime_pid_file)"
if [ -n "$PID" ]; then
  record PASS "runtime process alive (pid $PID)"
  if pid_is_runtime "$PID"; then
    record PASS "pid $PID belongs to the n8n-ts runtime"
  else
    record WARN "pid $PID is not recognisable as the runtime" "stale pid file?"
  fi
elif [ -f "$PID_FILE" ]; then
  record WARN "pid file exists but the process is gone" "bash scripts/start.sh cleans it up"
else
  record WARN "runtime is not running" "bash scripts/start.sh"
fi

OWNER="$(port_owner "$(runtime_port)")"
if [ -n "$OWNER" ]; then
  record PASS "port $(runtime_port) in use by: $OWNER"
else
  record WARN "nothing is listening on port $(runtime_port)" "bash scripts/start.sh"
fi

# ------------------------------------------------------------------- health
if health_ok 3; then
  record PASS "GET /healthz → $(health_body 3)"
  READINESS="$(node -e "
    const port = $(runtime_port);
    fetch('http://127.0.0.1:' + port + '/healthz/readiness')
      .then(async (r) => { process.stdout.write((r.ok ? 'ok ' : 'bad ') + await r.text()); })
      .catch(() => process.stdout.write('unreachable'));
  " 2>/dev/null)"
  case "$READINESS" in
    ok*) record PASS "readiness: ${READINESS:3:160}" ;;
    *) record FAIL "readiness probe: $READINESS" "check logs: $LOG_FILE" ;;
  esac
  VERSION_JSON="$(node -e "
    const port = $(runtime_port);
    const key = process.env.N8N_TS_API_KEY || '';
    fetch('http://127.0.0.1:' + port + '/api/v1/version', { headers: key ? { 'x-n8n-api-key': key } : {} })
      .then(async (r) => { const t = await r.text(); if (!r.ok) { process.stdout.write('HTTP ' + r.status); return; } const d = JSON.parse(t).data; process.stdout.write(d.version + ' engine ' + d.engine.package + '@' + d.engine.version + ' nodes ' + (d.engine.registryVersion || '?')); })
      .catch(() => process.stdout.write('unreachable'));
  " 2>/dev/null)"
  case "$VERSION_JSON" in
    HTTP\ 401*) record WARN "version endpoint needs the API key ($VERSION_JSON)" "set N8N_TS_API_KEY in this shell" ;;
    unreachable*) record WARN "version endpoint unreachable" ;;
    *) record PASS "runtime $VERSION_JSON" ;;
  esac
else
  record FAIL "GET /healthz does not answer on port $(runtime_port)" "bash scripts/start.sh; tail -n 30 $LOG_FILE"
fi

# --------------------------------------------------------------- quick extras
if [ "$QUICK" -eq 0 ]; then
  if [ -f "$LOG_FILE" ]; then
    LOG_SIZE="$(wc -c < "$LOG_FILE" 2>/dev/null | tr -d ' ')"
    record PASS "log file $LOG_FILE (${LOG_SIZE:-0} bytes)"
    if command -v grep >/dev/null 2>&1 && tail -n 200 "$LOG_FILE" | grep -q '"level":"error"'; then
      record WARN "recent errors in the log" "tail -n 50 $LOG_FILE"
    fi
  else
    record WARN "no log file yet ($LOG_FILE)" "background starts append here"
  fi
  if have_cmd df; then
    AVAIL="$(df -Pk "$REPO_ROOT" 2>/dev/null | awk 'NR==2 {printf "%.1f GB", $4/1048576}')"
    record PASS "disk available for the repo: ${AVAIL:-unknown}"
  fi
  if have_cmd systemctl && systemctl list-unit-files 2>/dev/null | grep -q '^n8n-ts-runtime.service'; then
    STATE="$(systemctl is-active n8n-ts-runtime.service 2>/dev/null || true)"
    if [ "$STATE" = "active" ]; then record PASS "systemd unit active"; else record WARN "systemd unit state: ${STATE:-unknown}" "systemctl status n8n-ts-runtime"; fi
  fi
  if have_cmd docker && docker compose version >/dev/null 2>&1; then
    record PASS "docker compose available (deploy/docker/docker-compose.yml)"
  fi
fi

# ------------------------------------------------------------------- output
if [ "$JSON" -eq 1 ]; then
  printf '{"checks":['
  first=1
  for line in "${LINES[@]}"; do
    level="${line%%|*}"; rest="${line#*|}"; message="${rest%%|*}"; hint="${rest#*|}"
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '{"level":"%s","message":"%s","hint":"%s"}' "$level" "$(printf '%s' "$message" | sed 's/"/\\"/g')" "$(printf '%s' "$hint" | sed 's/"/\\"/g')"
  done
  printf '],"critical":%d,"warnings":%d}\n' "$CRITICAL" "$WARNINGS"
else
  step "n8n-ts runtime doctor"
  info "repo $(git_branch 2>/dev/null || echo n/a) @ $(git_ref 2>/dev/null || echo n/a) · node $(node -v 2>/dev/null || echo missing) · port $(runtime_port)"
  echo
  for line in "${LINES[@]}"; do
    level="${line%%|*}"; rest="${line#*|}"; message="${rest%%|*}"; hint="${rest#*|}"
    case "$level" in
      PASS) printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$message" ;;
      WARN) printf '  %s!%s %s %s\n' "$C_YELLOW" "$C_RESET" "$message" "$([ -n "$hint" ] && printf '%s(%s)%s' "$C_DIM" "$hint" "$C_RESET")" ;;
      FAIL) printf '  %s✗%s %s %s\n' "$C_RED" "$C_RESET" "$message" "$([ -n "$hint" ] && printf '%s(%s)%s' "$C_DIM" "$hint" "$C_RESET")" ;;
    esac
  done
  echo
  if [ "$CRITICAL" -gt 0 ]; then
    printf '%s  %d critical issue(s), %d warning(s)%s\n' "$C_RED" "$CRITICAL" "$WARNINGS" "$C_RESET"
  elif [ "$WARNINGS" -gt 0 ]; then
    printf '%s  healthy with %d warning(s)%s\n' "$C_YELLOW" "$WARNINGS" "$C_RESET"
  else
    printf '%s  all checks passed%s\n' "$C_GREEN" "$C_RESET"
  fi
fi

if [ "$CRITICAL" -gt 0 ]; then exit 2; fi
if [ "$WARNINGS" -gt 0 ]; then exit 1; fi
exit 0
