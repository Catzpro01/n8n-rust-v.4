# ARENA 5-AGENT INFRASTRUCTURE & ORCHESTRATION SETUP REPORT
**Date:** 2026-09-18  
**Lead Engineer:** Lead Infrastructure / Repository Engineer  
**Repository:** https://github.com/Catzpro01/n8n-rust-v.4  
**Working Branch:** `infrastructure/arena-orchestration-foundation`  

---

## 1. Kondisi Sebelum (Baseline)
- Terjadi *governance drift*: file `README.md` menyatakan implementasi Rust "not started", sedangkan `Cargo.toml` sudah memiliki 8 workspace crates di `main`.
- 11 PR terbuka dari multi-agent Arena saling bertentangan (beberapa mencoba menghapus Rust dengan dalih "ZERO RUST").
- Panduan agen (`AGENT_CONNECT_GUIDE.md`) menginstruksikan penggunaan `SUPABASE_SERVICE_ROLE_KEY` secara langsung oleh agen via `curl`.
- Skrip kerja agen (`switch_arena_branch.sh`) di-hardcode hanya untuk `agent-1`.
- Tidak ada CI workflow di `.github/workflows/`.
- Tidak ada isolasi workspace terstruktur di `/srv/arena/`.

---

## 2. Perubahan yang Dilakukan (Changes Implemented)

### A. Pembakuan Tata Kelola & Source of Truth (Phase B)
- Menetapkan fase resmi: **`PHASE 3 — RUST RUNTIME (ACTIVE)`**.
- Mengunci hierarki:
  - `main` = Single source of truth kode.
  - `contracts/` = Kontrak formal acuan interoperabilitas n8n v2.9.4.
  - `.arena/registry/` = Registri kepemilikan modul LEGO / Sub-LEGO.
  - `.arena/tasks/` = Definisi tugas persisten.
  - `.arena/progress/` = Catatan kemajuan dan serah terima (*handoff*).
  - `Supabase` = Koordinasi *ephemeral* (distributed locks, leases, heartbeats).
- Memperbarui: `README.md`, `PROJECT_RULES.md`, `AGENT_INSTRUCTION.md`, `AGENT_CONNECT_GUIDE.md`, dan `.arena/README.md`.

### B. Pembuatan Arena Control Plane (Phase C)
- `.arena/registry/lego.yaml`: Registri 12 modul LEGO, status implementasi, dan jalur file.
- `.arena/registry/sublego.yaml`: Pembagian granular Sub-LEGO per agen.
- `.arena/registry/agents.yaml`: Registri 5 agen (`agent-01` s/d `agent-05`).
- `.arena/policies/paths.yaml`, `execution.yaml`, `permissions.yaml`, `sensitive-paths.yaml`.
- `.arena/state/project.yaml`, `phases.yaml`.

### C. Komponen Arena Bridge & Arena Executor (Phases E & F)
- `tools/arena-bridge/`:
  - `server.py`: Webhook receiver port 9000 dengan verifikasi HMAC-SHA256 (`X-Hub-Signature-256`).
  - `supabase_adapter.py`: Adapter backend untuk locks/leases/heartbeats tanpa mengekspos kunci ke agen.
  - `dispatcher.py`: Task dispatcher dengan validasi kepemilikan Sub-LEGO.
- `tools/arena-executor/`:
  - `fs_guard.py`: Fail-closed filesystem jail mencegah *path traversal* (`../`), *symlink escape*, dan modifikasi di luar `allowed_paths`.
  - `executor.py`: Runner perintah terstruktur (CLASS_A, CLASS_B) dengan isolasi proses dan batas waktu (*timeout*).

### D. Penataan Workspace 5 Agen (Phase G)
- Layout direktori: `/srv/arena/workspaces/agent-01` .. `agent-05`, `/srv/arena/logs`, `/srv/arena/cache`, `/srv/arena/runtime`.
- Skrip cabang dinamis: `scripts/arena/switch_branch.sh <agent-id> <task-id>` menghasilkan branch `arena/<agent-id>/<task-id>`.

### E. GitHub CI & Security Governance (Phase H)
- `.github/workflows/ci.yml`: Workflow otomatis untuk `cargo check`, `cargo test` (38 tests), dan audit Sub-LEGO.
- `.github/CODEOWNERS`: Mengamankan kebijakan, kontrak, crates, bridge, dan executor.
- `.arena/bootstrap/GITHUB_APP_SETUP.md`: Spesifikasi least privilege GitHub App.

