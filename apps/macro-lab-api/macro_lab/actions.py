from __future__ import annotations

import asyncio
import string
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx

from .config import Settings
from .models import ActionDefinition, ActionSpec, SafetyLevel, WindowLayoutRecord
from .storage import MacroStorage
from . import platform


class StopRequested(RuntimeError):
    pass


@dataclass
class ActionContext:
    settings: Settings
    storage: MacroStorage
    dry_run: bool
    variables: dict[str, Any]
    trigger_context: dict[str, Any]
    should_stop: asyncio.Event

    def check_stop(self) -> None:
        if self.should_stop.is_set():
            raise StopRequested("Macro execution stopped by panic/cancel.")


class ActionHandler(Protocol):
    spec: ActionSpec

    async def execute(self, action: ActionDefinition, context: ActionContext) -> dict[str, Any]:
        ...


class FunctionAction:
    def __init__(self, spec: ActionSpec, handler):
        self.spec = spec
        self._handler = handler

    async def execute(self, action: ActionDefinition, context: ActionContext) -> dict[str, Any]:
        rendered = render_value(action.config, context)
        return await maybe_await(self._handler(action, rendered, context))


async def maybe_await(value):
    if asyncio.iscoroutine(value):
        return await value
    return value


class ActionRegistry:
    def __init__(self):
        self._handlers: dict[str, ActionHandler] = {}

    def register(self, handler: ActionHandler) -> None:
        self._handlers[handler.spec.type] = handler

    def get(self, action_type: str) -> ActionHandler:
        if action_type not in self._handlers:
            raise KeyError(f"Unknown action type: {action_type}")
        return self._handlers[action_type]

    def specs(self) -> list[ActionSpec]:
        return sorted((handler.spec for handler in self._handlers.values()), key=lambda spec: spec.type)


def render_template(value: str, context: ActionContext) -> str:
    variables = {
        **context.variables,
        **context.trigger_context,
        "clipboard": platform.get_clipboard() if "{clipboard" in value and _clipboard_available() else "",
    }
    return string.Formatter().vformat(value, (), SafeDict(variables))


class SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def render_value(value: Any, context: ActionContext) -> Any:
    if isinstance(value, str):
        return render_template(value, context)
    if isinstance(value, list):
        return [render_value(item, context) for item in value]
    if isinstance(value, dict):
        return {key: render_value(item, context) for key, item in value.items()}
    return value


def _clipboard_available() -> bool:
    return any(capability["id"] == "clipboard" and capability["available"] for capability in platform.capabilities())


def _plan(action: ActionDefinition, config: dict[str, Any], message: str) -> dict[str, Any]:
    return {"dry_run": True, "action": action.type, "message": message, "config": config}


