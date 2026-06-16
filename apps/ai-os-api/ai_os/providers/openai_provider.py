from __future__ import annotations

import base64
import json
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..config import Settings
from ..models import InferenceRequest, InferenceResult, ProviderStatus, ProviderUsage, StreamChunk
from .base import ProviderAdapter, ProviderUnavailable


class OpenAIProvider(ProviderAdapter):
    provider_id = "openai"
    label = "OpenAI API"
    local = False
    paid = True
    capabilities = [
        "text.inference",
        "text.streaming",
        "multimodal.image",
        "multimodal.audio_tts",
        "multimodal.audio_stt",
        "multimodal.vision",
    ]

    def __init__(self, settings: Settings):
        self.settings = settings

    def _headers(self) -> dict[str, str]:
        if not self.settings.openai_api_key:
            raise ProviderUnavailable("OPENAI_API_KEY is not configured.")
        return {"Authorization": f"Bearer {self.settings.openai_api_key}", "Content-Type": "application/json"}

    def _url(self, path: str) -> str:
        return f"{self.settings.openai_base_url.rstrip('/')}{path}"

    async def status(self) -> ProviderStatus:
        if not self.settings.openai_api_key:
            return ProviderStatus(
                id=self.provider_id,
                label=self.label,
                available=False,
                local=False,
                paid=True,
                capabilities=self.capabilities,
                error="OPENAI_API_KEY is not configured.",
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

    def _input(self, request: InferenceRequest) -> str | list[dict[str, Any]]:
        if request.messages:
            return [{"role": message.role, "content": message.content} for message in request.messages]
        return request.prompt or ""

    def _extract_text(self, data: dict[str, Any]) -> str:
        if isinstance(data.get("output_text"), str):
            return data["output_text"]
        parts: list[str] = []
        for output in data.get("output", []) or []:
            for content in output.get("content", []) or []:
                text = content.get("text") or content.get("transcript")
                if isinstance(text, str):
                    parts.append(text)
        if parts:
            return "\n".join(parts)
        return str(data.get("text") or "")

    async def complete(self, request: InferenceRequest) -> InferenceResult:
        started = time.perf_counter()
        model = request.model or self.settings.openai_model
        payload = {
            "model": model,
            "input": self._input(request),
            "temperature": request.temperature,
            "max_output_tokens": request.max_tokens,
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.post(self._url("/responses"), headers=self._headers(), json=payload)
            response.raise_for_status()
            data = response.json()
        usage_data = data.get("usage") or {}
        input_tokens = int(usage_data.get("input_tokens") or 0)
        output_tokens = int(usage_data.get("output_tokens") or 0)
        return InferenceResult(
            provider=self.provider_id,
            model=model,
            text=self._extract_text(data),
            usage=ProviderUsage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=int(usage_data.get("total_tokens") or input_tokens + output_tokens),
            ),
            latency_ms=(time.perf_counter() - started) * 1000,
            metadata={"raw": data},
        )

    async def stream(self, request: InferenceRequest) -> AsyncIterator[StreamChunk]:
        model = request.model or self.settings.openai_model
        payload = {
            "model": model,
            "input": self._input(request),
            "temperature": request.temperature,
            "max_output_tokens": request.max_tokens,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", self._url("/responses"), headers=self._headers(), json=payload) as response:
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
                    event_type = data.get("type")
                    delta = ""
                    if event_type in {"response.output_text.delta", "response.refusal.delta"}:
                        delta = str(data.get("delta") or "")
                    elif isinstance(data.get("delta"), str):
                        delta = data["delta"]
                    yield StreamChunk(
                        provider=self.provider_id,
                        model=model,
                        text=delta,
                        done=event_type in {"response.completed", "response.failed"},
                        metadata={"raw": data},
                    )

    async def generate_image(self, prompt: str, model: str | None = None, options: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = {"model": model or self.settings.openai_image_model, "prompt": prompt, **(options or {})}
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.post(self._url("/images/generations"), headers=self._headers(), json=payload)
            response.raise_for_status()
            return response.json()

    async def tts(self, text: str, model: str | None = None, options: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = {"model": model or self.settings.openai_tts_model, "input": text, "voice": "alloy", **(options or {})}
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.post(self._url("/audio/speech"), headers=self._headers(), json=payload)
            response.raise_for_status()
            return {
                "content_type": response.headers.get("content-type", "audio/mpeg"),
                "audio_base64": base64.b64encode(response.content).decode("ascii"),
            }

    async def stt(
        self,
        audio_base64: str,
        filename: str = "audio.webm",
        model: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        audio = base64.b64decode(audio_base64)
        data = {"model": model or self.settings.openai_stt_model, **{k: str(v) for k, v in (options or {}).items()}}
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_s) as client:
            response = await client.post(
                self._url("/audio/transcriptions"),
                headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                data=data,
                files={"file": (filename, audio, "application/octet-stream")},
            )
            response.raise_for_status()
            return response.json()
