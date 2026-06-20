from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..config import Settings
from ..models import InferenceRequest, InferenceResult, ProviderStatus, ProviderUsage, StreamChunk
from .base import ProviderAdapter, ProviderUnavailable


class OpenAICompatibleLocalProvider(ProviderAdapter):
    local = True
    paid = False
    capabilities = ["text.inference", "text.streaming", "memory.embedding"]

    def __init__(
        self,
        *,
        provider_id: str,
        label: str,
        base_url: str,
        settings: Settings,
        model: str | None = None,
        api_key: str | None = None,
    ):
        self.provider_id = provider_id
        self.label = label
        self.base_url = base_url
        self.model = model
        self.api_key = api_key
        self.settings = settings

    def _url(self, path: str) -> str:
        base = self.base_url.rstrip("/")
        return f"{base}{path}"

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def _models(self, timeout: float | None = None) -> list[str]:
        async with httpx.AsyncClient(timeout=timeout or self.settings.request_timeout_s) as client:
            response = await client.get(self._url("/models"), headers=self._headers())
            response.raise_for_status()
            data = response.json()
        return [str(item.get("id")) for item in data.get("data", []) if item.get("id")]

    async def _resolve_model(self, request_model: str | None = None) -> str:
        if request_model:
            return request_model
        if self.model:
            return self.model
        models = await self._models(timeout=self.settings.local_provider_status_timeout_s)
        if models:
            return models[0]
        raise ProviderUnavailable(f"{self.label} did not report any loaded models.")

    async def status(self) -> ProviderStatus:
        started = time.perf_counter()
        try:
            models = await self._models(timeout=self.settings.local_provider_status_timeout_s)
            return ProviderStatus(
                id=self.provider_id,
                label=self.label,
                available=True,
                local=True,
                paid=False,
                models=models[:60],
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

    def _messages(self, request: InferenceRequest) -> list[dict[str, str]]:
        return [{"role": message.role, "content": message.content} for message in request.as_messages()]

    def _usage(self, data: dict[str, Any]) -> ProviderUsage:
        usage = data.get("usage") or {}
        input_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
        output_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
        return ProviderUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=int(usage.get("total_tokens") or input_tokens + output_tokens),
        )

    def _extract_text(self, data: dict[str, Any]) -> str:
        choices = data.get("choices") or []
        if choices:
            first = choices[0] or {}
            message = first.get("message") or {}
            if isinstance(message.get("content"), str):
                return message["content"]
            if isinstance(first.get("text"), str):
                return first["text"]
        if isinstance(data.get("output_text"), str):
            return data["output_text"]
        return ""

    async def complete(self, request: InferenceRequest) -> InferenceResult:
        started = time.perf_counter()
        model = await self._resolve_model(request.model)
        payload = {
            "model": model,
            "messages": self._messages(request),
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.post(self._url("/chat/completions"), headers=self._headers(), json=payload)
            response.raise_for_status()
            data = response.json()
        return InferenceResult(
            provider=self.provider_id,
            model=model,
            text=self._extract_text(data),
            usage=self._usage(data),
            latency_ms=(time.perf_counter() - started) * 1000,
            cost_usd=0,
            metadata={"raw": data, "base_url": self.base_url},
        )

    async def stream(self, request: InferenceRequest) -> AsyncIterator[StreamChunk]:
        model = await self._resolve_model(request.model)
        payload = {
            "model": model,
            "messages": self._messages(request),
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", self._url("/chat/completions"), headers=self._headers(), json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line.removeprefix("data:").strip()
                    if raw == "[DONE]":
                        yield StreamChunk(provider=self.provider_id, model=model, done=True)
                        return
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    choices = data.get("choices") or []
                    first = choices[0] if choices else {}
                    delta = first.get("delta") or {}
                    text = str(delta.get("content") or first.get("text") or "")
                    yield StreamChunk(
                        provider=self.provider_id,
                        model=model,
                        text=text,
                        done=bool(first.get("finish_reason")),
                        metadata={"raw": data, "base_url": self.base_url},
                    )

    async def embed(self, texts: list[str], model: str | None = None) -> list[list[float]]:
        if not texts:
            return []
        resolved_model = model or self.model
        if not resolved_model:
            resolved_model = await self._resolve_model(None)
        payload = {"model": resolved_model, "input": texts}
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.post(self._url("/embeddings"), headers=self._headers(), json=payload)
            response.raise_for_status()
            data = response.json()
        rows = data.get("data")
        if not isinstance(rows, list):
            raise ProviderUnavailable(f"{self.label} embedding response did not contain data.")
        return [[float(value) for value in item.get("embedding", [])] for item in rows]
