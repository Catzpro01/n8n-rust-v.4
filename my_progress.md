# 📋 ARENA AGENT PROGRESS & HANDOVER

- **Agent ID**: agent-01 (workflow) — sesi lanjutan
- **Session branch**: `arena/01a0c53e-n8n-rust-v-4` (base `cb71dbb2` = `main`, "n8n-lego: P2 compatibility contract layer (#42)")
- **Assigned Module**: workflow (`workflow.graph`, `workflow.traversal`, `workflow.diff`, `trigger.lifecycle`) — sesi ini mengerjakan
  **test infrastructure** (`tools/rust-offline-rig/**`, registry `integration.gates` milik agent-05) karena tanpa itu seluruh
  verifikasi Rust Phase 3 mustahil dijalankan di sandbox.
- **Current Task ID**: pemulihan Rust offline rig pasca-`cb71dbb2` (tokio dev-dependency) + verifikasi regresi workspace
- **Last Updated**: 2026-09-21

---

## 🎯 1. Ringkasan Tugas Sesi Ini (Mission Objective)

Menjalankan langkah verifikasi yang diamanatkan handover sesi sebelumnya (`setup.sh` → `run.sh test` → `audit.py`).
Verifikasi **gagal total**: rig mengeluarkan `error: no matching package named tokio found`, jadi tidak satu pun crate
bisa di-check/di-test di sandbox. Tugas sesi ini = menghidupkan kembali rig, lalu membuktikan seluruh 8 crate lolos.

---

## ⚡ 2. Apa yang Sudah Dikerjakan (Completed Work & Evidence)

- [x] **`tools/rust-offline-rig/setup.sh`** — `CRATES` +2: `tokio-1.53.1` (`tokio-rs/tokio` @ tag `tokio-1.53.1`) dan
      `pin-project-lite` (`taiki-e/pin-project-lite` @ `v0.2.17`); komentar closure diperbaiki (27 crate, bukan 24).
- [x] **`tools/rust-offline-rig/vendor_prep.py`**
  - `PLAN` +3: `tokio 1.53.1`, `tokio-macros 2.7.1`, `pin-project-lite 0.2.17`.
  - Tabel `[lints]` dan seluruh `[workspace.*]` kini dibuang (sebelumnya hanya `[workspace]` persis): `[lints] workspace = true`
    pada tokio/tokio-macros/pin-project-lite sebelumnya memicu `FATAL: manifest still has workspace/path remnants`.
  - Tabel dev-dependency **target-scoped** (`[target.'cfg(unix)'.dev-dependencies]`, `…dev-dependencies.windows-sys]`) ikut dibuang;
    `collect_external_dev_deps` mengenali komponen `dev-dependencies` di mana pun pada header tabel.
  - Pruning fitur diperbaiki: referensi `dep:foo`, `foo/feature`, `foo?/feature` **tidak** dianggap fitur menggantung, dan nama
    yang juga dideklarasikan sebagai dependency biasa tidak dianggap "dropped" (tokio punya `libc` sebagai dev-dep *dan*
    dependency opsional; aturan lama mengosongkan fitur `io-uring`, dan cargo menolaknya: *optional dependency
    `io-uring` is not included in any feature*).
- [x] **`tools/rust-offline-rig/run.sh`**
  - `EXCLUDE_MEMBERS` dikosongkan: **semua 8 member** (termasuk `n8n-nodes-rust` dan `runtime_runner_test.rs`) ikut dibangun.
  - `LOCK_DRIFT=("tokio-macros")`: blok lock milik crate yang versinya tidak punya tag git dihapus agar cargo me-resolve ulang
    dari directory source (tokio-macros 2.7.2 dipublikasikan tanpa tag `tokio-macros-2.7.2`; tag `tokio-1.53.1` membawa 2.7.1).
- [x] **`tools/rust-offline-rig/README.md`** — daftar crate 24 → 27, status run 2026-09-21, dan caveat drift `tokio-macros` 2.7.1.
- [x] **`docs/isolation/CROSS-AGENT-ISSUES.md`** — entri `ISSUE-023` untuk jejak audit lintas-agen (perubahan ini test infra only).

