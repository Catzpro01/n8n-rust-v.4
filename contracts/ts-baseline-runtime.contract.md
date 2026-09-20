# TypeScript Baseline — Runtime & API Contract (STABLE)

Status: **STABLE — BASELINE FROZEN CANDIDATE**
Owner: MANAGER (Arena Agent Mode)
Date: 2026-09-20
Scope: TypeScript LEGO baseline only. Rust (`crates/**`, `apps/n8n-rust`) is **FROZEN** and out of scope.
Reference: `contracts/api.contract.md` (n8n 2.9.4 envelope), `contracts/workflow.contract.md`,
`contracts/execution.contract.md`. This baseline contract is a **minimal compatible subset** —
it MUST NOT contradict the reference envelopes.

Tujuan baseline (definisi "usable"):

- mudah di-install (satu skrip install)
- mudah dijalankan (satu skrip start, satu health check)
- mudah di-oprek (kode kecil, tanpa framework, dependensi nol di runtime)
- mudah di-upgrade / rollback (skrip upgrade + rollback)
- mudah di-debug (log terstruktur, doctor script, test melawan runtime nyata)
- dapat berjalan di VPS (Docker + Node langsung, systemd tidak wajib)
- menjadi baseline sebelum migrasi LEGO → Rust satu per satu

---

## 1. Runtime shape

| Aspek | Keputusan (frozen untuk baseline) |
|---|---|
| Bahasa | TypeScript (strict), dikompilasi ke JS dengan `tsc`, dijalankan dengan `node` |
| HTTP server | **Hanya `node:http`** — DILARANG express/fastify/koa/hono di baseline |
| Lokasi kode | `apps/n8n-ts/**` (satu-satunya runtime server yang boleh berkembang) |
| Engine | **WAJIB** memakai `packages/reconstructed-engine` (tidak boleh membuat engine kedua) |
| Dependensi runtime | **NOL** (`dependencies: {}`) — hanya `node:*` bawaan |
| Dependensi dev | `typescript`, `@types/node` saja |
| Port default | `5678` (sama dengan n8n) via `PORT` |
| Host default | `0.0.0.0` via `HOST` (wajib agar preview/proxy VPS bisa akses) |
| Node minimum | Node.js 20 LTS (22 direkomendasikan) |
| Shutdown | Graceful: `SIGTERM`/`SIGINT` → stop accept → drain ≤ 10 detik → exit 0 |

DILARANG di baseline:

- Membuat Rust server / menyentuh `crates/**` / mengembangkan `apps/n8n-rust`.
- Mengubah `reference/n8n/**` (read-only, hash-pinned).
- Menambah framework HTTP, ORM, queue, auth, atau fitur besar di luar §2.
- Membuat execution engine kedua (validasi + eksekusi harus reuse LEGO yang ada).

---

## 2. API surface (frozen: 3 endpoint)

Baseline hanya memiliki **3 endpoint**. Endpoint lain = 404 JSON (bukan HTML).

### 2.1 `GET /`

Tujuan: landing + discovery untuk manusia dan smoke test.

- Request: tanpa body, tanpa auth.
- Response: `200`, `Content-Type: application/json`, body:

```json
{
  "name": "n8n-ts-baseline",
  "version": "0.1.0",
  "status": "ok",
  "endpoints": ["GET /", "GET /healthz", "POST /api/v1/workflows/run"]
}
```

- `version` WAJIB sama dengan `apps/n8n-ts/package.json` `version`.
- Tidak boleh redirect, tidak boleh HTML.

### 2.2 `GET /healthz`

Tujuan: liveness probe (Docker HEALTHCHECK, systemd, load balancer, smoke test).

- Kompatibel dengan `contracts/api.contract.md` §3: `GET /healthz → 200 {"status":"ok"}`.
- Baseline boleh menambah field, tetapi `status: "ok"` WAJIB ada:

```json
{
  "status": "ok",
  "uptimeSec": 123,
  "version": "0.1.0"
}
```

- `uptimeSec`: integer ≥ 0 (floor dari `process.uptime()`).
- Selalu `200` selama proses hidup. Tidak boleh 503 di baseline (tidak ada DB).
- `HEAD /healthz` diperlakukan sama seperti `GET` tanpa body (opsional, tidak diuji).

### 2.3 `POST /api/v1/workflows/run`

