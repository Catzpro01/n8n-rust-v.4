# Docker deployment — TypeScript runtime

The runtime image needs no build step and no runtime npm dependencies: Node 22
executes `apps/n8n-ts/src/server.ts` directly.

## Quickstart

```bash
cp .env.example .env                       # review port / API key / policies
docker compose -f deploy/docker/docker-compose.yml up -d --build
docker compose -f deploy/docker/docker-compose.yml ps        # health: healthy
curl -s localhost:5678/healthz              # {"status":"ok"}
open http://localhost:5678/                 # operator console
```

## What the container does

| Item | Value |
| :--- | :--- |
| Base image | `node:22-bookworm-slim` (override with `--build-arg NODE_IMAGE=`) |
| User | non-root `node` |
| Data | volume `n8n-ts-data` mounted at `/data` (`N8N_TS_DATA_DIR=/data`) |
| Config | `env_file: ../../.env` — every variable of contract §2 is honoured |
| Healthcheck | `GET /healthz` inside the container, every 30 s |
| Logs | JSON lines on stdout, captured by the json-file driver (10 MB × 3) |
| Ports | `${N8N_TS_PORT:-5678}` → container `5678` |

## VPS notes

* Put a reverse proxy (Caddy/nginx/Traefik) in front and terminate TLS there.
  The runtime does **not** set `X-Frame-Options`, so proxied iframe previews work.
* Set `N8N_TS_API_KEY` in `.env` before exposing `/api/v1` publicly, and
  `N8N_TS_ENV=production` so stack traces stay out of responses.
* `N8N_TS_ALLOW_CODE_EVAL` stays `false` unless you deliberately want user
  JavaScript executed in-process (never for untrusted workflows).
* Upgrades: `docker compose -f deploy/docker/docker-compose.yml up -d --build`
  keeps the volume, so workflows and execution history survive.

## Same host, without Docker

The scripts cover the bare-metal path:

```bash
bash scripts/install.sh && bash scripts/start.sh && bash scripts/doctor.sh
```

Both paths answer the same contract, so tooling and tests work identically.
