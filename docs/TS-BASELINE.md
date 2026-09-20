# TypeScript LEGO Baseline — Panduan Usable

Status kontrak: **STABLE v0.1.0** (`contracts/ts-baseline-runtime.contract.md`).
Rust: **FROZEN** untuk track ini (`crates/**`, `apps/n8n-rust` tidak disentuh).

Baseline ini adalah aplikasi n8n-TS yang bisa di-install, dijalankan, di-oprek,
di-upgrade, di-debug, dan di-deploy ke VPS — sebelum migrasi LEGO → Rust satu per satu.

## Arsitektur 1 menit

```
Internet/VPS → [node:http :5678] apps/n8n-ts
                 ├─ GET /                        landing JSON
                 ├─ GET /healthz                 liveness
                 └─ POST /api/v1/workflows/run   → adapter (Worker 4)
                                                    → WorkflowExecutionEngine
                                                      (packages/reconstructed-engine/runner.mjs)
```

Satu engine, nol dependensi runtime, tiga endpoint. Itu saja.

## Quickstart (laptop)

```bash
git checkout arena/01a0c016-n8n-rust-v-4
bash scripts/install.sh     # node → deps → build → .env → doctor
bash scripts/start.sh       # jalan (docker jika ada, else node langsung)
bash scripts/doctor.sh      # verifikasi
curl -s localhost:5678/healthz
```

Jalankan workflow:

```bash
curl -s -X POST localhost:5678/api/v1/workflows/run \
  -H 'content-type: application/json' \
  -d @tests/runtime/fixtures/linear.json
```

Berhenti: `bash scripts/stop.sh` (aman di-rerun).

## Quickstart (VPS Ubuntu bersih)

```bash
git clone <repo> && cd n8n-rust-v.4
git checkout arena/01a0c016-n8n-rust-v-4   # atau main setelah merge manajer
bash scripts/install.sh
bash scripts/start.sh
bash scripts/doctor.sh --require-running
```

Reverse proxy (contoh Caddy untuk `https://n8n.kentutmambu.my.id`):

```caddy
n8n.kentutmambu.my.id {
  reverse_proxy 127.0.0.1:5678
}
```

Contoh nginx tersedia di `deploy/docker/README.md`? Tidak — proxy di luar baseline;
cukup teruskan HTTP ke `127.0.0.1:$PORT` dan biarkan `/healthz` untuk monitor.

## Operasi

| Perintah | Fungsi |
|---|---|
| `bash scripts/doctor.sh` | diagnosa (9 cek) |
| `bash scripts/doctor.sh --require-running` | diagnosa + wajib jalan (untuk CI/smoke) |
| `bash scripts/upgrade.sh` | backup → pull → rebuild → restart → smoke (gagal → auto-rollback) |
| `bash scripts/upgrade.sh --check` | dry-run upgrade |
| `bash scripts/rollback.sh` | pulihkan backup terakhir |
| `bash scripts/rollback.sh --list` | daftar backup |
| `PORT=5680 bash scripts/start.sh` | port kustom |

Backup: `.runtime-ts/backups/<ts>/` (dist + .env + VERSION), 5 terbaru dipertahankan.
Log node langsung: `.runtime-ts/server.log`. Log docker: `docker logs -f n8n-ts-baseline`.

## Konfigurasi (kontrak §5)

`.env` (dari `.env.example`): `HOST` (default `0.0.0.0`), `PORT` (`5678`),
`LOG_LEVEL` (`info`), `BODY_LIMIT_BYTES` (`1048576`), `EXECUTION_TIMEOUT_MS`
(`30000`), `N8N_LOCALE` (`id`), `NODE_ENV` (`production`). Perubahan butuh restart.
Boot selalu mencetak satu baris `[config] ...` — baca itu dulu saat debug.

## Oprek & debug

- Tambah route: `apps/n8n-ts/src/server.ts` + `src/routes/` (tambah endpoint = amendemen kontrak).
- Ubah perilaku node: `packages/reconstructed-engine/ts-runtime-adapter.mjs`
  (handler terpusat, bukan di runtime).
- DILARANG: framework HTTP, `eval` jsCode user, engine kedua, sentuh Rust/reference.
- Debug: `LOG_LEVEL=debug npm --prefix apps/n8n-ts run dev` (tanpa build),
  `bash scripts/doctor.sh --json` untuk mesin.

## Testing

```bash
npm run ts:test   # adapter (14) + runtime nyata (44) + integrasi (3)
```

- `tests/runtime/*`: melawan server nyata di port ephemeral (baca `tests/runtime/README.md`).
- `tests/integration/ts-baseline-smoke.test.mjs`: fixtures `tests/reference/0{1,2,3}-*`.
- Gate regresi (`08`) memastikan: tanpa engine kedua, envelope stabil, locale
  additive-only, `crates/`, `apps/n8n-rust/`, `reference/n8n/` nol diff.

## Struktur kepemilikan (boundary)

| Area | Pemilik | Scope |
|---|---|---|
| `apps/n8n-ts/**` | Worker 1 | runtime server |
| `deploy/docker/**`, `scripts/{install,start,stop,upgrade,rollback,doctor}.sh`, `.env.example` | Worker 2 | packaging |
| `tests/runtime/**`, `tests/integration/ts-baseline-smoke.test.mjs` | Worker 3 | testing |
| `packages/reconstructed-engine/ts-runtime-adapter.*`, `LEGO-BASELINE-AUDIT.md` | Worker 4 | LEGO adapter |
| `contracts/`, `tasks/TS-BASELINE-*`, `.github/workflows/ts-baseline.yml`, `docs/`, `results/` | Manager | kontrak + integrasi |

CI `ts-baseline.yml` mengaudit boundary + forbidden paths di setiap PR.

## Gate BASELINE FROZEN (kontrak §10)

Status terkini: lihat `results/TS-BASELINE-GATES.md`. Manajer tidak menyatakan
`TYPESCRIPT BASELINE FROZEN` sebelum 10 acceptance criteria lulus termasuk live smoke
`https://n8n.kentutmambu.my.id/`. Migrasi LEGO → Rust dimulai hanya setelah user
menyatakan frozen.
