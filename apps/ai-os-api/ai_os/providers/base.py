from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from ..models import InferenceRequest, InferenceResult, ProviderStatus, StreamChunk


class ProviderError(RuntimeError):
    pass


class ProviderUnavailable(ProviderError):
    pass


class ProviderAdapter(ABC):
    provider_id: str
    label: str
    local: bool = False
    paid: bool = False
    capabilities: list[str] = ["text.inference"]

    @abstractmethod
    async def status(self) -> ProviderStatus:
        raise NotImplementedError

    @abstractmethod
    async def complete(self, request: InferenceRequest) -> InferenceResult:
        raise NotImplementedError

    async def stream(self, request: InferenceRequest) -> AsyncIterator[StreamChunk]:
        result = await self.complete(request)
        yield StreamChunk(
            provider=result.provider,
            model=result.model,
            text=result.text,
            done=True,
            usage=result.usage,
            metadata=result.metadata,
        )

    async def embed(self, texts: list[str], model: str | None = None) -> list[list[float]]:
        raise ProviderUnavailable(f"{self.provider_id} does not expose embeddings.")
