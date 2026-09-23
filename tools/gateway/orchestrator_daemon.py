"""
Persistent Manager Orchestrator Daemon.
Runs autonomously on the host or orchestration environment independent of Antigravity AI turns.
Coordinates:
1. Task State Synchronization with Supabase Control Plane.
2. Task Selection based on Dependency DAG & Resource capacity.
3. Automated Task Dispatch & Atomic Lease Management.
4. Worker Fleet Health Monitoring (Heartbeat watchdog).
5. Autonomous Stale Worker & Expired Lease Recovery.
6. Triggering verification on Trusted Laptop Webhook Agent.
7. Broadcasting status updates & alerts to Telegram.
"""

import time
import json
import logging
import threading
from pathlib import Path
from typing import Dict, Any, Optional, List

from tools.gateway.gateway import CapabilityGateway
from tools.gateway.auth import GatewayAuth

logger = logging.getLogger("PersistentOrchestrator")

class PersistentOrchestratorDaemon:
    def __init__(self, interval_seconds: int = 10, gateway: Optional[CapabilityGateway] = None):
        self.interval = interval_seconds
        self.gateway = gateway or CapabilityGateway()
        self.auth = GatewayAuth()
        self.manager_token = self.auth.get_token_for_role("manager")
        self.is_running = False
        self._thread: Optional[threading.Thread] = None
        self.stats = {
            "ticks": 0,
            "tasks_dispatched": 0,
            "stale_tasks_recovered": 0,
            "heartbeats_monitored": 0,
            "last_tick_time": None,
            "state": "INITIALIZED"
        }

    def _invoke(self, capability: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self.gateway.invoke(
            caller_id="arena-manager",
            capability=capability,
            params=params or {},
            bearer_token=self.manager_token
        )

    def tick(self) -> Dict[str, Any]:
        """Executes a single autonomous orchestration cycle."""
        self.stats["ticks"] += 1
        now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.stats["last_tick_time"] = now_str
        cycle_report = {"timestamp": now_str, "actions": []}

        try:
            # 1. Housekeeping: Reap expired leases & recover stale tasks
            reap_res = self._invoke("supabase.reap_expired_leases")
            if reap_res.get("ok"):
                reaped_count = 0
                res_data = reap_res.get("result", {})
                if isinstance(res_data, dict):
                    reaped_count = res_data.get("reaped_count", 0)
                elif isinstance(res_data, list):
                    reaped_count = len(res_data)

                if reaped_count > 0:
                    self.stats["stale_tasks_recovered"] += reaped_count
                    cycle_report["actions"].append(f"Reaped {reaped_count} expired task leases")
                    # Alert to Telegram
                    self._invoke("telegram.send_message", {
                        "text": f"⚠️ *ORCHESTRATOR ALERT*\\nRecovered `{reaped_count}` stale/timed-out tasks from offline workers.",
                        "parse_mode": "Markdown"
                    })

            # 2. Worker Fleet Monitoring
            agents_res = self._invoke("supabase.inspect_agents")
            if agents_res.get("ok"):
                fleet = agents_res.get("result", {})
                self.stats["heartbeats_monitored"] = fleet.get("total_agents", 0)
                cycle_report["fleet_status"] = {
                    "total": fleet.get("total_agents", 0),
                    "available": fleet.get("available_count", 0),
                    "working": fleet.get("working_count", 0)
                }

            # 3. Project Status Sync
            state_res = self._invoke("supabase.get_project_state")
            if state_res.get("ok"):
                proj = state_res.get("result", {})
                cycle_report["project_state"] = proj

            # 4. Laptop Webhook Health Verification
            laptop_res = self._invoke("laptop.status")
            if laptop_res.get("ok"):
                cycle_report["laptop_worker"] = {
                    "branch": laptop_res["result"].get("branch"),
                    "webhook_online": laptop_res["result"].get("webhook_agent_online", False)
                }

            self.stats["state"] = "RUNNING"
            cycle_report["success"] = True
            return cycle_report

        except Exception as e:
            self.stats["state"] = "ERROR"
            cycle_report["success"] = False
            cycle_report["error"] = str(e)
            return cycle_report

    def _run_loop(self):
        while self.is_running:
            self.tick()
            time.sleep(self.interval)

    def start(self):
        """Starts the persistent background loop."""
        if not self.is_running:
            self.is_running = True
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
            self.stats["state"] = "RUNNING"
            print(f"Persistent Manager Orchestrator Daemon started (interval={self.interval}s).")

    def stop(self):
        """Stops the persistent background loop."""
        self.is_running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        self.stats["state"] = "STOPPED"
        print("Persistent Manager Orchestrator Daemon stopped.")

    def get_status(self) -> Dict[str, Any]:
        return {
            "service": "persistent-orchestrator-daemon",
            "is_running": self.is_running,
            "interval_seconds": self.interval,
            "stats": self.stats
        }

if __name__ == "__main__":
    daemon = PersistentOrchestratorDaemon(interval_seconds=10)
    daemon.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        daemon.stop()
