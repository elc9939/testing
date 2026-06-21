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


def restore_run_file_artifacts(*, settings: Settings, run: dict[str, Any]) -> dict[str, Any]:
    artifacts = _run_recovery_artifacts(run)
    if not artifacts:
        raise ValueError("Run does not contain file recovery metadata.")

    applied: list[dict[str, Any]] = []
    pre_restore_snapshots: list[dict[str, Any]] = []
    errors: list[str] = []

    for artifact in reversed(artifacts):
        snapshots = [snapshot for snapshot in artifact.get("snapshots", []) if isinstance(snapshot, dict)]
        snapshots_by_id = {str(snapshot.get("id")): snapshot for snapshot in snapshots if snapshot.get("id")}
        operations = [operation for operation in artifact.get("inverse_operations", []) if isinstance(operation, dict)]

        for operation in reversed(operations):
            try:
                applied.append(_apply_inverse_operation(settings, operation, snapshots_by_id, pre_restore_snapshots))
            except Exception as error:
                errors.append(f"{operation.get('operation', 'unknown')}: {error}")
                raise

        for snapshot in snapshots:
            if snapshot.get("role") != "pre_existing_target" or not snapshot.get("snapshot_path"):
                continue
            target = Path(str(snapshot.get("target") or ""))
            try:
                pre_restore_snapshots.append(
                    capture_path_snapshot(
                        settings=settings,
                        action_type="macro.restore",
                        target=target,
                        role="pre_restore_target",
                    )
                )
                _restore_snapshot_to_target(settings, snapshot, target)
                applied.append({"operation": "restore_pre_existing_target", "target": str(target.resolve()), "snapshot_id": snapshot.get("id")})
            except Exception as error:
                errors.append(f"restore_pre_existing_target: {error}")
                raise

    return {
        "ok": True,
        "restored_run_id": run["id"],
        "restored_macro_name": run.get("macro_name"),
        "applied": applied,
        "pre_restore_snapshots": pre_restore_snapshots,
        "errors": errors,
        "recoverability": recovery_payload(
            kind="snapshot" if pre_restore_snapshots else "artifact",
            description="Restore run recorded pre-restore snapshots for targets it changed.",
            snapshots=pre_restore_snapshots,
            inverse_operations=[],
            reversible=any(snapshot.get("snapshot_path") for snapshot in pre_restore_snapshots),
        ),
    }


def _run_recovery_artifacts(run: dict[str, Any]) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for step in run.get("steps", []):
        if not isinstance(step, dict):
            continue
        detail = step.get("detail")
        if not isinstance(detail, dict):
            continue
        recoverability = detail.get("recoverability")
        if isinstance(recoverability, dict) and recoverability.get("reversible"):
            artifacts.append(recoverability)
    return artifacts


def _apply_inverse_operation(
    settings: Settings,
    operation: dict[str, Any],
    snapshots_by_id: dict[str, dict[str, Any]],
    pre_restore_snapshots: list[dict[str, Any]],
) -> dict[str, Any]:
    kind = str(operation.get("operation") or "")
    if kind == "move":
        source = Path(str(operation["source"])).resolve()
        target = Path(str(operation["target"])).resolve()
        if target.exists():
            pre_restore_snapshots.append(capture_path_snapshot(settings=settings, action_type="macro.restore", target=target, role="pre_restore_target"))
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))
        return {"operation": "move", "source": str(source), "target": str(target)}
    if kind == "delete":
        path = Path(str(operation["path"])).resolve()
        if path.exists():
            pre_restore_snapshots.append(capture_path_snapshot(settings=settings, action_type="macro.restore", target=path, role="pre_restore_deleted_path"))
            _remove_path(path)
            return {"operation": "delete", "path": str(path)}
        return {"operation": "delete", "path": str(path), "skipped": "missing"}
    if kind == "restore_snapshot":
        snapshot_id = str(operation["snapshot_id"])
        snapshot = snapshots_by_id.get(snapshot_id)
        if not snapshot:
            raise ValueError(f"Snapshot {snapshot_id} was not recorded on this run.")
        target = Path(str(operation.get("target") or snapshot.get("target") or ""))
        if target.exists():
            pre_restore_snapshots.append(capture_path_snapshot(settings=settings, action_type="macro.restore", target=target, role="pre_restore_target"))
        _restore_snapshot_to_target(settings, snapshot, target)
        return {"operation": "restore_snapshot", "snapshot_id": snapshot_id, "target": str(target.resolve())}
    raise ValueError(f"Unsupported inverse operation: {kind}")


def _restore_snapshot_to_target(settings: Settings, snapshot: dict[str, Any], target: Path) -> None:
    snapshot_path = Path(str(snapshot.get("snapshot_path") or "")).resolve()
    snapshot_root = settings.resolved_action_snapshots_dir().resolve()
    if not _is_within(snapshot_path, snapshot_root):
        raise ValueError("Snapshot path is outside the configured Macro Lab action snapshot directory.")
    if not snapshot_path.exists():
        raise FileNotFoundError(f"Snapshot file is missing: {snapshot_path}")
    resolved_target = target.resolve()
    if resolved_target.exists():
        _remove_path(resolved_target)
    resolved_target.parent.mkdir(parents=True, exist_ok=True)
    if snapshot_path.is_dir():
        shutil.copytree(snapshot_path, resolved_target)
    else:
        shutil.copy2(snapshot_path, resolved_target)


def _remove_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def _is_within(path: Path, root: Path) -> bool:
    return path == root or root in path.parents
