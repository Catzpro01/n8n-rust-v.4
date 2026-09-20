# n8n-rust-v.4

High-Performance Rust Port of n8n with Arena AI Virtual SSH Engine.

The port never rewrites n8n from guesswork: n8n 2.9.4 is the behavioral
reference, every component is isolated behind an explicit contract, and only then
is a Rust replacement attempted.

## Project status

| Stage | State |
| :--- | :--- |
| ANATOMY (`docs/anatomy/`) | ✅ Completed |
| CONTRACT (`contracts/`) | ✅ Completed |
| REFERENCE SOURCE (`reference/n8n/`, n8n 2.9.4) | ✅ Completed |
| REFERENCE RUNTIME (baseline 11/11 smoke test) | ✅ Completed |
| WORKFLOW ISOLATION & LEGOS (01–04) | ✅ VERIFIED |
| **CURRENT PHASE** | **🚀 PHASE 3 — RUST RUNTIME (ACTIVE)** |
| RUST IMPLEMENTATION (8 Workspace Crates) | ✅ **ACTIVE** (`crates/` compiled & passing all tests) |

## Governance & Single Source of Truth (P0 Constitution)

Proyek ini berada di bawah tata kelola arsitektur tunggal (P0 Governance):
1. **Fase Resmi: PHASE 3 — RUST RUNTIME (ACTIVE)**. Fase isolasi Phase 2 telah selesai dan terverifikasi. Seluruh pengembangan runtime saat ini berada di Phase 3.
2. **Status Rust: ACTIVE**. Status Rust bukan lagi "not started" atau "reserved". Cargo workspace mendefinisikan dan mengompilasi 8 crates aktif (`n8n-common`, `n8n-workflow`, `n8n-connection`, `n8n-validation`, `n8n-node-model`, `n8n-execution-data`, `n8n-expression`, `n8n-nodes-rust`).
3. **Single Source of Truth**: Branch `main` adalah satu-satunya acuan kebenaran mutlak bagi semua agen. Dilarang melakukan rollback ke zero-Rust atau mengklaim fase sebelum Phase 3.
4. **Compatibility Baseline (n8n v2.9.4)**: Perilaku referensi n8n v2.9.4 dan kontrak formal dipertahankan penuh sebagai standar keabsahan perilaku engine.
5. **LEGO = Development Boundary, Bukan Runtime Overhead**: Pembagian LEGO hanya berfungsi sebagai batas modul dan pemisahan tugas saat isolasi/pengembangan. Pada hot-path runtime, engine tidak memecah eksekusi menjadi lapisan serialisasi JSON / IPC antar-crate yang berat, melainkan menggunakan representasi Runtime IR terpadu dengan alokasi minimal/zero-copy.
6. **Feature & Node Freeze**: Penambahan node baru dibekukan sementara hingga arsitektur Kernel Runtime IR (P1: `ExecutionContext`, `ExecutionFrame`, `NodeExecutor`, Data Plane) dibakukan.

## Structure

- `reference/n8n/` : pristine upstream n8n 2.9.4 source (read-only, hash-pinned)
- `docs/anatomy/` : system anatomy (18 documents)
- `contracts/` : formal LEGO contracts (`workflow`, `node`, `connection`, `validation`)
- `docs/isolation/` : Phase 2 isolation records, dependency map, port contract, verification report
- `packages/workflow-lego/` : the isolated Workflow Model LEGO (boundary, ports, tests, manifests)
- `tools/` : boundary mapper, kernel/port/reference gates, isolation extractor, model digest, gate runner, live engine harness
- `tests/reference/` : golden workflows + baseline smoke test evidence
- `tasks/`, `results/` : inbound task manifests and execution results
- `crates/` : active Rust implementation workspace (8 member crates)
- `docs/isolation/trigger-rust-port.md` : `trigger.lifecycle` port record (symbol map, divergences, evidence)
- `apps/n8n-rust/` : application entry point & runner

## Verify Rust Workspace

```bash
cargo check --workspace
cargo test --workspace
```

Without registry access (sandbox / review boxes) the offline rig builds the same crates
against the exact `Cargo.lock` versions; `n8n-nodes-rust` stays with the CI runner because
its `tokio` dev-dependency closure is not vendored:

```bash
tools/rust-offline-rig/setup.sh     # toolchain from npm + vendored crates from git
tools/rust-offline-rig/run.sh test
```

## Verify a Reference LEGO

```bash
scripts/setup-reference-runtime.sh        # n8n-workflow/core/nodes-base 2.9.1 == the n8n 2.9.4 dependency set
npm install --prefix packages/workflow-lego
npm run verify                            # 11 gates; writes docs/isolation/evidence/*

npm run verify:fast                       # same, without the live engine checks
npm run isolation:check                   # boundary + kernel + port + reference-integrity only
```

A failing gate means the isolation is void and must be rolled back — the records
are machine-readable in `docs/isolation/evidence/`.

## TypeScript baseline runtime (usable track)

Track terpisah yang membuat LEGO TypeScript bisa dipakai hari ini
(install → start → deploy VPS) sementara Rust tetap beku di track ini:

```bash
bash scripts/install.sh && bash scripts/start.sh && bash scripts/doctor.sh
npm run ts:test   # adapter (14) + runtime nyata (44) + integrasi (3)
```

Kontrak: `contracts/ts-baseline-runtime.contract.md` ·
Panduan: `docs/TS-BASELINE.md` · Bukti gate: `results/TS-BASELINE-GATES.md`.
