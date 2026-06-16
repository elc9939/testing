from __future__ import annotations

from collections.abc import Iterable

from ..config import Settings
from .anthropic import AnthropicProvider
from .base import ProviderAdapter
from .ollama import OllamaProvider
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
        OpenAIProvider(settings),
        AnthropicProvider(settings),
    ]
    for config in settings.specialist_providers:
        adapters.append(SpecialistHttpProvider(config))
    return ProviderRegistry(adapters)
