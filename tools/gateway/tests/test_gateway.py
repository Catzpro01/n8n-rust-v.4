"""
Automated Test Suite for Capability Gateway (v1.7).
Verifies:
1. Secret isolation (Vault never exposes credentials directly to Arena Manager).
2. Sanitizer catches tokens, PATs, JWTs, and exact secrets.
3. PolicyEngine strictly protects 'main', 'master', and 'arena-agent' branches.
4. PolicyEngine blocks access to protected credential files (.env, keys).
5. PolicyEngine fences worker agents from manager capabilities.
6. Audit logger records invocation events cleanly without leakage.
7. Gateway invocation end-to-end integration across providers.
"""

import unittest
import json
from pathlib import Path

from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer
from tools.gateway.policy import PolicyEngine
from tools.gateway.audit import AuditLogger
from tools.gateway.gateway import CapabilityGateway

class TestCapabilityGateway(unittest.TestCase):
    def setUp(self):
        self.gateway = CapabilityGateway()

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

    def test_policy_protected_branches(self):
        """Policy engine must prevent deletion of main and arena-agent branches."""
        for branch in ["main", "origin/main", "master", "arena-agent", "origin/arena-agent"]:
            res = self.gateway.invoke(
                caller_id="arena-manager",
                capability="github.delete_branch",
                params={"branch": branch}
            )
            self.assertFalse(res["ok"])
            self.assertFalse(res["authorized"])
            self.assertIn("POLICY_VIOLATION", res["error"])

    def test_policy_protected_files(self):
        """Policy engine must block reading/writing to sensitive credential files."""
        for path in [".env", ".env.local", "path/to/.env", "certs/server.key", "keys/id_rsa"]:
            res = self.gateway.invoke(
                caller_id="arena-manager",
                capability="github.read_file",
                params={"path": path}
            )
            self.assertFalse(res["ok"])
            self.assertFalse(res["authorized"])
            self.assertIn("POLICY_VIOLATION", res["error"])

    def test_policy_worker_fence(self):
        """Worker agents must be blocked from executing manager-level capabilities."""
        res = self.gateway.invoke(
            caller_id="arena-agent-worker-4",
            capability="github.delete_branch",
            params={"branch": "some-feature-branch"}
        )
        self.assertFalse(res["ok"])
        self.assertFalse(res["authorized"])
        self.assertIn("POLICY_VIOLATION", res["error"])

    def test_discover_capabilities(self):
        """Gateway must return all registered capabilities with domains."""
        discovery = self.gateway.discover_capabilities()
        self.assertEqual(discovery["version"], "1.7.0")
        self.assertGreaterEqual(discovery["capabilities_count"], 30)
        caps = discovery["capabilities"]
        self.assertIn("github.read_repo", caps)
        self.assertIn("supabase.inspect_tasks", caps)
        self.assertIn("telegram.send_message", caps)
        self.assertIn("laptop.status", caps)

    def test_laptop_status(self):
        """Gateway executes local workspace status correctly."""
        res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.status"
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["result"]["branch"], "arena-agent")
        self.assertTrue(res["result"]["runner_installed"])

    def test_audit_logging_integrity(self):
        """Audit log must record operations cleanly and without credentials."""
        recent = self.gateway.audit.read_recent(10)
        self.assertGreater(len(recent), 0)
        latest = recent[-1]
        self.assertIn("caller_id", latest)
        self.assertIn("capability", latest)
        self.assertIn("status", latest)
        self.assertIn("duration_ms", latest)
        # Check no token is in the JSON representation
        raw_entry = json.dumps(latest)
        self.assertNotIn("ghp_", raw_entry)
        self.assertNotIn("eyJ", raw_entry)

if __name__ == "__main__":
    unittest.main()
