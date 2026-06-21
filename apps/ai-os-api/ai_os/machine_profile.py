from __future__ import annotations

import asyncio
import platform
import sys
from collections import defaultdict
from typing import Any

from .config import Settings
from .machine_modes import machine_mode_policy, normalize_machine_mode_id
from .models import BenchmarkRunRecord, CapabilityStatus, HardwareStatus, ProviderStatus, now_iso
from .providers.base import ProviderAdapter
from .providers.registry import ProviderRegistry
from .storage import AppStorage


async def provider_statuses(registry: ProviderRegistry) -> list[ProviderStatus]:
    return list(await asyncio.gather(*(_safe_provider_status(adapter) for adapter in registry.all())))


async def _safe_provider_status(adapter: ProviderAdapter) -> ProviderStatus:
    try:
        return await adapter.status()
    except Exception as error:
        return ProviderStatus(
            id=adapter.provider_id,
            label=adapter.label,
            available=False,
            local=adapter.local,
            paid=adapter.paid,
            capabilities=adapter.capabilities,
            error=str(error),
        )


def build_machine_profile(
    *,
    settings: Settings,
    storage: AppStorage,
    provider_statuses: list[ProviderStatus],
    capabilities: list[CapabilityStatus],
    hardware: HardwareStatus,
    jobs_metrics: dict[str, Any] | None = None,
    jobs_count: int = 0,
    background_units: list[dict[str, Any]] | None = None,
    tool_count: int = 0,
    mode: str = "balanced",
) -> dict[str, Any]:
    created_at = now_iso()
    provider_map = {provider.id: provider for provider in provider_statuses}
    benchmark_history = storage.list_benchmarks(50)
    benchmark_summary = summarize_benchmarks(benchmark_history, provider_map)
    resource_pressure = summarize_resource_pressure(hardware.model_dump(mode="json"))
    mode_id = normalize_machine_mode_id(mode)
    autotune = summarize_autotune(
        settings=settings,
        mode=mode_id,
        resource_pressure=resource_pressure,
        benchmark_summary=benchmark_summary,
        provider_statuses=provider_statuses,
    )
    integrity = storage.integrity_report()
    background_units = background_units or []

    return {
        "created_at": created_at,
        "source": "ai-os-api",
        "mode": mode_id,
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python": sys.version.split()[0],
        },
        "hardware": hardware.model_dump(mode="json"),
        "providers": [provider.model_dump(mode="json") for provider in provider_statuses],
        "provider_summary": summarize_providers(provider_statuses),
        "loaded_models": hardware.loaded_models,
        "local_services": {
            "ai_os_api": {
                "available": True,
                "host": settings.host,
                "port": settings.port,
                "loopback_required": settings.require_loopback,
            },
            "ollama": _ollama_service(provider_map.get("ollama"), settings),
            "macro_lab": {
                "available": None,
                "base_url": settings.macro_lab_api_url,
                "source": "hub-observed",
                "note": "AI OS stores the configured endpoint; the hub capability registry checks live Macro Lab status.",
            },
            "browser_cache": {
                "available": None,
                "source": "browser-observed",
                "note": "Browser cache readiness is measured inside the hub, not from this backend process.",
            },
        },
        "ai_os_health": {
            "integrity_ok": bool(integrity.get("ok")),
            "schema_version": integrity.get("schema_version"),
            "expected_schema_version": integrity.get("expected_schema_version"),
            "queue": jobs_metrics or {},
            "jobs_count": jobs_count,
            "background_units": len(background_units),
            "background_enabled": sum(1 for unit in background_units if unit.get("enabled")),
            "tool_count": tool_count,
        },
        "capabilities": [capability.model_dump(mode="json") for capability in capabilities],
        "capability_readiness": summarize_capabilities(capabilities),
        "benchmarks": {
            "recent": [record.model_dump(mode="json") for record in benchmark_history[:12]],
            **benchmark_summary,
        },
        "autotune": autotune,
    }


def summarize_providers(providers: list[ProviderStatus]) -> dict[str, int]:
    local = [provider for provider in providers if provider.local]
    paid = [provider for provider in providers if provider.paid]
    return {
        "total": len(providers),
        "available": sum(1 for provider in providers if provider.available),
        "local_configured": len(local),
        "local_available": sum(1 for provider in local if provider.available),
        "paid_configured": len(paid),
        "paid_available": sum(1 for provider in paid if provider.available),
    }


