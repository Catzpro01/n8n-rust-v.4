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

        if event_type in ("pull_request", "push"):
            branch = ""
            action = ""
            if event_type == "pull_request":
                pr = payload.get("pull_request", {})
                action = payload.get("action", "")
                branch = pr.get("head", {}).get("ref", "")
            else:
                ref = payload.get("ref", "")
                branch = ref.replace("refs/heads/", "")
                action = "push"

            # Authoritative Branch Pattern: arena/<agent-id>/<task-id>
            m = re.match(r"^arena/([^/]+)/([^/]+)$", branch)
            if not m:
                print(f"[ArenaBridge] Branch '{branch}' is not an arena branch. Skipping.")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "ignored", "reason": "Non-arena branch"}')
                return

            agent_id, task_id = m.group(1), m.group(2)
            print(f"[ArenaBridge] Processing {event_type} ({action}) for agent: {agent_id}, task: {task_id}")

            if action in ("opened", "synchronize", "push"):
                # 1. Authoritative Task Manifest Resolution
                task_manifest = dispatcher.load_task_manifest(task_id)
                if not task_manifest:
                    print(f"[ArenaBridge] REJECT: Task manifest not found for task_id '{task_id}' (fail-closed)")
                    self.send_response(422)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error": "Task manifest not found in .arena/tasks (fail-closed)"}')
                    return

                manifest_agent = task_manifest.get("agent")
                sublego_id = task_manifest.get("sublego")
                parent_lego = task_manifest.get("lego")
                command = task_manifest.get("command", ["cargo", "check", "--workspace"])

                # Validate agent matches manifest
                if manifest_agent != agent_id:
                    print(f"[ArenaBridge] REJECT: Branch agent '{agent_id}' does not match manifest agent '{manifest_agent}'")
                    self.send_response(403)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error": "Agent mismatch with task manifest (fail-closed)"}')
                    return

                # 2. Strict Sub-LEGO Ownership Validation
                if not dispatcher.validate_agent_task(agent_id, sublego_id):
                    print(f"[ArenaBridge] REJECT: Agent '{agent_id}' does not own Sub-LEGO '{sublego_id}'")
                    self.send_response(403)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error": "Agent does not own Sub-LEGO (fail-closed)"}')
                    return

                # 3. Acquire Distributed Locks: Task Lease + Sub-LEGO Resource Lock
                supabase.record_heartbeat(agent_id, status="WORKING", task_id=task_id)
                
                # Lock Sub-LEGO resource
                sublego_lock_ok = supabase.acquire_lock(
                    resource_id=sublego_id,
                    resource_type="sublego",
                    agent_id=agent_id,
                    task_id=task_id
                )
                if not sublego_lock_ok:
                    print(f"[ArenaBridge] REJECT: Sub-LEGO '{sublego_id}' lock acquisition failed")
                    self.send_response(409)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error": "Sub-LEGO lock conflict or failure (fail-closed)"}')
                    return

                # Lock Task Lease
                task_lock_ok = supabase.acquire_lock(
                    resource_id=f"task:{task_id}",
                    resource_type="task",
                    agent_id=agent_id,
                    task_id=task_id
                )

                # 4. Dispatch Job to Arena Executor Queue
                try:
                    job_id = dispatcher.dispatch_execution_job(
                        agent_id=agent_id,
                        task_id=task_id,
                        sublego_id=sublego_id,
                        command=command
                    )
                    dispatch_result.update({
                        "agent_id": agent_id,
                        "task_id": task_id,
                        "sublego_id": sublego_id,
                        "lego": parent_lego,
                        "action": "enqueued_for_execution",
                        "job_id": job_id
                    })
                except Exception as e:
                    print(f"[ArenaBridge] Dispatch error: {e}")
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                    return

            elif action == "closed":
                # Release Sub-LEGO lock & task lock
                task_manifest = dispatcher.load_task_manifest(task_id)
                sublego_id = task_manifest.get("sublego") if task_manifest else ""
                if sublego_id:
                    supabase.release_lock(sublego_id, agent_id=agent_id)
                supabase.release_lock(f"task:{task_id}", agent_id=agent_id)
                supabase.record_heartbeat(agent_id, status="IDLE", task_id=None)
                dispatch_result.update({"agent_id": agent_id, "task_id": task_id, "action": "locks_released"})

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
