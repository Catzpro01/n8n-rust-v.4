# Phase A-Gate — Authoritative Architecture & Execution Specification

Dokumen ini memfinalisasi seluruh batas tanggung jawab, pemetaan spesialisasi, status migrasi database, kebijakan keamanan runner, dan aturan transisi deterministik sebelum Phase B dieksekusi pada repositori `Catzpro01/n8n-rust-v.4`.

---

## 1. Verifikasi Status Canonical Migration

### A. Asal-Usul File Migrasi
* **Path**: `supabase/migrations/20260919000000_arena_orchestration_control_plane.sql`
* **Sejarah Commit**:
  - Dibuat pada commit `c523bf83`: `feat(orchestration): implement Arena x GitHub x Supabase x Laptop architecture and atomic state transition contract`.
  - Diperbarui pada commit `94ca1490`: `feat(orchestration): align control plane, bridge, cleanup pipeline, and invariants test suite with master contract`.
* **Kandungan Skema**: 10 tabel kanonik (`specializations`, `agents`, `tasks`, `task_files`, `locks`, `build_jobs`, `test_results`, `audit_results`, `events`, `task_state_transitions`), 13 stored procedures atomic, OCC `version` pada entitas mutable, dan conditional upgrade block untuk tabel `locks` legacy.

### B. Status Penerapan di Database Supabase Aktual
Berdasarkan probe langsung terhadap REST API Supabase:
* `specializations`: **HTTP 404 (Not Found)**
* `agents`: **HTTP 404 (Not Found)**
* `tasks`: **HTTP 200 (Existing Legacy Schema dari `docs/supabase_migration.sql`)**
* `locks`: **HTTP 200 (Existing Legacy Schema dengan PK `module TEXT`)**
* `agent_messages`: **HTTP 200 (Existing Legacy Schema)**
* `agent_status`: **HTTP 200 (Existing Legacy Schema)**
* `claim_task` RPC: **HTTP 404 (Not Found)**

> [!IMPORTANT]
> **KESIMPULAN AUDIT MIGRATION**:
> File migrasi kanonik di repositori **BELUM DIEKSEKUSI / BELUM DITERAPKAN (STATUS: NOT APPLIED)** ke instance database Supabase. Database saat ini masih berjalan di atas skema legacy 5-agent.
> Deployment migrasi ke Supabase production **wajib dilaksanakan sebagai langkah pertama pada Phase B**.

---

## 2. Freeze Canonical Specializations (10 Spesialisasi Tetap)

Daftar 10 spesialisasi domain dikunci (*frozen*). Dilarang menambah spesialisasi di luar daftar ini tanpa persetujuan:

| Slug | Nama Resmi | Tujuan & Scope | Typical Paths | Access Boundary |
| :--- | :--- | :--- | :--- | :--- |
| `runtime-kernel` | Runtime Kernel | WorkflowRunner loop, DAG lowering, execution frames, memory governor enforcement | `crates/n8n-workflow/src/runtime/**` | **Exclusive** untuk runner/frames |
| `execution-engine` | Execution Engine | Scheduler, lifecycle coordination, flow dispatch, loop iterations, node status | `crates/n8n-workflow/src/runtime/executor.rs`, scheduler | **Exclusive** untuk execution logic |
| `data-plane` | Data Plane | Minimal-copy ItemBuffer, DataRecord, binary streaming, payload buffers | `crates/n8n-execution-data/**` | **Exclusive** untuk buffer memory |
| `memory` | Memory Management | Memory budget, spill-to-disk, backpressure, atomic heap governor | `crates/n8n-workflow/src/runtime/memory.rs` | **Exclusive** untuk governor |
| `node-system` | Node System | Native Rust node implementations (Set, If, Code), trait adapters | `crates/n8n-nodes-rust/**`, `crates/n8n-node-model/**` | **Exclusive** per node file |
| `workflow-model` | Workflow Model | Workflow JSON deserialization, connections graph, node metadata | `crates/n8n-workflow/src/lib.rs`, `connections.rs` | **Shared-Read** core model |
| `expression-engine` | Expression Engine | Sandboxed expression parser, AST evaluator, JS compatibility | `crates/n8n-expression/**` | **Exclusive** evaluator AST |
| `validation` | Validation & Integrity | DAG cycle detection, uniqueness, dangling connection validation | `crates/n8n-validation/**` | **Exclusive** validator rules |
| `integration` | Integration & Conformance| Cross-crate conformance tests, golden replay, reference parity | `tests/**`, `packages/reconstructed-engine/**` | **Shared** across integration |
| `security` | Security & Sandbox | Prototype pollution guard, resource isolation, environment guard | `tools/arena-executor/fs_guard.py` | **Exclusive** security bounds |

