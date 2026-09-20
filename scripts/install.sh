#!/usr/bin/env bash
# install.sh — prepare n8n-ts baseline on a clean machine
# Contract: contracts/ts-runtime-baseline.contract.md §6
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '[install] %s\n' "$*"; }
err() { printf '[install] ERROR: %s\n' "$*" >&2; }

log "repo root: $ROOT"

if ! command -v node >/dev/null 2>&1; then
  err "node not found. Install Node.js >= 20 first."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  err "Node.js >= 20 required (found $(node -v))"
  exit 1
fi
log "node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  err "npm not found"
  exit 1
fi

# Root package (workspace scripts) — optional install
if [[ -f "$ROOT/package.json" ]]; then
  log "npm install (repo root, omit optional heavy deps)"
  npm install --ignore-scripts --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund || true
fi

# App package
if [[ -f "$ROOT/apps/n8n-ts/package.json" ]]; then
  log "npm install (apps/n8n-ts)"
  npm install --prefix "$ROOT/apps/n8n-ts" --no-audit --no-fund
fi

# Ensure run/ exists for pid + logs
mkdir -p "$ROOT/run"
mkdir -p "$ROOT/apps/n8n-ts/run"

# Seed .env from example if missing
if [[ ! -f "$ROOT/.env" && -f "$ROOT/.env.example" ]]; then
  log "creating .env from .env.example (edit secrets before production use)"
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

# Quick engine presence check
ENGINE="$ROOT/packages/reconstructed-engine/runner.mjs"
if [[ ! -f "$ENGINE" ]]; then
  err "missing engine runner: $ENGINE"
  exit 1
fi
log "engine ok: packages/reconstructed-engine/runner.mjs"

# Doctor (non-fatal soft fail only if node doctor missing)
if [[ -f "$ROOT/apps/n8n-ts/src/doctor-check.mjs" ]]; then
  log "running doctor-check"
  node "$ROOT/apps/n8n-ts/src/doctor-check.mjs" || {
    err "doctor-check reported failures"
    exit 1
  }
fi

log "install complete"
log "next: ./scripts/start.sh   or   ./scripts/start.sh --fg"
