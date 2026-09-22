# Deploying the TypeScript baseline on the VPS

Target: `https://n8n.kentutmambu.my.id/` on the host that answers for that name (currently `157.10.160.95`, ports 22/443 open).
Reverse proxy terminates TLS and forwards to the runtime on `127.0.0.1:5678`.

> Status note: `.arena/policies/validation-policy.md` still lists the VPS as out of scope and no `vps-runtime`
> self-hosted runner is registered (only the Windows `laptop-build-worker`). Until one of those changes, this
> deployment is performed manually with the steps below; the scripts are the same ones CI uses, so the
> result is identical.

## 0. One-time host preparation

```bash
# Node >= 22.18 (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git caddy
node -v            # must print v22.18.0 or newer
```

## 1. Clone and install the runtime

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin n8n   # optional dedicated user
sudo -u n8n git clone https://github.com/Catzpro01/n8n-rust-v.4.git /opt/n8n-rust
cd /opt/n8n-rust
sudo -u n8n bash scripts/install.sh --systemd        # dirs, .env, deps, unit file
sudo -u n8n nano .env
```

`.env` for the VPS:

```dotenv
N8N_TS_ENV=production
N8N_TS_HOST=127.0.0.1          # only the reverse proxy talks to the runtime
N8N_TS_PORT=5678
N8N_TS_API_KEY=<openssl rand -hex 24>
N8N_TS_LOG_FORMAT=json
N8N_TS_ALLOW_CODE_EVAL=false
```

## 2. Start it under systemd

```bash
sudo systemctl enable --now n8n-ts-runtime
systemctl status n8n-ts-runtime --no-pager
sudo -u n8n bash scripts/doctor.sh            # all green, 0-1 warnings
curl -s localhost:5678/healthz                # {"status":"ok"}
```

## 3. TLS + reverse proxy (Caddy)

```bash
sudo cp deploy/vps/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile                # confirm the hostname and the 127.0.0.1:5678 upstream
sudo systemctl reload caddy
curl -sI https://n8n.kentutmambu.my.id/healthz
```

Firewall: allow `80/tcp` and `443/tcp` only (Let's Encrypt needs 80 for the HTTP-01 challenge); keep `5678` closed to the internet — it is bound to loopback.

nginx instead of Caddy: `proxy_pass http://127.0.0.1:5678;` plus `proxy_set_header Host $host;` and `X-Forwarded-Proto $scheme;` in a `location /` block with a certbot-issued certificate.

## 4. Day-2 on the VPS

```bash
cd /opt/n8n-rust
sudo -u n8n bash scripts/upgrade.sh      # fetch + typecheck gate + restart, auto-rollback on failure
sudo -u n8n bash scripts/rollback.sh     # undo the last upgrade
sudo -u n8n bash scripts/doctor.sh       # health, readiness, version, logs, disk
tail -f logs/runtime.log
```

## 5. Smoke test after every deploy

```bash
curl -s https://n8n.kentutmambu.my.id/healthz
curl -s -H "X-N8N-API-KEY: $N8N_TS_API_KEY" https://n8n.kentutmambu.my.id/api/v1/version
curl -s -X POST https://n8n.kentutmambu.my.id/api/v1/workflows/run \
  -H "X-N8N-API-KEY: $N8N_TS_API_KEY" -H 'content-type: application/json' \
  -d '{"workflow":{"name":"smoke","nodes":[{"name":"Start","type":"n8n-nodes-base.start","typeVersion":1,"parameters":{}}],"connections":{}}}'
```

The last call must answer `200` with `data.status = "COMPLETED"`. The same checks run from CI on the merge PR
(`tests/integration/runtime_gate.sh`), so a green pipeline plus a green smoke test is enough to call the
baseline deployed.
