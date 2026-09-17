# TASK RESULT: TASK-405-connection-members

- **STATUS**: `SUCCESS`
- **PEKERJA**: `agent-1` (branch `arena/01a0ace4-n8n-rust-v-4`)
- **PERAN SESAAT (ROLE)**: Rust port owner — Workflow LEGO (Phase 3)
- **RINGKASAN INTI**: Menyelesaikan serah terima agent-3 (`connection-workflow-members-spec.md`): tiga anggota `wf.*` di-porting setia — `get_node_connection_indexes` (workflow.ts:746-807), `get_parent_nodes_by_depth`/`searchNodesBFS` (:620-685), `get_parent_main_input_node` (:687-743, jalur early-return yang dipin fixture; pendakian penuh menunggu registry CD-05). Ditemukan & diperbaiki satu divergensi: peta tujuan mem-padding slot dengan `null`, padahal oracle mem-padding `[]` (dipin probe `byDest End`). Probe runner baru mengeksekusi 34 dari 46 probe golden `tests/reference/connection/*`; 12 sisanya berada di daftar SKIP eksplisit milik Connection LEGO (graph-utils.ts, agent-3) — tanpa silent skip.
- **BUKTI MESIN (EVIDENCE)**:
  - `cargo test --workspace` → **47 passed / 0 failed** (termasuk `connection_golden_probes_match_the_pinned_runtime`: 34 executed + 12 tracked skips = 46 total, asserted)
  - Probe yang membuktikan fidelitas: `Merge <- Loop indexes` → `{sourceIndex:0, destinationIndex:1}` (BFS melalui siklus), `parents by depth of Merge` → `IF.indicies = [1,0]` (merge dedupe pada objek ter-emit), `byDest End` → `[[Loop],[],[Sparse]]` (padding `[]`)
  - Divergensi yang ditangkap fixture lalu diperbaiki: (1) nama field wire `source_index` → `sourceIndex`, (2) kedalaman emit pakai depth entri antrean, bukan level loop (off-by-one)
  - `bash tests/integration/run_gate.sh --offline-only` → offline PASS, live NOT RUN (INCONCLUSIVE — tidak ada host live di sandbox)

---

## Catatan kepatuhan protokol (STANDING-WORKER-PROTOCOL)

- **allowed_paths**: `crates/n8n-workflow/**`, `tests/reference/connection/**`, results/tasks ini, dan entri ISSUE-018 di CROSS-AGENT-ISSUES.md — tidak ada path lain yang disentuh. `forbidden_paths` dihormati (reference/, contracts/, crates/n8n-connection/src/lib.rs tidak diubah).
- **Oracle**: setiap anggota diverifikasi langsung ke `reference/n8n/packages/workflow/src/workflow.ts` sebelum dikode; ekspektasi berasal dari fixture agent-3 yang dipin terhadap runtime 2.9.4, bukan dari kode Rust.
- **2 temuan di jalur sendiri** (tercatat agar tidak senyap): destination-padding `null`→`[]`, dan wire-name/kedalaman pada dua anggota baru — semuanya ditangkap oleh probe runner pada run pertama, lalu diperbaiki.
