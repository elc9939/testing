from __future__ import annotations

import asyncio
import base64
import json
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
from ai_os.research import dedupe_and_rank_sources, extract_clean_content, extract_structured_urls, map_citations, normalize_url, plan_research
from ai_os.storage import AppStorage
from ai_os.payload_safety import compact_large_payloads
import ai_os.telemetry as telemetry
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
    assert report["counts"]["schema_migrations"] == 8
    assert report["counts"]["research_runs"] == 0
    assert report["counts"]["research_pages"] == 0
    assert report["counts"]["research_monitors"] == 0


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


def test_research_planner_compacts_career_discovery_searches():
    request = ResearchRunRequest(
        mode="monitor_topic",
        goal=(
            "Find source-backed career opportunities for May 2027 / Summer 2027 start data and analytics "
            "role boards. Only prioritize roles that explicitly fit the saved profile. Hard profile guardrail: "
            "reject roles whose source-local graduation year, class year, start date, or eligibility conflicts "
            "with the May/Summer 2027 profile."
        ),
        max_pages=80,
        time_budget_s=1200,
        metadata={
            "career_discovery": True,
            "target_start_window": "May 2027 / Summer 2027 start",
            "source_lane": "data-analytics",
            "target_roles": ["Data Analyst", "Quant Research Intern", "Machine Learning Intern"],
            "locations": ["New York", "Remote"],
        },
    )

    plan = plan_research(request)

    assert plan.search_queries
    assert all(len(query) <= 180 for query in plan.search_queries)
    assert any("Data Analyst" in query for query in plan.search_queries)
    assert any("Summer 2027" in query for query in plan.search_queries)
    assert all("Hard profile guardrail" not in query for query in plan.search_queries)
    assert plan.knobs["max_pages"] == 80
    assert plan.knobs["time_budget_s"] == 1200


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


def test_research_structured_discovery_extracts_sitemaps_and_feeds():
    sitemap = extract_structured_urls(
        """
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/posts.xml</loc></sitemap>
        </sitemapindex>
        """,
        base_url="https://example.com/sitemap.xml",
    )
    rss = extract_structured_urls(
        """
        <rss><channel><item><title>Update</title><link>/updates/1</link></item></channel></rss>
        """,
        base_url="https://example.com/feed.xml",
    )
    html_links = extract_structured_urls(
        """
        <html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>
        """,
        base_url="https://example.com/",
    )

    assert sitemap == [{"url": "https://example.com/posts.xml", "kind": "sitemap_index"}]
    assert rss == [{"url": "https://example.com/updates/1", "kind": "feed"}]
    assert html_links == [{"url": "https://example.com/rss.xml", "kind": "feed"}]


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
        source_library = client.get("/api/ai/research/sources?q=evidence&domain=example.test")
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
    assert source_library.status_code == 200
    assert source_library.json()["sources"][0]["title"] == "Research source"
    assert "Research engines gather sources" in source_library.json()["sources"][0]["text_preview"]
    assert source_library.json()["sources"][0]["matched_terms"] == ["evidence"]
    assert source_library.json()["sources"][0]["fetch_count"] >= 1
    assert any(action["action_type"].startswith("research.") for action in ledger.json()["actions"])
    assert memory.json()["hits"][0]["source_type"] == "research_run"
    assert memory.json()["hits"][0]["source_id"] == first_run["id"]


def test_research_site_crawl_prefers_structured_sitemap_and_feed_targets(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://example.test/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap.xml\n",
            "https://example.test/": """
            <html><head><title>Home</title>
            <link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>
            <body><main><p>Home page with feed.</p></main></body></html>
            """,
            "https://example.test/sitemap.xml": """
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://example.test/sitemap-page</loc></url>
            </urlset>
            """,
            "https://example.test/feed.xml": """
            <rss><channel><item><title>Feed page</title><link>https://example.test/feed-page</link></item></channel></rss>
            """,
            "https://example.test/sitemap-page": """
            <html><head><title>Sitemap Page</title><meta name="description" content="Official sitemap page"></head>
            <body><main><p>Official sitemap pages should be crawled before generic site links.</p></main></body></html>
            """,
            "https://example.test/feed-page": """
            <html><head><title>Feed Page</title><meta name="description" content="Official feed page"></head>
            <body><main><p>Official feed pages provide updates for monitor topics.</p></main></body></html>
            """,
        },
    )
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True)
    storage = AppStorage(settings.database_path())
    app = create_app(settings=settings, storage=storage, providers=ProviderRegistry([EchoProvider()]))

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/research/runs",
            json={
                "mode": "site_crawl",
                "goal": "structured discovery",
                "seed_urls": ["https://example.test/"],
                "max_pages": 2,
                "depth": 1,
            },
        )
        run = client.get(f"/api/ai/research/runs/{response.json()['run']['id']}")
        source_library = client.get("/api/ai/research/sources?q=official&domain=example.test")

    body = run.json()["run"]
    titles = [source["title"] for source in body["sources"]]
    assert response.status_code == 200
    assert body["status"] == "succeeded"
    assert titles == ["Sitemap Page", "Feed Page"]
    assert any(log.get("message") == "Structured discovery document parsed." for log in body["logs"])
    assert any(log.get("message") == "Structured source discovery added crawl targets." for log in body["logs"])
    assert {"Sitemap Page", "Feed Page"}.issubset({source["title"] for source in source_library.json()["sources"]})


