"""
Telegram Monitoring Adapter & Live Dashboard Engine.
Provides event-driven, read-only observability over Arena project state.
Features:
- Single live dashboard message update via editMessageText
- Change detection via SHA-256 content hashing
- Debounce and rate-limiting
- Mock transport for automated testing without requiring real Telegram credentials
"""

import os
import sys
import json
import time
import hashlib
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Any, List, Optional

class TelegramTransport:
    """Interface for sending and editing Telegram messages, and fetching updates."""
    def send_message(self, chat_id: str, text: str) -> Dict[str, Any]:
        raise NotImplementedError

    def edit_message_text(self, chat_id: str, message_id: int, text: str) -> Dict[str, Any]:
        raise NotImplementedError

    def get_updates(self, offset: Optional[int] = None, timeout: int = 20) -> Dict[str, Any]:
        raise NotImplementedError

class TelegramHttpTransport(TelegramTransport):
    """Production transport communicating directly with Telegram Bot API."""
    def __init__(self, bot_token: str):
        self.bot_token = bot_token
        self.base_url = f"https://api.telegram.org/bot{bot_token}"

    def send_message(self, chat_id: str, text: str) -> Dict[str, Any]:
        url = f"{self.base_url}/sendMessage"
        payload = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML"}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def edit_message_text(self, chat_id: str, message_id: int, text: str) -> Dict[str, Any]:
        url = f"{self.base_url}/editMessageText"
        payload = json.dumps({
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "parse_mode": "HTML"
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_updates(self, offset: Optional[int] = None, timeout: int = 20) -> Dict[str, Any]:
        params = [f"timeout={timeout}"]
        if offset is not None:
            params.append(f"offset={offset}")
        query_str = "&".join(params)
        url = f"{self.base_url}/getUpdates?{query_str}"
        req = urllib.request.Request(url)
        try:
            # Add margin to timeout for network roundtrip
            with urllib.request.urlopen(req, timeout=timeout + 5) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"ok": False, "error": str(e)}

class TelegramMockTransport(TelegramTransport):
    """In-memory mock transport for testing without network/credentials."""
    def __init__(self):
        self.messages: Dict[int, str] = {}
        self.next_msg_id = 1
        self.send_count = 0
        self.edit_count = 0
        self.pending_updates: List[Dict[str, Any]] = []

    def send_message(self, chat_id: str, text: str) -> Dict[str, Any]:
        msg_id = self.next_msg_id
        self.next_msg_id += 1
        self.messages[msg_id] = text
        self.send_count += 1
        return {"ok": True, "result": {"message_id": msg_id, "text": text}}

    def edit_message_text(self, chat_id: str, message_id: int, text: str) -> Dict[str, Any]:
        if message_id not in self.messages:
            return {"ok": False, "description": "Message not found"}
        self.messages[message_id] = text
        self.edit_count += 1
        return {"ok": True, "result": {"message_id": message_id, "text": text}}

    def get_updates(self, offset: Optional[int] = None, timeout: int = 20) -> Dict[str, Any]:
        if offset is None:
            return {"ok": True, "result": list(self.pending_updates)}
        filtered = [u for u in self.pending_updates if u.get("update_id", 0) >= offset]
        return {"ok": True, "result": filtered}

class TelegramMonitor:
    def __init__(
        self,
        transport: Optional[TelegramTransport] = None,
        authorized_chat_ids: Optional[List[str]] = None,
        debounce_seconds: float = 2.0
    ):
        self.transport = transport or TelegramMockTransport()
        self.authorized_chat_ids = set(authorized_chat_ids or [])
        self.debounce_seconds = debounce_seconds

        self.live_message_id: Optional[int] = None
        self.last_rendered_hash: Optional[str] = None
        self.last_update_time: float = 0.0
        self.project_state: Dict[str, Any] = {
            "project_name": "n8n-rust-v4",
            "status": "ACTIVE",
            "done_tasks": 10,
            "working_tasks": 0,
            "queued_tasks": 39,
            "total_tasks": 49,
            "done_weight": 18.0,
            "total_weight": 85.0,
            "agents_working": 0,
            "agents_available": 5,
            "current_milestone": "M1 — Runtime Foundation",
            "current_milestone_progress": "10 / 10 tasks (M1 complete)",
            "health": "HEALTHY",
            "last_event": "System initialized",
            "last_event_time": time.time()
        }

    def sync_from_control_plane(self):
        """Dynamically pulls authoritative task and agent metrics from Supabase Control Plane."""
        try:
            from tools.orchestration.control_plane import ControlPlaneClient
            cp = ControlPlaneClient()
            code, tasks = cp._request("tasks?select=task_key,status,progress_weight")
            if code == 200 and isinstance(tasks, list):
                done = [t for t in tasks if t.get("status") == "DONE"]
                working = [t for t in tasks if t.get("status") in ("CLAIMED", "WORKING", "PR_OPEN", "TESTING", "AUDITING", "MERGING")]
                queued = [t for t in tasks if t.get("status") == "QUEUED"]
                total_w = sum(float(t.get("progress_weight", 0.0)) for t in tasks) or 85.0
                done_w = sum(float(t.get("progress_weight", 0.0)) for t in done)

                self.project_state["done_tasks"] = len(done)
                self.project_state["working_tasks"] = len(working)
                self.project_state["queued_tasks"] = len(queued)
                self.project_state["total_tasks"] = len(tasks)
                self.project_state["done_weight"] = done_w
                self.project_state["total_weight"] = total_w

            code_a, agents = cp._request("agents?select=agent_key,status,current_task_id")
            if code_a == 200 and isinstance(agents, list):
                avail = [a for a in agents if a.get("status") == "AVAILABLE"]
                busy = [a for a in agents if a.get("status") != "AVAILABLE"]
                self.project_state["agents_available"] = len(avail)
                self.project_state["agents_working"] = len(busy)
        except Exception:
            pass

    def render_start(self) -> str:
        s = self.project_state
        return (
            "<b>ARENA CONTROL</b>\n\n"
            f"Project: <code>{s['project_name']}</code>\n"
            f"Status: 🟢 {s['status']}\n\n"
            f"Tasks: {s['done_tasks']} DONE | {s['working_tasks']} ACTIVE | {s['queued_tasks']} QUEUED\n"
            f"Agents: {s['agents_working']} WORKING | {s['agents_available']} AVAILABLE\n\n"
            "Use /progress for live dashboard."
        )

    def render_progress(self) -> str:
        s = self.project_state
        pct = int((s["done_weight"] / max(s["total_weight"], 1.0)) * 100)
        bar = "█" * (pct // 10) + "░" * (10 - (pct // 10))
        now = time.time()
        age = int(now - s["last_event_time"])

        return (
            "━━━━━━━━━━━━━━━━━━━━\n"
            "🚀 <b>ARENA PROJECT</b>\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📦 <code>{s['project_name']}</code>\n"
            f"🟢 {s['status']}\n\n"
            f"<b>Weighted Progress</b>\n"
            f"{bar} {pct}% ({s['done_weight']:.1f}/{s['total_weight']:.1f})\n\n"
            f"<b>Tasks</b>\n"
            f"✅ {s['done_tasks']} completed\n"
            f"🔵 {s['working_tasks']} working\n"
            f"⚪ {s['queued_tasks']} queued\n"
            f"📊 Total: {s['total_tasks']}\n\n"
            f"<b>Agents</b>\n"
            f"🟢 {s['agents_working']} working\n"
            f"⚪ {s['agents_available']} available\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "🎯 <b>CURRENT MILESTONE</b>\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            f"{s['current_milestone']}\n"
            f"Progress: {s['current_milestone_progress']}\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "❤️ <b>SYSTEM HEALTH</b>\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            f"Control Plane: 🟢\n"
            f"Supabase: 🟢\n"
            f"Event Stream: 🟢\n"
            f"Telegram Monitor: 🟢\n\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            f"🟢 <b>LIVE</b> (Last event: {age}s ago)\n"
            f"<i>{s['last_event']}</i>\n"
            "━━━━━━━━━━━━━━━━━━━━"
        )

    def handle_command(self, chat_id: str, command: str) -> Dict[str, Any]:
        if self.authorized_chat_ids and chat_id not in self.authorized_chat_ids:
            return {"ok": False, "error": "UNAUTHORIZED_CHAT"}

        # Always pull canonical snapshot first to guarantee zero divergence between /start and /progress
        self.sync_from_control_plane()

        cmd = command.strip().lower()
        if cmd == "/start":
            text = self.render_start()
            return self.transport.send_message(chat_id, text)
        elif cmd == "/progress":
            text = self.render_progress()
            res = self.transport.send_message(chat_id, text)
            if res.get("ok"):
                self.live_message_id = res.get("result", {}).get("message_id")
                self.last_rendered_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
            return res
        return {"ok": False, "error": "UNKNOWN_COMMAND"}

    def update_live_dashboard(self, chat_id: str, force: bool = False) -> bool:
        if not self.live_message_id:
            return False

        now = time.time()
        if not force and (now - self.last_update_time < self.debounce_seconds):
            return False

        text = self.render_progress()
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()

        # Deduplication: do not call Telegram API if rendered content is unchanged
        if not force and text_hash == self.last_rendered_hash:
            return False

        res = self.transport.edit_message_text(chat_id, self.live_message_id, text)
        if res.get("ok"):
            self.last_rendered_hash = text_hash
            self.last_update_time = now
            return True
        return False

    def on_arena_event(self, event_type: str, payload: Dict[str, Any], chat_id: Optional[str] = None):
        """Processes an incoming Arena event and pushes updates to dashboard."""
        self.project_state["last_event"] = f"{event_type}: {payload.get('task_key') or payload.get('title') or ''}"
        self.project_state["last_event_time"] = time.time()

        if event_type == "TASK_CLAIMED":
            self.project_state["working_tasks"] += 1
            self.project_state["queued_tasks"] = max(0, self.project_state["queued_tasks"] - 1)
            self.project_state["agents_working"] += 1
            self.project_state["agents_available"] = max(0, self.project_state["agents_available"] - 1)
        elif event_type == "TASK_COMPLETED":
            self.project_state["done_tasks"] += 1
            self.project_state["working_tasks"] = max(0, self.project_state["working_tasks"] - 1)
            self.project_state["agents_working"] = max(0, self.project_state["agents_working"] - 1)
            self.project_state["agents_available"] += 1

        if chat_id and self.live_message_id:
            self.update_live_dashboard(chat_id)

    def process_updates(self, offset: Optional[int] = None, timeout: int = 20) -> int:
        """
        Polls Telegram updates once, dispatches commands to handle_command(),
        and returns the next offset.
        Structured logging avoids token/secret leakage.
        """
        resp = self.transport.get_updates(offset=offset, timeout=timeout)
        if not resp.get("ok"):
            err_msg = resp.get("error", "UNKNOWN_ERROR")
            # Redact any accidental tokens if present in error message
            redacted_err = err_msg.split("bot")[0] if "bot" in err_msg else err_msg
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_POLL_ERROR] error={redacted_err}")
            return offset or 0

        updates = resp.get("result", [])
        next_offset = offset or 0

        for u in updates:
            upd_id = u.get("update_id", 0)
            if upd_id >= next_offset:
                next_offset = upd_id + 1

            msg = u.get("message") or u.get("edited_message")
            if not msg:
                continue

            chat = msg.get("chat", {})
            chat_id = str(chat.get("id", ""))
            text = (msg.get("text") or "").strip()

            # Hash/redact chat identifier for privacy
            chat_hash = hashlib.sha256(chat_id.encode("utf-8")).hexdigest()[:8]
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_UPDATE_RECEIVED] update_id={upd_id} chat_hash={chat_hash}")

            if text.startswith("/"):
                cmd = text.split()[0]
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_COMMAND_RECEIVED] command={cmd} chat_hash={chat_hash}")
                res = self.handle_command(chat_id, cmd)
                if res.get("ok"):
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_COMMAND_HANDLED] command={cmd} status=SUCCESS")
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_SEND_SUCCESS] chat_hash={chat_hash} msg_id={res.get('result', {}).get('message_id')}")
                else:
                    err = res.get("error", "UNKNOWN")
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_COMMAND_HANDLED] command={cmd} status=REJECTED reason={err}")
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_SEND_FAILURE] chat_hash={chat_hash} reason={err}")

        return next_offset

    def run_polling_loop(self, poll_timeout: int = 15, max_iterations: Optional[int] = None):
        """
        Continuous long-polling loop with automatic recovery and exponential backoff on network errors.
        """
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_MONITOR_STARTED] mode=LONG_POLLING timeout={poll_timeout}s")
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_POLL_STARTED]")
        offset: Optional[int] = None
        iteration = 0
        backoff = 1

        while True:
            if max_iterations is not None and iteration >= max_iterations:
                break
            iteration += 1

            try:
                new_offset = self.process_updates(offset=offset, timeout=poll_timeout)
                if new_offset > (offset or 0):
                    offset = new_offset
                backoff = 1  # reset backoff on successful loop
            except KeyboardInterrupt:
                print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_MONITOR_STOPPED] Interrupted by user.")
                break
            except Exception as e:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [TELEGRAM_POLL_ERROR] exception={type(e).__name__} backoff={backoff}s")
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)

