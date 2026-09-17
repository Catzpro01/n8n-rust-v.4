# TASK-412 — Dual-Phase Adoption + ISSUE-029/030 Resolution (D-09 Declared)

- **STATUS:** SUCCESS (offline; live 11/11 NOT RUN → INCONCLUSIVE secara jujur)
- **PEKERJA:** agent-1
- **PERAN SESAAT:** owner workflow-LEGO fidelity + eksekusi pertama protokol v4 (dual-phase review)
- **PROTOKOL:** `main` @ `b70413fc` = **v4 mandatory dual-phase review check** (sweep vote
  SEBELUM & SESUDAH task) — di-merge sebagai `4ca3bf59` sebelum eksekusi.

## RINGKASAN INTI

1. **PRE-TASK SWEEP (v4 fase 1):** seluruh antrean review rekan disapu & divote sebelum
   task ini dieksekusi — lihat `results/REVIEW-2026-09-17-agent-1.md` (Vote Wave 3).
2. **ISSUE-028-widened terverifikasi FIXED (dua sisi):** tiga bentuk siklus dari daftar
   38-kasus agent-5 (`cycle-start`, `three-cycle-start`, `tail-into-cycle-start`) kini
   identik engine-vs-port di head saya — fix `get_highest_node_inner` (TASK-410) menutup
   seluruh kelas crash, bukan satu input.
3. **ISSUE-029 terverifikasi FIXED (dua sisi):** `get_start_node(None)` di head saya
   berakhir `None` tanpa fallback palsu (kasus `nodest-chain`, `nodest-first-disabled`
   identik). Deteksi agent-5 mengenai revisi lama (lineage PR #2). Perbaikan dipin permanen
   di `crates/n8n-workflow/tests/unknown_node_semantics.rs` (jawaban engine di-pin: chain→null,
   single→"T", first-disabled→null, all-parents-disabled→**"C" via fallback jalur destination
   `workflow.ts:884`** — fallback HANYA ada di jalur destination, persis temuan ISSUE-029).
   Pertanyaan terbuka agent-5 dijawab: `START_NODE_TYPES` = 5 entri, urutan & nilai identik
   dengan `STARTING_NODE_TYPES` (`constants.ts:53-59`) — dipin test.
4. **ISSUE-030 → keputusan terdeklarasi `D-09` (workflow-LEGO):** port TIDAK meniru crash
   insidental (TypeError dari deref tanpa guard di `workflow.ts:872-886` / `:498-504`).
   Keputusan ditulis di `contracts/workflow.contract.md` (§ unknown-input, setelah D-08)
   sesuai permintaan agent-5 — tidak dibiarkan diam. Disepakati agent-5 ("arguably a
   reference bug"; LOW; tidak diminta bug-compat).
5. **Differential driver diperluas dengan kelas DECLARED DEVIATION:** divergensi yang
   dideklarasi kontrak dilaporkan eksplisit (id + referensi kontrak) tapi tidak gate-fatal;
   divergensi tak-terdeklarasi tetap fatal. Hasil head: **38/38 terpenuhi — 37 identik +
   1 deviasi terdeklarasi (`unknown-node-start` → D-09)**, `DIFFERENTIAL: PASS (with
   declared deviations)`. Tidak ada jalur "PASS diam".
6. **POST-TASK SWEEP (v4 fase 2):** antrean disapu ulang setelah ringkasan ini diserahkan
   (komentar PR #3/#4/#5 + record REVIEW).

## BUKTI MESIN

| # | Operasi | Hasil | Gate-fatal? |
|---|---------|-------|-------------|
| T1 | Differential MELEBAR 38 kasus, dua sisi (engine 2.9.1 + port head) | **38/38 terpenuhi: 37 identik + 1 D-09 terdeklarasi** | YA |
| T2 | `cargo test` (rig) seluruh workspace | **65 passed / 0 failed** (+6 pin 029/D-09/start-types) | YA |
| T3 | `run_gate.sh --offline-only` (dengan Stage 2k + kelas deviasi) | semua PASS; live NOT RUN → INCONCLUSIVE | YA (offline) |
| T4 | `result_integrity_audit.py` | 24/24 PASS | YA |
| T5 | `workflow-reference-manifest.mjs --check` | PASS — 15050 files, root `f8da35180669…` | YA |
| T6 | `START_NODE_TYPES` vs `STARTING_NODE_TYPES` | identik 5/5 (nilai + urutan) | - |

## CATATAN

- Konsensus atas pekerjaan saya kini **penuh**: TASK-407 (follow-up ace3 `c9195cdc`
  APPROVED; agent-4 `a4a7bbd4`; worker-05 `cfee4661`), TASK-408 (ace3 + agent-4),
  TASK-409/410 (agent-4, worker-05, ace3) — tidak ada NEEDS_CORRECTION tersisa.
- `tests/differential/run.sh` dimodifikasi di branch saya HANYA untuk kelas deviasi
  terdeklarasi + label ringkasan 38 kasus; mekanisme inti (two-sided, streaming, DIFF_SKIP)
  tidak disentuh — blob dasar tetap milik agent-5 (ac12 @ `38d2ca00`).
