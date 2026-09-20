# Test runtime baseline (nyata, bukan mock)

Setiap file mem-spawn `node apps/n8n-ts/dist/server.js` di port ephemeral lalu
menembak HTTP asli. Tidak ada impor `src/*`, tidak ada mock engine.

## Prasyarat

```bash
npm --prefix apps/n8n-ts run build
```

## Jalankan

```bash
node --test tests/runtime/*.test.mjs   # semua (boleh paralel)
node tests/runtime/run-all.mjs         # orkestrasi + ringkasan gate
node --test tests/runtime/02-workflow-execution.test.mjs  # satu file
```

## Daftar

| File | Kasus (kontrak §8) |
|---|---|
| `01-health` | `GET /`, `/healthz`, 404 JSON, 405, log tidak banjir |
| `02-workflow-execution` | minimal + linear + startNode + locale + envelope `{data}` |
| `03-malformed` | JSON rusak, field rusak, content-type, limit 413 |
| `04-empty-workflow` | `nodes: []` → 400 `EMPTY_WORKFLOW` |
| `05-unknown-node` | `UNKNOWN_NODE` vs unknown-type passthrough 200 |
| `06-restart` | SIGTERM graceful exit 0 → start ulang port sama |
| `07-configuration` | PORT/LOG_LEVEL/`.env` + baris `[config]` |
| `08-regression` | tanpa engine kedua, envelope stabil, locale additive, Rust/reference utuh |

## Catatan

- Tiap file self-contained (start/stop server sendiri, kill saat gagal — tanpa orphan).
- `07` memakai port 5678 sebentar untuk fallback test (skip anggun jika sibuk).
- `08` memakai `git diff origin/main...HEAD` — set `SKIP_GIT_CHECKS=1` untuk lewati.
- Timeout per file ≤ 30 dtk; suite penuh ≤ 5 menit.
