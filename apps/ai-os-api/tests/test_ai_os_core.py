from __future__ import annotations

import asyncio
import base64
import sys
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
from ai_os.models import InferenceRequest, InferenceResult, JobCreateRequest, MemoryIngestRequest, MemoryQueryRequest, MultimodalInvokeRequest, ProviderStatus, ProviderUsage, StreamChunk
from ai_os.multimodal.registry import MultimodalRegistry
from ai_os.providers.base import ProviderAdapter, ProviderUnavailable
from ai_os.providers.openai_compatible import OpenAICompatibleLocalProvider
from ai_os.providers.ollama import OllamaProvider
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


class JsonToolPlanProvider(EchoProvider):
    async def complete(self, request: InferenceRequest) -> InferenceResult:
        return InferenceResult(
            provider=self.provider_id,
            model=request.model or "json-tool-plan",
            text=(
                '{"plan":"Use the study tool.","tool_calls":['
                '{"tool_id":"study.add_session","arguments":{"subject":"Linear algebra","minutes":25}}'
                '],"done":true,"output":"Prepared a study session."}'
            ),
            usage=ProviderUsage(input_tokens=5, output_tokens=5, total_tokens=10),
            latency_ms=1,
        )


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
    assert report["counts"]["schema_migrations"] == 2


def test_command_endpoint_blocks_write_tools_without_confirmation(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([JsonToolPlanProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.post("/api/ai/command", json={"objective": "Add a study session", "confirm_actions": False})

    body = response.json()
    assert response.status_code == 200
    assert body["tool_calls"][0]["tool_id"] == "study.add_session"
    assert body["tool_calls"][0]["requires_confirmation"] is True
    assert body["tool_calls"][0]["ok"] is False


def test_design_patch_endpoint_stores_unified_diff(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)
    patch = "\n".join(
        [
            "diff --git a/apps/hub/src/lib/demo.ts b/apps/hub/src/lib/demo.ts",
            "--- a/apps/hub/src/lib/demo.ts",
            "+++ b/apps/hub/src/lib/demo.ts",
            "@@ -1 +1 @@",
            "-export const demo = false;",
            "+export const demo = true;",
        ]
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/design/patches",
            json={"instruction": "Flip demo flag.", "target_files": ["apps/hub/src/lib/demo.ts"], "patch": patch},
        )

    body = response.json()
    assert response.status_code == 200
    assert body["patch"]["status"] == "proposed"
    assert body["patch"]["target_files"] == ["apps/hub/src/lib/demo.ts"]


def test_benchmark_endpoint_logs_run(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.post("/api/ai/benchmarks", json={"kind": "text", "prompt": "bench"})
        listed = client.get("/api/ai/benchmarks")

    assert response.status_code == 200
    assert response.json()["benchmark"]["ok"] is True
    assert listed.json()["benchmarks"][0]["prompt"] == "bench"


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


@pytest.mark.asyncio
async def test_ollama_provider_uses_configured_context(monkeypatch, tmp_path):
    captured: dict[str, object] = {}

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"message": {"content": "ok"}, "eval_count": 1, "prompt_eval_count": 1}

    class Client:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json):
            captured["url"] = url
            captured["json"] = json
            return Response()

    monkeypatch.setattr("ai_os.providers.ollama.httpx.AsyncClient", Client)
    provider = OllamaProvider(Settings(data_dir=tmp_path, backup_enabled=False, ollama_context_tokens=8192))

    result = await provider.complete(InferenceRequest(prompt="hello"))

    assert result.text == "ok"
    assert captured["json"]["options"]["num_ctx"] == 8192


@pytest.mark.asyncio
async def test_openai_compatible_local_provider_completes(monkeypatch, tmp_path):
    captured: dict[str, object] = {}

    class Response:
        def __init__(self, payload: dict[str, object]):
            self.payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return self.payload

    class Client:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, headers=None):
            return Response({"data": [{"id": "local-model"}]})

        async def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return Response(
                {
                    "choices": [{"message": {"content": "local ok"}}],
                    "usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
                }
            )

    monkeypatch.setattr("ai_os.providers.openai_compatible.httpx.AsyncClient", Client)
    provider = OpenAICompatibleLocalProvider(
        provider_id="lmstudio",
        label="LM Studio Local",
        base_url="http://127.0.0.1:1234/v1",
        api_key="local-key",
        settings=Settings(data_dir=tmp_path, backup_enabled=False),
    )

    result = await provider.complete(InferenceRequest(prompt="hello"))

    assert result.provider == "lmstudio"
    assert result.model == "local-model"
    assert result.text == "local ok"
    assert result.usage.total_tokens == 5
    assert captured["url"] == "http://127.0.0.1:1234/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer local-key"


@pytest.mark.asyncio
async def test_local_video_generation_command_records_asset(tmp_path):
    command = (
        f'"{sys.executable}" -c "import os, pathlib; '
        "pathlib.Path(os.environ['AI_OS_MEDIA_OUTPUT']).write_bytes(b'fake-video')" + '"'
    )
    settings = Settings(
        data_dir=tmp_path,
        backup_enabled=False,
        local_video_command=command,
        local_video_extension=".mp4",
    )
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([])
    multimodal = MultimodalRegistry(settings, registry, storage)

    result = await multimodal.invoke("video", MultimodalInvokeRequest(prompt="demo video"))

    assert result["provider"] == "local-video"
    assert result["content_type"] == "video/mp4"
    assert base64.b64decode(result["video_base64"]) == b"fake-video"
    assets = storage.list_generation_assets()
    assert assets[0].kind == "video"
    assert assets[0].provider == "local-video"
    assert assets[0].asset_path


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


def test_trusted_web_origin_gets_private_network_header(tmp_path):
    settings = Settings(
        data_dir=tmp_path,
        backup_enabled=False,
        trusted_origins=["https://elc9939.github.io"],
    )
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.get("/api/ai/health", headers={"Origin": "https://elc9939.github.io"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://elc9939.github.io"
    assert response.headers["access-control-allow-private-network"] == "true"


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
