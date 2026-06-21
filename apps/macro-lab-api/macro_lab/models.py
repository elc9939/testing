from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


SafetyLevel = Literal["safe", "input", "system", "destructive"]
RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled", "dry_run"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


class ActionDefinition(BaseModel):
    id: str = Field(default_factory=lambda: new_id("action"))
    type: str = Field(min_length=1, max_length=120)
    label: str = Field(default="", max_length=160)
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


class TriggerDefinition(BaseModel):
    id: str = Field(default_factory=lambda: new_id("trigger"))
    type: str = Field(min_length=1, max_length=120)
    label: str = Field(default="", max_length=160)
    enabled: bool = False
    config: dict[str, Any] = Field(default_factory=dict)


class MacroDefinition(BaseModel):
    id: str = Field(default_factory=lambda: new_id("macro"))
    name: str = Field(min_length=1, max_length=160)
    group: str = Field(default="General", max_length=120)
    enabled: bool = True
    armed: bool = False
    dry_run_default: bool = True
    variables: dict[str, Any] = Field(default_factory=dict)
    actions: list[ActionDefinition] = Field(default_factory=list)
    triggers: list[TriggerDefinition] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class MacroPatch(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    group: str | None = Field(default=None, max_length=120)
    enabled: bool | None = None
    armed: bool | None = None
    dry_run_default: bool | None = None
    variables: dict[str, Any] | None = None
    actions: list[ActionDefinition] | None = None
    triggers: list[TriggerDefinition] | None = None


class RunRequest(BaseModel):
    dry_run: bool | None = None
    confirm: bool = False
    variables: dict[str, Any] = Field(default_factory=dict)
    trigger_id: str | None = None
    trigger_context: dict[str, Any] = Field(default_factory=dict)


class RestoreRunRequest(BaseModel):
    confirm: bool = False


class StepResult(BaseModel):
    action_id: str
    action_type: str
    label: str = ""
    safety: SafetyLevel
    status: Literal["skipped", "succeeded", "failed", "dry_run"]
    message: str = ""
    detail: dict[str, Any] = Field(default_factory=dict)
    started_at: str = Field(default_factory=now_iso)
    finished_at: str = Field(default_factory=now_iso)


class RunRecord(BaseModel):
    id: str = Field(default_factory=lambda: new_id("run"))
    macro_id: str
    macro_name: str
    trigger_id: str | None = None
    status: RunStatus = "running"
    dry_run: bool = True
    started_at: str = Field(default_factory=now_iso)
    finished_at: str | None = None
    error: str | None = None
    steps: list[StepResult] = Field(default_factory=list)


class ActionSpec(BaseModel):
    type: str
    label: str
    safety: SafetyLevel
    description: str
    config_example: dict[str, Any] = Field(default_factory=dict)


class CapabilityStatus(BaseModel):
    id: str
    available: bool
    detail: str = ""


class RecordingState(BaseModel):
    active: bool = False
    started_at: str | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


class WindowLayoutRecord(BaseModel):
    name: str
    windows: list[dict[str, Any]]
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
