# TASK-413 — Connection Case 10 Adoption (Error Output + Sparse Slots) + D-11 Non-Reproduction Proof

- **STATUS:** SUCCESS (offline; live 11/11 NOT RUN → INCONCLUSIVE secara jujur)
- **PEKERJA:** agent-1
- **PERAN SESAAT:** konsumen fixture silang (workflow-LEGO probe runner)
- **ID NOTE (clash #4):** ace3 memakai nomor **TASK-411** untuk
  `TASK-411-connection-types-vocabulary` (`40ca8e84`) — ganda dengan TASK-411 saya
  (ISSUE-028 closure). Inkrement ini memakai **TASK-413**. Mediator diminta segera
  mengalokasikan ID terpusat (clash berjalan: TASK-404, TASK-409, TASK-410, TASK-411).

## RINGKASAN INTI

1. **Kasus 10 diadopsi** dari worker-05 (`arena/01a0ac05` @ `0f7d4d96`, fixture owner,
   blob-identik): 31 probe — error output sebagai sourceIndex biasa, sparse slot
   `null`/`[]`, duplikat direct-level `getChildNodes` (`[Log, Log, …]` — referensi TIDAK
   dedupe di level langsung), `getHighestNode` order-dependent via `checkedNodes` bersama,
   BFS-up `getNodeConnectionIndexes`, `destinationIndex` = posisi dalam slot, dan ops
   seleksi graph-utils (`getRootNodes`, `getLeafNodes`, `getInputEdges`, `getOutputEdges`,
   `hasPath`, `parseExtractable`, `adjacencyKeys`).
2. **119/119 byte-exact pada percobaan pertama** — runner saya kini 9 kasus / 119 probe
   (88 → 119). Satu-satunya arm baru yang diperlukan: `adjacencyKeys` (kunci adjacency
   urutan dokumen); ops graph-utils lain sudah diport sejak TASK-406.
3. **D-11 TIDAK mereproduksi di head saya** — README kasus 10 worker-05 mencatat
   `n8n-workflow @ main: 55 ok / 1 mismatch (D-11)`; itu diukur pada `main` yang belum
   memuat PR #3. Pengukuran ulang dua sisi di head saya: probe `byDest … padded with []`
   (kasus 02, ada di set 119) **identik** — fix TASK-405 saya (`connections.rs`:
   `lists.push(Some(Vec::new()))`, `6535009f`) mengonfirmasi tutup. Minta worker-05
   mengukur ulang terhadap head PR #3 agar catatan mereka mutakhir.
4. **Feedback wave dicatat:** agent-4 **APPROVED TASK-412 saya** (`3fbe77bc` — engine side
   di-re-execute 38 kasus, semua jawaban terpin cocok); ace3 grandfathering sweep +
   **TASK-411 vocabulary** (clash #4 di atas — doc kosakata, tidak menuntut aksi kode);
   worker-05 PRE-sweep r2 (PIPE-12/13 + TASK-303-validation mereka).

## BUKTI MESIN

| # | Operasi | Hasil | Gate-fatal? |
|---|---------|-------|-------------|
| T1 | Probe emas (9 kasus, incl. kasus 10) | **119/119 byte-exact** (percobaan pertama) | YA |
| T2 | `cargo test` (rig) seluruh workspace | 65 passed / 0 failed | YA |
| T3 | Differential 38-kasus dua sisi | PASS — 37 identik + 1 D-09 terdeklarasi | YA |
| T4 | `run_gate.sh --offline-only` (2c integritas + 2d sweep + 2k differential) | semua PASS; live NOT RUN → INCONCLUSIVE | YA (offline) |
| T5 | `workflow-reference-manifest.mjs --check` | PASS — 15050 files, root `f8da35180669…` | YA |
| T6 | `result_integrity_audit.py` | 28/28 PASS | YA |

## CATATAN

- Kasus 10 memuat perilaku yang SENGAJA tidak "diperbaiki": duplikat `Log` pada
  getChildNodes direct-level (`unshift` sebelum dedupe rekursif) — port mereproduksi
  persis, sesuai catatan README fixture.
- 31 probe baru menambah cakupan `getInputEdges`/`getOutputEdges`/`hasPath`/
  `parseExtractable` yang sebelumnya hanya disentuh unit test internal — kini ter-pin
  golden runtime.
