"""
Automated Test Suite for Capability Gateway (v1.7).
Verifies:
1. Secret isolation (Vault never exposes credentials directly to Arena Manager).
2. Sanitizer catches tokens, PATs, JWTs, and exact secrets.
3. PolicyEngine strictly protects 'main', 'master', and 'arena-agent' branches.
4. PolicyEngine blocks access to protected credential files (.env, keys).
5. PolicyEngine fences worker agents from manager capabilities.
6. Gateway Authentication enforces valid bearer tokens and prevents role spoofing.
7. Laptop environment isolation strips all sensitive env vars from child processes.
8. Laptop command blocker prevents env dumping ('env', 'set', 'type .env').
9. Audit logger records invocation events cleanly without leakage.
10. Gateway invocation end-to-end integration across providers.
"""

import unittest
import json
import os
from pathlib import Path

from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer
from tools.gateway.policy import PolicyEngine
from tools.gateway.audit import AuditLogger
from tools.gateway.auth import GatewayAuth
from tools.gateway.gateway import CapabilityGateway

class TestCapabilityGateway(unittest.TestCase):
    def setUp(self):
        self.gateway = CapabilityGateway()
        self.manager_token = self.gateway.auth.get_token_for_role("manager")
        self.worker_token = self.gateway.auth.get_token_for_role("worker")

    def test_vault_encapsulation(self):
        """Test that vault hides internal details in __repr__ and __str__."""
        vault_str = str(self.gateway.vault)
        vault_repr = repr(self.gateway.vault)
        self.assertIn("Isolated & Encapsulated", vault_str)
        self.assertIn("Isolated & Encapsulated", vault_repr)
        self.assertNotIn("ghp_", vault_str)
        self.assertNotIn("eyJ", vault_str)

    def test_sanitizer_redaction(self):
        """Test redaction of GitHub PAT, JWT, Telegram tokens, and basic auth."""
        test_text = (
            "Connecting with ghp_1234567890abcdefghijklmnopqrstuvwx and "
            "token 123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234 and "
            "auth eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature "
            "at https://user:secretpass123@api.github.com"
        )
        sanitized = self.gateway.sanitizer.sanitize_string(test_text)
        self.assertNotIn("ghp_1234567890abcdefghijklmnopqrstuvwx", sanitized)
        self.assertNotIn("123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234", sanitized)
        self.assertNotIn("doNotLeakThisSignature", sanitized)
        self.assertNotIn("secretpass123", sanitized)
        self.assertIn("[REDACTED_GITHUB_TOKEN]", sanitized)
        self.assertIn("[REDACTED_TELEGRAM_TOKEN]", sanitized)
        self.assertIn("[REDACTED_JWT_TOKEN]", sanitized)
        self.assertIn("https://user:[REDACTED]@", sanitized)

    def test_authentication_enforcement(self):
        """Gateway must reject calls with missing or invalid bearer tokens."""
        # 1. Missing token
        res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.status"
        )
        self.assertFalse(res["ok"])
        self.assertFalse(res["authenticated"])
        self.assertIn("AUTHENTICATION_REQUIRED", res["error"])

        # 2. Invalid token
        res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.status",
            bearer_token="invalid_token_123"
        )
        self.assertFalse(res["ok"])
        self.assertFalse(res["authenticated"])
        self.assertIn("AUTHENTICATION_FAILED", res["error"])

        # 3. Role spoofing: worker token claiming to be arena-manager
        res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.status",
            bearer_token=self.worker_token
        )
        self.assertFalse(res["ok"])
        self.assertFalse(res["authenticated"])
        self.assertIn("ROLE_MISMATCH", res["error"])

        # 4. Valid manager token
        res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.status",
            bearer_token=self.manager_token
        )
        self.assertTrue(res["ok"])
        self.assertTrue(res["authenticated"])

    def test_policy_protected_branches(self):
        """Policy engine must prevent deletion of main and arena-agent branches."""
        for branch in ["main", "origin/main", "master", "arena-agent", "origin/arena-agent"]:
            res = self.gateway.invoke(
                caller_id="arena-manager",
                capability="github.delete_branch",
                params={"branch": branch},
                bearer_token=self.manager_token
            )
            self.assertFalse(res["ok"])
            self.assertFalse(res["authorized"])
            self.assertIn("POLICY_VIOLATION", res["error"])

    def test_policy_protected_files(self):
        """Policy engine must block reading/writing to sensitive credential files."""
        for path in [".env", ".env.local", "path/to/.env", "certs/server.key", "keys/id_rsa", ".arena/gateway_tokens.json"]:
            res = self.gateway.invoke(
                caller_id="arena-manager",
                capability="github.read_file",
                params={"path": path},
                bearer_token=self.manager_token
            )
            self.assertFalse(res["ok"])
            self.assertFalse(res["authorized"])
            self.assertIn("POLICY_VIOLATION", res["error"])

    def test_policy_worker_fence(self):
        """Worker agents must be blocked from executing manager-only capabilities."""
        res = self.gateway.invoke(
            caller_id="arena-agent-worker-4",
            capability="github.delete_branch",
            params={"branch": "some-feature-branch"},
            bearer_token=self.worker_token
        )
        self.assertFalse(res["ok"])
        self.assertFalse(res["authorized"])
        self.assertIn("POLICY_VIOLATION", res["error"])

    def test_laptop_command_security_blocking(self):
        """Laptop provider must block env dumping and secret file reading commands."""
        blocked_commands = [
            "env", "printenv", "set", "type .env", "cat .env", "Get-ChildItem env:"
        ]
        for cmd in blocked_commands:
            res = self.gateway.invoke(
                caller_id="arena-manager",
                capability="laptop.run_command",
                params={"command": cmd},
                bearer_token=self.manager_token
            )
            self.assertFalse(res["ok"])
            self.assertIn("blocked", res["error"].lower())

    def test_laptop_env_isolation(self):
        """Child subprocess environment must not contain any sensitive host environment variables."""
        isolated_env = self.gateway.laptop._get_isolated_env()
        for k in isolated_env:
            k_upper = k.upper()
            self.assertNotIn("TOKEN", k_upper)
            self.assertNotIn("SECRET", k_upper)
            self.assertNotIn("KEY", k_upper)
            self.assertNotIn("PASS", k_upper)
        self.assertEqual(isolated_env.get("ARENA_ENVIRONMENT"), "isolated")

    def test_audit_logging_integrity(self):
        """Audit log must record operations cleanly and without credentials."""
        # Ensure at least one invocation is recorded
        self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.status",
            bearer_token=self.manager_token
        )
        recent = self.gateway.audit.read_recent(10)
        self.assertGreater(len(recent), 0)
        latest = recent[-1]
        self.assertIn("caller_id", latest)
        self.assertIn("capability", latest)
        self.assertIn("status", latest)
        self.assertIn("duration_ms", latest)
        raw_entry = json.dumps(latest)
        self.assertNotIn("ghp_", raw_entry)
        self.assertNotIn("eyJ", raw_entry)

if __name__ == "__main__":
    unittest.main()