Tujuan: mengeksekusi satu workflow secara sinkron memakai LEGO engine.

Request:

- Method: hanya `POST`. Method lain ke path ini → `405 { code, message }`.
- `Content-Type` harus mengandung `application/json` → jika tidak, `415 { code: 415, message }`.
- Body JSON (limit default 1 MiB, diatur via `BODY_LIMIT_BYTES`):

```json
{
  "workflow": {
    "nodes": [{ "name": "Start", "type": "n8n-nodes-base.manualTrigger", "parameters": {} }],
    "connections": {},
    "activeLocale": "id"
  },
  "input": [{ "hello": "world" }],
  "startNode": "Start",
  "locale": "id"
}
```

| Field | Wajib | Aturan |
|---|---|---|
| `workflow` | Ya | object dengan `nodes: array` (boleh kosong → error EMPTY_WORKFLOW, lihat §3) dan `connections: object` (default `{}`) |
| `workflow.nodes[].name` | Ya | string non-kosong, unik |
| `workflow.nodes[].type` | Ya | string non-kosong |
| `workflow.nodes[].parameters` | Tidak | object, default `{}` |
| `workflow.connections` | Tidak | object peta `nodeName -> { main: [...] }`, default `{}` |
| `input` | Tidak | array item JSON atau satu object; default `[{}]` |
| `startNode` | Tidak | string nama node; default: trigger pertama, else node pertama |
| `locale` | Tidak | salah satu `id jv ar zh ru en`; default `id`; nilai tak dikenal → fallback `id` (tidak error) |

Response sukses:

- `200`, `Content-Type: application/json`.
- Envelope mengikuti `contracts/api.contract.md` §3 (`{ data: <result> }`):

```json
{
  "data": {
    "status": "COMPLETED",
    "finished": true,
    "executionLog": [
      { "node": "Start", "type": "n8n-nodes-base.manualTrigger", "inputCount": 1, "outputCount": 1, "durationMs": 0, "status": "success" }
    ],
    "data": {
      "Start": [{ "json": { "triggeredAt": "...", "status": "ACTIVE" } }]
    }
  }
}
```

- `data.status` ∈ `COMPLETED` (sukses). Baseline tidak memiliki status lain.
- `data.finished` selalu `true` di baseline (sinkron, tidak ada waiting).
- `data.executionLog` array dengan satu entri per node yang dieksekusi, urutan BFS dari engine.
- `data.data` peta `nodeName -> [{ json: {...} }]` (format item n8n).
- Field human-facing tambahan (`nodeLabel`, `statusText`, terjemahan) DIPERBOLEHKAN sebagai **additive-only**
  dari locale enforcer — test TIDAK BOLEH gagal karena field tambahan ini, dan TIDAK BOLEH ada field
  machine (`name`, `type`, `parameters`) yang berubah nilainya karena locale.

---

## 3. Error contract (frozen)

Semua error baseline memakai envelope `{ code, message }` + optional `hint`:

```json
{ "code": 400, "message": "...", "hint": "optional" }
```

- `code` = HTTP status (number), kecuali error domain memakai string code di `message` prefix?
  TIDAK — baseline memakai number code = HTTP status, dan `message` menjelaskan domain.
  String domain code (`EMPTY_WORKFLOW`, `UNKNOWN_NODE`, dll) ditaruh di `hint` agar envelope
  tetap kompatibel dengan `contracts/api.contract.md` §3 (`{ code, message, hint?, meta? }`).
- `stacktrace` DILARANG di response (bahkan di development) untuk baseline — stack hanya ke log server.
- `Content-Type` error selalu `application/json`.

