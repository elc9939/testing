from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import __version__
from .config import Settings
from .models import new_id, now_iso
from .security import redact_mapping
from .storage import AppStorage, CURRENT_SCHEMA_VERSION

logger = logging.getLogger(__name__)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


@dataclass
class BackupSummary:
    id: str
    path: Path
    created_at: str
    ok: bool
    reason: str
    size_bytes: int
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "path": str(self.path),
            "created_at": self.created_at,
            "ok": self.ok,
            "reason": self.reason,
            "size_bytes": self.size_bytes,
            "error": self.error,
        }


class BackupManager:
    def __init__(self, settings: Settings, storage: AppStorage):
        self.settings = settings
        self.storage = storage
        self.backup_dir = settings.resolved_backup_dir()

    def create_backup(self, reason: str = "manual") -> dict[str, Any]:
        backup_id = f"{_utc_stamp()}_{new_id('backup')}"
        destination = self.backup_dir / backup_id
        destination.mkdir(parents=True, exist_ok=False)
        db_backup = destination / "ai-os.sqlite3"
        manifest_path = destination / "manifest.json"

        self.storage.backup_to(db_backup)
        files = [
            {
                "role": "database",
                "path": "ai-os.sqlite3",
                "sha256": sha256_file(db_backup),
                "size_bytes": db_backup.stat().st_size,
            }
        ]

        assets_dir = self.settings.resolved_assets_dir()
        if assets_dir.exists():
            copied_assets = destination / "assets"
            shutil.copytree(assets_dir, copied_assets)
            for file in copied_assets.rglob("*"):
                if file.is_file():
                    files.append(
                        {
                            "role": "asset",
                            "path": str(file.relative_to(destination)).replace("\\", "/"),
                            "sha256": sha256_file(file),
                            "size_bytes": file.stat().st_size,
                        }
                    )

        config_summary = redact_mapping(
            {
                "host": self.settings.host,
                "port": self.settings.port,
                "data_dir": self.settings.data_dir,
                "backup_dir": self.settings.resolved_backup_dir(),
                "log_dir": self.settings.resolved_log_dir(),
                "assets_dir": self.settings.resolved_assets_dir(),
                "ollama_base_url": self.settings.ollama_base_url,
                "ollama_chat_model": self.settings.ollama_chat_model,
                "ollama_embedding_model": self.settings.ollama_embedding_model,
                "openai_api_key": self.settings.openai_api_key,
                "anthropic_api_key": self.settings.anthropic_api_key,
                "provider_priority": self.settings.provider_priority,
                "max_job_concurrency": self.settings.max_job_concurrency,
                "max_active_jobs": self.settings.max_active_jobs,
            }
        )
        (destination / "config-redacted.json").write_text(json.dumps(config_summary, indent=2), encoding="utf-8")
        files.append(
            {
                "role": "config-redacted",
                "path": "config-redacted.json",
                "sha256": sha256_file(destination / "config-redacted.json"),
                "size_bytes": (destination / "config-redacted.json").stat().st_size,
            }
        )

        manifest = {
            "id": backup_id,
            "created_at": now_iso(),
            "reason": reason,
            "app_version": __version__,
            "schema_version": self.storage.schema_version(),
            "expected_schema_version": CURRENT_SCHEMA_VERSION,
            "source_database": str(self.storage.db_path),
            "integrity": self.storage.integrity_report(),
            "files": files,
        }
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        self.apply_retention()
        return manifest

    def list_backups(self) -> list[BackupSummary]:
        if not self.backup_dir.exists():
            return []
        summaries: list[BackupSummary] = []
        for path in sorted(self.backup_dir.iterdir(), reverse=True):
            if not path.is_dir():
                continue
            manifest_path = path / "manifest.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                verification = self.verify_backup(path.name)
                summaries.append(
                    BackupSummary(
                        id=str(manifest.get("id") or path.name),
                        path=path,
                        created_at=str(manifest.get("created_at") or ""),
                        ok=bool(verification["ok"]),
                        reason=str(manifest.get("reason") or ""),
                        size_bytes=directory_size(path),
                        error=verification.get("error"),
                    )
                )
            except Exception as error:
                summaries.append(
                    BackupSummary(
                        id=path.name,
                        path=path,
                        created_at="",
                        ok=False,
                        reason="unknown",
                        size_bytes=directory_size(path),
                        error=str(error),
                    )
                )
        return summaries

    def verify_backup(self, backup_id: str) -> dict[str, Any]:
        backup_path = self._safe_backup_path(backup_id)
        manifest_path = backup_path / "manifest.json"
        db_path = backup_path / "ai-os.sqlite3"
        if not manifest_path.exists() or not db_path.exists():
            return {"ok": False, "backup_id": backup_id, "error": "Backup manifest or database is missing."}
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            checksum_errors: list[dict[str, str]] = []
            for file_entry in manifest.get("files", []):
                relative = Path(str(file_entry["path"]))
                file_path = backup_path / relative
                expected = str(file_entry.get("sha256") or "")
                actual = sha256_file(file_path) if file_path.exists() else ""
                if actual != expected:
                    checksum_errors.append({"path": str(relative), "expected": expected, "actual": actual})
            integrity = verify_sqlite_file(db_path)
            ok = not checksum_errors and integrity["ok"] and manifest.get("schema_version") == CURRENT_SCHEMA_VERSION
            return {
                "ok": ok,
                "backup_id": backup_id,
                "path": str(backup_path),
                "checksum_errors": checksum_errors,
                "integrity": integrity,
                "manifest": {
                    "created_at": manifest.get("created_at"),
                    "reason": manifest.get("reason"),
                    "schema_version": manifest.get("schema_version"),
                    "app_version": manifest.get("app_version"),
                },
            }
        except Exception as error:
            return {"ok": False, "backup_id": backup_id, "path": str(backup_path), "error": str(error)}

    def restore_to(self, backup_id: str, target: Path, overwrite: bool = False) -> dict[str, Any]:
        verification = self.verify_backup(backup_id)
        if not verification["ok"]:
            raise ValueError(f"Backup {backup_id} did not verify cleanly.")
        if target.exists() and not overwrite:
            raise FileExistsError(f"Target already exists: {target}")
        backup_db = self._safe_backup_path(backup_id) / "ai-os.sqlite3"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup_db, target)
        restored = verify_sqlite_file(target)
        return {"ok": restored["ok"], "target": str(target), "verification": verification, "restored": restored}

    def apply_retention(self) -> list[str]:
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        backups = [path for path in self.backup_dir.iterdir() if path.is_dir()]
        backups.sort(key=lambda path: path.name, reverse=True)
        removed: list[str] = []
        for path in backups[max(1, self.settings.backup_retention_count) :]:
            resolved = path.resolve()
            backup_root = self.backup_dir.resolve()
            if backup_root not in resolved.parents:
                raise ValueError(f"Refusing to remove backup outside backup dir: {resolved}")
            shutil.rmtree(resolved)
            removed.append(str(resolved))
        return removed

    def _safe_backup_path(self, backup_id: str) -> Path:
        if "/" in backup_id or "\\" in backup_id or backup_id in {"", ".", ".."}:
            raise ValueError("Invalid backup id.")
        path = (self.backup_dir / backup_id).resolve()
        root = self.backup_dir.resolve()
        if root != path and root not in path.parents:
            raise ValueError("Backup id resolved outside backup directory.")
        return path


