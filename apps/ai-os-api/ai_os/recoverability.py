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


def _is_within(path: Path, root: Path) -> bool:
    resolved = path.resolve()
    resolved_root = root.resolve()
    return resolved == resolved_root or resolved_root in resolved.parents


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


def restore_file_action_snapshot(
    *,
    settings: Settings,
    storage: AppStorage,
    snapshot_id: str,
) -> dict[str, Any]:
    snapshot = storage.get_action_snapshot(snapshot_id)
    if not snapshot:
        raise KeyError(snapshot_id)
    if not snapshot.existed or not snapshot.snapshot_path:
        raise ValueError("Snapshot cannot be restored automatically because no previous file bytes were captured.")

    source_path = Path(snapshot.snapshot_path).resolve()
    snapshots_root = settings.resolved_action_snapshots_dir().resolve()
    if not _is_within(source_path, snapshots_root):
        raise ValueError("Snapshot file is outside the configured AI OS action snapshot directory.")
    if not source_path.exists() or not source_path.is_file():
        raise FileNotFoundError(f"Snapshot file is missing: {source_path}")

    target = Path(snapshot.target).resolve()
    pre_restore_snapshot = capture_file_pre_action_snapshot(
        settings=settings,
        storage=storage,
        source="action_snapshot_restore",
        action_type="action_snapshot.restore",
        target=target,
        content_type=snapshot.content_type,
        metadata={"restoring_snapshot_id": snapshot.id},
    )

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, target)
    size_bytes = target.stat().st_size

    return {
        "ok": True,
        "restored_snapshot": snapshot.model_dump(mode="json"),
        "pre_action_snapshot": pre_restore_snapshot.model_dump(mode="json"),
        "target": str(target),
        "bytes": size_bytes,
    }
