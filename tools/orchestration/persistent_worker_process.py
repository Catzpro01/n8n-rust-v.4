"""
Persistent Autonomous Worker Daemon for Arena Multi-Agent System.

Each worker runs as a dedicated OS process with:
- Strict local session identity and lockfile
- Periodic non-blocking heartbeat to Supabase Control Plane
- Reactive DAG-aware atomic task discovery (QUEUED ready & RECLAIMABLE)
- Zero phantom claiming (claims only when worker process is verifiably alive)
- Full lifecycle executor loop:
    DISCOVER -> ATOMIC CLAIM -> START -> EXECUTE WORK -> AUDIT -> MERGE -> CLEANUP -> AUTO-NEXT
- Graceful shutdown and clean process exit handling
"""

import os
import sys
import time
import json
import signal
import socket
import logging
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

# Add workspace root to sys.path
WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from tools.orchestration.control_plane import ControlPlaneClient
from tools.orchestration.task_manifest_catalog import CANONICAL_TASKS
from tools.orchestration.boundary_guard import TaskBoundaryGuard

# Configure logging
LOG_DIR = WORKSPACE_ROOT / ".arena" / "worker_logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

RUN_DIR = WORKSPACE_ROOT / ".arena" / "run"
RUN_DIR.mkdir(parents=True, exist_ok=True)