def summarize_capabilities(capabilities: list[CapabilityStatus]) -> dict[str, Any]:
    by_kind: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "available": 0})
    for capability in capabilities:
        by_kind[capability.kind]["total"] += 1
        if capability.available:
            by_kind[capability.kind]["available"] += 1
    return {
        "total": len(capabilities),
        "available": sum(1 for capability in capabilities if capability.available),
        "unavailable": sum(1 for capability in capabilities if not capability.available),
        "by_kind": dict(by_kind),
    }


def summarize_resource_pressure(hardware: dict[str, Any]) -> dict[str, Any]:
    cpu = _number(hardware.get("cpu_percent"))
    memory = _number(hardware.get("memory_percent"))
    gpu_utilization = max((_number(gpu.get("utilization_percent")) or 0 for gpu in _gpus(hardware)), default=None)
    vram_percent = _vram_percent(_gpus(hardware))
    metrics = {
        "cpu_percent": cpu,
        "memory_percent": memory,
        "gpu_utilization_percent": gpu_utilization,
        "vram_percent": vram_percent,
    }
    known = [value for value in metrics.values() if value is not None]
    if not known:
        return {"level": "unknown", "drivers": [], **metrics}

    drivers: list[str] = []
    if cpu is not None and cpu >= 90:
        drivers.append("cpu")
    if memory is not None and memory >= 90:
        drivers.append("ram")
    if gpu_utilization is not None and gpu_utilization >= 95:
        drivers.append("gpu")
    if vram_percent is not None and vram_percent >= 90:
        drivers.append("vram")
    if drivers:
        return {"level": "high", "drivers": drivers, **metrics}

    if cpu is not None and cpu >= 70:
        drivers.append("cpu")
    if memory is not None and memory >= 75:
        drivers.append("ram")
    if gpu_utilization is not None and gpu_utilization >= 75:
        drivers.append("gpu")
    if vram_percent is not None and vram_percent >= 75:
        drivers.append("vram")
    if drivers:
        return {"level": "medium", "drivers": drivers, **metrics}
    return {"level": "low", "drivers": [], **metrics}


def summarize_benchmarks(
    benchmarks: list[BenchmarkRunRecord],
    providers: dict[str, ProviderStatus],
) -> dict[str, Any]:
    by_provider: dict[str, dict[str, Any]] = {}
    for record in benchmarks:
        if not record.ok or not record.provider:
            continue
        row = by_provider.setdefault(
            record.provider,
            {
                "provider": record.provider,
                "samples": 0,
                "latency_ms_total": 0.0,
                "tokens_per_second_total": 0.0,
                "tokens_per_second_samples": 0,
                "best_tokens_per_second": None,
                "last_measured_at": record.created_at,
                "kinds": set(),
                "local": providers.get(record.provider).local if record.provider in providers else None,
                "paid": providers.get(record.provider).paid if record.provider in providers else None,
            },
        )
        row["samples"] += 1
        row["latency_ms_total"] += float(record.latency_ms)
        row["last_measured_at"] = max(str(row["last_measured_at"]), record.created_at)
        row["kinds"].add(record.kind)
        if record.tokens_per_second:
            row["tokens_per_second_total"] += float(record.tokens_per_second)
            row["tokens_per_second_samples"] += 1
            previous = row["best_tokens_per_second"]
            row["best_tokens_per_second"] = max(float(previous or 0), float(record.tokens_per_second))

    provider_rows: list[dict[str, Any]] = []
    for row in by_provider.values():
        samples = max(1, int(row.pop("samples")))
        token_samples = int(row.pop("tokens_per_second_samples"))
        token_total = float(row.pop("tokens_per_second_total"))
        latency_total = float(row.pop("latency_ms_total"))
        row["samples"] = samples
        row["avg_latency_ms"] = round(latency_total / samples, 2)
        row["avg_tokens_per_second"] = round(token_total / token_samples, 2) if token_samples else None
        row["kinds"] = sorted(row["kinds"])
        provider_rows.append(row)

    best_text = _best_text_route(benchmarks, providers)
    return {
        "best_text_route": best_text,
        "measured_providers": sorted(provider_rows, key=lambda row: row["provider"]),
        "text_samples": sum(1 for record in benchmarks if record.kind == "text" and record.ok),
    }


