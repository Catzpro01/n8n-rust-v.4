#!/usr/bin/env bash
# upgrade.sh — backup → update → rebuild → restart → smoke. Gagal → auto-rollback.
# Opsi: --check (dry-run) | --no-pull (jangan git pull) | --help
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { echo "[upgrade] $*"; }
warn() { echo "[upgrade][warn] $*" >&2; }
die()  { echo "[upgrade][error] $*" >&2; exit 1; }

DRY=0
NO_PULL=0
for arg in "$@"; do
  case "$arg" in
    --check) DRY=1 ;;
    --no-pull) NO_PULL=1 ;;
    --help|-h)
      echo "Pakai: bash scripts/upgrade.sh [--check] [--no-pull]"
      echo "  --check: tampilkan rencana tanpa eksekusi"
      echo "  --no-pull: lewati git pull (rebuild dari tree saat ini)"
      exit 0 ;;
    *) die "argumen tak dikenal: $arg" ;;
  esac
done

BACKUP_ROOT="$ROOT/.runtime-ts/backups"
TS="$(date +%Y%m%d-%H%M%S)"

docker_mode_active() {
  command -v docker >/dev/null 2>&1 \
    && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'n8n-ts-baseline'
}

do_backup() {
  local dest="$BACKUP_ROOT/$TS"
  mkdir -p "$dest"
  [ -d apps/n8n-ts/dist ] && tar -czf "$dest/dist.tar.gz" -C apps/n8n-ts dist || true
  [ -f .env ] && cp .env "$dest/.env" || true
  node -p "require('./apps/n8n-ts/package.json').version" > "$dest/VERSION" 2>/dev/null || echo "unknown" > "$dest/VERSION"
  echo "$dest"
}

prune_backups() {
  # Simpan 5 terbaru.
  ls -1 "$BACKUP_ROOT" 2>/dev/null | sort | head -n -5 | while read -r old; do
    [ -n "$old" ] && rm -rf "$BACKUP_ROOT/$old" && log "prune backup lama: $old"
  done || true
}

if [ "$DRY" = "1" ]; then
  log "DRY-RUN — rencana:"
  echo "  1. backup dist+.env → $BACKUP_ROOT/$TS/"
  [ "$NO_PULL" = "1" ] && echo "  2. lewati git pull (--no-pull)" || echo "  2. git pull --ff-only (best-effort)"
  echo "  3. npm ci + build apps/n8n-ts"
  docker_mode_active && echo "  4. restart via docker (container aktif)" || echo "  4. restart via node langsung"
  echo "  5. smoke: doctor.sh --require-running (gagal → auto rollback.sh)"
  exit 0
fi

BACKUP_DIR="$(do_backup)"
log "backup → $BACKUP_DIR"
prune_backups

rollback_and_die() {
  warn "upgrade gagal — auto-rollback..."
  bash scripts/rollback.sh "$TS" || warn "rollback juga bermasalah — restore manual dari $BACKUP_DIR"
  die "upgrade dibatalkan (sudah rollback)"
}
trap rollback_and_die ERR

# Update source.
if [ "$NO_PULL" = "0" ] && [ -d .git ]; then
  log "git pull --ff-only..."
  git pull --ff-only 2>&1 | tail -n 2 || warn "git pull gagal — lanjut dengan tree saat ini"
else
  log "lewati git pull"
fi

# Rebuild.
log "rebuild..."
npm --prefix apps/n8n-ts ci
npm --prefix apps/n8n-ts run build

# Restart sesuai mode aktif.
log "restart..."
bash scripts/stop.sh
if docker_mode_active || { command -v docker >/dev/null 2>&1 && docker image inspect n8n-ts-baseline:0.1.0 >/dev/null 2>&1; }; then
  docker compose -f deploy/docker/docker-compose.yml up -d --build
  PORT="${PORT:-5678}" bash scripts/start.sh --docker
else
  bash scripts/start.sh --node
fi

# Smoke.
bash scripts/doctor.sh --require-running
trap - ERR
log "UPGRADE OK (backup: $BACKUP_DIR)"
