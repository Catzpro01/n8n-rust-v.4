"""
Output Sanitizer & Credential Redaction Engine.
Ensures no sensitive credentials, API keys, tokens, or webhook secrets ever leak into
Arena Manager's context, logs, tool return values, or error traces.
"""

import re
from typing import Any, Set

PATTERNS = [
    # GitHub PAT
    (re.compile(r"ghp_[A-Za-z0-9_]{20,}", re.IGNORECASE), "[REDACTED_GITHUB_TOKEN]"),
    # GitHub OAuth/App
    (re.compile(r"gh[oaprsu]_[A-Za-z0-9_]{20,}", re.IGNORECASE), "[REDACTED_GITHUB_TOKEN]"),
    # Telegram Bot Token (format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
    (re.compile(r"\b\d{8,12}:[A-Za-z0-9_-]{30,}\b"), "[REDACTED_TELEGRAM_TOKEN]"),
    # JWT Tokens (Supabase anon/service-role)
    (re.compile(r"eyJ[A-Za-z0-9-_=]{10,}\.eyJ[A-Za-z0-9-_=]{10,}\.[A-Za-z0-9-_.+/=]{10,}"), "[REDACTED_JWT_TOKEN]"),
    # Embedded URL basic auth: https://user:pass@domain.com
    (re.compile(r"https?://([^:/@\s]+):([^@/\s]+)@"), r"https://\1:[REDACTED]@"),
]

class Sanitizer:
    def __init__(self, known_secrets: Set[str] = None):
        self.known_secrets = set(known_secrets or [])

    def update_known_secrets(self, secrets: Set[str]):
        self.known_secrets.update(s for s in secrets if s and len(s) >= 4)

    def sanitize_string(self, text: str) -> str:
        if not text or not isinstance(text, str):
            return text

        # 1. Redact exact known secrets
        for secret in self.known_secrets:
            if secret in text:
                text = text.replace(secret, "[REDACTED_SECRET]")

        # 2. Redact matching regex patterns
        for pattern, replacement in PATTERNS:
            text = pattern.sub(replacement, text)

        return text

    def sanitize(self, data: Any) -> Any:
        """Recursively sanitizes dict, list, string, exception or primitive."""
        if isinstance(data, str):
            return self.sanitize_string(data)
        elif isinstance(data, dict):
            return {
                self.sanitize_string(str(k)): self.sanitize(v)
                for k, v in data.items()
                if not any(crit in str(k).lower() for crit in ["password", "secret", "token", "service_role_key"]) or (k == "status")
            }
        elif isinstance(data, (list, tuple, set)):
            sanitized_list = [self.sanitize(item) for item in data]
            if isinstance(data, tuple):
                return tuple(sanitized_list)
            elif isinstance(data, set):
                return set(sanitized_list)
            return sanitized_list
        elif isinstance(data, Exception):
            return self.sanitize_string(str(data))
        else:
            return data
