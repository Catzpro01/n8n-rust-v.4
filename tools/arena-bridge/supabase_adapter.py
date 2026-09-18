import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

try:
    from .config import SUPABASE_URL, SUPABASE_KEY
except (ImportError, ValueError):
    from config import SUPABASE_URL, SUPABASE_KEY

class SupabaseAdapter:
    """
    Unified Supabase state coordinator strictly bound to 002_arena_control_plane.sql.
    Operates in strict FAIL-CLOSED mode: single RPC path, zero unsafe fallbacks.
    """
    def __init__(self):
        self.url = SUPABASE_URL.rstrip("/")
        self.key = SUPABASE_KEY
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json"
        }

    def _req(self, endpoint: str, data: dict = None, method: str = "GET") -> tuple[int, dict]:
        if not self.url or not self.key:
            return 0, {"error": "Missing Supabase configuration"}
        req = urllib.request.Request(
            f"{self.url}/rest/v1/{endpoint}",
            data=json.dumps(data).encode("utf-8") if data else None,
            headers=self.headers,
            method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read().decode("utf-8")
                return resp.status, json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8") if e.fp else ""
            try:
                err_json = json.loads(body)
            except Exception:
                err_json = {"raw": body}
            return e.code, {"http_error": e.code, "details": err_json}
        except Exception as e:
            return 0, {"error": str(e)}

    def acquire_lock(self, resource_id: str, resource_type: str, agent_id: str, task_id: str, duration_sec: int = 3600) -> bool:
        """
        Atomic lock acquisition using public.acquire_lego_lock RPC (FOR UPDATE).
        Fail-closed: returns False on any failure or rejection.
        """
        rpc_payload = {
            "p_resource_id": resource_id,
            "p_resource_type": resource_type,
            "p_owner_agent": agent_id,
            "p_task_id": task_id,
            "p_ttl_seconds": duration_sec
        }
        status, res = self._req("rpc/acquire_lego_lock", rpc_payload, method="POST")
        if status == 200 and isinstance(res, dict) and res.get("acquired") is True:
            return True
        
        print(f"[SupabaseAdapter] Failed to acquire lock for '{resource_id}': status={status}, res={res}")
        return False

    def release_lock(self, resource_id: str, agent_id: str, task_id: str = None) -> bool:
        """
        Owner-aware atomic lock release using public.release_lego_lock RPC ONLY.
        Strict single authoritative path: no REST DELETE fallback.
        Fail-closed: returns False on any error or rejection.
        """
        rpc_payload = {
            "p_resource_id": resource_id,
            "p_owner_agent": agent_id,
            "p_task_id": task_id
        }
        status, res = self._req("rpc/release_lego_lock", rpc_payload, method="POST")
        if status == 200 and isinstance(res, dict) and res.get("released") is True:
            return True

        print(f"[SupabaseAdapter] Failed to release lock for '{resource_id}': status={status}, res={res}")
        return False

    def record_heartbeat(self, agent_id: str, status: str = "WORKING", task_id: str = None) -> bool:
        """
        Records heartbeat in heartbeats table and updates agents table.
        """
        now = datetime.now(timezone.utc).isoformat()
        
        # 1. Update agents table
        agent_payload = {
            "status": status,
            "current_task_id": task_id,
            "last_heartbeat": now,
            "updated_at": now
        }
        st_agent, _ = self._req(f"agents?id=eq.{agent_id}", agent_payload, method="PATCH")

        # 2. Insert into heartbeats audit table
        hb_payload = {
            "agent_id": agent_id,
            "status": status,
            "current_task": task_id,
            "timestamp": now
        }
        st_hb, _ = self._req("heartbeats", hb_payload, method="POST")

        return st_agent in (200, 204)

    def record_execution_run(self, task_id: str, agent_id: str, command_hash: str, argv: list[str],
                             status: str, exit_code: int, summary: str, log_path: str = None) -> bool:
        """
        Records structured command execution audit log in execution_runs table.
        """
        payload = {
            "task_id": task_id,
            "agent_id": agent_id,
            "command_hash": command_hash,
            "argv": argv,
            "status": status,
            "exit_code": exit_code,
            "summary": summary,
            "log_path": log_path,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "ended_at": datetime.now(timezone.utc).isoformat()
        }
        st, _ = self._req("execution_runs", payload, method="POST")
        return st in (200, 201, 204)
