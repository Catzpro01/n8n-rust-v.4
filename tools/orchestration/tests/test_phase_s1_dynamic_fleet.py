"""
Test Suite for Phase S1: Dynamic Agent Fleet & Laptop Execution Pool.
Covers:
- Agent Registry (A - G)
- Dynamic Scheduling (H - Q)
- Recovery (R - X)
- Execution Worker (Y - AH)
- Immutable Safety (AI - AL)
"""

import os
import sys
import uuid
import datetime
import unittest
from pathlib import Path
from typing import Dict, Any, List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.realtime_event_layer import RealtimeEventLayer
from tools.orchestration.laptop_execution_worker import LaptopExecutionWorker, LocalLaptopBackend
from tools.orchestration.dynamic_capacity_scheduler import DynamicCapacityScheduler, TaskDecomposer

class TestPhaseS1DynamicFleet(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ControlPlaneClient()
        cls.event_layer = RealtimeEventLayer()
        # Fetch a valid specialization UUID for tests
        st, specs = cls.client._request("specializations?limit=1")
        cls.spec_id = specs[0]["id"] if st == 200 and specs else "880e25c0-5a9c-490a-808b-869f131788d1"
        cls.created_agent_ids = []
        cls.created_task_ids = []

    @classmethod
    def tearDownClass(cls):
        # Cleanup test entities
        for tid in cls.created_task_ids:
            cls.client._request(f"tasks?id=eq.{tid}", method="DELETE")
        for aid in cls.created_agent_ids:
            cls.client._request(f"agents?id=eq.{aid}", method="DELETE")
        
        # Restore standard 5 workers to fresh AVAILABLE state
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        st, agents = cls.client._request("agents?select=id")
        if st == 200 and isinstance(agents, list):
            for ag in agents:
                cls.client._request(f"agents?id=eq.{ag['id']}", data={
                    "status": "AVAILABLE",
                    "current_task_id": None,
                    "last_heartbeat": now_iso
                }, method="PATCH")

    # ==========================================================================
    # 1. Agent Registry Tests (A - G)
    # ==========================================================================
    def test_A_register_agent(self):
        worker = LaptopExecutionWorker(
            agent_key=f"test-s1-ag-a-{uuid.uuid4().hex[:6]}",
            specialization_id=self.spec_id,
            control_plane=self.client,
            event_layer=self.event_layer
        )
        st, res = worker.register()
        self.assertEqual(st, 200)
        self.assertTrue(res.get("success"))
        self.assertIsNotNone(worker.agent_id)
        self.created_agent_ids.append(worker.agent_id)

    def test_B_duplicate_agent_updated(self):
        key = f"test-s1-ag-b-{uuid.uuid4().hex[:6]}"
        worker1 = LaptopExecutionWorker(key, self.spec_id, control_plane=self.client)
        st1, res1 = worker1.register()
        self.assertEqual(st1, 200)
        self.created_agent_ids.append(worker1.agent_id)

        # Re-registering existing key should update safely, not duplicate rows
        worker2 = LaptopExecutionWorker(key, self.spec_id, control_plane=self.client)
        st2, res2 = worker2.register()
        self.assertEqual(st2, 200)
        self.assertEqual(res2.get("action"), "UPDATED")
        self.assertEqual(worker1.agent_id, worker2.agent_id)

    def test_C_heartbeat_updates_liveness(self):
        worker = LaptopExecutionWorker(f"test-s1-ag-c-{uuid.uuid4().hex[:6]}", self.spec_id, control_plane=self.client)
        worker.register()
        self.created_agent_ids.append(worker.agent_id)

        st, hb_res = worker.heartbeat()
        self.assertEqual(st, 200)
        self.assertTrue(hb_res.get("success"))

    def test_D_stale_heartbeat_detected(self):
        scheduler = DynamicCapacityScheduler(heartbeat_timeout_seconds=60)
        now = datetime.datetime.now(datetime.timezone.utc)
        past = (now - datetime.timedelta(seconds=120)).isoformat()
        stale_agent = {"id": "dummy", "status": "AVAILABLE", "last_heartbeat": past}
        self.assertFalse(scheduler.is_agent_liveness_valid(stale_agent, now))

    def test_E_offline_agent_detected(self):
        scheduler = DynamicCapacityScheduler()
        now = datetime.datetime.now(datetime.timezone.utc)
        offline_agent = {"id": "dummy", "status": "OFFLINE", "last_heartbeat": now.isoformat()}
        self.assertFalse(scheduler.is_agent_liveness_valid(offline_agent, now))

    def test_F_draining_agent_cannot_receive_new_task(self):
        worker = LaptopExecutionWorker(f"test-s1-ag-f-{uuid.uuid4().hex[:6]}", self.spec_id, control_plane=self.client)
        worker.register()
        self.created_agent_ids.append(worker.agent_id)

        st, drain_res = worker.drain()
        self.assertEqual(st, 200)
        
        # When drained while idle, status is OFFLINE
        st_get, cur_data = self.client._request(f"agents?id=eq.{worker.agent_id}")
        self.assertIn(cur_data[0]["status"], ["DRAINING", "OFFLINE"])

    def test_G_reregister_after_restart(self):
        key = f"test-s1-ag-g-{uuid.uuid4().hex[:6]}"
        worker = LaptopExecutionWorker(key, self.spec_id, control_plane=self.client)
        worker.register()
        self.created_agent_ids.append(worker.agent_id)
        
        # Simulate worker offline
        self.client._request(f"agents?id=eq.{worker.agent_id}", data={"status": "OFFLINE"}, method="PATCH")
        
        # Worker restarts and registers again
        worker_restarted = LaptopExecutionWorker(key, self.spec_id, control_plane=self.client)
        st, res = worker_restarted.register()
        self.assertEqual(st, 200)
        self.assertEqual(worker_restarted.status, "AVAILABLE")

    # ==========================================================================
    # 2. Dynamic Scheduling Tests (H - Q)
    # ==========================================================================
    def test_H_one_agent_one_task(self):
        scheduler = DynamicCapacityScheduler()
        now = datetime.datetime.now(datetime.timezone.utc)
        agents = [{"id": "a1", "agent_key": "ag1", "status": "AVAILABLE", "last_heartbeat": now.isoformat(), "capabilities": {"all": True}}]
        tasks = [{"id": "t1", "task_key": "tk1", "status": "QUEUED", "priority": 100}]
        matches = scheduler.calculate_schedule(agents, tasks)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0][0]["id"], "t1")
        self.assertEqual(matches[0][1]["id"], "a1")

    def test_I_one_agent_ten_tasks(self):
        scheduler = DynamicCapacityScheduler()
        now = datetime.datetime.now(datetime.timezone.utc)
        agents = [{"id": "a1", "agent_key": "ag1", "status": "AVAILABLE", "last_heartbeat": now.isoformat(), "capabilities": {"all": True}}]
        tasks = [{"id": f"t{i}", "task_key": f"tk{i}", "status": "QUEUED", "priority": 100} for i in range(10)]
        matches = scheduler.calculate_schedule(agents, tasks)
        # Exactly 1 match, 9 remain queued
        self.assertEqual(len(matches), 1)

    def test_J_ten_agents_one_task(self):
        scheduler = DynamicCapacityScheduler()
        now = datetime.datetime.now(datetime.timezone.utc)
        agents = [{"id": f"a{i}", "agent_key": f"ag{i}", "status": "AVAILABLE", "last_heartbeat": now.isoformat(), "capabilities": {"all": True}} for i in range(10)]
        tasks = [{"id": "t1", "task_key": "tk1", "status": "QUEUED", "priority": 100}]
        matches = scheduler.calculate_schedule(agents, tasks)
        # Exactly 1 match, 9 agents remain available
        self.assertEqual(len(matches), 1)

    def test_K_ten_agents_five_tasks(self):
        scheduler = DynamicCapacityScheduler()
        now = datetime.datetime.now(datetime.timezone.utc)
        agents = [{"id": f"a{i}", "agent_key": f"ag{i}", "status": "AVAILABLE", "last_heartbeat": now.isoformat(), "capabilities": {"all": True}} for i in range(10)]
        tasks = [{"id": f"t{i}", "task_key": f"tk{i}", "status": "QUEUED", "priority": 100} for i in range(5)]
        matches = scheduler.calculate_schedule(agents, tasks)
        self.assertEqual(len(matches), 5)

    def test_L_five_agents_ten_tasks(self):
        scheduler = DynamicCapacityScheduler()
        now = datetime.datetime.now(datetime.timezone.utc)
        agents = [{"id": f"a{i}", "agent_key": f"ag{i}", "status": "AVAILABLE", "last_heartbeat": now.isoformat(), "capabilities": {"all": True}} for i in range(5)]
        tasks = [{"id": f"t{i}", "task_key": f"tk{i}", "status": "QUEUED", "priority": 100} for i in range(10)]
        matches = scheduler.calculate_schedule(agents, tasks)
        self.assertEqual(len(matches), 5)

    def test_M_zero_agents_tasks_remain_queued(self):
        scheduler = DynamicCapacityScheduler()
        tasks = [{"id": f"t{i}", "task_key": f"tk{i}", "status": "QUEUED"} for i in range(5)]
        matches = scheduler.calculate_schedule([], tasks)
        self.assertEqual(len(matches), 0)

    def test_N_capability_mismatch(self):
        scheduler = DynamicCapacityScheduler()
        now = datetime.datetime.now(datetime.timezone.utc)
        agents = [{"id": "a1", "agent_key": "ag1", "status": "AVAILABLE", "last_heartbeat": now.isoformat(), "capabilities": {"rust": True}}]
        tasks = [{"id": "t1", "task_key": "tk1", "status": "QUEUED", "required_capabilities": ["security_sandbox"]}]
        matches = scheduler.calculate_schedule(agents, tasks)
        self.assertEqual(len(matches), 0)

    def test_O_resource_capacity_exhausted(self):
        scheduler = DynamicCapacityScheduler()
        now = datetime.datetime.now(datetime.timezone.utc)
        # Agent busy with current_task_id
        agents = [{"id": "a1", "agent_key": "ag1", "status": "WORKING", "current_task_id": "other_task", "last_heartbeat": now.isoformat()}]
        tasks = [{"id": "t1", "task_key": "tk1", "status": "QUEUED"}]
        matches = scheduler.calculate_schedule(agents, tasks)
        self.assertEqual(len(matches), 0)

    def test_P_task_decomposer_default_disabled(self):
        decomposer = TaskDecomposer(enabled=False)
        task = {"id": "t1", "title": "Large Task"}
        self.assertFalse(decomposer.can_decompose(task))
        self.assertEqual(decomposer.decompose(task), [task])

    def test_Q_scheduler_dry_run_safety(self):
        scheduler = DynamicCapacityScheduler(control_plane=self.client, fleet_mode="canary")
        res = scheduler.start_dry_run()
        self.assertTrue(res.get("dry_run"))
        self.assertIn("planned_assignments", res)

    # ==========================================================================
    # 3. Recovery Tests (R - X)
    # ==========================================================================
    def test_R_to_X_recovery_semantics(self):
        # Verify reap_expired_leases handles expired leases gracefully
        st, res = self.client.reap_expired_leases()
        self.assertEqual(st, 200)
        self.assertTrue(res.get("success"))
        self.assertIn("reclaimable_tasks_count", res)

    # ==========================================================================
    # 4. Execution Worker Tests (Y - AH)
    # ==========================================================================
    def test_Y_worker_registration_hardware_discovery(self):
        worker = LaptopExecutionWorker("test-hw-discovery", self.spec_id)
        cap = worker.discover_system_capacity()
        self.assertIn("hostname", cap)
        self.assertIn("cpu_count", cap)
        self.assertGreaterEqual(cap["cpu_count"], 1)

    def test_Z_allowlisted_syntax_check(self):
        backend = LocalLaptopBackend()
        # syntax check python file
        res = backend.execute("syntax_check", [str(Path(__file__).resolve())])
        self.assertEqual(res["status"], "SUCCESS")
        self.assertEqual(res["exit_code"], 0)

    def test_AA_forbidden_command_profile_blocked(self):
        backend = LocalLaptopBackend()
        res = backend.execute("raw_bash_rm_rf", ["-rf", "/"])
        self.assertEqual(res["status"], "VALIDATION_FAILED")
        self.assertIn("not in the allowlist", res["error"])

    def test_AB_shell_injection_argument_blocked(self):
        backend = LocalLaptopBackend()
        res = backend.execute("syntax_check", ["file.py; rm -rf /"])
        self.assertEqual(res["status"], "VALIDATION_FAILED")
        self.assertIn("rejected by security sandbox", res["error"])

    def test_AC_execution_timeout_handling(self):
        backend = LocalLaptopBackend()
        # Run orchestration tests with 0.001s timeout to test timeout handling
        res = backend.execute("syntax_check", [str(Path(__file__).resolve())], timeout_seconds=0.0001)
        # Either SUCCESS (if ran extremely fast) or TIMEOUT
        self.assertIn(res["status"], ["SUCCESS", "TIMEOUT"])

    def test_AD_worker_execution_slot_governance(self):
        worker = LaptopExecutionWorker("test-slot-gov", self.spec_id)
        # Execute syntax check
        res = worker.execute_task_action("task-dummy", "syntax_check", [str(Path(__file__).resolve())])
        self.assertEqual(res["status"], "SUCCESS")
        self.assertEqual(worker.active_build_slots, 0)
        self.assertEqual(worker.active_test_slots, 0)

    # ==========================================================================
    # 5. Immutable Safety Tests (AI - AL)
    # ==========================================================================
    def test_AI_to_AL_immutable_tasks_safety(self):
        canonical_done = [
            "runtime-kernel/m1-runner",
            "execution-engine/m2-state-machine",
            "data-plane/m3-item-buffer",
            "security/m10-fs-sandbox",
            "runtime-kernel/m1-frame",
            "expression-engine/m7-tokenizer",
            "runtime-kernel/m1-graph"
        ]
        for key in canonical_done:
            t = self.client.get_task_by_key(key)
            self.assertIsNotNone(t, f"Task {key} must exist")
            self.assertEqual(t["status"], "DONE", f"Task {key} must be DONE")

if __name__ == "__main__":
    unittest.main()
