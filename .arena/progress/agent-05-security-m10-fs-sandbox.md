# ARENA PROGRESS — agent-05 / security-m10-fs-sandbox

- **Agent**: `agent-05` (Validation, Persistence, API & **Security** — Arena Agent 5)
- **Task**: `security/m10-fs-sandbox` — *Workspace Filesystem Sandbox Boundary Guard* (M10, validation L1, weight 2.0)
- **Boundary file**: `tools/arena-executor/fs_guard.py` (allowed_files = exclusive_files; satu-satunya file yang boleh diubah)
- **Task commit**: `459b25ed` (branch sesi Arena: `arena/01a0ba48-n8n-rust-v-4`, base `main@6c828382`)
- **Branch task yang diminta orchestrator**: `security/m10-m10-fs-sandbox` (valid format `task_manager.BRANCH_REGEX`; sesi Arena ini terkunci ke `arena/01a0ba48-n8n-rust-v-4`, lihat §6)
- **Last updated**: 2026-09-19

---

## 1. Ringkasan

Hardening menyeluruh *filesystem sandbox jail* `FilesystemGuard` di
`tools/arena-executor/fs_guard.py` sesuai acceptance criteria M10:
(1) memblokir path traversal `../`, (2) menolak tulis di luar sandbox dengan
`SecurityError`. Semua perubahan **fail-closed**: jika validasi tidak dapat
memastikan path aman, operasi ditolak. Tidak ada security check existing yang
dilemahkan — semua perubahan matching bersifat *superset* untuk deny dan
*restriktif* untuk write-allowlist.

## 2. Audit Implementasi Existing (temuan → perbaikan)

| # | Temuan pada fs_guard.py lama | Severity | Perbaikan |
| :-- | :-- | :-- | :-- |
| A1 | Write-allowlist `rel.startswith(clean_pat)` tanpa boundary komponen — pola `src` mengizinkan `src-evil/…` | **High** | Match boundary-safe: `rel == clean` atau `rel.startswith(clean + "/")`; bentuk `fnmatch(rel, clean+"*")` untuk allowlist dihapus (hanya bisa menolak lebih banyak) |
| A2 | Pola sensitif `.git/*` hanya match `.git` level teratas — `sub/.git/config` lolos | **High** | Cek **komponen** path: segmen `.git` pada kedalaman apa pun ditolak (read+write) |
| A3 | Pola `*.id_rsa`/`*.id_ed25519` tidak pernah match nama kunci SSH kanonik (`id_rsa`, `id_ed25519` — tanpa prefiks titik) → `.ssh/id_rsa` **lolos** | **High** | Nama eksak `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa` ditambahkan ke daftar sensitif (ditemukan oleh test baru; gap ini ada sejak guard pertama dibuat) |
| A4 | Error tak terduga (`TypeError` input `None`, `OSError` symlink loop) lolos sebagai exception non-SecurityViolation → caller `except SecurityViolation` tidak menangkap | **High** | Seluruh badan validasi dibungkus; semua exception tak terduga dikonversi menjadi `SecurityError` (fail-closed containment) |
| A5 | Input tidak divalidasi: string kosong, NUL byte, kontrol-char, path > PATH_MAX, kedalaman komponen tak terbatas | Medium | Precondition check eksplisit, semua ditolak |
| A6 | `is_write` default `False` → caller lupa flag mendapat kebijakan read (longgar) | Medium | Default diubah ke `True` (deny-by-default); kedua call-site `executor.py` sudah eksplisit `is_write=False` sehingga tidak ada perubahan perilaku in-repo |
| A7 | Tulis ke root workspace sendiri dimungkinkan oleh pola `**` | Medium | `resolved == workspace_root` + `is_write` → tolak |
| A8 | Konstruktor tidak memvalidasi config (root kosong/`None`, pattern non-str/kosong, jail di filesystem root `/`) | Medium | Validasi fail-closed di konstruktor: root harus non-empty & bukan filesystem root; pattern harus list[str] non-empty |
| A9 | Acceptance criteria menyebut `SecurityError` tetapi guard hanya punya `SecurityViolation` | Low | `SecurityError` menjadi kelas kanonik; `SecurityViolation = SecurityError` (objek kelas sama) — semua caller lama tetap jalan tanpa perubahan |

