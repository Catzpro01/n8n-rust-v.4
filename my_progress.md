# 📋 ARENA AGENT PROGRESS & HANDOVER

- **Agent ID**: agent-01 (workflow) — sesi lanjutan
- **Session branch**: `arena/01a0c53e-n8n-rust-v-4` (base `cb71dbb2` = `main`, "n8n-lego: P2 compatibility contract layer (#42)").
  **Catatan branch:** brief P2.5 menyebut `arena/01a0c4f9-n8n-rust-v-4` (ada di remote pada `439629b5`, tree-nya **identik**
  dengan `cb71dbb2` = P2 baseline). Sesi ini terkunci ke `arena/01a0c53e-n8n-rust-v-4`, jadi pekerjaan P2.5 ada di branch ini
  (PR #43). Pindah ke branch yang ditugaskan = `git cherry-pick` dua commit P2.5 (`f8bdee00` + commit nested di bawah);
  keduanya menyentuh file yang sama sekali belum ada di `cb71dbb2`, jadi konflik diperkirakan nihil kecuali `my_progress.md`.
- **Assigned Module**: workflow (`workflow.graph`, `workflow.traversal`, `workflow.diff`, `trigger.lifecycle`) — sesi ini mengerjakan
  **test infrastructure** (`tools/rust-offline-rig/**`, registry `integration.gates` milik agent-05) karena tanpa itu seluruh
  verifikasi Rust Phase 3 mustahil dijalankan di sandbox.
- **Current Task ID**: **P2.5 — Frontend LEGO Foundation** (owner Agent 1: frontend contract, capability registry,
  UI compatibility, frontend regression gates). Tugas rig Rust di bawah sudah **SELESAI** (lihat Lampiran A).
- **Last Updated**: 2026-09-21 (P2.5)

---

## 🧱 P2.5 — FRONTEND LEGO FOUNDATION (tugas saat ini, SELESAI + terverifikasi)

**Tujuan:** memisahkan *kontrak* frontend dari *implementasi* Vue tanpa mengubah tampilan/perilaku UI n8n.
Fondasi saja — **tidak ada** fitur (tidak ada terjemahan, tidak ada redesign, tidak ada migrasi framework).

### Apa yang dibuat (deliverable)

| # | Deliverable | Lokasi |
| :- | :--- | :--- |
| 1 | **Kontrak frontend (normatif)** — boundary F1–F8, error model §8 (kode mesin `backend-errors.*` + 10 kind + semantik status 200/400/401/403/404/409/422/500/501/503), bentuk list §9, extension point §11, 13 slot pesan + 6 locale §12, versioning §13, invariant I1–I11 | `contracts/frontend.contract.md` |
| 2 | **LEGO package** `@lego/frontend` — contract/envelope, error model, i18n structure, capability registry, boot payload, REST client + state model, adapter Vue | `packages/frontend-lego/` (`src/*.mjs`, `manifest/*.json`, `index.mjs`, `package.json`) |
| 3 | **Wiring app** — resolusi paket + fail-soft, endpoint penemuan, injeksi meta tag | `apps/n8n-lego/src/frontend.mjs`, `src/frontend/routes.mjs`, `src/ui.mjs`, `src/server.mjs` |
| 4 | **Test kontrak/arsitektur** 78 test (6 suite) | `packages/frontend-lego/test/01..06-*.test.mjs` |
| 5 | **Test boundary app** 11 test (in-process, HTTP nyata) | `apps/n8n-lego/test/frontend.boundary.test.mjs` |
| 6 | **Browser gate P2.5** | `tests/e2e/frontend-boundary.mjs` (+ step CI) |
| 7 | **Dokumentasi arsitektur + migrasi** | `docs/n8n-lego/FRONTEND_LEGO.md` |
| 8 | **Bukti (dapat diregenerasi)** | `docs/n8n-lego/evidence/frontend-boundary-p25.json` (18/18 pemeriksaan, via `node apps/n8n-lego/scripts/capture-frontend-evidence.mjs`) |
| 9 | **Sub-LEGO bertingkat (layer baru)** — 19 unit 3 level, owner/versi/port publik/area privat/dependency/policy upgrade, registry fail-closed + uji upgrade | `packages/frontend-lego/manifest/sub-legos.json`, `src/sublegos.mjs`, `test/06-sublegos.test.mjs` |
| 10 | **Kontrak sub-LEGO (normatif)** — kapan sesuatu jadi sub-LEGO, hierarki, public/private, ownership, aturan upgrade | `contracts/frontend-sub-lego.contract.md` |
| 11 | **Extension point tambahan** — Search (`ui:search:provider`), Accessibility (`ui:accessibility:annotate`, atribut whitelist saja), Import/Export (`ui:document:format`); total 15 hook / 7 calon konsumen | `packages/frontend-lego/manifest/extension-points.json` |

### Angka verifikasi (dijalankan di sesi ini)

| Gate | Perintah | Hasil |
| :--- | :--- | :--- |
| Kontrak + arsitektur | `npm run frontend-lego:test` | **78/78 PASS** |
| App (P2 contract + P2.5 boundary) | `node --test "apps/n8n-lego/test/*.test.mjs"` (catalog lokal di `data/n8n-lego/catalog`) | **36/36 PASS** (25 lama + 11 boundary) |
| UI tidak berubah (byte-identik selain tag) | test boundary app + evidence | **PASS** — `delta=24268 bytes (the tag only)` |
| Uji upgrade sub-LEGO (baru) | `node --test packages/frontend-lego/test/06-sublegos.test.mjs` | **PASS** — upgrade minor satu unit: semua sibling **byte-identik**; upgrade major ditolak selama dependen mem-pin major lama, lolos hanya dengan `acknowledge` eksplisit |
| Instance terpasang (tarball, tanpa repo) | `tar -xzf dist/*.tar.gz` → start → curl | **200** bootstrap, tag muncul **1×**, resolusi ke `vendor/frontend-lego/index.mjs` |
| LEGO tidak tersedia (fail-soft) | rename `vendor/frontend-lego` → start | UI **tetap 200**, tag **0×**, endpoint → **501 `{code:'unsupported', meta:{feature:'frontend-bootstrap', owner:'ui-frontend'}}`** |
| Release | `bash scripts/release.sh --no-docker` | artifact + `vendor/frontend-lego` ikut ter-vendor (224K/136K) |
| Audit repo | `python3 tools/sublego-audit/audit.py` | **AUDIT PASSED** (12 LEGO / 20 Sub-LEGO — registry `.arena` tidak disentuh) |
| Isolation gate | `npm run verify:fast` | **5/10 = baseline** (G06–G10 tetap blocked; tanpa regresi baru) |
| Browser/E2E | `node tests/e2e/frontend-boundary.mjs` | **CI saja** (sandbox tanpa Chromium/egress) — P0/P2 smoke juga CI-only |

### Keputusan penting (jangan diubah tanpa alasan)

- **D9** P2.5 mendaftarkan **0 capability** — registry ada, isinya kosong; agent-05 boleh memakainya untuk uji "fail-closed".
- **D10** `packages/frontend-lego` **tidak** ditambahkan ke `.arena/registry/lego.yaml` (milik agent-05, audit bidirectional);
  pendaftaran `ui-frontend` = keputusan Manager/Integrator, bukan efek samping phase ini.
- **D11** boot payload dikirim lewat **meta tag di `index.html`** (satu dokumen yang sudah di-fetch, `no-store`), bukan endpoint
  kedua yang harus dipanggil UI. Budget ≤24 KB base64 ditegakkan test (sekarang ~19 KB).
- **D12** hanya `src/adapters/**` yang boleh menyebut framework; test 05 memaksa aturan ini (dan melarang `Vue` di modul non-adapter).
- **D14** **Sub-LEGO hanya untuk unit yang layak**: komponen/tombol/ikon/helper adalah detail privat, bukan LEGO.
  Sebuah unit ada kalau punya kontrak, owner, batas test, dan jalur upgrade sendiri — 19 unit hari ini, semuanya
  `status: declared` (tidak ada yang diimplementasikan).
- **D15** Batas publik = **port** (`ui:<area>:<nama>`); dependensi ke apa pun selain port publik ditolak **dengan nama**
  (`"credentials" reaches into the private internals of "dialogs": …`), cycle ditolak, dan port tidak boleh berbagi id
  dengan extension point (dua hal berbeda: tempat menempel vs yang boleh di-couple).
- **D16** Upgrade = **manifest entry baru untuk satu unit** (mekanisme asli, bukan test double). Minor/patch: hanya unit itu
  yang berubah. Major: ditolak selama dependen mem-pin major lama, dan hanya lanjut dengan `{ acknowledge: [...] }` yang
  dicatat di dependen sebagai `acknowledgedUpgrades`. Downgrade dan unit `coupled` ditolak.
- **D17** `capability` per unit divalidasi terhadap surface-nya (surface tetap sumber tunggal; sentinel `none` di
  `surfaces.json` dinormalkan jadi `null`), sehingga dua tempat tidak bisa berbeda diam-diam.
- **D13** shared file yang disentuh: root `package.json` (1 script), `.github/workflows/n8n-lego.yml` (path filter + 2 step),
  `scripts/release.sh` (vendoring), `docs/n8n-lego/ROADMAP.md` (1 baris), `contracts/frontend.contract.md` (baru),
  dan pada increment nested: `contracts/frontend.contract.md` §4/§11/§11.1/§16.1 (aditif), `manifest/extension-points.json`
  (+3 hook). Tidak ada file shared lain. Root `package.json`, workflow CI, dan `release.sh` **tidak** berubah lagi.

### Arbitrase yang menunggu Manager/Integrator (jangan diputuskan sepihak)

`contracts/micro-frontend.contract.md` (LEGO 13, "CONTRACT SPECIFIED") mendeklarasikan dekomposisi **Web Components** dan
himpunan bahasa `id, en, es, fr, de, ja`. P2.5 **tidak** mengimplementasikan maupun mengubahnya: implementasi referensi
tetap bundle Vue yang di-pin, dan himpunan locale adalah `id, en, ar, zh, ru, jv` sesuai brief. Perbedaan ini dicatat di
`contracts/frontend.contract.md` §16.1 sebagai item arbitrase (mana yang otoritatif; apakah Web Components masih target).

### Batas phase (HARD STOP) & titik integrasi P2.6

- **Tidak** dijalankan: Translation LEGO, penggantian Vue, migrasi React/Svelte/Web Components, implementasi fitur
  Workflow/Execution/Auth/Credentials/Node Registry, Rust, microservices, redesign. Bundle `n8n-editor-ui@2.9.4` **tidak dipatch**.
- **P2.6 (backend) / Integrator**: (a) endpoint baru `GET /rest/frontend/bootstrap` — aditif, auth-guarded, tidak pernah dipanggil UI lama;
  (b) meta tag `n8n-lego:frontend-bootstrap` pada `index.html` harus tetap aditif bila template dokumen berubah;
  (c) kosakata error (`frontend.*` + `backend-errors.*`) kini data kontrak — kode baru ⇒ extend `contracts/frontend.contract.md` §8;
  (d) `packages/frontend-lego/manifest/ownership.json` adalah deskriptor diri LEGO (konvensi `packages/*-lego`).
- **P2.6-BE**: metode HTTP, bentuk envelope, dan status code yang dipakai client ada di `src/contract.mjs` + §9 kontrak —
  jangan tambahkan bentuk respons baru tanpa memperbarui kontrak (test 01 akan gagal bila dokumen tidak sinkron).

### Langkah pertama untuk sesi penerus (frontend)

1. `npm run frontend-lego:test` (**harus 55/55**) lalu `N8N_LEGO_CATALOG_DIR=<catalog> npm run lego:test` (**34/34**).
2. Kalau menyentuh UI/contract: jalankan `node tests/e2e/frontend-boundary.mjs <url>` di CI (lokal tanpa Chromium).
3. Phase berikutnya (setelah izin Manager): Translation LEGO memakai `ui:message:catalog` + `ui:locale:switch` +
   slot pesan yang sudah dideklarasikan; **jangan** mulai tanpa kontrak terpisah.

---

## 📎 Lampiran A — Sesi rig Rust offline (SELESAI, arsip)

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
