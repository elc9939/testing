from __future__ import annotations

import re
from typing import Any

MEDIA_PAYLOAD_KEYS = {"image_base64", "audio_base64", "video_base64", "b64_json"}
_BASE64ISH = re.compile(r"^[A-Za-z0-9+/=\s_-]+$")


def compact_large_payloads(value: Any, *, max_string: int = 2048, max_items: int = 20) -> Any:
    """Return JSON-safe data with oversized inline media payloads redacted."""
    if isinstance(value, dict):
        compacted: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = str(key).lower()
            if normalized_key in MEDIA_PAYLOAD_KEYS and isinstance(item, str):
                compacted[key] = _redacted_payload(item, normalized_key)
            else:
                compacted[key] = compact_large_payloads(item, max_string=max_string, max_items=max_items)
        return compacted
    if isinstance(value, list):
        compacted_items = [compact_large_payloads(item, max_string=max_string, max_items=max_items) for item in value[:max_items]]
        if len(value) > max_items:
            compacted_items.append({"_truncated_items": len(value) - max_items})
        return compacted_items
    if isinstance(value, str) and _should_redact_string(value, max_string=max_string):
        return _redacted_payload(value, "string")
    return value


def _should_redact_string(value: str, *, max_string: int) -> bool:
    if len(value) <= max_string:
        return False
    if len(value) > 50_000:
        return True
    return bool(_BASE64ISH.fullmatch(value[: max_string + 1]))


def _redacted_payload(value: str, kind: str) -> str:
    return f"<redacted {kind} payload: {len(value)} chars>"
