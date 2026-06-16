from __future__ import annotations

import base64
import ctypes
import fnmatch
import json
import os
import shutil
import subprocess
import time
import webbrowser
from collections.abc import Callable
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import pyperclip  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    pyperclip = None

try:
    from pynput import keyboard, mouse  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    keyboard = None
    mouse = None


SW_RESTORE = 9
WM_CLOSE = 0x0010


@dataclass
class WindowInfo:
    hwnd: int
    title: str
    process_id: int
    x: int
    y: int
    width: int
    height: int
    visible: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "hwnd": self.hwnd,
            "title": self.title,
            "process_id": self.process_id,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "visible": self.visible,
        }


def capabilities() -> list[dict[str, Any]]:
    return [
        {"id": "windows", "available": os.name == "nt", "detail": "ctypes user32 window control"},
        {"id": "input", "available": keyboard is not None and mouse is not None, "detail": "pynput keyboard/mouse"},
        {"id": "clipboard", "available": pyperclip is not None, "detail": "pyperclip clipboard access"},
        {"id": "shell", "available": True, "detail": "subprocess shell commands"},
        {"id": "files", "available": True, "detail": "pathlib/shutil file operations"},
    ]


def require_input() -> None:
    if keyboard is None or mouse is None:
        raise RuntimeError("pynput is not installed or cannot access keyboard/mouse input on this machine.")


def require_clipboard() -> None:
    if pyperclip is None:
        raise RuntimeError("pyperclip is not installed or clipboard access is unavailable.")


def get_clipboard() -> str:
    require_clipboard()
    return str(pyperclip.paste() or "")


def set_clipboard(value: str) -> None:
    require_clipboard()
    pyperclip.copy(value)


def copy_selected_text(delay_s: float = 0.12) -> str:
    previous = get_clipboard() if pyperclip is not None else ""
    send_hotkey("ctrl+c")
    time.sleep(delay_s)
    selected = get_clipboard()
    if selected == previous:
        return selected
    return selected


def paste_text(value: str, delay_s: float = 0.05) -> None:
    set_clipboard(value)
    time.sleep(delay_s)
    send_hotkey("ctrl+v")


def _key_from_token(token: str):
    if keyboard is None:
        raise RuntimeError("pynput keyboard is unavailable.")
    clean = token.strip().lower().strip("<>")
    special = {
        "ctrl": keyboard.Key.ctrl,
        "control": keyboard.Key.ctrl,
        "alt": keyboard.Key.alt,
        "shift": keyboard.Key.shift,
        "cmd": keyboard.Key.cmd,
        "win": keyboard.Key.cmd,
        "enter": keyboard.Key.enter,
        "return": keyboard.Key.enter,
        "tab": keyboard.Key.tab,
        "esc": keyboard.Key.esc,
        "escape": keyboard.Key.esc,
        "space": keyboard.Key.space,
        "backspace": keyboard.Key.backspace,
        "delete": keyboard.Key.delete,
        "pause": keyboard.Key.pause,
        "up": keyboard.Key.up,
        "down": keyboard.Key.down,
        "left": keyboard.Key.left,
        "right": keyboard.Key.right,
        "home": keyboard.Key.home,
        "end": keyboard.Key.end,
        "page_up": keyboard.Key.page_up,
        "page_down": keyboard.Key.page_down,
    }
    if clean in special:
        return special[clean]
    if clean.startswith("f") and clean[1:].isdigit():
        value = getattr(keyboard.Key, clean, None)
        if value is not None:
            return value
    return clean


def send_hotkey(keys: str) -> None:
    require_input()
    controller = keyboard.Controller()
    tokens = [part.strip() for part in keys.replace("+", " ").split() if part.strip()]
    parsed = [_key_from_token(token) for token in tokens]
    for key in parsed:
        controller.press(key)
    for key in reversed(parsed):
        controller.release(key)


def type_text(value: str) -> None:
    require_input()
    keyboard.Controller().type(value)


def replay_input_events(events: list[dict[str, Any]], speed: float = 1.0) -> dict[str, Any]:
    require_input()
    key_controller = keyboard.Controller()
    mouse_controller = mouse.Controller()
    last_t = 0.0
    for event in events:
        event_t = float(event.get("t", 0))
        delay = max(0.0, (event_t - last_t) / max(speed, 0.01))
        if delay:
            time.sleep(min(delay, 5.0))
        last_t = event_t
        kind = event.get("kind")
        if kind == "key":
            key = _key_from_token(str(event.get("key", "")))
            if event.get("event") == "down":
                key_controller.press(key)
            else:
                key_controller.release(key)
        elif kind == "mouse_move":
            mouse_controller.position = (int(event.get("x", 0)), int(event.get("y", 0)))
        elif kind == "mouse_click":
            mouse_controller.position = (int(event.get("x", 0)), int(event.get("y", 0)))
            button = getattr(mouse.Button, str(event.get("button", "left")), mouse.Button.left)
            if event.get("event") == "down":
                mouse_controller.press(button)
            else:
                mouse_controller.release(button)
        elif kind == "mouse_scroll":
            mouse_controller.scroll(int(event.get("dx", 0)), int(event.get("dy", 0)))
    return {"events_replayed": len(events)}


