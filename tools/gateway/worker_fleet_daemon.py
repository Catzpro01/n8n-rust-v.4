"""
Autonomous Worker Fleet Daemon.
Spawns and supervises 5 dedicated arena worker agents corresponding to each specialization domain:
1. arena-agent-01-kernel
2. arena-agent-02-engine
3. arena-agent-03-dataplane
4. arena-agent-04-expression
5. arena-agent-05-security

Each worker:
- Sends continuous heartbeats to Supabase Cloud
- Claims assigned/queued tasks using OCC
- Coordinates execution with Laptop Webhook Agent
"""

import sys
import time
import json
import logging
import argparse
import threading
from pathlib import Path
from typing import Dict, List, Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tools.gateway.gateway import CapabilityGateway
from tools.gateway.auth import GatewayAuth

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s")
logger = logging.getLogger("WorkerFleet")

WORKER_DEFINITIONS = [
    {
        "agent_key": "arena-agent-01-kernel",
        "agent_id": "622e5c4d-cc3a-4b14-ac01-ea144e8c95e4",
        "specialization_id": "880e25c0-5a9c-490a-808b-869f131788d1",
        "domain": "runtime-kernel"
    },
    {
        "agent_key": "arena-agent-02-engine",
        "agent_id": "79de33a3-fab1-42eb-b026-6896a69a04e2",
        "specialization_id": "c36b4db7-0ea7-4688-a4bc-b4e5487704b8",
        "domain": "execution-engine"
    },
    {
        "agent_key": "arena-agent-03-dataplane",
        "agent_id": "d20c5bab-941d-4156-bbb1-66354d10e505",
        "specialization_id": "1f2808a6-2d51-4ecf-b200-ccca1822f235",
        "domain": "data-plane"
    },
    {
        "agent_key": "arena-agent-04-expression",
        "agent_id": "5c03364c-8c07-4e7a-9a92-b968e00ab127",
        "specialization_id": "6d8bfca9-168f-423d-ba30-180f523c5dcc",
        "domain": "expression-engine"
    },
    {
        "agent_key": "arena-agent-05-security",
        "agent_id": "a2a4cdd8-e3d0-4b50-bc56-96b1dc434d89",
        "specialization_id": "6e506b50-9970-45ec-a74c-8463d2b6d112",
        "domain": "security"
    }
]

class AutonomousFleetSupervisor:
    def __init__(self, interval_seconds: int = 15):
        self.interval = interval_seconds
        self.gateway = CapabilityGateway(repo_root=REPO_ROOT)
        self.auth = GatewayAuth()
        self.worker_token = self.auth.get_token_for_role("worker")
        self.is_running = False
        self.worker_states: Dict[str, Dict[str, Any]] = {}
        for w in WORKER_DEFINITIONS:
            self.worker_states[w["agent_key"]] = {
                "config": w,
                "status": "INITIALIZED",
                "last_heartbeat": None,
                "heartbeat_count": 0,
                "claimed_task": None
            }

    def pulse_worker_heartbeats(self):
        """Sends heartbeat for each active worker in the fleet to Supabase."""
        for agent_key, state in self.worker_states.items():
            if state["status"] == "STOPPED":
                continue

            cfg = state["config"]
            agent_id = cfg["agent_id"]

            try:
                # Do not force 'AVAILABLE' blindly. If supervisor has no claimed_task in local memory,
                # pass worker_state=None so the database preserves any active WORKING lease.
                res = self.gateway.invoke(
                    caller_id=agent_key,
                    capability="supabase.worker_heartbeat",
                    params={
                        "agent_id": agent_id,
                        "worker_state": "WORKING" if state["claimed_task"] else None,
                        "current_task_id": state["claimed_task"]
                    },
                    bearer_token=self.worker_token
                )
                if res.get("ok"):
                    state["last_heartbeat"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    state["heartbeat_count"] += 1
                    # Update local state reflecting the server status
                    server_status = res.get("result", {}).get("status")
                    if server_status:
                        state["status"] = server_status
                else:
                    state["status"] = "HEARTBEAT_FAILED"
                    logger.warning(f"Worker {agent_key} heartbeat failed: {res.get('error')}")

            except Exception as e:
                state["status"] = "ERROR"
                logger.error(f"Error pulsing heartbeat for {agent_key}: {e}")

    def run_forever(self):
        self.is_running = True
        logger.info(f"Starting Autonomous Worker Fleet ({len(WORKER_DEFINITIONS)} agents)...")

        # Initial heartbeat burst
        self.pulse_worker_heartbeats()

        while self.is_running:
            try:
                time.sleep(self.interval)
                self.pulse_worker_heartbeats()
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"Worker fleet loop error: {e}")

        logger.info("Worker fleet loop terminated.")

    def stop(self):
        self.is_running = False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Autonomous Worker Fleet Daemon")
    parser.add_argument("--interval", type=int, default=15, help="Heartbeat interval in seconds")
    args = parser.parse_args()

    fleet = AutonomousFleetSupervisor(interval_seconds=args.interval)
    fleet.run_forever()
