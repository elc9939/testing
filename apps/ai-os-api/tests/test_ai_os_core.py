from __future__ import annotations

import asyncio
import base64
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ai_os.app import create_app
from ai_os.config import Settings
from ai_os.inference import InferenceRouter
from ai_os.jobs.primitives import JobPrimitives
from ai_os.jobs.queue import JobQueue
from ai_os.maintenance import BackupManager
from ai_os.media_engine import MediaPlan
from ai_os.memory.store import SemanticMemory
from ai_os.models import BenchmarkRunRecord, InferenceRequest, InferenceResult, JobCreateRequest, MemoryIngestRequest, MemoryQueryRequest, MultimodalInvokeRequest, ProviderStatus, ProviderUsage, ResearchReport, ResearchRunRecord, ResearchRunRequest, ResearchSourceRecord, StreamChunk, now_iso
from ai_os.multimodal.registry import MultimodalRegistry
from ai_os.providers.base import ProviderAdapter, ProviderUnavailable
from ai_os.providers.openai_compatible import OpenAICompatibleLocalProvider
from ai_os.providers.ollama import OllamaProvider
from ai_os.providers.registry import ProviderRegistry
from ai_os.recoverability import capture_file_pre_action_snapshot
from ai_os.research import dedupe_and_rank_sources, extract_clean_content, map_citations, normalize_url, plan_research
from ai_os.storage import AppStorage
from ai_os.telemetry import _parse_windows_gpu_payload
from ai_os.web_access import WebAccess


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


class LocalEchoProvider(EchoProvider):
    provider_id = "lmstudio"
    label = "Local echo"
    local = True
    paid = False


class FastLocalEchoProvider(EchoProvider):
    provider_id = "llamacpp"
    label = "Fast local echo"
    local = True
    paid = False


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


class FakeWebResponse:
    def __init__(self, url: str, body: str, content_type: str = "text/html; charset=utf-8", status_code: int = 200):
        self.url = url
        self.content = body.encode("utf-8")
        self.headers = {"content-type": content_type}
        self.status_code = status_code


def install_fake_web(monkeypatch, routes: dict[str, str]) -> None:
    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, headers=None):
            url_text = str(url)
            body = routes.get(url_text)
            if body is None:
                body = next((value for key, value in routes.items() if url_text.startswith(key)), "")
            return FakeWebResponse(url_text, body)

    monkeypatch.setattr("ai_os.web_access.httpx.AsyncClient", Client)


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
async def test_router_offline_mode_blocks_paid_fallback(tmp_path):
    router, storage, _ = make_router(tmp_path)

    with pytest.raises(Exception) as error:
        await router.infer(
            InferenceRequest(
                prompt="hello",
                allow_fallback=True,
                metadata={"machine_mode": {"id": "offline"}},
            )
        )

    assert "local offline" in str(error.value)
    usage = storage.list_usage()
    assert all(entry.provider != "openai" for entry in usage)
    assert usage[0].metadata["machine_mode"]["id"] == "offline"


