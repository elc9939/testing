from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, platform
from .config import Settings, get_settings
from .engine import MacroEngine
from .models import ActionDefinition, MacroDefinition, MacroPatch, RunRequest, TriggerDefinition, WindowLayoutRecord
from .recorder import InputRecorder
from .storage import MacroStorage
from .triggers import TriggerManager

logger = logging.getLogger("macro_lab")


class Services:
    def __init__(self, settings: Settings, storage: MacroStorage):
        self.settings = settings
        self.storage = storage
        self.engine = MacroEngine(settings, storage)
        self.triggers = TriggerManager(settings, storage, self.engine)
        self.recorder = InputRecorder()
        self.clipboard_task: asyncio.Task[None] | None = None
        self.stop = asyncio.Event()


def setup_logging(settings: Settings) -> None:
    settings.log_path().parent.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger("macro_lab")
    root.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))
    if not root.handlers:
        handler = logging.FileHandler(settings.log_path(), encoding="utf-8")
        handler.setFormatter(JsonFormatter())
        root.addHandler(handler)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "created": record.created,
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=True)


def seed_defaults(storage: MacroStorage) -> None:
    if storage.list_macros():
        return
    defaults = [
        MacroDefinition(
            id="macro_study_mode",
            name="Study Mode",
            group="Workspaces",
            enabled=True,
            armed=False,
            dry_run_default=True,
            actions=[
                ActionDefinition(
                    id="action_study_mode",
                    type="workspace.mode",
                    label="Open study workspace",
                    config={
                        "launch": [
                            "notepad.exe",
                            "https://calendar.google.com",
                        ],
                        "layout": "study",
                    },
                )
            ],
            triggers=[TriggerDefinition(id="trigger_study_hotkey", type="hotkey", label="Ctrl+Alt+S", enabled=False, config={"keys": "<ctrl>+<alt>+s"})],
        ),
        MacroDefinition(
            id="macro_clipboard_upper",
            name="Clipboard Uppercase",
            group="Clipboard",
            enabled=True,
            armed=False,
            dry_run_default=True,
            actions=[
                ActionDefinition(
                    id="action_clipboard_upper",
                    type="clipboard.transform",
                    label="Uppercase clipboard",
                    config={"source": "clipboard", "transform": "upper", "paste": False},
                )
            ],
            triggers=[TriggerDefinition(id="trigger_clipboard_upper", type="hotkey", label="Ctrl+Alt+U", enabled=False, config={"keys": "<ctrl>+<alt>+u"})],
        ),
        MacroDefinition(
            id="macro_ollama_rewrite",
            name="Ollama Rewrite Selection",
            group="AI",
            enabled=True,
            armed=False,
            dry_run_default=True,
            actions=[
                ActionDefinition(
                    id="action_ollama_rewrite",
                    type="ollama.transform_clipboard",
                    label="Rewrite selected text locally",
                    config={"source": "selected", "prompt": "Rewrite this clearly and concisely:", "paste": True},
                )
            ],
            triggers=[TriggerDefinition(id="trigger_ollama_rewrite", type="hotkey", label="Ctrl+Alt+R", enabled=False, config={"keys": "<ctrl>+<alt>+r"})],
        ),
        MacroDefinition(
            id="macro_batch_rename_demo",
            name="Batch Rename Demo",
            group="Files",
            enabled=True,
            armed=False,
            dry_run_default=True,
            actions=[
                ActionDefinition(
                    id="action_batch_rename",
                    type="file.batch_rename",
                    label="Preview txt rename",
                    config={"directory": ".", "pattern": "*.txt", "find": "old", "replace": "new"},
                )
            ],
            triggers=[
                TriggerDefinition(
                    id="trigger_batch_folder",
                    type="folder",
                    label="Folder watcher example",
                    enabled=False,
                    config={"path": ".", "pattern": "*.txt", "recursive": False},
                )
            ],
        ),
    ]
    for macro in defaults:
        storage.upsert_macro(macro)


async def clipboard_loop(services: Services) -> None:
    while not services.stop.is_set():
        try:
            if any(item["id"] == "clipboard" and item["available"] for item in platform.capabilities()):
                services.storage.add_clipboard(platform.get_clipboard(), services.settings.max_clipboard_history)
        except Exception:
            logger.debug("Clipboard polling skipped", exc_info=True)
        try:
            await asyncio.wait_for(services.stop.wait(), timeout=max(0.5, services.settings.clipboard_poll_interval_s))
        except TimeoutError:
            continue


