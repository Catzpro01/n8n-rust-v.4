# WORKER 2 — PACKAGING (deploy + scripts + env)

## Kontrak acuan
`contracts/ts-baseline-runtime.contract.md` §5–§7.

## Scope (allowed_paths — EKSKLUSIF)
- `deploy/docker/**`
- `scripts/install.sh`
- `scripts/start.sh`
- `scripts/stop.sh`
- `scripts/upgrade.sh`
- `scripts/rollback.sh`
- `scripts/doctor.sh`
- `.env.example` (APPEND vars TS baseline; JANGAN hapus vars Arena yang ada)

## Forbidden
- `crates/**`, `apps/**`, `packages/**`, `tests/**`, `reference/n8n/**`
- `deploy/supabase/**`, `deploy/systemd/**` (control plane — jangan sentuh)
- File `scripts/*` lain (mis. `scripts/arena/*`, `scripts/run-lego-tests.sh`)
- `.github/**`, root `package.json`

## Deliverables
```
deploy/docker/
  Dockerfile            (multi-stage node:22-alpine, non-root, HEALTHCHECK /healthz)
  docker-compose.yml    (service n8n-ts, restart unless-stopped, ${PORT:-5678}:5678)
  README.md             (cara build/run/logs/clean — ringkas)
scripts/
  install.sh            (clean Ubuntu → node 22 → deps → build → .env → doctor)
  start.sh              (idempoten: docker compose jika ada image, else node langsung + PID)
  stop.sh               (hentikan keduanya, aman jika sudah berhenti)
  upgrade.sh            (backup → pull/rebuild → restart → smoke; gagal → auto-rollback)
  rollback.sh           (restore backup terakhir → restart → smoke)
  doctor.sh             (node, port, /, /healthz, run workflow, .env, build, docker)
.env.example            (vars lama dipertahankan + blok TS baseline)
```

## Aturan implementasi
1. Semua `.sh`: `set -euo pipefail`, section log `[install] ...`, idempoten, aman di-rerun.
2. `install.sh` harus berhasil di clean Ubuntu 22.04/24.04 tanpa intervensi (boleh `sudo` jika ada,
   fallback tanpa sudo). Node via NodeSource 22 jika `node --version` < 20.
3. `start.sh`/`stop.sh` mendukung mode ganda: Docker (utama) + Node langsung (fallback).
   PID file: `.runtime-ts/server.pid`. Log: `.runtime-ts/server.log`.
4. `upgrade.sh`/`rollback.sh` memakai backup dir `.runtime-ts/backups/<YYYYMMDD-HHMMSS>/`
   berisi `dist.tar.gz` + `.env` + `VERSION`.
5. `doctor.sh` exit 0 jika semua OK, exit 1 + pesan jelas jika ada yang gagal; mendukung
   `HOST`/`PORT` override dan `--json` (opsional).
6. Dockerfile: stage `build` (npm ci + build) → stage `runner` (hanya `dist/` +
   `packages/reconstructed-engine/*.mjs` + `package.json` produksi). Non-root `node` user.
   `HEALTHCHECK` memakai `node -e fetch` (tanpa curl/wget agar image kecil).
7. `docker-compose.yml`: satu service, `env_file: ../../.env` + `environment` override,
   `healthcheck` 30s, `restart: unless-stopped`.
8. Tidak ada secret yang di-commit. `.env` tidak pernah ditulis ke git (sudah di `.gitignore`).

## Acceptance (target: clean machine → install → start → running)
- `bash scripts/install.sh` → exit 0.
- `bash scripts/start.sh` → `GET /healthz` 200 dalam 15 detik.
- `bash scripts/doctor.sh` → semua OK.
- `bash scripts/stop.sh` → port bebas; rerun `stop.sh` tetap exit 0.
- `bash scripts/upgrade.sh` dan `bash scripts/rollback.sh` mendukung `--help` dan dry-run aman.
- `docker build -f deploy/docker/Dockerfile .` sukses (jika docker tersedia).
