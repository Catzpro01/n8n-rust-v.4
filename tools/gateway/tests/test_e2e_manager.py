"""
End-to-End Test Suite for Arena Manager Autonomous Operations.
Verifies Phase 9 requirements:
Manager autonomously executes a full orchestration workflow:
1. GitHub inspection operation (repo / branches)
2. Supabase Control Plane: creates task for worker
3. Worker coordination: claims task, updates state to IN_PROGRESS
4. Records event into control plane audit trail
5. Inspects resulting task and agent status
6. Executes local check/status via laptop provider
7. Broadcasts status dashboard to Telegram
All executed WITHOUT Antigravity!
"""

import unittest
import json
from pathlib import Path
from tools.gateway.gateway import CapabilityGateway

class TestEndToEndManager(unittest.TestCase):
    def setUp(self):
        self.gateway = CapabilityGateway()
        self.manager_token = self.gateway.auth.get_token_for_role("manager")
        self.worker_token = self.gateway.auth.get_token_for_role("worker")

    def test_full_manager_orchestration_cycle(self):
        # STEP 1: GITHUB OPERATION (Read Repo & Verify Branch)
        repo_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="github.read_repo",
            bearer_token=self.manager_token
        )
        self.assertTrue(repo_res["ok"], f"GitHub read_repo failed: {repo_res}")
        self.assertEqual(repo_res["result"]["name"], "n8n-rust-v.4")

        laptop_status = self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.status",
            bearer_token=self.manager_token
        )
        self.assertTrue(laptop_status["ok"])
        current_branch = laptop_status["result"]["branch"]
        self.assertIn("arena/", current_branch)

        # STEP 2: SUPABASE CONTROL PLANE — CREATE TASK FOR WORKER
        task_key = "runtime-kernel/m2-test-orchestration-task"
        create_task_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.create_task",
            params={
                "task_key": task_key,
                "title": "Build Test Worker Pipeline",
                "specialization_id": "spec-01",
                "milestone": "M2",
                "progress_weight": 2.5,
                "validation_level": "LEVEL_1"
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(create_task_res["ok"], f"Create task failed: {create_task_res}")
        self.assertEqual(create_task_res["result"]["status"], "SUCCESS")
        task_id = create_task_res["result"]["task"]["id"]

        # STEP 3: WORKER COORDINATION — WORKER CLAIMS & STARTS TASK
        claim_res = self.gateway.invoke(
            caller_id="arena-agent-worker-1",
            capability="supabase.rpc",
            params={
                "function": "claim_task",
                "args": {
                    "p_task_id": task_id,
                    "p_agent_id": "agent-01"
                }
            },
            bearer_token=self.worker_token
        )
        self.assertTrue(claim_res["ok"], f"Worker claim failed: {claim_res}")

        # Worker heartbeat
        hb_res = self.gateway.invoke(
            caller_id="arena-agent-worker-1",
            capability="supabase.rpc",
            params={
                "function": "agent_heartbeat",
                "args": {"p_agent_id": "agent-01"}
            },
            bearer_token=self.worker_token
        )
        self.assertTrue(hb_res["ok"])

        # Manager updates task state to IN_PROGRESS
        update_state_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.update_task_state",
            params={
                "task_id": task_id,
                "status": "IN_PROGRESS",
                "assigned_agent_id": "agent-01"
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(update_state_res["ok"])

        # STEP 4: RECORD EVENT INTO CONTROL PLANE
        record_evt_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.record_event",
            params={
                "event_type": "TASK_DISPATCHED",
                "payload": {"task_id": task_id, "agent_id": "agent-01", "milestone": "M2"}
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(record_evt_res["ok"])

        # STEP 5: INSPECT RESULTING STATE
        tasks_insp = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.inspect_tasks",
            params={"status": "IN_PROGRESS"},
            bearer_token=self.manager_token
        )
        self.assertTrue(tasks_insp["ok"])
        active_tasks = tasks_insp["result"]["tasks"]
        found = any(t.get("task_key") == task_key for t in active_tasks)
        self.assertTrue(found, f"Task {task_key} should be in progress")

        proj_state = self.gateway.invoke(
            caller_id="arena-manager",
            capability="supabase.get_project_state",
            bearer_token=self.manager_token
        )
        self.assertTrue(proj_state["ok"])
        self.assertGreater(proj_state["result"]["total_tasks"], 0)

        # STEP 6: LOCAL LAPTOP BUILD / TEST CHECK
        cmd_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="laptop.run_command",
            params={"command": "git --version"},
            bearer_token=self.manager_token
        )
        self.assertTrue(cmd_res["ok"])
        self.assertTrue(cmd_res["result"]["success"])
        self.assertIn("git version", cmd_res["result"]["stdout"])

        # STEP 7: TELEGRAM STATUS DASHBOARD BROADCAST
        tg_res = self.gateway.invoke(
            caller_id="arena-manager",
            capability="telegram.render_dashboard",
            params={
                "title": "ORCHESTRATION MILESTONE 2 STATUS",
                "status": "OPERATIONAL",
                "metrics": {
                    "Active Tasks": len(active_tasks),
                    "Target Agent": "agent-01",
                    "Status": "IN_PROGRESS",
                    "Antigravity": "OFFLINE (Independent)"
                }
            },
            bearer_token=self.manager_token
        )
        self.assertTrue(tg_res["ok"], f"Telegram broadcast failed: {tg_res}")
        self.assertTrue(tg_res["result"]["ok"])

if __name__ == "__main__":
    unittest.main()
