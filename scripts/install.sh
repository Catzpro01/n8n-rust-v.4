#!/usr/bin/env bash
# Install the TypeScript runtime on a clean machine.
#
#   bash scripts/install.sh [--systemd] [--force-deps] [--no-deps] [--help]
#
# Idempotent: running it twice is safe. Never overwrites an existing .env.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

WANT_SYSTEMD=0
FORCE_DEPS=0
SKIP_DEPS=0

usage() {
  cat <<EOF
usage: bash scripts/install.sh [options]

  --systemd      install and enable the systemd unit for this checkout
  --force-deps   reinstall apps/n8n-ts dev dependencies even if present
  --no-deps      skip the npm install step (offline machines)
  -h, --help     show this help

The runtime itself has no runtime npm dependencies: Node.js >= ${RUNTIME_MIN_NODE_MAJOR}.${RUNTIME_MIN_NODE_MINOR} and this
repository are enough to start it. npm is only used for the typecheck tooling.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --systemd) WANT_SYSTEMD=1 ;;
    --force-deps) FORCE_DEPS=1 ;;
    --no-deps) SKIP_DEPS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

step "Installing the n8n TypeScript runtime"
info "repository : $REPO_ROOT"

# ------------------------------------------------------------------ checks
if ! have_cmd node; then
  die "node is not installed. Install Node.js >= ${RUNTIME_MIN_NODE_MAJOR}.${RUNTIME_MIN_NODE_MINOR} (https://nodejs.org or nvm) and re-run."
fi
if ! node_version_ok; then
  die "Node.js $(node -v) is too old — >= ${RUNTIME_MIN_NODE_MAJOR}.${RUNTIME_MIN_NODE_MINOR} is required (native TypeScript execution)."
fi
ok "node $(node -v)"

if [ "$SKIP_DEPS" -eq 0 ] && ! have_cmd npm; then
  warn "npm not found — skipping dev dependencies (typecheck will not be available)"
  SKIP_DEPS=1
fi

[ -f "$SERVER_ENTRY" ] || die "runtime entry point missing: $SERVER_ENTRY"

# ------------------------------------------------------------------ layout
step "Preparing directories"
ensure_dirs
ok "data dir   : $(runtime_data_dir)"
ok "log dir    : $LOG_DIR"
ok "state dir  : $STATE_DIR"

# ------------------------------------------------------------------ env file
step "Preparing .env"
if [ -f "$ENV_FILE" ]; then
  ok ".env already exists — left untouched ($(grep -c '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" 2>/dev/null || echo 0) variables)"
else
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok ".env created from .env.example — review it before exposing the runtime"
  else
    die ".env.example is missing; cannot create .env"
  fi
fi
load_env

# ------------------------------------------------------------------ deps
if [ "$SKIP_DEPS" -eq 1 ]; then
  dim "  (skipping dev dependencies)"
else
  step "Installing dev dependencies (typescript, @types/node)"
  if [ "$FORCE_DEPS" -eq 0 ] && [ -x "$REPO_ROOT/apps/n8n-ts/node_modules/.bin/tsc" ]; then
    ok "already installed (use --force-deps to refresh)"
  else
    if install_runtime_deps >/dev/null 2>&1; then
      ok "npm install complete"
    else
      warn "npm install failed — the runtime still works, but 'npm run runtime:typecheck' will not"
    fi
  fi
fi

# ------------------------------------------------------------------ systemd
if [ "$WANT_SYSTEMD" -eq 1 ]; then
  step "Installing systemd unit"
  if ! have_cmd systemctl; then
    warn "systemctl not available — skipping"
  else
    local_unit="$REPO_ROOT/deploy/systemd/n8n-ts-runtime.service"
    [ -f "$local_unit" ] || die "missing unit template: $local_unit"
    target="/etc/systemd/system/n8n-ts-runtime.service"
    sudo_cmd=""
    [ "$(id -u)" -ne 0 ] && sudo_cmd="sudo"
    tmp="$(mktemp)"
    sed -e "s|__REPO__|$REPO_ROOT|g" \
        -e "s|__USER__|$(id -un)|g" \
        -e "s|__GROUP__|$(id -gn)|g" \
        -e "s|__DATA_DIR__|$(runtime_data_dir)|g" \
        "$local_unit" > "$tmp"
    $sudo_cmd install -m 0644 "$tmp" "$target"
    rm -f "$tmp"
    $sudo_cmd systemctl daemon-reload
    $sudo_cmd systemctl enable n8n-ts-runtime.service >/dev/null 2>&1 || true
    ok "unit installed: $target"
    info "start with: sudo systemctl start n8n-ts-runtime"
    info "logs with : journalctl -u n8n-ts-runtime -f"
  fi
fi

# ------------------------------------------------------------------ summary
echo
step "Install complete"
env_summary
echo
info "next steps:"
info "  1. review .env                  (port, API key, policies)"
info "  2. bash scripts/start.sh        (background) or npm run runtime:start (foreground)"
info "  3. bash scripts/doctor.sh       (verify the installation)"
info "  4. open http://127.0.0.1:$(runtime_port)/  (operator console)"