def create_app(settings: Settings | None = None, storage: MacroStorage | None = None) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings)
    storage = storage or MacroStorage(settings.database_path())
    seed_defaults(storage)
    services = Services(settings, storage)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        services.triggers.start()
        services.clipboard_task = asyncio.create_task(clipboard_loop(services), name="macro-lab-clipboard")
        try:
            yield
        finally:
            services.stop.set()
            await services.triggers.stop()
            if services.clipboard_task:
                services.clipboard_task.cancel()
                await asyncio.gather(services.clipboard_task, return_exceptions=True)
            storage.close()

    app = FastAPI(
        title="Mini Hub Macro Lab API",
        version=__version__,
        description="Local Windows desktop automation daemon for Macro Lab.",
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
        if settings.require_loopback and request.client and request.client.host not in {"127.0.0.1", "::1", "testclient"}:
            return JSONResponse({"detail": "Macro Lab only accepts loopback clients."}, status_code=403)
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > settings.max_request_bytes:
                    return JSONResponse({"detail": "Request body too large."}, status_code=413)
            except ValueError:
                return JSONResponse({"detail": "Invalid content-length header."}, status_code=400)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled request failure")
            raise
        logger.info(json.dumps({"method": request.method, "path": request.url.path, "status": response.status_code, "latency_ms": round((time.perf_counter() - started) * 1000, 2)}))
        return response

    @app.get("/api/macro-lab/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "service": "macro-lab", "version": __version__}

    @app.get("/api/macro-lab/status")
    async def status() -> dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "engine": services.engine.status(),
            "triggers": services.triggers.status(),
            "capabilities": platform.capabilities(),
            "integrity": services.storage.integrity_report(),
        }

    @app.get("/api/macro-lab/actions")
    async def actions() -> dict[str, Any]:
        return {"actions": services.engine.action_specs()}

    @app.get("/api/macro-lab/macros")
    async def list_macros() -> dict[str, Any]:
        return {"macros": [macro.model_dump(mode="json") for macro in services.storage.list_macros()]}

    @app.post("/api/macro-lab/macros")
    async def create_macro(macro: MacroDefinition) -> dict[str, Any]:
        saved = services.storage.upsert_macro(macro)
        services.triggers.rebuild()
        return {"macro": saved.model_dump(mode="json")}

    @app.get("/api/macro-lab/macros/{macro_id}")
    async def get_macro(macro_id: str) -> dict[str, Any]:
        macro = services.storage.get_macro(macro_id)
        if not macro:
            raise HTTPException(status_code=404, detail="Macro not found.")
        return {"macro": macro.model_dump(mode="json")}

    @app.patch("/api/macro-lab/macros/{macro_id}")
    async def patch_macro(macro_id: str, patch: MacroPatch) -> dict[str, Any]:
        macro = services.storage.get_macro(macro_id)
        if not macro:
            raise HTTPException(status_code=404, detail="Macro not found.")
        values = patch.model_dump(exclude_unset=True)
        for key, value in values.items():
            setattr(macro, key, value)
        saved = services.storage.upsert_macro(macro)
        services.triggers.rebuild()
        return {"macro": saved.model_dump(mode="json")}

    @app.put("/api/macro-lab/macros/{macro_id}")
    async def replace_macro(macro_id: str, macro: MacroDefinition) -> dict[str, Any]:
        macro.id = macro_id
        saved = services.storage.upsert_macro(macro)
        services.triggers.rebuild()
        return {"macro": saved.model_dump(mode="json")}

    @app.delete("/api/macro-lab/macros/{macro_id}")
    async def delete_macro(macro_id: str) -> dict[str, Any]:
        deleted = services.storage.delete_macro(macro_id)
        services.triggers.rebuild()
        return {"deleted": deleted}

    @app.post("/api/macro-lab/macros/{macro_id}/run")
    async def run_macro(macro_id: str, request: RunRequest) -> dict[str, Any]:
        try:
            run = await services.engine.run_macro(macro_id, request)
            return {"run": run.model_dump(mode="json")}
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/api/macro-lab/runs")
    async def runs(limit: int = 100) -> dict[str, Any]:
        return {"runs": services.storage.list_runs(limit)}

    @app.post("/api/macro-lab/panic")
    async def panic() -> dict[str, Any]:
        result = services.engine.panic()
        await services.triggers.stop()
        return result

    @app.post("/api/macro-lab/panic/reset")
    async def reset_panic() -> dict[str, Any]:
        result = services.engine.reset_panic()
        services.triggers.start()
        return result

    @app.post("/api/macro-lab/triggers/reload")
    async def reload_triggers() -> dict[str, Any]:
        services.triggers.rebuild()
        return services.triggers.status()

    @app.post("/api/macro-lab/recording/start")
    async def start_recording(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload or {}
        state = services.recorder.start(bool(payload.get("keyboard", True)), bool(payload.get("mouse", True)))
        return {"recording": state.model_dump(mode="json")}

    @app.post("/api/macro-lab/recording/stop")
    async def stop_recording() -> dict[str, Any]:
        state = services.recorder.stop()
        return {"recording": state.model_dump(mode="json")}

    @app.get("/api/macro-lab/recording")
    async def recording() -> dict[str, Any]:
        return {"recording": services.recorder.status().model_dump(mode="json")}

    @app.get("/api/macro-lab/clipboard")
    async def clipboard(limit: int = 50) -> dict[str, Any]:
        return {"clipboard": services.storage.list_clipboard(limit)}

    @app.get("/api/macro-lab/windows")
    async def windows() -> dict[str, Any]:
        try:
            return {"windows": [window.as_dict() for window in platform.list_windows()]}
        except Exception as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.get("/api/macro-lab/layouts")
    async def layouts() -> dict[str, Any]:
        return {"layouts": [layout.model_dump(mode="json") for layout in services.storage.list_layouts()]}

    @app.post("/api/macro-lab/layouts/{name}/capture")
    async def capture_layout(name: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        include = str((payload or {}).get("include") or "").lower()
        windows = [window.as_dict() for window in platform.list_windows() if not include or include in window.title.lower()]
        layout = services.storage.save_layout(WindowLayoutRecord(name=name, windows=windows))
        return {"layout": layout.model_dump(mode="json")}

    return app


app = create_app()
