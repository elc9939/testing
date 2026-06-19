from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..config import Settings
from ..models import InferenceRequest, InferenceResult, ProviderStatus, ProviderUsage, StreamChunk
from .base import ProviderAdapter, ProviderUnavailable


class OllamaProvider(ProviderAdapter):
    provider_id = "ollama"
    label = "Ollama Local"
    local = True
    paid = False
    capabilities = ["text.inference", "text.streaming", "memory.embedding", "multimodal.vision", "multimodal.image.local"]

    def __init__(self, settings: Settings):
        self.settings = settings

    def _url(self, path: str) -> str:
        base = self.settings.ollama_base_url.rstrip("/")
        if base.endswith("/api"):
            return f"{base}{path}"
        return f"{base}/api{path}"

    async def status(self) -> ProviderStatus:
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(self._url("/tags"))
                response.raise_for_status()
                payload = response.json()
            models = [str(item.get("name") or item.get("model")) for item in payload.get("models", []) if item.get("name") or item.get("model")]
            return ProviderStatus(
                id=self.provider_id,
                label=self.label,
                available=True,
                local=True,
                paid=False,
                models=models,
                capabilities=self.capabilities,
                latency_ms=(time.perf_counter() - started) * 1000,
            )
        except Exception as error:
            return ProviderStatus(
                id=self.provider_id,
                label=self.label,
                available=False,
                local=True,
                paid=False,
                capabilities=self.capabilities,
                error=str(error),
                latency_ms=(time.perf_counter() - started) * 1000,
            )

    async def complete(self, request: InferenceRequest) -> InferenceResult:
        started = time.perf_counter()
        model = request.model or self.settings.ollama_chat_model
        payload: dict[str, Any] = {
            "model": model,
            "messages": [message.model_dump() for message in request.as_messages()],
            "stream": False,
            "options": {
                "temperature": request.temperature,
                "num_predict": request.max_tokens,
                "num_ctx": self.settings.ollama_context_tokens,
            },
        }
        async with httpx.AsyncClient(timeout=self.settings.ollama_timeout_s) as client:
            response = await client.post(self._url("/chat"), json=payload)
            response.raise_for_status()
            data = response.json()

        text = str(data.get("message", {}).get("content", ""))
        eval_count = int(data.get("eval_count") or 0)
        prompt_eval_count = int(data.get("prompt_eval_count") or 0)
        eval_duration = float(data.get("eval_duration") or 0)
        tokens_per_second = eval_count / eval_duration * 1_000_000_000 if eval_count and eval_duration else None
        return InferenceResult(
            provider=self.provider_id,
            model=model,
            text=text,
            usage=ProviderUsage(
                input_tokens=prompt_eval_count,
                output_tokens=eval_count,
                total_tokens=prompt_eval_count + eval_count,
                tokens_per_second=tokens_per_second,
            ),
            latency_ms=(time.perf_counter() - started) * 1000,
            cost_usd=0,
            metadata={"raw": data, "tokens_per_second": tokens_per_second},
        )

    async def stream(self, request: InferenceRequest) -> AsyncIterator[StreamChunk]:
        model = request.model or self.settings.ollama_chat_model
        payload: dict[str, Any] = {
            "model": model,
            "messages": [message.model_dump() for message in request.as_messages()],
            "stream": True,
            "options": {
                "temperature": request.temperature,
                "num_predict": request.max_tokens,
                "num_ctx": self.settings.ollama_context_tokens,
            },
        }
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", self._url("/chat"), json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    message = data.get("message") or {}
                    usage = ProviderUsage(
                        input_tokens=int(data.get("prompt_eval_count") or 0),
                        output_tokens=int(data.get("eval_count") or 0),
                        total_tokens=int(data.get("prompt_eval_count") or 0) + int(data.get("eval_count") or 0),
                    )
                    yield StreamChunk(
                        provider=self.provider_id,
                        model=model,
                        text=str(message.get("content") or ""),
                        done=bool(data.get("done")),
                        usage=usage,
                        metadata={"raw": data},
                    )

    async def embed(self, texts: list[str], model: str | None = None) -> list[list[float]]:
        if not texts:
            return []
        payload = {"model": model or self.settings.ollama_embedding_model, "input": texts}
        async with httpx.AsyncClient(timeout=self.settings.ollama_timeout_s) as client:
            response = await client.post(self._url("/embed"), json=payload)
            if response.status_code == 404:
                raise ProviderUnavailable("Ollama /api/embed is unavailable. Update Ollama or use /api/embeddings manually.")
            response.raise_for_status()
            data = response.json()
        embeddings = data.get("embeddings")
        if not isinstance(embeddings, list):
            raise ProviderUnavailable("Ollama embedding response did not contain embeddings.")
        return [[float(value) for value in row] for row in embeddings]
