from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
from typing import Any

from .config import Settings

CONFIGURED_ATTR = "_ai_os_logging_configured"
SENSITIVE_WORDS = ("api_key", "authorization", "bearer ", "refresh_token", "access_token", "secret", "password")


def redact(value: Any) -> Any:
    if isinstance(value, str):
        lowered = value.lower()
        if any(word in lowered for word in SENSITIVE_WORDS):
            return "[redacted]"
        return value
    if isinstance(value, dict):
        return {key: ("[redacted]" if any(word in key.lower() for word in SENSITIVE_WORDS) else redact(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


class JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key.startswith("_") or key in {
                "args",
                "asctime",
                "created",
                "exc_info",
                "exc_text",
                "filename",
                "funcName",
                "levelname",
                "levelno",
                "lineno",
                "module",
                "msecs",
                "message",
                "msg",
                "name",
                "pathname",
                "process",
                "processName",
                "relativeCreated",
                "stack_info",
                "thread",
                "threadName",
            }:
                continue
            payload[key] = redact(value)
        if record.exc_info:
            payload["exception"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


def setup_logging(settings: Settings) -> None:
    root = logging.getLogger()
    if getattr(root, CONFIGURED_ATTR, False):
        return
    log_dir = settings.resolved_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    root.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))

    file_handler = RotatingFileHandler(
        log_dir / "ai-os.jsonl",
        maxBytes=max(100_000, settings.log_max_bytes),
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(JsonLineFormatter())
    root.addHandler(file_handler)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(console_handler)
    setattr(root, CONFIGURED_ATTR, True)
