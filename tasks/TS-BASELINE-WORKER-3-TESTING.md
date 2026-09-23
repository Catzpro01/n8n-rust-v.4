# WORKER 3 — TESTING (runtime nyata, bukan mock)

## Kontrak acuan
`contracts/ts-baseline-runtime.contract.md` §2–§4 + §8.

## Scope (allowed_paths — EKSKLUSIF)
- `tests/runtime/**` (SEMUA file test runtime + fixtures + helpers + README)
- `tests/integration/ts-baseline-smoke.test.mjs` (SATU file baru; file integrasi existing TERLARANG)

## Forbidden
- `crates/**`, `apps/**`, `packages/**`, `deploy/**`, `scripts/**`
- `reference/n8n/**`, `tests/reference/**`
- File existing di `tests/integration/` (boundary_audit.py, regression_gate.py, dll — jangan sentuh)
- `.github/**`, root `package.json`

## Deliverables
```
tests/runtime/
  README.md                       (cara menjalankan, prasyarat build, interpretasi hasil)
  helpers.mjs                     (spawnServer, waitHealth, httpGet/httpPost, freePort, assert)
  fixtures/
    minimal.json                  (1 node manualTrigger)
    linear.json                   (manualTrigger → set → noop, dengan connections)
    empty.json                    (nodes: [])
    unknown-node.json             (type tak dikenal + koneksi dangling varian)
    two-node-passthrough.json     (unknown type di tengah rantai)
  01-health.test.mjs              (GET /, GET /healthz, 404 JSON, 405)
  02-workflow-execution.test.mjs  (linear sukses, envelope {data}, COMPLETED, executionLog)
  03-malformed.test.mjs           (invalid JSON, hilang workflow, nodes bukan array,
                                   content-type salah, body > limit)
  04-empty-workflow.test.mjs      (nodes [] → 400 EMPTY_WORKFLOW)
  05-unknown-node.test.mjs        (startNode tak ada → 400; dangling → 400;
                                   type tanpa handler → 200 passthrough)
  06-restart.test.mjs             (start → SIGTERM graceful → start → health+run OK)
  07-configuration.test.mjs       (PORT override, PORT invalid fallback, LOG_LEVEL fallback)
  08-regression.test.mjs          (tanpa engine kedua, envelope stabil, locale additive-only,
                                   crates/reference tak tersentuh)
  run-all.mjs                     (orkestrasi: build check → serial run → ringkasan)
tests/integration/
  ts-baseline-smoke.test.mjs      (E2E memakai tests/reference/02-one-node + 03-linear
                                   sebagai workflow input ke runtime nyata)
```

## Aturan implementasi
1. SEMUA test memvalidasi **runtime nyata**: spawn `node apps/n8n-ts/dist/server.js`
   di port ephemeral (bebas), tunggu `/healthz`, hit HTTP via `node:http`/`fetch` global.
   DILARANG mengimpor `apps/n8n-ts/src/*` langsung atau mem-mock engine.
2. Runner: `node --test tests/runtime/*.test.mjs` harus bekerja tanpa dependensi tambahan.
   Setiap file test self-contained (start/stop server sendiri) agar bisa jalan paralel maupun serial.
3. `helpers.mjs` menyediakan: `spawnServer(env)` → `{proc, port, baseUrl, stop()}`,
   `waitForHealth(baseUrl, timeoutMs)`, `get/post` helpers, `readFixture(name)`.
   Server child di-kill di `after()`/`teardown` bahkan saat assert gagal (no orphan).
4. Port: pakai port 0-detection — pilih port bebas via `net.createServer().listen(0)` lalu tutup,
   teruskan via `PORT` env ke child. Hindari hardcode 5678 di test (kecuali test konfigurasi).
5. Timeout tiap test ≤ 30 detik; suite penuh ≤ 5 menit di laptop.
6. Regression test:
   - grep `apps/n8n-ts/src` tidak mengandung `while (queue.length` / `executionData.set`
     (tanda loop BFS duplikat) — runtime harus delegasi ke adapter.
   - `git diff --name-only` (atau `git status`) memastikan `crates/**`, `apps/n8n-rust/**`,
     `reference/n8n/**` tidak berubah (skip anggun jika bukan git checkout).
   - locale: run dengan `locale: xx-unknown` tetap 200 dan machine fields tak berubah.
7. Fixtures adalah JSON murni (request body untuk `POST /api/v1/workflows/run`).

## Acceptance
- Prasyarat: `npm --prefix apps/n8n-ts run build` sudah hijau.
- `node --test tests/runtime/*.test.mjs` → 8/8 file PASS.
- `node --test tests/integration/ts-baseline-smoke.test.mjs` → PASS.
- Tidak ada orphan `node` process setelah suite selesai.
- Tidak ada file di luar scope yang dibuat/diubah.
