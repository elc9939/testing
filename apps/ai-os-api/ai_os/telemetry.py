from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import subprocess
import urllib.error
import urllib.request
from collections import defaultdict
from typing import Any

from .models import HardwareStatus
from .storage import AppStorage

logger = logging.getLogger(__name__)

WINDOWS_GPU_TELEMETRY_SCRIPT = r"""
$ErrorActionPreference = "Stop"
$payload = [pscustomobject]@{
  controllers = @(Get-CimInstance Win32_VideoController |
    Where-Object { $_.Name -and $_.Name -notmatch "Microsoft Basic" } |
    Select-Object Name,Status,AdapterRAM,DriverVersion,VideoProcessor,PNPDeviceID)
  engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
    Select-Object Name,UtilizationPercentage)
  memory = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory |
    Select-Object Name,DedicatedUsage,SharedUsage,TotalCommitted)
  registryMemory = @(Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue |
    ForEach-Object {
      $p = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue
      if ($p.DriverDesc) {
        [pscustomobject]@{
          Name = $p.DriverDesc
          MatchingDeviceId = $p.MatchingDeviceId
          MemorySize = $p.'HardwareInformation.MemorySize'
          QwMemorySize = $p.'HardwareInformation.qwMemorySize'
        }
      }
    })
}
$payload | ConvertTo-Json -Depth 6 -Compress
"""


def _bytes_to_gb(value: float) -> float:
    return round(value / (1024**3), 2)


def _bytes_to_mb(value: float | int | None) -> float | None:
    if value is None:
        return None
    return round(float(value) / (1024**2), 1)


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def _as_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_luid(name: str) -> str | None:
    match = re.search(r"luid_0x[0-9a-f]+_0x[0-9a-f]+", name, re.IGNORECASE)
    return match.group(0).lower() if match else None


def _vendor_for_name(name: str) -> str | None:
    lowered = name.lower()
    if "amd" in lowered or "radeon" in lowered:
        return "AMD"
    if "nvidia" in lowered or "geforce" in lowered or "rtx" in lowered or "gtx" in lowered:
        return "NVIDIA"
    if "intel" in lowered:
        return "Intel"
    return None


def _nvidia_gpus() -> tuple[list[dict[str, Any]], str | None]:
    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except Exception as error:
        logger.debug("nvidia-smi telemetry unavailable", exc_info=error)
        return [], f"nvidia-smi unavailable: {error}"

    if completed.returncode != 0 or not completed.stdout.strip():
        detail = (completed.stderr or completed.stdout or "nvidia-smi returned no GPU rows.").strip()
        return [], detail

    gpus: list[dict[str, Any]] = []
    reader = csv.reader(io.StringIO(completed.stdout))
    for row in reader:
        if len(row) < 4:
            continue
        gpu: dict[str, Any] = {
            "name": row[0].strip(),
            "vendor": "NVIDIA",
            "source": "nvidia-smi",
            "utilization_percent": _as_float(row[1]),
            "memory_used_mb": _as_float(row[2]),
            "memory_total_mb": _as_float(row[3]),
        }
        if len(row) >= 5:
            gpu["temperature_c"] = _as_float(row[4])
            gpu["temperature_source"] = "nvidia-smi"
        gpus.append(gpu)
    return gpus, None


def _run_windows_gpu_script() -> tuple[dict[str, Any] | None, str | None]:
    if os.name != "nt":
        return None, "Windows GPU counters are only available on Windows."
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                WINDOWS_GPU_TELEMETRY_SCRIPT,
            ],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except Exception as error:
        logger.debug("Windows GPU telemetry unavailable", exc_info=error)
        return None, f"Windows GPU telemetry unavailable: {error}"

    if completed.returncode != 0 or not completed.stdout.strip():
        detail = (completed.stderr or completed.stdout or "Windows GPU counters returned no data.").strip()
        return None, detail
    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        logger.debug("Windows GPU telemetry JSON parse failed", exc_info=error)
        return None, f"Windows GPU telemetry parse failed: {error}"
    return parsed if isinstance(parsed, dict) else None, None


