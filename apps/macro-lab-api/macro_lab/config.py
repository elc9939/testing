from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _csv_env(name: str, fallback: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return fallback
    return [part.strip() for part in raw.split(",") if part.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    host: str = Field(default="127.0.0.1", validation_alias="MACRO_LAB_HOST")
    port: int = Field(default=8792, validation_alias="MACRO_LAB_PORT")
    data_dir: Path = Field(default=Path(".macro-lab-data"), validation_alias="MACRO_LAB_DATA_DIR")
    log_level: str = Field(default="INFO", validation_alias="MACRO_LAB_LOG_LEVEL")
    require_loopback: bool = Field(default=True, validation_alias="MACRO_LAB_REQUIRE_LOOPBACK")
    max_request_bytes: int = Field(default=10_000_000, validation_alias="MACRO_LAB_MAX_REQUEST_BYTES")
    trusted_origins: list[str] = Field(
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

    panic_hotkey: str = Field(default="<ctrl>+<alt>+<pause>", validation_alias="MACRO_LAB_PANIC_HOTKEY")
    clipboard_poll_interval_s: float = Field(default=1.0, validation_alias="MACRO_LAB_CLIPBOARD_POLL_INTERVAL_S")
    trigger_poll_interval_s: float = Field(default=1.0, validation_alias="MACRO_LAB_TRIGGER_POLL_INTERVAL_S")
    max_clipboard_history: int = Field(default=100, validation_alias="MACRO_LAB_MAX_CLIPBOARD_HISTORY")
    max_run_history: int = Field(default=500, validation_alias="MACRO_LAB_MAX_RUN_HISTORY")

    ollama_base_url: str = Field(default="http://127.0.0.1:11434", validation_alias="OLLAMA_BASE_URL")
    ollama_model: str = Field(default="llama3.2", validation_alias="MACRO_LAB_OLLAMA_MODEL")
    ollama_timeout_s: float = Field(default=120.0, validation_alias="MACRO_LAB_OLLAMA_TIMEOUT_S")

    def database_path(self) -> Path:
        return self.data_dir / "macro-lab.sqlite3"

    def log_path(self) -> Path:
        return self.data_dir / "logs" / "macro-lab.jsonl"


@lru_cache
def get_settings() -> Settings:
    return Settings()
