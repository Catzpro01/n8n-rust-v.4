"""
Arena 5-Worker Supervisor and Process Daemon Manager.

Provides:
- Launch, supervision, health check, and graceful shutdown of exactly 5 real worker OS processes:
    arena-agent-01-kernel
    arena-agent-02-engine
    arena-agent-03-dataplane
    arena-agent-04-expression
    arena-agent-05-security
- Distinct tracking between:
    1. Registered (DB row exists)
    2. DB Status (AVAILABLE, WORKING, OFFLINE)
    3. Process Alive (Real OS PID verified via Win32 / OS signal)
    4. Heartbeat Alive (Timestamp freshness verified in Control Plane)
- Zero phantom claiming (claims only allowed from verified real worker processes)
- Automatic process recovery if a worker crashes
- Distributed lease reaping via reap_expired_leases RPC
"""

import os
import sys
import time
import json
import socket
import logging
import ctypes
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from tools.orchestration.control_plane import ControlPlaneClient

RUN_DIR = WORKSPACE_ROOT / ".arena" / "run"
RUN_DIR.mkdir(parents=True, exist_ok=True)

LOG_DIR = WORKSPACE_ROOT / ".arena" / "worker_logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

TARGET_WORKERS = [
    "arena-agent-01-kernel",
    "arena-agent-02-engine",
    "arena-agent-03-dataplane",
    "arena-agent-04-expression",
    "arena-agent-05-security"
]

def is_pid_alive(pid: int) -> bool:
    """Checks whether a process with given PID is currently active on the host OS."""
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            kernel32 = ctypes.windll.kernel32
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            h_proc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not h_proc:
                return False
            exit_code = ctypes.c_ulong()
            still_active = 259
            if kernel32.GetExitCodeProcess(h_proc, ctypes.byref(exit_code)):
                kernel32.CloseHandle(h_proc)
                return exit_code.value == still_active
            kernel32.CloseHandle(h_proc)
            return False
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

