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
        self.lego_registry_path = REPO_ROOT / ".arena/registry/lego.yaml"
        self.sublego_registry_path = REPO_ROOT / ".arena/registry/sublego.yaml"
        self.tasks_dir = REPO_ROOT / ".arena/tasks"
        self.queue_incoming = Path("/srv/arena/runtime/queue/incoming")

    def load_task_manifest(self, task_id: str) -> dict:
        """
        Loads authoritative task manifest from .arena/tasks/<task_id>.yaml (or .json).
        Fail-closed: returns None if missing or invalid.
        """
        if not self.tasks_dir.exists():
            return None
        
        yaml_path = self.tasks_dir / f"{task_id}.yaml"
        json_path = self.tasks_dir / f"{task_id}.json"

        if yaml_path.exists():
            try:
                with open(yaml_path, "r") as f:
                    return yaml.safe_load(f)
            except Exception:
                return None
        elif json_path.exists():
            try:
                with open(json_path, "r") as f:
                    return json.load(f)
            except Exception:
                return None
        return None

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
        """
        Validates whether agent_id is the legitimate owner of sublego_id in sublego.yaml.
        Fail-closed: strictly returns False if sublego not found or owner mismatch.
        """
        sublego = self.load_sublego(sublego_id)
        if not sublego:
            print(f"[TaskDispatcher] Validation reject: Sub-LEGO '{sublego_id}' not in registry.")
            return False
        
        owner = sublego.get("owner")
        if owner != agent_id:
            print(f"[TaskDispatcher] Ownership violation: Sub-LEGO '{sublego_id}' belongs to '{owner}', not '{agent_id}'")
            return False

        return True

    def dispatch_execution_job(self, agent_id: str, task_id: str, sublego_id: str, command: list[str], cwd: str = ".") -> str:
        """
        Enqueues an execution job for Arena Executor daemon.
        Validates ownership strictly before enqueuing (fail-closed).
        """
        if not self.validate_agent_task(agent_id, sublego_id):
            raise ValueError(f"Security Rejection: Agent '{agent_id}' is not the authorized owner of Sub-LEGO '{sublego_id}'")

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

        print(f"[TaskDispatcher] Enqueued verified execution job {job_id} for {agent_id} (Sub-LEGO: {sublego_id})")
        return job_id
