#!/usr/bin/env bash
# rollback.sh — restore previous git SHA recorded by upgrade.sh and restart
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[rollback] %s\n' "$*"; }
err() { printf '[rollback] ERROR: %s\n' "$*" >&2; }

PREV_FILE="$ROOT/run/previous-sha"
if [[ ! -f "$PREV_FILE" ]]; then
  err "no $PREV_FILE — run upgrade.sh at least once, or pass SHA: $0 <sha>"
  if [[ $# -lt 1 ]]; then
    exit 1
  fi
fi

TARGET="${1:-$(cat "$PREV_FILE")}"
if [[ -z "$TARGET" || "$TARGET" == "unknown" ]]; then
  err "invalid target sha"
  exit 1
fi

if ! git rev-parse --verify "$TARGET" >/dev/null 2>&1; then
  err "git object not found: $TARGET"
  exit 1
fi

CURRENT="$(git rev-parse HEAD)"
log "rolling back $CURRENT → $TARGET"
mkdir -p "$ROOT/run"
echo "$CURRENT" >"$ROOT/run/previous-sha" # so we can roll forward again

"$ROOT/scripts/stop.sh" || true

# Soft reset to target (keeps local untracked). Prefer checkout if detached needed.
git checkout --force "$TARGET" -- \
  apps/n8n-ts \
  packages/reconstructed-engine \
  packages/execution-lego \
  packages/workflow-lego \
  scripts \
  deploy/docker \
  contracts/ts-runtime-baseline.contract.md \
  package.json \
  .env.example \
  2>/dev/null || {
  log "path checkout partial; trying full reset --hard"
  git reset --hard "$TARGET"
}

"$ROOT/scripts/install.sh"
"$ROOT/scripts/start.sh"

log "rollback complete at $(git rev-parse HEAD)"
