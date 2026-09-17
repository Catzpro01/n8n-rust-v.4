# TASK RESULT: TASK-406-connection-graph-utils

- **STATUS**: `SUCCESS`
- **PEKERJA**: `agent-1` (branch `arena/01a0ace4-n8n-rust-v-4`)
- **PERAN SESAAT (ROLE)**: Connection LEGO (on-loan per protokol; peran melekat pada task) — port `graph-utils.ts`
- **RINGKASAN INTI**: Mem-port 7 fungsi `reference/n8n/packages/workflow/src/graph/graph-utils.ts` ke `crates/n8n-connection/src/graph_utils.rs` (buildAdjacencyList, getInputEdges, getOutputEdges, getRootNodes, getLeafNodes, hasPath, parseExtractableSubgraphSelection) dengan semantik JS dipertahankan: urutan insert `Map`/`Set`, dedupe triple `(node,type,index)`, target di luar graph tetap mendiskualifikasi root, dan aturan toleransi loop-back pada extractable. Probe runner kini mengeksekusi **46/46 probe** `tests/reference/connection/01..05` — 12 skip terlacak dari TASK-405 jadi check penuh, nol silent skip, op tak dikenal gagal keras.
- **BUKTI MESIN (EVIDENCE)**:

| Operation | Command | Outcome |
| :--- | :--- | :--- |
| verify_oracle | baca penuh `graph-utils.ts` (273 baris, 7 fungsi) | semantik JS dipetakan sebelum dikode |
| port_graph_utils | tambah `crates/n8n-connection/src/graph_utils.rs` + `pub mod` | 7 fungsi port: adjacency, input/output edges, root/leaf, hasPath, parseExtractable |
| unit_tests_graph_utils | 7 test trace golden 04-cycle (termasuk `hasPath Loop→Merge` = true, `Model→Agent` = false) | hijau |
| wire_probe_runner | 6 op SKIP → eksekusi nyata di `connection_probe_fixtures.rs`; count assert 46/46 | `=== connection probes: 46 executed / 46 expected ===` |
| cargo_test_workspace | `tools/rust-offline-rig/run.sh test` | **52 passed / 0 failed** |
| gate_offline | `bash tests/integration/run_gate.sh --offline-only` | conformance 21/21, boundary PASS, cargo PASS, live NOT RUN → INCONCLUSIVE |
| reference_integrity | `node tools/workflow-reference-manifest.mjs --check` | PASS (15050 files, `f8da35180669d798…`) |

---

## Catatan kepatuhan protokol

- **allowed_paths**: hanya file pada manifest di atas; `reference/`, `contracts/`, `crates/n8n-workflow/src/`, `crates/n8n-validation/` tidak disentuh.
- **Oracle**: semua fungsi diverifikasi langsung ke `graph-utils.ts` (273 baris, dibaca penuh) sebelum dikode; ekspektasi dari fixture yang dipin runtime 2.9.4.
- **Satu koreksi kecil di jalur sendiri**: implementasi `get_root_nodes` pertama salah tipe slice (`&[&String]` vs `&[String]`) — tertangkap compiler, bukan divergensi perilaku.

## Sisa pekerjaan Connection fixtures (untuk siklus berikutnya)

- Probe runner kini lengkap. Tidak ada skip tersisa pada `tests/reference/connection/**`.
- CD-05 penuh (`getParentMainInputNode` pendakian non-main) tetap menunggu node-type registry (Agent 2).
