from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from .config import Settings
from .models import new_id, now_iso


def _safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("._-") or "target"


def _directory_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            total += item.stat().st_size
    return total


def capture_path_snapshot(
    *,
    settings: Settings,
    action_type: str,
    target: Path,
    role: str,
) -> dict[str, Any]:
    resolved = target.resolve()
    snapshot_id = new_id("macro_snapshot")
    exists = resolved.exists()
    record: dict[str, Any] = {
        "id": snapshot_id,
        "created_at": now_iso(),
        "action_type": action_type,
        "role": role,
        "target": str(resolved),
        "existed": exists,
        "snapshot_path": None,
        "path_type": "missing",
        "size_bytes": 0,
    }
    if not exists:
        return record

    snapshot_dir = settings.resolved_action_snapshots_dir() / _safe_name(action_type)
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    destination = snapshot_dir / f"{snapshot_id}-{_safe_name(resolved.name)}"
    if resolved.is_dir():
        shutil.copytree(resolved, destination)
        record["path_type"] = "directory"
        record["size_bytes"] = _directory_size(destination)
    elif resolved.is_file():
        shutil.copy2(resolved, destination)
        record["path_type"] = "file"
        record["size_bytes"] = destination.stat().st_size
    else:
        raise ValueError(f"Cannot snapshot unsupported filesystem target: {resolved}")
    record["snapshot_path"] = str(destination)
    return record


def recovery_payload(
    *,
    kind: str,
    description: str,
    snapshots: list[dict[str, Any]] | None = None,
    inverse_operations: list[dict[str, str]] | None = None,
    reversible: bool = False,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "description": description,
        "snapshots": snapshots or [],
        "inverse_operations": inverse_operations or [],
        "reversible": reversible,
    }
