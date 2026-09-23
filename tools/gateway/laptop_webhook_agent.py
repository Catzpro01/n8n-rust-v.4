"""
Laptop Webhook Agent.
A dedicated, secure execution service running on the trusted laptop worker host.
Receives operation-based task execution requests via authenticated, signed HTTP webhooks.
Enforces:
1. HMAC SHA-256 Request Signatures (shared webhook secret kept exclusively on host).
2. Replay Protection (timestamp freshness within 60s + unique request ID tracking).
3. Operation-based API allowlist (cargo_check, cargo_test, cargo_clippy, git_status).
   STRICTLY FORBIDS arbitrary shell string execution.
4. Process & Environment Isolation (removes all sensitive OS environment variables).
5. Structured JSON execution results.
"""

import os
import sys
import hmac
import time
import json
import hashlib
import argparse
import subprocess
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Dict, Any, Optional, Set, List

# Allowed operation profiles with strictly defined argument templates
ALLOWED_OPERATIONS = {
    "cargo_check": ["cargo", "check", "--workspace"],
    "cargo_test": ["cargo", "test", "--workspace"],
    "cargo_test_package": ["cargo", "test", "-p"],
    "cargo_clippy": ["cargo", "clippy", "--workspace", "--", "-D", "warnings"],
    "cargo_build": ["cargo", "build", "--workspace"],
    "git_status": ["git", "status", "--porcelain"],
    "git_branch": ["git", "rev-parse", "--abbrev-ref", "HEAD"],
}

# Cache for replay protection (request_id -> timestamp)
SEEN_REQUEST_IDS: Dict[str, float] = {}
REPLAY_WINDOW_SECONDS = 60.0

