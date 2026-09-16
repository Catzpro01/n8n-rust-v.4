# N8N Reference Version & Environment Baseline

## System Identification
- **n8n Version:** 2.9.4
- **Git Commit:** b6dc2787c45677a29a9612cd27eb911302961a83
- **Upstream Repository:** https://github.com/n8n-io/n8n
- **Node Version:** 24.13.1 (Alpine 3.22)
- **Package Manager:** pnpm
- **Build Command:** pnpm build
- **Start Command:** pnpm start
- **Production Database:** PostgreSQL 16
- **Cache / Broker:** Redis 7
- **Verification Date:** 2026-09-17

---

## Baseline Functional Health Matrix

| Component | Status | Verification Detail |
| :--- | :--- | :--- |
| **Health check** | PASS | GET /healthz returned 200 OK |
| **Editor UI** | PASS | GET / rendered complete Vue 3 canvas |
| **Workflow create** | PASS | Workflow SMOKETEST001TEST created & stored |
| **Workflow save/import** | PASS | 
8n import:workflow confirmed in PostgreSQL workflow_entity |
| **Workflow execute** | PASS | Execution ID 1 & 2 recorded with status: success |
| **Webhook** | PASS | POST /webhook/smoke-test processed & responded |

---

## Reference Invariants
1. eference/n8n/ represents the pure uncorrupted upstream reference source.
2. No local modifications or premature rewrites are permitted in this directory.
3. Production runtime on VPS remains active and untouched.