**Bukti uji (2026-09-21, `bash tools/rust-offline-rig/run.sh check` lalu `run.sh test`)**

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 11.93s     # semua 8 crate, --all-targets
```

| Suite | Hasil |
| :--- | :--- |
| `n8n-connection` / `n8n-execution-data` / `n8n-expression` | 2 / 20 / 37 passed |
| `n8n-node-model` / `n8n-validation` / `n8n-nodes-rust` | 1 / 4 / **2 passed** (tokio, sebelumnya tidak pernah jalan) |
| `n8n-workflow` unit (incl. `trigger.rs`) | 70 passed |
| `n8n-workflow` integration: `conformance` / `graph_expression_integration` / `reference_fixtures` / `runtime_runner_test` / `trigger_lifecycle` | 2 / 1 / 5 / **4** / 3 passed |
| **Total workspace** | **151 passed, 0 failed** (21 suite, sebelumnya 79–80) |

- `python3 tools/sublego-audit/audit.py` → **AUDIT PASSED** (12 LEGO, 20 Sub-LEGO, 5 agent; perlu `pip install pyyaml` di sandbox ini).

---

## 🧠 3. Keputusan Teknis Penting (Key Architectural Decisions)

- **D-01 — tokio di-vendor sebatas closure yang dipakai.** Fitur yang diminta workspace hanya `rt` + `macros`, sehingga closure-nya
  persis `pin-project-lite` (non-opsional) + `tokio-macros` (`macros = ["tokio-macros"]`). Dependency opsional tokio
  (`mio`, `bytes`, `socket2`, `libc`, …) tetap dideklarasikan di manifest tapi tidak pernah di-resolve — tanpa menambah
  ~20 crate target-gated yang dulu menjadi alasan `n8n-nodes-rust` dikecualikan.
- **D-02 — pembersihan tabel manifest berbasis pola nama, bukan daftar crate.** Aturan `[lints]` / `[workspace*]` / `*dev-dependencies*`
  berlaku umum untuk crate berikutnya, bukan tambalan khusus tokio.
- **D-03 — `LOCK_DRIFT` eksplisit, bukan penghapusan lock.** Hanya crate yang benar-benar menyimpang yang di-resolve ulang; sisanya
  tetap terkunci pada versi `Cargo.lock` supaya hasil build lokal tetap relevan. Drift ini tercatat sebagai caveat di README rig.

---

## ⚠️ 4. Masalah / Blocker yang Dihadapi (Known Issues & Gotchas)

- **Gate Phase-2 masih basi (pra-eksisting, bukan dari sesi ini)**: `npm run verify:fast` → **5/10 PASS**; G06–G10 gagal karena
  (a) `packages/workflow-lego/node_modules` belum ada (perlu `npm install`) dan (b) gate lama masih menolak *keberadaan* artefak
  Rust. Butuh keputusan agent-05 (`integration.gates`) agar phase-aware. Sesi ini **tidak** menyentuh file agent-05.
- `npm run verify:fast` menulis ulang `docs/isolation/evidence/gate-report.json` + `docs/isolation/workflow-verification.md`;
  perubahan tulis-ulang itu sudah di-revert agar diff sesi ini bersih.
- **Drift `tokio-macros` 2.7.1 (rig) vs 2.7.2 (`Cargo.lock`)**: proc-macro, hanya beda patch; build hijau di sini bukan klaim
  tentang 2.7.2. VPS/CI tetap memakai crates.io asli.
- `tools/**` terdaftar sebagai milik sub-LEGO `integration.gates` (agent-05); perubahan ini **test infrastructure only**
  (tidak menyentuh `crates/**`) dan dicatat sebagai `ISSUE-023` untuk countersign.
- Kebijakan branch repo (`<SPECIALIZATION>/<MILESTONE>-<TASK>`) tidak dapat dipenuhi: sesi Arena terkunci pada branch
  `arena/01a0c53e-n8n-rust-v-4`.
- `/tmp/rust-rig` ephemeral: jalankan `tools/rust-offline-rig/setup.sh` lagi bila hilang (idempoten, ~1 menit).

---

## ⏭️ 5. Petunjuk Langsung untuk Sesi / Agen Penerus (Next Immediate Actions)
> **JANGAN membaca ulang seluruh kode.** Baca file ini + `tools/rust-offline-rig/README.md`.

1. Verifikasi ulang: `tools/rust-offline-rig/setup.sh` (bila `/tmp/rust-rig` hilang) → `bash tools/rust-offline-rig/run.sh test`
   (**harus 151 passed, 0 failed**) → `python3 tools/sublego-audit/audit.py` (**AUDIT PASSED**).
2. Lanjutkan sub-LEGO yang masih `implementation: reference`: `webhook.router` / `scheduler.engine` (owner agent-03),
   `persistence.snapshot` / `api.envelope` (owner agent-05).
3. Bila gate integrasi dibutuhkan: `npm install` lalu `npm run lego:build` + `npm run verify:fast`, dan koordinasikan dengan
   agent-05 untuk menjadikan `boundary_audit.py` / `contract_conformance.mjs` phase-aware (lihat §4).

---

## 📎 Lampiran — Sesi 2026-09-18 (`trigger.lifecycle` Rust port, sesi sebelumnya)

- **Deliverable**: `crates/n8n-workflow/src/trigger.rs` (~1.1k baris + 26 unit test), `crates/n8n-workflow/tests/trigger_lifecycle.rs`
  (3 test, replay `tests/reference/agent-4/golden/trigger-scheduler.golden.json`), `docs/isolation/trigger-rust-port.md`.
- **Registry**: `trigger.lifecycle` → `implementation: rust`, `status: verified`; `python3 tools/sublego-audit/audit.py` → AUDIT PASSED.
- **Keputusan**: D-01 kegagalan `closeFunction` dikumpulkan di `RemovalReport::warnings` (contract §7); D-02 `TriggerRunner`/`PollRunner`
  di-inject sebagai trait (tanpa DI container); D-03 `emit` mengembalikan `ExecutionRequest` (trigger tidak mengeksekusi).
- **Urutan referensi dipertahankan**: trigger → simpan entry → poll (`runPoll` sekali → validasi cron → `registerCron`), dan
  `emitError` melakukan `remove` sebelum `register` error.
- **Bukti saat itu**: `n8n-workflow` 53 unit + 4 integration suite; total workspace 79–80 passed (`n8n-nodes-rust` **tidak** dibangun
  oleh rig waktu itu).
- **Catatan**: rig 2026-09-18 memakai 24 crate pinned ke `Cargo.lock`; angka itu sudah digantikan sesi 2026-09-21 (27 crate, 151 test).
