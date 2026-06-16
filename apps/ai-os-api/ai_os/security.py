from __future__ import annotations

from collections.abc import Mapping
import ipaddress
from pathlib import Path
from typing import Any

SENSITIVE_FRAGMENTS = ("key", "secret", "token", "password", "authorization", "credential")


def redact_mapping(values: Mapping[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in values.items():
        lowered = key.lower()
        if any(fragment in lowered for fragment in SENSITIVE_FRAGMENTS):
            redacted[key] = "[redacted]" if value else None
        elif isinstance(value, Mapping):
            redacted[key] = redact_mapping(value)
        elif isinstance(value, Path):
            redacted[key] = str(value)
        else:
            redacted[key] = value
    return redacted


def redact_text(value: str) -> str:
    result = value
    for marker in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_OS_ADMIN_TOKEN", "MINI_HUB_SYNC_KEY"):
        result = result.replace(marker, f"{marker[:4]}...")
    return result


def is_loopback_host(host: str) -> bool:
    normalized = host.strip().lower().removeprefix("[").removesuffix("]")
    if normalized in {"localhost", "testclient"}:
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False
