from __future__ import annotations

import logging
import re
import time
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse

from .agents.engine import AgentEngine, build_tool_registry
from .action_ledger import build_ai_action_ledger
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
from .machine_modes import machine_mode_policy, normalize_machine_mode_id
from .machine_profile import build_machine_profile, provider_statuses
from .maintenance import BackupManager, MaintenanceScheduler, cleanup_old_files, restore_backup_to_temp
from .memory.store import SemanticMemory
from .models import (
    AgentRunRequest,
    ActionSnapshotRestoreRequest,
    AutotuneRequest,
    BackgroundToggleRequest,
    BenchmarkRequest,
    CommandRequest,
    DesignPatchApplyRequest,
    DesignPatchRequest,
    InferenceRequest,
    JobCreateRequest,
    MachineProfileSnapshotRequest,
    MemoryIngestRequest,
    MemoryQueryRequest,
    MultimodalInvokeRequest,
    ResearchMonitorCreateRequest,
    ResearchMonitorUpdateRequest,
    ResearchRunRequest,
    new_id,
)
from .multimodal.registry import MultimodalRegistry
from .providers.registry import ProviderRegistry, build_provider_registry
from .recoverability import restore_file_action_snapshot
from .research import ResearchEngine, export_research_html, export_research_markdown
from .security import is_loopback_host
from .storage import AppStorage
from .telemetry import hardware_status
from .web_access import WebAccess

logger = logging.getLogger("ai_os")


def _capability_adapters(services: "Services") -> dict[str, dict[str, bool]]:
    return {
        **services.multimodal.capability_adapters(),
        **services.web.capability_adapters(),
        "research.web_intelligence": {"research-engine": services.settings.web_access_enabled},
    }


def _image_file_command_payload(objective: str) -> dict[str, Any] | None:
    normalized = objective.lower()
    has_image_target = bool(re.search(r"\b(image|picture|photo|artwork|drawing|wallpaper)\b", normalized))
    has_create_action = bool(re.search(r"\b(create|generate|make|draw|render|save|add|put|place|export)\b", normalized))
    has_file_destination = bool(re.search(r"\b(desktop|file|download|save|export)\b", normalized))
    if not (has_image_target and has_create_action and has_file_destination):
        return None
    prompt = re.sub(
        r"\b(?:and\s+)?(?:add|save|put|place|drop|export)\s+(?:it|that|the\s+image)?\s*(?:to|on|onto|as)?\s*(?:my\s+)?(?:desktop|file|downloads?)\b.*$",
        "",
        objective,
        flags=re.IGNORECASE,
    ).strip(" .")
    if not prompt:
        prompt = objective
    filename = "ai-cat.png" if re.search(r"\bcat|kitten\b", normalized) else None
    return {"prompt": prompt, "destination": "desktop", **({"filename": filename} if filename else {})}


