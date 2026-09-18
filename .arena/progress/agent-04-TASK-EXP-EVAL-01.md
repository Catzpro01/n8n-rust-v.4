# ARENA PROGRESS — agent-04 / TASK-EXP-EVAL-01

- **Agent**: `agent-04` (Expression Engine, Sandbox & Execution Data Plane)
- **Task**: `TASK-EXP-EVAL-01` — sub-LEGO `expression.evaluator` (+ `expression.compiler`)
- **Command**: `cargo test -p n8n-expression`
- **Session branch**: `arena/01a0b4ad-n8n-rust-v-4` (from `agent-04/expression-evaluator`)
- **Last updated**: 2026-09-18 (session 2)

---

## 1. Ringkasan Tugas Sesi Ini

Memperluas `crates/n8n-expression` dari evaluator pilot minimal menjadi
evaluator kontrak-penuh-bertingkat sesuai `contracts/expression.contract.md`
dan `contracts/graph_expression.contract.md`, **tanpa mengubah** file milik
agen lain (`n8n-common`, `n8n-workflow`) dan **tanpa merusak** integrasi
agent-01 ⇄ agent-04 yang sudah diratifikasi.

## 2. Yang Sudah Dikerjakan (Completed Work & Evidence)

### Fitur bahasa baru (parser.rs — tulis ulang besar)
- Escape string penuh: `\n \t \r \0 \b \f \\ \' \" \/ \uXXXX` (escape tak
  dikenal → karakter literal, kompatibel JS `"\q" === "q"`).
- Operator ternary `?:` (right-associative) & modulo `%` (`%` JS-sign:
  tanda mengikuti dividen).
- Alias strict: `===` / `!==` dipetakan ke equality struktural yang sama.
- Literal array `[a, b]` & objek `{k: v, "k": v}`.
- Angka: eksponen `1e3`, `2.5e-2`, leading-dot `.5`.
- Sintaks pemanggilan: `expr.method(args)` (method chain penuh) dan
  extended functions `$if $min $max $average $avg $not $ifEmpty`.
- Handle node `$('Node Name')`; bare `$` ditolak (E9).
- Indeks dinamis: `$json[$vars.key]`.
- Scanner template quote-aware: `}}` dalam string tidak menutup blok
  (`={{ 'a}}b' }}` → `a}}b`).
- Depth guard 128 level (fail-closed → `SyntaxError`, anti stack-overflow
  untuk input jahat seperti 1000 kurung bersarang).
- Marker `=`: `"="` → `""`, `"=text"` → `"text"` (kontrak §3); `is_expression`
  kini mengikuti E1 (prefiks `=`) + heuristik handlebars ratifikasi.

### Evaluator (evaluator.rs — tulis ulang besar)
- `RuntimeValue` internal (`Json | NodeRef`): handle `$()` hanya
  termaterialisasi lewat member access.
- `$('Node').first()/last()/all()`, `.json`, `.item`, `.isExecuted`,
  `.params` fail-closed (trait belum expose parameter node).
- Short-circuit JS untuk `&&`/`||` (sisi kanan tak dievaluasi bila hasil
  sudah pasti — juga melindungi lookup kanan dari error, seperti upstream).
- Interpolasi template sesuai kontrak §3: `null` → `""`, objek →
  `[object Object]`, array → join `,`.
- Perbandingan `< <= > >=` pada dua string → leksikografis (JS parity).
- `.length` sebagai *property* pada string/array (satuan UTF-16 untuk string).
- `expr[i]` pada string → karakter ke-i.

### extensions.rs (baru)
- Method whitelist per tipe sesuai E12 (`isEmpty/isNotEmpty/length/trim/
  toUpperCase/toLowerCase/split/contains/startsWith/endsWith/replace/
  replaceAll/slice/substring/charAt/indexOf/padStart/padEnd/repeat/
  urlEncode/urlDecode/first/last/join/push*/concat/reverse/sort/unique/
  indexOf/sum/avg/min/max/pluck/compact/round/floor/ceil/abs/sqrt/pow/
  toFixed/isEven/isOdd/toString/toNumber/toBoolean`). `*` = immutable
  divergence (mengembalikan array baru, didokumentasikan di header modul).
- Extended functions: `$if $not $ifEmpty $min $max $average $avg`
  (menerima variadic atau satu array).
- Divergensi ketat yang didokumentasikan: konversi angka gagal → `TypeError`
  (bukan `NaN`), method tak dikenal → `TypeError` (bukan `undefined`).

### sandbox.rs (baru)
- Gate statis pra-parse (E9): `\.\s*constructor`, `__proto__`, `prototype`,
  `with`, `class` → `SyntaxError`. String literal di-blank dulu agar
  kata-kata tersebut di dalam string tetap sah (paritas upstream).

### Uji
- `lib.rs` kini memuat 20+ test termasuk **guard regresi pilot** (5 test
  lama dipertahankan verbatim) dan coverage semua fitur baru + kasus error
  fail-closed (NodeNotFound, sandbox, depth guard, `%0`, dsb.).
