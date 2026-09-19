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

        # 1. Fail-closed signature check
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

        event_type = self.headers.get("X-GitHub-Event", "ping")

        # 2. P0 Webhook Idempotency & Replay Protection
        delivery_id = self.headers.get("X-GitHub-Delivery")
        if delivery_id:
            is_new = supabase.check_and_record_delivery(delivery_id, event_type)
            if not is_new:
                print(f"[ArenaBridge] Webhook replay rejected for delivery: {delivery_id}")
                self.send_response(409)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error": "Duplicate webhook delivery rejected (idempotency)"}')
                return

        # 3. Periodic Lease Reaper Check on each incoming event
        try:
            supabase.reap_expired_leases()
        except Exception as e:
            print(f"[ArenaBridge] Reaper notice: {e}")

        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}

        print(f"[ArenaBridge] Incoming verified event: {event_type} (Delivery: {delivery_id})")
        dispatch_result = {"event": event_type, "delivery_id": delivery_id, "status": "processed"}

        if event_type in ("pull_request", "push"):
            branch = ""
            action = ""
            head_sha = ""
            if event_type == "pull_request":
                pr = payload.get("pull_request", {})
                action = payload.get("action", "")
                branch = pr.get("head", {}).get("ref", "")
                head_sha = pr.get("head", {}).get("sha", "")
            else:
                ref = payload.get("ref", "")
                branch = ref.replace("refs/heads/", "")
                action = "push"
                head_sha = payload.get("after") or payload.get("head_commit", {}).get("id", "")

            # Authoritative Branch Pattern: <SPECIALIZATION>/<MILESTONE>-<TASK>
            # Examples: runtime-kernel/m1-runner, data-plane/m1-streaming
            m = re.match(r"^([a-z0-9\-]+)/([a-z0-9]+)-([a-z0-9\-]+)$", branch)
            if not m:
                # Fallback to legacy arena/<agent-id>/<task-id> if present
                m_legacy = re.match(r"^arena/([^/]+)/([^/]+)$", branch)
                if not m_legacy:
                    print(f"[ArenaBridge] Branch '{branch}' does not match canonical spec (<SPECIALIZATION>/<MILESTONE>-<TASK>). Skipping.")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"status": "ignored", "reason": "Non-canonical branch"}')
                    return
                specialization, milestone, task_id = "legacy", "m0", m_legacy.group(2)
                agent_id = m_legacy.group(1)
            else:
                specialization, milestone, task_id = m.group(1), m.group(2), m.group(3)
                agent_id = f"agent-{specialization}"

            print(f"[ArenaBridge] Processing {event_type} ({action}) for spec: {specialization}, task: {task_id}, sha: {head_sha[:8]}")

            if action in ("opened", "synchronize", "push"):
                # Check task in canonical Supabase Control Plane
                try:
                    from tools.orchestration.control_plane import ControlPlaneClient
                    cp = ControlPlaneClient()
                    task_record = cp.get_task_by_key(branch)
                    if task_record:
                        t_id = task_record["id"]
                        t_ver = task_record["version"]
                        assigned_agent = task_record.get("assigned_agent_id") or agent_id
                        print(f"[ArenaBridge] Synchronizing commit {head_sha[:8]} for task {t_id} (v{t_ver}) in Supabase")
                        cp.submit_commit(t_id, str(assigned_agent), head_sha, t_ver)
                except Exception as ex:
                    print(f"[ArenaBridge] Control plane sync notice: {ex}")

                # Load Task Manifest (either .arena/TASK.md or legacy tasks)
                task_manifest = dispatcher.load_task_manifest(task_id, commit_sha=head_sha) or {
                    "sublego": f"{specialization}.{task_id}",
                    "lego": specialization,
                    "command": ["cargo", "check", "--workspace"]
                }

                # Validate agent matches manifest
                if manifest_agent != agent_id:
                    print(f"[ArenaBridge] REJECT: Branch agent '{agent_id}' does not match manifest agent '{manifest_agent}'")
                    self.send_response(403)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error": "Agent mismatch with task manifest (fail-closed)"}')
                    return

                # Strict Sub-LEGO Ownership Validation
                if not dispatcher.validate_agent_task(agent_id, sublego_id):
                    print(f"[ArenaBridge] REJECT: Agent '{agent_id}' does not own Sub-LEGO '{sublego_id}'")
                    self.send_response(403)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error": "Agent does not own Sub-LEGO (fail-closed)"}')
                    return

                # Dual Distributed Locking with Strict Atomic Check & Rollback
                supabase.record_heartbeat(agent_id, status="WORKING", task_id=task_id)
                
                # Step 3A: Lock Sub-LEGO resource
                sublego_lock_ok = supabase.acquire_lock(
                    resource_id=sublego_id,
                    resource_type="sublego",
                    agent_id=agent_id,
                    task_id=task_id
                )
                if not sublego_lock_ok:
                    print(f"[ArenaBridge] REJECT: Sub-LEGO '{sublego_id}' lock acquisition failed (fail-closed)")
                    self.send_response(409)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error": "Sub-LEGO lock conflict or rejection (fail-closed)"}')
                    return

                # Step 3B: Lock Task Lease
                task_lock_ok = supabase.acquire_lock(
                    resource_id=f"task:{task_id}",
                    resource_type="task",
                    agent_id=agent_id,
                    task_id=task_id
                )
                if not task_lock_ok:
                    print(f"[ArenaBridge] REJECT: Task lease lock failed. Rolling back Sub-LEGO lock for '{sublego_id}'")
                    supabase.release_lock(sublego_id, agent_id=agent_id, task_id=task_id)
                    self.send_response(409)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error": "Task lease lock conflict or rejection; Sub-LEGO lock rolled back (fail-closed)"}')
                    return

                # Dispatch Job to Arena Executor Queue
                try:
                    job_id = dispatcher.dispatch_execution_job(
                        agent_id=agent_id,
                        task_id=task_id,
                        sublego_id=sublego_id,
                        command=command,
                        commit_sha=head_sha
                    )
                    dispatch_result.update({
                        "agent_id": agent_id,
                        "task_id": task_id,
                        "sublego_id": sublego_id,
                        "lego": parent_lego,
                        "commit_sha": head_sha,
                        "action": "enqueued_for_execution",
                        "job_id": job_id
                    })
                except Exception as e:
                    print(f"[ArenaBridge] Dispatch error: {e}. Initiating dual lock rollback!")
                    supabase.release_lock(f"task:{task_id}", agent_id=agent_id, task_id=task_id)
                    supabase.release_lock(sublego_id, agent_id=agent_id, task_id=task_id)
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": f"Dispatch error: {str(e)}; locks rolled back"}).encode("utf-8"))
                    return

            elif action == "closed":
                task_manifest = dispatcher.load_task_manifest(task_id, commit_sha=head_sha)
                sublego_id = task_manifest.get("sublego") if task_manifest else ""
                if sublego_id:
                    supabase.release_lock(sublego_id, agent_id=agent_id, task_id=task_id)
                supabase.release_lock(f"task:{task_id}", agent_id=agent_id, task_id=task_id)
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
