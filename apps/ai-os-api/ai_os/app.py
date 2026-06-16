from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agents.engine import AgentEngine, build_tool_registry
from .background.registry import BackgroundRegistry, build_background_registry
from .capabilities import build_capabilities
from .config import Settings, get_settings
from .inference import InferenceRouter, sse
from .jobs.primitives import JobPrimitives
from .jobs.queue import JobQueue
from .memory.store import SemanticMemory
from .models import (
    AgentRunRequest,
    BackgroundToggleRequest,
    InferenceRequest,
    JobCreateRequest,
    MemoryIngestRequest,
    MemoryQueryRequest,
    MultimodalInvokeRequest,
)
from .multimodal.registry import MultimodalRegistry
from .providers.registry import ProviderRegistry, build_provider_registry
from .storage import AppStorage
from .telemetry import hardware_status

logger = logging.getLogger("ai_os")


class Services:
    def __init__(self, settings: Settings, storage: AppStorage, providers: ProviderRegistry):
        self.settings = settings
        self.storage = storage
        self.providers = providers
        self.router = InferenceRouter(settings, providers, storage)
        self.jobs = JobQueue(storage, settings.max_job_concurrency)
        JobPrimitives(self.router).register(self.jobs)
        self.memory = SemanticMemory(storage, providers)
        self.background = build_background_registry()
        self.tools = build_tool_registry(self.router, self.memory)
        self.agents = AgentEngine(self.router, self.tools)
        self.multimodal = MultimodalRegistry(providers)


