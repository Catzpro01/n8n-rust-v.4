# Docker — n8n-ts baseline

## Cara mudah (disarankan)

```bash
bash scripts/install.sh   # sekali saja (build image jika docker ada)
bash scripts/start.sh     # idempoten (pakai docker jika image tersedia)
bash scripts/doctor.sh    # verifikasi
bash scripts/stop.sh      # hentikan
```

## Cara manual

```bash
# dari repo root:
docker build -f deploy/docker/Dockerfile -t n8n-ts-baseline:0.1.0 .
docker compose -f deploy/docker/docker-compose.yml up -d
docker logs -f n8n-ts-baseline
curl -s localhost:5678/healthz

# hentikan + bersihkan:
docker compose -f deploy/docker/docker-compose.yml down
```

## Catatan

- Konteks build = repo root (dibutuhkan untuk `apps/` + `packages/`).
- Port host dan kontainer SAMA (`${PORT:-5678}`) — sesuai kontrak §5 (satu key `PORT`).
- Image non-root (`app`), tanpa devDependencies, `HEALTHCHECK` ke `/healthz`.
- `.env` repo root otomatis dibaca (opsional); variabel compose punya default aman.
