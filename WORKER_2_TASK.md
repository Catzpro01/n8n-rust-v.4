# Worker 2: Packaging - Task Assignment

## Overview

**Worker ID**: Worker 2 - Packaging
**Branch**: `worker/2-packaging`
**Scope**: `deploy/docker/**`, `scripts/`, `.env.example`
**Contract**: See `contracts/runtime-server.contract.md`

---

## Your Mission

Create **complete packaging** that allows the TypeScript baseline to be:
1. Easily installed on a clean machine
2. Easily started and stopped
3. Easily upgraded
4. Easily rolled back
5. Easily diagnosed
6. Deployable to VPS

## Deliverables

### 1. Docker Configuration (`deploy/docker/`)

#### `deploy/docker/Dockerfile`
Multi-stage build for production:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY packages/ ./packages/
COPY apps/ ./apps/

# Install dependencies
RUN npm ci

# Build TypeScript
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Start server
CMD ["node", "dist/index.js"]
```

#### `deploy/docker/docker-compose.yml`
For local development:

```yaml
version: '3.8'

services:
  n8n-ts:
    build:
      context: .
      dockerfile: ./deploy/docker/Dockerfile
    container_name: n8n-ts-baseline
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - N8N_PORT=3000
      - N8N_HOST=0.0.0.0
    volumes:
      - ./apps/n8n-ts:/app/apps/n8n-ts
      - ./packages:/app/packages
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s

  # For development with hot reload
  n8n-ts-dev:
    build:
      context: .
      dockerfile: ./deploy/docker/Dockerfile.dev
    container_name: n8n-ts-dev
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - N8N_PORT=3000
      - N8N_HOST=0.0.0.0
    volumes:
      - ./apps/n8n-ts:/app/apps/n8n-ts
      - ./packages:/app/packages
    command: npm run dev
    profiles:
      - dev
```

#### `deploy/docker/Dockerfile.dev`
For development with hot reload:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/ ./packages/
COPY apps/ ./apps/

RUN npm ci

EXPOSE 3000

CMD ["npm", "run", "dev"]
```

#### `deploy/docker/.dockerignore`
```
node_modules
.git
.gitignore
Dockerfile
Dockerfile.dev
docker-compose.yml
.dockerignore
*.md
*.log
.env
.env.*
.vscode
.idea
```

### 2. Installation Scripts (`scripts/`)

#### `scripts/install.sh`
```bash
#!/bin/bash
set -euo pipefail

# Configuration
APP_NAME="n8n-ts-baseline"
INSTALL_DIR="/opt/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
CONFIG_DIR="/etc/${APP_NAME}"
USER="${APP_NAME}"
GROUP="${APP_NAME}"
VERSION="0.4.0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root"
    exit 1
fi

# Check OS
if [ ! -f /etc/os-release ]; then
    log_error "Unsupported operating system"
    exit 1
fi

. /etc/os-release
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    log_warn "This script is tested on Ubuntu/Debian. Your OS is $ID $VERSION_ID"
fi

# Install dependencies
log_info "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    curl \
    wget \
    git \
    nodejs \
    npm \
    || { log_error "Failed to install dependencies"; exit 1; }

# Verify Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    log_warn "Node.js version is less than 22. Some features may not work."
fi

# Create user and group
if ! id "$USER" &>/dev/null; then
    log_info "Creating user and group..."
    groupadd --system "$GROUP" || true
    useradd --system --gid "$GROUP" --shell /usr/sbin/nologin "$USER" || true
fi

# Create directories
log_info "Creating directories..."
mkdir -p "$INSTALL_DIR" "$LOG_DIR" "$DATA_DIR" "$CONFIG_DIR"
chown -R "$USER:$GROUP" "$INSTALL_DIR" "$LOG_DIR" "$DATA_DIR" "$CONFIG_DIR"

# Clone repository (if not already cloned)
if [ ! -d "$INSTALL_DIR/.git" ]; then
    log_info "Cloning repository..."
    git clone https://github.com/Catzpro01/n8n-rust-v.4.git "$INSTALL_DIR" || { log_error "Failed to clone repository"; exit 1; }
    chown -R "$USER:$GROUP" "$INSTALL_DIR"
fi

# Checkout correct branch
cd "$INSTALL_DIR"
git checkout arena/01a0c019-n8n-rust-v-4 || { log_error "Failed to checkout branch"; exit 1; }
git pull origin arena/01a0c019-n8n-rust-v-4 || { log_warn "Failed to pull latest changes"; }

# Install npm dependencies
log_info "Installing npm dependencies..."
cd "$INSTALL_DIR"
npm ci --only=production || { log_error "Failed to install dependencies"; exit 1; }

# Build TypeScript
log_info "Building TypeScript..."
npm run build || { log_error "Failed to build TypeScript"; exit 1; }

# Copy environment file
if [ -f "$INSTALL_DIR/.env.example" ]; then
    log_info "Copying environment file..."
    cp "$INSTALL_DIR/.env.example" "$CONFIG_DIR/.env"
    chown "$USER:$GROUP" "$CONFIG_DIR/.env"
    chmod 640 "$CONFIG_DIR/.env"
fi

# Create systemd service
log_info "Creating systemd service..."
cat > /etc/systemd/system/${APP_NAME}.service <<EOL
[Unit]
Description=${APP_NAME} Server
After=network.target

[Service]
Type=simple
User=${USER}
Group=${GROUP}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${CONFIG_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Restart=always
RestartSec=5
StandardOutput=append:${LOG_DIR}/stdout.log
StandardError=append:${LOG_DIR}/stderr.log

[Install]
WantedBy=multi-user.target
EOL

# Reload systemd
systemctl daemon-reload

# Enable service
systemctl enable "$APP_NAME"

log_info "Installation complete!"
log_info ""
log_info "To start the server, run:"
log_info "  systemctl start ${APP_NAME}"
log_info ""
log_info "To check status:"
log_info "  systemctl status ${APP_NAME}"
log_info ""
log_info "Logs are available at:"
log_info "  Journal: journalctl -u ${APP_NAME} -f"
log_info "  stdout: ${LOG_DIR}/stdout.log"
log_info "  stderr: ${LOG_DIR}/stderr.log"
```

