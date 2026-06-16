from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..config import Settings
from ..models import ChatMessage, InferenceRequest, InferenceResult, ProviderStatus, ProviderUsage, StreamChunk
from .base import ProviderAdapter, ProviderUnavailable


class AnthropicProvider(ProviderAdapter):
    provider_id = "anthropic"
    label = "Anthropic API"
    local = False
    paid = True
    capabilities = ["text.inference", "text.streaming", "multimodal.vision"]

    def __init__(self, settings: Settings):
        self.settings = settings

    def _headers(self) -> dict[str, str]:
        if not self.settings.anthropic_api_key:
            raise ProviderUnavailable("ANTHROPIC_API_KEY is not configured.")
        return {
            "x-api-key": self.settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

    def _url(self, path: str) -> str:
        return f"{self.settings.anthropic_base_url.rstrip('/')}{path}"

    def _messages(self, request: InferenceRequest) -> tuple[str | None, list[dict[str, Any]]]:
        system_parts: list[str] = []
        messages: list[ChatMessage] = request.as_messages()
        user_messages: list[dict[str, Any]] = []
        for message in messages:
            if message.role == "system":
                system_parts.append(message.content)
            elif message.role == "tool":
                user_messages.append({"role": "user", "content": message.content})
            else:
                role = "assistant" if message.role == "assistant" else "user"
                user_messages.append({"role": role, "content": message.content})
        return ("\n".join(system_parts) if system_parts else None), user_messages

    async def status(self) -> ProviderStatus:
        if not self.settings.anthropic_api_key:
            return ProviderStatus(
                id=self.provider_id,
                label=self.label,
                available=False,
                local=False,
                paid=True,
                capabilities=self.capabilities,
                error="ANTHROPIC_API_KEY is not configured.",
            )
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(self._url("/models"), headers=self._headers())
                response.raise_for_status()
                data = response.json()
            models = [str(item.get("id")) for item in data.get("data", []) if item.get("id")]
            return ProviderStatus(
                id=self.provider_id,
                label=self.label,
                available=True,
                local=False,
                paid=True,
                models=models[:60],
                capabilities=self.capabilities,
                latency_ms=(time.perf_counter() - started) * 1000,
            )
        except Exception as error:
            return ProviderStatus(
                id=self.provider_id,
                label=self.label,
                available=False,
                local=False,
                paid=True,
                capabilities=self.capabilities,
                error=str(error),
                latency_ms=(time.perf_counter() - started) * 1000,
            )

    async def complete(self, request: InferenceRequest) -> InferenceResult:
        started = time.perf_counter()
        model = request.model or self.settings.anthropic_model
        system, messages = self._messages(request)
        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "messages": messages,
        }
        if system:
            payload["system"] = system
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.post(self._url("/messages"), headers=self._headers(), json=payload)
            response.raise_for_status()
            data = response.json()
        text = "\n".join(str(part.get("text", "")) for part in data.get("content", []) if part.get("type") == "text")
        usage_data = data.get("usage") or {}
        input_tokens = int(usage_data.get("input_tokens") or 0)
        output_tokens = int(usage_data.get("output_tokens") or 0)
        return InferenceResult(
            provider=self.provider_id,
            model=model,
            text=text,
            usage=ProviderUsage(input_tokens=input_tokens, output_tokens=output_tokens, total_tokens=input_tokens + output_tokens),
            latency_ms=(time.perf_counter() - started) * 1000,
            metadata={"raw": data},
        )

    async def stream(self, request: InferenceRequest) -> AsyncIterator[StreamChunk]:
        model = request.model or self.settings.anthropic_model
        system, messages = self._messages(request)
        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "messages": messages,
            "stream": True,
        }
        if system:
            payload["system"] = system
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", self._url("/messages"), headers=self._headers(), json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line.removeprefix("data:").strip()
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    delta = data.get("delta") or {}
                    yield StreamChunk(
                        provider=self.provider_id,
                        model=model,
                        text=str(delta.get("text") or ""),
                        done=data.get("type") in {"message_stop", "error"},
                        metadata={"raw": data},
                    )