def summarize_autotune(
    *,
    settings: Settings,
    mode: str,
    resource_pressure: dict[str, Any],
    benchmark_summary: dict[str, Any],
    provider_statuses: list[ProviderStatus],
) -> dict[str, Any]:
    best_route = benchmark_summary.get("best_text_route")
    pressure_level = str(resource_pressure.get("level") or "unknown")
    suggested_concurrency = suggested_max_job_concurrency(settings.max_job_concurrency, mode, pressure_level)
    available_text = [
        provider for provider in provider_statuses if provider.available and "text.inference" in provider.capabilities
    ]
    notes: list[str] = []
    if best_route:
        route_label = f"{best_route.get('provider')}/{best_route.get('model')}" if best_route.get("model") else str(best_route.get("provider"))
        speed = best_route.get("tokens_per_second")
        notes.append(
            f"Best measured text route is {route_label}"
            + (f" at {float(speed):.1f} tokens/sec." if isinstance(speed, (int, float)) else ".")
        )
    else:
        notes.append("No successful text benchmark has been recorded yet.")
    if mode == "beast" and best_route and best_route.get("local") is True:
        notes.append("Beast Mode can prioritize this measured local route before paid fallback.")
    if mode in {"quiet", "offline", "night", "maintenance"}:
        notes.append(f"{machine_mode_policy({'machine_mode': {'id': mode}}).label} should cap new AI jobs at {suggested_concurrency}.")
    if pressure_level == "high":
        notes.append("Resource pressure is high; new local AI work should stay conservative until utilization drops.")
    if not available_text:
        notes.append("No reachable text provider is currently visible.")

    return {
        "mode": mode,
        "resource_pressure": resource_pressure,
        "best_text_route": best_route,
        "measured_providers": benchmark_summary.get("measured_providers", []),
        "suggested_max_job_concurrency": suggested_concurrency,
        "routing_notes": notes,
        "confidence": "measured" if best_route else "limited",
        "updated_at": now_iso(),
    }


def suggested_max_job_concurrency(configured: int, mode: str, pressure_level: str) -> int:
    base = max(1, int(configured or 1))
    policy = machine_mode_policy({"machine_mode": {"id": mode}})
    limit = min(base, policy.max_job_concurrency) if policy.max_job_concurrency else base
    if mode in {"quiet", "offline"}:
        return 1
    if pressure_level == "high":
        return 1
    if mode == "maintenance":
        return min(limit, 2)
    if mode == "night":
        return min(limit, 1 if pressure_level == "medium" else 2)
    if pressure_level == "medium" and mode != "beast":
        return min(limit, 2)
    if mode == "beast" and pressure_level == "medium":
        return min(limit, 2)
    return limit


def _best_text_route(benchmarks: list[BenchmarkRunRecord], providers: dict[str, ProviderStatus]) -> dict[str, Any] | None:
    candidates = [record for record in benchmarks if record.kind == "text" and record.ok and record.provider]
    if not candidates:
        return None
    best = sorted(
        candidates,
        key=lambda record: (
            bool(record.tokens_per_second),
            float(record.tokens_per_second or 0),
            -float(record.latency_ms),
        ),
        reverse=True,
    )[0]
    provider = providers.get(str(best.provider))
    return {
        "benchmark_id": best.id,
        "provider": best.provider,
        "model": best.model,
        "tokens_per_second": best.tokens_per_second,
        "latency_ms": best.latency_ms,
        "measured_at": best.created_at,
        "local": provider.local if provider else None,
        "paid": provider.paid if provider else None,
    }


def _ollama_service(status: ProviderStatus | None, settings: Settings) -> dict[str, Any]:
    if not status:
        return {"available": None, "base_url": settings.ollama_base_url, "source": "provider-registry"}
    return {
        "available": status.available,
        "base_url": settings.ollama_base_url,
        "models": status.models,
        "error": status.error,
        "source": "provider-registry",
    }


def _gpus(hardware: dict[str, Any]) -> list[dict[str, Any]]:
    rows = hardware.get("gpus")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _vram_percent(gpus: list[dict[str, Any]]) -> float | None:
    ratios: list[float] = []
    for gpu in gpus:
        used = _number(gpu.get("memory_used_mb")) or _number(gpu.get("memory_committed_mb"))
        total = _number(gpu.get("memory_total_mb")) or _number(gpu.get("memory_reported_total_mb"))
        if used is not None and total and total > 0:
            ratios.append(min(100.0, max(0.0, used / total * 100)))
    if not ratios:
        return None
    return round(max(ratios), 1)


def _number(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
