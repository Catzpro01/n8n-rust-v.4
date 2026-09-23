# LEGO Contract: TypeScript Baseline Runtime (`n8n-ts-runtime`)

**Status**: ACTIVE BASELINE RUNTIME CONTRACT (Manager Governed)  
**Phase**: TypeScript LEGO Baseline Runtime (Rust FROZEN)  
**Target Environment**: `http://127.0.0.1:5678` -> Caddy -> `https://n8n.kentutmambu.my.id`

---

## 1. Tujuan & Prinsip Utama
1. **Single Source of Execution**: Seluruh eksekusi alur kerja wajib menggunakan `WorkflowExecutionEngine` dari `packages/reconstructed-engine/runner.mjs`. Dilarang membuat execution engine kedua.
2. **Rust Frozen**: Seluruh `crates/**` dan `apps/n8n-rust/**` berada dalam status BEKU (FROZEN). Tidak boleh ada kode Rust yang dimodifikasi atau ditambahkan.
3. **Reference Untouched**: Direktori `reference/n8n/**` hanya menjadi acuan perilaku (behavioral reference) dan dilarang dimutasi.
4. **Honest Node Capabilities**: Hanya 5 node eksekusi yang diklaim terverifikasi (`manualTrigger`, `set`, `code`, `noOp`, `if`). Node catalog lainnya (10 node) secara eksplisit berstatus `fallback/not-implemented` dan wajib menyertakan log peringatan passthrough.

---

## 2. Arsitektur & Pembagian Worker Paralel

| Worker | Peran | Boundary Direktori (Allowed) | Forbidden Paths |
|---|---|---|---|
| **Worker 1** | Runtime Server Host | `apps/n8n-ts/**` | `deploy/**`, `scripts/**`, `tests/**`, `packages/**`, `crates/**` |
| **Worker 2** | Packaging & Operations | `deploy/docker/**`, `scripts/{install,start,stop,upgrade,rollback,doctor}.sh`, `.env.example` | `apps/**`, `tests/**`, `packages/**`, `crates/**` |
| **Worker 3** | Quality & Smoke Gates | `tests/runtime/**`, `tests/integration/**`, workflow fixtures | `apps/**`, `deploy/**`, `packages/**`, `crates/**` |
| **Worker 4** | LEGO & Engine Integration | `packages/workflow-lego/**`, `packages/execution-lego/**`, `packages/reconstructed-engine/**` | `apps/**`, `deploy/**`, `tests/**`, `crates/**` |

---

## 3. Spesifikasi HTTP/API Endpoints

### 3.1. General Protocol
- Host default: `0.0.0.0` (dapat dikonfigurasi via `N8N_HOST` atau `HOST`).
- Port default: `5678` (dapat dikonfigurasi via `N8N_PORT` atau `PORT`).
- Engine: Murni menggunakan Node.js `node:http` (zero external framework dependency).

### 3.2. Authentication (`N8N_AUTH_TOKEN`)
- Jika `N8N_AUTH_TOKEN` kosong/tidak diatur:
  - Mode Open Development (autentikasi dinonaktifkan untuk mempermudah dev lokal).
- Jika `N8N_AUTH_TOKEN` diatur:
  - `GET /` dan `GET /healthz` tetap dapat diakses publik untuk pemantauan/probe.
  - Seluruh endpoint `/api/v1/*` mewajibkan salah satu dari:
    - Header `Authorization: Bearer <N8N_AUTH_TOKEN>`
    - Header `X-N8N-API-KEY: <N8N_AUTH_TOKEN>`
  - Jika token tidak cocok atau absen: Return HTTP `401 Unauthorized`:
    ```json
    {
      "ok": false,
      "code": 401,
      "message": "Unauthorized: valid N8N_AUTH_TOKEN or X-N8N-API-KEY required"
    }
    ```

