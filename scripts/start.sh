#!/usr/bin/env bash
# start.sh — jalankan baseline secara idempoten.
# Otomatis: pakai docker jika image tersedia, else node langsung.
# Opsi: --docker | --node | --build (paksa build image) | --help
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { echo "[start] $*"; }
warn() { echo "[start][warn] $*" >&2; }
die()  { echo "[start][error] $*" >&2; exit 1; }

MODE="auto"
FORCE_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --docker) MODE="docker" ;;
    --node)   MODE="node" ;;
    --build)  FORCE_BUILD=1 ;;
    --help|-h)
      echo "Pakai: bash scripts/start.sh [--docker|--node] [--build]"
      echo "  auto (default): docker jika image ada, else node langsung"
      echo "  --build: paksa docker build sebelum start (mode docker)"
      exit 0 ;;
    *) die "argumen tak dikenal: $arg (lihat --help)" ;;
  esac
done

PORT="${PORT:-5678}"
RUNTIME_DIR="$ROOT/.runtime-ts"
PID_FILE="$RUNTIME_DIR/server.pid"
LOG_FILE="$RUNTIME_DIR/server.log"
COMPOSE="$ROOT/deploy/docker/docker-compose.yml"
IMAGE="n8n-ts-baseline:0.1.0"
mkdir -p "$RUNTIME_DIR"

health_ok() {
  node -e "fetch('http://127.0.0.1:$PORT/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null
}

wait_health() {
  for _ in $(seq 1 15); do
    if health_ok; then return 0; fi
    sleep 1
  done
  return 1
}

docker_available() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

docker_image_exists() {
  docker image inspect "$IMAGE" >/dev/null 2>&1
}

# Sudah jalan? → idempoten sukses.
if health_ok; then
  log "sudah jalan di http://127.0.0.1:$PORT (healthz OK) — tidak ada aksi"
  exit 0
fi

# Tentukan mode.
if [ "$MODE" = "auto" ]; then
  if docker_available && docker_image_exists && [ "$FORCE_BUILD" = "0" ]; then
    MODE="docker"
  elif docker_available && [ "$FORCE_BUILD" = "1" ]; then
    MODE="docker"
  else
    MODE="node"
  fi
fi

if [ "$MODE" = "docker" ]; then
  docker_available || die "docker compose tidak tersedia — pakai --node"
  if [ "$FORCE_BUILD" = "1" ] || ! docker_image_exists; then
    log "build image $IMAGE..."
    docker compose -f "$COMPOSE" build || die "docker build gagal"
  fi
  log "docker compose up -d..."
  docker compose -f "$COMPOSE" up -d || die "docker compose up gagal"
  if wait_health; then
    log "JALAN (docker) → http://127.0.0.1:$PORT  (/healthz OK)"
    log "logs: docker logs -f n8n-ts-baseline"
    exit 0
  fi
  die "container naik tapi /healthz tidak OK dalam 15 dtk — cek: docker logs n8n-ts-baseline"
fi

# Mode node langsung.
[ -f apps/n8n-ts/dist/server.js ] || die "dist/server.js tidak ada — jalankan dulu: bash scripts/install.sh"
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  warn "PID $(cat "$PID_FILE") masih hidup tapi healthz gagal — hentikan dulu via stop.sh"
  die "server lama menggantung (lihat $LOG_FILE)"
fi
rm -f "$PID_FILE"

log "start node langsung (log: $LOG_FILE)..."
nohup node apps/n8n-ts/dist/server.js >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
if wait_health; then
  log "JALAN (node, pid $(cat "$PID_FILE")) → http://127.0.0.1:$PORT  (/healthz OK)"
  exit 0
fi
warn "server tidak sehat dalam 15 dtk — 20 baris log terakhir:"
tail -n 20 "$LOG_FILE" >&2 || true
die "start gagal — lihat $LOG_FILE"