---

## 3. Actor Authorization Matrix

Setiap operasi pada Control Plane hanya boleh dipanggil oleh entitas terotorisasi:

| Operation | ARENA_AGENT | GITHUB_ACTION | BUILD_WORKER | AUDIT_WORKER | CLEANUP_WORKER | ANTIGRAVITY | SYSTEM |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `claim_task` | **YES** | NO | NO | NO | NO | NO | **YES** |
| `start_task` | **YES** | NO | NO | NO | NO | **YES** | **YES** |
| `submit_commit` | **YES** | NO | NO | NO | NO | **YES** | **YES** |
| `record_build_result` | NO | **YES** | **YES** | NO | NO | **YES** | **YES** |
| `record_test_result` | NO | **YES** | **YES** | NO | NO | **YES** | **YES** |
| `record_audit_result` | NO | **YES** | NO | **YES** | NO | **YES** | **YES** |
| `authorize_merge` | NO | NO | NO | NO | NO | **YES** | **YES** |
| `record_merge` | NO | **YES** | NO | NO | NO | **YES** | **YES** |
| `start_cleanup` | NO | NO | NO | NO | **YES** | **YES** | **YES** |
| `complete_cleanup` | NO | NO | NO | NO | **YES** | **YES** | **YES** |
| `acquire_file_lock` | **YES** | NO | NO | NO | NO | **YES** | **YES** |
| `release_file_lock` | **YES** | NO | NO | NO | NO | **YES** | **YES** |
| `reap_expired_leases` | NO | NO | NO | NO | NO | **YES** | **YES** |

---

## 4. Status Klasifikasi Artefak Legacy

| Path | Current Status | Replacement | Referenced? | Executable? | Safe to Delete? | Reason |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `docs/supabase_migration.sql` | **RETAIN_REFERENCE** | `supabase/migrations/20260919000000...` | Tidak | Ya (SQL) | **TIDAK** | Dipertahankan sebagai arsip skema legacy 5-agen |
| `deploy/supabase/002_arena_control_plane.sql` | **RETAIN_REFERENCE** | `supabase/migrations/20260919000000...` | Tidak | Ya (SQL) | **TIDAK** | Dipertahankan sebagai arsip koordinasi lama |
| `.arena/registry/agents.yaml` | **DEPRECATE** | Supabase `agents` table | Ya (audit lama)| Data | **TIDAK** | Perlu migrasi sebelum dihapus pada fase akhir |
| `.arena/tasks/*.yaml` | **DEPRECATE** | `.arena/TASK.md` | Ya (bridge lama)| Data | **TIDAK** | Fallback manifest legacy |
| `deploy/systemd/*` | **DEPRECATE** | Laptop runner service | Tidak | Ya (Linux) | **TIDAK** | Artefak VPS, diabaikan di Windows |
| `scripts/arena/*` | **DEPRECATE** | `tools/orchestration/*` | Tidak | Ya (Bash) | **TIDAK** | Skrip bash VPS lama |
| `switch_arena_branch.sh` | **DEPRECATE** | Git standard CLI | Tidak | Ya (Bash) | **TIDAK** | Skrip switch agent lama |
| `.github/workflows/ci.yml` | **RETAIN_REFERENCE / DEPRECATE** | 4 Modular Workflows | GitHub Actions | Ya (CI) | **TIDAK** | Menjaga kompatibilitas required checks GitHub |

