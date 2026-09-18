import hmac
import hashlib
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
try:
    from .config import PORT, GITHUB_WEBHOOK_SECRET
    from .supabase_adapter import SupabaseAdapter
    from .dispatcher import TaskDispatcher
except (ImportError, ValueError):
    from config import PORT, GITHUB_WEBHOOK_SECRET
    from supabase_adapter import SupabaseAdapter
    from dispatcher import TaskDispatcher

class ArenaWebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        # 1. Verify GitHub Webhook Signature (HMAC-SHA256)
        sig_header = self.headers.get("X-Hub-Signature-256", "")
        if sig_header:
            expected = "sha256=" + hmac.new(GITHUB_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig_header, expected):
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b"{\"error\": \"Invalid signature\"}")
                return

        # 2. Process payload
        try:
            payload = json.loads(body.decode()) if body else {}
        except Exception:
            payload = {}

        event_type = self.headers.get("X-GitHub-Event", "ping")
        print(f"[ArenaBridge] Received event: {event_type}")

        # Respond 200 OK
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        response = {"status": "accepted", "event": event_type}
        self.wfile.write(json.dumps(response).encode())

    def do_GET(self):
        # Health check
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b"{\"status\": \"healthy\", \"component\": \"arena-bridge\", \"port\": 9000}")

def run_server():
    server = HTTPServer(("127.0.0.1", PORT), ArenaWebhookHandler)
    print(f"[ArenaBridge] Running on http://127.0.0.1:{PORT}")
    server.serve_forever()

if __name__ == "__main__":
    run_server()
