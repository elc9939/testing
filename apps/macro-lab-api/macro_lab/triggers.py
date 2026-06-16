from __future__ import annotations

import asyncio
import fnmatch
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import Settings
from .engine import MacroEngine
from .models import MacroDefinition, RunRequest
from .platform import active_window_title, keyboard
from .storage import MacroStorage

try:
    from watchdog.events import FileSystemEventHandler  # type: ignore
    from watchdog.observers import Observer  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    FileSystemEventHandler = None
    Observer = None

logger = logging.getLogger(__name__)


class FolderHandler(FileSystemEventHandler if FileSystemEventHandler is not None else object):
    def __init__(self, manager: "TriggerManager", macro: MacroDefinition, trigger_id: str, pattern: str):
        self.manager = manager
        self.macro = macro
        self.trigger_id = trigger_id
        self.pattern = pattern

    def on_created(self, event):  # type: ignore[override]
        if getattr(event, "is_directory", False):
            return
        path = str(event.src_path)
        if fnmatch.fnmatch(Path(path).name, self.pattern):
            self.manager.submit(self.macro.id, self.trigger_id, {"path": path, "event": "created"})


class TriggerManager:
    def __init__(self, settings: Settings, storage: MacroStorage, engine: MacroEngine):
        self.settings = settings
        self.storage = storage
        self.engine = engine
        self.loop: asyncio.AbstractEventLoop | None = None
        self._hotkeys = None
        self._observers: list[Any] = []
        self._tasks: list[asyncio.Task[None]] = []
        self._enabled = False
        self._errors: list[str] = []

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "hotkeys": bool(self._hotkeys),
            "observers": len(self._observers),
            "tasks": len([task for task in self._tasks if not task.done()]),
            "errors": self._errors[-10:],
        }

    def start(self) -> None:
        if self._enabled:
            return
        self.loop = asyncio.get_running_loop()
        self._enabled = True
        self.rebuild()

    async def stop(self) -> None:
        self._enabled = False
        if self._hotkeys:
            self._hotkeys.stop()
            self._hotkeys = None
        for observer in self._observers:
            observer.stop()
            observer.join(timeout=2)
        self._observers = []
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    def rebuild(self) -> None:
        if not self._enabled:
            return
        self._errors = []
        if self._hotkeys:
            self._hotkeys.stop()
            self._hotkeys = None
        for observer in self._observers:
            observer.stop()
            observer.join(timeout=2)
        self._observers = []
        for task in self._tasks:
            task.cancel()
        self._tasks = []

        hotkey_map: dict[str, Any] = {}
        if self.settings.panic_hotkey:
            hotkey_map[self.settings.panic_hotkey] = self.engine.panic

        for macro in self.storage.list_macros():
            if not macro.enabled:
                continue
            for trigger in macro.triggers:
                if not trigger.enabled:
                    continue
                try:
                    if trigger.type == "hotkey":
                        keys = str(trigger.config["keys"])
                        hotkey_map[keys] = self._callback(macro.id, trigger.id, {"hotkey": keys})
                    elif trigger.type == "schedule":
                        self._tasks.append(asyncio.create_task(self._schedule_loop(macro.id, trigger.id, trigger.config)))
                    elif trigger.type == "folder":
                        self._start_folder_trigger(macro, trigger.id, trigger.config)
                    elif trigger.type == "app_focus":
                        self._tasks.append(asyncio.create_task(self._focus_loop(macro.id, trigger.id, trigger.config)))
                except Exception as error:
                    message = f"{macro.name}/{trigger.type}: {error}"
                    logger.exception("Failed to start trigger")
                    self._errors.append(message)

        if hotkey_map:
            if keyboard is None:
                self._errors.append("pynput is unavailable; hotkeys are disabled.")
            else:
                try:
                    self._hotkeys = keyboard.GlobalHotKeys(hotkey_map)
                    self._hotkeys.start()
                except Exception as error:
                    self._errors.append(f"Failed to start hotkeys: {error}")

    def _callback(self, macro_id: str, trigger_id: str, context: dict[str, Any]):
        def run() -> None:
            self.submit(macro_id, trigger_id, context)

        return run

    def submit(self, macro_id: str, trigger_id: str, context: dict[str, Any]) -> None:
        if not self.loop or self.engine.panic_active:
            return
        request = RunRequest(dry_run=False, confirm=False, trigger_id=trigger_id, trigger_context=context)
        asyncio.run_coroutine_threadsafe(self.engine.run_macro(macro_id, request, from_trigger=True), self.loop)

    async def _schedule_loop(self, macro_id: str, trigger_id: str, config: dict[str, Any]) -> None:
        interval = float(config.get("interval_seconds") or 0)
        daily_at = str(config.get("at") or "")
        last_daily = ""
        while self._enabled:
            try:
                if interval > 0:
                    await asyncio.sleep(interval)
                    self.submit(macro_id, trigger_id, {"schedule": "interval", "interval_seconds": interval})
                elif daily_at:
                    now = datetime.now()
                    stamp = now.strftime("%Y-%m-%d")
                    if now.strftime("%H:%M") == daily_at and last_daily != stamp:
                        last_daily = stamp
                        self.submit(macro_id, trigger_id, {"schedule": "daily", "at": daily_at})
                    await asyncio.sleep(self.settings.trigger_poll_interval_s)
                else:
                    await asyncio.sleep(self.settings.trigger_poll_interval_s)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self._errors.append(f"schedule {trigger_id}: {error}")
                await asyncio.sleep(self.settings.trigger_poll_interval_s)

    def _start_folder_trigger(self, macro: MacroDefinition, trigger_id: str, config: dict[str, Any]) -> None:
        if Observer is None or FileSystemEventHandler is None:
            raise RuntimeError("watchdog is unavailable; folder triggers are disabled.")
        path = Path(str(config["path"])).expanduser().resolve()
        pattern = str(config.get("pattern", "*"))
        path.mkdir(parents=True, exist_ok=True)
        observer = Observer()
        observer.schedule(FolderHandler(self, macro, trigger_id, pattern), str(path), recursive=bool(config.get("recursive", False)))
        observer.start()
        self._observers.append(observer)

    async def _focus_loop(self, macro_id: str, trigger_id: str, config: dict[str, Any]) -> None:
        query = str(config.get("query") or "").lower()
        last_match = False
        while self._enabled:
            try:
                title = active_window_title()
                match = query in title.lower() if query else bool(title)
                if match and not last_match:
                    self.submit(macro_id, trigger_id, {"active_window_title": title})
                last_match = match
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self._errors.append(f"focus {trigger_id}: {error}")
            await asyncio.sleep(float(config.get("poll_seconds", self.settings.trigger_poll_interval_s)))
