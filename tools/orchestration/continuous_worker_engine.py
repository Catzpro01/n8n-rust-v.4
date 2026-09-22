"""
Continuous Autonomous Worker Engine.
Implements the uninterrupted execution loop for exactly 5 registered workers:
heartbeat -> discover -> claim/reclaim -> start -> execute/build/test/audit -> authorize_merge -> merge -> cleanup -> next task.
"""

import time
import logging
from typing import Dict, List, Optional, Any, Tuple
from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.task_manifest_catalog import CANONICAL_TASKS
from tools.orchestration.boundary_guard import TaskBoundaryGuard

logger = logging.getLogger("ContinuousWorkerEngine")

class ContinuousWorkerEngine:
    def __init__(self, client: Optional[ControlPlaneClient] = None, poll_interval_seconds: int = 5):
        self.client = client or ControlPlaneClient()
        self.poll_interval_seconds = poll_interval_seconds
        self.catalog = {t["task_key"]: t for t in CANONICAL_TASKS}
        self.guard = TaskBoundaryGuard()

    def get_live_tasks_state(self) -> Dict[str, dict]:
        """Fetches all tasks from Supabase to form dynamic dependency DAG."""
        st, tasks = self.client._request("tasks?select=*")
        if st != 200 or not isinstance(tasks, list):
            logger.error(f"Failed to fetch live tasks: HTTP {st}")
            return {}
        return {t["task_key"]: t for t in tasks}

    def get_eligible_tasks_for_agent(self, agent: dict, live_tasks: Dict[str, dict]) -> List[dict]:
        """
        Determines ready tasks that satisfy:
        1. Status == QUEUED (with 100% completed dependencies) OR Status == RECLAIMABLE
        2. No exclusive file lock collisions with currently active tasks
        3. Specialization match OR agent has cross-domain capabilities
        """
        active_statuses = {"CLAIMED", "WORKING", "PR_OPEN", "BUILDING", "TESTING", "AUDITING", "MERGING"}
        locked_files = set()
        for t_key, t_live in live_tasks.items():
            if t_live.get("status") in active_statuses:
                cat = self.catalog.get(t_key, {})
                for f in cat.get("exclusive_files", []):
                    locked_files.add(f.replace("\\", "/"))

        agent_spec_id = agent.get("specialization_id")
        caps = agent.get("capabilities", {})
        has_cross_domain = bool(caps.get("all") or caps.get("cross_domain") or caps.get(str(agent_spec_id)))

        candidates = []
        for t_key, t_live in live_tasks.items():
            status = t_live.get("status")
            if status not in {"QUEUED", "RECLAIMABLE"}:
                continue

            # Check specialization match
            if str(t_live.get("specialization_id")) != str(agent_spec_id) and not has_cross_domain:
                continue

            cat = self.catalog.get(t_key, {})
            # Check DAG dependencies
            deps = cat.get("dependencies", [])
            deps_satisfied = True
            for dep_key in deps:
                dep_task = live_tasks.get(dep_key)
                if not dep_task or dep_task.get("status") not in {"DONE", "COMPLETED"}:
                    deps_satisfied = False
                    break

            if not deps_satisfied:
                continue

            # Check exclusive file collision
            ex_files = {f.replace("\\", "/") for f in cat.get("exclusive_files", [])}
            if ex_files.intersection(locked_files):
                continue

            candidates.append({
                **t_live,
                "exclusive_files": cat.get("exclusive_files", []),
                "allowed_files": cat.get("allowed_files", []),
                "dependencies": deps
            })

        # Priority ranking:
        # 1. RECLAIMABLE first
        # 2. Priority asc (lower integer = higher priority)
        # 3. Progress weight desc
        candidates.sort(key=lambda x: (
            0 if x.get("status") == "RECLAIMABLE" else 1,
            x.get("priority", 100),
            -float(x.get("progress_weight", 1.0))
        ))
        return candidates

    def try_claim_candidate(self, agent: dict, candidate: dict) -> Tuple[bool, Optional[dict]]:
        """
        Attempts an atomic claim or reclaim via OCC stored procedure.
        If another worker claimed it concurrently, returns False without crashing.
        """
        task_id = candidate["id"]
        agent_id = agent["id"]
        version = candidate["version"]
        status = candidate["status"]

        if status == "RECLAIMABLE":
            st, res = self.client.reclaim_task(task_id, agent_id, version)
        else:
            st, res = self.client.claim_task(task_id, agent_id, version)

        if st == 200 and res.get("success"):
            return True, res
        return False, res

    def worker_heartbeat(self, agent_id: str, status: Optional[str] = None, task_id: Optional[str] = None) -> bool:
        """Maintains agent heartbeat in control plane."""
        st, _ = self.client.heartbeat_agent(agent_id, status=status, task_id=task_id)
        return st == 200 or st == 204

    def advance_worker_cycle(self, agent_id: str) -> Dict[str, Any]:
        """
        Executes one autonomous tick for a worker:
        - Checks if agent already has a task
        - If free, discovers candidates and attempts atomic claim
        - Returns cycle summary
        """
        st, agents = self.client._request(f"agents?id=eq.{agent_id}&limit=1")
        if st != 200 or not agents:
            return {"status": "AGENT_NOT_FOUND"}
        agent = agents[0]

        # Send heartbeat
        self.worker_heartbeat(agent_id, status=agent["status"], task_id=agent.get("current_task_id"))

        # If agent is currently working on a task, report active
        if agent.get("current_task_id"):
            return {
                "status": "WORKING_ON_TASK",
                "task_id": agent["current_task_id"],
                "agent_status": agent["status"]
            }

        # Otherwise agent is idle/available: search for ready task
        live_tasks = self.get_live_tasks_state()
        candidates = self.get_eligible_tasks_for_agent(agent, live_tasks)

        if not candidates:
            return {"status": "NO_TASKS_READY", "candidates_count": 0}

        # Attempt atomic claim on best candidate
        for cand in candidates:
            success, claim_res = self.try_claim_candidate(agent, cand)
            if success:
                return {
                    "status": "TASK_CLAIMED",
                    "task_key": cand["task_key"],
                    "task_id": cand["id"],
                    "claim_result": claim_res
                }
            logger.info(f"Worker {agent_id} contested claim for {cand['task_key']}: {claim_res}")

        return {"status": "CONTESTED_OR_BLOCKED", "tried_candidates": len(candidates)}
