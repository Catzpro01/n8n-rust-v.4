import json
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

try:
    from .config import SUPABASE_URL, SUPABASE_KEY
except (ImportError, ValueError):
    from config import SUPABASE_URL, SUPABASE_KEY

class SupabaseAdapter:
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
            return 0, {}
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
            return e.code, {"error": body}
        except Exception as e:
            return 0, {"error": str(e)}

    def acquire_lock(self, resource_id: str, resource_type: str, agent_id: str, task_id: str, duration_sec: int = 3600) -> bool:
        """
        P0-6 Fix: Atomic lock acquisition.
        Never blindly overwrites an active lock held by another agent.
        """
        # 1. Try atomic RPC if available
        rpc_payload = {
            "p_resource_id": resource_id,
            "p_resource_type": resource_type,
            "p_owner_agent": agent_id,
            "p_task_id": task_id,
            "p_ttl_seconds": duration_sec
        }
        status, res = self._req("rpc/acquire_lego_lock", rpc_payload, method="POST")
        if status == 200 and isinstance(res, dict) and "acquired" in res:
            return res.get("acquired", False)

        # 2. Strict client-side check fallback (Fail-closed on active lock)
        now_dt = datetime.now(timezone.utc)
        status, locks = self._req(f"locks?module=eq.{resource_id}", method="GET")
        if status == 200 and isinstance(locks, list) and len(locks) > 0:
            current = locks[0]
            curr_owner = current.get("owner")
            # If current lock belongs to someone else, reject
            if curr_owner and curr_owner != agent_id:
                print(f"[SupabaseAdapter] Lock rejection: '{resource_id}' is held by '{curr_owner}'")
                return False

        # If not locked by another agent, insert or update
        payload = {
            "module": resource_id,
            "owner": agent_id,
            "ttl_seconds": duration_sec,
            "metadata": {"task_id": task_id, "type": resource_type}
        }
        headers_merge = dict(self.headers, Prefer="resolution=merge-duplicates")
        req = urllib.request.Request(
            f"{self.url}/rest/v1/locks",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers_merge,
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status in (200, 201, 204)
        except Exception as e:
            print(f"[SupabaseAdapter] Lock acquisition error: {e}")
            return False

    def release_lock(self, resource_id: str) -> bool:
        status, _ = self._req(f"locks?module=eq.{resource_id}", method="DELETE")
        return status in (200, 204)

    def record_heartbeat(self, agent_id: str, status: str = "WORKING", task_id: str = None) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "agent_id": agent_id,
            "state": status,
            "current_task": task_id,
            "last_heartbeat": now
        }
        headers_merge = dict(self.headers, Prefer="resolution=merge-duplicates")
        req = urllib.request.Request(
            f"{self.url}/rest/v1/agent_status",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers_merge,
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status in (200, 201, 204)
        except Exception:
            return False
