from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"] = "user"
    content: str


class InferenceRequest(BaseModel):
    task_type: str = "general"
    prompt: str | None = None
    messages: list[ChatMessage] = Field(default_factory=list)
    provider: str | None = None
    model: str | None = None
    temperature: float = 0.2
    max_tokens: int = 512
    stream: bool = False
    local_first: bool = True
    allow_fallback: bool = True
    cost_ceiling_usd: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("messages")
    @classmethod
    def require_prompt_or_message(cls, messages: list[ChatMessage], info: Any) -> list[ChatMessage]:
        prompt = info.data.get("prompt")
        if not messages and not prompt:
            raise ValueError("Provide prompt or messages.")
        return messages

    def as_messages(self) -> list[ChatMessage]:
        if self.messages:
            return self.messages
        return [ChatMessage(role="user", content=self.prompt or "")]


class ProviderUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    tokens_per_second: float | None = None


class InferenceResult(BaseModel):
    id: str = Field(default_factory=lambda: new_id("inf"))
    provider: str
    model: str
    text: str
    usage: ProviderUsage = Field(default_factory=ProviderUsage)
    latency_ms: float
    cost_usd: float = 0.0
    fallback_chain: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class StreamChunk(BaseModel):
    provider: str
    model: str
    text: str = ""
    done: bool = False
    usage: ProviderUsage = Field(default_factory=ProviderUsage)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProviderStatus(BaseModel):
    id: str
    label: str
    available: bool
    local: bool
    paid: bool
    models: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    error: str | None = None
    latency_ms: float | None = None


class UsageLogEntry(BaseModel):
    id: str
    created_at: str
    provider: str
    model: str
    task_type: str
    ok: bool
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost_usd: float
    latency_ms: float
    fallback_chain: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CapabilityStatus(BaseModel):
    id: str
    label: str
    kind: str
    available: bool
    enabled: bool = True
    safety: Literal["passive", "active", "ambient", "destructive"] = "active"
    adapters: list[str] = Field(default_factory=list)
    description: str
    error: str | None = None


class HardwareStatus(BaseModel):
    cpu_percent: float | None = None
    memory_percent: float | None = None
    memory_used_gb: float | None = None
    memory_total_gb: float | None = None
    gpus: list[dict[str, Any]] = Field(default_factory=list)
    recent_tokens_per_second: float | None = None
    error: str | None = None


JobPrimitive = Literal["map", "self_consistency", "chunk_summarize", "retry_loop"]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class JobCreateRequest(BaseModel):
    primitive: JobPrimitive
    request: InferenceRequest
    items: list[str] = Field(default_factory=list)
    template: str | None = None
    n: int = 3
    text: str | None = None
    chunk_size: int = 2200
    max_retries: int = 3
    concurrency: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class JobSnapshot(BaseModel):
    id: str
    primitive: JobPrimitive
    status: JobStatus
    created_at: str
    updated_at: str
    total: int = 0
    completed: int = 0
    failed: int = 0
    progress: float = 0
    cancel_requested: bool = False
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryIngestRequest(BaseModel):
    source_type: str
    source_id: str
    text: str
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunk_size: int = 1200
    overlap: int = 120
    embedding_provider: str | None = None
    embedding_model: str | None = None


class MemoryQueryRequest(BaseModel):
    query: str
    limit: int = 8
    embedding_provider: str | None = None
    embedding_model: str | None = None


class MemoryHit(BaseModel):
    chunk_id: str
    document_id: str
    source_type: str
    source_id: str
    title: str | None = None
    text: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentRunRequest(BaseModel):
    objective: str
    agent_id: str = "default"
    max_steps: int = 4
    provider: str | None = None
    model: str | None = None
    tools: list[str] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)


class AgentStep(BaseModel):
    index: int
    phase: Literal["plan", "act", "check", "retry", "handoff"]
    text: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    observations: list[dict[str, Any]] = Field(default_factory=list)


class AgentRunResult(BaseModel):
    id: str = Field(default_factory=lambda: new_id("agent"))
    agent_id: str
    status: Literal["succeeded", "failed", "needs_more_steps"]
    objective: str
    steps: list[AgentStep] = Field(default_factory=list)
    output: str = ""


class BackgroundToggleRequest(BaseModel):
    enabled: bool


class MultimodalInvokeRequest(BaseModel):
    prompt: str | None = None
    text: str | None = None
    image_base64: str | None = None
    audio_base64: str | None = None
    filename: str | None = None
    provider: str | None = None
    model: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)
