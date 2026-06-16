from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ai_os.app import create_app
from ai_os.config import Settings
from ai_os.inference import InferenceRouter
from ai_os.jobs.primitives import JobPrimitives
from ai_os.jobs.queue import JobQueue
from ai_os.maintenance import BackupManager
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
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["ollama", "openai"])
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


def test_storage_migration_and_integrity_report(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False)
    storage = AppStorage(settings.database_path())

    report = storage.integrity_report()

    assert report["ok"] is True
    assert report["schema_version"] == report["expected_schema_version"]
    assert report["counts"]["schema_migrations"] == 1


def test_backup_verify_and_restore_to_target(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, backup_retention_count=3)
    storage = AppStorage(settings.database_path())
    storage.log_job_event("job_test", "info", "seed")
    backups = BackupManager(settings, storage)

    manifest = backups.create_backup(reason="test")
    verification = backups.verify_backup(manifest["id"])
    restored = backups.restore_to(manifest["id"], tmp_path / "restored.sqlite3")

    assert verification["ok"] is True
    assert restored["ok"] is True
    assert restored["restored"]["counts"]["job_events"] == 1


def test_request_bounds_reject_unbounded_jobs():
    with pytest.raises(ValidationError):
        JobCreateRequest(
            primitive="map",
            request=InferenceRequest(prompt="ok"),
            items=[str(index) for index in range(501)],
        )

    with pytest.raises(ValidationError):
        InferenceRequest(prompt="ok", max_tokens=9000)


def test_health_and_backup_endpoints(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        health = client.get("/api/ai/health/full")
        backup = client.post("/api/ai/backups", json={"reason": "testclient"})
        backup_id = backup.json()["backup"]["id"]
        verify = client.post(f"/api/ai/backups/{backup_id}/verify")
        restore = client.post(f"/api/ai/backups/{backup_id}/restore-test")

    assert health.status_code == 200
    assert health.json()["checks"]["database"]["ok"] is True
    assert backup.status_code == 200
    assert verify.json()["verification"]["ok"] is True
    assert restore.json()["restore"]["ok"] is True


def test_non_loopback_client_is_rejected(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, require_loopback=True)
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app, client=("198.51.100.10", 4123)) as client:
        response = client.get("/api/ai/health")

    assert response.status_code == 403


def test_configurable_resource_limits_are_enforced(tmp_path):
    settings = Settings(
        data_dir=tmp_path,
        backup_enabled=False,
        max_prompt_chars=5,
        max_job_items=2,
        max_memory_ingest_chars=10,
    )
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        infer = client.post("/api/ai/infer", json={"prompt": "too long"})
        job = client.post(
            "/api/ai/jobs",
            json={
                "primitive": "map",
                "request": {"prompt": "ok"},
                "items": ["a", "b", "c"],
            },
        )
        memory = client.post(
            "/api/ai/memory/ingest",
            json={"source_type": "note", "source_id": "x", "text": "this is too long"},
        )

    assert infer.status_code == 413
    assert job.status_code == 413
    assert memory.status_code == 413
