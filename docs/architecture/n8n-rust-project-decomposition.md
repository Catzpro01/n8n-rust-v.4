# n8n-Rust Project Decomposition: Milestones M1–M10 Task Breakdown

## 0. Dokumen Otoritas & Tujuan
- **Repositori**: `Catzpro01/n8n-rust-v.4`
- **Tujuan**: Menggantikan estimasi sembarang dengan **Dekomposisi Arsitektur Konkret (47 Task)** yang berasal langsung dari kebutuhan teknis modul Rust dan LEGO conformance repositori ini.
- **Aturan Mutlak**:
  - `SPECIALIZATION ≠ AGENT ≠ BRANCH ≠ WORKSPACE`.
  - Format branch per task: `<SPECIALIZATION>/<MILESTONE>-<TASK>`.
  - Bobot tidak dihitung dari baris kode (LOC) atau jumlah commit, melainkan kompleksitas domain arsitektur.
  - Progress proyek sebenarnya dihitung dari penyelesaian task-task ini dengan bukti commit dan pengujian valid.

---

## 1. Ringkasan Dekomposisi 10 Milestone

| Milestone | Domain Spesialisasi | Crates / Target Paths | Jumlah Task | Total Bobot | Scope Status |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **M1: Runtime Kernel** | `runtime-kernel` | `crates/n8n-workflow/src/runtime/**` | 7 | 11.0 | **COMPLETE** |
| **M2: Execution Engine** | `execution-engine` | `crates/n8n-workflow/src/runtime/executor.rs` | 5 | 9.0 | **COMPLETE** |
| **M3: Data Plane** | `data-plane` | `crates/n8n-execution-data/**` | 5 | 10.0 | **COMPLETE** |
| **M4: Memory** | `memory` | `crates/n8n-workflow/src/runtime/memory.rs` | 4 | 8.0 | **COMPLETE** |
| **M5: Node System** | `node-system` | `crates/n8n-nodes-rust/**`, `crates/n8n-node-model/**` | 7 | 12.0 | **COMPLETE** |
| **M6: Workflow Model** | `workflow-model` | `crates/n8n-workflow/src/lib.rs`, `connections.rs` | 4 | 6.0 | **COMPLETE** |
| **M7: Expression Engine** | `expression-engine` | `crates/n8n-expression/**` | 5 | 11.0 | **COMPLETE** |
| **M8: Validation** | `validation` | `crates/n8n-validation/**` | 4 | 4.0 | **COMPLETE** |
| **M9: Integration** | `integration` | `tests/**`, `packages/reconstructed-engine/**` | 4 | 9.0 | **COMPLETE** |
| **M10: Security** | `security` | `tools/arena-executor/fs_guard.py` | 4 | 5.0 | **COMPLETE** |
| **TOTAL** | **10 Domains** | **Seluruh Repositori** | **49 Tasks** | **85.0 Wt** | **BASELINE READY** |

---

## 2. Rincian Task per Milestone

### M1: Runtime Kernel (`runtime-kernel`)
Target Crate: `crates/n8n-workflow/src/runtime/**`

1. **`runtime-kernel/m1-01-execution-frame`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Implementasi `ExecutionFrame` terisolasi, stack context, dan node execution boundary.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/frame.rs`, `crates/n8n-workflow/src/runtime/mod.rs`
   - *Acceptance Criteria*: Alur data antar frame terlindungi, frame context menyimpan parameter dan status node, zero leak saat frame di-drop.
2. **`runtime-kernel/m1-02-runtime-graph`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: DAG lowering dari workflow JSON ke struktur runtime execution graph internal.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/graph.rs`
   - *Acceptance Criteria*: Lowering menghasilkan topological order yang valid, mendeteksi multiple triggers, memisahkan branch paralel.
3. **`runtime-kernel/m1-03-cancellation-token`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Mekanisme cooperative cancellation token thread-safe (`AtomicBool` / `tokio::sync`).
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/cancellation.rs`
   - *Acceptance Criteria*: Runner segera menghentikan eksekusi frame baru saat token di-cancel, frame berjalan menyelesaikan cleanup tanpa panic.
4. **`runtime-kernel/m1-04-memory-governor-integration`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Integrasi pembatasan alokasi memory heap ke dalam frame runner loop.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/runner.rs`, `crates/n8n-workflow/src/runtime/memory.rs`
   - *Acceptance Criteria*: Runner memicu backpressure / yield saat alokasi mencapai 85% budget, abort jika melewati budget.
