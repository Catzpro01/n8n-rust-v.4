# TASK-411 — ISSUE-028 Closure (two-sided) + Differential Stage 2k Adoption

- **STATUS:** SUCCESS (offline; live 11/11 NOT RUN → INCONCLUSIVE secara jujur)
- **PEKERJA:** agent-1
- **PERAN SESAAT:** owner fix ISSUE-028 + adopsi harness differential agent-5
- **ID NOTE (clash #2):** nomor **TASK-410** kini juga dipakai worker-05
  (`TASK-410-connection-driver-parity`, `arena/01a0ac05` @ `df6dc76d`) — clash dicatat dua
  sisi; inkrement ini memakai **TASK-411**. (Sejarah: TASK-409 juga ganda — agent-1 cases
  06-07 vs agent-3 case 08.) Mediator perlu alokasi ID terpusat.

## RINGKASAN INTI

1. **ISSUE-028 (HIGH, owner agent-1) → CLOSED (FIXED).** Deteksi agent-5 (Stage 2k) pada
   revisi port lama (lineage PR #2 @ `9e21d6ea`, helper `get_highest_nodes` tanpa guard).
   Pada head `f8fcafd9` (TASK-410) akar masalah sudah hilang: `get_start_node` memakai
   `get_highest_node` dengan **`checkedNodes` bersama yang bermutasi** (`get_highest_node_inner`,
   semantik `workflow.ts:514-545`) — guard siklus persis seperti referensi.
2. **Verifikasi dua sisi di sandbox saya (bukan klaim satu sisi):** engine nyata
   n8n-workflow@2.9.1 di-install ke `/tmp/expr-rig` (jalur dari gate), lalu
   `tests/differential/run.sh` menjalankan KEDUA sisi → **14/14 identik, 0 divergensi**,
   termasuk kasus `cycle-start` (yang tadinya membuat port ABORT).
3. **Stage 2k diadopsi ke gate** (`tests/integration/run_gate.sh`): differential
   port-vs-engine kini stage reguler; bila expr-rig tidak terpasang → `SKIPPED (not a PASS)`
   (jujur, mengikuti konvensi ISSUE-025).
4. **Regresi permanen cargo:** `crates/n8n-workflow/tests/cycle_traversal.rs` mem-pin jawaban
   engine (`getStartNode('B') → "A"`, `getHighestNode('B') → ["A"]`) sehingga crash tidak bisa
   kembali diam-diam di sandbox tanpa expr-rig.
5. **Entry ISSUE-028** (verbatim dari ac12) ditambahkan ke `docs/isolation/CROSS-AGENT-ISSUES.md`
   dengan blok penutupan + tabel bukti dua sisi.
6. **Feedback wave lain dicatat:** ace3 **APPROVED TASK-408** saya (scope TESTED; clippy/TS/
   live tetap terbuka, tidak di-waive); agent-4 record APPROVED TASK-409 cases-06-07
   (`a3747f0e`); worker-05 TASK-410 driver-parity (57 non-wf probe: seam == harness driver) —
   clash ID dicatat di atas; agent-2 node wave 9 (di luar domain saya).

## BUKTI MESIN

| # | Operasi | Hasil | Gate-fatal? |
|---|---------|-------|-------------|
| T1 | `npm install n8n-workflow@2.9.1 n8n-core@2.9.1` → `/tmp/expr-rig` | 338 packages OK | - |
| T2 | `bash tests/differential/run.sh` (kedua sisi dieksekusi) | **14/14 identik, 0 divergensi** (incl. `cycle-start`) | YA |
| T3 | `cargo test` (rig) seluruh workspace | **59 passed / 0 failed** (+2 regresi siklus) | YA |
| T4 | `run_gate.sh --offline-only` (kini dengan Stage 2k) | semua stage PASS; DIFFERENTIAL 2k PASS; live NOT RUN → INCONCLUSIVE | YA (offline) |
| T5 | `result_integrity_audit.py` | 24/24 PASS | YA |
| T6 | `workflow-reference-manifest.mjs --check` | PASS — 15050 files, root `f8da35180669…` | YA |

## CATATAN

- Engine differential ter-pin `n8n-workflow@2.9.1` (jalur install yang terdokumentasi di
  gate ac12); label "2.9.4" pada record agent-5 merujuk baseline source repo — dicatat di
  sini agar tidak ada ambiguitas versi.
- `tests/differential/*` diadopsi tanpa modifikasi (blob sama dengan ac12 @ `888c9228`).
