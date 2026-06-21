from __future__ import annotations

import mimetypes
import re
import shutil
from pathlib import Path
from typing import Any

from .config import Settings
from .models import ActionSnapshotRecord, new_id
from .storage import AppStorage


def _safe_snapshot_name(snapshot_id: str, target: Path) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", target.name).strip("._-") or "target"
    return f"{snapshot_id}-{safe_name}"


def capture_file_pre_action_snapshot(
    *,
    settings: Settings,
    storage: AppStorage,
    source: str,
    action_type: str,
    target: Path,
    content_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ActionSnapshotRecord:
    resolved_target = target.resolve()
    snapshot_id = new_id("snapshot")
    existed = resolved_target.exists()
    snapshot_path: str | None = None
    size_bytes: int | None = None
    detected_content_type = content_type or mimetypes.guess_type(str(resolved_target))[0] or "application/octet-stream"

    if existed:
        if not resolved_target.is_file():
            raise ValueError(f"Cannot snapshot non-file target: {resolved_target}")
        snapshot_dir = settings.resolved_action_snapshots_dir() / re.sub(r"[^A-Za-z0-9._-]+", "-", action_type)
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        destination = snapshot_dir / _safe_snapshot_name(snapshot_id, resolved_target)
        shutil.copy2(resolved_target, destination)
        snapshot_path = str(destination)
        size_bytes = destination.stat().st_size

    return storage.log_action_snapshot(
        snapshot_id=snapshot_id,
        source=source,
        action_type=action_type,
        target=str(resolved_target),
        content_type=detected_content_type,
        existed=existed,
        snapshot_path=snapshot_path,
        size_bytes=size_bytes,
        metadata=metadata or {},
    )
