from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from .config import Settings
from .models import InferenceRequest, InferenceResult, ProviderUsage, StreamChunk
from .providers.base import ProviderAdapter, ProviderError, ProviderUnavailable
from .providers.registry import ProviderRegistry
from .storage import AppStorage

logger = logging.getLogger(__name__)


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4) if text else 0


class InferenceRouter:
    def __init__(self, settings: Settings, registry: ProviderRegistry, storage: AppStorage):
        self.settings = settings
        self.registry = registry
        self.storage = storage

    def _estimate_cost(self, provider: str, usage: ProviderUsage) -> float:
        rates = self.settings.provider_costs.get(provider, {})
        input_cost = (usage.input_tokens / 1_000_000) * float(rates.get("input_per_1m", 0))
        output_cost = (usage.output_tokens / 1_000_000) * float(rates.get("output_per_1m", 0))
        return input_cost + output_cost

    def _request_input_estimate(self, request: InferenceRequest) -> int:
        return estimate_tokens("\n".join(message.content for message in request.as_messages()))

    def _sort_key(self, adapter: ProviderAdapter, request: InferenceRequest) -> tuple[int, float, float, int]:
        priority = self.settings.provider_priority.index(adapter.provider_id) if adapter.provider_id in self.settings.provider_priority else 999
        local_score = 0 if (request.local_first and adapter.local) else 1
        if request.local_first is False and adapter.paid:
            local_score = 0
        cost_rates = self.settings.provider_costs.get(adapter.provider_id, {})
        cost_score = float(cost_rates.get("input_per_1m", 0)) + float(cost_rates.get("output_per_1m", 0))
        latency = self.storage.recent_provider_latency(adapter.provider_id) or 999_999
        return (local_score, cost_score, latency, priority)

    def candidates(self, request: InferenceRequest) -> list[ProviderAdapter]:
        if request.provider:
            adapter = self.registry.get(request.provider)
            if not adapter:
                raise ProviderUnavailable(f"Unknown provider: {request.provider}")
            rest = [candidate for candidate in self.registry.all() if candidate.provider_id != request.provider]
            return [adapter, *sorted(rest, key=lambda item: self._sort_key(item, request))] if request.allow_fallback else [adapter]

        candidates = sorted(self.registry.all(), key=lambda item: self._sort_key(item, request))
        if request.cost_ceiling_usd is None:
            return candidates

        input_estimate = self._request_input_estimate(request)
        filtered: list[ProviderAdapter] = []
        for adapter in candidates:
            estimated = self._estimate_cost(adapter.provider_id, ProviderUsage(input_tokens=input_estimate, output_tokens=request.max_tokens))
            if estimated <= request.cost_ceiling_usd:
                filtered.append(adapter)
        return filtered or candidates[:1]

    async def infer(self, request: InferenceRequest) -> InferenceResult:
        fallback_chain: list[dict[str, Any]] = []
        last_error: Exception | None = None
        for adapter in self.candidates(request):
            started = time.perf_counter()
            try:
                result = await adapter.complete(request)
                if result.usage.input_tokens == 0:
                    result.usage.input_tokens = self._request_input_estimate(request)
                if result.usage.output_tokens == 0:
                    result.usage.output_tokens = estimate_tokens(result.text)
                result.usage.total_tokens = result.usage.input_tokens + result.usage.output_tokens
                result.cost_usd = self._estimate_cost(adapter.provider_id, result.usage)
                result.fallback_chain = fallback_chain
                if result.usage.tokens_per_second:
                    result.metadata["tokens_per_second"] = result.usage.tokens_per_second
                self.storage.log_usage(
                    provider=result.provider,
                    model=result.model,
                    task_type=request.task_type,
                    ok=True,
                    input_tokens=result.usage.input_tokens,
                    output_tokens=result.usage.output_tokens,
                    cost_usd=result.cost_usd,
                    latency_ms=result.latency_ms,
                    fallback_chain=fallback_chain,
                    metadata=result.metadata,
                )
                return result
            except Exception as error:
                last_error = error
                latency_ms = (time.perf_counter() - started) * 1000
                fallback_chain.append({"provider": adapter.provider_id, "error": str(error), "latency_ms": latency_ms})
                self.storage.log_usage(
                    provider=adapter.provider_id,
                    model=request.model or "",
                    task_type=request.task_type,
                    ok=False,
                    input_tokens=self._request_input_estimate(request),
                    output_tokens=0,
                    cost_usd=0,
                    latency_ms=latency_ms,
                    fallback_chain=fallback_chain,
                    error=str(error),
                )
                logger.warning("Provider failed", extra={"provider": adapter.provider_id, "error": str(error)})
                if not request.allow_fallback:
                    break
        raise ProviderError(f"All providers failed: {last_error}")

    async def stream(self, request: InferenceRequest) -> AsyncIterator[StreamChunk]:
        fallback_chain: list[dict[str, Any]] = []
        last_error: Exception | None = None
        for adapter in self.candidates(request):
            started = time.perf_counter()
            chunks: list[str] = []
            output_tokens = 0
            try:
                async for chunk in adapter.stream(request):
                    if chunk.text:
                        chunks.append(chunk.text)
                        output_tokens += estimate_tokens(chunk.text)
                    yield chunk
                    if chunk.done:
                        break
                text = "".join(chunks)
                input_tokens = self._request_input_estimate(request)
                usage = ProviderUsage(input_tokens=input_tokens, output_tokens=output_tokens, total_tokens=input_tokens + output_tokens)
                latency_ms = (time.perf_counter() - started) * 1000
                if latency_ms > 0 and output_tokens:
                    usage.tokens_per_second = output_tokens / latency_ms * 1000
                self.storage.log_usage(
                    provider=adapter.provider_id,
                    model=request.model or "",
                    task_type=request.task_type,
                    ok=True,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cost_usd=self._estimate_cost(adapter.provider_id, usage),
                    latency_ms=latency_ms,
                    fallback_chain=fallback_chain,
                    metadata={"streamed": True, "tokens_per_second": usage.tokens_per_second, "text_preview": text[:240]},
                )
                return
            except Exception as error:
                last_error = error
                latency_ms = (time.perf_counter() - started) * 1000
                fallback_chain.append({"provider": adapter.provider_id, "error": str(error), "latency_ms": latency_ms})
                self.storage.log_usage(
                    provider=adapter.provider_id,
                    model=request.model or "",
                    task_type=request.task_type,
                    ok=False,
                    input_tokens=self._request_input_estimate(request),
                    output_tokens=0,
                    cost_usd=0,
                    latency_ms=latency_ms,
                    fallback_chain=fallback_chain,
                    error=str(error),
                    metadata={"streamed": True},
                )
                if chunks or not request.allow_fallback:
                    yield StreamChunk(provider=adapter.provider_id, model=request.model or "", done=True, metadata={"error": str(error)})
                    return
        yield StreamChunk(provider="router", model="", done=True, metadata={"error": f"All providers failed: {last_error}"})


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
