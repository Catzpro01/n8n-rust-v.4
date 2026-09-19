"""
Secret Vault for Capability Gateway.
Safely resolves underlying credentials from environment / .env without exposing
them to callers or the Arena Manager.
"""

import os
from pathlib import Path
from typing import Optional, Dict

class SecretVault:
    def __init__(self, env_path: Optional[Path] = None):
        self._env_path = env_path or (Path(__file__).resolve().parents[2] / ".env")
        self._secrets: Dict[str, str] = {}
        self._load_secrets()

    def _load_secrets(self):
        # 1. Read from OS environment first
        for key in [
            "GITHUB_TOKEN", "GITHUB_PAT",
            "SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY",
            "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
            "LAPTOP_WEBHOOK_SECRET", "RUNNER_REGISTRATION_TOKEN"
        ]:
            val = os.environ.get(key)
            if val:
                self._secrets[key] = val.strip()

        # 2. Read from .env if present
        if self._env_path.exists():
            try:
                for line in self._env_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'").strip('"')
                    if k and v and k not in self._secrets:
                        self._secrets[k] = v
            except Exception:
                pass

        # 3. Fallback for GITHUB_TOKEN if in git remote url
        if "GITHUB_TOKEN" not in self._secrets:
            try:
                import subprocess
                url = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True).stdout.strip()
                if "@" in url and "ghp_" in url:
                    token = url.split("@")[0].split(":")[-1]
                    self._secrets["GITHUB_TOKEN"] = token
            except Exception:
                pass

    def get(self, secret_name: str) -> Optional[str]:
        """Internal lookup for providers only."""
        return self._secrets.get(secret_name)

    def get_known_secret_values(self) -> set:
        """Returns set of all secret strings for redaction purposes."""
        return {v for v in self._secrets.values() if v and len(v) >= 4}

    def __repr__(self) -> str:
        return "<SecretVault: Isolated & Encapsulated>"

    def __str__(self) -> str:
        return "<SecretVault: Isolated & Encapsulated>"
