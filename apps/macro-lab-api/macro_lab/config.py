from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _csv_env(name: str, fallback: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return fallback
    if raw.strip().startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(part).strip() for part in parsed if str(part).strip()]
        except json.JSONDecodeError:
            pass
    return [part.strip() for part in raw.split(",") if part.strip()]


TrustedOriginList = Annotated[list[str], NoDecode]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    host: str = Field(default="127.0.0.1", validation_alias="MACRO_LAB_HOST")
    port: int = Field(default=8792, validation_alias="MACRO_LAB_PORT")
    data_dir: Path = Field(default=Path(".macro-lab-data"), validation_alias="MACRO_LAB_DATA_DIR")
    action_snapshots_dir: Path | None = Field(default=None, validation_alias="MACRO_LAB_ACTION_SNAPSHOTS_DIR")
    log_level: str = Field(default="INFO", validation_alias="MACRO_LAB_LOG_LEVEL")
    require_loopback: bool = Field(default=True, validation_alias="MACRO_LAB_REQUIRE_LOOPBACK")
    bridge_token: str | None = Field(default=None, validation_alias="MINI_HUB_BRIDGE_TOKEN")
    max_request_bytes: int = Field(default=10_000_000, validation_alias="MACRO_LAB_MAX_REQUEST_BYTES")
    trusted_origins: TrustedOriginList = Field(
        default_factory=lambda: _csv_env(
            "MACRO_LAB_TRUSTED_ORIGINS",
            [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:1420",
                "http://127.0.0.1:1420",
                "https://elc9939.github.io",
            ],
        )
    )

    @field_validator("trusted_origins", mode="before")
    @classmethod
    def parse_trusted_origins(cls, value: Any) -> list[str] | Any:
        if not isinstance(value, str):
            return value
        raw = value.strip()
        if not raw:
            return []
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(part).strip() for part in parsed if str(part).strip()]
            except json.JSONDecodeError:
                pass
        return [part.strip() for part in raw.split(",") if part.strip()]

    panic_hotkey: str = Field(default="<ctrl>+<alt>+<pause>", validation_alias="MACRO_LAB_PANIC_HOTKEY")
    clipboard_poll_interval_s: float = Field(default=1.0, validation_alias="MACRO_LAB_CLIPBOARD_POLL_INTERVAL_S")
    trigger_poll_interval_s: float = Field(default=1.0, validation_alias="MACRO_LAB_TRIGGER_POLL_INTERVAL_S")
    max_clipboard_history: int = Field(default=100, validation_alias="MACRO_LAB_MAX_CLIPBOARD_HISTORY")
    max_run_history: int = Field(default=500, validation_alias="MACRO_LAB_MAX_RUN_HISTORY")

    ollama_base_url: str = Field(default="http://127.0.0.1:11434", validation_alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="llama3.1:8b", validation_alias="MACRO_LAB_OLLAMA_MODEL")
    ollama_timeout_s: float = Field(default=120.0, validation_alias="MACRO_LAB_OLLAMA_TIMEOUT_S")
    ollama_context_tokens: int = Field(default=8192, ge=1024, le=131072, validation_alias="OLLAMA_CONTEXT_TOKENS")

    def database_path(self) -> Path:
        return self.data_dir / "macro-lab.sqlite3"

    def log_path(self) -> Path:
        return self.data_dir / "logs" / "macro-lab.jsonl"

    def resolved_action_snapshots_dir(self) -> Path:
        return self.action_snapshots_dir or self.data_dir / "action-snapshots"


@lru_cache
def get_settings() -> Settings:
    return Settings()