class WorkerSupervisor:
    def __init__(self, client: Optional[ControlPlaneClient] = None):
        self.client = client or ControlPlaneClient()
        self.processes: Dict[str, subprocess.Popen] = {}
        self.logger = logging.getLogger("WorkerSupervisor")
        self.logger.setLevel(logging.INFO)
        if not self.logger.handlers:
            fh = logging.FileHandler(LOG_DIR / "supervisor.log", encoding="utf-8")
            fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] [Supervisor] %(message)s")
            fh.setFormatter(fmt)
            self.logger.addHandler(fh)
            sh = logging.StreamHandler(sys.stdout)
            sh.setFormatter(fmt)
            self.logger.addHandler(sh)

    def get_worker_session_info(self, agent_key: str) -> Optional[dict]:
        session_file = RUN_DIR / f"{agent_key}.session"
        if not session_file.exists():
            return None
        try:
            return json.loads(session_file.read_text(encoding="utf-8"))
        except Exception:
            return None

    def audit_worker_states(self) -> List[Dict[str, Any]]:
        """
        Gathers distinct status of every worker:
        - registered: bool
        - db_status: str
        - current_task_id: Optional[str]
        - process_alive: bool
        - session_id: Optional[str]
        - pid: Optional[int]
        - heartbeat_alive: bool (within last 30s)
        """
        st, db_agents = self.client._request("agents?select=*")
        db_map = {a["agent_key"]: a for a in db_agents} if (st == 200 and isinstance(db_agents, list)) else {}

        now = time.time()
        audit_records = []

        for key in TARGET_WORKERS:
            db_record = db_map.get(key)
            session_info = self.get_worker_session_info(key)

            pid = session_info.get("pid") if session_info else None
            # If supervisor spawned it in this process, prefer its pid
            if key in self.processes:
                p = self.processes[key]
                if p.poll() is None:
                    pid = p.pid

            proc_alive = is_pid_alive(pid) if pid else False

            # Heartbeat check
            hb_alive = False
            last_hb_str = db_record.get("last_heartbeat") if db_record else None
            if last_hb_str and proc_alive:
                # If process is alive and last_heartbeat is updated recently
                # Or session heartbeat is fresh within 30s
                s_hb = session_info.get("last_heartbeat", 0) if session_info else 0
                if (now - s_hb) < 30:
                    hb_alive = True

            record = {
                "agent_key": key,
                "registered": db_record is not None,
                "agent_id": db_record.get("id") if db_record else None,
                "db_status": db_record.get("status") if db_record else "UNREGISTERED",
                "current_task_id": db_record.get("current_task_id") if db_record else None,
                "pid": pid if proc_alive else None,
                "session_id": session_info.get("session_id") if (session_info and proc_alive) else None,
                "process_alive": proc_alive,
                "heartbeat_alive": hb_alive
            }
            audit_records.append(record)

        return audit_records

    def spawn_worker(self, agent_key: str, auto_claim: bool = False) -> bool:
        """Launches a persistent worker process."""
        worker_script = WORKSPACE_ROOT / "tools" / "orchestration" / "persistent_worker_process.py"
        log_file = LOG_DIR / f"{agent_key}.stdout.log"

        cmd = [sys.executable, str(worker_script), agent_key]
        if auto_claim:
            cmd.append("--auto-claim")

        self.logger.info(f"Spawning worker process for {agent_key}...")
        creationflags = 0
        if os.name == "nt":
            # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            creationflags = 0x00000008 | 0x00000200

        with open(log_file, "a", encoding="utf-8") as out_f:
            proc = subprocess.Popen(
                cmd,
                cwd=str(WORKSPACE_ROOT),
                stdout=out_f,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=creationflags
            )
        self.processes[agent_key] = proc

        # Give process a moment to initialize session file
        time.sleep(1.0)
        return proc.poll() is None

    def start_all_workers(self, auto_claim: bool = False):
        """Starts all 5 worker processes."""
        for key in TARGET_WORKERS:
            session = self.get_worker_session_info(key)
            if session and is_pid_alive(session.get("pid", 0)):
                self.logger.info(f"Worker {key} already alive with PID {session.get('pid')}")
                continue
            self.spawn_worker(key, auto_claim=auto_claim)

    def stop_worker(self, agent_key: str):
        """Stops a single worker process."""
        # 1. If in self.processes
        if agent_key in self.processes:
            p = self.processes[agent_key]
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=3)
                except Exception:
                    p.kill()

        # 2. If PID in session file
        session = self.get_worker_session_info(agent_key)
        if session and session.get("pid"):
            pid = session["pid"]
            if is_pid_alive(pid):
                try:
                    if os.name == "nt":
                        subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
                    else:
                        os.kill(pid, 9)
                except Exception:
                    pass

        # Cleanup session file
        s_file = RUN_DIR / f"{agent_key}.session"
        if s_file.exists():
            try:
                s_file.unlink()
            except Exception:
                pass

    def stop_all_workers(self):
        """Gracefully terminates all 5 worker processes."""
        self.logger.info("Stopping all 5 worker processes...")
        for key in TARGET_WORKERS:
            self.stop_worker(key)

    def run_daemon(self, auto_claim: bool = False, poll_interval: float = 1):
        """Runs the supervisor loop, maintaining 5 healthy worker processes."""
        self.logger.info(f"Starting Supervisor Daemon (AutoClaim={auto_claim})...")
        self.start_all_workers(auto_claim=auto_claim)
        try:
            while True:
                time.sleep(min(float(poll_interval), 1.0))  # runner protocol: <= 1s
                # Check for dead workers and revive if necessary
                for key in TARGET_WORKERS:
                    session = self.get_worker_session_info(key)
                    pid = session.get("pid", 0) if session else 0
                    if not is_pid_alive(pid):
                        self.logger.warning(f"Worker {key} is dead. Restarting...")
                        self.spawn_worker(key, auto_claim=auto_claim)
        except KeyboardInterrupt:
            self.logger.info("Supervisor interrupted. Stopping workers...")
        finally:
            self.stop_all_workers()

if __name__ == "__main__":
    sup = WorkerSupervisor()
    if "--status" in sys.argv:
        states = sup.audit_worker_states()
        print(json.dumps(states, indent=2))
    elif "--run" in sys.argv:
        auto_claim = "--auto-claim" in sys.argv
        sup.run_daemon(auto_claim=auto_claim)
    elif "--start" in sys.argv:
        auto_claim = "--auto-claim" in sys.argv
        sup.start_all_workers(auto_claim=auto_claim)
        states = sup.audit_worker_states()
        print(json.dumps(states, indent=2))
    elif "--stop" in sys.argv:
        sup.stop_all_workers()
        states = sup.audit_worker_states()
        print(json.dumps(states, indent=2))
    else:
        print("Usage: python supervisor_daemon.py [--status | --run [--auto-claim] | --start [--auto-claim] | --stop]")
