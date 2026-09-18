import hmac
import hashlib
import json
import re
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    from .config import PORT, GITHUB_WEBHOOK_SECRET
    from .supabase_adapter import SupabaseAdapter
    from .dispatcher import TaskDispatcher
except (ImportError, ValueError):
    from config import PORT, GITHUB_WEBHOOK_SECRET
    from supabase_adapter import SupabaseAdapter
    from dispatcher import TaskDispatcher

dispatcher = TaskDispatcher()
supabase = SupabaseAdapter()

class ArenaWebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        # Fail-closed signature check
        sig_header = self.headers.get("X-Hub-Signature-256")
        if not sig_header:
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "Missing X-Hub-Signature-256 header (fail-closed)"}')
            return

        expected = "sha256=" + hmac.new(GITHUB_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig_header, expected):
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error": "Invalid X-Hub-Signature-256 signature"}')
            return

        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}

        event_type = self.headers.get("X-GitHub-Event", "ping")
        print(f"[ArenaBridge] Incoming event: {event_type}")

        dispatch_result = {"event": event_type, "status": "processed"}

        if event_type == "pull_request":
            pr = payload.get("pull_request", {})
            action = payload.get("action", "")
            branch = pr.get("head", {}).get("ref", "")
            pr_num = pr.get("number")

            # Match arena branch: arena/<agent-id>/<task-id>
            m = re.match(r"^arena/([^/]+)/([^/]+)$", branch)
            if m:
                agent_id, task_id = m.group(1), m.group(2)
                sublego_id = task_id.split("-")[0] if "-" in task_id else task_id
                print(f"[ArenaBridge] PR #{pr_num} ({action}) for agent: {agent_id}, task: {task_id}")

                if action in ("opened", "synchronize"):
                    # 1. Update heartbeat & lock in Supabase (fail-closed)
                    supabase.record_heartbeat(agent_id, status="WORKING", task_id=task_id)
                    lock_ok = supabase.acquire_lock(f"task:{task_id}", "task", agent_id, task_id)
                    
                    if not lock_ok:
                        dispatch_result.update({"status": "rejected", "reason": "Failed to acquire lock (fail-closed)"})
                    else:
                        # 2. Real Dispatch to Arena Executor Queue: run verification
                        job_id = dispatcher.dispatch_execution_job(
                            agent_id=agent_id,
                            task_id=task_id,
                            sublego_id=sublego_id,
                            command=["cargo", "check", "--workspace"]
                        )
                        dispatch_result.update({
                            "agent_id": agent_id,
                            "task_id": task_id,
                            "action": "enqueued_for_execution",
                            "job_id": job_id
                        })

                elif action == "closed":
                    supabase.release_lock(f"task:{task_id}", agent_id=agent_id)
                    supabase.record_heartbeat(agent_id, status="IDLE", task_id=None)
                    dispatch_result.update({"agent_id": agent_id, "task_id": task_id, "action": "lock_released"})

        elif event_type == "push":
            ref = payload.get("ref", "")
            head_commit = payload.get("head_commit", {}).get("id", "")[:8]
            m = re.match(r"^refs/heads/arena/([^/]+)/([^/]+)$", ref)
            if m:
                agent_id, task_id = m.group(1), m.group(2)
                sublego_id = task_id.split("-")[0] if "-" in task_id else task_id
                supabase.record_heartbeat(agent_id, status="WORKING", task_id=task_id)
                # Dispatch test job
                job_id = dispatcher.dispatch_execution_job(
                    agent_id=agent_id,
                    task_id=task_id,
                    sublego_id=sublego_id,
                    command=["cargo", "check", "--workspace"]
                )
                dispatch_result.update({
                    "agent_id": agent_id,
                    "task_id": task_id,
                    "commit": head_commit,
                    "job_id": job_id
                })

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(dispatch_result).encode("utf-8"))

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status": "healthy", "component": "arena-bridge", "port": 9000}')

def run_server():
    server = HTTPServer(("127.0.0.1", PORT), ArenaWebhookHandler)
    print(f"[ArenaBridge] Server running on http://127.0.0.1:{PORT}")
    server.serve_forever()

if __name__ == "__main__":
    run_server()