@pytest.mark.asyncio
async def test_router_beast_mode_prefers_local_even_when_request_prefers_paid(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai", "lmstudio"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider(), LocalEchoProvider()])
    router = InferenceRouter(settings, registry, storage)

    result = await router.infer(
        InferenceRequest(
            prompt="hello",
            local_first=False,
            metadata={"machine_mode": {"id": "beast"}},
        )
    )

    assert result.provider == "lmstudio"
    assert result.metadata["machine_mode"]["id"] == "beast"


@pytest.mark.asyncio
async def test_router_beast_mode_uses_measured_local_speed(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["lmstudio", "llamacpp"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([LocalEchoProvider(), FastLocalEchoProvider()])
    router = InferenceRouter(settings, registry, storage)
    storage.log_benchmark(
        BenchmarkRunRecord(
            id="bench_slow",
            created_at=now_iso(),
            kind="text",
            provider="lmstudio",
            model="slow",
            prompt="seed",
            latency_ms=1200,
            tokens_per_second=5,
        )
    )
    storage.log_benchmark(
        BenchmarkRunRecord(
            id="bench_fast",
            created_at=now_iso(),
            kind="text",
            provider="llamacpp",
            model="fast",
            prompt="seed",
            latency_ms=600,
            tokens_per_second=60,
        )
    )

    result = await router.infer(
        InferenceRequest(
            prompt="hello",
            metadata={"machine_mode": {"id": "beast"}},
        )
    )

    assert result.provider == "llamacpp"


@pytest.mark.asyncio
async def test_router_balanced_preserves_explicit_paid_preference(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai", "lmstudio"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider(), LocalEchoProvider()])
    router = InferenceRouter(settings, registry, storage)

    result = await router.infer(
        InferenceRequest(
            prompt="hello",
            local_first=False,
            metadata={"machine_mode": {"id": "balanced"}},
        )
    )

    assert result.provider == "openai"
    assert result.metadata["machine_mode"]["id"] == "balanced"


@pytest.mark.asyncio
async def test_quiet_mode_clamps_map_job_concurrency(tmp_path):
    router, storage, _ = make_router(tmp_path)
    queue = JobQueue(storage, max_concurrency=4)
    JobPrimitives(router).register(queue)

    job = await queue.create(
        JobCreateRequest(
            primitive="map",
            request=InferenceRequest(prompt="placeholder"),
            items=["a", "b"],
            concurrency=4,
            metadata={"machine_mode": {"id": "quiet"}},
        )
    )

    assert queue.get(job.id).metadata["machine_mode"]["id"] == "quiet"
    assert queue.get(job.id).metadata["machine_mode"]["max_job_concurrency"] == 1


@pytest.mark.asyncio
async def test_multimodal_offline_mode_blocks_paid_default(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, builtin_media_enabled=False)
    storage = AppStorage(settings.database_path())
    multimodal = MultimodalRegistry(settings, ProviderRegistry([EchoProvider()]), storage)

    with pytest.raises(ValueError) as error:
        await multimodal.invoke(
            "image",
            MultimodalInvokeRequest(prompt="offline image", options={"machine_mode": {"id": "offline"}}),
        )

    assert "Offline Mode" in str(error.value)


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
    assert report["counts"]["schema_migrations"] == 7
    assert report["counts"]["research_runs"] == 0
    assert report["counts"]["research_pages"] == 0


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


def test_image_file_command_requires_confirmation_before_desktop_write(tmp_path):
    export_dir = tmp_path / "Desktop"
    settings = Settings(
        data_dir=tmp_path / "data",
        backup_enabled=False,
        provider_priority=["openai"],
        desktop_export_dir=export_dir,
    )
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/command",
            json={"objective": "create an ai image of a cat and add it to my desktop", "confirm_actions": False},
        )

    body = response.json()
    assert response.status_code == 200
    assert body["result"]["status"] == "needs_more_steps"
    assert body["tool_calls"][0]["tool_id"] == "media.generate_image_file"
    assert body["tool_calls"][0]["requires_confirmation"] is True
    assert body["tool_calls"][0]["ok"] is False
    assert not export_dir.exists()


def test_image_file_command_writes_to_configured_desktop_when_confirmed(monkeypatch, tmp_path):
    async def plan(_, prompt: str, kind: str) -> MediaPlan:
        return MediaPlan(
            prompt=prompt,
            palette=["#101820", "#2563eb", "#a78bfa", "#f8fafc"],
            mood="curious",
            motion="still",
            tempo_bpm=96,
            scale=[0, 2, 4, 7, 9],
            seed=999 + len(kind),
        )

    monkeypatch.setattr("ai_os.media_engine.BuiltinMediaEngine._plan", plan)
    export_dir = tmp_path / "Desktop"
    settings = Settings(
        data_dir=tmp_path / "data",
        backup_enabled=False,
        provider_priority=["openai"],
        desktop_export_dir=export_dir,
        builtin_media_width=320,
        builtin_media_height=256,
    )
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/command",
            json={"objective": "create an ai image of a cat and add it to my desktop", "confirm_actions": True},
        )
        ledger_response = client.get("/api/ai/action-ledger?limit=10")
        snapshots = storage.list_action_snapshots()

    body = response.json()
    assert response.status_code == 200
    assert ledger_response.status_code == 200
    assert body["result"]["status"] == "succeeded"
    assert body["tool_calls"][0]["tool_id"] == "media.generate_image_file"
    assert body["tool_calls"][0]["ok"] is True
    image_path = Path(body["tool_calls"][0]["result"]["desktop_path"])
    assert image_path.parent == export_dir.resolve()
    assert image_path.name == "ai-cat.png"
    assert image_path.read_bytes().startswith(b"\x89PNG")
    snapshot = snapshots[0]
    assert snapshot.action_type == "media.generate_image_file"
    assert snapshot.existed is False
    assert snapshot.target == str(image_path)
    assert body["tool_calls"][0]["result"]["pre_action_snapshot"]["id"] == snapshot.id
    ledger_tool = next(action for action in ledger_response.json()["actions"] if action["action_type"] == "media.generate_image_file")
    assert ledger_tool["recoverability"]["kind"] == "snapshot"
    assert ledger_tool["recoverability"]["reference_id"] == snapshot.id
    assert ledger_tool["recoverability"]["reversible"] is False


def test_file_pre_action_snapshot_copies_existing_bytes(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", backup_enabled=False)
    storage = AppStorage(settings.database_path())
    target = tmp_path / "target.txt"
    target.write_text("before", encoding="utf-8")

    snapshot = capture_file_pre_action_snapshot(
        settings=settings,
        storage=storage,
        source="test",
        action_type="test.write",
        target=target,
        content_type="text/plain",
    )

    assert snapshot.existed is True
    assert snapshot.snapshot_path is not None
    assert Path(snapshot.snapshot_path).read_text(encoding="utf-8") == "before"
    assert storage.get_action_snapshot(snapshot.id).snapshot_path == snapshot.snapshot_path


def test_action_snapshot_restore_requires_confirmation_and_logs_restore(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    target = tmp_path / "Desktop" / "note.txt"
    target.parent.mkdir(parents=True)
    target.write_text("before", encoding="utf-8")
    snapshot = capture_file_pre_action_snapshot(
        settings=settings,
        storage=storage,
        source="test",
        action_type="test.write",
        target=target,
        content_type="text/plain",
    )
    target.write_text("after", encoding="utf-8")
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        blocked = client.post(f"/api/ai/action-snapshots/{snapshot.id}/restore", json={})
        restored = client.post(f"/api/ai/action-snapshots/{snapshot.id}/restore", json={"confirm": True})
        ledger = client.get("/api/ai/action-ledger?limit=10")

    assert blocked.status_code == 409
    assert restored.status_code == 200
    assert target.read_text(encoding="utf-8") == "before"
    restore_body = restored.json()["restore"]
    pre_restore = restore_body["pre_action_snapshot"]
    assert Path(pre_restore["snapshot_path"]).read_text(encoding="utf-8") == "after"
    restore_actions = [action for action in ledger.json()["actions"] if action["action_type"] == "action_snapshot.restore"]
    assert any(action["status"] == "blocked" for action in restore_actions)
    succeeded = next(action for action in restore_actions if action["status"] == "succeeded")
    assert succeeded["recoverability"]["kind"] == "snapshot"
    assert succeeded["recoverability"]["reference_id"] == pre_restore["id"]
    assert succeeded["recoverability"]["reversible"] is True


def test_web_tools_are_registered_and_visible_as_capabilities(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        tools = client.get("/api/ai/tools").json()["tools"]
        capabilities = client.get("/api/ai/capabilities").json()["capabilities"]

    tool_ids = {tool["id"] for tool in tools}
    capability_ids = {capability["id"] for capability in capabilities}
    assert {"web.search", "web.scrape", "browser.extract"}.issubset(tool_ids)
    assert {"web.search", "web.scrape", "browser.extract"}.issubset(capability_ids)


def test_web_scrape_command_extracts_text_links_and_logs(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://example.test/notes": """
            <html>
              <head><title>Research Notes</title><meta name="description" content="Course notes"></head>
              <body><main><h1>Important update</h1><p>Graph theory deadline is Friday.</p>
              <a href="/syllabus">Syllabus</a></main></body>
            </html>
            """,
        },
    )
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.post("/api/ai/command", json={"objective": "scrape https://example.test/notes"})

    body = response.json()
    result = body["tool_calls"][0]["result"]
    assert response.status_code == 200
    assert body["tool_calls"][0]["tool_id"] == "web.scrape"
    assert body["tool_calls"][0]["ok"] is True
    assert result["title"] == "Research Notes"
    assert "Graph theory deadline is Friday" in result["text"]
    assert result["links"][0]["url"] == "https://example.test/syllabus"


def test_web_search_command_returns_results(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://duckduckgo.com/html/": """
            <html><body>
              <div class="result">
                <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdiscrete">Discrete math guide</a>
                <a class="result__snippet">Sets, proofs, and graphs.</a>
              </div>
            </body></html>
            """,
        },
    )
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.post("/api/ai/command", json={"objective": "search the web for discrete math"})

    result = response.json()["tool_calls"][0]["result"]
    assert response.status_code == 200
    assert response.json()["tool_calls"][0]["tool_id"] == "web.search"
    assert result["result_count"] == 1
    assert result["results"][0]["title"] == "Discrete math guide"
    assert result["results"][0]["url"] == "https://example.com/discrete"


@pytest.mark.asyncio
async def test_web_scraper_blocks_private_hosts_by_default(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False)
    web = WebAccess(settings)

    with pytest.raises(ValueError, match="Private/local"):
        await web.scrape("http://127.0.0.1:8791/private")


def test_browser_extract_command_falls_back_to_http_scraper(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://example.test/app": """
            <html><head><title>Rendered fallback</title></head>
            <body><p>Browser fallback content.</p></body></html>
            """,
        },
    )

    async def unavailable_browser(*args, **kwargs):
        raise RuntimeError("headless browser unavailable")

    monkeypatch.setattr("ai_os.web_access.WebAccess._extract_with_browser", unavailable_browser)
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.post("/api/ai/command", json={"objective": "open https://example.test/app in browser"})

    result = response.json()["tool_calls"][0]["result"]
    assert response.status_code == 200
    assert response.json()["tool_calls"][0]["tool_id"] == "browser.extract"
    assert result["mode"] == "http-fallback"
    assert result["browser_available"] is False
    assert "Browser fallback content" in result["text"]


def test_research_planner_normalizes_urls_and_knobs():
    request = ResearchRunRequest(
        mode="deep_research",
        goal="Compare https://Example.com:443/path/?utm_source=x&b=2&a=1#frag for quant research",
        depth=3,
        max_pages=12,
        include_domains=["example.com"],
    )

    plan = plan_research(request)

    assert plan.crawl_targets == ["https://example.com/path?a=1&b=2"]
    assert plan.search_queries[0] == "Compare for quant research"
    assert plan.knobs["depth"] == 3
    assert normalize_url("HTTPS://Example.com:443/path/?utm_campaign=x&b=2&a=1#frag") == "https://example.com/path?a=1&b=2"


def test_research_extractor_keeps_metadata_tables_links_and_canonical():
    extracted = extract_clean_content(
        """
        <html>
          <head>
            <title>Source Title</title>
            <link rel="canonical" href="/canonical">
            <meta name="author" content="Ada Lovelace">
            <meta property="article:published_time" content="2026-06-20">
            <meta name="description" content="A compact source">
          </head>
          <body>
            <nav>Skip me</nav>
            <main><h1>Main Claim</h1><p>Important research claim with evidence.</p>
            <table><tr><th>Metric</th><th>Value</th></tr><tr><td>Speed</td><td>42</td></tr></table>
            <a href="/next">Next</a></main>
          </body>
        </html>
        """,
        base_url="https://example.com/page",
    )

    assert extracted["title"] == "Source Title"
    assert extracted["author"] == "Ada Lovelace"
    assert extracted["published_at"] == "2026-06-20"
    assert extracted["canonical_url"] == "https://example.com/canonical"
    assert "Skip me" not in extracted["text"]
    assert extracted["tables"][0]["rows"][1] == ["Speed", "42"]
    assert extracted["links"][0]["url"] == "https://example.com/next"


def test_research_dedupes_ranks_and_maps_citations():
    sources = [
        ResearchSourceRecord(
            id="source_a",
            url="https://example.com/a",
            canonical_url="https://example.com/a",
            title="Quant research role",
            description="Quant research uses statistics and modeling.",
            text="Quant research uses statistics and modeling. Follow-up detail.",
            text_length=80,
            fetched_at=now_iso(),
        ),
        ResearchSourceRecord(
            id="source_b",
            url="https://example.com/a?utm_source=dup",
            canonical_url="https://example.com/a",
            title="Duplicate",
            description="Short duplicate",
            text="Short duplicate",
            text_length=15,
            fetched_at=now_iso(),
        ),
        ResearchSourceRecord(
            id="source_c",
            url="https://other.example/report",
            canonical_url="https://other.example/report",
            title="Software engineering",
            description="Different topic",
            text="Software engineering source.",
            text_length=28,
            fetched_at=now_iso(),
        ),
    ]

    ranked = dedupe_and_rank_sources(sources, "quant research statistics modeling", 5)
    report = ResearchReport(title="Research", key_facts=["Quant research uses statistics and modeling. [S1]"])
    citations = map_citations(report, ranked)

    assert [source.canonical_url for source in ranked] == ["https://example.com/a", "https://other.example/report"]
    assert ranked[0].id == "S1"
    assert citations[0].source_ids == ["S1"]
    assert "statistics and modeling" in (citations[0].quote or "")


def test_research_endpoint_archives_caches_exports_and_logs(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://duckduckgo.com/html/": """
            <html><body>
              <div class="result">
                <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.test%2Fresearch">Research source</a>
                <a class="result__snippet">Useful source snippet.</a>
              </div>
            </body></html>
            """,
            "https://example.test/research": """
            <html><head><title>Research source</title>
            <meta name="author" content="Researcher">
            <meta name="description" content="Important source description"></head>
            <body><main><p>Research engines gather sources, extract claims, and cite evidence.</p>
            <a href="/more">More</a></main></body></html>
            """,
            "https://example.test/robots.txt": "User-agent: *\nAllow: /\n",
        },
    )
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        first = client.post(
            "/api/ai/research/runs",
            json={"mode": "quick_search", "goal": "research engines cite evidence", "max_pages": 3, "save_to_memory": True},
        )
        second = client.post(
            "/api/ai/research/runs",
            json={"mode": "url_scrape", "goal": "cache check", "seed_urls": ["https://example.test/research"], "max_pages": 1},
        )
        listed = client.get("/api/ai/research/runs")
        first_final = client.get(f"/api/ai/research/runs/{first.json()['run']['id']}")
        second_final = client.get(f"/api/ai/research/runs/{second.json()['run']['id']}")
        markdown = client.get(f"/api/ai/research/runs/{first.json()['run']['id']}/export?format=markdown")
        ledger = client.get("/api/ai/action-ledger?limit=20")
        memory = client.post("/api/ai/memory/query", json={"query": "cite evidence", "limit": 1})

    first_run = first_final.json()["run"]
    second_run = second_final.json()["run"]
    assert first.status_code == 200
    assert first.json()["run"]["status"] == "queued"
    assert first_run["status"] == "succeeded"
    assert first_run["progress"] == 1
    assert first_run["completed_steps"] == first_run["total_steps"]
    assert first_run["memory_document_id"]
    assert first_run["memory_chunks"] > 0
    assert first_run["sources"][0]["title"] == "Research source"
    assert first_run["citations"][0]["source_ids"] == ["S1"]
    assert second_run["cached_pages"] == 1
    assert listed.json()["runs"][0]["id"] == second_run["id"]
    assert "# Quick Search: research engines cite evidence" in markdown.text
    assert any(action["action_type"].startswith("research.") for action in ledger.json()["actions"])
    assert memory.json()["hits"][0]["source_type"] == "research_run"
    assert memory.json()["hits"][0]["source_id"] == first_run["id"]


def test_research_cancel_marks_running_run_and_ledger_metadata(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False)
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)
    storage.log_research_run(
        ResearchRunRecord(
            id="research_cancel_test",
            created_at=now_iso(),
            updated_at=now_iso(),
            mode="deep_research",
            goal="cancel this research run",
            status="running",
            report=ResearchReport(title="Deep Research: cancel this research run", tldr="Running"),
            logs=[],
            progress=0.4,
            total_steps=10,
            completed_steps=4,
            current_step="Fetching sources",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/ai/research/runs/research_cancel_test/cancel")
        ledger = client.get("/api/ai/action-ledger?limit=20")

    body = response.json()["run"]
    assert response.status_code == 200
    assert body["status"] == "cancelled"
    assert body["cancel_requested"] is True
    assert body["current_step"] == "Cancelled"
    research_action = next(action for action in ledger.json()["actions"] if action["id"] == "ai-research:research_cancel_test")
    assert research_action["status"] == "cancelled"
    assert research_action["metadata"]["progress"] == 0.4
    assert research_action["metadata"]["cancel_requested"] is True


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


def test_machine_profile_endpoint_records_snapshot(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        profile_response = client.get("/api/ai/machine-profile?mode=maintenance")
        snapshot_response = client.post("/api/ai/machine-profile/snapshots", json={"source": "test"})
        status_response = client.get("/api/ai/status?mode=maintenance")
        integrity_ok = storage.integrity_report()["ok"]

    profile = profile_response.json()["profile"]
    snapshot = snapshot_response.json()["snapshot"]
    status = status_response.json()
    assert profile_response.status_code == 200
    assert profile["host"]["system"]
    assert profile["provider_summary"]["available"] == 1
    assert profile["autotune"]["mode"] == "maintenance"
    assert profile["autotune"]["suggested_max_job_concurrency"] <= 2
    assert snapshot["source"] == "test"
    assert snapshot["profile"]["provider_summary"]["available"] == 1
    assert status["machine_profile"]["mode"] == "maintenance"
    assert integrity_ok is True


def test_autotune_endpoint_runs_probe_and_persists_snapshot(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.post("/api/ai/autotune", json={"mode": "beast", "provider": "openai", "max_tokens": 32})
        usage = storage.list_usage(5)
        snapshots = storage.list_machine_profile_snapshots()
        benchmark_count = storage.data_counts()["benchmark_runs"]

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["benchmark"]["ok"] is True
    assert body["profile"]["autotune"]["mode"] == "beast"
    assert body["snapshot"]["source"] == "autotune:beast"
    assert benchmark_count == 1
    assert snapshots[0].autotune["ok"] is True
    assert usage[0].metadata["autotune"] is True
    assert usage[0].metadata["machine_mode"]["id"] == "beast"


def test_action_ledger_combines_ai_os_logs_and_recoverability(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, provider_priority=["openai"])
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([JsonToolPlanProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        command = client.post("/api/ai/command", json={"objective": "Add a study session", "confirm_actions": False})
        benchmark = client.post("/api/ai/benchmarks", json={"kind": "text", "prompt": "bench"})
        backup = client.post("/api/ai/backups", json={"reason": "ledger-test"})
        snapshot = client.post("/api/ai/machine-profile/snapshots", json={"source": "ledger-test"})
        ledger = client.get("/api/ai/action-ledger?limit=20")

    assert command.status_code == 200
    assert benchmark.status_code == 200
    assert backup.status_code == 200
    assert snapshot.status_code == 200
    assert ledger.status_code == 200
    actions = ledger.json()["actions"]
    by_type = {action["action_type"]: action for action in actions}
    assert by_type["study.add_session"]["status"] == "blocked"
    assert by_type["study.add_session"]["recoverability"]["reversible"] is True
    assert by_type["benchmark.text"]["recoverability"]["kind"] == "snapshot"
    assert by_type["backup.create"]["recoverability"]["kind"] == "backup"
    assert by_type["machine_profile.snapshot"]["recoverability"]["kind"] == "snapshot"


def test_backup_verify_and_restore_to_target(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, backup_retention_count=3)
    storage = AppStorage(settings.database_path())
    storage.log_job_event("job_test", "info", "seed")
    target = tmp_path / "target.txt"
    target.write_text("recover me", encoding="utf-8")
    capture_file_pre_action_snapshot(
        settings=settings,
        storage=storage,
        source="test",
        action_type="test.write",
        target=target,
        content_type="text/plain",
    )
    backups = BackupManager(settings, storage)

    manifest = backups.create_backup(reason="test")
    verification = backups.verify_backup(manifest["id"])
    restored = backups.restore_to(manifest["id"], tmp_path / "restored.sqlite3")

    assert any(file["role"] == "action-snapshot" for file in manifest["files"])
    assert verification["ok"] is True
    assert restored["ok"] is True
    assert restored["restored"]["counts"]["job_events"] == 1
    assert restored["restored"]["counts"]["action_snapshots"] == 1


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


@pytest.mark.asyncio
async def test_builtin_media_engine_generates_image_audio_and_video(monkeypatch, tmp_path):
    async def plan(_, prompt: str, kind: str) -> MediaPlan:
        return MediaPlan(
            prompt=prompt,
            palette=["#101820", "#2563eb", "#a78bfa", "#f8fafc"],
            mood="focused",
            motion="pulse",
            tempo_bpm=112,
            scale=[0, 2, 5, 7, 9],
            seed=12345 + len(kind),
        )

    monkeypatch.setattr("ai_os.media_engine.BuiltinMediaEngine._plan", plan)
    settings = Settings(
        data_dir=tmp_path,
        backup_enabled=False,
        builtin_media_width=320,
        builtin_media_height=256,
        builtin_audio_duration_s=1,
        builtin_video_frames=4,
    )
    storage = AppStorage(settings.database_path())
    multimodal = MultimodalRegistry(settings, ProviderRegistry([]), storage)

    image = await multimodal.invoke("image", MultimodalInvokeRequest(prompt="blue technical image"))
    audio = await multimodal.invoke("audio", MultimodalInvokeRequest(prompt="soft synth audio"))
    video = await multimodal.invoke("video", MultimodalInvokeRequest(prompt="animated study loop"))

    assert image["provider"] == "builtin-image"
    assert image["content_type"] == "image/png"
    assert base64.b64decode(image["image_base64"]).startswith(b"\x89PNG")
    assert audio["provider"] == "builtin-audio"
    assert audio["content_type"] == "audio/wav"
    assert base64.b64decode(audio["audio_base64"]).startswith(b"RIFF")
    assert video["provider"] == "builtin-video"
    assert video["content_type"] == "image/gif"
    assert base64.b64decode(video["video_base64"]).startswith(b"GIF")
    assert [asset.kind for asset in storage.list_generation_assets(3)] == ["video", "audio", "image"]


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


def test_windows_gpu_payload_reports_amd_vram_and_utilization():
    payload = {
        "controllers": {
            "Name": "AMD Radeon RX 6600",
            "Status": "OK",
            "AdapterRAM": 4_293_918_720,
            "DriverVersion": "32.0.21043.12001",
            "VideoProcessor": "AMD Radeon Graphics Processor (0x73FF)",
            "PNPDeviceID": "PCI\\VEN_1002&DEV_73FF",
        },
        "memory": [
            {"Name": "luid_0x00000000_0x00011095_phys_0", "DedicatedUsage": 0, "SharedUsage": 8192, "TotalCommitted": 44_748_800},
            {
                "Name": "luid_0x00000000_0x0000F6A2_phys_0",
                "DedicatedUsage": 7_944_622_080,
                "SharedUsage": 904_716_288,
                "TotalCommitted": 9_491_738_624,
            },
        ],
        "engines": [
            {"Name": "pid_1_luid_0x00000000_0x0000F6A2_phys_0_eng_2_engtype_Compute 0", "UtilizationPercentage": 12.5},
            {"Name": "pid_2_luid_0x00000000_0x0000F6A2_phys_0_eng_4_engtype_Copy", "UtilizationPercentage": 1},
        ],
        "registryMemory": [
            {
                "Name": "AMD Radeon RX 6600",
                "MatchingDeviceId": "PCI\\VEN_1002&DEV_73FF&SUBSYS_52171849&REV_C7",
                "MemorySize": 4_293_918_720,
                "QwMemorySize": 8_573_157_376,
            }
        ],
    }

    gpus = _parse_windows_gpu_payload(payload)

    assert gpus[0]["name"] == "AMD Radeon RX 6600"
    assert gpus[0]["vendor"] == "AMD"
    assert gpus[0]["utilization_percent"] == 13.5
    assert gpus[0]["memory_used_mb"] == pytest.approx(7576.6, rel=0.01)
    assert gpus[0]["memory_reported_total_mb"] == pytest.approx(4095, rel=0.01)
    assert gpus[0]["memory_total_mb"] == pytest.approx(8176.0, rel=0.01)
    assert gpus[0]["memory_total_source"] == "driver-registry"
    assert gpus[0]["temperature_c"] is None
    assert gpus[0]["temperature_source"] == "unavailable"


@pytest.mark.asyncio
async def test_windows_speech_fallbacks_can_generate_and_transcribe(monkeypatch, tmp_path):
    def fake_available() -> bool:
        return True

    def fake_powershell(script: str, args: list[str], timeout: float) -> subprocess.CompletedProcess[str]:
        if "SpeechSynthesizer" in script:
            Path(args[1]).write_bytes(b"RIFFfake wav")
        else:
            Path(args[1]).write_text("local speech smoke test", encoding="utf-8")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("ai_os.multimodal.registry._windows_speech_available", fake_available)
    monkeypatch.setattr("ai_os.multimodal.registry._run_windows_powershell", fake_powershell)
    settings = Settings(data_dir=tmp_path, backup_enabled=False)
    storage = AppStorage(settings.database_path())
    multimodal = MultimodalRegistry(settings, ProviderRegistry([]), storage)

    adapters = multimodal.capability_adapters()
    assert adapters["multimodal.audio_tts"]["windows-tts"] is True
    assert adapters["multimodal.audio_stt"]["windows-stt"] is True

    tts = await multimodal.invoke("audio_tts", MultimodalInvokeRequest(text="hello"))
    stt = await multimodal.invoke(
        "audio_stt",
        MultimodalInvokeRequest(audio_base64=tts["audio_base64"], filename="speech.wav"),
    )

    assert tts["provider"] == "windows-tts"
    assert base64.b64decode(tts["audio_base64"]).startswith(b"RIFF")
    assert stt["provider"] == "windows-stt"
    assert stt["text"] == "local speech smoke test"
