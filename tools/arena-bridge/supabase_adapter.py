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
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }

    def _post(self, endpoint: str, data: dict) -> bool:
        if not self.url or not self.key:
            return False
        req = urllib.request.Request(
            f"{self.url}/rest/v1/{endpoint}",
            data=json.dumps(data).encode(),
            headers=self.headers,
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.getcode() in (200, 201, 204)
        except Exception as e:
            print(f"[SupabaseAdapter] POST error on {endpoint}: {e}")
            return False

    def acquire_lock(self, resource_id: str, resource_type: str, agent_id: str, task_id: str, duration_sec: int = 3600) -> bool:
        lease_until = (datetime.now(timezone.utc) + timedelta(seconds=duration_sec)).isoformat()
        payload = {
            "resource_id": resource_id,
            "resource_type": resource_type,
            "owner_agent": agent_id,
            "task_id": task_id,
            "lease_until": lease_until
        }
        return self._post("lego_locks", payload) or self._post("locks", {"module": resource_id, "owner": agent_id, "ttl_seconds": duration_sec})

    def release_lock(self, resource_id: str) -> bool:
        req = urllib.request.Request(
            f"{self.url}/rest/v1/locks?module=eq.{resource_id}",
            headers=self.headers,
            method="DELETE"
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.getcode() in (200, 204)
        except Exception:
            return False

    def record_heartbeat(self, agent_id: str, status: str = "WORKING", task_id: str = None) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "agent_id": agent_id,
            "state": status,
            "current_task": task_id,
            "last_heartbeat": now
        }
        return self._post("agent_status", payload)
