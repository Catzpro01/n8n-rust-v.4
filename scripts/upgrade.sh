#!/usr/bin/env bash
# upgrade.sh — pull latest, reinstall, restart n8n-ts baseline
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[upgrade] %s\n' "$*"; }
err() { printf '[upgrade] ERROR: %s\n' "$*" >&2; }

# Record previous HEAD for rollback
mkdir -p "$ROOT/run"
PREV_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "$PREV_SHA" >"$ROOT/run/previous-sha"
log "previous sha: $PREV_SHA"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
log "branch: $BRANCH"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
    log "warning: working tree dirty — pull may fail; stash or commit first"
  fi
  log "git pull --ff-only"
  git pull --ff-only || {
    err "git pull failed"
    exit 1
  }
else
  log "not a git checkout — skip pull"
fi

NEW_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "$NEW_SHA" >"$ROOT/run/current-sha"
log "current sha: $NEW_SHA"

"$ROOT/scripts/stop.sh" || true
"$ROOT/scripts/install.sh"
"$ROOT/scripts/start.sh"

log "upgrade complete ($PREV_SHA → $NEW_SHA)"
log "rollback: ./scripts/rollback.sh"
