# LEGO Parallel Rules & Multi-Agent Governance

## 1. The 10 Core Rules (Phase 3 Active)
```text
┌─────────────────────────────────────┐
│          LEGO PARALLEL RULE         │
├─────────────────────────────────────┤
│ 1. One agent = one primary LEGO     │
│ 2. One LEGO = one lock owner        │
│ 3. Worktree isolated                │
│ 4. Contract is the communication    │
│ 5. No hidden dependency             │
│ 6. No direct internal modification  │
│ 7. Every change must be tested      │
│ 8. Regression test is mandatory     │
│ 9. Integration gate before merge    │
│10. Main must always remain runnable │
└─────────────────────────────────────┘
```

## 1.1 Governance & Architecture Invariants (P0 Constitution)
1. **CURRENT PHASE: PHASE 3 — RUST RUNTIME (ACTIVE)**.
2. **SINGLE SOURCE OF TRUTH**: Branch `main` adalah satu-satunya referensi kebenaran resmi.
3. **COMPATIBILITY BASELINE**: Seluruh kontrak formal n8n 2.9.4 dipertahankan penuh sebagai acuan conformance.
4. **LEGO = DEVELOPMENT BOUNDARY, BUKAN RUNTIME OVERHEAD**: LEGO memisahkan kepemilikan dan isolasi saat development. Pada runtime execution, hot-path dilarang menggunakan serialisasi/IPC berlapis antar-crate; runtime menggunakan unified minimal/zero-copy data plane.
5. **FEATURE & NODE FREEZE**: Pembuatan node baru dibekukan sementara hingga Kernel Runtime IR (P1) selesai.

## 2. Agent Assignments
| Agent | LEGO Assignment | Target Scope | Assigned Contract |
| :--- | :--- | :--- | :--- |
| **Agent 1** | `workflow` | Workflow Graph DAG & Model | `contracts/workflow.contract.md` |
| **Agent 2** | `node` | Node Model & Lifecycle Interfaces | `contracts/node.contract.md` |
| **Agent 3** | `connection` | Input/Output Routing & Pin Mapping | `contracts/connection.contract.md` |
| **Agent 4** | `validation` | Graph Cycle & Schema Validation | `contracts/validation.contract.md` |
| **Agent 5** | `integration` | Integration Guardian & Regression Gate | All Contracts & Baseline Suite |

## 3. Boundary Control (`allowed_paths` vs `forbidden_paths`)
Setiap task manifest agen mendefinisikan whitelist dan blacklist path yang diverifikasi oleh Arena Gateway:
```yaml
task: TASK-201
agent: agent-1
lego: workflow

allowed_paths:
  - reference/n8n/packages/workflow/**
  - docs/isolation/workflow.md

forbidden_paths:
  - reference/n8n/packages/core/**
  - reference/n8n/packages/cli/**
  # NOTE Phase 3: crates/** and apps/** are actively maintained workspace paths in Phase 3

requires:
  - contracts/workflow.contract.md

tests:
  - reference_smoke
  - workflow_tests
```

## 4. Regression Gate Protocol
Sebelum branch agen dapat digabungkan ke `main`:
1. **11/11 Smoke Test Baseline** harus tetap 100% lolos (jika 11/11 berubah menjadi 10/11, perubahan otomatis **DITOLAK**).
2. **Tidak ada pelanggaran kontrak** antar LEGO.
3. **Agent 5 (Integration Guardian)** bertindak sebagai gatekeeper yang memvalidasi integritas sistem secara menyeluruh.
4. Branch `main` **selalu dalam status runnable dan production-ready**.
