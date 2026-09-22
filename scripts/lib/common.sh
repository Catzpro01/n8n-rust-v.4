#!/usr/bin/env bash
# Shared helpers for the TypeScript runtime scripts (install/start/stop/upgrade/
# rollback/doctor). Sourced, never executed directly.
#
# Deliberately dependency-light: only POSIX tools plus node (which is required
# anyway), so it also works on a minimal VPS.
# shellcheck shell=bash

RUNTIME_MIN_NODE_MAJOR=22
RUNTIME_MIN_NODE_MINOR=18

# ---------------------------------------------------------------- repository
repo_root() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  printf '%s\n' "$dir"
}

REPO_ROOT="${REPO_ROOT:-$(repo_root)}"
SERVER_ENTRY="$REPO_ROOT/apps/n8n-ts/src/server.ts"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"
LOG_DIR="$REPO_ROOT/logs"
STATE_DIR="$REPO_ROOT/state"
LOG_FILE="$LOG_DIR/runtime.log"

# ------------------------------------------------------------------- output
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_DIM=''
fi

info()  { printf '%s\n' "  $*"; }
step()  { printf '%s\n' "${C_BLUE}==>${C_RESET} $*"; }
ok()    { printf '%s\n' "${C_GREEN}  ok${C_RESET} $*"; }
warn()  { printf '%s\n' "${C_YELLOW}  warn${C_RESET} $*" >&2; }
fail()  { printf '%s\n' "${C_RED}  fail${C_RESET} $*" >&2; }
die()   { fail "$*"; exit 1; }
dim()   { printf '%s\n' "${C_DIM}$*${C_RESET}"; }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# ------------------------------------------------------------------ env file
# Load .env without evaluating it: only KEY=VALUE lines are exported, so a
# hostile .env cannot execute code.
load_env() {
  local file="${1:-$ENV_FILE}"
  [ -f "$file" ] || return 0
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      *[!A-Za-z0-9_]*) continue ;;
    esac
    # strip optional surrounding quotes; for unquoted values drop a trailing
    # comment the same way `node --env-file` does
    case "$value" in
      \"*\") value="${value%\"}"; value="${value#\"}" ;;
      \'*\') value="${value%\'}"; value="${value#\'}" ;;
      *)
        case "$value" in
          *[[:space:]]#*) value="${value%%[[:space:]]#*}" ;;
        esac
        value="$(printf '%s' "$value" | sed -e 's/[[:space:]]*$//')"
        ;;
    esac
    export "$key=$value"
  done < "$file"
}

# ------------------------------------------------------------------ node/pid
node_version_ok() {
  have_cmd node || return 1
  node -e "
    const [major, minor] = process.versions.node.split('.').map(Number);
    process.exit(major > $RUNTIME_MIN_NODE_MAJOR || (major === $RUNTIME_MIN_NODE_MAJOR && minor >= $RUNTIME_MIN_NODE_MINOR) ? 0 : 1);
  " >/dev/null 2>&1
}

runtime_port() { printf '%s\n' "${N8N_TS_PORT:-${PORT:-5678}}"; }
runtime_host() { printf '%s\n' "${N8N_TS_HOST:-${HOST:-0.0.0.0}}"; }
runtime_data_dir() { printf '%s\n' "${N8N_TS_DATA_DIR:-$REPO_ROOT/data}"; }
runtime_pid_file() { printf '%s\n' "${N8N_TS_PID_FILE:-$(runtime_data_dir)/runtime.pid}"; }

read_pid() {
  local file
  file="$(runtime_pid_file)"
  [ -f "$file" ] || return 1
  local pid
  pid="$(tr -dc '0-9' < "$file" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  printf '%s\n' "$pid"
}

pid_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

pid_is_runtime() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  pid_alive "$pid" || return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'n8n-ts/src/server' && return 0
    return 1
  fi
  # portable fallback (macOS)
  ps -p "$pid" -o command= 2>/dev/null | grep -q 'n8n-ts/src/server'
}

running_pid() {
  local pid
  pid="$(read_pid || true)"
  if pid_alive "$pid"; then printf '%s\n' "$pid"; return 0; fi
  return 1
}

port_owner() {
  local port="$1" out=""
  if have_cmd ss; then
    out="$(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $NF}' | head -n1)"
  elif have_cmd lsof; then
    out="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" pid="$2}')"
  elif have_cmd netstat; then
    out="$(netstat -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $7}' | head -n1)"
  fi
  printf '%s\n' "$out"
}

# ------------------------------------------------------------------- health
health_body() {
  local port host timeout="${1:-5}"
  port="$(runtime_port)"
  host="$(runtime_host)"
  [ "$host" = "0.0.0.0" ] && host="127.0.0.1"
  [ "$host" = "::" ] && host="127.0.0.1"
  node -e "
    const url = 'http://$host:$port/healthz';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${timeout}000);
    fetch(url, { signal: controller.signal })
      .then(async (r) => { process.stdout.write(await r.text()); clearTimeout(timer); process.exit(r.ok ? 0 : 1); })
      .catch(() => { clearTimeout(timer); process.exit(1); });
  " 2>/dev/null
}

health_ok() { health_body "${1:-5}" | grep -q '"status":"ok"'; }

wait_for_health() {
  local timeout="${1:-30}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if health_ok 2; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

tail_log() {
  [ -f "$LOG_FILE" ] && tail -n "${1:-15}" "$LOG_FILE" || true
}

ensure_dirs() {
  mkdir -p "$(runtime_data_dir)" "$LOG_DIR" "$STATE_DIR"
}

mask_value() {
  local value="${1:-}"
  local length=${#value}
  if [ "$length" -eq 0 ]; then printf '(unset)'; return; fi
  if [ "$length" -le 6 ]; then printf '***'; return; fi
  printf '%s***%s' "${value:0:3}" "${value: -2}"
}

env_summary() {
  local key value
  for key in N8N_TS_PORT N8N_TS_HOST N8N_TS_ENV N8N_TS_STORAGE N8N_TS_DATA_DIR N8N_TS_LOG_LEVEL N8N_TS_LOG_FORMAT \
             N8N_TS_EXECUTION_TIMEOUT_MS N8N_TS_MAX_BODY_BYTES N8N_TS_UNKNOWN_NODE_POLICY \
             N8N_TS_UNKNOWN_CONNECTION_POLICY N8N_TS_ALLOW_CODE_EVAL N8N_TS_LOCALE N8N_TS_CORS_ORIGIN; do
    eval "value=\${$key:-}"
    if [ -n "$value" ]; then printf '    %s=%s\n' "$key" "$value"; fi
  done
  if [ -n "${N8N_TS_API_KEY:-}" ]; then
    printf '    N8N_TS_API_KEY=%s (set)\n' "$(mask_value "$N8N_TS_API_KEY")"
  fi
}

git_ref() {
  git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || printf 'unknown'
}

git_branch() {
  git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown'
}

git_is_dirty() {
  [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]
}

install_runtime_deps() {
  local prefix="$REPO_ROOT/apps/n8n-ts"
  if [ -f "$prefix/package-lock.json" ]; then
    npm --prefix "$prefix" ci --no-audit --no-fund
  else
    npm --prefix "$prefix" install --no-audit --no-fund
  fi
}
