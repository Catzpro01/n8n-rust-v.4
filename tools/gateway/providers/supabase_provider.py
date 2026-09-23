"""
Supabase Capability Provider for Arena Manager Gateway.
Enables management of tasks, agents, claims, locks, events, and Control Plane state
without exposing service keys, JWTs, or database credentials.
"""

import json
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional
from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer

class SupabaseProvider:
    def __init__(self, vault: SecretVault, sanitizer: Sanitizer):
        self.vault = vault
        self.sanitizer = sanitizer

    def _get_creds(self):
        url = self.vault.get("SUPABASE_URL")
        key = self.vault.get("SUPABASE_SERVICE_ROLE_KEY") or self.vault.get("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError("Supabase credentials not available in vault")
        return url.rstrip("/"), key

    def _request(self, endpoint: str, method: str = "GET", data: Optional[Dict[str, Any]] = None, is_rpc: bool = False) -> Any:
        base_url, key = self._get_creds()
        prefix = "rpc" if is_rpc else "rest/v1"
        url = f"{base_url}/{prefix}/{endpoint.lstrip('/')}"

        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        payload = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {"status": resp.status}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise RuntimeError(f"Supabase Error ({e.code}): {self.sanitizer.sanitize_string(err_body)}")
        except Exception as ex:
            raise RuntimeError(f"Supabase Network Error: {self.sanitizer.sanitize_string(str(ex))}")

    # Capabilities
    def read_table(self, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        table = params.get("table")
        query_str = params.get("query", "select=*")
        if not table:
            raise ValueError("Parameter 'table' is required")
        res = self._request(f"{table}?{query_str}")
        return self.sanitizer.sanitize(res) if isinstance(res, list) else [res]

    def write_table(self, params: Dict[str, Any]) -> Any:
        table = params.get("table")
        data = params.get("data")
        method = params.get("method", "POST").upper()
        filter_query = params.get("filter", "")
        if not table or data is None:
            raise ValueError("Parameters 'table' and 'data' are required")

        endpoint = f"{table}?{filter_query}" if filter_query else table
        res = self._request(endpoint, method=method, data=data)
        return self.sanitizer.sanitize(res)

    def rpc(self, params: Dict[str, Any]) -> Any:
        func_name = params.get("function") or params.get("name")
        args = params.get("args") or params.get("arguments") or {}
        if not func_name:
            raise ValueError("Parameter 'function' is required")
        res = self._request(func_name, method="POST", data=args, is_rpc=True)
        return self.sanitizer.sanitize(res)

    def inspect_tasks(self, params: Dict[str, Any]) -> Dict[str, Any]:
        status_filter = params.get("status")
        query = "select=id,task_key,title,status,priority,progress_weight,version,assigned_agent_id"
        if status_filter:
            query += f"&status=eq.{status_filter}"
        tasks = self._request(f"tasks?{query}")
        by_status = {}
        for t in tasks:
            st = t.get("status", "UNKNOWN")
            by_status[st] = by_status.get(st, 0) + 1
        return {
            "total": len(tasks),
            "summary_by_status": by_status,
            "tasks": self.sanitizer.sanitize(tasks)
        }

    def inspect_agents(self, params: Dict[str, Any]) -> Dict[str, Any]:
        agents = self._request("agents?select=id,agent_key,specialization_id,status,current_task_id,last_heartbeat")
        available = [a for a in agents if a.get("status") == "AVAILABLE"]
        working = [a for a in agents if a.get("status") != "AVAILABLE"]
        return {
            "total_agents": len(agents),
            "available_count": len(available),
            "working_count": len(working),
            "agents": self.sanitizer.sanitize(agents)
        }

    def inspect_locks(self, params: Dict[str, Any]) -> Dict[str, Any]:
        locks = self._request("locks?select=*")
        return {"total_active_locks": len(locks), "locks": self.sanitizer.sanitize(locks)}

    def create_task(self, params: Dict[str, Any]) -> Dict[str, Any]:
        task_data = params.get("task") or params
        # Ensure minimal required fields
        required = ["task_key", "title", "specialization_id", "milestone"]
        for r in required:
            if r not in task_data:
                raise ValueError(f"Field '{r}' is required to create task")
        res = self._request("tasks", method="POST", data=task_data)
        return {"created": True, "task": self.sanitizer.sanitize(res)}

    def update_task_state(self, params: Dict[str, Any]) -> Dict[str, Any]:
        task_id = params.get("task_id")
        new_status = params.get("status")
        if not task_id or not new_status:
            raise ValueError("Parameters 'task_id' and 'status' are required")
        payload = {"status": new_status}
        if "assigned_agent_id" in params:
            payload["assigned_agent_id"] = params["assigned_agent_id"]
        res = self._request(f"tasks?id=eq.{task_id}", method="PATCH", data=payload)
        return {"task_id": task_id, "updated": True, "result": self.sanitizer.sanitize(res)}

    def record_event(self, params: Dict[str, Any]) -> Dict[str, Any]:
        event_type = params.get("event_type")
        payload = params.get("payload") or {}
        if not event_type:
            raise ValueError("Parameter 'event_type' is required")
        data = {
            "event_type": event_type,
            "payload": payload,
            "source": "arena_manager"
        }
        res = self._request("events", method="POST", data=data)
        return {"recorded": True, "event": self.sanitizer.sanitize(res)}

    def get_project_state(self, params: Dict[str, Any]) -> Dict[str, Any]:
        tasks = self._request("tasks?select=status,progress_weight")
        agents = self._request("agents?select=status")
        done = [t for t in tasks if t.get("status") == "DONE"]
        queued = [t for t in tasks if t.get("status") == "QUEUED"]
        active = [t for t in tasks if t.get("status") not in ("DONE", "QUEUED")]
        total_w = sum(float(t.get("progress_weight", 0.0)) for t in tasks) or 85.0
        done_w = sum(float(t.get("progress_weight", 0.0)) for t in done)

        avail_agents = [a for a in agents if a.get("status") == "AVAILABLE"]
        working_agents = [a for a in agents if a.get("status") != "AVAILABLE"]

        return {
            "total_tasks": len(tasks),
            "done_tasks": len(done),
            "queued_tasks": len(queued),
            "active_tasks": len(active),
            "weighted_progress": f"{done_w:.1f}/{total_w:.1f} ({(done_w/total_w)*100:.1f}%)",
            "available_agents": len(avail_agents),
            "working_agents": len(working_agents)
        }

    # Enhanced Control Plane: Leasing & Worker Lifecycle
    def register_worker(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Registers or updates a dynamic worker agent in Supabase."""
        agent_key = params.get("agent_key") or params.get("worker_id")
        specialization_id = params.get("specialization_id")
        if not agent_key or not specialization_id:
            raise ValueError("Parameters 'agent_key' and 'specialization_id' are required")

        rpc_args = {
            "p_agent_key": agent_key,
            "p_specialization_id": specialization_id,
            "p_capabilities": params.get("capabilities", {}),
            "p_hostname": params.get("hostname", "laptop-worker"),
            "p_platform": params.get("platform", "windows"),
            "p_workspace_root": params.get("workspace_root", ""),
            "p_worker_version": params.get("worker_version", "1.7.0"),
            "p_execution_backend": params.get("execution_backend", "laptop_webhook"),
            "p_resource_capacity": params.get("resource_capacity", {"build_slots": 1, "test_slots": 2})
        }
        res = self._request("register_dynamic_agent", method="POST", data=rpc_args, is_rpc=True)
        return self.sanitizer.sanitize(res)

    def claim_task_lease(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Atomically claims a task with an OCC version check and lease timeout."""
        task_id = params.get("task_id")
        agent_id = params.get("agent_id")
        expected_version = params.get("expected_version", 0)
        lease_seconds = params.get("lease_seconds", 600)

        if not task_id or not agent_id:
            raise ValueError("Parameters 'task_id' and 'agent_id' are required")

        rpc_args = {
            "p_task_id": task_id,
            "p_agent_id": agent_id,
            "p_expected_version": int(expected_version),
            "p_lease_seconds": int(lease_seconds)
        }
        res = self._request("claim_task", method="POST", data=rpc_args, is_rpc=True)
        return self.sanitizer.sanitize(res)

    def worker_heartbeat(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Submits heartbeat proof for an active worker."""
        agent_id = params.get("agent_id")
        if not agent_id:
            raise ValueError("Parameter 'agent_id' is required")

        rpc_args = {
            "p_agent_id": agent_id,
            "p_worker_state": params.get("status", "AVAILABLE"),
            "p_current_task_id": params.get("current_task_id"),
            "p_active_build_slots": params.get("active_build_slots", 0),
            "p_active_test_slots": params.get("active_test_slots", 0),
            "p_worker_version": params.get("worker_version", "1.7.0")
        }
        res = self._request("agent_heartbeat", method="POST", data=rpc_args, is_rpc=True)
        return self.sanitizer.sanitize(res)

    def reap_expired_leases(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Reaps expired task leases and marks timed out tasks as STALE / RECLAIMABLE."""
        res = self._request("reap_expired_leases", method="POST", data={}, is_rpc=True)
        return self.sanitizer.sanitize(res)

    def record_checkpoint(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Records an execution progress checkpoint for worker recovery."""
        task_id = params.get("task_id")
        agent_id = params.get("agent_id")
        branch_name = params.get("branch_name")
        if not task_id or not branch_name:
            raise ValueError("Parameters 'task_id' and 'branch_name' are required")

        checkpoint_data = {
            "task_id": task_id,
            "agent_id": agent_id,
            "branch_name": branch_name,
            "checkpoint_type": params.get("type", "PROGRESS"),
            "description": params.get("description", ""),
            "current_commit_sha": params.get("commit_sha"),
            "files_changed": params.get("files_changed", []),
            "metadata": params.get("metadata", {})
        }
        res = self._request("agent_checkpoints", method="POST", data=checkpoint_data)
        return {"recorded": True, "checkpoint": self.sanitizer.sanitize(res)}

