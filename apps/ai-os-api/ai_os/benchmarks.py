from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

from .inference import InferenceRouter
from .models import BenchmarkRequest, BenchmarkRunRecord, InferenceRequest, MultimodalInvokeRequest, new_id, now_iso
from .storage import AppStorage
from .telemetry import hardware_status


MediaInvoker = Callable[[str, MultimodalInvokeRequest], Awaitable[dict[str, Any]]]


async def run_benchmark(
    router: InferenceRouter,
    storage: AppStorage,
    request: BenchmarkRequest,
    media_invoker: MediaInvoker | None = None,
) -> BenchmarkRunRecord:
    before = hardware_status(storage).model_dump(mode="json")
    started = time.perf_counter()
    try:
        if request.kind in {"image", "audio", "video"}:
            if not media_invoker:
                raise RuntimeError(f"{request.kind.title()} benchmark requires a multimodal invoker.")
            result = await media_invoker(
                request.kind,
                MultimodalInvokeRequest(
                    prompt=request.prompt,
                    text=request.prompt,
                    provider=request.provider,
                    model=request.model,
                    options={"benchmark": True},
                )
            )
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            record = BenchmarkRunRecord(
                id=new_id("bench"),
                created_at=now_iso(),
                kind=request.kind,
                provider=str(result.get("provider") or request.provider or "auto"),
                model=str(result.get("model") or request.model or ""),
                prompt=request.prompt,
                latency_ms=latency_ms,
                hardware_before=before,
                hardware_after=hardware_status(storage).model_dump(mode="json"),
                result=result,
            )
            return storage.log_benchmark(record)

        outputs: list[dict[str, Any]] = []
        total_tokens_per_second = 0.0
        token_values = 0
        provider = request.provider
        model = request.model
        for index in range(request.iterations):
            result = await router.infer(
                InferenceRequest(
                    task_type="benchmark.text",
                    prompt=request.prompt,
                    provider=request.provider,
                    model=request.model,
                    max_tokens=request.max_tokens,
                    local_first=request.local_first,
                    allow_fallback=True,
                    metadata={"benchmark_iteration": index + 1},
                )
            )
            provider = result.provider
            model = result.model
            outputs.append(result.model_dump(mode="json"))
            if result.usage.tokens_per_second:
                total_tokens_per_second += result.usage.tokens_per_second
                token_values += 1
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        record = BenchmarkRunRecord(
            id=new_id("bench"),
            created_at=now_iso(),
            kind=request.kind,
            provider=provider,
            model=model,
            prompt=request.prompt,
            latency_ms=latency_ms,
            tokens_per_second=(total_tokens_per_second / token_values) if token_values else None,
            hardware_before=before,
            hardware_after=hardware_status(storage).model_dump(mode="json"),
            result={"runs": outputs},
        )
        return storage.log_benchmark(record)
    except Exception as error:
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        record = BenchmarkRunRecord(
            id=new_id("bench"),
            created_at=now_iso(),
            kind=request.kind,
            provider=request.provider,
            model=request.model,
            prompt=request.prompt,
            latency_ms=latency_ms,
            hardware_before=before,
            hardware_after=hardware_status(storage).model_dump(mode="json"),
            result={},
            ok=False,
            error=str(error),
        )
        storage.log_benchmark(record)
        raise