## 3. Security Behavior Akhir (berurutan, semuanya fail-closed)

1. **Input sanity** — hanya `str` non-kosong tanpa NUL/kontrol-char, ≤ 4096 karakter, ≤ 512 komponen.
2. **Jail containment** — kanonikalisasi `Path.resolve()` **dan** verifikasi ulang `os.path.realpath()` (defense in depth); path absolut di luar workspace, traversal `../` relatif/absolut, dan escape symlink (file/dir/rantai) ditolak.
3. **Workspace-root write deny** — tulis ke direktori root workspace ditolak.
4. **Sensitive patterns** (read+write, kedalaman apa pun): `*.env*`, `*.key`, `*.pem`, `*.id_ed25519`, `*.id_rsa`, `*.secret`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`, dan komponen `.git` di kedalaman mana pun.
5. **Forbidden patterns** (denylist sub-LEGO) — matcher superset dari legacy (bentuk over-broad `fnmatch(rel, clean+"*")` dipertahankan; tidak pernah dilemahkan).
6. **Write allowlist** — boundary-safe (pola `a/b`/`a/b/**` = tepat `a/b` + seluruh subtree `a/b/`, tidak bisa dipenuhi sibling `a/b-evil`); allowlist kosong = semua tulis ditolak.

## 4. Bukti Pengujian (2026-09-19, sandbox Linux, Python 3.11.2)

| Suite | Perintah | Hasil |
| :-- | :-- | :-- |
| M10 fs_guard self-test (embedded, 37 test: traversal, boundary path, absolut/relatif, symlink escape, sensitive/forbidden, write-allowlist, input invalid) | `python3 tools/arena-executor/fs_guard.py` | **37 ran, 0 failures, 0 errors, 0 skipped — OK** |
| Executor integration (import path + traversal & dangerous-flag rejection) | inline via `StructuredExecutor` | PASS |
| Arena sub-LEGO enforcement (GATE 1–6A; GATE 5 memakai FilesystemGuard via StructuredExecutor) | `python3 tests/arena/test_sublego_enforcement.py` | **ALL GATES PASSED** |
| 5-agent contention & chaos | `python3 tests/arena/test_5agent_contention.py` | **ALL GATES PASSED 100%** |
| Orchestration invariants/progress/scheduler/task-dag | `PYTHONPATH=. python3 tools/orchestration/tests/test_*.py` | **4/4 PASS** |
| Boundary guard (Control Plane lokal) | `TaskBoundaryGuard.verify_commit_boundary('security/m10-fs-sandbox','459b25ed')` | **VERIFIED** (hanya `tools/arena-executor/fs_guard.py`) |
| Rust workspace check (offline rig; 6 crate yang dev-dep-nya ter-vendor) | `cargo check --offline --workspace` (rig) | Finished, 0 error |
| Rust workspace test (offline rig) | `cargo test --offline --workspace` (rig) | **47 passed, 0 failed** (connection 2, execution-data 3, expression 37, node-model 1, validation 4, common 0) |

Catatan lingkungan: sandbox tidak punya `cargo`/registry; digunakan
`tools/rust-offline-rig` (setup + vendored crates, artefak hanya di `/tmp`).
Task ini **tidak menyentuh satu file Rust pun** (`git diff --stat`: 1 file),
sehingga hasil cargo murni sanity "workspace tetap hijau".

## 5. Temuan di Luar Scope (didokumentasikan, TIDAK diperbaiki — STOP)

1. **`executor.py` tidak pernah memanggil `validate_path(..., is_write=True)`** —
   argumen command hanya di-validasi read; enforcement tulis via executor
   sepenuhnya bergantung pada `DANGEROUS_FLAGS` + command allowlist. Integrasi
   write-flag adalah kepemilikan task `security/m10-env-isolation`
   (allowed_files: `tools/arena-executor/executor.py`). **Rekomendasi** untuk
   agent pemilik task itu: tambahkan `is_write=True` untuk argumen yang
   mengarah ke output build (`--out-dir`, `-o`, dst.) setelah flag berbahaya
   ditolak.
2. **Offline rig tidak bisa membangun test `n8n-workflow`** sejak `main@6c828382`
   menambah `tokio` sebagai dev-dependency `n8n-workflow`
   (`tests/runtime_runner_test.rs` memakai `#[tokio::test]`) sementara closure
   tokio (~20 crate) memang tidak di-vendor oleh rig (`EXCLUDE_MEMBERS` hanya
   `n8n-nodes-rust`). Kepemilikan: pemilik `tools/rust-offline-rig/*` /
   runtime-kernel. CI laptop (`validation.yml`) tetap menjalankan
   `cargo check --workspace` + `cargo test -p n8n-workflow` dengan registry
   penuh, jadi gate CI tidak terpengaruh.
3. **`tools/arena-executor/__init__.py` belum me-re-export `SecurityError`** —
   alias tetap tersedia via `from .fs_guard import SecurityError`; perubahan
   `__init__.py` di luar boundary task ini (trivial, bisa ikut task
   m10-env-isolation).
4. **Pola `*token*` dari `.arena/policies/sensitive-paths.yaml` sengaja tidak
   diberlakukan** di fs_guard — akan over-block file sumber legit (mis.
   `token.rs`) pada validasi argumen command. Divergensi sadar; jika ingin
   diberlakukan, naikkan ke policy layer, bukan basename glob.
5. **Residual risk (diketahui, tidak solvable di layer ini)**: TOCTOU symlink
   swap antara `validate_path` dan operasi FS (mitigasi: caller wajib memakai
   path hasil resolve yang dikembalikan — executor sudah demikian); hardlink
   keluar workspace tak terdeteksi path-validation (butuh isolasi OS user —
   GAP-01 di `.arena/bootstrap/SECURITY_GAPS.md`).

## 6. Status Lifecycle & Catatan Orchestrator

- **Control Plane (Supabase)**: RPC `start_task` dicoba via
  `tools/orchestration/control_plane.py` → gagal environmental:
  `{'error': 'Missing Supabase URL or Service Key in configuration'}`
  (tidak ada `.env` di sandbox; agen dilarang memegang service key). Task
  sudah di-claim oleh orchestrator sesuai briefing; spesifikasi diambil dari
  source of truth lokal `task_manifest_catalog.py` (M10 §security/m10-fs-sandbox).
  **Bl blocker:** `submit_commit`/`record_test_result` ke Supabase harus
  dijalankan orchestrator dari host yang punya kredensial bridge.
- **Branch**: sesi Arena ini terkunci ke `arena/01a0ba48-n8n-rust-v-4`
  (aturan platform sesi). Branch task `security/m10-m10-fs-sandbox` dapat
  dibuat orchestrator sebagai pointer ke commit `459b25ed` (valid menurut
  `task_manager.parse_and_validate_branch`; `verify_commit_boundary` sudah
  hijau untuk SHA tersebut). Tidak ada merge ke `main` (PR-only workflow).

## 7. Handoff

Agent berikutnya (m10-env-isolation / m10-timeout-watchdog /
m10-prototype-pollution) cukup baca §3 untuk kontrak perilaku guard dan §5.1
untuk hook integrasi di executor. API publik yang stabil:
`FilesystemGuard(workspace_root, allowed_patterns, forbidden_patterns)`,
`validate_path(target: str, is_write: bool = True) -> Path`,
`SecurityError` (≡ `SecurityViolation`), self-test `python3 tools/arena-executor/fs_guard.py`.
