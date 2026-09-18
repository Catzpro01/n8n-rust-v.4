# N8N RECONSTRUCTION RULES (HYBRID RUST ENGINE & NATIVE v2.9.4)

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