def _web_command_payload(objective: str) -> tuple[str, dict[str, Any]] | None:
    normalized = objective.lower()
    url_match = re.search(r"https?://[^\s<>)\]}\"']+", objective)
    if url_match:
        url = url_match.group(0).rstrip(".,;:")
        if re.search(r"\b(browser|render|javascript|js|dynamic|open)\b", normalized):
            return "browser.extract", {"url": url, "wait_until": "domcontentloaded"}
        if re.search(r"\b(scrape|fetch|read|extract|summarize|page|site|url|website|web)\b", normalized):
            return "web.scrape", {"url": url}
    if re.search(r"\b(search|look up|lookup|google|find)\b", normalized) and re.search(r"\b(web|internet|online)\b", normalized):
        query = re.sub(
            r"^\s*(?:please\s+|can\s+you\s+)?(?:search|look\s+up|lookup|google|find)\s+(?:the\s+)?(?:web|internet|online)?\s*(?:for|about)?\s*",
            "",
            objective,
            flags=re.IGNORECASE,
        ).strip(" ?.")
        if query:
            return "web.search", {"query": query}
    return None


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
        self.multimodal = MultimodalRegistry(settings, providers, storage)
        self.web = WebAccess(settings)
        self.tools = build_tool_registry(
            self.router,
            self.memory,
            settings,
            storage,
            media_invoker=self.multimodal.invoke,
            web_access=self.web,
        )
        self.agents = AgentEngine(self.router, self.tools)
        self.research = ResearchEngine(settings=settings, storage=storage, web=self.web, router=self.router, memory=self.memory)
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

    async def collect_machine_profile(mode: str = "balanced") -> dict[str, Any]:
        statuses = await provider_statuses(services.providers)
        capability_records = build_capabilities(list(statuses), _capability_adapters(services))
        hardware_record = hardware_status(services.storage)
        jobs = services.jobs.list()
        background_units = [unit.model_dump(mode="json") for unit in services.background.list()]
        tools = services.tools.specs()
        return {
            "providers": statuses,
            "capabilities": capability_records,
            "hardware": hardware_record,
            "jobs": jobs,
            "background": background_units,
            "tools": tools,
            "profile": build_machine_profile(
                settings=services.settings,
                storage=services.storage,
                provider_statuses=list(statuses),
                capabilities=capability_records,
                hardware=hardware_record,
                jobs_metrics=services.jobs.metrics(),
                jobs_count=len(jobs),
                background_units=background_units,
                tool_count=len(tools),
                mode=mode,
            ),
        }

    @app.get("/api/ai/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "service": "mini-hub-ai-os-api", "version": app.version}

    @app.get("/api/ai/providers")
    async def providers_status() -> dict[str, Any]:
        statuses = await provider_statuses(services.providers)
        return {"providers": [status.model_dump(mode="json") for status in statuses]}

    @app.get("/api/ai/capabilities")
    async def capabilities() -> dict[str, Any]:
        statuses = await provider_statuses(services.providers)
        return {
            "capabilities": [
                capability.model_dump(mode="json")
                for capability in build_capabilities(list(statuses), _capability_adapters(services))
            ]
        }

    @app.get("/api/ai/status")
    async def status(mode: str = "balanced") -> dict[str, Any]:
        collected = await collect_machine_profile(mode)
        statuses = collected["providers"]
        capability_records = collected["capabilities"]
        hardware_record = collected["hardware"]
        return {
            "providers": [provider.model_dump(mode="json") for provider in statuses],
            "capabilities": [capability.model_dump(mode="json") for capability in capability_records],
            "hardware": hardware_record.model_dump(mode="json"),
            "jobs": [job.model_dump(mode="json") for job in collected["jobs"]],
            "background": collected["background"],
            "tools": [tool.model_dump(mode="json") for tool in collected["tools"]],
            "tool_calls": [entry.model_dump(mode="json") for entry in services.storage.list_tool_calls(20)],
            "generation_assets": [asset.model_dump(mode="json") for asset in services.storage.list_generation_assets(12)],
            "benchmark_runs": [run.model_dump(mode="json") for run in services.storage.list_benchmarks(12)],
            "machine_profile": collected["profile"],
            "integrity": services.storage.integrity_report(),
            "backups": [backup.as_dict() for backup in services.backups.list_backups()[:5]],
            "metrics": {
                "usage": services.storage.usage_metrics(),
                "queue": services.jobs.metrics(),
                "database": services.storage.data_counts(),
            },
        }

    @app.get("/api/ai/machine-profile")
    async def machine_profile(mode: str = "balanced", snapshots: int = 10) -> dict[str, Any]:
        collected = await collect_machine_profile(mode)
        return {
            "profile": collected["profile"],
            "snapshots": [
                snapshot.model_dump(mode="json")
                for snapshot in services.storage.list_machine_profile_snapshots(snapshots)
            ],
        }

    @app.post("/api/ai/machine-profile/snapshots")
    async def machine_profile_snapshot(request: MachineProfileSnapshotRequest) -> dict[str, Any]:
        collected = await collect_machine_profile()
        snapshot = services.storage.log_machine_profile_snapshot(
            source=request.source,
            profile=collected["profile"],
            autotune=collected["profile"].get("autotune", {}),
        )
        return {"snapshot": snapshot.model_dump(mode="json")}

    @app.post("/api/ai/autotune")
    async def autotune(request: AutotuneRequest) -> dict[str, Any]:
        mode_id = normalize_machine_mode_id(request.mode)
        benchmark_record = None
        benchmark_error = None
        try:
            benchmark_record = await run_benchmark(
                services.router,
                services.storage,
                BenchmarkRequest(
                    kind="text",
                    prompt=(
                        "Autotune probe. Reply with one short sentence describing whether this "
                        "local AI route is responsive."
                    ),
                    provider=request.provider,
                    model=request.model,
                    max_tokens=request.max_tokens,
                    iterations=1,
                    local_first=True,
                    metadata={"autotune": True, "machine_mode": {"id": mode_id}},
                ),
            )
        except Exception as error:
            benchmark_error = str(error)
            recent = services.storage.list_benchmarks(1)
            if recent and recent[0].prompt.startswith("Autotune probe."):
                benchmark_record = recent[0]

        collected = await collect_machine_profile(mode_id)
        autotune_summary = {
            **collected["profile"].get("autotune", {}),
            "ok": benchmark_error is None,
            "benchmark_id": benchmark_record.id if benchmark_record else None,
            "error": benchmark_error,
        }
        snapshot = None
        if request.persist_snapshot:
            snapshot = services.storage.log_machine_profile_snapshot(
                source=f"autotune:{mode_id}",
                profile=collected["profile"],
                autotune=autotune_summary,
            )
        return {
            "ok": benchmark_error is None,
            "benchmark": benchmark_record.model_dump(mode="json") if benchmark_record else None,
            "error": benchmark_error,
            "profile": collected["profile"],
            "snapshot": snapshot.model_dump(mode="json") if snapshot else None,
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

    @app.get("/api/ai/action-ledger")
    async def action_ledger(limit: int = 50) -> dict[str, Any]:
        entries = build_ai_action_ledger(
            storage=services.storage,
            backups=[backup.as_dict() for backup in services.backups.list_backups()],
            jobs=services.jobs.list(),
            limit=limit,
        )
        return {"actions": [entry.model_dump(mode="json") for entry in entries]}

    async def execute_research_run(run_id: str, run_request: ResearchRunRequest, monitor_id: str | None = None) -> None:
        try:
            result = await services.research.run_existing(run_id, run_request)
            if monitor_id:
                services.storage.mark_research_monitor_run_finished(monitor_id, result)
        except Exception as error:
            logger.exception("Background research run failed")
            if monitor_id:
                try:
                    services.storage.mark_research_monitor_run_failed(monitor_id, run_id, str(error))
                except Exception:
                    logger.exception("Failed to mark research monitor run failure")

    def queue_research_run(
        run_request: ResearchRunRequest,
        background_tasks: BackgroundTasks,
        *,
        monitor_id: str | None = None,
    ):
        run = services.research.create_run(run_request)
        if monitor_id:
            services.storage.mark_research_monitor_run_started(monitor_id, run)
        background_tasks.add_task(execute_research_run, run.id, run_request, monitor_id)
        return run

    @app.get("/api/ai/research/runs")
    async def research_runs(limit: int = 25) -> dict[str, Any]:
        return {"runs": [run.model_dump(mode="json") for run in services.storage.list_research_runs(limit)]}

    @app.get("/api/ai/research/sources")
    async def research_sources(q: str = "", domain: str = "", limit: int = 25) -> dict[str, Any]:
        return {
            "sources": [
                source.model_dump(mode="json")
                for source in services.storage.search_research_pages(q, domain=domain, limit=limit)
            ]
        }

    @app.get("/api/ai/research/monitors")
    async def research_monitors(limit: int = 50) -> dict[str, Any]:
        return {"monitors": [monitor.model_dump(mode="json") for monitor in services.storage.list_research_monitors(limit)]}

    @app.post("/api/ai/research/monitors")
    async def create_research_monitor(request: ResearchMonitorCreateRequest) -> dict[str, Any]:
        try:
            monitor = services.storage.create_research_monitor(request)
            return {"monitor": monitor.model_dump(mode="json")}
        except Exception as error:
            logger.exception("Research monitor failed to create")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.patch("/api/ai/research/monitors/{monitor_id}")
    async def update_research_monitor(monitor_id: str, request: ResearchMonitorUpdateRequest) -> dict[str, Any]:
        try:
            monitor = services.storage.update_research_monitor(monitor_id, request)
            return {"monitor": monitor.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Research monitor not found.") from error
        except Exception as error:
            logger.exception("Research monitor failed to update")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.delete("/api/ai/research/monitors/{monitor_id}")
    async def delete_research_monitor(monitor_id: str) -> dict[str, Any]:
        try:
            monitor = services.storage.delete_research_monitor(monitor_id)
            return {"monitor": monitor.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Research monitor not found.") from error

    @app.post("/api/ai/research/monitors/{monitor_id}/run")
    async def run_research_monitor(monitor_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
        try:
            monitor = services.storage.get_research_monitor(monitor_id)
            if not monitor:
                raise KeyError(monitor_id)
            metadata = {
                **monitor.request.metadata,
                "research_monitor_id": monitor.id,
                "research_monitor_name": monitor.name,
                "research_monitor_schedule": monitor.schedule,
            }
            request = monitor.request.model_copy(update={"metadata": metadata})
            run = queue_research_run(request, background_tasks, monitor_id=monitor.id)
            refreshed = services.storage.get_research_monitor(monitor.id) or monitor
            return {"monitor": refreshed.model_dump(mode="json"), "run": run.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Research monitor not found.") from error
        except Exception as error:
            logger.exception("Research monitor failed to run")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/api/ai/research/runs/{run_id}")
    async def research_run(run_id: str) -> dict[str, Any]:
        run = services.storage.get_research_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Research run not found.")
        return {"run": run.model_dump(mode="json")}

    @app.get("/api/ai/research/runs/{run_id}/export")
    async def research_export(run_id: str, format: str = "markdown"):
        run = services.storage.get_research_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Research run not found.")
        normalized = format.lower().strip()
        if normalized in {"json", "application/json"}:
            return {"run": run.model_dump(mode="json")}
        if normalized in {"html", "text/html"}:
            return HTMLResponse(export_research_html(run))
        if normalized not in {"markdown", "md", "text/markdown"}:
            raise HTTPException(status_code=400, detail="Supported formats: markdown, html, json.")
        return PlainTextResponse(export_research_markdown(run), media_type="text/markdown")

    @app.post("/api/ai/research/runs")
    async def create_research_run(request: ResearchRunRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
        try:
            run = queue_research_run(request, background_tasks)
            return {"run": run.model_dump(mode="json")}
        except Exception as error:
            logger.exception("Research run failed to queue")
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/api/ai/research/runs/{run_id}/cancel")
    async def cancel_research_run(run_id: str) -> dict[str, Any]:
        try:
            run = services.storage.get_research_run(run_id)
            if not run:
                raise KeyError(run_id)
            if run.status in {"succeeded", "failed", "cancelled"}:
                return {"run": run.model_dump(mode="json"), "message": "Run is already terminal."}
            cancelled = services.storage.request_research_run_cancel(run_id)
            return {"run": cancelled.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Research run not found.") from error

    @app.post("/api/ai/action-snapshots/{snapshot_id}/restore")
    async def restore_action_snapshot(snapshot_id: str, request: ActionSnapshotRestoreRequest) -> dict[str, Any]:
        started = time.perf_counter()
        arguments = {"snapshot_id": snapshot_id}
        if not request.confirm:
            result = {
                "ok": False,
                "tool_id": "action_snapshot.restore",
                "requires_confirmation": True,
                "snapshot_id": snapshot_id,
                "message": "Restore requires confirm: true because it writes a local file.",
            }
            services.storage.log_tool_call(
                tool_id="action_snapshot.restore",
                ok=False,
                safety="write",
                requires_confirmation=True,
                arguments=arguments,
                result=result,
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            raise HTTPException(status_code=409, detail=result["message"])
        try:
            result = restore_file_action_snapshot(
                settings=services.settings,
                storage=services.storage,
                snapshot_id=snapshot_id,
            )
            result["tool_id"] = "action_snapshot.restore"
            services.storage.log_tool_call(
                tool_id="action_snapshot.restore",
                ok=True,
                safety="write",
                requires_confirmation=True,
                arguments=arguments,
                result=result,
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            return {"restore": result}
        except KeyError as error:
            result = {"ok": False, "tool_id": "action_snapshot.restore", "snapshot_id": snapshot_id, "error": "Action snapshot not found."}
            services.storage.log_tool_call(
                tool_id="action_snapshot.restore",
                ok=False,
                safety="write",
                requires_confirmation=True,
                arguments=arguments,
                result=result,
                error=result["error"],
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            raise HTTPException(status_code=404, detail=result["error"]) from error
        except (FileNotFoundError, ValueError) as error:
            result = {"ok": False, "tool_id": "action_snapshot.restore", "snapshot_id": snapshot_id, "error": str(error)}
            services.storage.log_tool_call(
                tool_id="action_snapshot.restore",
                ok=False,
                safety="write",
                requires_confirmation=True,
                arguments=arguments,
                result=result,
                error=str(error),
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            raise HTTPException(status_code=409, detail=str(error)) from error

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
            mode_payload = {"machine_mode": machine_mode_policy(request.context).metadata()}
            direct_web = _web_command_payload(request.objective)
            if direct_web:
                tool_id, payload = direct_web
                payload = {**payload, **mode_payload}
                observation = await services.tools.call(tool_id, payload, confirmed=request.confirm_actions, run_id=run_id)
                status = "succeeded" if observation.get("ok") else "failed"
                if tool_id == "web.search" and observation.get("ok"):
                    output = f"Found {observation.get('result_count', 0)} web results for {payload.get('query')}."
                elif observation.get("ok"):
                    title = observation.get("title") or observation.get("final_url") or payload.get("url")
                    text_length = observation.get("text_length")
                    output = f"Extracted {title}"
                    if isinstance(text_length, int):
                        output += f" ({text_length} characters before truncation)."
                    else:
                        output += "."
                else:
                    output = str(observation.get("error") or "Web tool failed.")
                return {
                    "result": {
                        "id": new_id("agent"),
                        "agent_id": "command-bar",
                        "status": status,
                        "objective": request.objective,
                        "steps": [
                            {
                                "index": 0,
                                "phase": "plan",
                                "text": f"Matched direct {tool_id} command.",
                                "tool_calls": [{"tool_id": tool_id, "arguments": payload}],
                                "observations": [],
                            },
                            {
                                "index": 0,
                                "phase": "act",
                                "text": f"Called {tool_id}.",
                                "tool_calls": [],
                                "observations": [observation],
                            },
                        ],
                        "output": output,
                    },
                    "tool_calls": [
                        entry.model_dump(mode="json")
                        for entry in services.storage.list_tool_calls(25)
                        if entry.run_id == run_id
                    ],
                }
            direct_image_payload = _image_file_command_payload(request.objective)
            if direct_image_payload:
                direct_image_payload = {**direct_image_payload, **mode_payload}
                if request.provider:
                    direct_image_payload["provider"] = request.provider
                if request.model:
                    direct_image_payload["model"] = request.model
                observation = await services.tools.call(
                    "media.generate_image_file",
                    direct_image_payload,
                    confirmed=request.confirm_actions,
                    run_id=run_id,
                )
                if observation.get("requires_confirmation"):
                    status = "needs_more_steps"
                elif observation.get("ok"):
                    status = "succeeded"
                else:
                    status = "failed"
                output = str(observation.get("message") or observation.get("error") or "")
                if observation.get("ok") and observation.get("desktop_path"):
                    output = f"Saved generated image to {observation['desktop_path']}"
                elif observation.get("requires_confirmation"):
                    output = "This will generate an image and save it to your Desktop. Run again with confirmation to execute."
                return {
                    "result": {
                        "id": new_id("agent"),
                        "agent_id": "command-bar",
                        "status": status,
                        "objective": request.objective,
                        "steps": [
                            {
                                "index": 0,
                                "phase": "plan",
                                "text": "Matched direct image-file command.",
                                "tool_calls": [{"tool_id": "media.generate_image_file", "arguments": direct_image_payload}],
                                "observations": [],
                            },
                            {
                                "index": 0,
                                "phase": "act",
                                "text": "Called image generation file tool.",
                                "tool_calls": [],
                                "observations": [observation],
                            },
                        ],
                        "output": output,
                    },
                    "tool_calls": [
                        entry.model_dump(mode="json")
                        for entry in services.storage.list_tool_calls(25)
                        if entry.run_id == run_id
                    ],
                }
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
