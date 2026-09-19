import unittest
import json
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tools.gateway.auth import GatewayAuth
from tools.gateway.policy import PolicyEngine
from tools.gateway.sanitizer import Sanitizer
from tools.gateway.vault import SecretVault

class TestEdgeGatewayEquivalence(unittest.TestCase):
    """
    Memverifikasi keselarasan aturan Edge Function dengan PolicyEngine & Sanitizer gateway.
    """

    def setUp(self):
        self.auth = GatewayAuth()
        self.policy = PolicyEngine()
        self.vault = SecretVault()
        self.sanitizer = Sanitizer(self.vault.get_known_secret_values())

    def test_manager_token_rbac(self):
        mgr_token = self.auth.get_token_for_role("manager")
        wkr_token = self.auth.get_token_for_role("worker")

        # Manager role allows manager capability
        is_auth, _, role = self.auth.authenticate("arena-manager", mgr_token)
        self.assertTrue(is_auth)
        self.assertEqual(role, "manager")
        is_allowed, _ = self.policy.evaluate("arena-manager", "manager", "telegram.send_message", {})
        self.assertTrue(is_allowed)

        # Worker role cannot invoke manager capability
        is_w_auth, _, w_role = self.auth.authenticate("arena-agent-01", wkr_token)
        self.assertTrue(is_w_auth)
        self.assertEqual(w_role, "worker")
        is_w_allowed, reason = self.policy.evaluate("arena-agent-01", "worker", "telegram.send_message", {})
        self.assertFalse(is_w_allowed)
        self.assertIn("cannot execute manager-only capability", reason)

    def test_protected_branch_policy(self):
        # Forbidden actions on protected branches (delete_branch)
        allowed, reason = self.policy.evaluate("arena-manager", "manager", "github.delete_branch", {"branch": "main"})
        self.assertFalse(allowed)
        self.assertIn("Cannot delete protected branch", reason)

        # Allowed on normal feature branch
        allowed_feat, _ = self.policy.evaluate("arena-manager", "manager", "github.delete_branch", {"branch": "feature/m3-stream"})
        self.assertTrue(allowed_feat)

    def test_protected_file_policy(self):
        allowed, reason = self.policy.evaluate("arena-manager", "manager", "github.read_file", {"path": ".env"})
        self.assertFalse(allowed)
        self.assertIn("Access to security credential file", reason)

    def test_sanitizer_secret_redaction(self):
        sample = {
            "status": "success",
            "token": "ghp_123456789012345678901234567890123456",
            "data": "bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature12345"
        }
        sanitized = self.sanitizer.sanitize(sample)
        sanitized_str = json.dumps(sanitized)
        self.assertNotIn("ghp_", sanitized_str)
        self.assertNotIn("doNotLeakThisSignature12345", sanitized_str)
        self.assertTrue("[REDACTED" in sanitized_str)

if __name__ == "__main__":
    unittest.main()
