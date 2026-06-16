from __future__ import annotations

import time
from typing import Any

import httpx

from ..models import InferenceRequest, InferenceResult, ProviderStatus, ProviderUsage
from .base import ProviderAdapter, ProviderUnavailable


class SpecialistHttpProvider(ProviderAdapter):
    local = False
    paid = True

    def __init__(self, config: dict[str, Any]):
        provider_id = str(config.get("id") or "").strip()
        if not provider_id:
            raise ValueError("Specialist provider config requires id.")
        self.provider_id = f"specialist:{provider_id}"
        self.label = str(config.get("label") or provider_id)
        self.endpoint = str(config.get("endpoint") or "")
        self.api_key = config.get("api_key")
        self.default_model = str(config.get("model") or "default")
        self.capabilities = list(config.get("capabilities") or ["text.inference"])
        self.headers = dict(config.get("headers") or {})
        self.prompt_field = str(config.get("prompt_field") or "prompt")
        self.model_field = str(config.get("model_field") or "model")
        self.text_path = str(config.get("text_path") or "text")

    async def status(self) -> ProviderStatus:
        if not self.endpoint:
            return ProviderStatus(
                id=self.provider_id,
                label=self.label,
                available=False,
                local=False,
                paid=True,
                capabilities=self.capabilities,
                error="Specialist endpoint is not configured.",
            )
        return ProviderStatus(
            id=self.provider_id,
            label=self.label,
            available=True,
            local=False,
            paid=True,
            models=[self.default_model],
            capabilities=self.capabilities,
        )

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", **self.headers}
        if self.api_key:
            headers.setdefault("Authorization", f"Bearer {self.api_key}")
        return headers

    def _pluck(self, payload: dict[str, Any]) -> str:
        value: Any = payload
        for part in self.text_path.split("."):
            if isinstance(value, dict):
                value = value.get(part)
            else:
                return ""
        return value if isinstance(value, str) else str(value or "")

    async def complete(self, request: InferenceRequest) -> InferenceResult:
        if not self.endpoint:
            raise ProviderUnavailable("Specialist endpoint is not configured.")
        started = time.perf_counter()
        body = {
            self.model_field: request.model or self.default_model,
            self.prompt_field: "\n".join(message.content for message in request.as_messages()),
            "task_type": request.task_type,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "metadata": request.metadata,
        }
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(self.endpoint, headers=self._headers(), json=body)
            response.raise_for_status()
            data = response.json()
        return InferenceResult(
            provider=self.provider_id,
            model=request.model or self.default_model,
            text=self._pluck(data),
            usage=ProviderUsage(),
            latency_ms=(time.perf_counter() - started) * 1000,
            metadata={"raw": data},
        )
