#!/usr/bin/env bash
# Runner script for Arena Manager Capability Gateway Daemon
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

HOST="${GATEWAY_HOST:-0.0.0.0}"
PORT="${GATEWAY_PORT:-8787}"

echo "Starting Arena Manager Capability Gateway on http://${HOST}:${PORT}..."
exec python3 -m tools.gateway.server --host "${HOST}" --port "${PORT}"
