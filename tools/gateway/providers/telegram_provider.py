"""
Telegram Capability Provider for Arena Manager Gateway.
Allows Arena Manager to send notification updates, alerts, summaries,
and interact with Telegram groups/channels without exposing bot tokens or chat secrets.
Supports both live Telegram Bot API execution and offline/dry-run logging for tests and sandboxes.
"""

import os
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer

class TelegramProvider:
    def __init__(self, vault: SecretVault, sanitizer: Sanitizer, log_dir: Optional[Path] = None):
        self.vault = vault
        self.sanitizer = sanitizer
        self.log_dir = log_dir or (Path(__file__).resolve().parents[3] / ".arena" / "logs")
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.outbox_file = self.log_dir / "telegram_outbox.jsonl"

    def _get_creds(self) -> Tuple[Optional[str], Optional[str]]:
        token = self.vault.get("TELEGRAM_BOT_TOKEN")
        chat_id = self.vault.get("TELEGRAM_CHAT_ID")
        return token, chat_id

    def _has_creds(self) -> bool:
        token, _ = self._get_creds()
        return bool(token)

    def _api_call(self, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        token, _ = self._get_creds()
        if not token:
            raise RuntimeError("Telegram bot token not available in vault")

        url = f"https://api.telegram.org/bot{token}/{method}"
        headers = {"Content-Type": "application/json"}
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
                res = json.loads(raw)
                return self.sanitizer.sanitize(res)
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8")
            raise RuntimeError(f"Telegram API Error ({e.code}): {self.sanitizer.sanitize_string(err)}")
        except Exception as ex:
            raise RuntimeError(f"Telegram Network Error: {self.sanitizer.sanitize_string(str(ex))}")

    def send_message(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sends a message via Telegram.
        params:
            - text: str (message content)
            - chat_id: Optional[str] (defaults to vault TELEGRAM_CHAT_ID or 'arena-notifications')
            - parse_mode: Optional[str] (e.g. 'Markdown', 'HTML')
            - dry_run: Optional[bool]
        """
        text = params.get("text")
        if not text:
            raise ValueError("Parameter 'text' is required")

        token, default_chat_id = self._get_creds()
        target_chat = params.get("chat_id") or default_chat_id or "arena-notifications"
        dry_run = params.get("dry_run", False) or not self._has_creds()

        # Sanitize text before sending/logging
        clean_text = self.sanitizer.sanitize_string(text)

        if not dry_run and self._has_creds():
            payload = {
                "chat_id": target_chat,
                "text": clean_text,
            }
            if "parse_mode" in params:
                payload["parse_mode"] = params["parse_mode"]

            res = self._api_call("sendMessage", payload)
            return {
                "ok": res.get("ok", False),
                "message_id": res.get("result", {}).get("message_id"),
                "recipient": target_chat,
                "status": "DELIVERED"
            }
        else:
            # Record in offline outbox
            entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "recipient": target_chat,
                "text": clean_text,
                "parse_mode": params.get("parse_mode", "plain"),
                "mode": "MOCK_DISPATCH"
            }
            with open(self.outbox_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")

            return {
                "ok": True,
                "message_id": 9901,
                "recipient": target_chat,
                "status": "DELIVERED_MOCK",
                "dry_run": True
            }

    def get_updates(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Gets recent updates from the bot.
        params:
            - limit: Optional[int]
            - offset: Optional[int]
        """
        params = params or {}
        if self._has_creds():
            payload = {}
            if "limit" in params:
                payload["limit"] = params["limit"]
            if "offset" in params:
                payload["offset"] = params["offset"]

            res = self._api_call("getUpdates", payload)
            return {
                "ok": res.get("ok", False),
                "updates_count": len(res.get("result", [])),
                "updates": self.sanitizer.sanitize(res.get("result", []))
            }
        else:
            return {
                "ok": True,
                "updates_count": 0,
                "updates": [],
                "status": "MOCK_EMPTY"
            }

    def render_dashboard(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Formats and broadcasts an orchestration dashboard status to Telegram.
        params:
            - title: str
            - metrics: Dict[str, Any]
            - status: str (e.g. 'INFO', 'WARN', 'SUCCESS')
        """
        title = params.get("title", "ARENA STATUS DASHBOARD")
        status = params.get("status", "INFO")
        metrics = params.get("metrics", {})

        body_lines = [f"📊 *{title}* [{status}]", ""]
        for k, v in metrics.items():
            body_lines.append(f"• *{k}*: `{v}`")

        msg_text = "\n".join(body_lines)
        return self.send_message({"text": msg_text, "parse_mode": "Markdown"})
