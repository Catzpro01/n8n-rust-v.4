# LEGO Parallel Rules & Multi-Agent Governance

## 1. The 10 Core Rules
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
  - crates/**
  - apps/**

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
