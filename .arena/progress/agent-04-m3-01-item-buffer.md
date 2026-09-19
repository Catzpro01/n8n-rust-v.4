# ARENA PROGRESS — agent-04 / m3-01-item-buffer

- **Agent**: `agent-04` (Data Plane — Expression Engine, Sandbox & Execution Data Plane)
- **Task**: `data-plane/m3-01-item-buffer` (claimed as `m3-item-buffer`, Bobot 3.0, Level L1)
- **Sub-LEGO**: `execution_data.buffer` (`.arena/registry/sublego.yaml` L160–169, owner agent-04)
- **Contract**: `contracts/execution-data.contract.md`
- **Allowed files**: `crates/n8n-execution-data/src/**` (task target: `src/buffer.rs`)
- **Session branch**: `arena/01a0ba48-n8n-rust-v-4` (platform session branch; secara logis mewakili `data-plane/m3-m3-item-buffer` — platform Arena mengikat sesi ke branch ini, lihat §8 Catatan)
- **Last updated**: 2026-09-19

---

## 1. Ringkasan

Implementasi ulang `ItemBuffer` sebagai buffer zero-copy berbasis smart pointer
`Arc<DataRecord>` sesuai dekomposisi M3-01: *passing data antar node tidak
menduplikasi heap payload JSON secara berulang*. Implementasi lama (inline di
`lib.rs`, `Vec<DataRecord>` tanpa `Arc<DataRecord>`, konversi wire yang
deep-clone di setiap pemanggilan) dipindahkan & didesain ulang ke
`src/buffer.rs`; `lib.rs` menjadi facade yang 100% backward-compatible.

## 2. Audit Implementasi Lama (temuan)

| # | Temuan | Dampak |
|---|---|---|
| A1 | `ItemBuffer` menyimpan `Vec<DataRecord>`; `DataRecord` hanya memakai `Arc<Value>` | `clone()` buffer = O(n); fan-out antar node tidak O(1); spesifikasi mensyaratkan `Arc<DataRecord>` |
| A2 | `to_node_execution_data()` deep-clone seluruh payload JSON tiap konversi | Melanggar acceptance criteria m3-01 (duplikasi payload berulang saat lintas boundary) |
| A3 | Implementasi inline di `lib.rs` | Melanggar target file dekomposisi (`src/buffer.rs`) |
| A4 | `estimated_bytes()` menghitung ulang payload yang di-share antar record | Akuntansi memori bias (ganda) untuk M4 memory governor |
| A5 | `estimated_bytes()` mengabaikan payload binary | Undercount footprint (binary base64 bisa jauh lebih besar dari json) |
| A6 | `paired_item` tidak dinormalisasi: bentuk array `IPairedItemData[]` tidak ditolak secara eksplisit | Risiko flattening salah terhadap metadata lineage milik m3-04 |

## 3. Desain Baru (`src/buffer.rs`)

### Model data
- `DataRecord { json: Arc<Value>, binary: Option<Arc<BinaryDataMap>>, paired_item: Option<u32> }`
  — `Clone` = bump refcount maksimal 3 (payload tidak pernah disalin). Field
  publik dipertahankan identik demi konsumen agent-01 (`runner.rs`).
- `ItemBuffer { items: Arc<Vec<Arc<DataRecord>>> }`:
  - `clone()` → **O(1)** (satu bump refcount storage); fan-out output node ke N
    input downstream = zero heap copy.
  - `push`/`push_arc` → CoW via `Arc::make_mut`: yang disalin hanya *vektor
    pointer* (8 byte/slot), payload tidak pernah.
  - `extend_from_buffer(&other)` → refcount bump per record saja.
  - `get`/`iter`/`first`/`last` → borrow `&DataRecord` (deref Arc, zero-cost);
    `iter_arcs`/`get_arc`/`arcs` untuk sharing `Arc<DataRecord>` antar struktur.
  - `shares_storage_with` / `storage_owners` untuk introspeksi sharing (test &
    evidence).

### Copy policy (rationale RAM)
| Operasi | Biaya |
|---|---|
| `clone` / `shallow_clone` | O(1) refcount |
| `push(DataRecord)` | 1× `Arc::new`; CoW pointer-vec hanya jika storage shared |
| `extend_from_buffer` | refcount bump per item |
| `to_execution_data` | deep clone **sekali per panggilan** — hanya di boundary (persistensi/API envelope); hot path wajib lewat `iter`/`get` |
| `from_execution_data` | deep clone sekali di boundary deserialisasi |

### Akuntansi memori (untuk M4 governor & M3-05 eviction)
- `estimated_bytes()`: dedup per pointer alokasi (payload shared dihitung
  **sekali** per buffer) + header per record unik + slot pointer + header Vec,
  termasuk payload binary (perbaikan A4/A5).
- `shared_bytes()` / `unique_bytes()`: membedakan footprint yang juga dirujuk
  owner lain (dua jalur sharing dikenali: storage snapshot & CoW split/external
  handle) — sinyal reclaimable untuk m3-05.

### Kepatuhan kontrak
- I1: item selalu punya `json` (field required).
- I3/I4/I5 (representasi): bentuk legacy number & `{item}` dinormalisasi ke
  `{"item": n}` saat keluar ke wire; bentuk array/`sourceOverwrite` **tidak**
  di-flatten salah (kembali `None`, lineage = scope m3-04).
