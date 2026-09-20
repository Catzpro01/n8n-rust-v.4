#!/usr/bin/env bash
# install.sh — clean machine (Ubuntu 22.04/24.04) → siap jalan.
# Idempoten: aman di-rerun. TIDAK menjalankan server (lihat start.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { echo "[install] $*"; }
warn() { echo "[install][warn] $*" >&2; }
die()  { echo "[install][error] $*" >&2; exit 1; }

NODE_MIN=20

node_major() {
  if ! command -v node >/dev/null 2>&1; then echo 0; return; fi
  node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' | grep -E '^[0-9]+$' || echo 0
}

install_node_ubuntu() {
  # Install Node 22 via NodeSource — hanya di Debian/Ubuntu dengan apt + root/sudo.
  command -v apt-get >/dev/null 2>&1 || return 1
  local SUDO=""
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || return 1
    SUDO="sudo"
  fi
  log "installing Node.js 22 via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
}

log "repo: $ROOT"

# 1. Node.js
MAJOR="$(node_major)"
if [ "$MAJOR" -lt "$NODE_MIN" ]; then
  warn "node $(command -v node >/dev/null && node --version || echo 'not found') < v$NODE_MIN"
  if install_node_ubuntu; then
    MAJOR="$(node_major)"
  else
    die "butuh Node.js >= $NODE_MIN. Install manual: https://nodejs.org lalu rerun install.sh"
  fi
fi
[ "$MAJOR" -ge "$NODE_MIN" ] || die "node masih v$MAJOR — butuh >= $NODE_MIN"
log "node $(node --version) OK"
command -v npm >/dev/null 2>&1 || die "npm tidak ditemukan (seharusnya ikut Node.js)"
log "npm $(npm --version) OK"

# 2. Dependencies + build
if [ -f apps/n8n-ts/package-lock.json ]; then
  log "npm ci apps/n8n-ts..."
  npm --prefix apps/n8n-ts ci
else
  warn "lockfile hilang — fallback npm install"
  npm --prefix apps/n8n-ts install
fi
log "typecheck + build..."
npm --prefix apps/n8n-ts run typecheck
npm --prefix apps/n8n-ts run build
[ -f apps/n8n-ts/dist/server.js ] || die "build gagal: dist/server.js tidak ada"
log "build OK: apps/n8n-ts/dist/server.js"

# 3. .env (jangan timpa milik user)
if [ -f .env ]; then
  log ".env sudah ada — tidak ditimpa"
else
  cp .env.example .env
  log ".env dibuat dari .env.example (silakan sesuaikan PORT/HOST bila perlu)"
fi

# 4. Docker image (best-effort — fallback node langsung selalu tersedia)
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "docker terdeteksi — build image (best-effort)..."
  if docker compose -f deploy/docker/docker-compose.yml build 2>&1 | tail -n 3; then
    log "docker image OK"
  else
    warn "docker build gagal — start.sh akan memakai node langsung"
  fi
else
  log "docker tidak ada — mode node langsung (cukup untuk baseline)"
fi

# 5. Verifikasi akhir (tanpa server jalan)
log "verifikasi install..."
bash scripts/doctor.sh || die "doctor.sh gagal — lihat pesan di atas"

log "SELESAI. Lanjut: bash scripts/start.sh"
