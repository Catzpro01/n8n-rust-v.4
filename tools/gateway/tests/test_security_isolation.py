"""
Security Isolation and Secret Leakage Prevention Test Suite.
Verifies:
1. Zero credential leakage into outputs, logs, or error responses.
2. Robust sanitization of GitHub tokens, JWTs, Supabase keys, Telegram tokens, and basic auth.
3. PolicyEngine strictly blocks path traversal and access to protected credential files.
4. Worker role fencing rigorously enforced across all administrative endpoints.
"""

import unittest
import json
from pathlib import Path

from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer
from tools.gateway.policy import PolicyEngine
from tools.gateway.gateway import CapabilityGateway

class TestSecurityIsolation(unittest.TestCase):
    def setUp(self):
        self.gateway = CapabilityGateway()
        self.manager_token = self.gateway.auth.get_token_for_role("manager")
        self.worker_token = self.gateway.auth.get_token_for_role("worker")

    def test_sanitizer_scrubs_all_credential_patterns(self):
        """Sanitizer must scrub all known raw credential patterns."""
        dummy_secret_jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.secretSignatureMockValue123"
        dummy_gh_token = "ghp_MockSecretTokenGitHubPatForTestingOnly123456"
        dummy_tg_token = "987654321:AAEfMockTelegramBotTokenTestingPurpose"
        dummy_basic_auth = "https://user:SuperSecretPassword123@api.supabase.co"

        raw_payload = {
            "jwt": dummy_secret_jwt,
            "github": dummy_gh_token,
            "telegram": dummy_tg_token,
            "url": dummy_basic_auth,
            "nested": {
                "message": f"Connection failed with auth {dummy_secret_jwt} and token {dummy_gh_token}"
            }
        }

        sanitized = self.gateway.sanitizer.sanitize(raw_payload)
        json_output = json.dumps(sanitized)

        self.assertNotIn(dummy_secret_jwt, json_output)
        self.assertNotIn(dummy_gh_token, json_output)
        self.assertNotIn(dummy_tg_token, json_output)
        self.assertNotIn("SuperSecretPassword123", json_output)
        self.assertIn("[REDACTED_JWT_TOKEN]", json_output)
        self.assertIn("[REDACTED_GITHUB_TOKEN]", json_output)
        self.assertIn("[REDACTED_TELEGRAM_TOKEN]", json_output)
        self.assertIn("https://user:[REDACTED]@", json_output)

    def test_worker_cannot_execute_manager_capabilities(self):
        """Worker agents must be denied execution of all Manager-only capabilities."""
        manager_only_caps = [
            ("github.delete_branch", {"branch": "feature/test"}),
            ("github.create_pr", {"title": "Test PR", "head": "feat", "base": "main"}),
            ("github.merge_pr", {"pr_number": 1}),
            ("supabase.create_task", {"task_key": "t1", "title": "t1", "specialization_id": "s1", "milestone": "M1"}),
            ("supabase.update_task_state", {"task_id": "t1", "status": "DONE"}),
            ("supabase.write_table", {"table": "tasks", "data": {"id": "1"}}),
            ("supabase.create_migration", {"name": "test", "sql_up": "CREATE TABLE t(id int);"}),
            ("supabase.apply_migration", {"version": "20260920000000"}),
            ("supabase.schema_upgrade", {}),
            ("supabase.rollback_migration", {"version": "20260920000000"}),
            ("telegram.send_message", {"text": "Alert"}),
            ("telegram.render_dashboard", {"title": "Dashboard", "metrics": {}}),
        ]

        for cap, params in manager_only_caps:
            res = self.gateway.invoke(
                caller_id="arena-agent-worker-5",
                capability=cap,
                params=params,
                bearer_token=self.worker_token
            )
            self.assertFalse(res["ok"], f"Worker should be blocked from {cap}")
            self.assertFalse(res["authorized"], f"Worker should not be authorized for {cap}")
            self.assertIn("POLICY_VIOLATION", res["error"])

    def test_protected_files_and_traversal_blocked(self):
        """Attempts to access protected secret files or perform directory traversal must be blocked."""
        forbidden_targets = [
            ".env",
            "../.env",
            "subfolder/.env",
            ".arena/gateway_tokens.json",
            "id_rsa",
            "cert.pem",
            ".git/config"
        ]

        for target in forbidden_targets:
            res = self.gateway.invoke(
                caller_id="arena-manager",
                capability="github.read_file",
                params={"path": target},
                bearer_token=self.manager_token
            )
            self.assertFalse(res["ok"], f"Access to {target} should be blocked")
            self.assertIn("POLICY_VIOLATION", res["error"])

if __name__ == "__main__":
    unittest.main()
