import os
from pathlib import Path

REPO_ROOT = Path("/home/fern/arena/repo")
ARENA_ROOT = Path("/srv/arena")
WORKSPACES_ROOT = ARENA_ROOT / "workspaces"
LOGS_DIR = ARENA_ROOT / "logs"

# Load backend secrets only (never exposed to agent workspaces)
ENV_FILE = Path("/home/fern/arena/.env")
env_config = {}
if ENV_FILE.exists():
    with open(ENV_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env_config[k.strip()] = v.strip().strip("'").strip('"')

SUPABASE_URL = os.environ.get("SUPABASE_URL") or env_config.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY") or env_config.get("SUPABASE_SERVICE_ROLE_KEY", "")
GITHUB_WEBHOOK_SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET") or env_config.get("GITHUB_WEBHOOK_SECRET", "arena_dev_secret_change_me")
PORT = int(os.environ.get("ARENA_BRIDGE_PORT", 9000))
