import json
import time
import subprocess
import yaml
from pathlib import Path
try:
    from .config import REPO_ROOT
except (ImportError, ValueError):
    from config import REPO_ROOT

class TaskDispatcher:
    def __init__(self, repo_root: Path = None, queue_dir: Path = None):
        self.repo_root = (repo_root or REPO_ROOT).resolve()
        self.lego_registry_path = self.repo_root / ".arena/registry/lego.yaml"
        self.sublego_registry_path = self.repo_root / ".arena/registry/sublego.yaml"
        self.tasks_dir = self.repo_root / ".arena/tasks"
        self.queue_incoming = (queue_dir or Path("/srv/arena/runtime/queue")).resolve() / "incoming"

    def load_task_manifest(self, task_id: str, commit_sha: str = None) -> dict:
        """
        Loads authoritative task manifest.
        STRICT SOURCE OF TRUTH:
        - When commit_sha is provided (Webhook / Production mode): Reads strictly from Git tree at commit_sha.
          ZERO working-tree fallback: if commit_sha does not contain the manifest, fails immediately.
        - When commit_sha is None (Local dev/test mode only): Reads from local .arena/tasks/.
        """
        manifest_rel_yaml = f".arena/tasks/{task_id}.yaml"
        manifest_rel_json = f".arena/tasks/{task_id}.json"

        # 1. Authoritative Webhook Mode: Git Object Database at commit_sha ONLY
        if commit_sha:
            for rel_path in [manifest_rel_yaml, manifest_rel_json]:
                try:
                    raw_content = subprocess.check_output(
                        ["git", "show", f"{commit_sha}:{rel_path}"],
                        cwd=str(self.repo_root),
                        stderr=subprocess.DEVNULL
                    ).decode("utf-8")
                    if rel_path.endswith(".yaml"):
                        return yaml.safe_load(raw_content)
                    else:
                        return json.loads(raw_content)
                except Exception:
                    continue
            
            # FAIL-CLOSED: strictly no fallback to working tree in production webhook mode
            print(f"[TaskDispatcher] REJECT: Task manifest '{task_id}' not found in Git commit '{commit_sha}' (fail-closed)")
            return None

        # 2. Local development/test mode only (when commit_sha is explicitly None)
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

    def dispatch_execution_job(self, agent_id: str, task_id: str, sublego_id: str, command: list[str], cwd: str = ".", commit_sha: str = None) -> str:
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
            "commit_sha": commit_sha,
            "enqueued_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

        # Atomic write
        tmp_file = self.queue_incoming / f".{job_id}.tmp"
        with open(tmp_file, "w") as f:
            json.dump(payload, f, indent=2)
        tmp_file.rename(job_file)

        print(f"[TaskDispatcher] Enqueued verified execution job {job_id} for {agent_id} (Sub-LEGO: {sublego_id}, Commit: {commit_sha})")
        return job_id
