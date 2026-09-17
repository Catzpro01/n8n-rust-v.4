# N8N RECONSTRUCTION RULES (v2.9.4 NATIVE)

1. **ZERO RUST**: Rekonstruksi menggunakan JavaScript / TypeScript / Node.js murni 1:1 dari source code n8n v2.9.4 asli. Dilarang menulis kode Rust di `crates/` atau `apps/`.
2. **FRONTEND UI MUTLAK ASLI**: Antarmuka UI (Vue Canvas / editor-ui) dibiarkan 100% bawaan n8n resmi tanpa diubah sedikit pun.
3. **BACKEND DATA FLOW & MODULAR LEGO**: Yang direkonstruksi adalah struktur file, direktori LEGO di `packages/`, dan cara data masuk/keluar.
4. **OTONOM & NON-BLOCKING (DILARANG BERTANYA/MENUNGGU)**:
   - Agen dilarang berhenti untuk meminta izin atau konfirmasi tugas.
   - Ambil task berikutnya di `dynamic_task_pool` segera setelah menyelesaikan tugas sebelumnya.
5. **Setiap modul wajib memiliki boundary jelas dan kontrak formal** (`contracts/*.contract.md`).
6. **Setiap perubahan wajib lolos pengujian regresi.**
7. **Branch `main` selalu berstatus runnable dan production-ready.**

---

## Agent Operational Scope (5 Agen Setara)
- **Agent 1**: `workflow` (DAG Graph, Stack, Execution flow di `packages/workflow`)
- **Agent 2**: `node` (Node catalog, loader, registry di `packages/nodes-base`)
- **Agent 3**: `connection` (Pin connection routing, slot validation di `packages/core`)
- **Agent 4**: `expression` (Expression evaluator `{{ ... }}`, variable proxy scoping)
- **Agent 5**: `persistence` (Run data hooks, execution logger, database state)

## Siklus LEGO
```text
DISCOVERED ──► ISOLATED ──► CONTRACTED ──► IMPLEMENTED (NODE.JS/TS) ──► VERIFIED ──► INTEGRATED
```