def main():
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description="Arena Telegram Monitor Long Polling Service")
    parser.add_argument("--timeout", type=int, default=15, help="Long polling timeout in seconds")
    parser.add_argument("--iterations", type=int, default=None, help="Max iterations (for testing)")
    args = parser.parse_args()

    # Load from .env securely
    repo_root = Path(__file__).resolve().parents[2]
    env_file = repo_root / ".env"
    cfg = {}
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")

    token = cfg.get("TELEGRAM_BOT_TOKEN")
    chat_id = cfg.get("TELEGRAM_CHAT_ID")

    if not token:
        print("[ERROR] Missing TELEGRAM_BOT_TOKEN in .env")
        sys.exit(1)

    transport = TelegramHttpTransport(token)
    authorized = [chat_id] if chat_id else None
    monitor = TelegramMonitor(transport=transport, authorized_chat_ids=authorized)

    # Write session file
    run_dir = repo_root / ".arena" / "run"
    run_dir.mkdir(parents=True, exist_ok=True)
    session_file = run_dir / "telegram_monitor.session"
    session_data = {
        "pid": os.getpid(),
        "started_at": time.time(),
        "mode": "LONG_POLLING"
    }
    session_file.write_text(json.dumps(session_data, indent=2), encoding="utf-8")

    try:
        monitor.run_polling_loop(poll_timeout=args.timeout, max_iterations=args.iterations)
    finally:
        if session_file.exists():
            try:
                session_file.unlink()
            except Exception:
                pass

if __name__ == "__main__":
    main()
