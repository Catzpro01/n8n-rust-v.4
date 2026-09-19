"""
HTTP Server Interface for Capability Gateway.
Runs a lightweight, standalone daemon allowing Arena Manager and Worker Agents
to invoke capabilities via REST API completely independent of Antigravity:
    POST /api/v1/invoke
    GET  /api/v1/capabilities
    GET  /api/v1/health

Headers:
    Authorization: Bearer <GATEWAY_TOKEN>
    X-Caller-ID: <arena-manager | arena-agent-worker-N>
"""

import sys
import os
import json
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional

from tools.gateway.gateway import CapabilityGateway

gateway_instance: Optional[CapabilityGateway] = None

class GatewayHTTPRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Gateway-Version", "1.7.0")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global gateway_instance
        path = self.path.split("?")[0].rstrip("/")

        if path == "/api/v1/health" or path == "/health":
            self._send_json(200, {"status": "HEALTHY", "version": "1.7.0"})
            return

        if path == "/api/v1/capabilities":
            catalog = gateway_instance.discover_capabilities()
            self._send_json(200, catalog)
            return

        self._send_json(404, {"ok": False, "error": f"Endpoint '{self.path}' not found"})

    def do_POST(self):
        global gateway_instance
        path = self.path.split("?")[0].rstrip("/")

        if path != "/api/v1/invoke":
            self._send_json(404, {"ok": False, "error": f"Endpoint '{self.path}' not found"})
            return

        # Read bearer token
        auth_header = self.headers.get("Authorization", "")
        bearer_token = None
        if auth_header.startswith("Bearer "):
            bearer_token = auth_header[7:].strip()

        caller_id = self.headers.get("X-Caller-ID", "").strip()

        # Parse request body
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len == 0:
            self._send_json(400, {"ok": False, "error": "Missing JSON request body"})
            return

        try:
            body_raw = self.rfile.read(content_len).decode("utf-8")
            payload = json.loads(body_raw)
        except Exception as e:
            self._send_json(400, {"ok": False, "error": f"Malformed JSON: {e}"})
            return

        # Allow caller_id in body if not in header
        caller_id = caller_id or payload.get("caller_id") or payload.get("caller")
        capability = payload.get("capability")
        params = payload.get("params", {})
        task_id = payload.get("task_id")
        bearer_token = bearer_token or payload.get("token") or payload.get("gateway_token")

        if not caller_id or not capability:
            self._send_json(400, {"ok": False, "error": "Fields 'caller_id' and 'capability' are required"})
            return

        # Invoke gateway
        res = gateway_instance.invoke(
            caller_id=caller_id,
            capability=capability,
            params=params,
            task_id=task_id,
            bearer_token=bearer_token
        )

        status_code = 200 if res.get("ok") else (403 if not res.get("authorized") else 400)
        self._send_json(status_code, res)

    def log_message(self, format, *args):
        # Suppress standard logging to prevent noise
        pass

def run_server(host: Optional[str] = None, port: Optional[int] = None):
    global gateway_instance
    gateway_instance = CapabilityGateway()

    bind_host = host or os.environ.get("GATEWAY_HOST", "0.0.0.0")
    bind_port = int(port or os.environ.get("GATEWAY_PORT", 8787))

    server_address = (bind_host, bind_port)
    httpd = HTTPServer(server_address, GatewayHTTPRequestHandler)
    print(f"Arena Manager Capability Gateway v1.7 listening on http://{bind_host}:{bind_port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nGateway HTTP server stopped.")
        httpd.server_close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Arena Manager Capability Gateway Daemon")
    parser.add_argument("--host", default=None, help="Host address to bind (defaults to GATEWAY_HOST or 0.0.0.0)")
    parser.add_argument("--port", type=int, default=None, help="Port to bind (defaults to GATEWAY_PORT or 8787)")
    args = parser.parse_args()
    run_server(host=args.host, port=args.port)
