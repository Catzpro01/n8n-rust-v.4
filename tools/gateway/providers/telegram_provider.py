"""
Telegram Capability Provider for Arena Manager Gateway.
Allows Arena Manager to send notification updates, alerts, summaries,
and interact with Telegram groups/channels without exposing bot tokens or chat secrets.
"""

import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional
from tools.gateway.vault import SecretVault
from tools.gateway.sanitizer import Sanitizer

class TelegramProvider:
    def __init__(self, vault: SecretVault, sanitizer: Sanitizer):
        self.vault = vault
        self.sanitizer = sanitizer

    def _get_creds(self):
        token = self.vault.get("TELEGRAM_BOT_TOKEN")
        chat_id = self.vault.get("TELEGRAM_CHAT_ID")
        if not token:
            raise RuntimeError("Telegram bot token not available in vault")
        return token, chat_id

    def _api_call(self, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        token, _ = self._get_creds()
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
            - chat_id: Optional[str] (defaults to vault TELEGRAM_CHAT_ID)
            - parse_mode: Optional[str] (e.g. 'Markdown', 'HTML')
        """
        text = params.get("text")
        if not text:
            raise ValueError("Parameter 'text' is required")

        _, default_chat_id = self._get_creds()
        target_chat = params.get("chat_id") or default_chat_id
        if not target_chat:
            raise ValueError("Parameter 'chat_id' is required and not set in vault")

        payload = {
            "chat_id": target_chat,
            "text": text,
        }
        if "parse_mode" in params:
            payload["parse_mode"] = params["parse_mode"]

        res = self._api_call("sendMessage", payload)
        return {
            "ok": res.get("ok", False),
            "message_id": res.get("result", {}).get("message_id"),
            "recipient": target_chat
        }

    def get_updates(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Gets recent updates from the bot.
        params:
            - limit: Optional[int]
            - offset: Optional[int]
        """
        payload = {}
        if "limit" in params:
            payload["limit"] = params["limit"]
        if "offset" in params:
            payload["offset"] = params["offset"]

        res = self._api_call("getUpdates", payload)
        return {
            "ok": res.get("ok", False),
            "updates_count": len(res.get("result", []))
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