| Kondisi | HTTP | `code` | `message` (prefix, boleh ada detail) | `hint` |
|---|---|---|---|---|
| Body bukan JSON valid | 400 | 400 | `Invalid JSON body` | `MALFORMED_JSON` |
| `Content-Type` bukan JSON | 415 | 415 | `Content-Type must be application/json` | `UNSUPPORTED_MEDIA_TYPE` |
| Body > limit | 413 | 413 | `Request body too large` | `PAYLOAD_TOO_LARGE` |
| `workflow` hilang / bukan object | 400 | 400 | `Field 'workflow' is required` | `MALFORMED_REQUEST` |
| `workflow.nodes` bukan array | 400 | 400 | `Field 'workflow.nodes' must be an array` | `MALFORMED_REQUEST` |
| `workflow.nodes` kosong | 400 | 400 | `Workflow has no nodes` | `EMPTY_WORKFLOW` |
| node tanpa `name`/`type` valid | 400 | 400 | `Node at index N has invalid name/type` | `MALFORMED_REQUEST` |
| nama node duplikat | 400 | 400 | `Duplicate node name "..."` | `MALFORMED_REQUEST` |
| `startNode` menunjuk node tak ada | 400 | 400 | `Start node "..." not found` | `UNKNOWN_NODE` |
| koneksi menunjuk node tak ada | 400 | 400 | `Connection references unknown node "..."` | `UNKNOWN_NODE` |
| `input` bukan object/array | 400 | 400 | `Field 'input' must be an object or array` | `MALFORMED_REQUEST` |
| node type tanpa handler (unknown type) | — | — | **BUKAN error**: passthrough (lihat §4) | — |
| Method salah | 405 | 405 | `Method Not Allowed` | `METHOD_NOT_ALLOWED` |
| Path tak dikenal | 404 | 404 | `Not Found` | `NOT_FOUND` |
| Engine throw tak terduga | 500 | 500 | `Workflow execution failed` | `EXECUTION_FAILED` |

Catatan kompatibilitas: `contracts/api.contract.md` memakai `404 html` untuk SPA fallback.
Baseline TIDAK memiliki SPA — semua 404 adalah JSON. Ini adalah deviasi yang disengaja dan
terdokumentasi; saat editor SPA ditambahkan nanti, kontrak ini diamendemen.

---

## 4. Execution semantics (reuse LEGO, bukan engine baru)

- Runtime WAJIB memanggil `WorkflowExecutionEngine` dari `packages/reconstructed-engine/runner.mjs`
  (langsung atau via adapter `packages/reconstructed-engine/ts-runtime-adapter.mjs` milik Worker 4).
- DILARANG menyalin loop BFS eksekusi ke `apps/n8n-ts` — jika loop itu ada di dua tempat, itu
  adalah pelanggaran "execution engine kedua" dan gate regression WAJIB gagal.
- Node type tanpa handler terdaftar → **passthrough**: output = input, `status: success`,
  `executionLog` tetap mencatat node tersebut. Ini adalah perilaku `runner.mjs` yang dipertahankan.
- Handler bawaan baseline (minimal, mudah di-oprek, terdaftar di `apps/n8n-ts/src/engine.ts`):

| `type` | Perilaku |
|---|---|
| `n8n-nodes-base.manualTrigger` | mengabaikan input, mengembalikan `[{ json: { triggeredAt: <ISO>, status: "ACTIVE" } }]` |
| `n8n-nodes-base.noOp` | passthrough |
| `n8n-nodes-base.set` | jika `parameters.keepOnlySet` + `parameters.values` didukung → set sederhana; else passthrough + `set: true` marker? **Baseline: passthrough murni** (transform kompleks di luar baseline) |
| `n8n-nodes-base.code` | jika `parameters.jsCode` string → TIDAK dieksekusi di baseline (alasan keamanan); passthrough + marker `codeSkipped: true`. Eksekusi JS user adalah fitur besar, di luar baseline |
| `n8n-nodes-base.if` | passthrough ke output pertama (branch penuh di luar baseline) |
| lainnya | passthrough |

- Validasi struktur workflow SEBELUM eksekusi (di runtime, memakai helper validasi milik Worker 4
  jika tersedia, else validasi lokal minimal di `apps/n8n-ts` — validasi bukan engine, jadi boleh lokal).
- Koneksi `connections[nodeName].main[outputIndex][connIndex] = { node, type, index }`.
  Hanya `main` yang dibaca di baseline; tipe koneksi lain diabaikan (tidak error).
- Eksekusi sinkron dengan timeout default 30 detik (`EXECUTION_TIMEOUT_MS`); timeout → `500 EXECUTION_FAILED`.
  (Implementasi boleh `Promise.race`; tidak perlu worker thread di baseline.)
- Locale: `locale` request → diteruskan ke engine sebagai `activeLocale`; engine menambahkan
  field human-facing saja, tidak mengubah machine fields (dijaga oleh `localization.mjs`).

---

## 5. Configuration (frozen keys)

