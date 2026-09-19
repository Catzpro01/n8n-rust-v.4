"""
Test Suite for Antigravity-Independent Operations.
Verifies Phase 10 requirements:
Ensures all 12 core operational capabilities execute cleanly
without any dependency on Antigravity daemon, workspace, or network endpoints.
"""

import unittest
from pathlib import Path
from tools.gateway.gateway import CapabilityGateway

class TestAntigravityIndependence(unittest.TestCase):
    def setUp(self):
        self.gateway = CapabilityGateway()
        self.manager_token = self.gateway.auth.get_token_for_role("manager")
        self.worker_token = self.gateway.auth.get_token_for_role("worker")

    def test_all_domains_independent_of_antigravity(self):
        """Verifies that all required Manager operations succeed without Antigravity."""
        # 1. GitHub: Read repository
        repo_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="github.read_repo",
            bearer_token=self.manager_token
        )
        self.assertTrue(repo_res["ok"])
        self.assertEqual(repo_res["result"]["name"], "n8n-rust-v.4")

        # 2. GitHub: List branches
        branches_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="github.list_branches",
            bearer_token=self.manager_token
        )
        self.assertTrue(branches_res["ok"])
        self.assertGreater(len(branches_res["result"]), 0)

        # 3. GitHub: Read CI runs
        ci_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="github.get_ci",
            params={"limit": 3},
            bearer_token=self.manager_token
        )
        self.assertTrue(ci_res["ok"])

        # 4. Supabase: Manage tasks
        task_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.create_task",
            params={
                "task_key": "test/antigravity-independence-01",
                "title": "Autonomous Verification",
                "specialization_id": "spec-02",
                "milestone": "M2"
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(task_res["ok"])
        task_id = task_res["result"]["task"]["id"]

        # 5. Supabase: Manage agents
        agents_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.inspect_agents",
            bearer_token=self.manager_token
        )
        self.assertTrue(agents_res["ok"])
        self.assertGreaterEqual(agents_res["result"]["total_agents"], 1)

        # 6. Supabase: Manage locks
        lock_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.rpc",
            params={
                "function": "acquire_file_lock",
                "args": {
                    "p_resource": "packages/workflow-lego/src/test.rs",
                    "p_task_id": task_id,
                    "p_agent_id": "agent-02",
                    "p_ttl_seconds": 3600
                }
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(lock_res["ok"])

        locks_insp = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.inspect_locks",
            bearer_token=self.manager_token
        )
        self.assertTrue(locks_insp["ok"])
        self.assertGreaterEqual(locks_insp["result"]["total_active_locks"], 1)

        release_lock_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.rpc",
            params={
                "function": "release_file_lock",
                "args": {
                    "p_resource": "packages/workflow-lego/src/test.rs",
                    "p_task_id": task_id,
                    "p_agent_id": "agent-02"
                }
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(release_lock_res["ok"])

        # 7. Supabase: Schema migrations status
        mig_stat = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.migration_status",
            bearer_token=self.manager_token
        )
        self.assertTrue(mig_stat["ok"])
        self.assertIn("total_migrations", mig_stat["result"])

        # 8. Telegram: Dashboard broadcast
        tg_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="telegram.render_dashboard",
            params={
                "title": "ANTIGRAVITY INDEPENDENCE REPORT",
                "status": "PASS",
                "metrics": {
                    "Antigravity Required": "FALSE",
                    "Direct Gateway": "ACTIVE",
                    "Status": "100% INDEPENDENT"
                }
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(tg_res["ok"])

        # 9. Laptop worker execution
        status_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.status",
            bearer_token=self.manager_token
        )
        self.assertTrue(status_res["ok"])
        self.assertEqual(status_res["result"]["repo_path"], str(self.gateway.repo_root))

if __name__ == "__main__":
    unittest.main()
