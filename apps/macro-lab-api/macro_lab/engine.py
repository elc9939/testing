from __future__ import annotations

import asyncio
import logging
from typing import Any

from .actions import ActionContext, ActionRegistry, StopRequested, build_action_registry
from .config import Settings
from .models import MacroDefinition, RunRecord, RunRequest, StepResult, now_iso
from .storage import MacroStorage

logger = logging.getLogger(__name__)


class MacroEngine:
    def __init__(self, settings: Settings, storage: MacroStorage, actions: ActionRegistry | None = None):
        self.settings = settings
        self.storage = storage
        self.actions = actions or build_action_registry()
        self._stop_event = asyncio.Event()
        self._running: dict[str, asyncio.Task[RunRecord]] = {}
        self._panic = bool(storage.get_setting("panic", False))
        if self._panic:
            self._stop_event.set()

    @property
    def panic_active(self) -> bool:
        return self._panic

    def action_specs(self):
        return [spec.model_dump(mode="json") for spec in self.actions.specs()]

    def status(self) -> dict[str, Any]:
        return {
            "panic": self._panic,
            "running": len(self._running),
            "action_count": len(self.actions.specs()),
        }

    def panic(self) -> dict[str, Any]:
        self._panic = True
        self.storage.set_setting("panic", True)
        self._stop_event.set()
        for task in self._running.values():
            task.cancel()
        return {"panic": True, "cancelled": len(self._running)}

    def reset_panic(self) -> dict[str, Any]:
        self._panic = False
        self.storage.set_setting("panic", False)
        self._stop_event = asyncio.Event()
        return {"panic": False}

    async def run_macro(self, macro_id: str, request: RunRequest | None = None, from_trigger: bool = False) -> RunRecord:
        request = request or RunRequest()
        macro = self.storage.get_macro(macro_id)
        if not macro:
            raise KeyError(f"Macro not found: {macro_id}")
        if from_trigger and not macro.enabled:
            raise RuntimeError("Macro is disabled.")
        if self._panic:
            raise RuntimeError("Macro Lab panic is active. Reset panic before running macros.")
        dry_run = macro.dry_run_default if request.dry_run is None else request.dry_run
        run = RunRecord(
            macro_id=macro.id,
            macro_name=macro.name,
            trigger_id=request.trigger_id,
            dry_run=dry_run,
            status="running",
        )
        self.storage.append_run(run, self.settings.max_run_history)
        task = asyncio.create_task(self._execute(macro, run, request))
        self._running[run.id] = task
        try:
            return await task
        finally:
            self._running.pop(run.id, None)

    async def _execute(self, macro: MacroDefinition, run: RunRecord, request: RunRequest) -> RunRecord:
        dry_run = run.dry_run
        variables = {**macro.variables, **request.variables}
        context = ActionContext(
            settings=self.settings,
            storage=self.storage,
            dry_run=dry_run,
            variables=variables,
            trigger_context=request.trigger_context,
            should_stop=self._stop_event,
        )
        try:
            for action in macro.actions:
                started = now_iso()
                if not action.enabled:
                    run.steps.append(
                        StepResult(
                            action_id=action.id,
                            action_type=action.type,
                            label=action.label,
                            safety="safe",
                            status="skipped",
                            message="Action disabled.",
                            started_at=started,
                            finished_at=now_iso(),
                        )
                    )
                    continue
                handler = self.actions.get(action.type)
                safety = handler.spec.safety
                if not dry_run and safety != "safe" and not macro.armed and not request.confirm:
                    raise PermissionError(
                        f"Action {action.type} is {safety}; arm the macro or run with confirm=true."
                    )
                context.check_stop()
                try:
                    detail = await handler.execute(action, context)
                    run.steps.append(
                        StepResult(
                            action_id=action.id,
                            action_type=action.type,
                            label=action.label,
                            safety=safety,
                            status="dry_run" if dry_run else "succeeded",
                            message=handler.spec.label,
                            detail=detail,
                            started_at=started,
                            finished_at=now_iso(),
                        )
                    )
                    self.storage.append_run(run, self.settings.max_run_history)
                except Exception as error:
                    logger.exception("Macro action failed", extra={"macro_id": macro.id, "action_type": action.type})
                    run.steps.append(
                        StepResult(
                            action_id=action.id,
                            action_type=action.type,
                            label=action.label,
                            safety=safety,
                            status="failed",
                            message=str(error),
                            started_at=started,
                            finished_at=now_iso(),
                        )
                    )
                    raise
            run.status = "dry_run" if dry_run else "succeeded"
        except asyncio.CancelledError:
            run.status = "cancelled"
            run.error = "Cancelled."
        except StopRequested as error:
            run.status = "cancelled"
            run.error = str(error)
        except Exception as error:
            run.status = "failed"
            run.error = str(error)
        finally:
            run.finished_at = now_iso()
            self.storage.append_run(run, self.settings.max_run_history)
        return run