| Env | Default | Deskripsi |
|---|---|---|
| `HOST` | `0.0.0.0` | bind address |
| `PORT` | `5678` | listen port (1–65535, else fallback 5678 + warn log) |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` (tak dikenal → `info` + warn) |
| `BODY_LIMIT_BYTES` | `1048576` | max JSON body (min 1024, max 10 MiB) |
| `EXECUTION_TIMEOUT_MS` | `30000` | timeout eksekusi workflow (min 1000, max 300000) |
| `N8N_LOCALE` | `id` | locale default engine |
| `NODE_ENV` | `production` | `production` \| `development` \| `test` (hanya memengaruhi verbosity log, bukan envelope) |

- Semua config dibaca sekali saat boot, divalidasi, nilai efektif di-log satu baris
  (`[config] host=... port=... ...`) agar mudah di-debug.
- `.env` file didukung (dibaca manual tanpa dependensi — parser `KEY=VALUE` sederhana, bukan `dotenv`
  package, agar runtime tetap nol dependensi). `scripts/install.sh` menyalin `.env.example → .env` jika belum ada.
- Perubahan config butuh restart (tidak ada hot-reload di baseline).

---

## 6. Observability & operability

- Log format: satu baris per event, prefix `[level]`, contoh:
  `[info] listening on 0.0.0.0:5678`, `[info] POST /api/v1/workflows/run 200 12ms`,
  `[warn] unknown node type "x" — passthrough`, `[error] execution failed: ...`.
- `GET /` dan `GET /healthz` tidak menulis log per-request di level `info` (agar healthcheck tidak
  membanjiri log); hanya di `debug`.
- `POST /api/v1/workflows/run` selalu log satu baris ringkas (method, path, status, durationMs,
  nodeCount) di `info`, detail di `debug`.
- Docker HEALTHCHECK: `node -e "fetch('http://127.0.0.1:5678/healthz')..."` atau `wget -qO-`.
- `scripts/doctor.sh` memvalidasi: node version, port listen, `/healthz`, `/`, satu workflow run,
  file `.env`, artefak build, dan (jika ada) container Docker.

---

## 7. Packaging & lifecycle (untuk Worker 2)

- `scripts/install.sh`: clean machine (Ubuntu 22.04/24.04) → install Node 22 (via NodeSource jika perlu)
  → `npm ci`/`npm install` di `apps/n8n-ts` → `npm run build` → salin `.env.example` → verifikasi `doctor.sh`.
- `scripts/start.sh`: idempoten; jika Docker tersedia dan image dibangun → `docker compose up -d`;
  else `node apps/n8n-ts/dist/server.js` via `nohup` + PID file `.runtime-ts/server.pid`. Mendukung `PORT`/`HOST` override.
- `scripts/stop.sh`: menghentikan keduanya (compose down + bunuh PID) secara aman (tidak error jika sudah berhenti).
- `scripts/upgrade.sh`: `git pull` (atau arsip) → backup `dist/` + `.env` ke `.runtime-ts/backups/<ts>` →
  rebuild → restart → smoke test; gagal → auto-rollback.
- `scripts/rollback.sh`: mengembalikan backup terakhir → restart → smoke test.
- `deploy/docker/Dockerfile`: `node:22-alpine`, non-root user, hanya menyalin `apps/n8n-ts` +
  `packages/reconstructed-engine` (+ `packages/workflow-lego`, `packages/execution-lego` jika dibutuhkan adapter),
  `npm ci --omit=dev` tidak cukup (butuh build) → multi-stage build.
- `deploy/docker/docker-compose.yml`: satu service `n8n-ts`, `restart: unless-stopped`,
  `ports: ["${PORT:-5678}:5678"]`, `healthcheck` ke `/healthz`.

---

## 8. Testing (untuk Worker 3)

Test WAJIB melawan **runtime nyata** (spawn `node dist/server.js` di port ephemeral, hit HTTP):

| File | Kasus |
|---|---|
| `tests/runtime/01-health.test.mjs` | `GET /` shape, `GET /healthz` shape, 404 JSON, 405 |
| `tests/runtime/02-workflow-execution.test.mjs` | linear 2-node sukses, envelope `{data}`, `COMPLETED`, `executionLog` |
| `tests/runtime/03-malformed.test.mjs` | invalid JSON → 400, hilang `workflow` → 400, `nodes` bukan array → 400, content-type salah → 415, body > limit → 413 |
| `tests/runtime/04-empty-workflow.test.mjs` | `nodes: []` → 400 `EMPTY_WORKFLOW` |
| `tests/runtime/05-unknown-node.test.mjs` | `startNode` tak ada → 400 `UNKNOWN_NODE`; koneksi dangling → 400; type tanpa handler → 200 passthrough |
| `tests/runtime/06-restart.test.mjs` | start → kill SIGTERM graceful → start lagi → health ok + run ok |
| `tests/runtime/07-configuration.test.mjs` | `PORT` override, `PORT` invalid fallback, `LOG_LEVEL` invalid fallback, `.env` parsing |
| `tests/runtime/08-regression.test.mjs` | tidak ada engine kedua (grep loop BFS), envelope stabil, locale additive-only, `crates/**` + `reference/n8n/**` tak tersentuh |
| `tests/integration/ts-baseline-smoke.test.mjs` | end-to-end memakai fixtures `tests/reference/02-one-node`, `03-linear` |

Semua test harus lulus dengan `node --test tests/runtime/*.test.mjs` setelah `npm run build`.

---

## 9. LEGO integration (untuk Worker 4)

- Audit WAJIB mendokumentasikan: simbol apa dari `workflow-lego`, `execution-lego`,
  `reconstructed-engine` yang dipakai runtime, dan simbol apa yang SENGAJA tidak dipakai di baseline.
- Adapter `packages/reconstructed-engine/ts-runtime-adapter.mjs` MENYEDIAKAN (frozen interface):

```js
export function validateBaselineWorkflow(workflow) // → { ok, errors: [{message, hint}] }
export function createBaselineEngine(workflow, opts) // → WorkflowExecutionEngine + handler terdaftar
export const BASELINE_KNOWN_NODE_TYPES // array string type yang punya handler bawaan
```

- Runtime (`apps/n8n-ts/src/engine.ts`) WAJIB memakai adapter ini — bukan mengimpor `runner.mjs`
  secara ad-hoc dengan logika validasi sendiri yang menyimpang.
- `workflow-lego` dan `execution-lego` di baseline dipakai **secara dokumentasi + validasi ringan saja**;
  runtime TIDAK WAJIB mengimpor keduanya secara kode jika itu menambah dependensi (`n8n-workflow`).
  Yang WAJIB: tidak ada logika graph/checksum/execution yang diduplikasi — jika dibutuhkan, impor dari LEGO.

---

## 10. Acceptance criteria (BASELINE FROZEN gate)

Manager TIDAK BOLEH menyatakan `TYPESCRIPT BASELINE FROZEN` sebelum semua lulus:

1. [ ] Kontrak ini stabil (tidak berubah selama Worker 1–4 berjalan).
2. [ ] Worker 1–4 selesai tanpa pelanggaran boundary (audit file overlap = nol).
3. [ ] `npm run build` di `apps/n8n-ts` sukses tanpa error/warning TS.
4. [ ] `node --test tests/runtime/*.test.mjs` = 8/8 file lulus.
5. [ ] `scripts/doctor.sh` = OK di laptop runner.
6. [ ] `docker build` + `docker compose up` + smoke test = OK.
7. [ ] Deploy ke VPS runner `vps-runtime` = OK.
8. [ ] Live smoke `https://n8n.kentutmambu.my.id/` (`/`, `/healthz`, satu workflow run) = OK.
9. [ ] `crates/**`, `apps/n8n-rust`, `reference/n8n/**` = nol diff vs `main`.
10. [ ] Tidak ada execution engine kedua (verifikasi regression test + review).

---

## 11. Change control

- Perubahan kontrak ini setelah dispatch Worker = **membutuhkan persetujuan Manager + re-run semua gate**.
- Penambahan endpoint / env / handler bawaan = amendemen kontrak (bump `version` + catat di §12).
- Migrasi LEGO → Rust HANYA dimulai setelah user menyatakan `TYPESCRIPT BASELINE FROZEN`.

## 12. Changelog

| Tanggal | Versi | Perubahan |
|---|---|---|
| 2026-09-20 | 0.1.0 | Kontrak baseline awal (3 endpoint, envelope, error table, config, packaging, testing, LEGO adapter). |
