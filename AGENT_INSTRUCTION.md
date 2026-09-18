# PETUNJUK OPERASIONAL ARENA AGENT (PHASE 3 RUST RUNTIME)

## Status Proyek Resmi:
- **CURRENT_PHASE**: `PHASE_3_RUST_RUNTIME` (ACTIVE)
- **Status Rust**: ACTIVE (Workspace 8 crates di `crates/` aktif dan tervalidasi).
- **Source of Truth**: 
  - Kode & Kontrak: GitHub `main` dan `contracts/`
  - Registry & Task: `.arena/registry/` dan `.arena/tasks/`
  - Kemajuan & Bukti: `.arena/progress/`
  - Koordinasi & Lock: Supabase (via Arena Bridge backend)

---

## 1. Aturan Dasar Pengembangan (Fail-Closed)
1. **Dilarang Direct Push ke `main`**: Seluruh pekerjaan dilakukan di branch terisolasi: `arena/<agent-id>/<task-id>`.
2. **Kepatuhan Terhadap LEGO & Sub-LEGO Registry**:
   - Agen hanya boleh memodifikasi file di dalam `allowed_paths` milik sub-LEGO yang ditugaskan.
   - Modifikasi di luar kepemilikan (`forbidden_paths`) otomatis ditolak oleh executor.
3. **Penyimpanan Status Berkelanjutan (Durable Handoff)**:
   - Catat kemajuan, bukti pengujian, dan riwayat di `.arena/progress/<agent-id>-<task-id>.md`.
   - Agen pengganti atau sesi baru cukup membaca berkas progress tersebut untuk melanjutkan pekerjaan tanpa membaca ulang seluruh codebase.
4. **Keamanan Kredensial**:
   - Agen dilarang mengakses kredensial `SUPABASE_SERVICE_ROLE_KEY` atau master token.
   - Semua operasi database dan eksekusi dilayani secara terkendali melalui Arena Bridge & Executor.

---

## 2. Siklus Hidup Tugas (Sessionless Lifecycle):
1. **Claim & Lock**: Dapatkan tugas dari `.arena/tasks/<task-id>.yaml`. Bridge mencatat *lease* dan *lock* di Supabase.
2. **Workspace & Branch**: Pindah ke workspace terisolasi `/srv/arena/workspaces/<agent-id>` dan checkout branch `arena/<agent-id>/<task-id>`.
3. **Eksekusi & Uji Mandiri**:
   - Ubah kode sesuai kontrak interface n8n 2.9.4.
   - Jalankan `cargo check` dan `cargo test` atau conformance test terkait.
4. **Catat Progress & Commit**:
   - Tulis log eksekusi dan hasil test ke `.arena/progress/<agent-id>-<task-id>.md`.
   - Commit dengan format terstruktur: `feat(<lego>): <deskripsi tugas>`.
5. **Push & Buat PR**:
   - Push branch `arena/<agent-id>/<task-id>` ke remote GitHub.
   - Buka Pull Request ke `main`.
   - Setelah lolos CI checks, rilis lock melalui Bridge.