---

## 5. Verifikasi Keamanan Migrasi CI (`ci.yml`)

1. **Required Status Checks GitHub**:
   Workflow lama mendefinisikan job:
   - `Rust Workspace Build & Unit Tests` (id: `rust-gates`)
   - `Sub-LEGO Boundary & Ownership Audit` (id: `sublego-governance-audit`)
   - `Arena Sub-LEGO Isolation & Security Enforcement Gates` (id: `arena-isolation-gates`)
2. **Kesesuaian Workflow Baru**:
   - `validation.yml` mencakup Level 0 (Formatting, `cargo check --workspace`) dan Level 1.
   - `integration.yml` mencakup Level 2 (`cargo test --workspace`, Node.js conformance).
   - `audit.yml` mencakup audit arsitektur dan boundary.
3. **Aturan Migrasi**:
   `.github/workflows/ci.yml` **TIDAK DIHAPUS** selama Phase A/B. File diklasifikasikan sebagai `RETAIN_REFERENCE / DEPRECATE` agar tidak memutuskan status check jika repositori remote memiliki branch protection yang mewajibkan status check dari `ci.yml`.

---

## 6. Laporan Audit Keamanan Rahasia (Secret Audit)

Pemeriksaan komprehensif terhadap seluruh tracked files, untracked files, Git history, dan workflow:

| Kategori Pemeriksaan | Status Penemuan | Status Tracking | Status Eksposur | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| `SUPABASE_SERVICE_ROLE_KEY` | FOUND | **UNTRACKED** | **NOT EXPOSED** | Nilai hanya ada di local `.env` (di-ignore oleh `.gitignore`) |
| `.env` / `.env.*` | FOUND (Local) | **UNTRACKED** | **NOT EXPOSED** | Terdaftar aman di baris 6-7 `.gitignore` |
| `.env.example` | FOUND | **TRACKED** | **NOT EXPOSED** | Hanya memuat placeholder template tanpa secret riil |
| GitHub Workflows | FOUND | **TRACKED** | **NOT EXPOSED** | Menggunakan variabel aman `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}` |
| Python Scripts | FOUND | **TRACKED** | **NOT EXPOSED** | Membaca via `os.environ` atau file lokal `.env` |
| Git History (`git log -S`) | FOUND (Name only) | **TRACKED** | **NOT EXPOSED** | 5 commit menyentuh nama variabel, tidak ada token riil yang bocor |
| JWT Tokens (`eyJh...`) | FOUND (Mock only) | **TRACKED** | **NOT EXPOSED** | Hanya mock fixture di upstream n8n playwright test fixtures |

**Hasil Akhir Secret Safety Audit**: **PASS (NOT EXPOSED)**.

---

## 7. Windows Laptop Runner Contract

* **Operating System**: Windows 11 Pro 64-bit (x64).
* **Rust Toolchain**: `stable-x86_64-pc-windows-gnu` (rustc 1.90+, cargo 1.90+).
* **Linker Strategy**: Internal LLVM LLD (`linker = "rust-lld"` di `.cargo/config.toml`) menghindari dependensi pada MSVC `link.exe`.
* **Node.js Runtime**: Node.js v22.x LTS.
* **Runner Labels**: `[ self-hosted, windows, x64, rust-build, n8n-rust ]`.
* **Path Strategy**: Resolusi path dinamis relatif terhadap file (`Path(__file__).resolve()`), **tanpa hardcoded Windows absolute paths**.
* **Runner Security Gate**: Menolak PR eksternal fork:
  `if: github.event.pull_request.head.repo.full_name == github.repository || github.event_name == 'push'`.

---

## 8. Schema Deterministik `.arena/TASK.md` (15 Field Kanonik)

Setiap task branch wajib memuat file `.arena/TASK.md` dengan struktur 15 field yang diparsing secara deterministik oleh regex/parser tanpa interpretasi AI:

