from __future__ import annotations

import time
from typing import Any

from .config import Settings
from .jobs.queue import JobQueue
from .maintenance import BackupManager
from .providers.registry import ProviderRegistry
from .security import is_loopback_host
from .storage import AppStorage


async def full_health(
    *,
    settings: Settings,
    storage: AppStorage,
    providers: ProviderRegistry,
    jobs: JobQueue,
    backups: BackupManager,
) -> dict[str, Any]:
    started = time.perf_counter()
    integrity = storage.integrity_report()
    provider_statuses = [status.model_dump(mode="json") for status in await _provider_statuses(providers)]
    backup_summaries = [backup.as_dict() for backup in backups.list_backups()[:5]]
    checks = {
        "database": {
            "ok": bool(integrity["ok"]),
            "schema_version": integrity["schema_version"],
            "expected_schema_version": integrity["expected_schema_version"],
            "json_errors": len(integrity["json_errors"]),
            "foreign_key_errors": len(integrity["foreign_key_errors"]),
        },
        "backups": {
            "ok": bool(backup_summaries and backup_summaries[0]["ok"]),
            "latest": backup_summaries[0] if backup_summaries else None,
            "retention_count": settings.backup_retention_count,
        },
        "providers": {
            "ok": any(provider["available"] and provider["local"] for provider in provider_statuses),
            "available": [provider["id"] for provider in provider_statuses if provider["available"]],
            "degraded": [provider["id"] for provider in provider_statuses if not provider["available"]],
        },
        "queue": jobs.metrics(),
        "security": {
            "ok": (not settings.require_loopback) or is_loopback_host(settings.host),
            "host": settings.host,
            "loopback_required": settings.require_loopback,
            "trusted_origins": settings.trusted_origins,
        },
    }
    severity = "ok"
    if not checks["database"]["ok"]:
        severity = "critical"
    elif not checks["backups"]["ok"] or not checks["providers"]["ok"] or not checks["security"]["ok"]:
        severity = "degraded"
    return {
        "ok": severity == "ok",
        "severity": severity,
        "checks": checks,
        "latency_ms": (time.perf_counter() - started) * 1000,
    }


async def _provider_statuses(providers: ProviderRegistry):
    import asyncio

    return await asyncio.gather(*(adapter.status() for adapter in providers.all()))