### 3.3. Endpoint `GET /`
- **Tujuan**: Verifikasi aksesibilitas UI/Landing Page dan backward compatibility gate.
- **Status Code**: `200 OK`
- **Content-Type**: `text/html; charset=utf-8`
- **Invariant**: Body HTML wajib memuat teks `n8n` pada title dan konten agar lolos audit integrasi (`regression_gate.py`).

### 3.4. Endpoint `GET /healthz`
- **Tujuan**: Deep runtime initialization probe.
- **Syarat**: Bukan sekadar hardcoded 200; wajib menjalankan *probe test* instansiasi engine in-memory dan membaca resource sistem.
- **Status Code**: `200 OK` (atau `503 Service Unavailable` jika engine gagal merespons probe).
- **Content-Type**: `application/json; charset=utf-8`
- **Response Schema**:
  ```json
  {
    "status": "ok",
    "service": "n8n-ts-runtime",
    "version": "0.4.0-ts-baseline",
    "commit": "<GIT_COMMIT_SHA>",
    "pid": 12345,
    "uptime_seconds": 120,
    "auth": {
      "enabled": false
    },
    "engine": {
      "status": "ready",
      "initialized": true,
      "probeDurationMs": 0.35,
      "verifiedNodes": [
        "n8n-nodes-base.manualTrigger",
        "n8n-nodes-base.set",
        "n8n-nodes-base.code",
        "n8n-nodes-base.noOp",
        "n8n-nodes-base.if"
      ],
      "catalogFallbackNodes": [
        "n8n-nodes-base.webhook",
        "n8n-nodes-base.scheduleTrigger",
        "n8n-nodes-base.cron",
        "n8n-nodes-base.switch",
        "n8n-nodes-base.merge",
        "n8n-nodes-base.splitInBatches",
        "n8n-nodes-base.httpRequest",
        "n8n-nodes-base.respondToWebhook",
        "n8n-nodes-base.executeWorkflow",
        "n8n-nodes-base.wait"
      ]
    },
    "system": {
      "nodeVersion": "v22.22.3",
      "memory": {
        "rssMb": 42.1,
        "heapUsedMb": 22.3
      }
    }
  }
  ```

### 3.5. Endpoint `POST /api/v1/workflows/run` (Development Runtime API)
- **Tujuan**: Menerima dan mengeksekusi graf workflow nyata.
- **Status API**: *Development Runtime API* (bukan final n8n public REST API).
- **Request Format**: `Content-Type: application/json`
  ```json
  {
    "workflow": {
      "id": "wf-01",
      "name": "Smoke Test Flow",
      "nodes": [
        {
          "name": "Manual Trigger",
          "type": "n8n-nodes-base.manualTrigger",
          "parameters": {}
        },
        {
          "name": "Transform Output",
          "type": "n8n-nodes-base.set",
          "parameters": {
            "values": { "result": "PASS", "processed": true }
          }
        }
      ],
      "connections": {
        "Manual Trigger": {
          "main": [[{ "node": "Transform Output", "type": "main", "index": 0 }]]
        }
      }
    },
    "startNodeName": "Manual Trigger",
    "initialData": [ { "json": { "source": "api_client" } } ],
    "locale": "id"
  }
  ```