- `extensions.rs` dan `sandbox.rs` punya modul test sendiri.

## 3. Keputusan Teknis Penting

1. **Bentuk AST lama dipertahankan**: `JsonPath`/`NodeLookup` tetap lewat
   folding postfix (`attach_field`/`attach_index`) sehingga ekspresi lama
   menghasilkan bentuk AST persis sama. Varian baru hanya muncul untuk
   sintaks baru → risiko regresi nol untuk test integrasi agent-01.
2. **Fail-closed di mana upstream `undefined`**: kontrak E3 backend-
   behaviour (`undefined`) dipetakan ke error terstruktur sesuai model
   error ketat proyek yang sudah diratifikasi (`ExpressionError`).
3. **`is_expression` diperluas** ke prefiks `=` (E1): string non-ekspresi
   yang diawali `=` kini dievaluasi (`=text` → `text`), konsisten dengan
   kontrak §3. Heuristik handlebars tetap agar integrasi pilot agent-01
   (greeting tanpa `=`) tak rusak.
4. **Tanpa dependensi baru**: tanggal/DateTime (`$now`, `.toDateTime()`)
   dan `$jmespath` sengaja TIDAK diimplementasi (tidak boleh menambah
   `luxon`/`chrono`/`jmespath` — Cargo.lock global read-only). Pemakaian
   gagal tertutup: `$jmespath(...)` → "Unknown identifier".

## 4. Bukti Verifikasi

- ✅ **`cargo test` TERJALANKAN NYATA di sandbox** via `tools/rust-offline-rig`
  (toolchain rustc/cargo 1.88.0 dari npm + 24 crates vendored dari git;
  diperbaiki komit `b15528a2`):
  - `run.sh test` → **`n8n_expression`: 37/37 PASS** (5 regresi pilot +
    32 kontrak/bahasa di `lib.rs`/`extensions.rs`/`sandbox.rs`).
  - `run.sh test` keseluruhan workspace → **SEMUA PASS**:
    `n8n_common` 0, `n8n_connection` 2, `n8n_execution_data` 3,
    `n8n_expression` 37, `n8n_node_model` 1, `n8n_validation` 4,
    `n8n_workflow` 53 unit + conformance 2 + **`graph_expression_integration`
    1 (E2E + benchmark)** + `reference_fixtures` 5 + `trigger_lifecycle` 3.
  - `run.sh check --all-targets` → **0 warning**.
  - Benchmark integrasi: **67.25 µs / evaluasi node penuh** (10.000
    evaluasi, debug build) — memenuhi gate < 100 µs dan target sub-milidetik.
- Gate offline non-Rust:
  - `node tests/compatibility/contract_conformance.mjs` → **20/21 PASS**
    (1 FAIL = guard usang "Phase 2: no Rust" — PRE-EXISTING di HEAD, Phase 3
    secara resmi ACTIVE per PROJECT_RULES §0.1; milik agent-05).
  - `python3 tests/integration/boundary_audit.py` → temuan yang sama
    (PRE-EXISTING, guard usang yang sama).

### Cara menjalankan ulang verifikasi
```bash
tools/rust-offline-rig/setup.sh            # sekali per sandbox (~2 menit)
tools/rust-offline-rig/run.sh test -p n8n-expression
tools/rust-offline-rig/run.sh check
```

## 5. Sisa Gap Kontrak (untuk koordinasi lintas-LEGO, BUKAN blocker task ini)

Butuh perluasan trait `EvaluationContext` (milik ratifikasi agent-01/agent-03):
- `$input`, `$prevNode`, `$parameter`, `$workflow`, `$execution`/`$vars`-full,
  `$binary`, mode pin-data (`manual`), `binaryMode === 'combined'`.
- Alur `pairedItem` penuh (`$('X').item` pairing chain, `itemMatching`).
- DateTime: `$now`, `$today`, `.toDateTime()`, `.format()` (butuh keputusan
  dependensi tanggal tingkat workspace).
- `$jmespath` (butuh crate jmespath — usulkan penambahan ke agent-05/infra).
- Timeout evaluasi: varian `ExpressionError::Timeout` sudah ada; strategi
  budget (fuel counter) bisa ditambahkan di iterasi berikut.

## 6. Petunjuk Sesi Penerus

1. Verifikasi ulang cepat: `tools/rust-offline-rig/run.sh test -p n8n-expression`
   (rig sudah berfungsi penuh; 37 test hijau per sesi ini).
2. Bila perlu perbaikan, lakukan DI `crates/n8n-expression/src/**` saja —
   jangan menyentuh crate lain tanpa kontrak formal.
3. PR harus membiarkan guard stale Phase-2 di gate offline apa adanya
   (owned oleh agent-05); dokumenkan di deskripsi PR.
4. Optimasi berikutnya yang layak: AST cache (parse-sekali-evaluasi-banyak)
   — benchmark saat ini 67 µs/evaluasi; meng-cache AST bisa memangkas
   sebagian besar waktu parse.
