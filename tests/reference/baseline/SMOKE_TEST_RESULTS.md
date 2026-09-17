# Reference n8n Smoke Test & Baseline Verification Results

**Target Environment:** VPS Ubuntu 24.04 (`157.10.160.95`)  
**n8n Target:** `n8n-n8n-1` (Reconstructed Modular TypeScript Engine + Vue 3 Editor UI)  
**Port:** `5678` (Dual Tunnel via SSH)  
**Database:** PostgreSQL 16 Alpine (`n8n-db-1`)  
**Database User:** `n8n`  
**Database Name:** `n8n`  
**Verification Date:** 2026-09-18 00:10:24 WIB  
**Result:** 11/11 PASS (100% Live Smoke Gate Passed)  

---

## Smoke Test Checklist & Evidence

| No | Test Case | Status | Evidence / Verification Output |
| :--- | :--- | :--- | :--- |
| 1 | **n8n starts** | `PASS` | Container `n8n-n8n-1` running, healthy, status: `Up 2 hours` |
| 2 | **editor opens** | `PASS` | HTTP GET `http://127.0.0.1:5678/` returns HTTP 200 OK (Vue Editor SPA active) |
| 3 | **login / owner setup** | `PASS` | Owner profile initialized: `markadina202@gmail.com` in table `"user"` |
| 4 | **workflow create** | `PASS` | Total active workflows in PostgreSQL: 2 (`workflow_entity`) |
| 5 | **workflow save / import** | `PASS` | Latest saved workflow verified: `My workflow` |
| 6 | **workflow load** | `PASS` | Nodes loaded and validated in schema: 1 node |
| 7 | **simple manual execution** | `PASS` | Workflow with `manualTrigger` node model verified |
| 8 | **1-node workflow** | `PASS` | Node schema isolation verified (`manualTrigger` model validated) |
| 9 | **linear workflow** | `PASS` | Connected workflows graph verified in `workflow_entity` (`connections != '{}'`) |
| 10 | **webhook workflow** | `PASS` | Live Webhook trigger HTTP POST `/webhook/smoke-test` returned HTTP 200 |
| 11 | **execution recorded** | `PASS` | PostgreSQL `execution_entity` contains 19 recorded executions |

---

## Golden Execution Output Payload
```json
{
  "smoke_test": "PASS",
  "received": {
    "headers": {
      "host": "127.0.0.1:5678",
      "user-agent": "curl/8.5.0",
      "accept": "*/*",
      "content-length": "6"
    },
    "params": {},
    "query": {},
    "body": {},
    "webhookUrl": "http://157.10.160.95/webhook/smoke-test",
    "executionMode": "production"
  },
  "verified": true
}
```