#### `scripts/start.sh`
```bash
#!/bin/bash
set -euo pipefail

APP_NAME="n8n-ts-baseline"

# Check if running as root
if [ "$(id -u)" -eq 0 ]; then
    echo "Starting ${APP_NAME} via systemd..."
    systemctl start "$APP_NAME"
    systemctl status "$APP_NAME" --no-pager
    exit 0
fi

# Check if user is the app user
if [ "$(whoami)" = "${APP_NAME}" ]; then
    echo "Starting ${APP_NAME} directly..."
    cd /opt/${APP_NAME}
    node dist/index.js
    exit 0
fi

echo "Please run as root or as the ${APP_NAME} user"
exit 1
```

#### `scripts/stop.sh`
```bash
#!/bin/bash
set -euo pipefail

APP_NAME="n8n-ts-baseline"

# Check if running as root
if [ "$(id -u)" -eq 0 ]; then
    echo "Stopping ${APP_NAME}..."
    systemctl stop "$APP_NAME"
    exit 0
fi

# Check if running as app user
if [ "$(whoami)" = "${APP_NAME}" ]; then
    echo "Stopping ${APP_NAME}..."
    pkill -f "node dist/index.js" || true
    exit 0
fi

echo "Please run as root or as the ${APP_NAME} user"
exit 1
```

#### `scripts/upgrade.sh`
```bash
#!/bin/bash
set -euo pipefail

APP_NAME="n8n-ts-baseline"
INSTALL_DIR="/opt/${APP_NAME}"
BACKUP_DIR="/var/backups/${APP_NAME}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Check root
if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root"
    exit 1
fi

# Stop service
log_info "Stopping ${APP_NAME}..."
systemctl stop "$APP_NAME" || true

# Backup current installation
log_info "Creating backup..."
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup-$TIMESTAMP.tar.gz"
tar -czf "$BACKUP_FILE" -C /opt "$APP_NAME" 2>/dev/null || log_warn "Backup failed"

# Pull latest changes
log_info "Updating repository..."
cd "$INSTALL_DIR"
git checkout arena/01a0c019-n8n-rust-v-4
git pull origin arena/01a0c019-n8n-rust-v-4

# Install dependencies
log_info "Installing dependencies..."
npm ci --only=production

# Build
log_info "Building..."
npm run build

# Restart service
log_info "Starting ${APP_NAME}..."
systemctl start "$APP_NAME"

log_info "Upgrade complete!"
log_info "Backup created at: $BACKUP_FILE"
```