def test_research_screenshot_runs_use_browser_extract_and_archive_metadata(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://example.test/robots.txt": "User-agent: *\nAllow: /\n",
        },
    )

    async def fake_browser_extract(self, url: str, **kwargs):
        assert kwargs["screenshot"] is True
        return {
            "ok": True,
            "tool_id": "browser.extract",
            "mode": "browser",
            "browser_available": True,
            "url": url,
            "final_url": url,
            "title": "Screenshot source",
            "description": "Rendered page with visual evidence.",
            "text": "Screenshot research captures rendered pages when visual evidence is useful.",
            "text_length": 74,
            "links": [],
            "tables": [],
            "metadata": {"custom": "browser"},
            "screenshot_base64": base64.b64encode(b"fake-png").decode("ascii"),
            "screenshot_content_type": "image/png",
        }

    monkeypatch.setattr(WebAccess, "browser_extract", fake_browser_extract)
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True)
    storage = AppStorage(settings.database_path())
    app = create_app(settings=settings, storage=storage, providers=ProviderRegistry([EchoProvider()]))

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/research/runs",
            json={
                "mode": "url_scrape",
                "goal": "capture screenshot evidence",
                "seed_urls": ["https://example.test/visual"],
                "max_pages": 1,
                "screenshot": True,
            },
        )
        run = client.get(f"/api/ai/research/runs/{response.json()['run']['id']}")
        source_library = client.get("/api/ai/research/sources?q=screenshot&domain=example.test")

    source = run.json()["run"]["sources"][0]
    assert response.status_code == 200
    assert run.json()["run"]["status"] == "succeeded"
    assert source["title"] == "Screenshot source"
    assert source["metadata"]["screenshot_base64"] == base64.b64encode(b"fake-png").decode("ascii")
    assert source["metadata"]["screenshot_content_type"] == "image/png"
    assert any(log.get("tool_id") == "browser.extract" and log.get("screenshot") for log in run.json()["run"]["logs"])
    assert source_library.json()["sources"][0]["metadata"]["screenshot_base64"] == base64.b64encode(b"fake-png").decode("ascii")


