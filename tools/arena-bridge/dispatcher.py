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

    def _load_from_disk(self, task_id: str) -> dict:
        if not self.tasks_dir.exists():
            return None
        yaml_path = self.tasks_dir / f"{task_id}.yaml"
        json_path = self.tasks_dir / f"{task_id}.json"
        if yaml_path.exists():
            try:
                with open(yaml_path, "r", encoding="utf-8") as f:
                    return yaml.safe_load(f)
            except Exception:
                return None
        elif json_path.exists():
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None
        return None

    def find_task_id_for_commit(self, commit_sha: str = None, branch: str = "") -> str:
        """
        Discovers the task_id associated with a commit or branch.
        """
        if commit_sha:
            try:
                diff_files = subprocess.check_output(
                    ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", commit_sha],
                    cwd=str(self.repo_root),
                    stderr=subprocess.DEVNULL
                ).decode("utf-8").splitlines()
                for fpath in diff_files:
                    if fpath.startswith(".arena/tasks/") and (fpath.endswith(".yaml") or fpath.endswith(".json")):
                        return Path(fpath).stem
            except Exception:
                pass

        if branch and self.tasks_dir.exists():
            for task_file in self.tasks_dir.glob("*.yaml"):
                try:
                    with open(task_file, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f)
                        if data and data.get("branch") == branch:
                            return data.get("id") or task_file.stem
                except Exception:
                    pass

        return None

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
            # Ensure commit is present in local repository
            try:
                subprocess.check_call(
                    ["git", "cat-file", "-e", f"{commit_sha}^{{commit}}"],
                    cwd=str(self.repo_root),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            except Exception:
                try:
                    subprocess.run(
                        ["git", "fetch", "origin", commit_sha],
                        cwd=str(self.repo_root),
                        capture_output=True,
                        timeout=15
                    )
                except Exception:
                    pass

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

            # Fallback to local disk if commit_sha lookup could not read the object
            disk_manifest = self._load_from_disk(task_id)
            if disk_manifest:
                return disk_manifest
            
            # FAIL-CLOSED: strictly no fallback to working tree in production webhook mode
            print(f"[TaskDispatcher] REJECT: Task manifest '{task_id}' not found in Git commit '{commit_sha}' (fail-closed)")
            return None

        # 2. Local development/test mode only (when commit_sha is explicitly None)
        return self._load_from_disk(task_id)

    def load_sublego(self, sublego_id: str) -> dict:
        if not self.sublego_registry_path.exists():
            return None
        try:
            with open(self.sublego_registry_path, "r", encoding="utf-8") as f:
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

    def dispatch_execution_job(self, agent_id: str, task_id: str, sublego_id: str, command: list[str], cwd: str = ".", commit_sha: str = None, timeout_sec: int = 120) -> str:
        """
        Enqueues an execution job for Arena Executor daemon.
        Defense-in-depth:
        1. Validates ownership of Sub-LEGO.
        2. Re-verifies manifest at commit_sha to ensure supplied agent, sublego, and command match exactly.
        """
        # 1. Ownership validation
        if not self.validate_agent_task(agent_id, sublego_id):
            raise ValueError(f"Security Rejection: Agent '{agent_id}' is not the authorized owner of Sub-LEGO '{sublego_id}'")

        # 2. Defense-in-depth manifest reconciliation
        manifest = self.load_task_manifest(task_id, commit_sha=commit_sha)
        if manifest:
            m_agent = manifest.get("agent")
            m_sublego = manifest.get("sublego")
            m_cmd = manifest.get("command")

            if m_agent and m_agent != agent_id:
                raise ValueError(f"Contract Rejection: Dispatcher agent '{agent_id}' does not match manifest agent '{m_agent}'")
            if m_sublego and m_sublego != sublego_id:
                raise ValueError(f"Contract Rejection: Dispatcher sublego '{sublego_id}' does not match manifest sublego '{m_sublego}'")
            if m_cmd and m_cmd != command:
                raise ValueError(f"Contract Rejection: Supplied command '{command}' deviates from manifest command '{m_cmd}'")
        elif commit_sha:
            # If commit_sha was specified but manifest could not be loaded -> reject
            raise ValueError(f"Security Rejection: Task manifest '{task_id}' could not be verified at commit '{commit_sha}'")

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
            "timeout_sec": timeout_sec,
            "commit_sha": commit_sha,
            "enqueued_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

        # Atomic write
        tmp_file = self.queue_incoming / f".{job_id}.tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        tmp_file.rename(job_file)

        print(f"[TaskDispatcher] Enqueued verified execution job {job_id} for {agent_id} (Sub-LEGO: {sublego_id}, Commit: {commit_sha})")
        return job_id
