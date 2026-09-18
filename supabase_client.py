import os, json, urllib.request
from datetime import datetime, timezone
from pathlib import Path

env_file = Path(__file__).parent / ".env"
config = {}
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            config[k.strip()] = v.strip().strip('"').strip("'")

SUPABASE_URL = config.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = config.get("SUPABASE_SERVICE_ROLE_KEY") or config.get("SUPABASE_PUBLISHABLE_KEY", "")

class AgentSupabaseClient:
    def __init__(self, agent_id, lego_module=None):
        self.agent_id = agent_id
        self.lego = lego_module or agent_id
        self.url = SUPABASE_URL
        self.key = SUPABASE_KEY
        self.headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}

    def heartbeat(self, state="IDLE", current_task=None):
        now = datetime.now(timezone.utc).isoformat()
        payload = {"agent_id": self.agent_id, "current_lego": self.lego, "state": state, "current_task": current_task, "last_heartbeat": now}
        req = urllib.request.Request(f"{self.url}/rest/v1/agent_status", data=json.dumps(payload).encode(), headers=self.headers, method="POST")
        req.add_header("Prefer", "resolution=merge-duplicates")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.getcode() in (200, 201, 204)
        except Exception:
            return False