def launch_target(target: str, args: list[str] | None = None, cwd: str | None = None) -> dict[str, Any]:
    args = args or []
    if target.startswith(("http://", "https://")):
        webbrowser.open(target)
        return {"launched": target, "method": "webbrowser"}
    if Path(target).exists():
        os.startfile(target)  # type: ignore[attr-defined]
        return {"launched": target, "method": "os.startfile"}
    process = subprocess.Popen([target, *args], cwd=cwd or None)
    return {"launched": target, "pid": process.pid, "method": "subprocess"}


def run_shell(command: str, cwd: str | None = None, timeout_s: float = 60.0) -> dict[str, Any]:
    completed = subprocess.run(
        command,
        cwd=cwd or None,
        shell=True,
        text=True,
        capture_output=True,
        timeout=timeout_s,
    )
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout[-4000:],
        "stderr": completed.stderr[-4000:],
    }


def _windows_user32():
    if os.name != "nt":
        raise RuntimeError("Window control is available only on Windows.")
    return ctypes.windll.user32


def list_windows() -> list[WindowInfo]:
    user32 = _windows_user32()
    windows: list[WindowInfo] = []

    def callback(hwnd: int, _lparam: int) -> bool:
        if not user32.IsWindow(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        title = buffer.value.strip()
        if not title:
            return True
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        process_id = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        windows.append(
            WindowInfo(
                hwnd=int(hwnd),
                title=title,
                process_id=int(process_id.value),
                x=int(rect.left),
                y=int(rect.top),
                width=int(rect.right - rect.left),
                height=int(rect.bottom - rect.top),
                visible=bool(user32.IsWindowVisible(hwnd)),
            )
        )
        return True

    enum_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)(callback)
    user32.EnumWindows(enum_proc, 0)
    return windows


def find_window(query: str) -> WindowInfo:
    lowered = query.lower()
    matches = [window for window in list_windows() if lowered in window.title.lower()]
    if not matches:
        raise RuntimeError(f"No window matched: {query}")
    return matches[0]


def focus_window(query: str) -> dict[str, Any]:
    user32 = _windows_user32()
    window = find_window(query)
    user32.ShowWindow(window.hwnd, SW_RESTORE)
    user32.SetForegroundWindow(window.hwnd)
    return window.as_dict()


def close_window(query: str) -> dict[str, Any]:
    user32 = _windows_user32()
    window = find_window(query)
    user32.PostMessageW(window.hwnd, WM_CLOSE, 0, 0)
    return window.as_dict()


def move_window(title: str, x: int, y: int, width: int, height: int) -> dict[str, Any]:
    user32 = _windows_user32()
    window = find_window(title)
    user32.MoveWindow(window.hwnd, int(x), int(y), int(width), int(height), True)
    return {**window.as_dict(), "target": {"x": x, "y": y, "width": width, "height": height}}


def active_window_title() -> str:
    user32 = _windows_user32()
    hwnd = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def transform_text(value: str, transform: str) -> str:
    if transform == "upper":
        return value.upper()
    if transform == "lower":
        return value.lower()
    if transform == "title":
        return value.title()
    if transform == "trim":
        return value.strip()
    if transform == "json_pretty":
        return json.dumps(json.loads(value), indent=2)
    if transform == "base64_encode":
        return base64.b64encode(value.encode("utf-8")).decode("ascii")
    if transform == "base64_decode":
        return base64.b64decode(value.encode("ascii")).decode("utf-8")
    raise ValueError(f"Unknown clipboard transform: {transform}")


def batch_rename(directory: Path, pattern: str, find: str = "", replace: str = "", prefix: str = "", suffix: str = "", dry_run: bool = True) -> list[dict[str, str]]:
    operations: list[dict[str, str]] = []
    for path in sorted(directory.iterdir()):
        if not path.is_file() or not fnmatch.fnmatch(path.name, pattern):
            continue
        stem = path.stem.replace(find, replace) if find else path.stem
        target = path.with_name(f"{prefix}{stem}{suffix}{path.suffix}")
        operations.append({"source": str(path), "target": str(target)})
        if not dry_run and target != path:
            path.rename(target)
    return operations


def file_move(source: Path, target: Path, dry_run: bool = True) -> dict[str, str]:
    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))
    return {"source": str(source), "target": str(target)}


def file_copy(source: Path, target: Path, dry_run: bool = True) -> dict[str, str]:
    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return {"source": str(source), "target": str(target)}


def file_delete(path: Path, dry_run: bool = True) -> dict[str, str]:
    if not dry_run:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    return {"path": str(path)}


def safe_path(value: str) -> Path:
    return Path(value).expanduser().resolve()


def call_later(callback: Callable[[], None]) -> None:
    callback()
