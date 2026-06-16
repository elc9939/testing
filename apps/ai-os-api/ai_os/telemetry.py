from __future__ import annotations

import csv
import io
import logging
import subprocess
from typing import Any

from .models import HardwareStatus
from .storage import AppStorage

logger = logging.getLogger(__name__)


def _bytes_to_gb(value: float) -> float:
    return round(value / (1024**3), 2)


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

    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if completed.returncode == 0 and completed.stdout.strip():
            reader = csv.reader(io.StringIO(completed.stdout))
            for row in reader:
                if len(row) >= 4:
                    status.gpus.append(
                        {
                            "name": row[0].strip(),
                            "utilization_percent": float(row[1]),
                            "memory_used_mb": float(row[2]),
                            "memory_total_mb": float(row[3]),
                        }
                    )
    except Exception as error:
        errors.append(f"nvidia-smi unavailable: {error}")
        logger.debug("GPU telemetry unavailable", exc_info=error)

    if errors:
        status.error = "; ".join(errors)
    return status