def test_research_monitors_persist_and_run_real_reports(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://duckduckgo.com/html/": """
            <html><body>
              <div class="result">
                <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.test%2Fmonitor">Monitor source</a>
                <a class="result__snippet">Topic update snippet.</a>
              </div>
            </body></html>
            """,
            "https://example.test/monitor": """
            <html><head><title>Monitor source</title>
            <meta name="description" content="Monitor topic source"></head>
            <body><main><p>Monitor topics collect recurring web intelligence with citations.</p></main></body></html>
            """,
            "https://example.test/robots.txt": "User-agent: *\nAllow: /\n",
        },
    )
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True)
    storage = AppStorage(settings.database_path())
    app = create_app(settings=settings, storage=storage, providers=ProviderRegistry([EchoProvider()]))

    with TestClient(app) as client:
        created = client.post(
            "/api/ai/research/monitors",
            json={
                "name": "Web intelligence watch",
                "schedule": "weekly",
                "request": {
                    "mode": "monitor_topic",
                    "goal": "monitor topics web intelligence",
                    "max_pages": 2,
                },
            },
        )
        monitor_id = created.json()["monitor"]["id"]
        toggled = client.patch(f"/api/ai/research/monitors/{monitor_id}", json={"enabled": False})
        started = client.post(f"/api/ai/research/monitors/{monitor_id}/run")
        listed = client.get("/api/ai/research/monitors")
        run = client.get(f"/api/ai/research/runs/{started.json()['run']['id']}")
        ledger = client.get("/api/ai/action-ledger?limit=20")

    assert created.status_code == 200
    assert created.json()["monitor"]["run_count"] == 0
    assert toggled.json()["monitor"]["enabled"] is False
    assert started.status_code == 200
    assert listed.json()["monitors"][0]["last_run_id"] == started.json()["run"]["id"]
    assert listed.json()["monitors"][0]["last_status"] == "succeeded"
    assert listed.json()["monitors"][0]["run_count"] == 1
    assert run.json()["run"]["status"] == "succeeded"
    assert run.json()["run"]["options"]["metadata"]["research_monitor_id"] == monitor_id
    assert run.json()["run"]["sources"][0]["title"] == "Monitor source"
    monitor_action = next(action for action in ledger.json()["actions"] if action["id"] == f"ai-research:{run.json()['run']['id']}")
    assert monitor_action["metadata"]["research_monitor_id"] == monitor_id
    assert monitor_action["metadata"]["research_monitor_name"] == "Web intelligence watch"


def test_research_monitor_sweep_queues_due_scheduled_monitors(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://duckduckgo.com/html/": """
            <html><body>
              <div class="result">
                <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.test%2Fsweep">Sweep source</a>
                <a class="result__snippet">Scheduled topic snippet.</a>
              </div>
            </body></html>
            """,
            "https://example.test/sweep": """
            <html><head><title>Sweep source</title>
            <meta name="description" content="Scheduled monitor source"></head>
            <body><main><p>Scheduled monitors can collect topic updates into archived reports.</p></main></body></html>
            """,
            "https://example.test/robots.txt": "User-agent: *\nAllow: /\n",
        },
    )
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True)
    storage = AppStorage(settings.database_path())
    app = create_app(settings=settings, storage=storage, providers=ProviderRegistry([EchoProvider()]))

    with TestClient(app) as client:
        daily = client.post(
            "/api/ai/research/monitors",
            json={
                "name": "Daily intelligence",
                "schedule": "daily",
                "request": {
                    "mode": "monitor_topic",
                    "goal": "scheduled monitor topic",
                    "max_pages": 1,
                },
            },
        )
        manual = client.post(
            "/api/ai/research/monitors",
            json={
                "name": "Manual intelligence",
                "schedule": "manual",
                "request": {
                    "mode": "monitor_topic",
                    "goal": "manual monitor topic",
                    "max_pages": 1,
                },
            },
        )
        due = client.get("/api/ai/research/monitors/due?limit=10")
        units = client.get("/api/ai/background/units")
        dry_unit = client.post(
            "/api/ai/background/units/research.monitors.sweep/run",
            json={"dry_run": True, "include_manual": True, "limit": 10},
        )
        sweep = client.post("/api/ai/research/monitors/run-due", json={"limit": 10})
        monitors = client.get("/api/ai/research/monitors")
        run = client.get(f"/api/ai/research/runs/{sweep.json()['runs'][0]['id']}")

    assert daily.status_code == 200
    assert manual.status_code == 200
    assert due.status_code == 200
    assert [monitor["id"] for monitor in due.json()["monitors"]] == [daily.json()["monitor"]["id"]]
    assert any(unit["id"] == "research.monitors.sweep" and unit["demo"] is False for unit in units.json()["units"])
    assert dry_unit.status_code == 200
    assert dry_unit.json()["unit"]["last_result"]["due_count"] == 2
    assert dry_unit.json()["unit"]["last_result"]["queued_count"] == 0
    assert sweep.status_code == 200
    assert sweep.json()["due_count"] == 1
    assert sweep.json()["queued_count"] == 1
    monitor_by_id = {monitor["id"]: monitor for monitor in monitors.json()["monitors"]}
    assert monitor_by_id[daily.json()["monitor"]["id"]]["run_count"] == 1
    assert monitor_by_id[manual.json()["monitor"]["id"]]["run_count"] == 0
    assert run.json()["run"]["status"] == "succeeded"
    assert run.json()["run"]["sources"][0]["title"] == "Sweep source"


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


def test_research_pause_marks_running_run_and_ledger_metadata(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False)
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)
    storage.log_research_run(
        ResearchRunRecord(
            id="research_pause_test",
            created_at=now_iso(),
            updated_at=now_iso(),
            mode="deep_research",
            goal="pause this research run",
            status="running",
            report=ResearchReport(title="Deep Research: pause this research run", tldr="Running"),
            logs=[],
            progress=0.55,
            total_steps=10,
            completed_steps=5,
            current_step="Fetching sources",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/ai/research/runs/research_pause_test/pause")
        ledger = client.get("/api/ai/action-ledger?limit=20")

    body = response.json()["run"]
    assert response.status_code == 200
    assert body["status"] == "paused"
    assert body["cancel_requested"] is False
    assert body["current_step"] == "Paused"
    research_action = next(action for action in ledger.json()["actions"] if action["id"] == "ai-research:research_pause_test")
    assert research_action["status"] == "paused"
    assert research_action["metadata"]["progress"] == 0.55
    assert research_action["metadata"]["cancel_requested"] is False


def test_research_resume_requeues_paused_run_with_saved_request(monkeypatch, tmp_path):
    install_fake_web(
        monkeypatch,
        {
            "https://example.test/robots.txt": "User-agent: *\nAllow: /\n",
            "https://example.test/resume": """
            <html><head><title>Resumed Research</title><meta name="description" content="Resume source"></head>
            <body><main><p>Resumed research should reuse the same archived run and fetch sources.</p></main></body></html>
            """,
        },
    )
    settings = Settings(data_dir=tmp_path, backup_enabled=False, web_allow_private_hosts=True)
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)
    request = ResearchRunRequest(
        mode="url_scrape",
        goal="resume saved research",
        seed_urls=["https://example.test/resume"],
        max_pages=1,
        use_ai=False,
    )
    storage.log_research_run(
        ResearchRunRecord(
            id="research_resume_test",
            created_at=now_iso(),
            updated_at=now_iso(),
            mode=request.mode,
            goal=request.goal,
            status="paused",
            query_plan=plan_research(request).as_dict(),
            report=ResearchReport(title="URL Scrape: resume saved research", tldr="Paused"),
            logs=[],
            progress=0.25,
            total_steps=5,
            completed_steps=1,
            current_step="Paused",
            options=request.model_dump(mode="json"),
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/ai/research/runs/research_resume_test/resume")
        run = client.get("/api/ai/research/runs/research_resume_test")

    body = run.json()["run"]
    assert response.status_code == 200
    assert response.json()["run"]["id"] == "research_resume_test"
    assert body["id"] == "research_resume_test"
    assert body["status"] == "succeeded"
    assert body["sources"][0]["title"] == "Resumed Research"
    assert any(log.get("message") == "Resume requested by user." for log in body["logs"])


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
    storage.log_research_run(
        ResearchRunRecord(
            id="research_status_test",
            created_at=now_iso(),
            updated_at=now_iso(),
            mode="deep_research",
            goal="status should include research",
            status="paused",
            report=ResearchReport(title="Deep Research: status should include research", tldr="Paused"),
            logs=[],
            progress=0.5,
            total_steps=8,
            completed_steps=4,
            current_step="Paused",
        )
    )

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
    assert status["research_runs"][0]["id"] == "research_status_test"
    assert status["research_runs"][0]["status"] == "paused"
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


def test_trusted_web_origin_private_network_preflight_is_allowed(tmp_path):
    settings = Settings(
        data_dir=tmp_path,
        backup_enabled=False,
        trusted_origins=["https://elc9939.github.io"],
    )
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        response = client.options(
            "/api/ai/status?mode=balanced",
            headers={
                "Origin": "https://elc9939.github.io",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Private-Network": "true",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://elc9939.github.io"
    assert response.headers["access-control-allow-private-network"] == "true"


def test_bridge_token_protects_ai_os_work_routes_when_configured(tmp_path):
    settings = Settings(data_dir=tmp_path, backup_enabled=False, bridge_token="bridge-secret")
    storage = AppStorage(settings.database_path())
    registry = ProviderRegistry([EchoProvider()])
    app = create_app(settings=settings, storage=storage, providers=registry)

    with TestClient(app) as client:
        health = client.get("/api/ai/health")
        blocked = client.post("/api/ai/infer", json={"prompt": "ok"})
        allowed = client.post(
            "/api/ai/infer",
            json={"prompt": "ok"},
            headers={"X-Mini-Hub-Bridge-Token": "bridge-secret"},
        )

    assert health.status_code == 200
    assert health.json()["bridge_auth"] == {"required": True, "accepted": False}
    assert blocked.status_code == 401
    assert allowed.status_code == 200


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


def test_windows_gpu_telemetry_falls_back_to_basic_controller(monkeypatch):
    calls: list[str] = []

    def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        script = str(args[-1])
        calls.append(script)
        if "GPUEngine" in script:
            raise subprocess.TimeoutExpired(args, timeout=kwargs.get("timeout"))
        payload = {
            "controllers": [
                {
                    "Name": "AMD Radeon RX 6600",
                    "Status": "OK",
                    "AdapterRAM": 4_293_918_720,
                    "DriverVersion": "32.0.21043.19003",
                    "VideoProcessor": "AMD Radeon Graphics Processor",
                    "PNPDeviceID": "PCI\\VEN_1002&DEV_73FF&SUBSYS_52171849&REV_C7",
                }
            ],
            "engines": [],
            "memory": [],
            "registryMemory": [
                {
                    "Name": "AMD Radeon RX 6600",
                    "MatchingDeviceId": "PCI\\VEN_1002&DEV_73FF&SUBSYS_52171849&REV_C7",
                    "QwMemorySize": 8_573_157_376,
                }
            ],
        }
        return subprocess.CompletedProcess(args=args, returncode=0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr(telemetry.os, "name", "nt", raising=False)
    monkeypatch.setattr(telemetry.subprocess, "run", fake_run)

    gpus, error = telemetry._windows_gpus()

    assert error is None
    assert len(calls) == 2
    assert gpus[0]["name"] == "AMD Radeon RX 6600"
    assert gpus[0]["source"] == "windows-video-controller"
    assert gpus[0]["memory_total_mb"] == pytest.approx(8176.0, rel=0.01)


def test_hardware_status_uses_cached_gpu_when_live_telemetry_fails(monkeypatch):
    class FakeStorage:
        def recent_tokens_per_second(self) -> float | None:
            return 39.5

        def list_benchmarks(self, limit: int = 25) -> list[BenchmarkRunRecord]:
            return [
                BenchmarkRunRecord(
                    id="bench_cached_gpu",
                    created_at="2026-07-01T05:46:57+00:00",
                    kind="text",
                    provider="ollama",
                    model="llama3.1:8b",
                    prompt="probe",
                    latency_ms=700,
                    tokens_per_second=40,
                    hardware_after={
                        "gpus": [
                            {
                                "name": "AMD Radeon RX 6600",
                                "source": "windows-performance-counters",
                                "memory_total_mb": 8176.0,
                                "memory_used_mb": 7086.2,
                            }
                        ]
                    },
                )
            ]

    monkeypatch.setattr(telemetry, "_nvidia_gpus", lambda: ([], "nvidia-smi unavailable"))
    monkeypatch.setattr(telemetry.os, "name", "nt", raising=False)
    monkeypatch.setattr(telemetry, "_windows_gpus", lambda: ([], "Windows GPU telemetry unavailable: telemetry command timed out"))
    monkeypatch.setattr(
        telemetry,
        "_ollama_loaded_models",
        lambda: ([{"name": "llama3.1:8b", "model": "llama3.1:8b", "vram_gb": 5.41}], None),
    )

    status = telemetry.hardware_status(FakeStorage())  # type: ignore[arg-type]

    assert status.gpus[0]["name"] == "AMD Radeon RX 6600"
    assert status.gpus[0]["source"] == "benchmark-cache"
    assert status.gpus[0]["live_source"] == "windows-performance-counters"
    assert status.gpus[0]["telemetry_status"] == "stale"
    assert status.gpus[0]["last_observed_at"] == "2026-07-01T05:46:57+00:00"
    assert status.gpus[0]["loaded_models"][0]["name"] == "llama3.1:8b"
    assert "Live GPU telemetry unavailable" in (status.error or "")


def test_compact_large_payloads_redacts_nested_media_payloads():
    payload = {
        "provider": "openai",
        "data": [{"b64_json": "a" * 60_000, "revised_prompt": "cat"}],
        "image_base64": "b" * 60_000,
        "small": "kept",
    }

    compacted = compact_large_payloads(payload)

    assert compacted["small"] == "kept"
    assert compacted["image_base64"].startswith("<redacted image_base64 payload:")
    assert compacted["data"][0]["b64_json"].startswith("<redacted b64_json payload:")
    assert compacted["data"][0]["revised_prompt"] == "cat"


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
