# Installing n8n lego

Three supported channels, all on Linux (Ubuntu 22.04+/Debian 12+, target VPS
2 GB RAM / 2 vCPU). Every one of them ends the same way: open port 5678 in a
browser, create the owner account on the setup screen, build a workflow on the
canvas.

Requirements for all three: **Node.js >= 22.18** (`node -v`), ~600 MB free disk
(≈160 MB editor UI + ≈10 MB catalog + your data), and network access **once** to
fetch the node catalog (483 node types + icons, ~9 MB from the npm registry).
Nothing else: no database server, no build step, no Rust toolchain.

---

## 1. npm — global install or npx

```bash
npm install -g n8n-lego        # ~160 MB unpacked
n8n-lego start                 # first boot fetches the catalog, then serves :5678
```

Without a global install:

```bash
npx n8n-lego start
```

Commands:

| Command | What it does |
| :--- | :--- |
| `n8n-lego start` | start the server (default command); fetches the catalog if missing |
| `n8n-lego start --no-fetch` | start without touching the network (empty palette if no catalog) |
| `n8n-lego doctor` | check node version, UI bundle, catalog, icons, port |
| `n8n-lego catalog` | (re)fetch node types, credentials, icons, roles |
| `n8n-lego version` | app, editor UI and node versions |

Data lives in `~/.n8n-lego` (`N8N_LEGO_USER_FOLDER` overrides it). The package
carries the execution engine with it (`vendor/reconstructed-engine`), so no
repository checkout is needed.

Running it as a service is the same as any Node app:

```bash
sudo tee /etc/systemd/system/n8n-lego.service >/dev/null <<'EOF'
[Unit]
Description=n8n lego
After=network-online.target
[Service]
User=n8n-lego
Environment=N8N_LEGO_USER_FOLDER=/var/lib/n8n-lego
ExecStart=/usr/bin/env n8n-lego start --no-fetch
Restart=always
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now n8n-lego
```

(or use `deploy/systemd/n8n-lego.service`, which the tarball installer fills in
for you.)

---

## 2. Docker

```bash
docker build -t n8n-lego .                                   # from this checkout
docker run -d --name n8n-lego \
  -p 5678:5678 \
  -v n8n-lego-data:/home/node/.n8n-lego \
  n8n-lego
```

Compose (build + volume + healthcheck + log rotation, all wired):

```bash
docker compose up -d --build
docker compose logs -f
docker compose down            # data stays in the n8n-lego-data volume
```

The image bakes the node catalog in, so a fresh container has a populated palette
without network access. Useful invocations:

```bash
docker run --rm n8n-lego doctor          # install check inside the image
docker run --rm n8n-lego catalog         # refresh catalog/icons
docker run --rm -it n8n-lego sh -c 'node -e "console.log(1)"'   # escape hatch
```

Behind a proxy, set the public address so the editor shows correct webhook URLs:

```bash
docker run -d -p 5678:5678 -e N8N_LEGO_EDITOR_BASE_URL=https://n8n.example.com \
  -v n8n-lego-data:/home/node/.n8n-lego n8n-lego
```

To skip the first-visit setup screen, pass `-e N8N_LEGO_OWNER_EMAIL=... -e
N8N_LEGO_OWNER_PASSWORD=...` and the owner is created at boot.

---

## 3. Tarball + systemd (VPS, no npm/docker needed)

```bash
curl -LO https://github.com/Catzpro01/n8n-rust-v.4/releases/download/v0.1.0/n8n-lego-0.1.0.tar.gz
sha256sum -c n8n-lego-0.1.0.tar.gz.sha256
tar -xzf n8n-lego-0.1.0.tar.gz && cd n8n-lego-0.1.0
sudo bash install.sh --systemd
```

`install.sh` is idempotent and does the whole job:

1. verifies Node >= 22.18,
2. copies the app to `/opt/n8n-lego` (editable: `--dir`),
3. creates the service account `n8n-lego` and `/var/lib/n8n-lego` (data),
4. fetches the node catalog into the data directory (`--no-catalog` to skip),
5. installs `deploy/systemd/n8n-lego.service` with the right paths and starts it.

```bash
sudo systemctl status n8n-lego
sudo journalctl -u n8n-lego -f
sudo systemctl restart n8n-lego
```

Flags: `--dir`, `--user`, `--data-dir`, `--port`, `--systemd`, `--no-systemd`,
`--no-catalog`, `--uninstall` (removes the app, keeps your data).

---

## Building all three artifacts

```bash
bash scripts/release.sh              # npm tarball + offline tarball (+ docker build if available)
bash scripts/release.sh --npm-only   # just the npm package
bash scripts/release.sh --no-docker  # skip docker on machines without it
```

Artifacts land in `dist/`:

| File | Purpose |
| :--- | :--- |
| `n8n-lego-<version>.tgz` | the npm package (`npm i -g`, `npx`) |
| `n8n-lego-<version>.tar.gz` | VPS tarball with the editor UI vendored (offline install) |
| `n8n-lego-<version>.tar.gz.sha256` | checksum for the tarball |
| `n8n-lego:<version>` (docker image) | built from the repo `Dockerfile` |

The release script runs the test suite first and vendors
`packages/reconstructed-engine` into the npm package, so a global install is
self-contained.

---

## After install

1. Open `http://<host>:5678` — first visit shows n8n's owner-setup screen.
2. Create the owner account, land on **Workflows**, press **Create workflow**.
3. Add a trigger (e.g. *Manual Trigger*) and an action (e.g. *Edit Fields (Set)*),
   press **Execute workflow** — the run appears under **Executions**.

Health endpoint for load balancers / monitoring:

```bash
curl -s localhost:5678/healthz
# {"status":"ok","checks":{"editorUi":"ok","nodeCatalog":"ok","engine":"0.2.0"}}
```

### Reverse proxy (nginx)

```nginx
server {
  listen 443 ssl;
  server_name n8n.example.com;
  location / {
    proxy_pass http://127.0.0.1:5678;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # /rest/push WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
  }
}
```

`N8N_LEGO_PROTOCOL=https` makes the session cookie `Secure`; behind a proxy set
`N8N_LEGO_EDITOR_BASE_URL` so webhook/OAuth URLs are generated for the public
host.