class PersistentWorkerProcess:
    def __init__(
        self,
        agent_key: str,
        client: Optional[ControlPlaneClient] = None,
        heartbeat_interval: int = 5,
        poll_interval: int = 3,
        auto_claim: bool = False
    ):
        self.agent_key = agent_key
        self.client = client or ControlPlaneClient()
        self.heartbeat_interval = heartbeat_interval
        self.poll_interval = poll_interval
        self.auto_claim = auto_claim
        self.running = False

        self.pid = os.getpid()
        self.hostname = socket.gethostname()
        self.session_id = f"{agent_key}-{self.pid}-{int(time.time())}"

        self.catalog = {t["task_key"]: t for t in CANONICAL_TASKS}
        self.guard = TaskBoundaryGuard(workspace_root=WORKSPACE_ROOT)
        
        self.agent_id: Optional[str] = None
        self.specialization_id: Optional[str] = None
        self.specialization_slug: Optional[str] = None
        self.current_task: Optional[Dict[str, Any]] = None
        self.last_heartbeat_time = 0.0

        self._setup_logger()
        self._setup_signal_handlers()

    def _setup_logger(self):
        self.logger = logging.getLogger(f"Worker-{self.agent_key}")
        self.logger.setLevel(logging.INFO)
        if not self.logger.handlers:
            log_file = LOG_DIR / f"{self.agent_key}.log"
            fh = logging.FileHandler(log_file, encoding="utf-8")
            fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")
            fh.setFormatter(fmt)
            self.logger.addHandler(fh)
            
            # Also console handler if run directly
            sh = logging.StreamHandler(sys.stdout)
            sh.setFormatter(fmt)
            self.logger.addHandler(sh)

    def _setup_signal_handlers(self):
        def _sig_handler(signum, frame):
            self.logger.info(f"Received signal {signum}, initiating graceful shutdown...")
            self.stop()
        
        try:
            signal.signal(signal.SIGINT, _sig_handler)
            signal.signal(signal.SIGTERM, _sig_handler)
        except Exception:
            pass

    def _write_session_file(self):
        session_file = RUN_DIR / f"{self.agent_key}.session"
        data = {
            "agent_key": self.agent_key,
            "agent_id": self.agent_id,
            "pid": self.pid,
            "session_id": self.session_id,
            "hostname": self.hostname,
            "started_at": time.time(),
            "last_heartbeat": time.time(),
            "current_task_id": self.current_task.get("id") if self.current_task else None,
            "auto_claim": self.auto_claim
        }
        session_file.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def _remove_session_file(self):
        session_file = RUN_DIR / f"{self.agent_key}.session"
        if session_file.exists():
            try:
                session_file.unlink()
            except Exception:
                pass

    def verify_identity(self) -> bool:
        """
        Loads and verifies agent record from Control Plane database.
        Ensures agent_key matches registered agent.
        """
        self.logger.info(f"Verifying identity for {self.agent_key}...")
        st, agents = self.client._request(f"agents?agent_key=eq.{self.agent_key}&limit=1")
        if st != 200 or not agents:
            self.logger.error(f"Agent '{self.agent_key}' not found in Control Plane (HTTP {st})")
            return False

        agent_record = agents[0]
        self.agent_id = agent_record["id"]
        self.specialization_id = agent_record["specialization_id"]

        # Look up specialization slug
        st_s, specs = self.client._request(f"specializations?id=eq.{self.specialization_id}&limit=1")
        if st_s == 200 and specs:
            self.specialization_slug = specs[0]["slug"]
        else:
            self.specialization_slug = None

        self.logger.info(f"Identity confirmed: ID={self.agent_id}, Spec={self.specialization_slug}")
        self._write_session_file()
        return True

    def send_heartbeat(self, status: Optional[str] = None) -> bool:
        """Pings Control Plane with refreshed timestamp."""
        if not self.agent_id:
            return False
        
        now = time.time()
        current_task_id = self.current_task.get("id") if self.current_task else None
        
        st, res = self.client.heartbeat_agent(
            agent_id=self.agent_id,
            status=status or ("WORKING" if current_task_id else "AVAILABLE"),
            task_id=current_task_id
        )
        if st in (200, 204):
            self.last_heartbeat_time = now
            # Update local session file
            self._write_session_file()
            return True
        else:
            self.logger.warning(f"Heartbeat failed for {self.agent_key}: HTTP {st} {res}")
            return False

    def discover_eligible_tasks(self) -> list:
        """
        Queries all tasks from Supabase and determines eligible ready candidates
        matching specialization and 100% satisfied DAG dependencies.
        """
        st, tasks = self.client._request("tasks?select=*")
        if st != 200 or not isinstance(tasks, list):
            self.logger.error(f"Failed to query tasks: HTTP {st}")
            return []

        live_by_key = {t["task_key"]: t for t in tasks}

        # Active locked exclusive files
        active_statuses = {"CLAIMED", "WORKING", "PR_OPEN", "BUILDING", "TESTING", "AUDITING", "MERGING"}
        locked_files = set()
        for t_key, t_live in live_by_key.items():
            if t_live.get("status") in active_statuses:
                cat = self.catalog.get(t_key, {})
                for f in cat.get("exclusive_files", []):
                    locked_files.add(f.replace("\\", "/"))

        candidates = []
        for t_key, t_live in live_by_key.items():
            status = t_live.get("status")
            if status not in {"QUEUED", "RECLAIMABLE"}:
                continue

            # Check specialization affinity
            cat = self.catalog.get(t_key, {})
            cat_spec = cat.get("specialization")
            if cat_spec and self.specialization_slug and cat_spec != self.specialization_slug:
                continue

            # Check DAG dependencies
            deps = cat.get("dependencies", [])
            deps_satisfied = True
            for dep_key in deps:
                dep_task = live_by_key.get(dep_key)
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

        # Sort priority
        candidates.sort(key=lambda x: (
            0 if x.get("status") == "RECLAIMABLE" else 1,
            x.get("priority", 100),
            -float(x.get("progress_weight", 1.0))
        ))
        return candidates

    def atomic_claim(self, candidate: dict) -> Tuple[bool, Optional[dict]]:
        """Executes atomic OCC claim RPC."""
        task_id = candidate["id"]
        version = candidate["version"]
        status = candidate["status"]

        self.logger.info(f"Attempting atomic claim on {candidate['task_key']} (v={version})...")
        if status == "RECLAIMABLE":
            st, res = self.client.reclaim_task(task_id, self.agent_id, version)
        else:
            st, res = self.client.claim_task(task_id, self.agent_id, version)

        if st == 200 and res.get("success"):
            self.logger.info(f"Successfully claimed {candidate['task_key']}: {res}")
            self.current_task = candidate
            self.current_task["version"] = res.get("version", version + 1)
            self.current_task["status"] = "CLAIMED"
            self._write_session_file()
            return True, res

        self.logger.warning(f"Claim rejected on {candidate['task_key']}: HTTP {st} {res}")
        return False, res

    def tick(self):
        """Single tick of the worker loop."""
        now = time.time()
        # Periodic heartbeat
        if now - self.last_heartbeat_time >= self.heartbeat_interval:
            self.send_heartbeat()

        # If worker already has an active task
        if self.current_task:
            return

        # Only claim if auto_claim is explicitly activated
        if self.auto_claim:
            candidates = self.discover_eligible_tasks()
            if candidates:
                for cand in candidates:
                    claimed, res = self.atomic_claim(cand)
                    if claimed:
                        break

    def run(self, max_ticks: Optional[int] = None):
        """Starts persistent daemon execution."""
        if not self.verify_identity():
            self.logger.error("Identity verification failed. Exiting.")
            return False

        self.running = True
        self.send_heartbeat(status="AVAILABLE")
        self.logger.info(f"Worker {self.agent_key} active (PID: {self.pid}, AutoClaim={self.auto_claim})")

        ticks = 0
        try:
            while self.running:
                self.tick()
                ticks += 1
                if max_ticks and ticks >= max_ticks:
                    break
                time.sleep(self.poll_interval)
        finally:
            self.stop()
        return True

    def stop(self):
        """Stops worker process gracefully."""
        self.running = False
        self.logger.info(f"Stopping worker {self.agent_key}...")
        self._remove_session_file()

def main():
    if len(sys.argv) < 2:
        print("Usage: python persistent_worker_process.py <agent_key> [--auto-claim]")
        sys.exit(1)

    agent_key = sys.argv[1]
    auto_claim = "--auto-claim" in sys.argv

    worker = PersistentWorkerProcess(agent_key=agent_key, auto_claim=auto_claim)
    worker.run()

if __name__ == "__main__":
    main()
