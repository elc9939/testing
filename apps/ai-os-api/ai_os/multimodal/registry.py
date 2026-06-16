from __future__ import annotations

from typing import Any

from ..models import ChatMessage, InferenceRequest, MultimodalInvokeRequest
from ..providers.ollama import OllamaProvider
from ..providers.openai_provider import OpenAIProvider
from ..providers.registry import ProviderRegistry


class MultimodalRegistry:
    def __init__(self, providers: ProviderRegistry):
        self.providers = providers

    async def invoke(self, kind: str, request: MultimodalInvokeRequest) -> dict[str, Any]:
        provider_id = request.provider or ("ollama" if kind == "vision" else "openai")
        provider = self.providers.get(provider_id)
        if not provider:
            raise ValueError(f"Unknown multimodal provider: {provider_id}")

        if kind == "image":
            if isinstance(provider, OpenAIProvider):
                return await provider.generate_image(request.prompt or "", request.model, request.options)
            if isinstance(provider, OllamaProvider):
                return await self._ollama_image(provider, request)
            raise ValueError(f"Provider {provider_id} does not expose image generation.")

        if kind == "audio_tts":
            if isinstance(provider, OpenAIProvider):
                return await provider.tts(request.text or request.prompt or "", request.model, request.options)
            raise ValueError(f"Provider {provider_id} does not expose text-to-speech.")

        if kind == "audio_stt":
            if isinstance(provider, OpenAIProvider):
                if not request.audio_base64:
                    raise ValueError("audio_base64 is required for speech-to-text.")
                return await provider.stt(request.audio_base64, request.filename or "audio.webm", request.model, request.options)
            raise ValueError(f"Provider {provider_id} does not expose speech-to-text.")

        if kind == "vision":
            if isinstance(provider, OllamaProvider):
                return await self._ollama_vision(provider, request)
            result = await provider.complete(
                InferenceRequest(
                    task_type="vision",
                    provider=provider_id,
                    model=request.model,
                    messages=[ChatMessage(role="user", content=request.prompt or "Describe this image.")],
                    metadata={"image_base64_present": bool(request.image_base64)},
                )
            )
            return result.model_dump(mode="json")

        raise ValueError(f"Unknown multimodal kind: {kind}")

    async def _ollama_vision(self, provider: OllamaProvider, request: MultimodalInvokeRequest) -> dict[str, Any]:
        if not request.image_base64:
            raise ValueError("image_base64 is required for Ollama vision.")
        import httpx

        payload = {
            "model": request.model or provider.settings.ollama_chat_model,
            "prompt": request.prompt or "Describe this image.",
            "images": [request.image_base64],
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=provider.settings.ollama_timeout_s) as client:
            response = await client.post(provider._url("/generate"), json=payload)
            response.raise_for_status()
            return response.json()

    async def _ollama_image(self, provider: OllamaProvider, request: MultimodalInvokeRequest) -> dict[str, Any]:
        import httpx

        payload = {
            "model": request.model or provider.settings.ollama_chat_model,
            "prompt": request.prompt or "",
            "stream": False,
            **request.options,
        }
        async with httpx.AsyncClient(timeout=provider.settings.ollama_timeout_s) as client:
            response = await client.post(provider._url("/generate"), json=payload)
            response.raise_for_status()
            return response.json()