5. **`runtime-kernel/m1-05-error-propagation`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Penanganan error pada runtime frame, routing ke error trigger workflow atau node downstream `onError`.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/error.rs`
   - *Acceptance Criteria*: Error message terstruktur, stacktrace tidak bocor ke output user, error workflow diaktifkan jika dikonfigurasi.
6. **`runtime-kernel/m1-06-topological-runner`** (Bobot: 3.0 | Level: `L2`)
   - *Tujuan*: Loop utama `WorkflowRunner` mengeksekusi DAG sesuai urutan dependensi node.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/runner.rs`
   - *Acceptance Criteria*: 100% lulus eksekusi sekuensial dan diamond dependency graph, data output diteruskan tepat ke node input target.
7. **`runtime-kernel/m1-07-execution-lifecycle`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Event lifecycle hook (`on_workflow_start`, `on_node_start`, `on_node_finish`, `on_workflow_finish`).
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/lifecycle.rs`
   - *Acceptance Criteria*: Setiap transisi menghasilkan event terstruktur lengkap dengan durasi eksekusi dalam milidetik.

---

### M2: Execution Engine (`execution-engine`)
Target Crate: `crates/n8n-workflow/src/runtime/executor.rs`, scheduler

1. **`execution-engine/m2-01-state-machine`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: FSM penentu status node (`Pending`, `Running`, `Succeeded`, `Failed`, `Skipped`, `Waiting`).
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/executor.rs`
   - *Acceptance Criteria*: Tidak ada invalid state transition, status immutable setelah terminal state tercapai.
2. **`execution-engine/m2-02-task-scheduler`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Scheduler antrian eksekusi node siap-jalan (ready queue) dengan batas concurrency pool.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/scheduler.rs`
   - *Acceptance Criteria*: Node dengan dependensi belum terpenuhi tetap di queue tunggu, concurrency limit dihormati.
3. **`execution-engine/m2-03-loop-iteration-manager`** (Bobot: 2.0 | Level: `L2`)
   - *Tujuan*: Manajemen iterasi per item pada node (SplitInBatches / LoopOverItems).
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/loop_manager.rs`
   - *Acceptance Criteria*: Menjaga isolasi frame antar iterasi batch, menggabungkan output array pada akhir loop.
4. **`execution-engine/m2-04-retry-policy-engine`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Otomasi retry saat eksekusi node gagal (exponential backoff & max retries).
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/retry.rs`
   - *Acceptance Criteria*: Menghormati konfigurasi delay, tidak retry untuk non-transient error (misal 401 Unauthorized).
5. **`execution-engine/m2-05-subworkflow-invocation`** (Bobot: 2.0 | Level: `L2`)
   - *Tujuan*: Dukungan pemanggilan sub-workflow (node ExecuteWorkflow).
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/subworkflow.rs`
   - *Acceptance Criteria*: Frame context anak terisolasi dari induk, payload output anak kembali dengan bersih ke node induk.

---

### M3: Data Plane (`data-plane`)
Target Crate: `crates/n8n-execution-data/**`

1. **`data-plane/m3-01-item-buffer`** (Bobot: 3.0 | Level: `L1`)
   - *Tujuan*: Implementasi buffer data `ItemBuffer` zero-copy dengan smart pointer `Arc<DataRecord>`.
   - *Allowed Files*: `crates/n8n-execution-data/src/buffer.rs`
   - *Acceptance Criteria*: Passing data antar node tidak menduplikasi heap payload JSON secara berulang.
2. **`data-plane/m3-02-binary-stream`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Handling payload binary/file berbasis stream buffer tanpa memuat seluruh binary ke RAM.
   - *Allowed Files*: `crates/n8n-execution-data/src/binary.rs`
   - *Acceptance Criteria*: File > 50MB dialirkan secara bertahap (chunked streaming), zero memory spike.
3. **`data-plane/m3-03-data-record-serde`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Parser dan serializer JSON yang cepat dan aman untuk payload input/output node.
   - *Allowed Files*: `crates/n8n-execution-data/src/record.rs`
   - *Acceptance Criteria*: Menjaga tipe data primitif dan nested object identik dengan output JavaScript n8n.
4. **`data-plane/m3-04-item-metadata`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Pelacakan silsilah item (`pairedItem`, indeks source node) untuk referensi `$item()`.
   - *Allowed Files*: `crates/n8n-execution-data/src/metadata.rs`
   - *Acceptance Criteria*: Relasi paired item tetap konsisten setelah transformasi Set / Filter node.
5. **`data-plane/m3-05-memory-eviction`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Pembersihan intermediate buffer item yang sudah tidak lagi dirujuk oleh node downstream.
   - *Allowed Files*: `crates/n8n-execution-data/src/eviction.rs`
   - *Acceptance Criteria*: Memory footprint menurun otomatis setelah intermediate node selesai dieksekusi.

