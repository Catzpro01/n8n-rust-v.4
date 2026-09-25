> **DEC-0017 (berlaku):** Arena adalah runtime agent, branch `arena/agent-NN` adalah workspace agent,
> dan `.arena/task.md` di branch agent adalah satu-satunya otoritas task agent tersebut. Mulai dari
> `.arena/RULES.md`, `.arena/AGENT_RULES.md`, `.arena/MANAGER_RULES.md` dan `.arena/WORKFLOW.md`.
> Bagian di bawah yang menyebut Supabase lease/heartbeat, Arena Bridge & Executor, pola branch
> `arena/<agent-id>/<task-id>` atau PR langsung oleh agen adalah catatan historis dan tidak lagi berlaku.
> `.arena/tasks/` dan `.arena/progress/` di `main` adalah arsip historis.

# ARENA CONTROL PLANE & GOVERNANCE ARCHITECTURE

## 1. Single Source of Truth Hierarchy
Untuk mencegah desinkronisasi dan konflik multi-agent, hierarki kebenaran proyek ditetapkan secara mutlak:

1. **GitHub `main` Branch**: Satu-satunya kebenaran kode yang telah tervalidasi, lolos CI, dan berstatus runnable. Tidak menerima *direct push* dari agen worker.
2. **`contracts/`**: Sumber kebenaran kontrak formal (API, perilaku, input/output, boundary). Reference n8n v2.9.4 dipertahankan sebagai acuan kompatibilitas.
3. **`.arena/registry/`**: Sumber kebenaran kepemilikan modul, batas akses (allowed/forbidden paths), dependensi, dan status implementasi LEGO / Sub-LEGO.
4. **`.arena/tasks/`**: Definisi tugas tahan lama (*durable task manifests*).
5. **`.arena/progress/`**: Catatan kemajuan, milestone, bukti pengujian, dan riwayat serah terima (*handoff records*).
6. **Supabase (Ephemeral / Coordination State Layer)**: Lapisan koordinasi sementara dan waktu-nyata untuk:
   - Distributed Locks (`locks` / `lego_locks`)
   - Task Leases & Ownership (`task_leases`)
   - Agent Heartbeats & Liveness (`agent_status` / `heartbeats`)
   - Run Execution Logs & Telemetri (`execution_runs`)
   *Catatan: Supabase BUKAN source of truth untuk kode sumber.*
7. **`reference/n8n/`**: Acuan perilaku murni n8n v2.9.4 yang bersifat *READ-ONLY* (hash-pinned).

---

## 2. Status Proyek & Siklus Hidup
- **Current Phase**: `PHASE_3_RUST_RUNTIME` (ACTIVE).
- **Rust Status**: ACTIVE (8 member workspace di `crates/` aktif dikembangkan).
- **Aturan Transisi**: Migrasi dilakukan per LEGO/Sub-LEGO. Interface dan I/O publik tidak berubah saat implementasi internal beralih dari TypeScript/Reference ke Rust.
- **LEGO Boundary vs Runtime**: LEGO adalah batasan isolasi pengembangan (*development boundary*). Runtime hot-path adalah *unified shared host* tanpa overhead serialisasi JSON / IPC berulang antar-lapisan.

---

## 3. Protokol Pekerja Arena (Worker Security Policy)
1. **No Privileged Keys**: Agen worker dilarang meminta atau memegang `SUPABASE_SERVICE_ROLE_KEY` atau master GitHub PAT. Seluruh koordinasi backend diproses melalui **Arena Bridge & Executor**.
2. **Namespace Cabang & Workspace**:
   - Agen: `agent-01`, `agent-02`, `agent-03`, `agent-04`, `agent-05`.
   - Pola Branch: `arena/<agent-id>/<task-id>` (contoh: `arena/agent-01/TASK-001`).
   - Workspace Terisolasi: `/srv/arena/workspaces/<agent-id>/`.
3. **PR-Only Workflow**: Pekerjaan agen hanya dapat digabungkan ke `main` melalui Pull Request setelah lolos CI regression gates.
