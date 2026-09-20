# n8n-ts baseline runtime

Server TypeScript minimal: `node:http` + `packages/reconstructed-engine`.
Nol dependensi runtime. Kontrak: `contracts/ts-baseline-runtime.contract.md`.

## Jalankan (lokal)

```bash
npm --prefix apps/n8n-ts install
npm --prefix apps/n8n-ts run build
npm --prefix apps/n8n-ts start
# atau tanpa build (oprek): npm --prefix apps/n8n-ts run dev
```

Cek:

```bash
curl -s localhost:5678/healthz
curl -s localhost:5678/
```

Jalankan workflow:

```bash
curl -s -X POST localhost:5678/api/v1/workflows/run \
  -H 'content-type: application/json' \
  -d '{"workflow":{"nodes":[{"name":"Start","type":"n8n-nodes-base.manualTrigger"}],"connections":{}}}'
```

## Oprek

| Mau apa | Di mana |
|---|---|
| Tambah/ubah route | `src/server.ts` + `src/routes/` |
| Ubah envelope sukses/gagal | `src/envelope.ts` |
| Ubah config/env | `src/config.ts` (tambah key = amendemen kontrak §5) |
| Ubah log | `src/logger.ts` |
| Ubah perilaku node | `src/engine.ts` + adapter `packages/reconstructed-engine/ts-runtime-adapter.mjs` |
| Validasi workflow | adapter (JANGAN duplikasi di sini) |

Aturan keras: **JANGAN tulis loop eksekusi di sini** — eksekusi milik `runner.mjs`.
Lihat `packages/reconstructed-engine/LEGO-BASELINE-AUDIT.md`.

## Debug

```bash
LOG_LEVEL=debug npm --prefix apps/n8n-ts start   # log verbose
PORT=5680 npm --prefix apps/n8n-ts start         # port lain
bash scripts/doctor.sh                           # cek menyeluruh
```

- Boot selalu mencetak satu baris `[config] ...` — pastikan nilainya sesuai harapan.
- Tiap `POST .../run` mencetak satu baris `info` (status, ms, nodes).
- `warn`: config invalid (fallback), unknown node type (passthrough).
- `error`: hanya kegagalan eksekusi — stacktrace TIDAK PERNAH ke response, hanya ke log.

## Build & typecheck

```bash
npm --prefix apps/n8n-ts run typecheck
npm --prefix apps/n8n-ts run build   # output: apps/n8n-ts/dist/
```