#### `scripts/rollback.sh`
```bash
#!/bin/bash
set -euo pipefail

APP_NAME="n8n-ts-baseline"
INSTALL_DIR="/opt/${APP_NAME}"
BACKUP_DIR="/var/backups/${APP_NAME}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Check root
if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root"
    exit 1
fi

# List available backups
log_info "Available backups:"
ls -lh "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null || log_warn "No backups found"

# Ask for backup to restore
read -p "Enter backup file to restore (or 'list' to refresh): " BACKUP_FILE

if [ "$BACKUP_FILE" = "list" ]; then
    ls -lh "$BACKUP_DIR"/backup-*.tar.gz
    read -p "Enter backup file to restore: " BACKUP_FILE
fi

BACKUP_PATH="$BACKUP_DIR/$BACKUP_FILE"

if [ ! -f "$BACKUP_PATH" ]; then
    log_error "Backup file not found: $BACKUP_PATH"
    exit 1
fi

# Stop service
log_info "Stopping ${APP_NAME}..."
systemctl stop "$APP_NAME" || true

# Restore from backup
log_info "Restoring from backup: $BACKUP_FILE"
rm -rf "$INSTALL_DIR"/*
tar -xzf "$BACKUP_PATH" -C /opt

# Fix permissions
chown -R "$APP_NAME:$APP_NAME" "$INSTALL_DIR"

# Restart service
log_info "Starting ${APP_NAME}..."
systemctl start "$APP_NAME"

log_info "Rollback complete!"
```

#### `scripts/doctor.sh`
```bash
#!/bin/bash

APP_NAME="n8n-ts-baseline"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

log_check() {
    echo -e "${BLUE}[CHECK]${NC} $1"
}

echo "========================================"
echo "  ${APP_NAME} Doctor"
echo "========================================"
echo ""

# Check Node.js
log_check "Node.js version"
NODE_VERSION=$(node --version 2>&1)
if [[ "$NODE_VERSION" =~ ^v22 ]]; then
    log_info "Node.js: $NODE_VERSION"
else
    log_error "Node.js: $NODE_VERSION (requires v22+)"
fi

# Check npm
log_check "npm version"
NPM_VERSION=$(npm --version 2>&1)
if [[ "$NPM_VERSION" =~ ^[0-9] ]]; then
    log_info "npm: $NPM_VERSION"
else
    log_error "npm: $NPM_VERSION"
fi

# Check installation directory
log_check "Installation directory"
INSTALL_DIR="/opt/${APP_NAME}"
if [ -d "$INSTALL_DIR" ]; then
    log_info "Installation directory exists"
else
    log_error "Installation directory not found"
fi

# Check systemd service
log_check "Systemd service"
if systemctl list-unit-files | grep -q "$APP_NAME.service"; then
    log_info "Systemd service installed"
    SERVICE_STATUS=$(systemctl is-active "$APP_NAME" 2>&1)
    if [ "$SERVICE_STATUS" = "active" ]; then
        log_info "Service is running"
    else
        log_warn "Service is not running: $SERVICE_STATUS"
    fi
else
    log_error "Systemd service not found"
fi

# Check port
log_check "Port 3000"
if ss -tlnp | grep -q ":3000 "; then
    log_info "Port 3000 is in use"
else
    log_warn "Port 3000 is not in use"
fi

# Check health endpoint
log_check "Health endpoint"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/healthz 2>&1)
if [ "$HEALTH_STATUS" = "200" ]; then
    HEALTH_BODY=$(curl -s http://localhost:3000/healthz)
    HEALTH_STATUS=$(echo "$HEALTH_BODY" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    if [ "$HEALTH_STATUS" = "ok" ]; then
        log_info "Health endpoint: OK"
    else
        log_warn "Health endpoint: $HEALTH_STATUS"
    fi
else
    log_error "Health endpoint: HTTP $HEALTH_STATUS"
fi

# Check logs
log_check "Recent logs"
if [ -f "/var/log/${APP_NAME}/stdout.log" ]; then
    LAST_LOG=$(tail -1 "/var/log/${APP_NAME}/stdout.log" 2>/dev/null)
    if [ -n "$LAST_LOG" ]; then
        log_info "Last log: $LAST_LOG"
    else
        log_warn "No recent logs found"
    fi
else
    log_warn "Log file not found"
fi

echo ""
echo "========================================"
echo "  Doctor complete"
echo "========================================"
```

