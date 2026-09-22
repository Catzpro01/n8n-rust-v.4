"""
Authentication Engine for Capability Gateway.
Issues and validates capability access tokens for Arena Manager and Worker Agents.
These tokens ONLY grant access to the gateway; they never grant direct access
to GitHub, Supabase, or other upstream services.
"""

import hmac
import hashlib
import secrets
import json
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

class GatewayAuth:
    def __init__(self, keyfile_path: Optional[Path] = None):
        repo_root = Path(__file__).resolve().parents[2]
        self.keyfile_path = keyfile_path or (repo_root / ".arena" / "gateway_tokens.json")
        self.keyfile_path.parent.mkdir(parents=True, exist_ok=True)
        self._tokens: Dict[str, Dict[str, str]] = {}
        self._load_or_generate_tokens()

    def _load_or_generate_tokens(self):
        """Loads existing tokens from disk or creates default role tokens."""
        if self.keyfile_path.exists():
            try:
                data = json.loads(self.keyfile_path.read_text(encoding="utf-8"))
                self._tokens = data.get("tokens", {})
            except Exception:
                self._tokens = {}

        # Ensure manager and default worker tokens exist
        updated = False
        if "manager" not in self._tokens:
            self._tokens["manager"] = {
                "token": f"agm_{secrets.token_hex(24)}",
                "role": "manager",
                "allowed_prefix": "arena-manager"
            }
            updated = True

        if "worker" not in self._tokens:
            self._tokens["worker"] = {
                "token": f"agw_{secrets.token_hex(24)}",
                "role": "worker",
                "allowed_prefix": "arena-agent-"
            }
            updated = True

        if updated:
            self._save_tokens()

    def _save_tokens(self):
        data = {"tokens": self._tokens}
        self.keyfile_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def get_token_for_role(self, role: str) -> Optional[str]:
        return self._tokens.get(role, {}).get("token")

    def authenticate(self, caller_id: str, bearer_token: str) -> Tuple[bool, str, Optional[str]]:
        """
        Validates caller_id against the provided bearer_token.
        Returns: (is_authenticated, error_or_reason, role)
        """
        if not bearer_token:
            return False, "AUTHENTICATION_REQUIRED: Missing gateway bearer token", None

        # Constant time lookup & verification
        for role_name, config in self._tokens.items():
            expected_token = config["token"]
            if hmac.compare_digest(expected_token, bearer_token):
                # Verify caller_id matches role prefix
                allowed_prefix = config.get("allowed_prefix", "")
                if role_name == "manager":
                    if caller_id != "arena-manager":
                        return False, f"ROLE_MISMATCH: Manager token cannot be used by caller '{caller_id}'", None
                    return True, "AUTHENTICATED", "manager"
                elif role_name == "worker":
                    if not (caller_id.startswith("arena-agent-") or caller_id.startswith("worker-")):
                        return False, f"ROLE_MISMATCH: Worker token cannot be used by caller '{caller_id}'", None
                    return True, "AUTHENTICATED", "worker"

        return False, "AUTHENTICATION_FAILED: Invalid gateway token", None
