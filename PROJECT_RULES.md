# N8N RECONSTRUCTION RULES (HYBRID RUST ENGINE & NATIVE v2.9.4)

## 0. GOVERNANCE & SINGLE SOURCE OF TRUTH (P0 CONSTITUTION)
1. **CURRENT PHASE: PHASE 3 — RUST RUNTIME (ACTIVE)**: Proyek secara resmi telah menyelesaikan Phase 2 (Isolasi LEGO) dan beralih penuh ke Phase 3. Status implementasi Rust adalah **ACTIVE**, bukan "not started" atau "reserved".
2. **SINGLE SOURCE OF TRUTH**: Branch `main` adalah satu-satunya acuan kebenaran resmi. Seluruh agen dilarang membuat spekulasi atau mengasumsikan aturan di luar branch `main`. PR yang berupaya memaksakan rollback ke zero-Rust atau menyatakan Phase 3 belum dimulai otomatis **DITOLAK**.
3. **COMPATIBILITY BASELINE (n8n v2.9.4)**: Seluruh kontrak formal (`contracts/*.contract.md`) dan behavioral reference n8n v2.9.4 tetap dipertahankan 100% sebagai compatibility baseline untuk menjamin interoperabilitas mutlak.
4. **LEGO ADALAH DEVELOPMENT BOUNDARY, BUKAN RUNTIME OVERHEAD**: Dekomposisi LEGO berfungsi sebagai batas arsitektur & kepemilikan modul saat development. Pada runtime execution hot-path, engine TIDAK BOLEH memecah eksekusi menjadi lapisan IPC atau serialisasi JSON antar-crate. Runtime menggunakan unified kernel dengan representasi minimal/zero-copy.
5. **FEATURE & NODE FREEZE**: Penambahan node eksekusi baru atau ekspansi fitur DIBEKUKAN sementara sampai spesifikasi arsitektur Kernel Runtime IR (P1: `ExecutionContext`, `ExecutionFrame`, `NodeExecutor`, Data Plane) disepakati dan diimplementasikan.

## 1. ATURAN REKONSTRUKSI INTI
1. **RUST NATIVE EXECUTION NODES**: Seluruh node eksekusi n8n resmi diimplementasikan dalam Rust native via crate `crates/n8n-nodes-rust/` menggunakan `N8nNode` trait. Tujuannya adalah performa sub-millisecond, hemat memori hingga 90%, dan type safety mutlak.
2. **CORE WORKFLOW & ORCHESTRATOR COMPATIBILITY**: Core Workflow Orchestrator, DAG Graph, dan plugin loader tetap mempertahankan kompatibilitas 1:1 dengan arsitektur n8n v2.9.4 asli.
3. **FRONTEND UI MUTLAK ASLI**: Antarmuka UI (Vue Canvas / editor-ui / Micro-Frontend Web Components) dibiarkan 100% bawaan n8n resmi tanpa diubah pixel-nya sedikit pun. Metadata parameter node diekspor dalam format JSON `INodeProperties` standar n8n.
4. **OTONOM & NON-BLOCKING (DILARANG BERTANYA/MENUNGGU)**:
   - Agen dilarang berhenti untuk meminta izin atau konfirmasi tugas.
   - Ambil task berikutnya di `tasks` Supabase segera setelah menyelesaikan tugas sebelumnya.
5. **Setiap modul wajib memiliki boundary jelas dan kontrak formal** (`contracts/*.contract.md`).
6. **Setiap perubahan wajib lolos pengujian regresi.**
7. **Branch `main` selalu berstatus runnable dan production-ready.**

---

## Pembagian Skuad 20 Agen:
- **Skuad A (Agent 1 - 4)**: Workflow Core & Visual Canvas Navigation
- **Skuad B (Agent 5 - 8)**: Rust Native Nodes & Engine Specialists (`crates/n8n-nodes-rust/`)
- **Skuad C (Agent 9 - 12)**: Connection Graph, Webhook & AI Agent Hub
- **Skuad D (Agent 13 - 16)**: Expression Sandbox & Execution Data Pipeline
- **Skuad E (Agent 17 - 20)**: Contract Governance, Zero Leak & Release Gatekeeper
