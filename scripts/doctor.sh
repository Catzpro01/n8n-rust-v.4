#!/usr/bin/env bash
# doctor.sh — diagnosa menyeluruh baseline.
# Default: OK (exit 0) jika install valid; server berhenti = SKIP (bukan gagal).
# --require-running: server harus jalan + smoke run harus lulus.
# --json: ringkasan mesin. Opsi: --help
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REQUIRE_RUNNING=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --require-running) REQUIRE_RUNNING=1 ;;
    --json) JSON=1 ;;
    --help|-h)
      echo "Pakai: bash scripts/doctor.sh [--require-running] [--json]"
      echo "  HOST/PORT env dipakai untuk probing (default 127.0.0.1:5678)"
      exit 0 ;;
    *) echo "[doctor][error] argumen tak dikenal: $arg" >&2; exit 1 ;;
  esac
done

HOST_PROBE="127.0.0.1"
PORT="${PORT:-5678}"
BASE="http://$HOST_PROBE:$PORT"

PASS=0; FAIL=0; SKIP=0
CHECKS_JSON=""

ok()   { PASS=$((PASS+1)); [ "$JSON" = "0" ] && echo "[doctor][ ok ] $*"; json_add "ok" "$*"; }
fail() { FAIL=$((FAIL+1)); [ "$JSON" = "0" ] && echo "[doctor][FAIL] $*"; json_add "fail" "$*"; }
skip() { SKIP=$((SKIP+1)); [ "$JSON" = "0" ] && echo "[doctor][skip] $*"; json_add "skip" "$*"; }
info() { [ "$JSON" = "0" ] && echo "[doctor][info] $*"; }

json_add() { # level, pesan — escape minimal
  local msg="${2//\\/\\\\}"; msg="${msg//\"/\\\"}"
  CHECKS_JSON="$CHECKS_JSON{\"level\":\"$1\",\"message\":\"$msg\"},"
}

http_get() { # path → body di stdout, exit 0 jika 2xx
  node -e "
fetch('$BASE$1').then(async r=>{
  const t=await r.text();
  process.stdout.write(t);
  process.exit(r.ok?0:1);
}).catch(()=>process.exit(2));" 2>/dev/null
}

http_post_run() { # body-json → body di stdout, exit 0 jika 2xx
  node -e "
fetch('$BASE/api/v1/workflows/run',{method:'POST',headers:{'content-type':'application/json'},body:process.argv[1]})
 .then(async r=>{process.stdout.write(await r.text());process.exit(r.ok?0:1);})
 .catch(()=>process.exit(2));" "$1" 2>/dev/null
}

[ "$JSON" = "0" ] && echo "[doctor] probing $BASE ..."

# 1. Node version
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "${MAJOR:-0}" -ge 20 ] 2>/dev/null; then
    ok "node $(node --version) >= 20"
  else
    fail "node $(node --version) < 20 — butuh >= 20"
  fi
else
  fail "node tidak ditemukan — jalankan bash scripts/install.sh"
fi

# 2. Build artifacts
if [ -f apps/n8n-ts/dist/server.js ]; then
  ok "build ada: apps/n8n-ts/dist/server.js"
else
  fail "build hilang: apps/n8n-ts/dist/server.js — jalankan bash scripts/install.sh"
fi

# 3. Adapter LEGO (anti engine-kedua: runtime harus punya rujukan adapter)
if [ -f packages/reconstructed-engine/ts-runtime-adapter.mjs ] && [ -f packages/reconstructed-engine/runner.mjs ]; then
  ok "LEGO engine + adapter ada"
else
  fail "packages/reconstructed-engine/{runner,ts-runtime-adapter}.mjs hilang"
fi

# 4. .env
if [ -f .env ]; then
  ok ".env ada"
else
  skip ".env belum ada (dibuat saat install.sh; default bawaan tetap jalan)"
fi

# 5. Server: /healthz
HEALTH="$(http_get /healthz 2>/dev/null || true)"
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  ok "GET /healthz → status ok"
  SERVER_UP=1
else
  SERVER_UP=0
  if [ "$REQUIRE_RUNNING" = "1" ]; then
    fail "server tidak menjawab /healthz di $BASE — jalankan bash scripts/start.sh"
  else
    skip "server berhenti (tidak menjawab /healthz) — jalankan bash scripts/start.sh untuk cek penuh"
  fi
fi

# 6-8. Hanya jika server jalan.
if [ "${SERVER_UP:-0}" = "1" ]; then
  LANDING="$(http_get / 2>/dev/null || true)"
  if echo "$LANDING" | grep -q '"name":"n8n-ts-baseline"'; then
    ok "GET / → n8n-ts-baseline"
  else
    fail "GET / tidak mengembalikan landing baseline: $LANDING"
  fi

  NOTFOUND="$(http_get /rute-tidak-ada-doctor 2>/dev/null || true)"
  if echo "$NOTFOUND" | grep -q '"code":404'; then
    ok "404 JSON OK"
  else
    fail "404 tidak JSON: $NOTFOUND"
  fi

  RUN_BODY='{"workflow":{"nodes":[{"name":"Doctor","type":"n8n-nodes-base.manualTrigger"}],"connections":{}}}'
  RUN_OUT="$(http_post_run "$RUN_BODY" 2>/dev/null || true)"
  if echo "$RUN_OUT" | grep -q '"status":"COMPLETED"'; then
    ok "POST /api/v1/workflows/run → COMPLETED"
  else
    fail "workflow run gagal: $RUN_OUT"
  fi
fi

# 9. Docker (info saja)
if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'n8n-ts-baseline'; then
    info "docker: container n8n-ts-baseline JALAN"
  elif docker image inspect n8n-ts-baseline:0.1.0 >/dev/null 2>&1; then
    info "docker: image ada, container berhenti"
  else
    info "docker: tersedia, image belum dibangun"
  fi
else
  info "docker: tidak tersedia (mode node langsung)"
fi

CHECKS_JSON="[${CHECKS_JSON%,}]"
if [ "$JSON" = "1" ]; then
  if [ "$FAIL" = "0" ]; then echo "{\"ok\":true,\"pass\":$PASS,\"fail\":0,\"skip\":$SKIP,\"checks\":$CHECKS_JSON}";
  else echo "{\"ok\":false,\"pass\":$PASS,\"fail\":$FAIL,\"skip\":$SKIP,\"checks\":$CHECKS_JSON}"; fi
else
  if [ "$FAIL" = "0" ]; then echo "[doctor] HASIL: OK (pass=$PASS skip=$SKIP)";
  else echo "[doctor] HASIL: GAGAL (pass=$PASS fail=$FAIL skip=$SKIP)"; fi
fi
[ "$FAIL" = "0" ]
