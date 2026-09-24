"""
Autonomous Arena Worker Client.
Runs on an execution node/agent host with a scoped Worker Gateway Token ('agw_...').
Executes the autonomous lifecycle:
1. Register with Supabase Control Plane via Gateway (register_worker).
2. Start background heartbeat pulse (worker_heartbeat).
3. Poll for assigned or available tasks.
4. Atomically claim task lease with OCC version protection.
5. Create dedicated workspace/branch and record checkpoints.
6. Trigger compilation/tests via Laptop Webhook Agent (laptop.run_test).
7. Submit commit and complete task on Control Plane.
"""

import time
import json
import threading
from pathlib import Path
from typing import Dict, Any, Optional

from tools.gateway.gateway import CapabilityGateway
from tools.gateway.auth import GatewayAuth

class ArenaWorkerAgent:
    def __init__(
        self,
        worker_id: str,
        specialization_id: str,
        gateway: Optional[CapabilityGateway] = None,
        worker_token: Optional[str] = None,
        heartbeat_interval: int = 15
    ):
        self.worker_id = worker_id
        self.specialization_id = specialization_id
        self.gateway = gateway or CapabilityGateway()
        self.auth = GatewayAuth()
        self.token = worker_token or self.auth.get_token_for_role("worker")
        self.heartbeat_interval = heartbeat_interval
        self.agent_db_id: Optional[str] = None
        self.current_task_id: Optional[str] = None
        self.is_running = False
        self._hb_thread: Optional[threading.Thread] = None

    def _invoke(self, capability: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self.gateway.invoke(
            caller_id=self.worker_id,
            capability=capability,
            params=params or {},
            bearer_token=self.token
        )

    def register(self) -> bool:
        """Registers the worker in Supabase Control Plane."""
        res = self._invoke("supabase.register_worker", {
            "worker_id": self.worker_id,
            "specialization_id": self.specialization_id,
            "capabilities": {"cargo_test": True, "cargo_check": True},
            "hostname": "laptop-worker-node",
            "platform": "windows"
        })
        if res.get("ok"):
            reg_data = res.get("result", {})
            agent_obj = reg_data.get("agent") or {}
            self.agent_db_id = agent_obj.get("id")
            return True
        return False

    def _heartbeat_loop(self):
        # Runner protocol: the loop wakes at most every 1s; the heartbeat itself is
        # still emitted on its own cadence so the external API call rate is unchanged.
        last_emit = None
        while self.is_running:
            now = time.monotonic()
            if self.agent_db_id and (last_emit is None or now - last_emit >= self.heartbeat_interval):
                self._invoke("supabase.worker_heartbeat", {
                    "agent_id": self.agent_db_id,
                    "status": "WORKING" if self.current_task_id else "AVAILABLE",
                    "current_task_id": self.current_task_id
                })
                last_emit = now
            time.sleep(1)

    def start_heartbeat(self):
        if not self.is_running:
            self.is_running = True
            self._hb_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
            self._hb_thread.start()

    def stop_heartbeat(self):
        self.is_running = False
        if self._hb_thread:
            self._hb_thread.join(timeout=1.0)

    def claim_task(self, task_id: str, expected_version: int = 0, lease_seconds: int = 600) -> Dict[str, Any]:
        """Claims a task lease from Supabase."""
        if not self.agent_db_id:
            if not self.register():
                return {"ok": False, "error": "Worker not registered in database"}

        res = self._invoke("supabase.claim_task_lease", {
            "task_id": task_id,
            "agent_id": self.agent_db_id,
            "expected_version": expected_version,
            "lease_seconds": lease_seconds
        })
        if res.get("ok"):
            self.current_task_id = task_id
        return res

    def record_progress(self, task_id: str, branch_name: str, desc: str, commit_sha: Optional[str] = None) -> Dict[str, Any]:
        """Saves a checkpoint in agent_checkpoints."""
        return self._invoke("supabase.record_checkpoint", {
            "task_id": task_id,
            "agent_id": self.agent_db_id,
            "branch_name": branch_name,
            "description": desc,
            "commit_sha": commit_sha
        })

    def run_verification(self, crate: Optional[str] = None) -> Dict[str, Any]:
        """Runs test verification via Laptop Webhook / Laptop Provider."""
        return self._invoke("laptop.run_test", {"crate": crate} if crate else {})
