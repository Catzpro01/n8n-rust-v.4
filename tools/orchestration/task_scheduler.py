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
                    "progress_weight": t["progress_weight"]
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

    def get_active_exclusive_files(self) -> Set[str]:
        """
        Collects all exclusive files currently locked by active tasks (CLAIMED, WORKING, BUILDING, TESTING, AUDITING, MERGING).
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
        1. Are currently QUEUED
        2. Have 100% satisfied dependencies (DONE / COMPLETED)
        3. Do NOT collide with currently active exclusive files
        4. Match the requested specialization (if provided)
        """
        active_locked_files = self.get_active_exclusive_files()
        ready = []

        for k, t in self.tasks.items():
            if t.get("status") != "QUEUED":
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

        # Sort by milestone order then weight desc
        ready.sort(key=lambda x: (int(x["milestone"][1:]), -x["progress_weight"]))
        return ready

    def dispatch_next_task(self, agent_id: str, specialization: str) -> Optional[dict]:
        """
        Atomically selects and claims the highest-priority eligible ready task for an agent.
        """
        ready = self.get_ready_tasks(specialization=specialization)
        if not ready:
            # Optionally check cross-domain if allowed, otherwise return None
            return None

        chosen = ready[0]
        k = chosen["task_key"]
        self.set_task_status(k, "CLAIMED", agent_id=agent_id)
        return self.tasks[k]
