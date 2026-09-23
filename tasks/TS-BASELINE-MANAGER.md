# MANAGER PLAN — TypeScript LEGO Baseline

Peran: **MANAGER** (bukan primary coder). Rust **FROZEN**.
Sesi: `arena/01a0c016-n8n-rust-v-4` (terkunci oleh Arena — lihat §0).

## 0. Catatan platform (penting)

Arena mengunci sesi ini ke SATU branch (`arena/01a0c016-n8n-rust-v-4`) dan melarang
membuat/switch/push branch lain. Perintah user meminta "setiap worker branch sendiri + PR sendiri".

Resolusi manajer (tanpa melanggar platform):

- Isolasi worker ditegakkan via **scope direktori + komit terpisah + audit overlap**,
  bukan via branch terpisah. Secara logika sama: tidak ada file yang disentuh dua worker.
- Satu PR manajer (`arena/01a0c016-n8n-rust-v-4` → `main`) berisi 4 grup komit worker
  yang teridentifikasi jelas + komit integrasi manajer.
- Jika user menghendaki 4 PR fisik terpisah, manajer dapat memecahnya setelah sesi ini
  (via `git cherry-pick` per grup) — tetapi dalam sesi ini semua kerja tetap di branch sesi.

Boundary enforcement:

- Setiap grup komit worker HANYA menyentuh `allowed_paths`-nya.
- Manajer menjalankan audit overlap sebelum integrasi (lihat `results/TS-BASELINE-GATES.md`).
- `crates/**`, `apps/n8n-rust/**`, `reference/n8n/**` = FORBIDDEN untuk semua worker.

## 1. Urutan kerja

```
[MANAGER] kontrak stabil (contracts/ts-baseline-runtime.contract.md)  ✅ DONE
   ↓
[PARALEL secara logika — dieksekusi sekuensial oleh sesi tunggal ini]
   ├─ Worker 4 (LEGO adapter) — PERTAMA agar Worker 1 bisa memakai adapter
   ├─ Worker 1 (runtime server)
   ├─ Worker 2 (packaging)
   └─ Worker 3 (testing)
   ↓
[MANAGER] integration: root scripts + CI + gitignore + docs
   ↓
[MANAGER] gates lokal: build, test runtime nyata, doctor, docker build
   ↓
[MANAGER] push + PR → CI laptop → deploy VPS `vps-runtime` → live smoke
   ↓
User menyatakan TYPESCRIPT BASELINE FROZEN → baru bicara migrasi Rust
```

Meskipun dieksekusi sekuensial, setiap worker dimulai dari kontrak yang sama dan
tidak membaca/menulis area worker lain — memenuhi "dispatch paralel" secara semantik.

## 2. Dispatch

| Worker | Spec | Scope (allowed) |
|---|---|---|
| 1 — RUNTIME SERVER | `tasks/TS-BASELINE-WORKER-1-RUNTIME.md` | `apps/n8n-ts/**` |
| 2 — PACKAGING | `tasks/TS-BASELINE-WORKER-2-PACKAGING.md` | `deploy/docker/**`, `scripts/install.sh`, `scripts/start.sh`, `scripts/stop.sh`, `scripts/upgrade.sh`, `scripts/rollback.sh`, `scripts/doctor.sh`, `.env.example` |
| 3 — TESTING | `tasks/TS-BASELINE-WORKER-3-TESTING.md` | `tests/runtime/**`, `tests/integration/ts-baseline-*/**` (file baru `ts-baseline-*` saja; file integrasi existing terlarang) |
| 4 — LEGO INTEGRATION | `tasks/TS-BASELINE-WORKER-4-LEGO.md` | `packages/reconstructed-engine/ts-runtime-adapter.*`, `packages/reconstructed-engine/LEGO-BASELINE-AUDIT.md` |

Manager-owned (bukan worker): `contracts/**`, `tasks/**`, `.github/**`, root `package.json`,
root `.gitignore`, `docs/TS-BASELINE.md`, `results/**`, `README.md` (edit integrasi saja).

## 3. Gates (harus lulus sebelum PR diklaim siap)

- G0 kontrak stabil (tidak diubah selama worker berjalan)
- G1 boundary: nol overlap antar grup komit worker
- G2 `apps/n8n-ts`: `npm ci && npm run build && npm run typecheck` hijau
- G3 `node --test tests/runtime/*.test.mjs` 8/8 hijau (runtime nyata)
- G4 `bash scripts/doctor.sh` OK
- G5 `docker build deploy/docker` sukses (jika docker tersedia; else catat SKIP + alasan)
- G6 forbidden paths: `git diff main -- crates apps/n8n-rust reference/n8n` kosong
- G7 tidak ada engine kedua (regression test + grep review)

## 4. Setelah PR

1. Review perubahan per grup komit.
2. Pastikan boundary tidak tumpang tindih (G1).
3. CI laptop (`ts-baseline.yml` + existing workflows).
4. Build/test di laptop runner.
5. Deploy ke VPS runner `vps-runtime`.
6. Live smoke `https://n8n.kentutmambu.my.id/`.
7. Jangan klaim BASELINE FROZEN sebelum 10 acceptance criteria kontrak §10 lulus.

## 5. Log manajer

| Waktu (UTC) | Kejadian |
|---|---|
| 2026-09-20 | Kontrak `ts-baseline-runtime.contract.md` v0.1.0 STABLE ditulis. |
| 2026-09-20 | Worker specs 1–4 ditulis. Dispatch paralel (semantik). |
| — | Worker 4 → 1 → 2 → 3 dieksekusi (lihat komit). |
| — | Integrasi manajer + gates lokal. |
| — | Push + PR + laporan. |