```text
TASK_KEY: <string>
SPECIALIZATION: <one of 10 frozen specializations>
MILESTONE: <e.g. M1>
TITLE: <short title>
DESCRIPTION: <detailed task objective>
BASE_COMMIT_SHA: <40-char git commit SHA>
BRANCH: <canonical branch string>
OWNER: <agent UUID or placeholder>
FILES_IN_SCOPE: <bulleted list of paths>
FILES_EXCLUSIVE: <bulleted list of exclusive paths>
FILES_READ_ONLY: <bulleted list of shared-read paths>
DEPENDENCIES: <bulleted list of dependent task keys or None>
ACCEPTANCE_CRITERIA: <bulleted list of concrete deliverables>
VALIDATION_LEVEL: <LEVEL_0 | LEVEL_1 | LEVEL_2 | LEVEL_3>
EXPECTED_OUTPUT: <exact deliverable expectation>
```

---

## 9. Branch Parser Contract

* **Exact Regex**: `^([a-z0-9\-]+)/([a-z0-9]+)-([a-z0-9\-]+)$`
* **Contoh Valid**:
  - `runtime-kernel/m1-runner` -> spec=`runtime-kernel`, milestone=`m1`, task=`runner`
  - `data-plane/m1-streaming-buffer` -> spec=`data-plane`, milestone=`m1`, task=`streaming-buffer`
  - `expression-engine/m2-ast-parser` -> spec=`expression-engine`, milestone=`m2`, task=`ast-parser`
* **Contoh Invalid (DITOLAK KERAS)**:
  - `agent-1/m1-runner` (Memuat agent ID)
  - `arena/agent-01/task-201` (Pola legacy)
  - `runtime-kernel` (Tanpa milestone dan task)
  - `main` / `master` (Permanent branch)
* **Normalization**: Lowercase, tanda hubung `-` sebagai pemisah kata, slash `/` tunggal sebagai pemisah spesialisasi.
* **Collision Rules**: Jika nama branch sudah ada di remote, generator wajib menolak pembuatan branch ganda.

---

## 10. Cleanup & Resource Release Contract

Kondisi wajib sebelum remote task branch dan local workspace dihapus:
1. `tasks.status == 'POST_MERGE_VERIFY'`.
2. PR telah berstatus `merged == true`.
3. Merge commit terverifikasi ada pada riwayat Git branch `main`.
4. Level 0 & Level 1 checks pada `main` berstatus `PASS`.
5. Task tidak berstatus `BLOCKED`.
6. Worker memanggil RPC `start_cleanup` untuk mengunci kepemilikan transisi (mencegah double cleanup).
7. Remote branch dihapus via `git push origin --delete <branch>`.
8. Local clone workspace dihapus.
9. Worker memanggil RPC `complete_cleanup` untuk menghapus baris dari tabel `locks`, mengembalikan status agent ke `AVAILABLE`, dan menandai task sebagai `COMPLETED` (Terminal State).

---

## 11. E2E Observability Events (16 Lifecycle Events)

Setiap langkah dalam siklus pengerjaan task menghasilkan event idempotensial di tabel `events`:
1. `TASK_CREATED`
2. `TASK_CLAIMED`
3. `TASK_STARTED`
4. `COMMIT_PUSHED`
5. `PR_OPENED`
6. `BUILD_STARTED`
7. `BUILD_PASSED` (atau `BUILD_FAILED`)
8. `TEST_PASSED` (atau `TEST_FAILED`)
9. `AUDIT_STARTED`
10. `AUDIT_PASSED` (atau `AUDIT_FAILED`)
11. `MERGED`
12. `POST_MERGE_STARTED`
13. `POST_MERGE_PASSED`
14. `CLEANUP_STARTED`
15. `BRANCH_DELETED`
16. `TASK_COMPLETED`

Setiap event wajib memiliki `event_id` unik (misal: UUID atau `<delivery_id>:<event_type>`) untuk menjamin idempotensi eksekusi.