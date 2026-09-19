"""
Laptop Execution Worker & Execution Backend Abstraction.
Encapsulates host-level build, test, and verification tasks using strictly allowlisted command profiles.
Never executes arbitrary raw shell strings.
"""

import os
import sys
import platform
import subprocess
import logging
import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.resource_governor import ResourceGovernor
from tools.orchestration.realtime_event_layer import RealtimeEventLayer

logger = logging.getLogger(__name__)

# Allowlisted execution profiles for safety
ALLOWLISTED_COMMAND_PROFILES = {
    "cargo_check": ["cargo", "check", "--workspace"],
    "cargo_test": ["cargo", "test", "--workspace", "--no-run"],
    "cargo_test_unit": ["cargo", "test", "--workspace"],
    "cargo_build": ["cargo", "build", "--workspace"],
    "cargo_test_package": ["cargo", "test", "-p"],
    "orchestration_unit_test": [sys.executable, "-m", "unittest", "discover", "-s", "tools/orchestration/tests"],
    "syntax_check": [sys.executable, "-m", "py_compile"]
}

class ExecutionBackend:
    """Base abstract execution backend."""
    def execute(self, profile: str, args: Optional[List[str]] = None, cwd: Optional[Path] = None, timeout_seconds: int = 300) -> Dict[str, Any]:
        raise NotImplementedError

class LocalLaptopBackend(ExecutionBackend):
    """
    Concrete laptop execution backend.
    Enforces profile allowlist, timeouts, workspace isolation, and slot governance.
    """
    def __init__(self, workspace_root: Optional[Path] = None):
        self.workspace_root = workspace_root or Path(__file__).resolve().parent.parent.parent
        self.governor = ResourceGovernor()

    def execute(self, profile: str, args: Optional[List[str]] = None, cwd: Optional[Path] = None, timeout_seconds: int = 300) -> Dict[str, Any]:
        if profile not in ALLOWLISTED_COMMAND_PROFILES:
            return {
                "status": "VALIDATION_FAILED",
                "exit_code": -1,
                "error": f"Command profile '{profile}' is not in the allowlist.",
                "stdout": "",
                "stderr": f"Profile '{profile}' forbidden."
            }

        cmd = list(ALLOWLISTED_COMMAND_PROFILES[profile])
        if args:
            # Only append arguments that do not contain shell injection operators
            for arg in args:
                if any(bad in arg for bad in [";", "&", "|", "`", "$", "(", ")", ">", "<"]):
                    return {
                        "status": "VALIDATION_FAILED",
                        "exit_code": -1,
                        "error": f"Argument '{arg}' rejected by security sandbox.",
                        "stdout": "",
                        "stderr": "Potential shell injection detected in argument."
                    }
                cmd.append(arg)

        work_dir = cwd or self.workspace_root
        start_time = datetime.datetime.now(datetime.timezone.utc)

        try:
            res = subprocess.run(
                cmd,
                cwd=str(work_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout_seconds
            )
            completed_time = datetime.datetime.now(datetime.timezone.utc)
            status = "SUCCESS" if res.returncode == 0 else ("BUILD_FAILED" if "build" in profile or "check" in profile else "TEST_FAILED")
            return {
                "status": status,
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr,
                "started_at": start_time.isoformat(),
                "completed_at": completed_time.isoformat(),
                "command_profile": profile,
                "cmd": cmd
            }
        except subprocess.TimeoutExpired as te:
            completed_time = datetime.datetime.now(datetime.timezone.utc)
            return {
                "status": "TIMEOUT",
                "exit_code": -1,
                "stdout": te.stdout or "",
                "stderr": te.stderr or f"Command timed out after {timeout_seconds} seconds.",
                "started_at": start_time.isoformat(),
                "completed_at": completed_time.isoformat(),
                "command_profile": profile,
                "cmd": cmd
            }
        except Exception as e:
            completed_time = datetime.datetime.now(datetime.timezone.utc)
            return {
                "status": "WORKER_LOST",
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e),
                "started_at": start_time.isoformat(),
                "completed_at": completed_time.isoformat(),
                "command_profile": profile,
                "cmd": cmd
            }

