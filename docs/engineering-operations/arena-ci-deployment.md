# Arena CI Deployment Specification & Security Contract
Deployment Branch: `feat/arena-ci-tunnel-container`  
Tracking PR: `#401`  
Repository: `Catzpro01/n8n-rust-v.4`

---

## 1. Arsitektur Target & Network Boundary

```text
GitHub
   │
   │ HTTPS Webhook (X-Hub-Signature-256)
   ▼
Cloudflare Tunnel
   │
   │ Private Docker network (arena_internal bridge)
   ▼
arena-gateway
   │
   ├── webhook ingress :7890 (Publicly accessible strictly via Tunnel)
   │     - POST only
   │     - HMAC SHA-256 validation
   │     - Exact 40-char hex commit SHA validation
   │     - X-GitHub-Delivery idempotency / deduplication
   │
   ├── control API :7891 (STRICTLY PRIVATE / LOCALHOST)
   │     - Bound via ARENA_CONTROL_BIND (127.0.0.1)
   │     - Published to localhost only (127.0.0.1:7891:7891) — NOT to 0.0.0.0, LAN, or Tunnel
   │     - Operators / Antigravity control plane only
   │
   └── runner orchestration
         - 10 Self-Hosted Runners (5 Windows + 5 WSL Linux)
         - Native toolchain isolation
```

---

## 2. Container Filesystem & Security Boundaries

Untuk containerisasi gateway (`arena-gateway`):
- **Least Privilege**: Non-root execution.
- **Read-Only App**: `/app` dimount read-only.
- **Minimal Writable State**: Volume `/var/lib/arena-ci` (persistent JSON data, evidence, logs, artifacts) **dan** named volume `arena_node_modules` pada `/app/node_modules` (dependensi hasil `npm ci --omit=dev`). Source aplikasi di `/app` tetap read-only; `node_modules` hanya memakai named volume yang dimaksud.
- **Absolute Host Isolation**:
  - Dilarang mount `C:\`, `C:\Users\`, `C:\Windows`, `C:\Program Files`, atau browser/SSH profiles.
  - Dilarang mount Docker socket (`/var/run/docker.sock`).
  - Tidak ada `privileged: true` atau `network_mode: host`.

---

## 3. Secret Management Contract

- **Zero Secret in Repo**: Token (`GITHUB_PAT`) dan Webhook Secret (`GITHUB_WEBHOOK_SECRET`) tidak pernah dicommit ke git repository.
- **No Git Remote URL Parsing**: Gateway dilarang membaca token dari remote URL origin.
- **Local Secret Storage** (Docker secrets, di luar Git):
  - `deploy/arena-ci/secrets/github_webhook_secret.txt` dan `deploy/arena-ci/secrets/github_pat.txt`
  - Dimount sebagai Docker secrets menjadi `/run/secrets/github_webhook_secret` dan `/run/secrets/github_pat`
  - Gateway membaca lewat `GITHUB_WEBHOOK_SECRET_FILE` / `GITHUB_PAT_FILE` — bukan environment variable yang berisi nilai token
  - Nilai secret tidak pernah muncul di `docker compose config`, argv, logs, health response, atau evidence
- **Token Protection**: Token tidak boleh muncul di stdout, logs, diagnostic output, atau command argv runner.

---

## 4. Container Deployment Manifest (Template: deploy/arena-ci/docker-compose.yml)

```yaml
# deploy/arena-ci/docker-compose.yml
services:
  arena-gateway:
    image: node:22-bookworm-slim
    restart: unless-stopped
    user: "node"
    security_opt:
      - no-new-privileges:true
    working_dir: /app
    environment:
      NODE_ENV: production
      ARENA_GATEWAY_BIND: 0.0.0.0
      ARENA_GATEWAY_PORT: "7890"
      ARENA_CONTROL_BIND: 127.0.0.1
      ARENA_CONTROL_PORT: "7891"
      ARENA_DATA_DIR: /var/lib/arena-ci
      GITHUB_WEBHOOK_SECRET_FILE: /run/secrets/github_webhook_secret
      GITHUB_PAT_FILE: /run/secrets/github_pat
    ports:
      - "127.0.0.1:7891:7891"
    volumes:
      - ${ARENA_GATEWAY_HOST_DIR:-C:/arena-ci/gateway}:/app:ro
      - arena_node_modules:/app/node_modules
      - ${ARENA_DATA_HOST_DIR:-C:/arena-ci/data}:/var/lib/arena-ci:rw
    secrets:
      - github_webhook_secret
      - github_pat
    command:
      - /bin/sh
      - -lc
      - |
        npm ci --omit=dev
        exec node server.js
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "require('http').get('http://127.0.0.1:7890/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 20s
    networks:
      - arena_internal

  cloudflared:
    image: ${CLOUDFLARED_IMAGE:-cloudflare/cloudflared:latest}
    restart: unless-stopped
    depends_on:
      arena-gateway:
        condition: service_healthy
    command:
      - tunnel
      - --no-autoupdate
      - --config
      - /etc/cloudflared/config.yml
      - run
    volumes:
      - ${CLOUDFLARED_HOST_DIR:-C:/arena-ci/cloudflared}:/etc/cloudflared:ro
    networks:
      - arena_internal

networks:
  arena_internal:
    driver: bridge
    internal: false

volumes:
  arena_node_modules:

secrets:
  github_webhook_secret:
    file: ${GITHUB_WEBHOOK_SECRET_FILE:-./secrets/github_webhook_secret.txt}
  github_pat:
    file: ${GITHUB_PAT_FILE:-./secrets/github_pat.txt}
```

---

## 5. Granular Health Monitoring

Gateway `/health` mengembalikan status 4 subsistem:
1. `gatewayProcess`: `HEALTHY`
2. `runnerSubsystem`: `HEALTHY` (verifikasi runner aktif)
3. `githubConnectivity`: `HEALTHY` (verifikasi konfigurasi token)
4. `tunnel`: `HEALTHY` (verifikasi koneksi tunnel aktif)
