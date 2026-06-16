from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from ai_os.config import Settings
from ai_os.inference import InferenceRouter
from ai_os.jobs.primitives import JobPrimitives
from ai_os.jobs.queue import JobQueue
from ai_os.memory.store import SemanticMemory
from ai_os.models import InferenceRequest, InferenceResult, JobCreateRequest, MemoryIngestRequest, MemoryQueryRequest, ProviderStatus, ProviderUsage, StreamChunk
from ai_os.providers.base import ProviderAdapter, ProviderUnavailable
from ai_os.providers.registry import ProviderRegistry
from ai_os.storage import AppStorage


class FailingProvider(ProviderAdapter):
    provider_id = "ollama"
    label = "Failing local"
    local = True
    paid = False
    capabilities = ["text.inference", "text.streaming"]

    async def status(self) -> ProviderStatus:
        return ProviderStatus(id=self.provider_id, label=self.label, available=False, local=True, paid=False)

    async def complete(self, request: InferenceRequest) -> InferenceResult:
        raise ProviderUnavailable("local offline")


class EchoProvider(ProviderAdapter):
    provider_id = "openai"
    label = "Echo paid"
    local = False
    paid = True
    capabilities = ["text.inference", "text.streaming"]

    async def status(self) -> ProviderStatus:
        return ProviderStatus(id=self.provider_id, label=self.label, available=True, local=False, paid=True)

    async def complete(self, request: InferenceRequest) -> InferenceResult:
        text = "echo: " + request.as_messages()[-1].content
        return InferenceResult(
            provider=self.provider_id,
            model=request.model or "echo",
            text=text,
            usage=ProviderUsage(input_tokens=3, output_tokens=4, total_tokens=7),
            latency_ms=1,
        )

    async def stream(self, request: InferenceRequest) -> AsyncIterator[StreamChunk]:
        yield StreamChunk(provider=self.provider_id, model="echo", text="echo", done=False)
        yield StreamChunk(provider=self.provider_id, model="echo", text=" done", done=True)

    async def embed(self, texts: list[str], model: str | None = None) -> list[list[float]]:
        return [[float(len(text)), 1.0] for text in texts]


def make_router(tmp_path) -> tuple[InferenceRouter, AppStorage, ProviderRegistry]:
    settings = Settings(data_dir=tmp_path, provider_priority=["ollama", "openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([FailingProvider(), EchoProvider()])
    return InferenceRouter(settings, registry, storage), storage, registry


@pytest.mark.asyncio
async def test_router_falls_back_and_logs_usage(tmp_path):
    router, storage, _ = make_router(tmp_path)

    result = await router.infer(InferenceRequest(prompt="hello", allow_fallback=True))

    assert result.provider == "openai"
    assert result.text == "echo: hello"
    assert result.fallback_chain[0]["provider"] == "ollama"
    usage = storage.list_usage()
    assert len(usage) == 2
    assert usage[0].ok is True
    assert usage[1].ok is False


@pytest.mark.asyncio
async def test_memory_ingest_and_query_uses_embedding_provider(tmp_path):
    _, storage, registry = make_router(tmp_path)
    memory = SemanticMemory(storage, registry)

    await memory.ingest(
        MemoryIngestRequest(
            source_type="note",
            source_id="demo",
            title="Demo",
            text="linear algebra eigenvectors and matrix factorization",
            embedding_provider="openai",
        )
    )
    hits = await memory.query(MemoryQueryRequest(query="matrix", embedding_provider="openai", limit=1))

    assert len(hits) == 1
    assert hits[0].source_id == "demo"


@pytest.mark.asyncio
async def test_map_job_runs_without_blocking_ui(tmp_path):
    router, storage, _ = make_router(tmp_path)
    queue = JobQueue(storage, max_concurrency=2)
    JobPrimitives(router).register(queue)

    job = await queue.create(
        JobCreateRequest(
            primitive="map",
            request=InferenceRequest(prompt="placeholder"),
            items=["a", "b", "c"],
            template="process {item}",
        )
    )

    for _ in range(50):
        snapshot = queue.get(job.id)
        if snapshot and snapshot.status in {"succeeded", "failed", "cancelled"}:
            break
        await asyncio.sleep(0.02)

    snapshot = queue.get(job.id)
    assert snapshot is not None
    assert snapshot.status == "succeeded"
    assert snapshot.completed == 3
    assert len(queue.results(job.id)) == 3