def _parse_windows_gpu_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    controllers = [row for row in _as_list(payload.get("controllers")) if isinstance(row, dict)]
    memory_rows = [row for row in _as_list(payload.get("memory")) if isinstance(row, dict)]
    engine_rows = [row for row in _as_list(payload.get("engines")) if isinstance(row, dict)]
    registry_memory_rows = [row for row in _as_list(payload.get("registryMemory")) if isinstance(row, dict)]

    memory_by_luid: dict[str, dict[str, Any]] = {}
    for row in memory_rows:
        name = str(row.get("Name") or "")
        luid = _extract_luid(name)
        if not luid:
            continue
        previous = memory_by_luid.get(luid)
        current_committed = _as_int(row.get("TotalCommitted")) or _as_int(row.get("DedicatedUsage")) or 0
        previous_committed = _as_int(previous.get("TotalCommitted") if previous else None) or 0
        if previous is None or current_committed >= previous_committed:
            memory_by_luid[luid] = row

    utilization_by_luid: dict[str, float] = defaultdict(float)
    engine_types_by_luid: dict[str, set[str]] = defaultdict(set)
    for row in engine_rows:
        name = str(row.get("Name") or "")
        luid = _extract_luid(name)
        if not luid:
            continue
        utilization_by_luid[luid] += max(0.0, _as_float(row.get("UtilizationPercentage")) or 0.0)
        engine_match = re.search(r"engtype_(.+)$", name, re.IGNORECASE)
        if engine_match:
            engine_types_by_luid[luid].add(engine_match.group(1))

    ranked_luids = sorted(
        set(memory_by_luid) | set(utilization_by_luid),
        key=lambda luid: (
            _as_int(memory_by_luid.get(luid, {}).get("DedicatedUsage")) or 0,
            utilization_by_luid.get(luid, 0.0),
        ),
        reverse=True,
    )

    gpus: list[dict[str, Any]] = []
    for index, controller in enumerate(controllers):
        name = str(controller.get("Name") or f"Windows GPU {index + 1}")
        luid = ranked_luids[index] if index < len(ranked_luids) else None
        memory = memory_by_luid.get(luid or "", {})
        dedicated_usage = _as_int(memory.get("DedicatedUsage"))
        shared_usage = _as_int(memory.get("SharedUsage"))
        total_committed = _as_int(memory.get("TotalCommitted"))
        adapter_ram = _as_int(controller.get("AdapterRAM"))
        registry_memory = _registry_memory_for_controller(controller, registry_memory_rows)
        utilization = min(100.0, round(utilization_by_luid.get(luid or "", 0.0), 1))
        reported_total_mb = _bytes_to_mb(adapter_ram)
        registry_total_mb = _bytes_to_mb(registry_memory)

        gpu: dict[str, Any] = {
            "name": name,
            "vendor": _vendor_for_name(name),
            "source": "windows-performance-counters",
            "status": controller.get("Status"),
            "driver_version": controller.get("DriverVersion"),
            "video_processor": controller.get("VideoProcessor"),
            "pnp_device_id": controller.get("PNPDeviceID"),
            "adapter_luid": luid,
            "utilization_percent": utilization,
            "memory_used_mb": _bytes_to_mb(dedicated_usage),
            "memory_shared_used_mb": _bytes_to_mb(shared_usage),
            "memory_committed_mb": _bytes_to_mb(total_committed),
            "memory_reported_total_mb": reported_total_mb,
            "temperature_c": None,
            "temperature_source": "unavailable",
        }
        if registry_total_mb:
            gpu["memory_total_mb"] = registry_total_mb
            gpu["memory_total_source"] = "driver-registry"
        elif adapter_ram and dedicated_usage and adapter_ram >= dedicated_usage * 0.9:
            gpu["memory_total_mb"] = reported_total_mb
            gpu["memory_total_source"] = "win32-video-controller"
        engine_types = sorted(engine_types_by_luid.get(luid or "", set()))
        if engine_types:
            gpu["active_engine_types"] = engine_types[:8]
        gpus.append(gpu)

    if not gpus and ranked_luids:
        for luid in ranked_luids:
            memory = memory_by_luid.get(luid, {})
            gpus.append(
                {
                    "name": f"Windows GPU {luid}",
                    "source": "windows-performance-counters",
                    "adapter_luid": luid,
                    "utilization_percent": min(100.0, round(utilization_by_luid.get(luid, 0.0), 1)),
                    "memory_used_mb": _bytes_to_mb(_as_int(memory.get("DedicatedUsage"))),
                    "memory_shared_used_mb": _bytes_to_mb(_as_int(memory.get("SharedUsage"))),
                    "memory_committed_mb": _bytes_to_mb(_as_int(memory.get("TotalCommitted"))),
                    "temperature_c": None,
                    "temperature_source": "unavailable",
                }
            )
    return gpus


