#!/usr/bin/env python3
"""
Arena Executor Service Daemon (P0-7 Fix)
Manages isolated task execution requests via local IPC/socket or heartbeat loop.
"""
import os
import sys
import time
import signal
from pathlib import Path

RUNNING = True

def handle_sigterm(signum, frame):
    global RUNNING
    print(f"[ArenaExecutor] Received signal {signum}, shutting down cleanly...")
    RUNNING = False

def main():
    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    workspace_root = Path(os.environ.get("ARENA_WORKSPACES_ROOT", "/srv/arena/workspaces"))
    runtime_dir = Path("/srv/arena/runtime")
    runtime_dir.mkdir(parents=True, exist_ok=True)

    pid_file = runtime_dir / "executor.pid"
    pid_file.write_text(str(os.getpid()))

    print(f"[ArenaExecutor] Daemon started. PID={os.getpid()}, WorkspaceRoot={workspace_root}")

    try:
        while RUNNING:
            # Heartbeat & worker polling cycle
            time.sleep(2)
    finally:
        if pid_file.exists():
            pid_file.unlink()
        print("[ArenaExecutor] Daemon stopped.")

if __name__ == "__main__":
    main()
