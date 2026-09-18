# INITIAL AUDIT REPORT — ARENA AI ORCHESTRATION & REPOSITORY INFRASTRUCTURE
**Date:** 2026-09-18  
**Repository:** https://github.com/Catzpro01/n8n-rust-v.4  
**Auditor:** Lead Infrastructure / Repository Engineer  
**Branch:** `infrastructure/arena-orchestration-foundation`  
**Host Environment:** VPS Ubuntu 24.04 (157.10.160.95), 2 GB RAM, 2 vCPU, 20 GB Disk  

---

## 1. Executive Summary
Repositori `n8n-rust-v.4` merupakan proyek rekonstruksi berperforma tinggi n8n ke Rust native dengan acuan perilaku n8n v2.9.4. Fondasi rekayasa balik (reverse-engineering) dan kontrak isolasi LEGO sangat matang. Namun, proyek ini mengalami *governance & orchestration drift* akibat multi-agent beroperasi tanpa kendali terpusat:
- **Dokumentasi & Status**: Telah dikoreksi pada commit `56dd3c2a` menjadi `PHASE 3 — RUST RUNTIME (ACTIVE)`.
- **Open PRs**: Terdapat 11 PR terbuka dari berbagai agen (PR #14–#24) yang saling bertentangan (sebagian mengklaim "ZERO RUST" dari sisa fase 2, sebagian mengimplementasikan Rust).
- **Infrastruktur VPS**: Layanan `arena-gateway.service` (port 9000) menerima webhook dari Nginx (`/github/webhook`), namun logika isolasi workspace dan eksekusinya masih berupa skrip primitif (`server.py`) dan belum memiliki security boundary yang ketat.
- **Kredensial**: Panduan lama (`AGENT_CONNECT_GUIDE.md`) mengarahkan agen untuk mengakses Supabase Service Role Key secara langsung. Hal ini melanggar prinsip *least privilege*.

---

## 2. Audit Komponen & Struktur Repositori

| Komponen / Direktori | Status Saat Ini | Temuan Audit |
| :--- | :--- | :--- |
| `main` Branch | STABLE / GREEN | 8 crates workspace (`crates/n8n-*`) lolos kompilasi & passing 38 tests + conformance fixtures. |
| `reference/n8n/` | PINNED (2.9.4) | Read-only behavioral reference (commit `b6dc2787c456`). Tidak ada modifikasi ilegal. |
| `contracts/` | 16 Kontrak | Kontrak formal (`workflow`, `node`, `connection`, `validation`, dll.) valid sebagai compatibility baseline. |
| `crates/` (8 crates) | Phase 3 Active | `n8n-common`, `n8n-workflow`, `n8n-connection`, `n8n-validation`, `n8n-node-model`, `n8n-execution-data`, `n8n-expression`, `n8n-nodes-rust`. |
| `packages/` | LEGO Isolation | `workflow-lego` dan `reconstructed-engine`. Menguji kesesuaian reference JavaScript. |
| `tools/` | Gates & Digest | Tool isolasi: `workflow-boundary-map.mjs`, `model-digest.mjs`, `workflow-isolation-gate.mjs`. |
| `tasks/` & `results/` | Flat Files | Berisi manifest historis (`TASK-20x`, `TASK-30x`) dan 117 file result. Perlu diorganisir ke `.arena/`. |
| `.github/workflows/` | **TIDAK ADA** | Belum ada CI otomatis di GitHub Actions untuk memvalidasi PR sebelum merge. |

---

## 3. Audit Infrastruktur Host & VPS

- **Resource Profiling**:
  - RAM Total: 1967 MB (Free: ~244 MB, Buffer/Cache: ~1315 MB, Swap: 2047 MB).
  - CPU: 2 vCPU.
  - Disk: 19 GB (/dev/vda1), terpakai 13 GB (71%), sisa 5.4 GB.
- **Jaringan & Reverse Proxy (Nginx)**:
  - Nginx aktif mendengarkan port 80.
  - Endpoint `/github/webhook` di-proxy ke `http://127.0.0.1:9000`.
  - Endpoint root `/` di-proxy ke port 5678 (n8n instance).
- **Layanan yang Berjalan (`arena-gateway.service`)**:
  - Menjalankan `/home/fern/arena/gateway/server.py` di bawah user `fern`.
  - Menggunakan SQLite internal (`/home/fern/arena/bus.db`).
  - Belum memiliki verifikasi signature webhook yang aman dan belum memvalidasi batas path eksekusi agen secara ketat.

---

## 4. Audit State & Supabase

Database Supabase (`https://gqctxugkxekdqxsaqrum.supabase.co`) memiliki 9 tabel aktif:
1. `tasks`
2. `agent_tasks`
3. `agent_status`
4. `agent_messages`
5. `agent_execution_logs`
6. `agent_dependencies`
7. `dynamic_task_pool`
8. `task_consensus_votes`
9. `locks`

**Temuan Kritis Supabase**:
- `AGENT_CONNECT_GUIDE.md` membocorkan instruksi bagi agen untuk memakai `SUPABASE_SERVICE_ROLE_KEY` langsung via `curl`.
- Agen worker seharusnya **TIDAK** memegang kredensial Supabase backend. Supabase murni dikelola oleh backend VPS (Arena Bridge), sedangkan agen hanya berinteraksi melalui GitHub repository dan workspace executor.

---

## 5. Security & Architectural Gaps yang Harus Dibereskan Segera

1. **Eliminasi Credential Leak ke Agent**:
   - Rotasi dan isolasi seluruh kunci Supabase di level VPS backend (`.env` terlindungi).
   - Hapus instruksi `SUPABASE_KEY` dari panduan agen (`AGENT_CONNECT_GUIDE.md`).
2. **Karantina 11 Open PR**:
   - PR yang berusaha memaksakan "ZERO RUST" (misal PR #16, #19, #21, #22) bertentangan dengan Phase 3 Active dan harus ditutup/direkonsiliasi.
3. **Penyatuan Workspace 5 Agen**:
   - Membangun isolasi direktori terstruktur di `/srv/arena/workspaces/agent-01` s/d `agent-05`.
   - Mengubah skrip `switch_arena_branch.sh` agar dinamis (`arena/<agent-id>/<task-id>`).
4. **Implementasi CI & Branch Protection**:
   - Menambahkan `.github/workflows/ci.yml` untuk menjalankan `cargo check`, `cargo test`, dan validasi isolasi LEGO.
   - Menyiapkan spesifikasi GitHub App dengan permission sempit (*least privilege*).
5. **Pembangunan Arena Bridge & Arena Executor Terstruktur**:
   - `tools/arena-bridge/`: Verifikasi webhook GitHub (HMAC-SHA256), koordinasi lock/lease Supabase, dan task dispatcher.
   - `tools/arena-executor/`: Eksekutor deterministik fail-closed dengan validasi `allowed_paths` vs `forbidden_paths`.

---

## 6. Jadwal Eksekusi Roadmap (Phases B - M)
1. **Phase B**: Update Single Source of Truth governance (`.arena/README.md`, `PROJECT_RULES.md`, dll.).
2. **Phase C**: Pembuatan `.arena/` registry (`lego.yaml`, `sublego.yaml`, `agents.yaml`) dan policy paths.
3. **Phase D**: Standarisasi skema database Supabase untuk leases, locks, dan recovery.
4. **Phase E & F**: Implementasi `tools/arena-bridge/` dan `tools/arena-executor/`.
5. **Phase G - M**: Workspace setup 5 agen, CI protection, recovery testing, dan final verification.
