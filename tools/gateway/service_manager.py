"""
OS-Level Service Supervisor for Arena Manager Autonomous Runtime.
Manages the lifecycle of independent background OS processes:
1. Gateway Server (:8787)
2. Laptop Webhook Agent (:8989)
3. Persistent Orchestrator Daemon
4. Autonomous Worker Fleet (5 agents)

Pure standard library implementation (no external dependencies like psutil).
"""

import os
import sys
import time
import json
import signal
import logging
import argparse
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

if sys.platform == "win32":
    import ctypes

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_DIR = REPO_ROOT / ".arena" / "runtime"
PID_FILE = RUNTIME_DIR / "supervisor_pids.json"
LOGS_DIR = RUNTIME_DIR / "logs"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s")
logger = logging.getLogger("RuntimeSupervisor")

SERVICES = {
    "gateway": {
        "command": [sys.executable, "-u", "tools/gateway/server.py", "--host", "127.0.0.1", "--port", "8787"],
        "log_file": LOGS_DIR / "gateway.log"
    },
    "laptop_webhook": {
        "command": [sys.executable, "-u", "tools/gateway/laptop_webhook_agent.py", "--host", "127.0.0.1", "--port", "8989"],
        "log_file": LOGS_DIR / "laptop_webhook.log"
    },
    "orchestrator": {
        "command": [sys.executable, "-u", "tools/gateway/orchestrator_daemon.py"],
        "log_file": LOGS_DIR / "orchestrator.log"
    },
    "worker_fleet": {
        "command": [sys.executable, "-u", "tools/gateway/worker_fleet_daemon.py", "--interval", "15"],
        "log_file": LOGS_DIR / "worker_fleet.log"
    }
}

class ServiceManager:
    def __init__(self):
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        LOGS_DIR.mkdir(parents=True, exist_ok=True)

    def _load_pids(self) -> Dict[str, int]:
        if PID_FILE.exists():
            try:
                return json.loads(PID_FILE.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}

    def _save_pids(self, pids: Dict[str, int]):
        PID_FILE.write_text(json.dumps(pids, indent=2), encoding="utf-8")

    def is_pid_alive(self, pid: int) -> bool:
        if not pid or pid <= 0:
            return False
        if sys.platform == "win32":
            kernel32 = ctypes.windll.kernel32
            SYNCHRONIZE = 0x00100000
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = kernel32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                return False
            # Check exit code
            exit_code = ctypes.c_ulong()
            kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
            kernel32.CloseHandle(handle)
            # STILL_ACTIVE = 259
            return exit_code.value == 259
        else:
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False

    def kill_pid(self, pid: int):
        if not pid or not self.is_pid_alive(pid):
            return
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass

    def start_all(self):
        """Spawns all services as detached background OS processes."""
        pids = self._load_pids()
        updated = False

        service_order = ["gateway", "laptop_webhook", "orchestrator", "worker_fleet"]

        for s_name in service_order:
            curr_pid = pids.get(s_name)
            if curr_pid and self.is_pid_alive(curr_pid):
                logger.info(f"Service '{s_name}' already running (PID={curr_pid}).")
                continue

            cfg = SERVICES[s_name]
            log_out = open(cfg["log_file"], "a", encoding="utf-8")

            creationflags = 0
            if sys.platform == "win32":
                creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008  # DETACHED_PROCESS

            proc = subprocess.Popen(
                cfg["command"],
                cwd=str(REPO_ROOT),
                stdout=log_out,
                stderr=log_out,
                creationflags=creationflags,
                close_fds=True if sys.platform != "win32" else False
            )
            pids[s_name] = proc.pid
            logger.info(f"Started service '{s_name}' (PID={proc.pid}).")
            updated = True
            time.sleep(1.0)

        if updated:
            self._save_pids(pids)

    def stop_all(self):
        """Gracefully terminates all background services."""
        pids = self._load_pids()
        for s_name, pid in pids.items():
            if self.is_pid_alive(pid):
                logger.info(f"Stopping service '{s_name}' (PID={pid})...")
                self.kill_pid(pid)
        self._save_pids({})
        logger.info("All services stopped.")

    def status(self) -> Dict[str, Any]:
        """Returns the status and health of all managed services."""
        pids = self._load_pids()
        report = {}
        for s_name in SERVICES:
            pid = pids.get(s_name)
            alive = self.is_pid_alive(pid) if pid else False
            report[s_name] = {
                "running": alive,
                "pid": pid if alive else None
            }
        return report

    def supervise_loop(self):
        """Auto-restart supervisor loop enforcing Restart=always."""
        logger.info("Supervisor loop active (monitoring every 5s)...")
        while True:
            try:
                pids = self._load_pids()
                for s_name, cfg in SERVICES.items():
                    pid = pids.get(s_name)
                    if not pid or not self.is_pid_alive(pid):
                        logger.warning(f"Service '{s_name}' is DOWN. Auto-restarting...")
                        log_out = open(cfg["log_file"], "a", encoding="utf-8")
                        creationflags = 0
                        if sys.platform == "win32":
                            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008

                        proc = subprocess.Popen(
                            cfg["command"],
                            cwd=str(REPO_ROOT),
                            stdout=log_out,
                            stderr=log_out,
                            creationflags=creationflags
                        )
                        pids[s_name] = proc.pid
                        logger.info(f"Auto-restarted '{s_name}' with new PID={proc.pid}.")
                        self._save_pids(pids)
                time.sleep(5.0)
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"Supervisor error: {e}")
                time.sleep(5.0)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Runtime Service Manager")
    parser.add_argument("action", choices=["start", "stop", "restart", "status", "supervise"])
    args = parser.parse_args()

    sm = ServiceManager()
    if args.action == "start":
        sm.start_all()
    elif args.action == "stop":
        sm.stop_all()
    elif args.action == "restart":
        sm.stop_all()
        time.sleep(2.0)
        sm.start_all()
    elif args.action == "status":
        print(json.dumps(sm.status(), indent=2))
    elif args.action == "supervise":
        sm.start_all()
        sm.supervise_loop()
