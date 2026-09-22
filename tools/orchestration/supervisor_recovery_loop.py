"""
Supervisor and Heartbeat Recovery Loop Daemon.
Continuously runs in the background (or periodic cron/tick) to:
1. Ping Control Plane to reap expired leases and offline dead agents.
2. Detect RECLAIMABLE tasks in the Recovery Plane.
3. Automatically match and dispatch eligible available workers to reclaim tasks.
4. Maintain uninterrupted multi-agent autonomous execution.
"""

import time
import logging
from typing import Optional, Dict, Any, List
from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.task_scheduler import DynamicTaskScheduler

logger = logging.getLogger("SupervisorRecoveryLoop")

class SupervisorRecoveryLoop:
    def __init__(self, client: Optional[ControlPlaneClient] = None, interval_seconds: int = 5):
        self.client = client or ControlPlaneClient()
        self.interval_seconds = interval_seconds
        self.running = False

    def tick(self) -> Dict[str, Any]:
        """
        Executes a single autonomous recovery supervision cycle:
        1. Calls reap_expired_leases RPC.
        2. Queries RECLAIMABLE tasks.
        3. Attempts to match available workers to reclaim tasks.
        """
        result = {
            "reaped_leases": {},
            "reclaimed_count": 0,
            "errors": []
        }

        # Step 1: Trigger control plane lease reaping
        st, reap_res = self.client.reap_expired_leases()
        if st == 200 and reap_res.get("success"):
            result["reaped_leases"] = reap_res
        else:
            result["errors"].append(f"reap_expired_leases failed: HTTP {st} {reap_res}")

        # Step 2: Check for RECLAIMABLE tasks
        st, reclaimable_tasks = self.client._request("tasks?status=eq.RECLAIMABLE&select=*")
        if st != 200 or not isinstance(reclaimable_tasks, list):
            return result

        if not reclaimable_tasks:
            return result

        # Step 3: Find available workers
        st, available_agents = self.client._request("agents?status=eq.AVAILABLE&select=*")
        if st != 200 or not isinstance(available_agents, list) or not available_agents:
            return result

        # Step 4: Dispatch available agents to RECLAIMABLE tasks
        for task in reclaimable_tasks:
            target_spec = task["specialization_id"]
            # Find eligible agent: either specialization match or general worker
            eligible_agent = None
            for agent in available_agents:
                caps = agent.get("capabilities", {})
                if (agent.get("specialization_id") == target_spec or 
                    caps.get("all") or caps.get("cross_domain") or caps.get(str(target_spec))):
                    eligible_agent = agent
                    break

            if eligible_agent:
                task_id = task["id"]
                agent_id = eligible_agent["id"]
                version = task["version"]

                st_rec, rec_res = self.client.reclaim_task(task_id, agent_id, version)
                if st_rec == 200 and rec_res.get("success"):
                    result["reclaimed_count"] += 1
                    available_agents.remove(eligible_agent)
                else:
                    result["errors"].append(f"Reclaim failed for task {task_id} by agent {agent_id}: {rec_res}")

        return result

    def run_loop(self, max_iterations: Optional[int] = None):
        """Runs the loop continuously or for fixed iterations."""
        self.running = True
        iterations = 0
        while self.running:
            try:
                outcome = self.tick()
                if outcome.get("reclaimed_count", 0) > 0:
                    logger.info(f"Supervisor recovered {outcome['reclaimed_count']} tasks.")
            except Exception as e:
                logger.error(f"Error in recovery loop: {e}")

            iterations += 1
            if max_iterations and iterations >= max_iterations:
                break
            time.sleep(self.interval_seconds)

    def stop(self):
        self.running = False

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    supervisor = SupervisorRecoveryLoop()
    print("Running single supervisor cycle...")
    res = supervisor.tick()
    print("Supervisor tick result:", res)
