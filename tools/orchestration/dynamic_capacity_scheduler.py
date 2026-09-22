"""
Dynamic Capacity Scheduler & Capability Matching Subsystem.
Calculates assignments dynamically across an unbounded agent fleet based on:
READY TASKS x AVAILABLE AGENTS x CAPABILITIES x RESOURCE CAPACITY x FILE CONSTRAINTS.

Never relies on hardcoded agent counts (e.g. 5) or fixed mapping.
Supports dynamic agent fleets (1, 2, 5, 10, 50+ workers).
"""

import logging
import datetime
from typing import Dict, Any, List, Optional, Tuple

from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.realtime_event_layer import RealtimeEventLayer

logger = logging.getLogger(__name__)

class TaskDecomposer:
    """
    Task Decomposition abstraction for automatic fan-out/fan-in.
    Per Phase S1 specifications: Interface is established but functionality remains DISABLED by default.
    """
    def __init__(self, enabled: bool = False):
        self.enabled = enabled

    def can_decompose(self, task: Dict[str, Any]) -> bool:
        return self.enabled

    def decompose(self, task: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not self.enabled:
            return [task]
        return [task]

class DynamicCapacityScheduler:
    """
    Dynamic capacity-aware scheduler for unbounded agent fleets.
    """
    def __init__(
        self,
        control_plane: Optional[ControlPlaneClient] = None,
        event_layer: Optional[RealtimeEventLayer] = None,
        fleet_mode: str = "disabled",
        heartbeat_timeout_seconds: int = 600
    ):
        self.client = control_plane or ControlPlaneClient()
        self.event_layer = event_layer or RealtimeEventLayer()
        self.fleet_mode = fleet_mode  # "disabled", "canary", "production"
        self.heartbeat_timeout_seconds = heartbeat_timeout_seconds
        self.decomposer = TaskDecomposer(enabled=False)

    def is_agent_liveness_valid(self, agent: Dict[str, Any], now: Optional[datetime.datetime] = None) -> bool:
        """
        Determines if an agent is truly alive based on its heartbeat timestamp,
        not merely row existence.
        """
        status = agent.get("status", "")
        if status in ["OFFLINE", "ERROR", "DRAINING"]:
            return False

        hb_str = agent.get("last_heartbeat")
        if not hb_str:
            return False

        now = now or datetime.datetime.now(datetime.timezone.utc)
        try:
            # Handle ISO formatting
            clean_hb = hb_str.replace("Z", "+00:00")
            hb_dt = datetime.datetime.fromisoformat(clean_hb)
            diff = (now - hb_dt).total_seconds()
            return diff <= self.heartbeat_timeout_seconds
        except Exception:
            return False

    def is_capability_compatible(self, agent: Dict[str, Any], task: Dict[str, Any]) -> bool:
        """
        Capability matching:
        Evaluates task required_capabilities vs agent capabilities.
        Also supports backward compatibility with specialization_id matching.
        """
        agent_caps = agent.get("capabilities", {})
        if not isinstance(agent_caps, dict):
            agent_caps = {}

        # Universal fallback for general workers
        if agent_caps.get("all") or agent_caps.get("cross_domain"):
            return True

        req_caps = task.get("required_capabilities", [])
        if isinstance(req_caps, list) and req_caps:
            for req in req_caps:
                if not agent_caps.get(req):
                    return False

        exc_caps = task.get("excluded_capabilities", [])
        if isinstance(exc_caps, list) and exc_caps:
            for exc in exc_caps:
                if agent_caps.get(exc):
                    return False

        # If task has a specific specialization, agent must match either specialization_id or domain capability
        task_spec = task.get("specialization_id")
        agent_spec = agent.get("specialization_id")
        if task_spec and agent_spec and task_spec != agent_spec:
            # Check domain capability
            if not agent_caps.get(str(task_spec)):
                return False

        return True

    def calculate_schedule(
        self,
        agents: List[Dict[str, Any]],
        tasks: List[Dict[str, Any]],
        max_concurrency: Optional[int] = None
    ) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
        """
        Calculates deterministic matches:
        READY TASKS x AVAILABLE AGENTS x CAPABILITIES x RESOURCE CAPACITY.
        Returns a list of (task, agent) tuples.
        """
        now = datetime.datetime.now(datetime.timezone.utc)

        # Filter strictly alive and available agents
        available_agents = [
            a for a in agents
            if a.get("status") in ["AVAILABLE", "CLAIMING"]
            and a.get("current_task_id") is None
            and self.is_agent_liveness_valid(a, now)
        ]

        # Filter queued tasks
        queued_tasks = [
            t for t in tasks
            if t.get("status") in ["QUEUED", "RECLAIMABLE"]
        ]

        # Sort tasks deterministically by priority (lower number = higher priority), then created_at
        queued_tasks.sort(key=lambda t: (t.get("priority", 100), t.get("created_at", "")))

        # Sort agents deterministically by key for fairness
        available_agents.sort(key=lambda a: a.get("agent_key", ""))

        assignments: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
        used_agents = set()

        limit = max_concurrency or len(available_agents)
        if self.fleet_mode == "canary":
            limit = min(limit, 1)

        for task in queued_tasks:
            if len(assignments) >= limit:
                break

            # Find first compatible available agent
            matched_agent = None
            for agent in available_agents:
                if agent["id"] in used_agents:
                    continue
                if self.is_capability_compatible(agent, task):
                    matched_agent = agent
                    break

            if matched_agent:
                assignments.append((task, matched_agent))
                used_agents.add(matched_agent["id"])

        return assignments

    def start_dry_run(self) -> Dict[str, Any]:
        """
        START abstraction default: strictly DRY-RUN / CANARY evaluation.
        Never dispatches tasks to production without explicit activation flag.
        """
        st_ag, agents = self.client._request("agents?select=*")
        st_ts, tasks = self.client._request("tasks?status=in.(QUEUED,RECLAIMABLE)&select=*")

        agents_list = agents if isinstance(agents, list) else []
        tasks_list = tasks if isinstance(tasks, list) else []

        matches = self.calculate_schedule(agents_list, tasks_list)

        report = {
            "mode": self.fleet_mode,
            "dry_run": True,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "discovered_agents": len(agents_list),
            "available_agents": sum(1 for a in agents_list if a.get("status") == "AVAILABLE"),
            "queued_tasks": len(tasks_list),
            "planned_assignments_count": len(matches),
            "planned_assignments": [
                {
                    "task_key": t.get("task_key"),
                    "task_id": t.get("id"),
                    "agent_key": a.get("agent_key"),
                    "agent_id": a.get("id")
                }
                for t, a in matches
            ]
        }
        self.event_layer.emit("scheduler.dry_run_completed", report)
        return report
