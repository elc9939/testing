from __future__ import annotations

import time
from typing import Any

from .models import RecordingState, now_iso

try:
    from pynput import keyboard, mouse  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    keyboard = None
    mouse = None


class InputRecorder:
    def __init__(self):
        self._state = RecordingState()
        self._keyboard_listener = None
        self._mouse_listener = None
        self._started_monotonic = 0.0

    def status(self) -> RecordingState:
        return self._state

    def start(self, capture_keyboard: bool = True, capture_mouse: bool = True) -> RecordingState:
        if keyboard is None or mouse is None:
            self._state = RecordingState(active=False, error="pynput is not installed or cannot access input devices.")
            return self._state
        if self._state.active:
            return self._state
        self._state = RecordingState(active=True, started_at=now_iso(), events=[])
        self._started_monotonic = time.monotonic()

        if capture_keyboard:
            self._keyboard_listener = keyboard.Listener(on_press=self._on_key_down, on_release=self._on_key_up)
            self._keyboard_listener.start()
        if capture_mouse:
            self._mouse_listener = mouse.Listener(
                on_move=self._on_mouse_move,
                on_click=self._on_mouse_click,
                on_scroll=self._on_mouse_scroll,
            )
            self._mouse_listener.start()
        return self._state

    def stop(self) -> RecordingState:
        if self._keyboard_listener:
            self._keyboard_listener.stop()
            self._keyboard_listener = None
        if self._mouse_listener:
            self._mouse_listener.stop()
            self._mouse_listener = None
        self._state.active = False
        return self._state

    def _t(self) -> float:
        return round(time.monotonic() - self._started_monotonic, 4)

    def _append(self, event: dict[str, Any]) -> None:
        if self._state.active:
            self._state.events.append({"t": self._t(), **event})

    def _key_name(self, key: Any) -> str:
        if hasattr(key, "char") and key.char:
            return str(key.char)
        text = str(key)
        return text.removeprefix("Key.")

    def _on_key_down(self, key: Any) -> None:
        self._append({"kind": "key", "event": "down", "key": self._key_name(key)})

    def _on_key_up(self, key: Any) -> None:
        self._append({"kind": "key", "event": "up", "key": self._key_name(key)})

    def _on_mouse_move(self, x: int, y: int) -> None:
        if self._state.events and self._state.events[-1].get("kind") == "mouse_move":
            self._state.events[-1] = {"t": self._t(), "kind": "mouse_move", "x": x, "y": y}
        else:
            self._append({"kind": "mouse_move", "x": x, "y": y})

    def _on_mouse_click(self, x: int, y: int, button: Any, pressed: bool) -> None:
        self._append(
            {
                "kind": "mouse_click",
                "event": "down" if pressed else "up",
                "x": x,
                "y": y,
                "button": str(button).removeprefix("Button."),
            }
        )

    def _on_mouse_scroll(self, x: int, y: int, dx: int, dy: int) -> None:
        self._append({"kind": "mouse_scroll", "x": x, "y": y, "dx": dx, "dy": dy})
