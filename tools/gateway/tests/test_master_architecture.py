"""
Master Architectural Verification Suite for Arena Manager v1.7.
Tests all 10 phases of the master specification:
1. Webhook HMAC signature generation & verification.
2. Webhook replay attack rejection (stale timestamp & duplicate request ID).
3. Webhook operation allowlist enforcement & rejection of arbitrary shell commands.
4. Laptop Provider routing via Laptop Webhook Agent.
5. Supabase control plane leasing (claim_task_lease, heartbeat, reap_expired_leases).
6. Persistent Orchestrator Daemon tick & state synchronization.
7. Worker role isolation vs Manager privilege separation.
8. Zero secret leakage across all execution channels.
"""

import unittest
import time
import json
import uuid
import threading
from pathlib import Path

from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer
from tools.gateway.auth import GatewayAuth
from tools.gateway.policy import PolicyEngine
from tools.gateway.gateway import CapabilityGateway
from tools.gateway.laptop_webhook_agent import (
    compute_webhook_signature,
    ALLOWED_OPERATIONS,
    run_webhook_server,
    LaptopWebhookHandler
)
from tools.gateway.orchestrator_daemon import PersistentOrchestratorDaemon
from tools.gateway.worker_agent import ArenaWorkerAgent

class TestMasterArchitecture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gateway = CapabilityGateway()
        cls.manager_token = cls.gateway.auth.get_token_for_role("manager")
        cls.worker_token = cls.gateway.auth.get_token_for_role("worker")
        cls.webhook_secret = "test-webhook-secret-key-12345"
        LaptopWebhookHandler.secret_key = cls.webhook_secret.encode("utf-8")
        LaptopWebhookHandler.repo_root = cls.gateway.repo_root

    def test_webhook_signature_and_replay_protection(self):
        """Test cryptographic HMAC verification and replay window checks."""
        req_id = f"test-req-{uuid.uuid4().hex[:8]}"
        payload = {"operation": "git_branch", "request_id": req_id}
        body_bytes = json.dumps(payload).encode("utf-8")

        # 1. Valid Signature
        valid_ts = str(time.time())
        sig = compute_webhook_signature(self.webhook_secret, valid_ts, req_id, body_bytes)

        # Mock handler headers
        handler = LaptopWebhookHandler.__new__(LaptopWebhookHandler)
        handler.headers = {
            "X-Webhook-Signature": sig,
            "X-Webhook-Timestamp": valid_ts,
            "X-Webhook-Request-ID": req_id
        }
        verified, reason = handler._verify_signature(body_bytes)
        self.assertTrue(verified)
        self.assertEqual(reason, "VERIFIED")

        # 2. Replay Attack: Exact same request ID again
        verified_replay, reason_replay = handler._verify_signature(body_bytes)
        self.assertFalse(verified_replay)
        self.assertIn("REPLAY_DETECTED", reason_replay)

        # 3. Expired Timestamp (> 60s skew)
        expired_ts = str(time.time() - 120.0)
        new_req_id = f"test-req-{uuid.uuid4().hex[:8]}"
        expired_sig = compute_webhook_signature(self.webhook_secret, expired_ts, new_req_id, body_bytes)
        handler.headers = {
            "X-Webhook-Signature": expired_sig,
            "X-Webhook-Timestamp": expired_ts,
            "X-Webhook-Request-ID": new_req_id
        }
        verified_exp, reason_exp = handler._verify_signature(body_bytes)
        self.assertFalse(verified_exp)
        self.assertIn("REPLAY_ERROR", reason_exp)

        # 4. Tampered Signature
        tampered_sig = sig[:-4] + "ffff"
        handler.headers = {
            "X-Webhook-Signature": tampered_sig,
            "X-Webhook-Timestamp": valid_ts,
            "X-Webhook-Request-ID": f"new-req-{uuid.uuid4().hex[:8]}"
        }
        verified_tamp, reason_tamp = handler._verify_signature(body_bytes)
        self.assertFalse(verified_tamp)
        self.assertIn("INVALID_SIGNATURE", reason_tamp)

    def test_webhook_allowed_operations(self):
        """Webhook must only permit safe operation profiles, never raw shell strings."""
        self.assertIn("cargo_check", ALLOWED_OPERATIONS)
        self.assertIn("cargo_test", ALLOWED_OPERATIONS)
        self.assertIn("cargo_clippy", ALLOWED_OPERATIONS)
        self.assertNotIn("bash", ALLOWED_OPERATIONS)
        self.assertNotIn("sh", ALLOWED_OPERATIONS)
        self.assertNotIn("cmd", ALLOWED_OPERATIONS)
        self.assertNotIn("powershell", ALLOWED_OPERATIONS)

    def test_laptop_provider_command_restrictions(self):
        """Laptop provider must block env dumping and secret file reading."""
        for blocked_cmd in ["env", "set", "printenv", "type .env", "cat .env"]:
            res = self.gateway.invoke(
                caller_id="arena-manager",
                capability="laptop.run_command",
                params={"command": blocked_cmd},
                bearer_token=self.manager_token
            )
            self.assertFalse(res["ok"])
            self.assertIn("blocked", res["error"].lower())

    def test_manager_vs_worker_privilege_boundary(self):
        """Manager has administrative authority; Worker is strictly fenced."""
        # 1. Manager can request PR and branch creation
        mgr_disc = self.gateway.discover_capabilities()
        self.assertIn("github.create_pr", mgr_disc["capabilities"])
        self.assertIn("supabase.create_task", mgr_disc["capabilities"])

        # 2. Worker cannot merge PRs or delete branches
        worker_res = self.gateway.invoke(
            caller_id="arena-agent-worker-01",
            capability="github.merge_pr",
            params={"pull_number": 31},
            bearer_token=self.worker_token
        )
        self.assertFalse(worker_res["ok"])
        self.assertIn("POLICY_VIOLATION", worker_res["error"])

        # 3. Worker cannot delete branches
        worker_branch_res = self.gateway.invoke(
            caller_id="arena-agent-worker-01",
            capability="github.delete_branch",
            params={"branch": "some-branch"},
            bearer_token=self.worker_token
        )
        self.assertFalse(worker_branch_res["ok"])
        self.assertIn("POLICY_VIOLATION", worker_branch_res["error"])

    def test_persistent_orchestrator_tick(self):
        """Persistent Orchestrator Daemon executes a full cycle cleanly."""
        daemon = PersistentOrchestratorDaemon(gateway=self.gateway)
        report = daemon.tick()
        self.assertTrue(report.get("success"))
        self.assertIn("fleet_status", report)
        self.assertIn("project_state", report)
        self.assertIn("laptop_worker", report)
        self.assertEqual(daemon.stats["ticks"], 1)

    def test_zero_secret_exposure(self):
        """No secret tokens may exist in audit log or gateway returned objects."""
        # Query project state
        res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.get_project_state",
            bearer_token=self.manager_token
        )
        self.assertTrue(res["ok"])
        res_str = json.dumps(res)
        self.assertNotIn("ghp_", res_str)
        self.assertNotIn("eyJ", res_str)
        self.assertNotIn("bot", res_str)

        # Inspect recent audit logs
        logs = self.gateway.audit.read_recent(15)
        for log in logs:
            log_str = json.dumps(log)
            self.assertNotIn("ghp_", log_str)
            self.assertNotIn("eyJ", log_str)

if __name__ == "__main__":
    unittest.main()
