import os
from pathlib import Path

# Dynamically resolve paths relative to the current repository
REPO_ROOT = Path(__file__).resolve().parents[2]
ARENA_ROOT = REPO_ROOT / ".arena"
WORKSPACES_ROOT = REPO_ROOT.parent / "workspaces"
LOGS_DIR = REPO_ROOT / ".system_logs"

WORKSPACES_ROOT.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)

# Load secrets from project .env
ENV_FILE = REPO_ROOT / ".env"
env_config = {}
if ENV_FILE.exists():
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env_config[k.strip()] = v.strip().strip("'").strip('"')

SUPABASE_URL = os.environ.get("SUPABASE_URL") or env_config.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY") or env_config.get("SUPABASE_SERVICE_ROLE_KEY", "")
GITHUB_WEBHOOK_SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET") or env_config.get("GITHUB_WEBHOOK_SECRET", "arena_dev_secret_change_me")
PORT = int(os.environ.get("ARENA_BRIDGE_PORT", 9000))