def create_app(
    settings: Settings | None = None,
    storage: AppStorage | None = None,
    providers: ProviderRegistry | None = None,
    background: BackgroundRegistry | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    storage = storage or AppStorage(settings.database_path())
    providers = providers or build_provider_registry(settings)
    services = Services(settings, storage, providers)
    if background:
        services.background = background

    app = FastAPI(
        title="Mini Hub Personal AI OS API",
        version="0.1.0",
        description="Capability substrate for local-first inference, jobs, memory, agents, ambient triggers, and multimodal adapters.",
    )
    app.state.services = services

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.trusted_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("shutdown")
    async def shutdown() -> None:
        storage.close()

    @app.get("/api/ai/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "service": "mini-hub-ai-os-api", "version": app.version}

    @app.get("/api/ai/providers")
    async def providers_status() -> dict[str, Any]:
        statuses = await asyncio.gather(*(adapter.status() for adapter in services.providers.all()))
        return {"providers": [status.model_dump(mode="json") for status in statuses]}

    @app.get("/api/ai/capabilities")
    async def capabilities() -> dict[str, Any]:
        statuses = await asyncio.gather(*(adapter.status() for adapter in services.providers.all()))
        return {"capabilities": [capability.model_dump(mode="json") for capability in build_capabilities(list(statuses))]}

    @app.get("/api/ai/status")
    async def status() -> dict[str, Any]:
        statuses = await asyncio.gather(*(adapter.status() for adapter in services.providers.all()))
        return {
            "providers": [provider.model_dump(mode="json") for provider in statuses],
            "capabilities": [capability.model_dump(mode="json") for capability in build_capabilities(list(statuses))],
            "hardware": hardware_status(services.storage).model_dump(mode="json"),
            "jobs": [job.model_dump(mode="json") for job in services.jobs.list()],
            "background": [unit.model_dump(mode="json") for unit in services.background.list()],
            "tools": [tool.model_dump(mode="json") for tool in services.tools.specs()],
        }

    @app.post("/api/ai/infer")
    async def infer(request: InferenceRequest) -> dict[str, Any]:
        try:
            result = await services.router.infer(request)
            return {"result": result.model_dump(mode="json")}
        except Exception as error:
            logger.exception("Inference failed")
            raise HTTPException(status_code=502, detail=str(error)) from error

    @app.post("/api/ai/infer/stream")
    async def infer_stream(request: InferenceRequest) -> StreamingResponse:
        async def events() -> AsyncIterator[str]:
            try:
                async for chunk in services.router.stream(request):
                    if chunk.metadata.get("error"):
                        yield sse("error", chunk.model_dump(mode="json"))
                    else:
                        yield sse("message", chunk.model_dump(mode="json"))
                    if chunk.done:
                        yield sse("done", chunk.model_dump(mode="json"))
            except Exception as error:
                logger.exception("Streaming inference failed")
                yield sse("error", {"error": str(error)})

        return StreamingResponse(events(), media_type="text/event-stream")

    @app.get("/api/ai/usage")
    async def usage(limit: int = 50) -> dict[str, Any]:
        return {"usage": [entry.model_dump(mode="json") for entry in services.storage.list_usage(limit)]}

    @app.post("/api/ai/jobs")
    async def create_job(request: JobCreateRequest) -> dict[str, Any]:
        try:
            job = await services.jobs.create(request)
            return {"job": job.model_dump(mode="json")}
        except Exception as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/api/ai/jobs")
    async def list_jobs() -> dict[str, Any]:
        return {"jobs": [job.model_dump(mode="json") for job in services.jobs.list()]}

    @app.get("/api/ai/jobs/{job_id}")
    async def get_job(job_id: str) -> dict[str, Any]:
        job = services.jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return {"job": job.model_dump(mode="json")}

    @app.get("/api/ai/jobs/{job_id}/results")
    async def job_results(job_id: str) -> dict[str, Any]:
        if not services.jobs.get(job_id):
            raise HTTPException(status_code=404, detail="Job not found.")
        return {"results": services.jobs.results(job_id)}

    @app.post("/api/ai/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str) -> dict[str, Any]:
        try:
            job = await services.jobs.cancel(job_id)
            return {"job": job.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Job not found.") from error

    @app.get("/api/ai/background/units")
    async def background_units() -> dict[str, Any]:
        return {"units": [unit.model_dump(mode="json") for unit in services.background.list()]}

    @app.post("/api/ai/background/units/{unit_id}/toggle")
    async def toggle_background(unit_id: str, request: BackgroundToggleRequest) -> dict[str, Any]:
        try:
            unit = services.background.toggle(unit_id, request.enabled)
            return {"unit": unit.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Background unit not found.") from error

    @app.post("/api/ai/background/units/{unit_id}/run")
    async def run_background(unit_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            unit = await services.background.run(unit_id, payload)
            return {"unit": unit.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Background unit not found.") from error

    @app.get("/api/ai/tools")
    async def tools() -> dict[str, Any]:
        return {"tools": [tool.model_dump(mode="json") for tool in services.tools.specs()]}

    @app.post("/api/ai/agents/run")
    async def run_agent(request: AgentRunRequest) -> dict[str, Any]:
        try:
            result = await services.agents.run(request)
            return {"result": result.model_dump(mode="json")}
        except Exception as error:
            logger.exception("Agent run failed")
            raise HTTPException(status_code=502, detail=str(error)) from error

    @app.post("/api/ai/memory/ingest")
    async def memory_ingest(request: MemoryIngestRequest) -> dict[str, Any]:
        try:
            return {"result": await services.memory.ingest(request)}
        except Exception as error:
            logger.exception("Memory ingest failed")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/api/ai/memory/query")
    async def memory_query(request: MemoryQueryRequest) -> dict[str, Any]:
        try:
            hits = await services.memory.query(request)
            return {"hits": [hit.model_dump(mode="json") for hit in hits]}
        except Exception as error:
            logger.exception("Memory query failed")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/api/ai/multimodal/{kind}/invoke")
    async def multimodal_invoke(kind: str, request: MultimodalInvokeRequest) -> dict[str, Any]:
        try:
            return {"result": await services.multimodal.invoke(kind, request)}
        except Exception as error:
            logger.exception("Multimodal invocation failed")
            raise HTTPException(status_code=400, detail=str(error)) from error

    return app


app = create_app()
