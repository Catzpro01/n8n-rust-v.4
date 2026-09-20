# WORKER 1 — RUNTIME SERVER (`apps/n8n-ts/**`)

## Kontrak acuan (wajib dibaca dulu)
`contracts/ts-baseline-runtime.contract.md` §1–§6 + §9.

## Scope (allowed_paths — EKSKLUSIF)
- `apps/n8n-ts/**` (SEMUA file runtime ada di sini; tidak boleh di luar)

## Forbidden (otomatis tolak jika disentuh)
- `crates/**`, `apps/n8n-rust/**`, `reference/n8n/**`
- `deploy/**`, `scripts/**`, `.env.example`
- `tests/**`, `packages/**`, `.github/**`, root `package.json`

## Deliverables
```
apps/n8n-ts/
  package.json          (name @n8n-ts/baseline-runtime, version 0.1.0, type module,
                         dependencies: {}, devDeps: typescript + @types/node,
                         scripts: build, typecheck, start, dev)
  tsconfig.json         (strict, ESM, outDir dist, rootDir src)
  README.md             (install, run, oprek, debug — ringkas)
  src/
    server.ts           (node:http createServer, routing, graceful shutdown)
    config.ts           (load env + .env manual, validasi §5, log satu baris)
    logger.ts           (level debug/info/warn/error, prefix [level])
    envelope.ts         (ok(data), fail(code,message,hint), json helpers)
    body.ts             (baca body + limit + parse JSON aman)
    engine.ts           (WAJIB via adapter Worker 4:
                         packages/reconstructed-engine/ts-runtime-adapter.mjs)
    routes/
      root.ts           (GET /)
      health.ts         (GET /healthz)
      run.ts            (POST /api/v1/workflows/run)
```

## Aturan implementasi
1. Hanya `node:http` (+ `node:url`, `node:fs`, `node:path`, `node:process`). Dilarang framework.
2. Runtime deps NOL. Dev deps hanya TS + types.
3. `engine.ts` DILARANG menyalin loop BFS eksekusi — harus delegasi ke
   `createBaselineEngine()` / `WorkflowExecutionEngine` milik reconstructed-engine.
4. Validasi request mengikuti tabel error kontrak §3 (code/message/hint persis).
5. `GET /` dan `GET /healthz` tidak log per-request di `info`.
6. `POST /api/v1/workflows/run` log satu baris `info` + timeout via `Promise.race`.
7. Locale: teruskan `locale`/`workflow.activeLocale` ke engine; fallback `id`.
8. `version` di response = `package.json` version (dibaca saat boot, bukan hardcode beda).
9. Graceful shutdown SIGTERM/SIGINT ≤ 10 detik, exit 0.
10. Kode harus mudah di-oprek: fungsi kecil, komentar Indonesia ringkas di titik penting.

## Acceptance
- `npm --prefix apps/n8n-ts ci && npm --prefix apps/n8n-ts run build` hijau.
- `node apps/n8n-ts/dist/server.js` → `GET /healthz` = `{"status":"ok",...}`.
- `POST /api/v1/workflows/run` valid → `200 {data:{status:COMPLETED,...}}`.
- Semua error §3 kembali dengan envelope + code yang benar.
- Tidak ada import ke `deploy/`, `scripts/`, `tests/`, `crates/`, `reference/`.
