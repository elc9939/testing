from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .agents.engine import AgentEngine, build_tool_registry
from .background.registry import BackgroundRegistry, build_background_registry
from .benchmarks import run_benchmark
from .capabilities import build_capabilities
from .config import Settings, get_settings
from .design import apply_stored_patch, propose_design_patch
from .health import full_health
from .inference import InferenceRouter, sse
from .jobs.primitives import JobPrimitives
from .jobs.queue import JobQueue
from .logging_setup import setup_logging
from .maintenance import BackupManager, MaintenanceScheduler, cleanup_old_files, restore_backup_to_temp
from .memory.store import SemanticMemory
from .models import (
    AgentRunRequest,
    BackgroundToggleRequest,
    BenchmarkRequest,
    CommandRequest,
    DesignPatchApplyRequest,
    DesignPatchRequest,
    InferenceRequest,
    JobCreateRequest,
    MemoryIngestRequest,
    MemoryQueryRequest,
    MultimodalInvokeRequest,
    new_id,
)
from .multimodal.registry import MultimodalRegistry
from .providers.registry import ProviderRegistry, build_provider_registry
from .security import is_loopback_host
from .storage import AppStorage
from .telemetry import hardware_status

logger = logging.getLogger("ai_os")


class Services:
    def __init__(self, settings: Settings, storage: AppStorage, providers: ProviderRegistry):
        self.settings = settings
        self.storage = storage
        self.providers = providers
        self.router = InferenceRouter(settings, providers, storage)
        self.jobs = JobQueue(
            storage,
            max_concurrency=settings.max_job_concurrency,
            max_active_jobs=settings.max_active_jobs,
            job_timeout_s=settings.job_timeout_s,
        )
        JobPrimitives(self.router).register(self.jobs)
        self.memory = SemanticMemory(storage, providers)
        self.background = build_background_registry()
        self.tools = build_tool_registry(self.router, self.memory, settings, storage)
        self.agents = AgentEngine(self.router, self.tools)
        self.multimodal = MultimodalRegistry(settings, providers, storage)
        self.backups = BackupManager(settings, storage)
        self.maintenance = MaintenanceScheduler(settings, self.backups)