- **Response Format (Success)**: `200 OK`
  ```json
  {
    "ok": true,
    "apiStatus": "development_runtime_v1",
    "workflowId": "wf-01",
    "executionStatus": "COMPLETED",
    "finished": true,
    "durationMs": 1.85,
    "executionLog": [
      {
        "node": "Manual Trigger",
        "type": "n8n-nodes-base.manualTrigger",
        "inputCount": 1,
        "outputCount": 1,
        "durationMs": 0,
        "status": "success",
        "nodeLabel": "Pemicu Manual"
      },
      {
        "node": "Transform Output",
        "type": "n8n-nodes-base.set",
        "inputCount": 1,
        "outputCount": 1,
        "durationMs": 0,
        "status": "success",
        "nodeLabel": "Ubah Field (Set)"
      }
    ],
    "data": {
      "Manual Trigger": [ { "json": { "source": "api_client", "triggeredAt": "...", "status": "ACTIVE" } } ],
      "Transform Output": [ { "json": { "source": "api_client", "result": "PASS", "processed": true } } ]
    },
    "statusText": "Selesai"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Payload JSON tidak valid, `workflow` kosong (`nodes: []`), atau start node tidak ditemukan.
  - `401 Unauthorized`: Token autentikasi tidak valid saat `N8N_AUTH_TOKEN` aktif.
  - `422 Unprocessable Entity`: Siklus (cycle) terdeteksi pada graf workflow.

---

## 4. Node Capability & Fallback Matrix

| Node Type | Status | Eksekusi Real | Behavior saat Dijalankan |
|---|---|---|---|
| `n8n-nodes-base.manualTrigger` | **VERIFIED** | Ya | Memproduksi trigger item dengan timestamp & status active. |
| `n8n-nodes-base.set` | **VERIFIED** | Ya | Memodifikasi atribut JSON sesuai `parameters.values`/`parameters.fields`. |
| `n8n-nodes-base.code` | **VERIFIED** | Ya | Mengeksekusi blok kode JavaScript terhadap data item. |
| `n8n-nodes-base.noOp` | **VERIFIED** | Ya | Identity passthrough tanpa mutasi data. |
| `n8n-nodes-base.if` | **VERIFIED** | Ya | Evaluasi kondisi boolean untuk percabangan main output. |
| *10 Node Katalog Lainnya* | **FALLBACK** | Passthrough Terbimbing | Data diteruskan ke downstream dengan log peringatan eksplisit: `[FALLBACK] Node '<name>' (<type>) executed via passthrough fallback`. |

---

## 5. Operasional & Packaging Specification

Skrip operasional wajib disediakan di `scripts/`:
- `scripts/install.sh`: Setup node dependencies, copy `.env.example` ke `.env` jika belum ada, cek izin.
- `scripts/start.sh`: Menjalankan server runtime (support flag `--daemon` dengan PID tracking di `n8n-ts-runtime.pid`).
- `scripts/stop.sh`: Menghentikan server runtime dengan mengirim SIGTERM ke PID aktif.
- `scripts/doctor.sh`: Menjalankan diagnosa lingkungan (versi Node >= 18, port 5678, status HTTP probe `/healthz`, reverse proxy reachability).
- `scripts/upgrade.sh`: Melakukan sinkronisasi commit terbaru, verifikasi file, dan restart server.
- `scripts/rollback.sh`: Mengembalikan versi runtime ke snapshot/commit sebelumnya, me-restart proses, dan memverifikasi `/healthz`.

Docker Packaging:
- `deploy/docker/Dockerfile`: Multi-stage / lightweight Node.js runtime image dengan HEALTHCHECK terpasang.
- `deploy/docker/compose.yaml`: Menjalankan kontainer `n8n-ts-runtime` pada port 5678 dengan volume logging.

---

## 6. Test Gates Wajib (Pre-Merge & Pre-Deployment)
1. **Health Gate**: HTTP 200 pada `/healthz` dengan engine status initialized.
2. **Execution Gate**: Workflow 3-node (`manualTrigger` -> `code` -> `set`) menghasilkan status `COMPLETED`.
3. **Malformed Request Gate**: Input rusak mengembalikan HTTP 400 tanpa mematikan proses runtime.
4. **Empty Workflow Gate**: Workflow tanpa node ditolak dengan HTTP 400.
5. **Unknown Node Gate**: Node asing diproses secara aman melalui fallback atau ditolak dengan deskriptif.
6. **Auth Gate**: Token enforcement aktif saat `N8N_AUTH_TOKEN` diset, dan open saat dikosongkan.
7. **Process Restart Gate**: Stop dan start ulang mempertahankan ketersediaan port 5678.
8. **Regression Gate**: Seluruh kontrak yang sudah terverifikasi sebelumnya tetap lulus.
