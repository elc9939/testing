from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _json_env(name: str, fallback: Any) -> Any:
    raw = os.getenv(name)
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _csv_env(name: str, fallback: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return fallback
    return [part.strip() for part in raw.split(",") if part.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    host: str = Field(default="127.0.0.1", validation_alias="AI_OS_HOST")
    port: int = Field(default=8791, validation_alias="AI_OS_PORT")
    data_dir: Path = Field(default=Path(".ai-os-data"), validation_alias="AI_OS_DATA_DIR")
    backup_dir: Path | None = Field(default=None, validation_alias="AI_OS_BACKUP_DIR")
    backup_enabled: bool = Field(default=True, validation_alias="AI_OS_BACKUP_ENABLED")
    backup_interval_minutes: int = Field(default=1440, validation_alias="AI_OS_BACKUP_INTERVAL_MINUTES")
    backup_retention_count: int = Field(default=14, validation_alias="AI_OS_BACKUP_RETENTION_COUNT")
    log_dir: Path | None = Field(default=None, validation_alias="AI_OS_LOG_DIR")
    log_level: str = Field(default="INFO", validation_alias="AI_OS_LOG_LEVEL")
    log_retention_days: int = Field(default=14, validation_alias="AI_OS_LOG_RETENTION_DAYS")
    log_max_bytes: int = Field(default=5_000_000, validation_alias="AI_OS_LOG_MAX_BYTES")
    temp_dir: Path | None = Field(default=None, validation_alias="AI_OS_TEMP_DIR")
    assets_dir: Path | None = Field(default=None, validation_alias="AI_OS_ASSETS_DIR")
    require_loopback: bool = Field(default=True, validation_alias="AI_OS_REQUIRE_LOOPBACK")
    max_request_bytes: int = Field(default=15_000_000, validation_alias="AI_OS_MAX_REQUEST_BYTES")
    max_prompt_chars: int = Field(default=200_000, validation_alias="AI_OS_MAX_PROMPT_CHARS")
    max_memory_ingest_chars: int = Field(default=2_000_000, validation_alias="AI_OS_MAX_MEMORY_INGEST_CHARS")
    max_job_items: int = Field(default=500, validation_alias="AI_OS_MAX_JOB_ITEMS")
    max_active_jobs: int = Field(default=20, validation_alias="AI_OS_MAX_ACTIVE_JOBS")
    job_timeout_s: float = Field(default=1800.0, validation_alias="AI_OS_JOB_TIMEOUT_S")
    cleanup_max_age_days: int = Field(default=14, validation_alias="AI_OS_CLEANUP_MAX_AGE_DAYS")
    trusted_origins: list[str] = Field(
        default_factory=lambda: _csv_env(
            "AI_OS_TRUSTED_ORIGINS",
            ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:1420", "http://127.0.0.1:1420"],
        )
    )

    ollama_base_url: str = Field(default="http://127.0.0.1:11434", validation_alias="OLLAMA_BASE_URL")
    ollama_chat_model: str = Field(default="llama3.2", validation_alias="OLLAMA_CHAT_MODEL")
    ollama_embedding_model: str = Field(default="all-minilm", validation_alias="OLLAMA_EMBEDDING_MODEL")
    ollama_timeout_s: float = Field(default=120.0, validation_alias="OLLAMA_TIMEOUT_S")

    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    openai_base_url: str = Field(default="https://api.openai.com/v1", validation_alias="OPENAI_BASE_URL")
    openai_model: str = Field(default="gpt-4.1-mini", validation_alias="OPENAI_MODEL")
    openai_image_model: str = Field(default="gpt-image-1", validation_alias="OPENAI_IMAGE_MODEL")
    openai_tts_model: str = Field(default="gpt-4o-mini-tts", validation_alias="OPENAI_TTS_MODEL")
    openai_stt_model: str = Field(default="gpt-4o-mini-transcribe", validation_alias="OPENAI_STT_MODEL")

    anthropic_api_key: str | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    anthropic_base_url: str = Field(default="https://api.anthropic.com/v1", validation_alias="ANTHROPIC_BASE_URL")
    anthropic_model: str = Field(default="claude-sonnet-4-5", validation_alias="ANTHROPIC_MODEL")

    request_timeout_s: float = Field(default=90.0, validation_alias="AI_OS_REQUEST_TIMEOUT_S")
    max_job_concurrency: int = Field(default=4, validation_alias="AI_OS_MAX_JOB_CONCURRENCY")
    provider_priority: list[str] = Field(
        default_factory=lambda: _csv_env("AI_OS_PROVIDER_PRIORITY", ["ollama", "openai", "anthropic"])
    )
    provider_costs: dict[str, dict[str, float]] = Field(
        default_factory=lambda: _json_env(
            "AI_OS_PROVIDER_COSTS_JSON",
            {
                "ollama": {"input_per_1m": 0.0, "output_per_1m": 0.0},
                "openai": {"input_per_1m": 0.0, "output_per_1m": 0.0},
                "anthropic": {"input_per_1m": 0.0, "output_per_1m": 0.0},
            },
        )
    )
    specialist_providers: list[dict[str, Any]] = Field(
        default_factory=lambda: _json_env("AI_OS_SPECIALIST_PROVIDERS_JSON", [])
    )

    hub_api_url: str = Field(default="http://127.0.0.1:8787", validation_alias="AI_OS_HUB_API_URL")
    hub_workspace_id: str = Field(default="personal", validation_alias="AI_OS_HUB_WORKSPACE_ID")
    mini_hub_sync_key: str | None = Field(default=None, validation_alias="MINI_HUB_SYNC_KEY")
    macro_lab_api_url: str = Field(default="http://127.0.0.1:8792", validation_alias="AI_OS_MACRO_LAB_API_URL")

    design_workspace_root: Path = Field(default=Path("../.."), validation_alias="AI_OS_DESIGN_WORKSPACE_ROOT")
    design_patches_dir: Path | None = Field(default=None, validation_alias="AI_OS_DESIGN_PATCHES_DIR")
    design_apply_enabled: bool = Field(default=True, validation_alias="AI_OS_DESIGN_APPLY_ENABLED")
    design_allowed_extensions: list[str] = Field(
        default_factory=lambda: _csv_env(
            "AI_OS_DESIGN_ALLOWED_EXTENSIONS",
            [".svelte", ".ts", ".js", ".css", ".md", ".py", ".json", ".html", ".toml", ".yml", ".yaml"],
        )
    )

    comfyui_base_url: str | None = Field(default=None, validation_alias="COMFYUI_BASE_URL")
    comfyui_workflow_path: Path | None = Field(default=None, validation_alias="COMFYUI_WORKFLOW_PATH")
    comfyui_timeout_s: float = Field(default=600.0, validation_alias="COMFYUI_TIMEOUT_S")

    piper_executable: str | None = Field(default=None, validation_alias="PIPER_EXECUTABLE")
    piper_voice_path: Path | None = Field(default=None, validation_alias="PIPER_VOICE_PATH")
    piper_timeout_s: float = Field(default=180.0, validation_alias="PIPER_TIMEOUT_S")

    whisper_executable: str | None = Field(default=None, validation_alias="WHISPER_EXECUTABLE")
    whisper_model: str = Field(default="base", validation_alias="WHISPER_MODEL")
    whisper_timeout_s: float = Field(default=600.0, validation_alias="WHISPER_TIMEOUT_S")

    def database_path(self) -> Path:
        return self.data_dir / "ai-os.sqlite3"

    def resolved_backup_dir(self) -> Path:
        return self.backup_dir or self.data_dir / "backups"

    def resolved_log_dir(self) -> Path:
        return self.log_dir or self.data_dir / "logs"

    def resolved_temp_dir(self) -> Path:
        return self.temp_dir or self.data_dir / "tmp"

    def resolved_assets_dir(self) -> Path:
        return self.assets_dir or self.data_dir / "assets"

    def resolved_design_workspace_root(self) -> Path:
        return self.design_workspace_root.resolve()

    def resolved_design_patches_dir(self) -> Path:
        return self.design_patches_dir or self.data_dir / "design-patches"


@lru_cache
def get_settings() -> Settings:
    return Settings()
