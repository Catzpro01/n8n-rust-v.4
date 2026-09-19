"""
Dynamic Task Scheduler & Dispatch Engine.
Determines available ready tasks based on DAG dependencies, active file locks,
and specialization domain affinity. Prevents multi-agent file collisions.
"""

from typing import Dict, List, Optional, Set, Tuple
from tools.orchestration.task_manifest_catalog import CANONICAL_TASKS

class DynamicTaskScheduler:
    def __init__(self, tasks: Optional[List[dict]] = None):
        """
        Initializes scheduler with a list of task state dicts.
        If None, initializes from canonical catalog with all QUEUED except m1-runner (DONE).
        """
        self.catalog = {t["task_key"]: t for t in CANONICAL_TASKS}
        self.current_time = 0.0
        
        if tasks is None:
            self.tasks: Dict[str, dict] = {}
            for t in CANONICAL_TASKS:
                k = t["task_key"]
                is_m1_runner = (k == "runtime-kernel/m1-runner")
                self.tasks[k] = {
                    "task_key": k,
                    "specialization": t["specialization"],
                    "milestone": t["milestone"],
                    "status": "DONE" if is_m1_runner else "QUEUED",
                    "dependencies": t.get("dependencies", []),
                    "exclusive_files": t.get("exclusive_files", []),
                    "allowed_files": t.get("allowed_files", []),
                    "assigned_agent_id": None,
                    "progress_weight": t["progress_weight"],
                    "lease_expiry": 0.0,
                    "version": 1
                }
        else:
            self.tasks = {t["task_key"]: dict(t) for t in tasks}

    def get_task(self, task_key: str) -> Optional[dict]:
        return self.tasks.get(task_key)

    def set_task_status(self, task_key: str, status: str, agent_id: Optional[str] = None):
        if task_key in self.tasks:
            self.tasks[task_key]["status"] = status
            if agent_id is not None:
                self.tasks[task_key]["assigned_agent_id"] = agent_id

    def advance_time(self, seconds: float):
        """Advances simulated time and reaps expired leases."""
        self.current_time += seconds
        self.reap_expired_leases()

    def reap_expired_leases(self):
        """Mark tasks with expired leases as RECLAIMABLE."""
        active_statuses = {"CLAIMED", "WORKING"}
        for t in self.tasks.values():
            if t.get("status") in active_statuses:
                if 0.0 < t.get("lease_expiry", 0.0) < self.current_time:
                    t["status"] = "RECLAIMABLE"
                    t["assigned_agent_id"] = None

    def get_active_exclusive_files(self) -> Set[str]:
        """
        Collects all exclusive files currently locked by active tasks.
        RECLAIMABLE tasks don't hold locks.
        """
        active_statuses = {"CLAIMED", "WORKING", "PR_OPEN", "BUILDING", "TESTING", "AUDITING", "MERGING"}
        locked_files = set()
        for t in self.tasks.values():
            if t.get("status") in active_statuses:
                for f in t.get("exclusive_files", []):
                    locked_files.add(f.replace("\\", "/"))
        return locked_files

    def is_task_dependencies_satisfied(self, task_key: str) -> bool:
        task = self.tasks.get(task_key)
        if not task:
            return False
        deps = task.get("dependencies", [])
        for dep in deps:
            dep_task = self.tasks.get(dep)
            if not dep_task or dep_task.get("status") not in {"DONE", "COMPLETED"}:
                return False
        return True

    def get_ready_tasks(self, specialization: Optional[str] = None) -> List[dict]:
        """
        Returns all tasks that:
        1. Are currently QUEUED or RECLAIMABLE
        2. Have 100% satisfied dependencies (DONE / COMPLETED)
        3. Do NOT collide with currently active exclusive files
        4. Match the requested specialization (if provided)
        """
        self.reap_expired_leases()
        active_locked_files = self.get_active_exclusive_files()
        ready = []

        for k, t in self.tasks.items():
            if t.get("status") not in {"QUEUED", "RECLAIMABLE"}:
                continue
            if specialization and t.get("specialization") != specialization:
                continue
            if not self.is_task_dependencies_satisfied(k):
                continue
            
            # Check exclusive file collision
            ex_files = {f.replace("\\", "/") for f in t.get("exclusive_files", [])}
            if ex_files.intersection(active_locked_files):
                continue

            ready.append(t)

        # Sort by milestone order then weight desc, prioritize RECLAIMABLE
        ready.sort(key=lambda x: (
            0 if x["status"] == "RECLAIMABLE" else 1, 
            int(x["milestone"][1:]), 
            -x["progress_weight"]
        ))
        return ready

    def atomic_claim(self, task_key: str, agent_id: str, expected_version: int, lease_duration: float = 3600.0) -> bool:
        """
        Atomically claims a specific task if OCC version matches and state is valid.
        """
        self.reap_expired_leases()
        t = self.tasks.get(task_key)
        if not t:
            return False
        
        if t["version"] != expected_version:
            return False
            
        if t["status"] not in {"QUEUED", "RECLAIMABLE"}:
            return False
            
        active_locked_files = self.get_active_exclusive_files()
        ex_files = {f.replace("\\", "/") for f in t.get("exclusive_files", [])}
        if ex_files.intersection(active_locked_files):
            return False
            
        t["status"] = "CLAIMED"
        t["assigned_agent_id"] = agent_id
        t["lease_expiry"] = self.current_time + lease_duration
        t["version"] += 1
        return True

    def dispatch_next_task(self, agent_id: str, specialization: str, lease_duration: float = 3600.0) -> Optional[dict]:
        """
        Atomically selects and claims the highest-priority eligible ready task for an agent.
        """
        ready = self.get_ready_tasks(specialization=specialization)
        if not ready:
            return None

        chosen = ready[0]
        k = chosen["task_key"]
        
        if self.atomic_claim(k, agent_id, chosen["version"], lease_duration):
            return self.tasks[k]
        return None
