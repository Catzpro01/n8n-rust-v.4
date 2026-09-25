"""Hermetic regression tests for SupabaseProvider (TASK-0006, recovered arena-manager fixes).

No network: urllib.request.urlopen is replaced by a recorder.
1. RPC calls target /rest/v1/rpc/<function> (PostgREST), table calls /rest/v1/<table>.
2. A heartbeat without an explicit status sends p_worker_state = NULL, which
   public.agent_heartbeat treats as "keep the stored state"; it never forces AVAILABLE.
"""

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.gateway.providers import supabase_provider as sp  # noqa: E402


class _Vault:
    def get(self, key):
        return {"SUPABASE_URL": "https://example.invalid/", "SUPABASE_SERVICE_ROLE_KEY": "test-key"}.get(key)


class _Sanitizer:
    def sanitize(self, value):
        return value

    def sanitize_string(self, value):
        return value


class _Resp:
    status = 200

    def __init__(self, body):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class SupabaseProviderRpcTest(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def fake_urlopen(req, timeout=None):
            self.calls.append({"url": req.full_url, "body": json.loads(req.data) if req.data else None})
            return _Resp(b"[]")

        patcher = mock.patch.object(sp.urllib.request, "urlopen", side_effect=fake_urlopen)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.provider = sp.SupabaseProvider(_Vault(), _Sanitizer())

    def test_rpc_uses_postgrest_path(self):
        self.provider.worker_heartbeat({"agent_id": "a1", "status": "WORKING"})
        self.assertEqual(self.calls[-1]["url"], "https://example.invalid/rest/v1/rpc/agent_heartbeat")

    def test_table_path_unchanged(self):
        self.provider.read_table({"table": "tasks", "query": "select=id"})
        self.assertEqual(self.calls[-1]["url"], "https://example.invalid/rest/v1/tasks?select=id")

    def test_heartbeat_without_status_preserves_state(self):
        for _ in range(3):
            self.provider.worker_heartbeat({"agent_id": "a1", "current_task_id": "t1"})
            self.assertIsNone(self.calls[-1]["body"]["p_worker_state"])
            self.assertEqual(self.calls[-1]["body"]["p_current_task_id"], "t1")

    def test_heartbeat_explicit_state_is_forwarded(self):
        self.provider.worker_heartbeat({"agent_id": "a1", "worker_state": "WORKING"})
        self.assertEqual(self.calls[-1]["body"]["p_worker_state"], "WORKING")
        self.provider.worker_heartbeat({"agent_id": "a1", "status": "AVAILABLE"})
        self.assertEqual(self.calls[-1]["body"]["p_worker_state"], "AVAILABLE")


if __name__ == "__main__":
    unittest.main()
