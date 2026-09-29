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
   │ Private Docker network / loopback bridge
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
   │     - Bound to 127.0.0.1
   │     - NEVER published to 0.0.0.0, LAN, or Tunnel
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
- **Minimal Writable State**: Hanya volume `/var/lib/arena-ci` (persistent JSON data, evidence, logs, artifacts).
- **Absolute Host Isolation**:
  - Dilarang mount `C:\`, `C:\Users\`, `C:\Windows`, `C:\Program Files`, atau browser/SSH profiles.
  - Dilarang mount Docker socket (`/var/run/docker.sock`).
  - Tidak ada `privileged: true` atau `network_mode: host`.

---

## 3. Secret Management Contract

- **Zero Secret in Repo**: Token (`GITHUB_PAT`) dan Webhook Secret (`GITHUB_WEBHOOK_SECRET`) tidak pernah dicommit ke git repository.
- **No Git Remote URL Parsing**: Gateway dilarang membaca token dari remote URL origin.
- **Local Secret Storage**:
  - Process environment variable: `GITHUB_PAT`
  - Host-only secure file: `C:\arena-ci\data\gateway-secrets.json` (chmod 600)
- **Token Protection**: Token tidak boleh muncul di stdout, logs, diagnostic output, atau command argv runner.

---

## 4. Container Deployment Manifest (Template)

```yaml
# deploy/docker-compose.arena-ci.yml
version: '3.8'

networks:
  arena_internal:
    driver: bridge

services:
  arena-gateway:
    image: node:22-alpine
    container_name: arena-gateway
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp
    environment:
      - PORT_INGRESS=7890
      - PORT_CONTROL=7891
      - NODE_ENV=production
    volumes:
      - type: bind
        source: C:/arena-ci/gateway
        target: /app
        read_only: true
      - type: bind
        source: C:/arena-ci/data
        target: /var/lib/arena-ci/data
      - type: bind
        source: C:/arena-ci/storage
        target: /var/lib/arena-ci/storage
    networks:
      - arena_internal

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: arena-tunnel
    restart: unless-stopped
    command: tunnel --url http://arena-gateway:7890 --no-autoupdate
    networks:
      - arena_internal
    depends_on:
      - arena-gateway
```

---

## 5. Granular Health Monitoring

Gateway `/health` mengembalikan status 4 subsistem:
1. `gatewayProcess`: `HEALTHY`
2. `runnerSubsystem`: `HEALTHY` (verifikasi runner aktif)
3. `githubConnectivity`: `HEALTHY` (verifikasi konfigurasi token)
4. `tunnel`: `HEALTHY` (verifikasi koneksi tunnel aktif)