---

### M4: Memory Management (`memory`)
Target Crate: `crates/n8n-workflow/src/runtime/memory.rs`

1. **`memory/m4-01-heap-governor`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Atomic memory governor memantau alokasi heap runtime n8n terhadap konfigurasi max budget.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/memory.rs`
   - *Acceptance Criteria*: Akurat menghitung delta alokasi per workflow execution, thread-safe.
2. **`memory/m4-02-backpressure-controller`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Controller backpressure yang memperlambat dispatching saat ambang memory 85% tercapai.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/backpressure.rs`
   - *Acceptance Criteria*: Runner melakukan micro-sleep dan menghentikan pembacaan batch baru hingga RAM stabil.
3. **`memory/m4-03-spill-to-disk`** (Bobot: 3.0 | Level: `L2`)
   - *Tujuan*: Mekanisme offloading ItemBuffer ke disk sementara saat ambang memory 90% tercapai.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/spill.rs`
   - *Acceptance Criteria*: ItemBuffer disimpan ke temp file terenkripsi dan dapat dibaca kembali secara transparan.
4. **`memory/m4-04-oom-guard`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Pencegahan fatal OOM crash dengan membatalkan workflow secara graceful sebelum OS membunuh proses.
   - *Allowed Files*: `crates/n8n-workflow/src/runtime/oom_guard.rs`
   - *Acceptance Criteria*: Menghasilkan telemetry error `MEMORY_LIMIT_EXCEEDED` tanpa merusak thread pool.

---

### M5: Node System (`node-system`)
Target Crates: `crates/n8n-nodes-rust/**`, `crates/n8n-node-model/**`

1. **`node-system/m5-01-node-traits`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Standarisasi trait eksekusi node `INodeExecution`, `INodeType`, dan `NodeContext`.
   - *Allowed Files*: `crates/n8n-node-model/src/traits.rs`
   - *Acceptance Criteria*: Semua node native mengimplementasikan trait yang sama secara strictly typed.
2. **`node-system/m5-02-set-node`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Implementasi native node Edit Fields (Set) untuk manipulasi data payload.
   - *Allowed Files*: `crates/n8n-nodes-rust/src/set.rs`
   - *Acceptance Criteria*: Mendukung operasi append, replace, delete, dan format konversi field JSON.
3. **`node-system/m5-03-if-node`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Implementasi native node If / Filter untuk percabangan boolean (True / False branches).
   - *Allowed Files*: `crates/n8n-nodes-rust/src/if_node.rs`
   - *Acceptance Criteria*: Evaluasi operator perbandingan numerik, string, dan boolean menghasilkan output slot tepat.
4. **`node-system/m5-04-code-node`** (Bobot: 3.0 | Level: `L2`)
   - *Tujuan*: Sandboxed execution wrapper untuk Code node (JavaScript / Rust snippet).
   - *Allowed Files*: `crates/n8n-nodes-rust/src/code_node.rs`
   - *Acceptance Criteria*: Eksekusi script terisolasi tanpa akses ke filesystem / network kecuali diizinkan.
5. **`node-system/m5-05-http-request-node`** (Bobot: 2.0 | Level: `L2`)
   - *Tujuan*: Implementasi native async HTTP client node (GET, POST, PUT, DELETE, Headers, Auth).
   - *Allowed Files*: `crates/n8n-nodes-rust/src/http_request.rs`
   - *Acceptance Criteria*: Mendukung streaming body, connection timeout, dan error handling HTTP status.
6. **`node-system/m5-06-webhook-node`** (Bobot: 2.0 | Level: `L2`)
   - *Tujuan*: Inbound webhook trigger node normalizer (headers, query params, raw body).
   - *Allowed Files*: `crates/n8n-nodes-rust/src/webhook.rs`
   - *Acceptance Criteria*: Menerima HTTP POST dan mengonversinya menjadi ItemBuffer standar untuk memulai workflow.
7. **`node-system/m5-07-manual-trigger-node`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Manual trigger adapter untuk inisiasi pengetesan dan alur workflow deterministik.
   - *Allowed Files*: `crates/n8n-nodes-rust/src/manual_trigger.rs`
   - *Acceptance Criteria*: Menghasilkan single item dengan metadata timestamp eksekusi awal.

---

### M6: Workflow Model (`workflow-model`)
Target Crate: `crates/n8n-workflow/src/lib.rs`, `connections.rs`

1. **`workflow-model/m6-01-schema-deserializer`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Deserializer workflow JSON standar n8n versi 1 dan 2.
   - *Allowed Files*: `crates/n8n-workflow/src/schema.rs`
   - *Acceptance Criteria*: Parsing valid untuk workflows dengan puluhan nodes, parameter nested, dan metadata.
2. **`workflow-model/m6-02-connections-inversion`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Inversi pemetaan koneksi dari format source-centric ke destination-centric.
   - *Allowed Files*: `crates/n8n-workflow/src/connections.rs`
   - *Acceptance Criteria*: 100% konsisten dengan unit tests `destination_map_inverts_the_source_map`.
3. **`workflow-model/m6-03-node-parameter-resolver`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Parser parameter node, hidrasi nilai default, dan pemisahan ekspresi dari nilai literal.
   - *Allowed Files*: `crates/n8n-workflow/src/parameters.rs`
   - *Acceptance Criteria*: Mendeteksi apakah parameter berupa nilai konstan atau membutuhkan evaluasi expression.
4. **`workflow-model/m6-04-pinned-data-support`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Dukungan untuk pinned data (static mock data pada node untuk testing).
   - *Allowed Files*: `crates/n8n-workflow/src/pinned.rs`
   - *Acceptance Criteria*: Jika node memiliki pinned data, runner menggunakan data tersebut tanpa mengeksekusi upstream.

---

### M7: Expression Engine (`expression-engine`)
Target Crate: `crates/n8n-expression/**`

1. **`expression-engine/m7-01-ast-tokenizer`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Tokenizer untuk ekspresi template n8n `{{ ... }}` dan operator JavaScript dasar.
   - *Allowed Files*: `crates/n8n-expression/src/tokenizer.rs`
   - *Acceptance Criteria*: Memisahkan literal string dari expression block secara akurat.
2. **`expression-engine/m7-02-ast-parser`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: AST Parser untuk parsing hirarki akses properti, operator logika, ternary, dan pemanggilan fungsi.
   - *Allowed Files*: `crates/n8n-expression/src/parser.rs`
   - *Acceptance Criteria*: Menghasilkan AST node yang immutable dan aman dari stack overflow.
3. **`expression-engine/m7-03-sandboxed-evaluator`** (Bobot: 3.0 | Level: `L1`)
   - *Tujuan*: Evaluator ekspresi AST berkecepatan tinggi tanpa alokasi berlebih.
   - *Allowed Files*: `crates/n8n-expression/src/evaluator.rs`
   - *Acceptance Criteria*: Menghitung ekspresi aritmetika, logika string, dan boolean dengan determinisme 100%.
4. **`expression-engine/m7-04-context-resolver`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Resolver variabel kontekstual n8n (`$json`, `$node["NodeName"]`, `$item()`, `$runIndex`).
   - *Allowed Files*: `crates/n8n-expression/src/context.rs`
   - *Acceptance Criteria*: Mengakses output node sebelumnya berdasarkan nama node dengan O(1) lookup.
5. **`expression-engine/m7-05-js-syntax-compatibility`** (Bobot: 2.0 | Level: `L2`)
   - *Tujuan*: Kompatibilitas fungsi helper bawaan JavaScript (String trim/split/replace, Array map/filter, Math min/max, Date parse).
   - *Allowed Files*: `crates/n8n-expression/src/helpers.rs`
   - *Acceptance Criteria*: Menghasilkan output yang identik dengan evaluasi V8 engine n8n JavaScript.

---

### M8: Validation (`validation`)
Target Crate: `crates/n8n-validation/**`

1. **`validation/m8-01-cycle-detection`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Algoritma pendeteksi cycle/looping ilegal pada graph workflow non-looping.
   - *Allowed Files*: `crates/n8n-validation/src/cycle.rs`
   - *Acceptance Criteria*: Menolak workflow dengan siklus tak terdefinisi, mengizinkan loop yang menggunakan Loop-node resmi.
2. **`validation/m8-02-node-uniqueness`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Validasi keunikan nama node dalam seluruh cakupan workflow.
   - *Allowed Files*: `crates/n8n-validation/src/uniqueness.rs`
   - *Acceptance Criteria*: Menolak workflow jika terdapat duplikasi identifier node.
3. **`validation/m8-03-dangling-connections`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Validasi integritas koneksi (memastikan semua koneksi mengarah ke node dan slot yang valid).
   - *Allowed Files*: `crates/n8n-validation/src/connections.rs`
   - *Acceptance Criteria*: Mendeteksi dangling edge ke node yang telah dihapus atau slot output yang tidak tersedia.
4. **`validation/m8-04-parameter-integrity`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Validasi parameter wajib (required parameters) pada definisi node.
   - *Allowed Files*: `crates/n8n-validation/src/parameters.rs`
   - *Acceptance Criteria*: Memberikan pesan error deskriptif jika konfigurasi parameter tidak lengkap.

---

### M9: Integration & Conformance (`integration`)
Target Crates: `tests/**`, `packages/reconstructed-engine/**`

1. **`integration/m9-01-conformance-harness`** (Bobot: 3.0 | Level: `L3`)
   - *Tujuan*: Harness pengujian conformance komprehensif membandingkan output engine Rust vs engine Node.js reference.
   - *Allowed Files*: `tests/conformance.rs`, `tests/reference_fixtures.rs`
   - *Acceptance Criteria*: Seluruh output JSON dari 20 workflow reference menghasilkan kesamaan payload 100%.
2. **`integration/m9-02-golden-test-replay`** (Bobot: 2.0 | Level: `L3`)
   - *Tujuan*: Golden test fixture replay pada skenario linear, diamond, multi-output, dan error handling.
   - *Allowed Files*: `tests/trigger_lifecycle.rs`, `tests/fixtures/**`
   - *Acceptance Criteria*: Verifikasi tidak ada regresi pada trigger polling, webhook, dan manual execution.
3. **`integration/m9-03-cross-crate-benchmark`** (Bobot: 2.0 | Level: `L2`)
   - *Tujuan*: Benchmark suite Criterion mengukur throughput (item/detik) dan konsumsi memori per 10,000 item.
   - *Allowed Files*: `benches/**`
   - *Acceptance Criteria*: Performa eksekusi Rust minimal 5x lebih cepat dari Node.js baseline dengan konsumsi RAM < 20%.
4. **`integration/m9-04-legacy-lego-adapter`** (Bobot: 2.0 | Level: `L2`)
   - *Tujuan*: Pengujian boundary conformance modul LEGO TypeScript (`workflow-lego`, `execution-lego`, `events-lego`).
   - *Allowed Files*: `packages/**/test/**`
   - *Acceptance Criteria*: Seluruh 40 test Node.js / TypeScript LEGO tetap lolos 100%.

---

### M10: Security & Sandbox (`security`)
Target: `tools/arena-executor/fs_guard.py`, security sandbox

1. **`security/m10-01-fs-sandbox`** (Bobot: 2.0 | Level: `L1`)
   - *Tujuan*: Pembatasan isolasi filesystem ketat pada workspace runner.
   - *Allowed Files*: `tools/arena-executor/fs_guard.py`
   - *Acceptance Criteria*: Path traversal (`../../`) dan akses ke direktori di luar workspace otomatis di-block.
2. **`security/m10-02-env-isolation`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Sanitasi environment variable pada eksekusi kode (mencegah akses ke token, API keys, dan secret internal).
   - *Allowed Files*: `tools/arena-executor/executor.py`
   - *Acceptance Criteria*: Variabel lingkungan sensitif di-strip sebelum proses eksekusi worker berjalan.
3. **`security/m10-03-timeout-watchdog`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Watchdog timer pembunuh proses untuk eksekusi yang mengalami infinite loop.
   - *Allowed Files*: `tools/arena-executor/timeout.py`
   - *Acceptance Criteria*: Proses di-terminate secara tegas jika melewati batas execution timeout yang dikonfigurasi.
4. **`security/m10-04-prototype-pollution-guard`** (Bobot: 1.0 | Level: `L1`)
   - *Tujuan*: Pencegahan manipulasi prototype atau inject key berbahaya (`__proto__`, `constructor`) pada data JSON.
   - *Allowed Files*: `crates/n8n-execution-data/src/security.rs`
   - *Acceptance Criteria*: JSON parser menolak atau men-sanitize atribut reserved secara ketat.

---

## 3. Integrasi ke Progress Engine & Kontrak Baseline

Setelah seluruh 47 task ini didaftarkan ke Control Plane:
1. `PROJECT_SCOPE_TASK_COUNT`: **47 tasks**
2. `TOTAL_PROJECT_WEIGHT`: **86.0 weight points**
3. `PROJECT_SCOPE`: Berubah dari `INCOMPLETE` menjadi **`COMPLETE`**
4. Status Progress Proyek Aktual:
   $$\text{Project Progress} = \frac{\text{Bobot Task DONE}}{\text{Total Bobot (86.0)}} \times 100$$
   - Saat ini: 1 task awal (`runtime-kernel/m1-runner` bobot 2.0) DONE $\rightarrow \mathbf{2.33\%}$ penyelesaian proyek riil n8n Rust.
   - Angka $2.33\%$ ini memiliki denominator matematis riil dan tidak lagi merupakan representasi palsu dari 10 task placeholder.