def _registry_memory_for_controller(controller: dict[str, Any], rows: list[dict[str, Any]]) -> int | None:
    name = str(controller.get("Name") or "").lower()
    pnp_device_id = str(controller.get("PNPDeviceID") or "").lower()
    best: int | None = None
    for row in rows:
        row_name = str(row.get("Name") or "").lower()
        matching_device_id = str(row.get("MatchingDeviceId") or "").lower()
        if row_name and row_name != name and (not matching_device_id or matching_device_id not in pnp_device_id):
            continue
        value = _as_int(row.get("QwMemorySize")) or _as_int(row.get("MemorySize"))
        if value and (best is None or value > best):
            best = value
    return best


def _windows_gpus() -> tuple[list[dict[str, Any]], str | None]:
    payload, error = _run_windows_gpu_script()
    if error or payload is None:
        return [], error
    return _parse_windows_gpu_payload(payload), None


def _ollama_loaded_models() -> tuple[list[dict[str, Any]], str | None]:
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    try:
        request = urllib.request.Request(f"{base_url}/api/ps", headers={"accept": "application/json"})
        with urllib.request.urlopen(request, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        logger.debug("Ollama model load telemetry unavailable", exc_info=error)
        return [], f"Ollama model load unavailable: {error}"

    models: list[dict[str, Any]] = []
    for row in payload.get("models", []) if isinstance(payload, dict) else []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or row.get("model") or "")
        size_bytes = _as_int(row.get("size"))
        size_vram_bytes = _as_int(row.get("size_vram"))
        context_length = _as_int(row.get("context_length"))
        gpu_ratio = (float(size_vram_bytes) / float(size_bytes)) if size_bytes and size_vram_bytes is not None else None
        if gpu_ratio is None:
            processor = "unknown"
        elif gpu_ratio >= 0.95:
            processor = "100% GPU"
        elif gpu_ratio > 0:
            processor = f"{round(gpu_ratio * 100)}% GPU"
        else:
            processor = "CPU/unknown"
        models.append(
            {
                "name": name,
                "model": row.get("model") or name,
                "size_gb": _bytes_to_gb(float(size_bytes or 0)),
                "vram_gb": _bytes_to_gb(float(size_vram_bytes or 0)),
                "processor": processor,
                "context_length": context_length,
                "expires_at": row.get("expires_at"),
            }
        )
    return models, None


def _attach_loaded_models(gpus: list[dict[str, Any]], loaded_models: list[dict[str, Any]]) -> None:
    if not gpus or not loaded_models:
        return
    primary = max(gpus, key=lambda gpu: float(gpu.get("memory_used_mb") or 0))
    primary["loaded_models"] = loaded_models
    primary["model_vram_used_mb"] = round(sum(float(model.get("vram_gb") or 0) * 1024 for model in loaded_models), 1)


def hardware_status(storage: AppStorage) -> HardwareStatus:
    status = HardwareStatus(recent_tokens_per_second=storage.recent_tokens_per_second())
    errors: list[str] = []
    try:
        import psutil

        memory = psutil.virtual_memory()
        status.cpu_percent = float(psutil.cpu_percent(interval=0.05))
        status.memory_percent = float(memory.percent)
        status.memory_used_gb = _bytes_to_gb(float(memory.used))
        status.memory_total_gb = _bytes_to_gb(float(memory.total))
    except Exception as error:
        errors.append(f"psutil unavailable: {error}")

    loaded_models, ollama_error = _ollama_loaded_models()
    status.loaded_models = loaded_models

    gpu_errors: list[str] = []
    nvidia_gpus, nvidia_error = _nvidia_gpus()
    if nvidia_gpus:
        status.gpus.extend(nvidia_gpus)
    elif nvidia_error:
        gpu_errors.append(nvidia_error)

    if not status.gpus and os.name == "nt":
        windows_gpus, windows_error = _windows_gpus()
        if windows_gpus:
            status.gpus.extend(windows_gpus)
        elif windows_error:
            gpu_errors.append(windows_error)

    _attach_loaded_models(status.gpus, loaded_models)
    if not status.gpus and loaded_models:
        status.gpus.append(
            {
                "name": "Ollama loaded models",
                "source": "ollama",
                "loaded_models": loaded_models,
                "temperature_c": None,
                "temperature_source": "unavailable",
            }
        )

    if not status.gpus and gpu_errors:
        errors.append("GPU telemetry unavailable: " + "; ".join(gpu_errors[:2]))
    if ollama_error and not loaded_models:
        logger.debug(ollama_error)
    if errors:
        status.error = "; ".join(errors)
    return status