### 3. Environment Configuration (`.env.example`)

Update or create `.env.example` with:

```bash
# ========================================
# N8N TypeScript Baseline Configuration
# ========================================
# Copy this file to .env and modify as needed

# Server Configuration
NODE_ENV=production
N8N_PORT=3000
N8N_HOST=0.0.0.0

# API Authentication (optional)
# Generate with: openssl rand -base64 32
N8N_API_KEY=

# Execution Limits
N8N_MAX_EXECUTIONS=100
N8N_EXECUTION_TIMEOUT=3600000

# Logging
N8N_LOG_LEVEL=info
N8N_LOG_FORMAT=json

# Health Check
N8N_HEALTH_CHECK_INTERVAL=5000

# Memory Limits
N8N_MAX_MEMORY=1024
```

### 4. Make Scripts Executable

```bash
chmod +x scripts/*.sh
```

---

## Boundaries - DO NOT CROSS

### ❌ YOU MUST NOT TOUCH:
- `apps/n8n-ts/**` - Worker 1 territory (except for reading to understand requirements)
- `packages/**` - Worker 4 territory
- `tests/**` - Worker 3 territory
- `crates/**` - Rust is FROZEN
- `reference/n8n/**` - Reference is FROZEN
- Other workers' branches

### ✅ YOU CAN TOUCH:
- `deploy/docker/**` - Your territory
- `scripts/install.sh`, `start.sh`, `stop.sh`, `upgrade.sh`, `rollback.sh`, `doctor.sh` - Your territory
- `.env.example` - Your territory

---

## Acceptance Criteria

### Installation
- [ ] `scripts/install.sh` installs all dependencies
- [ ] Server is installed in `/opt/n8n-ts-baseline`
- [ ] Systemd service is created and enabled
- [ ] User and group are created
- [ ] Directories are created with correct permissions

### Start/Stop
- [ ] `scripts/start.sh` starts the server
- [ ] `scripts/stop.sh` stops the server
- [ ] Server starts on system boot
- [ ] Server stops gracefully on shutdown

### Upgrade/Rollback
- [ ] `scripts/upgrade.sh` upgrades to latest version
- [ ] `scripts/rollback.sh` restores from backup
- [ ] Upgrade preserves configuration
- [ ] Rollback preserves data

### Doctor
- [ ] `scripts/doctor.sh` checks all components
- [ ] Reports Node.js version
- [ ] Reports service status
- [ ] Reports health endpoint status
- [ ] Reports recent logs

### Docker
- [ ] Dockerfile builds successfully
- [ ] docker-compose.yml works for development
- [ ] Health check works in Docker
- [ ] Multi-stage build reduces image size

---

## Workflow

1. **Read Contract**: Study `contracts/runtime-server.contract.md`
2. **Implement**: Create all packaging files
3. **Test**: Test installation on clean VM
4. **Commit**: Commit changes to `worker/2-packaging` branch
5. **PR**: Create PR to `arena/01a0c019-n8n-rust-v-4`
6. **Notify**: Inform MANAGER that PR is ready for review

---

## Testing Your Work

### Local Testing
1. Run `scripts/install.sh` on a clean Ubuntu 22.04 VM
2. Verify server starts: `scripts/start.sh`
3. Verify server stops: `scripts/stop.sh`
4. Verify health: `curl http://localhost:3000/healthz`
5. Verify upgrade: Make a change, run `scripts/upgrade.sh`
6. Verify rollback: Run `scripts/rollback.sh`

### Docker Testing
1. Build image: `docker build -t n8n-ts-baseline -f deploy/docker/Dockerfile .`
2. Run container: `docker run -p 3000:3000 n8n-ts-baseline`
3. Verify health: `curl http://localhost:3000/healthz`
4. Test with docker-compose: `docker-compose -f deploy/docker/docker-compose.yml up`

---

## Success Criteria

Your PR will be accepted when:
- [ ] All deliverables complete
- [ ] All acceptance criteria met
- [ ] No boundary violations
- [ ] Scripts are tested on clean machine
- [ ] Docker builds successfully

---

**Worker 2 Status**: READY TO START
**Contract**: `contracts/runtime-server.contract.md`
**Branch**: `worker/2-packaging`
