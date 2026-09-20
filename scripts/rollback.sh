#!/usr/bin/env bash
# rollback.sh — kembalikan backup terakhir (atau <timestamp>) → restart → smoke.
# Pakai: bash scripts/rollback.sh [--list] [<YYYYMMDD-HHMMSS>] [--help]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { echo "[rollback] $*"; }
warn() { echo "[rollback][warn] $*" >&2; }
die()  { echo "[rollback][error] $*" >&2; exit 1; }

BACKUP_ROOT="$ROOT/.runtime-ts/backups"
WANT=""

for arg in "$@"; do
  case "$arg" in
    --list)
      echo "Backup tersedia:"
      ls -1 "$BACKUP_ROOT" 2>/dev/null || echo "  (tidak ada)"
      exit 0 ;;
    --help|-h)
      echo "Pakai: bash scripts/rollback.sh [--list] [<timestamp>]"
      exit 0 ;;
    *) WANT="$arg" ;;
  esac
done

[ -d "$BACKUP_ROOT" ] || die "tidak ada backup di $BACKUP_ROOT"
if [ -z "$WANT" ]; then
  WANT="$(ls -1 "$BACKUP_ROOT" | sort | tail -n 1)"
  [ -n "$WANT" ] || die "tidak ada backup"
fi
SRC="$BACKUP_ROOT/$WANT"
[ -d "$SRC" ] || die "backup tidak ditemukan: $SRC"
log "restore dari $SRC..."

bash scripts/stop.sh

if [ -f "$SRC/dist.tar.gz" ]; then
  rm -rf apps/n8n-ts/dist
  tar -xzf "$SRC/dist.tar.gz" -C apps/n8n-ts
  log "dist dipulihkan"
else
  warn "dist.tar.gz tidak ada di backup — dist dibiarkan"
fi
if [ -f "$SRC/.env" ]; then
  cp "$SRC/.env" .env
  log ".env dipulihkan"
fi

bash scripts/start.sh
bash scripts/doctor.sh --require-running
log "ROLLBACK OK (ke $WANT)"
