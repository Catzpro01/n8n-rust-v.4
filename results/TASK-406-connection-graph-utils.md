# TASK RESULT: TASK-406-connection-graph-utils

- **STATUS**: `SUCCESS`
- **PEKERJA**: `agent-1` (branch `arena/01a0ace4-n8n-rust-v-4`)
- **PERAN SESAAT (ROLE)**: Connection LEGO (on-loan per protokol; peran melekat pada task) — port `graph-utils.ts`
- **RINGKASAN INTI**: Mem-port 7 fungsi `reference/n8n/packages/workflow/src/graph/graph-utils.ts` ke `crates/n8n-connection/src/graph_utils.rs` (buildAdjacencyList, getInputEdges, getOutputEdges, getRootNodes, getLeafNodes, hasPath, parseExtractableSubgraphSelection) dengan semantik JS dipertahankan: urutan insert `Map`/`Set`, dedupe triple `(node,type,index)`, target di luar graph tetap mendiskualifikasi root, dan aturan toleransi loop-back pada extractable. Probe runner kini mengeksekusi **46/46 probe** `tests/reference/connection/01..05` — 12 skip terlacak dari TASK-405 jadi check penuh, nol silent skip, op tak dikenal gagal keras.
- **BUKTI MESIN (EVIDENCE)**:
  - `cargo test --workspace` → **52 passed / 0 failed** (termasuk 7 unit test graph_utils dengan trace golden 04-cycle + probe runner 46/46: `=== connection probes: 46 executed / 46 expected ===`)
  - Nilai pinned yang dibuktikan: `hasPath Merge→Merge via Loop` = true (main-only), `hasPath Model→Agent` = false (ai_languageModel diabaikan), `root nodes {IF,A,B,Merge}` = `["IF"]`, `extractable {IF,A}` = `[Output Edge From Non-Leaf Node: IF]`, `extractable {A,B}` = `[Multiple Input Nodes: [A,B]]`, `extractable {Merge,Loop}` = `{start: Merge, end: Loop}`
  - `bash tests/integration/run_gate.sh --offline-only` → conformance 21/21, boundary PASS, cargo PASS, live NOT RUN (INCONCLUSIVE — sandbox tanpa host live)
  - `node tools/workflow-reference-manifest.mjs --check` → `PASS (15050 files, root f8da35180669d798…)`

---

## Catatan kepatuhan protokol

- **allowed_paths**: hanya file pada manifest di atas; `reference/`, `contracts/`, `crates/n8n-workflow/src/`, `crates/n8n-validation/` tidak disentuh.
- **Oracle**: semua fungsi diverifikasi langsung ke `graph-utils.ts` (273 baris, dibaca penuh) sebelum dikode; ekspektasi dari fixture yang dipin runtime 2.9.4.
- **Satu koreksi kecil di jalur sendiri**: implementasi `get_root_nodes` pertama salah tipe slice (`&[&String]` vs `&[String]`) — tertangkap compiler, bukan divergensi perilaku.

## Sisa pekerjaan Connection fixtures (untuk siklus berikutnya)

- Probe runner kini lengkap. Tidak ada skip tersisa pada `tests/reference/connection/**`.
- CD-05 penuh (`getParentMainInputNode` pendakian non-main) tetap menunggu node-type registry (Agent 2).