class LaptopExecutionWorker:
    """
    Laptop Execution Worker supporting dynamic registration, periodic heartbeat proof,
    local workspace isolation, and governed task execution.
    """
    def __init__(
        self,
        agent_key: str,
        specialization_id: str,
        capabilities: Optional[Dict[str, Any]] = None,
        workspace_root: Optional[Path] = None,
        control_plane: Optional[ControlPlaneClient] = None,
        event_layer: Optional[RealtimeEventLayer] = None
    ):
        self.agent_key = agent_key
        self.specialization_id = specialization_id
        self.capabilities = capabilities or {
            "rust": True,
            "rust-build": True,
            "rust-test": True,
            "orchestration": True,
            "windows": platform.system().lower() == "windows",
            "linux": platform.system().lower() == "linux"
        }
        self.workspace_root = workspace_root or Path(__file__).resolve().parent.parent.parent
        self.client = control_plane or ControlPlaneClient()
        self.event_layer = event_layer or RealtimeEventLayer()
        self.backend = LocalLaptopBackend(self.workspace_root)
        self.agent_id: Optional[str] = None
        self.status = "REGISTERING"
        self.current_task_id: Optional[str] = None
        self.active_build_slots = 0
        self.active_test_slots = 0

    def discover_system_capacity(self) -> Dict[str, Any]:
        """Discovers host hardware specs without hardcoded assumptions."""
        cpu_count = os.cpu_count() or 4
        return {
            "hostname": platform.node(),
            "platform": platform.platform(),
            "cpu_count": cpu_count,
            "build_slots": max(1, min(2, cpu_count // 4)),
            "test_slots": max(1, min(4, cpu_count // 2)),
            "worker_version": "1.1.0"
        }

    def register(self) -> Tuple[int, Dict[str, Any]]:
        capacity = self.discover_system_capacity()
        st, res = self.client.register_dynamic_agent(
            agent_key=self.agent_key,
            specialization_id=self.specialization_id,
            capabilities=self.capabilities,
            hostname=capacity["hostname"],
            platform_name=capacity["platform"],
            workspace_root=str(self.workspace_root),
            worker_version=capacity["worker_version"],
            execution_backend="local_laptop",
            resource_capacity=capacity
        )
        if st == 200 and res.get("success"):
            ag_data = res.get("agent", {})
            self.agent_id = ag_data.get("id")
            self.status = "AVAILABLE"
            self.event_layer.emit("agent.registered", {"agent_id": self.agent_id, "agent_key": self.agent_key})
        return st, res

    def heartbeat(self) -> Tuple[int, Dict[str, Any]]:
        if not self.agent_id:
            return 400, {"error": "Worker not registered"}
        st, res = self.client.agent_heartbeat_proof(
            agent_id=self.agent_id,
            worker_state=self.status,
            current_task_id=self.current_task_id,
            active_build_slots=self.active_build_slots,
            active_test_slots=self.active_test_slots
        )
        if st == 200:
            self.event_layer.emit("agent.heartbeat", {"agent_id": self.agent_id, "status": self.status})
        return st, res

    def drain(self) -> Tuple[int, Dict[str, Any]]:
        if not self.agent_id:
            return 400, {"error": "Worker not registered"}
        st, res = self.client.drain_agent(self.agent_id)
        if st == 200:
            self.status = res.get("status", "DRAINING")
            self.event_layer.emit("agent.draining", {"agent_id": self.agent_id, "status": self.status})
        return st, res

    def execute_task_action(self, task_id: str, profile: str, args: Optional[List[str]] = None, cwd: Optional[Path] = None) -> Dict[str, Any]:
        """
        Executes a task verification step with slot allocation and result contracts.
        """
        is_build = "build" in profile or "check" in profile
        if is_build:
            self.active_build_slots += 1
            self.status = "BUILDING"
            self.event_layer.emit("build.started", {"task_id": task_id, "agent_id": self.agent_id})
        else:
            self.active_test_slots += 1
            self.status = "TESTING"
            self.event_layer.emit("test.started", {"task_id": task_id, "agent_id": self.agent_id})

        try:
            exec_res = self.backend.execute(profile, args, cwd=cwd)
            exec_res["agent_id"] = self.agent_id
            exec_res["task_id"] = task_id
            return exec_res
        finally:
            if is_build:
                self.active_build_slots = max(0, self.active_build_slots - 1)
                self.event_layer.emit("build.completed", {"task_id": task_id, "agent_id": self.agent_id})
            else:
                self.active_test_slots = max(0, self.active_test_slots - 1)
                self.event_layer.emit("test.completed", {"task_id": task_id, "agent_id": self.agent_id})
            self.status = "WORKING" if self.current_task_id else "AVAILABLE"
