from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

MachineModeId = Literal["balanced", "beast", "quiet", "offline", "night", "maintenance"]


@dataclass(frozen=True)
class MachineModePolicy:
    id: MachineModeId
    label: str
    prefer_local: bool = True
    local_only: bool = False
    avoid_paid_without_explicit_provider: bool = False
    max_job_concurrency: int | None = None
    notes: tuple[str, ...] = ()

    def metadata(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "prefer_local": self.prefer_local,
            "local_only": self.local_only,
            "avoid_paid_without_explicit_provider": self.avoid_paid_without_explicit_provider,
            "max_job_concurrency": self.max_job_concurrency,
            "notes": list(self.notes),
        }


POLICIES: dict[MachineModeId, MachineModePolicy] = {
    "balanced": MachineModePolicy(
        id="balanced",
        label="Balanced",
        prefer_local=False,
        notes=("Respect the request's local_first preference; default dashboard requests remain local-first.",),
    ),
    "beast": MachineModePolicy(
        id="beast",
        label="Beast Mode",
        prefer_local=True,
        notes=("Favor local compute and GPU-heavy-capable routes before cloud fallback.",),
    ),
    "quiet": MachineModePolicy(
        id="quiet",
        label="Quiet Mode",
        prefer_local=True,
        avoid_paid_without_explicit_provider=True,
        max_job_concurrency=1,
        notes=("Avoid heavy/background pressure and paid routes unless explicitly selected.",),
    ),
    "offline": MachineModePolicy(
        id="offline",
        label="Offline Mode",
        prefer_local=True,
        local_only=True,
        avoid_paid_without_explicit_provider=True,
        max_job_concurrency=1,
        notes=("Allow only local providers; block cloud/paid provider routes.",),
    ),
    "night": MachineModePolicy(
        id="night",
        label="Night Shift",
        prefer_local=True,
        avoid_paid_without_explicit_provider=True,
        notes=("Favor unattended local batch work; avoid paid routes unless explicitly selected.",),
    ),
    "maintenance": MachineModePolicy(
        id="maintenance",
        label="Maintenance Mode",
        prefer_local=True,
        avoid_paid_without_explicit_provider=True,
        max_job_concurrency=2,
        notes=("Favor diagnostics, health checks, backups, restore tests, cleanup, and local checks.",),
    ),
}


def normalize_machine_mode_id(value: Any) -> MachineModeId:
    if isinstance(value, str) and value in POLICIES:
        return value  # type: ignore[return-value]
    return "balanced"


def extract_machine_mode_id(metadata: dict[str, Any] | None) -> MachineModeId:
    if not isinstance(metadata, dict):
        return "balanced"
    raw = metadata.get("machine_mode", metadata.get("machineMode"))
    if isinstance(raw, dict):
        return normalize_machine_mode_id(raw.get("id") or raw.get("mode"))
    return normalize_machine_mode_id(raw)


def machine_mode_policy(metadata: dict[str, Any] | None = None) -> MachineModePolicy:
    return POLICIES[extract_machine_mode_id(metadata)]


def merged_machine_mode_metadata(*sources: dict[str, Any] | None) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for source in sources:
        if isinstance(source, dict):
            merged.update(source)
    policy = machine_mode_policy(merged)
    merged["machine_mode"] = policy.metadata()
    return merged