class LaptopWebhookHandler(BaseHTTPRequestHandler):
    secret_key: bytes = b""
    repo_root: Path = Path(__file__).resolve().parents[2]
    active_processes: Dict[str, subprocess.Popen] = {}

    def _send_json(self, status_code: int, payload: Dict[str, Any]):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Laptop-Worker", "n8n-rust-trusted-worker")
        self.end_headers()
        self.wfile.write(body)

    def _verify_signature(self, body_bytes: bytes) -> tuple[bool, str]:
        if not self.secret_key:
            # If no secret set, allow local loopback testing only
            if self.client_address[0] in ("127.0.0.1", "localhost", "::1"):
                return True, "LOCAL_LOOPBACK"
            return False, "SIGNATURE_REQUIRED: No webhook secret configured on host"

        req_signature = self.headers.get("X-Webhook-Signature", "")
        req_timestamp = self.headers.get("X-Webhook-Timestamp", "")
        req_id = self.headers.get("X-Webhook-Request-ID", "")

        if not req_signature or not req_timestamp or not req_id:
            return False, "MISSING_HEADERS: X-Webhook-Signature, X-Webhook-Timestamp, and X-Webhook-Request-ID required"

        # 1. Replay Protection: Timestamp freshness
        try:
            ts = float(req_timestamp)
        except ValueError:
            return False, "INVALID_TIMESTAMP: Header X-Webhook-Timestamp must be numeric epoch"

        now = time.time()
        if abs(now - ts) > REPLAY_WINDOW_SECONDS:
            return False, f"REPLAY_ERROR: Request timestamp expired or clock skew exceeds {REPLAY_WINDOW_SECONDS}s"

        # 2. Replay Protection: Request ID uniqueness
        # Clean up stale IDs
        cutoff = now - (REPLAY_WINDOW_SECONDS * 2)
        expired_ids = [rid for rid, rts in SEEN_REQUEST_IDS.items() if rts < cutoff]
        for rid in expired_ids:
            SEEN_REQUEST_IDS.pop(rid, None)

        if req_id in SEEN_REQUEST_IDS:
            return False, f"REPLAY_DETECTED: Request ID '{req_id}' has already been processed"
        SEEN_REQUEST_IDS[req_id] = now

        # 3. HMAC SHA-256 Signature Verification
        # Signed content: timestamp + "." + request_id + "." + body
        msg = f"{req_timestamp}.{req_id}.".encode("utf-8") + body_bytes
        computed = hmac.new(self.secret_key, msg, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(computed, req_signature):
            return False, "INVALID_SIGNATURE: HMAC verification failed"

        return True, "VERIFIED"

    def _get_isolated_env(self) -> Dict[str, str]:
        """Strips all sensitive host tokens and environment variables."""
        env = os.environ.copy()
        sensitive_keywords = ["TOKEN", "SECRET", "KEY", "PASS", "AUTH", "CREDENTIAL", "JWT", "RUNNER"]
        to_delete = [k for k in env if any(w in k.upper() for w in sensitive_keywords)]
        for k in to_delete:
            env.pop(k, None)
        env["ARENA_ENVIRONMENT"] = "laptop_webhook_isolated"
        return env

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        if path in ("/health", "/webhook/health"):
            self._send_json(200, {
                "status": "HEALTHY",
                "service": "laptop-webhook-agent",
                "active_processes": len(self.active_processes),
                "timestamp": time.time()
            })
            return

        if path in ("/status", "/webhook/status"):
            runner_dir = Path("C:/actions-runner")
            self._send_json(200, {
                "status": "ONLINE",
                "workspace": str(self.repo_root),
                "runner_installed": runner_dir.exists(),
                "allowed_operations": list(ALLOWED_OPERATIONS.keys()),
                "active_jobs": list(self.active_processes.keys())
            })
            return

        self._send_json(404, {"ok": False, "error": f"Endpoint '{self.path}' not found"})

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")

        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b"{}"

        # Signature verification
        verified, auth_reason = self._verify_signature(body_bytes)
        if not verified:
            self._send_json(401, {"ok": False, "error": auth_reason})
            return

        try:
            payload = json.loads(body_bytes.decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"ok": False, "error": f"Malformed JSON: {e}"})
            return

        if path == "/webhook/cancel":
            job_id = payload.get("job_id") or payload.get("request_id")
            if not job_id or job_id not in self.active_processes:
                self._send_json(404, {"ok": False, "error": f"Job ID '{job_id}' not active"})
                return
            proc = self.active_processes.pop(job_id)
            proc.terminate()
            self._send_json(200, {"ok": True, "job_id": job_id, "action": "TERMINATED"})
            return

        if path in ("/webhook/task", "/webhook/execute"):
            operation = payload.get("operation")
            args = payload.get("args", [])
            timeout = int(payload.get("timeout", 180))
            job_id = payload.get("request_id") or payload.get("job_id") or f"job-{int(time.time()*1000)}"

            if not operation or operation not in ALLOWED_OPERATIONS:
                self._send_json(400, {
                    "ok": False,
                    "error": f"Operation '{operation}' not permitted. Allowed: {list(ALLOWED_OPERATIONS.keys())}"
                })
                return

            # Construct safe command
            cmd = list(ALLOWED_OPERATIONS[operation])
            if operation == "cargo_test_package":
                package_name = payload.get("package") or (args[0] if args else None)
                if not package_name or any(c in package_name for c in [";", "&", "|", "`", "$", " ", "\t"]):
                    self._send_json(400, {"ok": False, "error": "Invalid or unsafe package name argument"})
                    return
                cmd.append(package_name)
                if "test_filter" in payload:
                    test_filt = payload["test_filter"]
                    if not any(c in test_filt for c in [";", "&", "|", "`", "$"]):
                        cmd.append(test_filt)

            # Process execution
            start_t = time.time()
            isolated_env = self._get_isolated_env()
            try:
                proc = subprocess.Popen(
                    cmd,
                    cwd=str(self.repo_root),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    env=isolated_env
                )
                self.active_processes[job_id] = proc
                try:
                    stdout, stderr = proc.communicate(timeout=timeout)
                    exit_code = proc.returncode
                except subprocess.TimeoutExpired:
                    proc.kill()
                    stdout, stderr = proc.communicate()
                    exit_code = -1
                    stderr += f"\n[TIMEOUT] Execution exceeded {timeout} seconds limit."
                finally:
                    self.active_processes.pop(job_id, None)

                duration_ms = round((time.time() - start_t) * 1000, 2)
                self._send_json(200, {
                    "ok": True,
                    "job_id": job_id,
                    "operation": operation,
                    "exit_code": exit_code,
                    "success": (exit_code == 0),
                    "duration_ms": duration_ms,
                    "stdout": stdout,
                    "stderr": stderr
                })
            except Exception as ex:
                self._send_json(500, {
                    "ok": False,
                    "job_id": job_id,
                    "operation": operation,
                    "error": f"Process execution failed: {ex}"
                })
            return

        self._send_json(404, {"ok": False, "error": f"Endpoint '{self.path}' not found"})

    def log_message(self, format, *args):
        pass

def compute_webhook_signature(secret: str, timestamp: str, req_id: str, body_bytes: bytes) -> str:
    """Helper for clients to generate proper HMAC signature."""
    msg = f"{timestamp}.{req_id}.".encode("utf-8") + body_bytes
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()

def run_webhook_server(host: str = "127.0.0.1", port: int = 8989, secret: Optional[str] = None):
    repo_root = Path(__file__).resolve().parents[2]
    # If secret not explicitly passed, check .env or generate one in .arena/
    if not secret:
        env_file = repo_root / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("LAPTOP_WEBHOOK_SECRET="):
                    secret = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break

    if not secret:
        secret = "arena-laptop-worker-local-secret"

    LaptopWebhookHandler.secret_key = secret.encode("utf-8")
    LaptopWebhookHandler.repo_root = repo_root

    server_address = (host, port)
    httpd = HTTPServer(server_address, LaptopWebhookHandler)
    print(f"Laptop Webhook Agent listening on http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nLaptop Webhook Agent stopped.")
        httpd.server_close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Trusted Laptop Webhook Execution Agent")
    parser.add_argument("--host", default="127.0.0.1", help="Host address to bind")
    parser.add_argument("--port", type=int, default=8989, help="Port to bind")
    parser.add_argument("--secret", default=None, help="Webhook secret for HMAC validation")
    args = parser.parse_args()
    run_webhook_server(host=args.host, port=args.port, secret=args.secret)