- I13: urutan item dijaga (append order; test 256 item).
- Kompatibilitas konsumen `frame.rs`/`runner.rs` dipertahankan: `DataRecord::new`,
  `push`, `get`, `iter().cloned()`, `estimated_bytes`, field publik sama.

## 4. File Berubah

| File | Status | Alasan |
|---|---|---|
| `crates/n8n-execution-data/src/buffer.rs` | BARU | implementasi inti m3-01 + 20 unit/regression test |
| `crates/n8n-execution-data/src/lib.rs` | MODIFIKASI | facade `mod buffer; pub use ...`; helper lama `wrap_data`/`extract_json`/`pair_items` + test lama dipertahankan utuh |

Tidak ada file di luar `crates/n8n-execution-data/src/**` yang diubah.
`Cargo.lock` tidak tersentuh (tidak ada dependency baru).

## 5. Evidence Build & Test

Environment: registry crates.io tidak terjangkau dari sandbox → build via
`tools/rust-offline-rig` (toolchain rustc/cargo 1.88.0 dari npm + 27 crate
vendor dari GitHub). Vendor diperluas di `/tmp` (di luar repo) dengan
tokio 1.53.1 + tokio-macros 2.7.2 + pin-project-lite 0.2.17 persis versi
`Cargo.lock` — **tanpa mengubah** `tools/` maupun `Cargo.lock`. (Rig bawaan
mengecualikan `n8n-nodes-rust` karena tokio closure tidak di-vendor untuk
crate itu di sandbox; CI/VPS tetap membangunnya dengan registry asli.)

```
$ tools/rust-offline-rig/run.sh check
    Finished `dev` profile ... (0 warnings di n8n-execution-data)

$ tools/rust-offline-rig/run.sh test   (exit code 0)
    19 suite, 132 test PASSED, 0 FAILED
    - n8n-execution-data: 20 passed (3 test lama + 17 baru)
    - n8n-workflow (konsumen agent-01): 53 passed — tidak ada regresi
    - n8n-expression: 37 passed; lainnya: connection 2, node-model 4,
      validation 1, common 0, integration tests: conformance 1,
      graph_expression 5, reference_fixtures 2, runtime_runner 4,
      trigger_lifecycle 3, doc-tests 0
```

Test regresi baru yang membuktikan acceptance criteria (pilihan):
- `o1_snapshot_clone_shares_storage_and_payloads` — `clone()` O(1): `Arc::ptr_eq`
  record & payload + `storage_owners()==2` + **tidak ada re-wrap** (strong
  count record tetap 1 → tidak ada duplikasi).
- `passthrough_execution_shares_json_heap_payload` — pola `iter().cloned()` +
  push (jalur antar-node di `runner.rs`): payload JSON `Arc::ptr_eq`, strong
  count ≥ 2 → heap payload tidak diduplikasi.
- `cow_push_on_shared_buffer_does_not_touch_original` — CoW: original tak
  berubah; record Arc count = 2 setelah split (di-share, bukan disalin).
- `estimated_bytes_counts_shared_payload_once` — payload shared dihitung sekali.
- `estimated_bytes_includes_binary_payload` — binary dihitung (perbaikan A5).
- `shared_vs_unique_split_tracks_owners` — split shared/unique mengikuti owner.
- `wire_roundtrip_preserves_fields`, `array_paired_item_lineage_is_not_flattened`,
  `item_order_is_preserved_end_to_end` (I13), `consumer_iter_cloned_collect_pattern_compiles`.

## 6. Lifecycle Control Plane

- Task sudah di-claim sebelum sesi (status dikirim orchestrator).
- `start_task` RPC dicoba via `tools/orchestration/control_plane.py`:
  **GAGAL — environment blocker**: `SUPABASE_URL` / service key tidak tersedia
  di sandbox ini (`start_task -> 0 {'error': 'Missing Supabase URL or Service
  Key in configuration'}`). Tidak ada `.env` di repo (kredensial memang tidak
  boleh di-commit). Sesuai aturan fail-closed, pekerjaan dilanjutkan dan
  transisi `CLAIMED -> WORKING -> PR_OPEN` harus dilakukan orchestrator/bridge
  dengan kredensial yang sah.

## 7. Blocker / Ketergantungan

1. **Control Plane tidak terjangkau** (lihat §6) — transisi status task perlu
   dieksekusi pihak yang memegang kredensial Supabase.
2. **`n8n-nodes-rust` tidak dapat dibangun di sandbox** (tokio closure tidak
   di-vendor rig; sudah merupakan pengecualian rig bawaan sejak sebelum tugas
   ini) — tidak terdampak perubahan saya; crate itu tidak depend ke
   `n8n-execution-data`.
3. Catatan kecil untuk m3-03 (record.rs): `DataRecord::to_node_execution_data`
   saat ini deep-clone per panggilan; jika wire `INodeExecutionData` suatu saat
   dimigrasi ke `Arc` di `n8n-common` (milik agent lain), boundary conversion
   bisa dibuat sepenuhnya zero-copy. Tidak dalam scope tugas ini.

## 8. Catatan Branch

Platform Arena mengikat sesi ini ke branch `arena/01a0ba48-n8n-rust-v-4`
(dari `main` @ `6c828382`). Aturan sesi melarang pindah/membuat branch lain,
sehingga commit tugas ini berada di branch session tersebut dan mewakili
branch logis `data-plane/m3-m3-item-buffer`. PR dibuka dari branch session ke
`main` (tanpa merge — merge adalah wewenang Control Plane).