def verify_sqlite_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"ok": False, "error": "SQLite file does not exist.", "path": str(path)}
    uri = f"file:{path.resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        integrity = [str(row[0]) for row in conn.execute("pragma integrity_check").fetchall()]
        foreign_keys = [dict(row) for row in conn.execute("pragma foreign_key_check").fetchall()]
        schema_row = conn.execute(
            "select max(version) as version from schema_migrations"
        ).fetchone()
        schema_version = int(schema_row["version"] or 0) if schema_row else 0
        counts: dict[str, int] = {}
        for table in ("usage_log", "memory_documents", "memory_chunks", "job_events", "schema_migrations"):
            counts[table] = int(conn.execute(f"select count(*) as count from {table}").fetchone()["count"])
        ok = integrity == ["ok"] and not foreign_keys and schema_version == CURRENT_SCHEMA_VERSION
        return {
            "ok": ok,
            "path": str(path),
            "integrity": integrity,
            "foreign_key_errors": foreign_keys,
            "schema_version": schema_version,
            "expected_schema_version": CURRENT_SCHEMA_VERSION,
            "counts": counts,
        }
    except Exception as error:
        return {"ok": False, "path": str(path), "error": str(error)}
    finally:
        conn.close()


class MaintenanceScheduler:
    def __init__(self, settings: Settings, backups: BackupManager):
        self.settings = settings
        self.backups = backups
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if not self.settings.backup_enabled or self._task:
            return
        self._task = asyncio.create_task(self._run(), name="ai-os-maintenance")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        await asyncio.sleep(2)
        while not self._stop.is_set():
            try:
                self.backups.create_backup(reason="scheduled")
                logger.info("Scheduled AI OS backup completed")
            except Exception:
                logger.exception("Scheduled AI OS backup failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=max(60, self.settings.backup_interval_minutes * 60))
            except TimeoutError:
                continue


def cleanup_old_files(settings: Settings) -> dict[str, Any]:
    cutoff = datetime.now(timezone.utc).timestamp() - settings.cleanup_max_age_days * 24 * 60 * 60
    roots = [settings.resolved_temp_dir()]
    removed: list[str] = []
    for root in roots:
        root.mkdir(parents=True, exist_ok=True)
        for path in root.rglob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed.append(str(path))
    log_root = settings.resolved_log_dir()
    log_root.mkdir(parents=True, exist_ok=True)
    for path in log_root.glob("*.log*"):
        if path.is_file() and path.stat().st_mtime < cutoff:
            path.unlink()
            removed.append(str(path))
    return {"ok": True, "removed": removed}


def restore_backup_to_temp(settings: Settings, storage: AppStorage, backup_id: str) -> dict[str, Any]:
    manager = BackupManager(settings, storage)
    with tempfile.TemporaryDirectory(prefix="ai-os-restore-") as directory:
        target = Path(directory) / "restored.sqlite3"
        return manager.restore_to(backup_id, target, overwrite=True)