def app_launch(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    target = str(config["target"])
    args = [str(arg) for arg in config.get("args", [])]
    cwd = str(config["cwd"]) if config.get("cwd") else None
    if context.dry_run:
        return _plan(action, config, f"Would launch {target}")
    return platform.launch_target(target, args=args, cwd=cwd)


def app_focus(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    query = str(config["query"])
    if context.dry_run:
        return _plan(action, config, f"Would focus first window matching {query}")
    return platform.focus_window(query)


def app_close(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    query = str(config["query"])
    if context.dry_run:
        return _plan(action, config, f"Would close first window matching {query}")
    return platform.close_window(query)


def shell_run(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    command = str(config["command"])
    cwd = str(config["cwd"]) if config.get("cwd") else None
    timeout_s = float(config.get("timeout_s", 60))
    if context.dry_run:
        return _plan(action, config, f"Would run shell command: {command}")
    return platform.run_shell(command, cwd=cwd, timeout_s=timeout_s)


def input_hotkey(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    keys = str(config["keys"])
    if context.dry_run:
        return _plan(action, config, f"Would send hotkey {keys}")
    platform.send_hotkey(keys)
    return {"sent": keys}


def input_type_text(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    text = str(config["text"])
    if context.dry_run:
        return _plan(action, config, f"Would type {len(text)} characters")
    platform.type_text(text)
    return {"typed_chars": len(text)}


def input_playback(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    events = list(config.get("events", []))
    speed = float(config.get("speed", 1.0))
    if context.dry_run:
        return _plan(action, {"events": events[:5], "speed": speed, "event_count": len(events)}, f"Would replay {len(events)} events")
    return platform.replay_input_events(events, speed=speed)


def clipboard_set(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    text = str(config.get("text", ""))
    if context.dry_run:
        return _plan(action, config, f"Would set clipboard to {len(text)} characters")
    platform.set_clipboard(text)
    context.storage.add_clipboard(text, context.settings.max_clipboard_history)
    return {"clipboard_chars": len(text)}


def clipboard_paste_text(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    text = str(config.get("text", ""))
    if context.dry_run:
        return _plan(action, config, f"Would paste {len(text)} characters")
    platform.paste_text(text)
    context.storage.add_clipboard(text, context.settings.max_clipboard_history)
    return {"pasted_chars": len(text)}


def clipboard_transform(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    source = str(config.get("source", "clipboard"))
    transform = str(config["transform"])
    paste = bool(config.get("paste", False))
    value = platform.copy_selected_text() if source == "selected" and not context.dry_run else platform.get_clipboard()
    transformed = platform.transform_text(value, transform)
    if context.dry_run:
        return _plan(action, {**config, "input_preview": value[:120], "output_preview": transformed[:120]}, f"Would transform clipboard with {transform}")
    platform.set_clipboard(transformed)
    context.storage.add_clipboard(transformed, context.settings.max_clipboard_history)
    if paste:
        platform.send_hotkey("ctrl+v")
    return {"transform": transform, "input_chars": len(value), "output_chars": len(transformed), "pasted": paste}


async def ollama_transform_clipboard(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    source = str(config.get("source", "selected"))
    paste = bool(config.get("paste", True))
    model = str(config.get("model") or context.settings.ollama_model)
    prompt = str(config.get("prompt", "Rewrite the following text clearly and concisely:"))
    value = platform.get_clipboard() if source == "clipboard" or context.dry_run else platform.copy_selected_text()
    if context.dry_run:
        return _plan(action, {**config, "input_preview": value[:160], "model": model}, "Would send text to local Ollama and paste the response")
    async with httpx.AsyncClient(timeout=context.settings.ollama_timeout_s) as client:
        response = await client.post(
            f"{context.settings.ollama_base_url.rstrip('/')}/api/chat",
            json={
                "model": model,
                "stream": False,
                "messages": [
                    {"role": "system", "content": "You are a concise local desktop text transformer."},
                    {"role": "user", "content": f"{prompt}\n\n{value}"},
                ],
                "options": {"num_ctx": context.settings.ollama_context_tokens},
            },
        )
        response.raise_for_status()
        data = response.json()
    result = str(data.get("message", {}).get("content") or data.get("response") or "")
    platform.set_clipboard(result)
    context.storage.add_clipboard(result, context.settings.max_clipboard_history)
    if paste:
        platform.send_hotkey("ctrl+v")
    return {"model": model, "input_chars": len(value), "output_chars": len(result), "pasted": paste}


def file_batch_rename(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    directory = platform.safe_path(str(config["directory"]))
    operations = platform.batch_rename(
        directory,
        pattern=str(config.get("pattern", "*")),
        find=str(config.get("find", "")),
        replace=str(config.get("replace", "")),
        prefix=str(config.get("prefix", "")),
        suffix=str(config.get("suffix", "")),
        dry_run=context.dry_run,
    )
    return {"operations": operations, "count": len(operations), "dry_run": context.dry_run}


def file_move(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    return platform.file_move(platform.safe_path(str(config["source"])), platform.safe_path(str(config["target"])), dry_run=context.dry_run)


def file_copy(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    return platform.file_copy(platform.safe_path(str(config["source"])), platform.safe_path(str(config["target"])), dry_run=context.dry_run)


def file_delete(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    return platform.file_delete(platform.safe_path(str(config["path"])), dry_run=context.dry_run)


def window_save_layout(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    name = str(config.get("name") or "default")
    include = str(config.get("include", "")).lower()
    windows = [window.as_dict() for window in platform.list_windows() if not include or include in window.title.lower()]
    if context.dry_run:
        return _plan(action, {**config, "matched": len(windows)}, f"Would save layout {name}")
    layout = context.storage.save_layout(WindowLayoutRecord(name=name, windows=windows))
    return {"layout": layout.model_dump(mode="json"), "window_count": len(windows)}


def window_restore_layout(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    name = str(config["name"])
    layout = context.storage.get_layout(name)
    if not layout:
        raise RuntimeError(f"No saved layout named {name}")
    if context.dry_run:
        return _plan(action, {"name": name, "window_count": len(layout.windows)}, f"Would restore layout {name}")
    restored: list[dict[str, Any]] = []
    errors: list[str] = []
    for window in layout.windows:
        try:
            restored.append(
                platform.move_window(
                    str(window["title"]),
                    int(window["x"]),
                    int(window["y"]),
                    int(window["width"]),
                    int(window["height"]),
                )
            )
        except Exception as error:
            errors.append(f"{window.get('title')}: {error}")
    return {"restored": restored, "errors": errors}


def workspace_mode(action: ActionDefinition, config: dict[str, Any], context: ActionContext) -> dict[str, Any]:
    launched: list[dict[str, Any]] = []
    if context.dry_run:
        return _plan(action, config, "Would launch workspace mode and optionally restore layout")
    for target in config.get("launch", []):
        if isinstance(target, str):
            launched.append(platform.launch_target(target))
        elif isinstance(target, dict):
            launched.append(platform.launch_target(str(target["target"]), args=target.get("args", []), cwd=target.get("cwd")))
    layout_name = config.get("layout")
    restored: dict[str, Any] | None = None
    if layout_name:
        restored = window_restore_layout(action, {"name": layout_name}, context)
    return {"launched": launched, "restored": restored}


def build_action_registry() -> ActionRegistry:
    registry = ActionRegistry()

    def add(action_type: str, label: str, safety: SafetyLevel, description: str, example: dict[str, Any], handler) -> None:
        registry.register(FunctionAction(ActionSpec(type=action_type, label=label, safety=safety, description=description, config_example=example), handler))

    add("app.launch", "Launch app or URL", "system", "Launch an executable, file, folder, or URL.", {"target": "notepad.exe"}, app_launch)
    add("app.focus", "Focus window", "input", "Bring the first matching window to the foreground.", {"query": "Notepad"}, app_focus)
    add("app.close", "Close window", "destructive", "Send WM_CLOSE to the first matching window.", {"query": "Notepad"}, app_close)
    add("shell.run", "Run shell command", "system", "Run a shell command with timeout and captured output.", {"command": "echo hello", "timeout_s": 30}, shell_run)
    add("input.hotkey", "Send hotkey", "input", "Send a keyboard shortcut through pynput.", {"keys": "ctrl+s"}, input_hotkey)
    add("input.type_text", "Type text", "input", "Type rendered text into the active app.", {"text": "Hello {name}"}, input_type_text)
    add("input.playback", "Replay input recording", "input", "Replay recorded keyboard/mouse events.", {"events": [], "speed": 1.0}, input_playback)
    add("clipboard.set", "Set clipboard", "input", "Set clipboard text.", {"text": "value"}, clipboard_set)
    add("clipboard.paste_text", "Paste text", "input", "Set clipboard and press Ctrl+V.", {"text": "value"}, clipboard_paste_text)
    add("clipboard.transform", "Transform clipboard", "input", "Transform clipboard or selected text.", {"source": "clipboard", "transform": "upper", "paste": False}, clipboard_transform)
    add("ollama.transform_clipboard", "Ollama clipboard transform", "input", "Send selected/clipboard text to local Ollama and paste the response.", {"source": "selected", "prompt": "Summarize:", "paste": True}, ollama_transform_clipboard)
    add("file.batch_rename", "Batch rename", "destructive", "Rename matching files in a directory.", {"directory": ".", "pattern": "*.txt", "find": "old", "replace": "new"}, file_batch_rename)
    add("file.move", "Move file", "destructive", "Move a file or folder.", {"source": "a.txt", "target": "archive/a.txt"}, file_move)
    add("file.copy", "Copy file", "system", "Copy a file.", {"source": "a.txt", "target": "copy/a.txt"}, file_copy)
    add("file.delete", "Delete file", "destructive", "Delete a file or folder.", {"path": "old.txt"}, file_delete)
    add("window.save_layout", "Save window layout", "safe", "Capture current visible window geometry.", {"name": "study", "include": ""}, window_save_layout)
    add("window.restore_layout", "Restore window layout", "system", "Move matching windows to saved geometry.", {"name": "study"}, window_restore_layout)
    add("workspace.mode", "Workspace mode", "system", "Launch apps/URLs and optionally restore a layout.", {"launch": ["notepad.exe", "https://calendar.google.com"], "layout": "study"}, workspace_mode)
    return registry
