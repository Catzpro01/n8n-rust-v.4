# TS Baseline — Bukti Gate Manajer

Tanggal: 2026-09-20 (UTC) · Branch: `arena/01a0c016-n8n-rust-v-4` · Kontrak v0.1.0.
Rust FROZEN: `crates/**`, `apps/n8n-rust/**`, `reference/n8n/**` nol diff (G6).

## Ringkasan gate lokal

| Gate | Perintah | Hasil |
|---|---|---|
| G0 kontrak stabil | `git log --oneline -- contracts/ts-baseline-runtime.contract.md` | 1 komit (`a27b6efd`) — stabil sejak dispatch |
| G1 boundary disjoint | `git show --name-only` per komit worker | 7 grup komit, nol file lintas-worker |
| G2 build | `npm --prefix apps/n8n-ts run typecheck && run build` | OK, tanpa warning |
| G3a adapter (W4) | `node --test packages/reconstructed-engine/ts-runtime-adapter.test.mjs` | 14 pass / 0 fail |
| G3b runtime (W3) | `node tests/runtime/run-all.mjs` | 44 pass / 0 fail (8/8 file) |
| G3c integrasi (W3) | `node --test tests/integration/ts-baseline-smoke.test.mjs` | 3 pass / 0 fail |
| G4 doctor | `bash scripts/doctor.sh` (stopped) + `--require-running` (running, diuji W2) | OK (3 pass 2 skip stopped; 7 pass 1 skip running) |
| G5 docker | `docker build -f deploy/docker/Dockerfile .` | SKIP sandbox (docker absen) → dijalankan di CI `ts-baseline.yml` |
| G6 forbidden | `git diff --name-only origin/main...HEAD -- crates apps/n8n-rust reference/n8n` | kosong |
| G7 engine kedua | `grep -rn "while (queue.length\|executionData.set" apps/n8n-ts/src` + test 08 | kosong + 08 lulus |
| Regresi existing | `node --test localization + node-catalog` | 15 pass / 0 fail |

## Siklus manager→worker yang terjadi

1. Worker 3 menemukan 3 kegagalan (body kosong → hint salah; PORT-override probe salah alamat;
   log `dotenv loaded` tak pernah muncul).
2. Manajer mendisposisikan: 2 bug ke Worker 1 (kontrak §3 + observability), 1 bug test ke Worker 3.
3. Worker 1 komit fix (`d11139d8`, scope `apps/n8n-ts/**` saja), Worker 3 perbaiki testnya.
4. Suite penuh hijau: 44/44 + 3/3. Tidak ada perubahan kontrak (G0 terjaga).

## Peta komit (7 grup, disjoint)

| Komit | Pemilik | Isi |
|---|---|---|
| `a27b6efd` | manager | kontrak + 5 spec + `.gitignore` |
| `523e39bb` | worker-4 | audit + adapter + test adapter (3 file baru) |
| `a56eb749` + `af4528e4` | worker-1 | runtime server + lockfile |
| `35e41268` | worker-2 | docker + 6 scripts + `.env.example` |
| `d11139d8` | worker-1 | fix disposisi manajer (3 file milik W1) |
| `b6cd951f` | worker-3 | 8 test + fixtures + helpers + smoke integrasi |
| + integrasi | manager | root scripts + CI + `.dockerignore` + docs + bukti ini |

## Acceptance §10 (status)

1. [x] Kontrak stabil. 2. [x] Boundary bersih. 3. [x] Build hijau. 4. [x] 8/8 test.
   5. [x] doctor OK (sandbox; laptop runner menyusul via CI/PR).
   6. [ ] docker build (CI). 7. [ ] VPS `vps-runtime`. 8. [ ] live smoke
   `https://n8n.kentutmambu.my.id/`. 9. [x] Rust/reference utuh. 10. [x] Tanpa engine kedua.

**Belum boleh klaim `TYPESCRIPT BASELINE FROZEN`** — menunggu 6–8 (CI + VPS + live smoke).