def create_app(
    settings: Settings | None = None,
    storage: AppStorage | None = None,
    providers: ProviderRegistry | None = None,
    background: BackgroundRegistry | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings)
    storage = storage or AppStorage(settings.database_path())
    providers = providers or build_provider_registry(settings)
    services = Services(settings, storage, providers)
    if background:
        services.background = background

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        services.settings.resolved_temp_dir().mkdir(parents=True, exist_ok=True)
        services.settings.resolved_assets_dir().mkdir(parents=True, exist_ok=True)
        if services.settings.require_loopback and services.settings.host not in {"127.0.0.1", "localhost", "::1"}:
            logger.warning("AI OS host is not loopback while loopback enforcement is enabled", extra={"host": services.settings.host})
        services.maintenance.start()
        try:
            yield
        finally:
            await services.maintenance.stop()
            storage.close()

    app = FastAPI(
        title="Mini Hub Personal AI OS API",
        version="0.1.0",
        description="Capability substrate for local-first inference, jobs, memory, agents, ambient triggers, and multimodal adapters.",
        lifespan=lifespan,
    )
    app.state.services = services

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.trusted_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_guard(request: Request, call_next):
        def with_private_network_header(response: JSONResponse | StreamingResponse):
            origin = request.headers.get("origin")
            if origin and origin in settings.trusted_origins:
                response.headers["Access-Control-Allow-Private-Network"] = "true"
            return response

        if settings.require_loopback and request.client and not is_loopback_host(request.client.host):
            logger.warning(
                "Rejected non-loopback request",
                extra={"remote_host": request.client.host, "path": request.url.path, "method": request.method},
            )
            return with_private_network_header(
                JSONResponse({"detail": "AI OS API only accepts loopback clients."}, status_code=403)
            )
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > settings.max_request_bytes:
                    return with_private_network_header(
                        JSONResponse(
                            {"detail": f"Request body exceeds limit of {settings.max_request_bytes} bytes."},
                            status_code=413,
                        )
                    )
            except ValueError:
                return with_private_network_header(JSONResponse({"detail": "Invalid content-length header."}, status_code=400))
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled request failure", extra={"path": request.url.path, "method": request.method})
            raise
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return with_private_network_header(response)

    def inference_text_length(request: InferenceRequest) -> int:
        if request.prompt:
            return len(request.prompt)
        return sum(len(message.content) for message in request.messages)

    def enforce_request_limits(request: InferenceRequest) -> None:
        if inference_text_length(request) > services.settings.max_prompt_chars:
            raise HTTPException(
                status_code=413,
                detail=f"Prompt exceeds limit of {services.settings.max_prompt_chars} characters.",
            )

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
        return {
            "capabilities": [
                capability.model_dump(mode="json")
                for capability in build_capabilities(list(statuses), services.multimodal.capability_adapters())
            ]
        }

    @app.get("/api/ai/status")
    async def status() -> dict[str, Any]:
        statuses = await asyncio.gather(*(adapter.status() for adapter in services.providers.all()))
        return {
            "providers": [provider.model_dump(mode="json") for provider in statuses],
            "capabilities": [
                capability.model_dump(mode="json")
                for capability in build_capabilities(list(statuses), services.multimodal.capability_adapters())
            ],
            "hardware": hardware_status(services.storage).model_dump(mode="json"),
            "jobs": [job.model_dump(mode="json") for job in services.jobs.list()],
            "background": [unit.model_dump(mode="json") for unit in services.background.list()],
            "tools": [tool.model_dump(mode="json") for tool in services.tools.specs()],
            "tool_calls": [entry.model_dump(mode="json") for entry in services.storage.list_tool_calls(20)],
            "generation_assets": [asset.model_dump(mode="json") for asset in services.storage.list_generation_assets(12)],
            "benchmark_runs": [run.model_dump(mode="json") for run in services.storage.list_benchmarks(12)],
            "integrity": services.storage.integrity_report(),
            "backups": [backup.as_dict() for backup in services.backups.list_backups()[:5]],
            "metrics": {
                "usage": services.storage.usage_metrics(),
                "queue": services.jobs.metrics(),
                "database": services.storage.data_counts(),
            },
        }

    @app.get("/api/ai/health/full")
    async def full_health_endpoint() -> dict[str, Any]:
        return await full_health(
            settings=services.settings,
            storage=services.storage,
            providers=services.providers,
            jobs=services.jobs,
            backups=services.backups,
        )

    @app.get("/api/ai/metrics")
    async def metrics() -> dict[str, Any]:
        return {
            "usage": services.storage.usage_metrics(),
            "queue": services.jobs.metrics(),
            "database": services.storage.data_counts(),
            "hardware": hardware_status(services.storage).model_dump(mode="json"),
        }

    @app.get("/api/ai/integrity")
    async def integrity() -> dict[str, Any]:
        return services.storage.integrity_report()

    @app.get("/api/ai/backups")
    async def list_backups() -> dict[str, Any]:
        return {"backups": [backup.as_dict() for backup in services.backups.list_backups()]}

    @app.post("/api/ai/backups")
    async def create_backup(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        reason = str((payload or {}).get("reason") or "manual")
        return {"backup": services.backups.create_backup(reason=reason)}

    @app.post("/api/ai/backups/{backup_id}/verify")
    async def verify_backup(backup_id: str) -> dict[str, Any]:
        return {"verification": services.backups.verify_backup(backup_id)}

    @app.post("/api/ai/backups/{backup_id}/restore-test")
    async def restore_test(backup_id: str) -> dict[str, Any]:
        return {"restore": restore_backup_to_temp(services.settings, services.storage, backup_id)}

    @app.post("/api/ai/maintenance/cleanup")
    async def cleanup() -> dict[str, Any]:
        result = cleanup_old_files(services.settings)
        result["retention_removed"] = services.backups.apply_retention()
        return result

    @app.post("/api/ai/infer")
    async def infer(request: InferenceRequest) -> dict[str, Any]:
        try:
            enforce_request_limits(request)
            result = await services.router.infer(request)
            return {"result": result.model_dump(mode="json")}
        except HTTPException:
            raise
        except Exception as error:
            logger.exception("Inference failed")
            raise HTTPException(status_code=502, detail=str(error)) from error

    @app.post("/api/ai/infer/stream")
    async def infer_stream(request: InferenceRequest) -> StreamingResponse:
        enforce_request_limits(request)

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
            enforce_request_limits(request.request)
            if len(request.items) > services.settings.max_job_items:
                raise HTTPException(
                    status_code=413,
                    detail=f"Job item count exceeds limit of {services.settings.max_job_items}.",
                )
            if request.text and len(request.text) > services.settings.max_memory_ingest_chars:
                raise HTTPException(
                    status_code=413,
                    detail=f"Job text exceeds limit of {services.settings.max_memory_ingest_chars} characters.",
                )
            job = await services.jobs.create(request)
            return {"job": job.model_dump(mode="json")}
        except HTTPException:
            raise
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

    @app.get("/api/ai/tool-calls")
    async def tool_calls(limit: int = 50) -> dict[str, Any]:
        return {"tool_calls": [entry.model_dump(mode="json") for entry in services.storage.list_tool_calls(limit)]}

    @app.post("/api/ai/command")
    async def command(request: CommandRequest) -> dict[str, Any]:
        try:
            run_id = new_id("cmd")
            agent_request = AgentRunRequest(
                objective=request.objective,
                agent_id="command-bar",
                max_steps=request.max_steps,
                provider=request.provider,
                model=request.model,
                tools=request.tools,
                context={
                    **request.context,
                    "confirmed": request.confirm_actions,
                    "confirm_actions": request.confirm_actions,
                    "run_id": run_id,
                },
            )
            result = await services.agents.run(agent_request)
            return {
                "result": result.model_dump(mode="json"),
                "tool_calls": [
                    entry.model_dump(mode="json")
                    for entry in services.storage.list_tool_calls(25)
                    if entry.run_id == run_id
                ],
            }
        except Exception as error:
            logger.exception("Command run failed")
            raise HTTPException(status_code=502, detail=str(error)) from error

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
            if len(request.text) > services.settings.max_memory_ingest_chars:
                raise HTTPException(
                    status_code=413,
                    detail=f"Memory ingest exceeds limit of {services.settings.max_memory_ingest_chars} characters.",
                )
            return {"result": await services.memory.ingest(request)}
        except HTTPException:
            raise
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

    @app.get("/api/ai/generation-assets")
    async def generation_assets(limit: int = 50) -> dict[str, Any]:
        return {"assets": [asset.model_dump(mode="json") for asset in services.storage.list_generation_assets(limit)]}

    @app.get("/api/ai/design/patches")
    async def design_patches(limit: int = 25) -> dict[str, Any]:
        return {"patches": [patch.model_dump(mode="json") for patch in services.storage.list_design_patches(limit)]}

    @app.post("/api/ai/design/patches")
    async def create_design_patch(request: DesignPatchRequest) -> dict[str, Any]:
        try:
            patch = await propose_design_patch(services.settings, services.router, services.storage, request)
            if request.apply:
                patch = apply_stored_patch(services.settings, services.storage, patch.id, confirm=request.confirm)
            return {"patch": patch.model_dump(mode="json")}
        except PermissionError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except Exception as error:
            logger.exception("Design patch proposal failed")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/api/ai/design/patches/{patch_id}/apply")
    async def apply_design_patch_endpoint(patch_id: str, request: DesignPatchApplyRequest) -> dict[str, Any]:
        try:
            patch = apply_stored_patch(services.settings, services.storage, patch_id, confirm=request.confirm)
            return {"patch": patch.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Design patch not found.") from error
        except PermissionError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except Exception as error:
            logger.exception("Design patch apply failed")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/api/ai/design/patches/{patch_id}/revert")
    async def revert_design_patch_endpoint(patch_id: str, request: DesignPatchApplyRequest) -> dict[str, Any]:
        try:
            patch = apply_stored_patch(services.settings, services.storage, patch_id, confirm=request.confirm, reverse=True)
            return {"patch": patch.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Design patch not found.") from error
        except PermissionError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except Exception as error:
            logger.exception("Design patch revert failed")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/api/ai/benchmarks")
    async def benchmarks(limit: int = 25) -> dict[str, Any]:
        return {"benchmarks": [run.model_dump(mode="json") for run in services.storage.list_benchmarks(limit)]}

    @app.post("/api/ai/benchmarks")
    async def benchmark(request: BenchmarkRequest) -> dict[str, Any]:
        try:
            record = await run_benchmark(
                services.router,
                services.storage,
                request,
                media_invoker=lambda kind, media_request: services.multimodal.invoke(kind, media_request),
            )
            return {"benchmark": record.model_dump(mode="json")}
        except Exception as error:
            logger.exception("Benchmark failed")
            raise HTTPException(status_code=400, detail=str(error)) from error

    return app


app = create_app()
