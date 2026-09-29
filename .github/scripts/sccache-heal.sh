#!/usr/bin/env bash
# sccache-heal.sh — Self-healing sccache daemon for CI runners
#
# Source this script before any `cargo` command on self-hosted runners.
# It ensures the sccache daemon is alive and reachable. If the daemon is
# dead, hung, or unreachable (the "Failed to read response header" error),
# it kills the old one and starts a fresh instance.
#
# Non-fatal by design: if sccache is not installed or refuses to start,
# compilation proceeds without the cache — never blocks the pipeline.
#
# Usage:
#   source .github/scripts/sccache-heal.sh
#   # or call the function directly:
#   heal_sccache

set -euo pipefail

heal_sccache() {
  # 1. Check if sccache is installed
  if ! command -v sccache >/dev/null 2>&1; then
    echo "[sccache-heal] sccache not installed — skipping"
    return 0
  fi

  echo "[sccache-heal] Stopping any existing sccache daemon..."
  sccache --stop-server 2>/dev/null || true

  # 2. Kill any zombie sccache processes
  pkill -f "sccache --dist-server" 2>/dev/null || true
  pkill -f "sccache-dist" 2>/dev/null || true

  # 3. Clear potentially corrupted local cache socket
  rm -f "${SCCACHE_DIR:-$HOME/.cache/sccache}/.sccache_lock" 2>/dev/null || true

  # 4. Start a fresh daemon
  echo "[sccache-heal] Starting fresh sccache daemon..."
  if sccache --start-server 2>/dev/null; then
    export RUSTC_WRAPPER=sccache
    if [ -n "${GITHUB_ENV:-}" ]; then
      echo "RUSTC_WRAPPER=sccache" >> "$GITHUB_ENV"
    fi
    echo "[sccache-heal] ✓ Daemon started successfully"
    sccache --show-stats 2>/dev/null || true
  else
    echo "::warning::[sccache-heal] Daemon gagal start — kompilasi tanpa cache"
    unset RUSTC_WRAPPER 2>/dev/null || true
    if [ -n "${GITHUB_ENV:-}" ]; then
      echo "RUSTC_WRAPPER=" >> "$GITHUB_ENV"
    fi
  fi
}

# Auto-run when sourced
heal_sccache