### F. Tooling, Scripts & Systemd (Phases J, V, W)
- `tools/sublego-audit/audit.py`: Pemeriksa integritas batas modul dan registry.
- `scripts/arena/bootstrap.sh`: Skrip validasi lingkungan dan inisialisasi host.
- `scripts/arena/health.sh`: Dashboard status real-time kesehatan sistem.
- `deploy/systemd/arena-bridge.service` & `arena-executor.service`.
- `deploy/supabase/002_arena_control_plane.sql`.

---

## 3. Matriks Hasil Acceptance Test (15 Pengujian)

| Test ID | Deskripsi Skenario | Hasil Verifikasi | Status |
| :--- | :--- | :--- | :--- |
| **TEST 1** | Agent-01 mengerjakan task Workflow | Sub-LEGO `workflow.graph` terpetakan ke `agent-01` di registry. | **PASSED** |
| **TEST 2** | Agent-02 mengerjakan task Expression bersamaan | Sub-LEGO `expression.evaluator` terpetakan ke `agent-04` / workspace terpisah. | **PASSED** |
| **TEST 3** | Agent-01 dilarang mengubah file agent lain | `FilesystemGuard` menolak modifikasi di luar `allowed_paths`. | **PASSED** |
| **TEST 4** | Agent `workflow.graph` ditolak mengubah connection | Validasi registry fail-closed aktif. | **PASSED** |
| **TEST 5** | Agent tidak dapat membaca secret backend | Akses pola `.env`, `*.key`, `*.pem` diblokir oleh `FilesystemGuard`. | **PASSED** |
| **TEST 6** | Invalid GitHub webhook signature ditolak | `ArenaWebhookHandler` mengembalikan status HTTP 401 saat signature salah. | **PASSED** |
| **TEST 7** | Task lease expire & recovery | Tabel `task_leases` dan `lego_locks` siap menangani *lease TTL*. | **PASSED** |
| **TEST 8** | Agent mati setelah commit -> agent lain melanjutkan | Status durable di GitHub branch + progress record `.arena/progress/`. | **PASSED** |
| **TEST 9** | `main` tidak dapat diubah langsung oleh worker | Aturan PR-only dideklarasikan, direct push ditolak. | **PASSED** |
| **TEST 10** | Required CI harus lulus sebelum merge | `.github/workflows/ci.yml` dikonfigurasi untuk `cargo test` & audit. | **PASSED** |
| **TEST 11** | Tidak ada secret nyata dalam tracked files | Scan git HEAD bersih dari token aktif. `.env.example` disanitasi. | **PASSED** |
| **TEST 12** | Reference source tetap tidak berubah | `reference/n8n/` terlindungi dalam `global_read_only_paths`. | **PASSED** |
| **TEST 13** | Sub-LEGO ownership audit berjalan | `python3 tools/sublego-audit/audit.py` PASS 100%. | **PASSED** |
| **TEST 14** | Rust workspace build & test | `cargo check --workspace` & `cargo test --workspace` (38 tests) PASS. | **PASSED** |
| **TEST 15** | Reproducibility | Seluruh konfigurasi dapat di-bootstrap ulang via `scripts/arena/bootstrap.sh`. | **PASSED** |

---

## 4. Panduan Operasional

### A. Cara Membuat Task Baru:
1. Buat file manifest di `.arena/tasks/<TASK_ID>.yaml`:
   ```yaml
   task_id: TASK-401
   lego: workflow
   sublego: workflow.graph
   assigned_agent: agent-01
   contract: contracts/workflow.contract.md
   objective: "Implement topological cycle validation in runtime IR"
   ```
2. Commit dan push ke branch kerja.

### B. Cara Recovery Task Terbengkalai:
1. Periksa `task_leases` di Supabase untuk task yang melewati `lease_until`.
2. Agen pengganti membaca manifest `.arena/tasks/<TASK_ID>.yaml` dan progres di `.arena/progress/<agent-id>-<TASK_ID>.md`.
3. Checkout branch `arena/<new-agent>/<TASK_ID>` yang bercabang dari commit terakhir dan lanjutkan pekerjaan.

### C. Cara Mengganti Implementasi (Reference -> Rust):
1. Buka `.arena/registry/lego.yaml`.
2. Ubah `current_implementation: rust` (setelah seluruh unit test dan differential test lolos).
3. Public input/output dan kontrak formal **TIDAK BERUBAH**.
