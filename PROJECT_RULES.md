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

---

## Amandemen Fase Proyek (Ratifikasi Phase 3 Gateway)
1. **Pemisahan Jalur Rekonstruksi (Dual-Track Architecture)**:
   - **Jalur Utama Node.js / TypeScript (`packages/*`)**: Tetap wajib mematuhi **ZERO RUST** 100% murni tanpa dependensi native Rust. Rekonstruksi logika eksekusi n8n v2.9.4 harus murni JS/TS.
   - **Jalur Porting Paralel (`crates/*`)**: Resmi dibuka pada **Phase 3** (diaktifkan oleh keberadaan `[workspace]` manifest pada root `Cargo.toml` sesuai `docs/isolation/phase3-gate-mode.md`). Crate Rust di `crates/` diuji secara terisolasi via offline rig / `cargo test` tanpa mengontaminasi runtime Node.js.
2. **Kepatuhan Gate & Conformance**:
   - Harness `contract_conformance.mjs` dan `boundary_audit.py` beroperasi dalam mode Phase 3 saat `[workspace]` aktif di `Cargo.toml` (Stage 1: 43/43 PASS, Stage 2: PASS, Stage 2b: FRESH EVIDENCE PASS, Stage 2c: 7/7 crates PASS).
3. **Frontend UI Mutlak Asli**:
   - Seluruh aset, Vue Canvas SPA, CSS, dan file di `packages/editor-ui` tetap **100% bawaan resmi n8n tanpa perubahan sedikit pun**.

