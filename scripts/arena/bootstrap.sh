#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "    ARENA 5-AGENT ORCHESTRATION BOOTSTRAPPER (PHASE 3)   "
echo "=========================================================="

REPO_DIR="/home/fern/arena/repo"
ARENA_DIR="/srv/arena"

echo "\n[1/7] Checking System Requirements..."
command -v git >/dev/null 2>&1 || { echo "ERROR: git is not installed"; exit 1; }
command -v rustc >/dev/null 2>&1 || { echo "ERROR: rustc is not installed"; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "ERROR: cargo is not installed"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is not installed"; exit 1; }
echo "  [OK] Git $(git --version)"
echo "  [OK] Rust $(rustc --version) / Cargo $(cargo --version)"
echo "  [OK] Python $(python3 --version)"

echo "\n[2/7] Validating Host Resources..."
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
FREE_DISK_GB=$(df -BG / | awk 'NR==2{print $4}' | tr -d 'G')
echo "  [OK] RAM Total: ${TOTAL_RAM_MB} MB"
echo "  [OK] Free Disk: ${FREE_DISK_GB} GB"
if [[ "$TOTAL_RAM_MB" -lt 1500 ]]; then
    echo "  [WARN] RAM under 1.5 GB; Memory Governor will enforce strict boundaries."
fi

echo "\n[3/7] Setting Up /srv/arena Isolated Directory Layout..."
sudo mkdir -p "${ARENA_DIR}/workspaces/agent-01" \
             "${ARENA_DIR}/workspaces/agent-02" \
             "${ARENA_DIR}/workspaces/agent-03" \
             "${ARENA_DIR}/workspaces/agent-04" \
             "${ARENA_DIR}/workspaces/agent-05" \
             "${ARENA_DIR}/logs" \
             "${ARENA_DIR}/cache" \
             "${ARENA_DIR}/runtime"
sudo chown -R fern:fern "${ARENA_DIR}"
echo "  [OK] /srv/arena directories verified with proper ownership."

echo "\n[4/7] Auditing LEGO & Sub-LEGO Governance Registries..."
python3 "${REPO_DIR}/tools/sublego-audit/audit.py"
echo "  [OK] Registries are 100% compliant."

echo "\n[5/7] Verifying Rust Workspace Compilation..."
cd "${REPO_DIR}"
cargo check --workspace
echo "  [OK] All 8 Rust crates in workspace compiled cleanly."

echo "\n[6/7] Verifying Backend Configuration..."
if [[ -f "/home/fern/arena/.env" ]]; then
    echo "  [OK] Backend environment /home/fern/arena/.env exists."
else
    echo "  [WARN] /home/fern/arena/.env not found; create from .env.example."
fi

echo "\n[7/7] Verifying Arena Executor Security Jails..."
python3 -c "
import sys
sys.path.insert(0, '${REPO_DIR}/tools/arena-executor')
from fs_guard import FilesystemGuard, SecurityViolation
from pathlib import Path
guard = FilesystemGuard(Path('/srv/arena/workspaces/agent-01'), ['crates/**'], ['reference/**'])
try:
    guard.validate_path('../traversal', is_write=True)
    sys.exit(1)
except SecurityViolation:
    print('  [OK] Fail-closed path traversal jail confirmed active.')
"

echo "\n=========================================================="
echo "    BOOTSTRAP COMPLETE: ARENA HOST IS PRODUCTION-READY!   "
echo "=========================================================="
