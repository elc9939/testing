from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..models import now_iso

TriggerKind = Literal["schedule", "folder_watch", "app_event"]
BackgroundHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class BackgroundUnit(BaseModel):
    id: str
    label: str
    trigger: TriggerKind
    enabled: bool = False
    destructive: bool = False
    demo: bool = True
    description: str
    last_run_at: str | None = None
    last_result: dict[str, Any] | None = None


class BackgroundRegistry:
    def __init__(self) -> None:
        self._units: dict[str, BackgroundUnit] = {}
        self._handlers: dict[str, BackgroundHandler] = {}

    def register(self, unit: BackgroundUnit, handler: BackgroundHandler) -> None:
        self._units[unit.id] = unit
        self._handlers[unit.id] = handler

    def list(self) -> list[BackgroundUnit]:
        return list(self._units.values())

    def toggle(self, unit_id: str, enabled: bool) -> BackgroundUnit:
        if unit_id not in self._units:
            raise KeyError(unit_id)
        values = self._units[unit_id].model_dump()
        values["enabled"] = enabled
        self._units[unit_id] = BackgroundUnit(**values)
        return self._units[unit_id]

    async def run(self, unit_id: str, payload: dict[str, Any] | None = None) -> BackgroundUnit:
        if unit_id not in self._units:
            raise KeyError(unit_id)
        result = await self._handlers[unit_id](payload or {})
        values = self._units[unit_id].model_dump()
        values.update({"last_run_at": now_iso(), "last_result": result})
        self._units[unit_id] = BackgroundUnit(**values)
        return self._units[unit_id]


def build_background_registry() -> BackgroundRegistry:
    registry = BackgroundRegistry()

    async def demo_handler(payload: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True, "demo": True, "payload": payload, "note": "Replace this registered unit with a real watcher/job."}

    registry.register(
        BackgroundUnit(
            id="demo.schedule.noop",
            label="Schedule trigger demo",
            trigger="schedule",
            description="Off-by-default scheduled trigger plumbing placeholder.",
        ),
        demo_handler,
    )
    registry.register(
        BackgroundUnit(
            id="demo.folder.noop",
            label="Folder watch demo",
            trigger="folder_watch",
            description="Off-by-default folder watch plumbing placeholder.",
        ),
        demo_handler,
    )
    registry.register(
        BackgroundUnit(
            id="demo.app-event.noop",
            label="App event demo",
            trigger="app_event",
            description="Off-by-default app event trigger plumbing placeholder.",
        ),
        demo_handler,
    )
    return registry
