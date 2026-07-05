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
    action_snapshots_dir: Path | None = Field(default=None, validation_alias="AI_OS_ACTION_SNAPSHOTS_DIR")
    desktop_export_dir: Path | None = Field(default=None, validation_alias="AI_OS_DESKTOP_EXPORT_DIR")
    require_loopback: bool = Field(default=True, validation_alias="AI_OS_REQUIRE_LOOPBACK")
    bridge_token: str | None = Field(default=None, validation_alias="MINI_HUB_BRIDGE_TOKEN")
    max_request_bytes: int = Field(default=15_000_000, validation_alias="AI_OS_MAX_REQUEST_BYTES")
    max_prompt_chars: int = Field(default=200_000, validation_alias="AI_OS_MAX_PROMPT_CHARS")
    max_memory_ingest_chars: int = Field(default=2_000_000, validation_alias="AI_OS_MAX_MEMORY_INGEST_CHARS")
    max_job_items: int = Field(default=500, validation_alias="AI_OS_MAX_JOB_ITEMS")
    max_active_jobs: int = Field(default=20, validation_alias="AI_OS_MAX_ACTIVE_JOBS")
    job_timeout_s: float = Field(default=1800.0, validation_alias="AI_OS_JOB_TIMEOUT_S")
    cleanup_max_age_days: int = Field(default=14, validation_alias="AI_OS_CLEANUP_MAX_AGE_DAYS")
    web_access_enabled: bool = Field(default=True, validation_alias="AI_OS_WEB_ACCESS_ENABLED")
    web_allow_private_hosts: bool = Field(default=False, validation_alias="AI_OS_WEB_ALLOW_PRIVATE_HOSTS")
    web_timeout_s: float = Field(default=20.0, ge=1.0, le=120.0, validation_alias="AI_OS_WEB_TIMEOUT_S")
    web_browser_timeout_s: float = Field(default=30.0, ge=1.0, le=180.0, validation_alias="AI_OS_WEB_BROWSER_TIMEOUT_S")
    web_browser_max_wait_ms: int = Field(default=5000, ge=0, le=30000, validation_alias="AI_OS_WEB_BROWSER_MAX_WAIT_MS")
    web_max_bytes: int = Field(default=2_000_000, ge=10_000, le=25_000_000, validation_alias="AI_OS_WEB_MAX_BYTES")
    web_max_text_chars: int = Field(default=60_000, ge=1_000, le=500_000, validation_alias="AI_OS_WEB_MAX_TEXT_CHARS")
    web_max_links: int = Field(default=80, ge=0, le=500, validation_alias="AI_OS_WEB_MAX_LINKS")
    web_max_redirects: int = Field(default=5, ge=0, le=20, validation_alias="AI_OS_WEB_MAX_REDIRECTS")
    web_search_max_results: int = Field(default=8, ge=1, le=25, validation_alias="AI_OS_WEB_SEARCH_MAX_RESULTS")
    web_user_agent: str = Field(
        default="MiniHubAIOS/0.1 (+https://github.com/elc9939/testing)",
        validation_alias="AI_OS_WEB_USER_AGENT",
    )
    web_browser_executable_path: Path | None = Field(default=None, validation_alias="AI_OS_WEB_BROWSER_EXECUTABLE_PATH")
    trusted_origins: list[str] = Field(
        default_factory=lambda: _csv_env(
            "AI_OS_TRUSTED_ORIGINS",
            [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:1420",
                "http://127.0.0.1:1420",
                "https://elc9939.github.io",
            ],
        )
    )

    ollama_base_url: str = Field(default="http://127.0.0.1:11434", validation_alias="OLLAMA_BASE_URL")
    ollama_chat_model: str = Field(default="llama3.1:8b", validation_alias="OLLAMA_CHAT_MODEL")
    ollama_embedding_model: str = Field(default="all-minilm", validation_alias="OLLAMA_EMBEDDING_MODEL")
    ollama_timeout_s: float = Field(default=120.0, validation_alias="OLLAMA_TIMEOUT_S")
    ollama_context_tokens: int = Field(default=8192, ge=1024, le=131072, validation_alias="OLLAMA_CONTEXT_TOKENS")

    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    openai_base_url: str = Field(default="https://api.openai.com/v1", validation_alias="OPENAI_BASE_URL")
    openai_model: str = Field(default="gpt-4o-mini", validation_alias="OPENAI_MODEL")
    openai_image_model: str = Field(default="gpt-image-1", validation_alias="OPENAI_IMAGE_MODEL")
    openai_tts_model: str = Field(default="gpt-4o-mini-tts", validation_alias="OPENAI_TTS_MODEL")
    openai_stt_model: str = Field(default="gpt-4o-mini-transcribe", validation_alias="OPENAI_STT_MODEL")

    anthropic_api_key: str | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    anthropic_base_url: str = Field(default="https://api.anthropic.com/v1", validation_alias="ANTHROPIC_BASE_URL")
    anthropic_model: str = Field(default="claude-sonnet-4-5", validation_alias="ANTHROPIC_MODEL")

    request_timeout_s: float = Field(default=90.0, validation_alias="AI_OS_REQUEST_TIMEOUT_S")
    local_provider_status_timeout_s: float = Field(default=2.0, validation_alias="AI_OS_LOCAL_PROVIDER_STATUS_TIMEOUT_S")
    max_job_concurrency: int = Field(default=4, validation_alias="AI_OS_MAX_JOB_CONCURRENCY")
    provider_priority: list[str] = Field(
        default_factory=lambda: _csv_env(
            "AI_OS_PROVIDER_PRIORITY",
            ["ollama", "lmstudio", "llamacpp", "vllm", "openai", "anthropic"],
        )
    )
    provider_costs: dict[str, dict[str, float]] = Field(
        default_factory=lambda: _json_env(
            "AI_OS_PROVIDER_COSTS_JSON",
            {
                "ollama": {"input_per_1m": 0.0, "output_per_1m": 0.0},
                "lmstudio": {"input_per_1m": 0.0, "output_per_1m": 0.0},
                "llamacpp": {"input_per_1m": 0.0, "output_per_1m": 0.0},
                "vllm": {"input_per_1m": 0.0, "output_per_1m": 0.0},
                "openai": {"input_per_1m": 0.15, "output_per_1m": 0.60},
                "anthropic": {"input_per_1m": 0.0, "output_per_1m": 0.0},
            },
        )
    )
    specialist_providers: list[dict[str, Any]] = Field(
        default_factory=lambda: _json_env("AI_OS_SPECIALIST_PROVIDERS_JSON", [])
    )

    lmstudio_base_url: str = Field(default="http://127.0.0.1:1234/v1", validation_alias="LM_STUDIO_BASE_URL")
    lmstudio_model: str | None = Field(default=None, validation_alias="LM_STUDIO_MODEL")
    lmstudio_api_key: str | None = Field(default=None, validation_alias="LM_STUDIO_API_KEY")
    llamacpp_base_url: str = Field(default="http://127.0.0.1:8080/v1", validation_alias="LLAMA_CPP_BASE_URL")
    llamacpp_model: str | None = Field(default=None, validation_alias="LLAMA_CPP_MODEL")
    llamacpp_api_key: str | None = Field(default=None, validation_alias="LLAMA_CPP_API_KEY")
    vllm_base_url: str = Field(default="http://127.0.0.1:8000/v1", validation_alias="VLLM_BASE_URL")
    vllm_model: str | None = Field(default=None, validation_alias="VLLM_MODEL")
    vllm_api_key: str | None = Field(default=None, validation_alias="VLLM_API_KEY")

    hub_api_url: str = Field(default="http://127.0.0.1:8787", validation_alias="AI_OS_HUB_API_URL")
    hub_workspace_id: str = Field(default="personal", validation_alias="AI_OS_HUB_WORKSPACE_ID")
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
    comfyui_image_workflow_path: Path | None = Field(default=None, validation_alias="COMFYUI_IMAGE_WORKFLOW_PATH")
    comfyui_video_workflow_path: Path | None = Field(default=None, validation_alias="COMFYUI_VIDEO_WORKFLOW_PATH")
    comfyui_timeout_s: float = Field(default=600.0, validation_alias="COMFYUI_TIMEOUT_S")

    local_image_command: str | None = Field(default=None, validation_alias="AI_OS_LOCAL_IMAGE_COMMAND")
    local_audio_command: str | None = Field(default=None, validation_alias="AI_OS_LOCAL_AUDIO_COMMAND")
    local_video_command: str | None = Field(default=None, validation_alias="AI_OS_LOCAL_VIDEO_COMMAND")
    local_image_extension: str = Field(default=".png", validation_alias="AI_OS_LOCAL_IMAGE_EXTENSION")
    local_audio_extension: str = Field(default=".wav", validation_alias="AI_OS_LOCAL_AUDIO_EXTENSION")
    local_video_extension: str = Field(default=".mp4", validation_alias="AI_OS_LOCAL_VIDEO_EXTENSION")
    local_media_timeout_s: float = Field(default=900.0, validation_alias="AI_OS_LOCAL_MEDIA_TIMEOUT_S")
    local_media_work_dir: Path | None = Field(default=None, validation_alias="AI_OS_LOCAL_MEDIA_WORK_DIR")
    builtin_media_enabled: bool = Field(default=True, validation_alias="AI_OS_BUILTIN_MEDIA_ENABLED")
    builtin_media_width: int = Field(default=1024, ge=256, le=2048, validation_alias="AI_OS_BUILTIN_MEDIA_WIDTH")
    builtin_media_height: int = Field(default=576, ge=256, le=2048, validation_alias="AI_OS_BUILTIN_MEDIA_HEIGHT")
    builtin_audio_duration_s: float = Field(default=8.0, ge=1.0, le=60.0, validation_alias="AI_OS_BUILTIN_AUDIO_DURATION_S")
    builtin_video_frames: int = Field(default=36, ge=4, le=180, validation_alias="AI_OS_BUILTIN_VIDEO_FRAMES")

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

    def resolved_action_snapshots_dir(self) -> Path:
        return self.action_snapshots_dir or self.data_dir / "action-snapshots"

    def resolved_desktop_export_dir(self) -> Path:
        if self.desktop_export_dir:
            return self.desktop_export_dir
        candidates: list[Path] = []
        user_profile = os.getenv("USERPROFILE")
        if user_profile:
            profile = Path(user_profile)
            candidates.extend([profile / "Desktop", profile / "OneDrive" / "Desktop"])
        one_drive = os.getenv("OneDrive") or os.getenv("OneDriveConsumer")
        if one_drive:
            candidates.append(Path(one_drive) / "Desktop")
        candidates.append(Path.home() / "Desktop")
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return candidates[0]

    def resolved_design_workspace_root(self) -> Path:
        return self.design_workspace_root.resolve()

    def resolved_design_patches_dir(self) -> Path:
        return self.design_patches_dir or self.data_dir / "design-patches"


@lru_cache
def get_settings() -> Settings:
    return Settings()
