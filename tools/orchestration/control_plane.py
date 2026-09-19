import json
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

def load_env_config(env_path: Optional[Path] = None) -> Dict[str, str]:
    if env_path is None:
        # Search from current file upwards
        curr = Path(__file__).resolve().parent
        while curr != curr.parent:
            candidate = curr / ".env"
            if candidate.exists():
                env_path = candidate
                break
            curr = curr.parent
    if not env_path or not env_path.exists():
        return {}

    cfg = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip("'").strip('"')
    return cfg

class ControlPlaneClient:
    """
    Authoritative state client strictly interacting with the Supabase Control Plane via
    Optimistic Concurrency Control (OCC) and atomic RPC functions.
    """
    def __init__(self, url: Optional[str] = None, service_key: Optional[str] = None):
        cfg = load_env_config()
        self.url = (url or cfg.get("SUPABASE_URL", "")).rstrip("/")
        self.key = service_key or cfg.get("SUPABASE_SERVICE_ROLE_KEY") or cfg.get("SUPABASE_SECRET_KEY") or cfg.get("SUPABASE_PUBLISHABLE_KEY", "")
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }

    def _request(self, endpoint: str, data: Optional[Dict[str, Any]] = None, method: str = "GET") -> Tuple[int, Any]:
        if not self.url or not self.key:
            return 0, {"error": "Missing Supabase URL or Service Key in configuration"}
        url = f"{self.url}/rest/v1/{endpoint}"
        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body, headers=self.headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8") if e.fp else ""
            try:
                err_json = json.loads(raw)
            except Exception:
                err_json = {"raw": raw}
            return e.code, {"http_error": e.code, "details": err_json}
        except Exception as e:
            return 0, {"error": str(e)}

    def rpc(self, func_name: str, params: Dict[str, Any]) -> Tuple[int, Any]:
        return self._request(f"rpc/{func_name}", params, method="POST")

    # --------------------------------------------------------------------------
    # Task Lifecycle Transitions
    # --------------------------------------------------------------------------
    def claim_task(self, task_id: str, agent_id: str, expected_version: int) -> Tuple[int, Any]:
        return self.rpc("claim_task", {
            "p_task_id": task_id,
            "p_agent_id": agent_id,
            "p_expected_version": expected_version
        })

    def start_task(self, task_id: str, agent_id: str, expected_version: int) -> Tuple[int, Any]:
        return self.rpc("start_task", {
            "p_task_id": task_id,
            "p_agent_id": agent_id,
            "p_expected_version": expected_version
        })

    def submit_commit(self, task_id: str, agent_id: str, commit_sha: str, expected_version: int) -> Tuple[int, Any]:
        return self.rpc("submit_commit", {
            "p_task_id": task_id,
            "p_agent_id": agent_id,
            "p_commit_sha": commit_sha,
            "p_expected_version": expected_version
        })

    def record_build_result(self, task_id: str, commit_sha: str, workflow_run_id: str, status: str, log_url: Optional[str] = None) -> Tuple[int, Any]:
        return self.rpc("record_build_result", {
            "p_task_id": task_id,
            "p_commit_sha": commit_sha,
            "p_workflow_run_id": workflow_run_id,
            "p_status": status,
            "p_log_url": log_url
        })

    def record_test_result(self, task_id: str, commit_sha: str, suite: str, command: str,
                           passed: int, failed: int, skipped: int, duration_ms: int,
                           status: str, log_ref: Optional[str] = None) -> Tuple[int, Any]:
        return self.rpc("record_test_result", {
            "p_task_id": task_id,
            "p_commit_sha": commit_sha,
            "p_suite": suite,
            "p_command": command,
            "p_passed": passed,
            "p_failed": failed,
            "p_skipped": skipped,
            "p_duration_ms": duration_ms,
            "p_status": status,
            "p_log_ref": log_ref
        })

    def record_audit_result(self, task_id: str, commit_sha: str, auditor: str, status: str,
                            findings: Optional[list] = None, severity: str = "NONE") -> Tuple[int, Any]:
        return self.rpc("record_audit_result", {
            "p_task_id": task_id,
            "p_commit_sha": commit_sha,
            "p_auditor": auditor,
            "p_status": status,
            "p_findings": findings or [],
            "p_severity": severity
        })

    def authorize_merge(self, task_id: str, commit_sha: str, expected_version: int) -> Tuple[int, Any]:
        return self.rpc("authorize_merge", {
            "p_task_id": task_id,
            "p_commit_sha": commit_sha,
            "p_expected_version": expected_version
        })

    def record_merge(self, task_id: str, merge_commit_sha: str, expected_version: int) -> Tuple[int, Any]:
        return self.rpc("record_merge", {
            "p_task_id": task_id,
            "p_merge_commit_sha": merge_commit_sha,
            "p_expected_version": expected_version
        })

    def start_cleanup(self, task_id: str, expected_version: int) -> Tuple[int, Any]:
        return self.rpc("start_cleanup", {
            "p_task_id": task_id,
            "p_expected_version": expected_version
        })

    def complete_cleanup(self, task_id: str, expected_version: int) -> Tuple[int, Any]:
        return self.rpc("complete_cleanup", {
            "p_task_id": task_id,
            "p_expected_version": expected_version
        })

    # --------------------------------------------------------------------------
    # Distributed Resource Locking
    # --------------------------------------------------------------------------
    def acquire_file_lock(self, resource: str, task_id: str, agent_id: str, ttl_seconds: int = 3600) -> Tuple[int, Any]:
        return self.rpc("acquire_file_lock", {
            "p_resource": resource,
            "p_task_id": task_id,
            "p_agent_id": agent_id,
            "p_ttl_seconds": ttl_seconds
        })

    def release_file_lock(self, resource: str, task_id: str, agent_id: str) -> Tuple[int, Any]:
        return self.rpc("release_file_lock", {
            "p_resource": resource,
            "p_task_id": task_id,
            "p_agent_id": agent_id
        })

    def reap_expired_leases(self) -> Tuple[int, Any]:
        return self.rpc("reap_expired_leases", {})

    # --------------------------------------------------------------------------
    # REST Direct Helpers
    # --------------------------------------------------------------------------
    def get_task_by_key(self, task_key: str) -> Optional[Dict[str, Any]]:
        status, res = self._request(f"tasks?task_key=eq.{task_key}&limit=1")
        if status == 200 and isinstance(res, list) and len(res) > 0:
            return res[0]
        return None

    def get_task_by_id(self, task_id: str) -> Optional[Dict[str, Any]]:
        status, res = self._request(f"tasks?id=eq.{task_id}&limit=1")
        if status == 200 and isinstance(res, list) and len(res) > 0:
            return res[0]
        return None

    def get_specialization_by_slug(self, slug: str) -> Optional[Dict[str, Any]]:
        status, res = self._request(f"specializations?slug=eq.{slug}&limit=1")
        if status == 200 and isinstance(res, list) and len(res) > 0:
            return res[0]
        return None

    def heartbeat_agent(self, agent_id: str, status: Optional[str] = None, task_id: Optional[str] = None) -> Tuple[int, Any]:
        data = {"last_heartbeat": "NOW()"}
        if status:
            data["status"] = status
        if task_id is not None:
            data["current_task_id"] = task_id
        return self._request(f"agents?id=eq.{agent_id}", data=data, method="PATCH")

    def register_agent(self, agent_key: str, specialization_id: str, capabilities: Optional[Dict[str, Any]] = None) -> Tuple[int, Any]:
        payload = {
            "agent_key": agent_key,
            "specialization_id": specialization_id,
            "status": "AVAILABLE",
            "capabilities": capabilities or {}
        }
        return self._request("agents", data=payload, method="POST")

    # --------------------------------------------------------------------------
    # Recovery Plane RPCs
    # --------------------------------------------------------------------------
    def reclaim_task(self, task_id: str, new_agent_id: str, expected_version: int, lease_seconds: int = 600) -> Tuple[int, Any]:
        return self.rpc("reclaim_task", {
            "p_task_id": task_id,
            "p_new_agent_id": new_agent_id,
            "p_expected_version": expected_version,
            "p_lease_seconds": lease_seconds
        })

    def create_agent_checkpoint(
        self,
        task_id: str,
        agent_id: str,
        checkpoint_type: str,
        description: str,
        current_commit_sha: str,
        branch_name: str,
        files_changed: Optional[list] = None,
        completed_work: Optional[str] = None,
        remaining_work: Optional[str] = None,
        test_status: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Tuple[int, Any]:
        return self.rpc("create_agent_checkpoint", {
            "p_task_id": task_id,
            "p_agent_id": agent_id,
            "p_checkpoint_type": checkpoint_type,
            "p_description": description,
            "p_current_commit_sha": current_commit_sha,
            "p_branch_name": branch_name,
            "p_files_changed": files_changed or [],
            "p_completed_work": completed_work,
            "p_remaining_work": remaining_work,
            "p_test_status": test_status,
            "p_metadata": metadata or {}
        })

    def get_task_recovery_context(self, task_id: str) -> Tuple[int, Any]:
        return self.rpc("get_task_recovery_context", {
            "p_task_id": task_id
        })

    # --------------------------------------------------------------------------
    # Progress Engine RPCs
    # --------------------------------------------------------------------------
    def get_project_progress(self) -> Tuple[int, Any]:
        return self.rpc("get_project_progress", {})

    def get_milestone_progress(self, milestone: str) -> Tuple[int, Any]:
        return self.rpc("get_milestone_progress", {"p_milestone": milestone})

    def get_task_progress(self, task_key: str) -> Tuple[int, Any]:
        return self.rpc("get_task_progress", {"p_task_key": task_key})

    def record_progress_snapshot(self, main_commit_sha: str, metadata: Optional[Dict[str, Any]] = None) -> Tuple[int, Any]:
        return self.rpc("record_progress_snapshot", {
            "p_main_commit_sha": main_commit_sha,
            "p_metadata": metadata or {}
        })

    def get_latest_progress_snapshot(self) -> Tuple[int, Any]:
        return self.rpc("get_latest_progress_snapshot", {})