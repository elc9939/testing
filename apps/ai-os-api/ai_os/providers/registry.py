from __future__ import annotations

from collections.abc import Iterable

from ..config import Settings
from .anthropic import AnthropicProvider
from .base import ProviderAdapter
from .ollama import OllamaProvider
from .openai_compatible import OpenAICompatibleLocalProvider
from .openai_provider import OpenAIProvider
from .specialist import SpecialistHttpProvider


class ProviderRegistry:
    def __init__(self, adapters: Iterable[ProviderAdapter]):
        self._adapters = {adapter.provider_id: adapter for adapter in adapters}

    def all(self) -> list[ProviderAdapter]:
        return list(self._adapters.values())

    def get(self, provider_id: str) -> ProviderAdapter | None:
        return self._adapters.get(provider_id)

    def ids(self) -> list[str]:
        return list(self._adapters)


def build_provider_registry(settings: Settings) -> ProviderRegistry:
    adapters: list[ProviderAdapter] = [
        OllamaProvider(settings),
        OpenAICompatibleLocalProvider(
            provider_id="lmstudio",
            label="LM Studio Local",
            base_url=settings.lmstudio_base_url,
            model=settings.lmstudio_model,
            api_key=settings.lmstudio_api_key,
            settings=settings,
        ),
        OpenAICompatibleLocalProvider(
            provider_id="llamacpp",
            label="llama.cpp Server",
            base_url=settings.llamacpp_base_url,
            model=settings.llamacpp_model,
            api_key=settings.llamacpp_api_key,
            settings=settings,
        ),
        OpenAICompatibleLocalProvider(
            provider_id="vllm",
            label="vLLM Local Server",
            base_url=settings.vllm_base_url,
            model=settings.vllm_model,
            api_key=settings.vllm_api_key,
            settings=settings,
        ),
        OpenAIProvider(settings),
        AnthropicProvider(settings),
    ]
    for config in settings.specialist_providers:
        adapters.append(SpecialistHttpProvider(config))
    return ProviderRegistry(adapters)
