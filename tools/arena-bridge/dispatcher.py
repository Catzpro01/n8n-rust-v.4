import json
import time
import yaml
from pathlib import Path
try:
    from .config import REPO_ROOT
except (ImportError, ValueError):
    from config import REPO_ROOT

class TaskDispatcher:
    def __init__(self):
        self.repo_root = REPO_ROOT
        self.sublego_registry_path = REPO_ROOT / ".arena/registry/sublego.yaml"
        self.queue_incoming = Path("/srv/arena/runtime/queue/incoming")

    def load_sublego(self, sublego_id: str) -> dict:
        if not self.sublego_registry_path.exists():
            return None
        try:
            with open(self.sublego_registry_path, "r") as f:
                data = yaml.safe_load(f)
                for item in data.get("sublegos", []):
                    if item.get("id") == sublego_id:
                        return item
        except Exception:
            return None
        return None

    def validate_agent_task(self, agent_id: str, sublego_id: str) -> bool:
        sublego = self.load_sublego(sublego_id)
        if not sublego:
            return False
        return sublego.get("owner") == agent_id

    def dispatch_execution_job(self, agent_id: str, task_id: str, sublego_id: str, command: list[str], cwd: str = ".") -> str:
        """
        Enqueues an execution job for Arena Executor daemon.
        """
        self.queue_incoming.mkdir(parents=True, exist_ok=True)
        job_id = f"{int(time.time()*1000)}_{agent_id}_{task_id}.json"
        job_file = self.queue_incoming / job_id

        payload = {
            "job_id": job_id,
            "agent_id": agent_id,
            "task_id": task_id,
            "sublego_id": sublego_id,
            "command": command,
            "cwd": cwd,
            "enqueued_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

        # Atomic write
        tmp_file = self.queue_incoming / f".{job_id}.tmp"
        with open(tmp_file, "w") as f:
            json.dump(payload, f, indent=2)
        tmp_file.rename(job_file)

        print(f"[TaskDispatcher] Enqueued execution job {job_id} for {agent_id}")
        return job_id
