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
    content: str = Field(min_length=1, max_length=200_000)


class InferenceRequest(BaseModel):
    task_type: str = Field(default="general", max_length=80)
    prompt: str | None = Field(default=None, max_length=200_000)
    messages: list[ChatMessage] = Field(default_factory=list)
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=512, ge=1, le=8192)
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
    loaded_models: list[dict[str, Any]] = Field(default_factory=list)
    recent_tokens_per_second: float | None = None
    error: str | None = None


JobPrimitive = Literal["map", "self_consistency", "chunk_summarize", "retry_loop"]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
ResearchMode = Literal["quick_search", "deep_research", "url_scrape", "site_crawl", "compare_sources", "monitor_topic"]
ResearchStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class JobCreateRequest(BaseModel):
    primitive: JobPrimitive
    request: InferenceRequest
    items: list[str] = Field(default_factory=list, max_length=500)
    template: str | None = Field(default=None, max_length=40_000)
    n: int = Field(default=3, ge=1, le=20)
    text: str | None = Field(default=None, max_length=2_000_000)
    chunk_size: int = Field(default=2200, ge=200, le=50_000)
    max_retries: int = Field(default=3, ge=1, le=10)
    concurrency: int | None = Field(default=None, ge=1, le=32)
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
    source_type: str = Field(min_length=1, max_length=80)
    source_id: str = Field(min_length=1, max_length=240)
    text: str = Field(min_length=1, max_length=2_000_000)
    title: str | None = Field(default=None, max_length=240)
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunk_size: int = Field(default=1200, ge=200, le=50_000)
    overlap: int = Field(default=120, ge=0, le=10_000)
    embedding_provider: str | None = Field(default=None, max_length=120)
    embedding_model: str | None = Field(default=None, max_length=160)


class MemoryQueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=20_000)
    limit: int = Field(default=8, ge=1, le=50)
    embedding_provider: str | None = Field(default=None, max_length=120)
    embedding_model: str | None = Field(default=None, max_length=160)


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
    objective: str = Field(min_length=1, max_length=50_000)
    agent_id: str = Field(default="default", max_length=120)
    max_steps: int = Field(default=4, ge=1, le=20)
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    tools: list[str] = Field(default_factory=list, max_length=50)
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


class CommandRequest(BaseModel):
    objective: str = Field(min_length=1, max_length=50_000)
    confirm_actions: bool = False
    max_steps: int = Field(default=4, ge=1, le=20)
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    tools: list[str] = Field(default_factory=list, max_length=50)
    context: dict[str, Any] = Field(default_factory=dict)


class ToolCallLogEntry(BaseModel):
    id: str
    created_at: str
    tool_id: str
    ok: bool
    safety: Literal["read", "write", "destructive"] = "read"
    requires_confirmation: bool = False
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    latency_ms: float
    run_id: str | None = None


class BackgroundToggleRequest(BaseModel):
    enabled: bool


class MultimodalInvokeRequest(BaseModel):
    prompt: str | None = Field(default=None, max_length=200_000)
    text: str | None = Field(default=None, max_length=200_000)
    image_base64: str | None = Field(default=None, max_length=50_000_000)
    audio_base64: str | None = Field(default=None, max_length=50_000_000)
    video_base64: str | None = Field(default=None, max_length=100_000_000)
    filename: str | None = Field(default=None, max_length=240)
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    options: dict[str, Any] = Field(default_factory=dict)
    save_to_gallery: bool = True


class GenerationAssetRecord(BaseModel):
    id: str
    created_at: str
    kind: str
    provider: str
    model: str | None = None
    prompt: str | None = None
    content_type: str | None = None
    asset_path: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActionSnapshotRecord(BaseModel):
    id: str
    created_at: str
    source: str
    action_type: str
    target: str
    content_type: str
    existed: bool = False
    snapshot_path: str | None = None
    size_bytes: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActionSnapshotRestoreRequest(BaseModel):
    confirm: bool = False


class DesignPatchRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=50_000)
    target_files: list[str] = Field(default_factory=list, max_length=20)
    patch: str | None = Field(default=None, max_length=2_000_000)
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    apply: bool = False
    confirm: bool = False


class DesignPatchApplyRequest(BaseModel):
    confirm: bool = False


class DesignPatchRecord(BaseModel):
    id: str
    created_at: str
    instruction: str
    target_files: list[str] = Field(default_factory=list)
    patch: str
    status: Literal["proposed", "applied", "reverted", "failed"]
    applied_at: str | None = None
    reverted_at: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BenchmarkRequest(BaseModel):
    kind: Literal["text", "image", "audio", "video"] = "text"
    prompt: str = Field(default="Explain what this local AI stack can do in one tight paragraph.", max_length=50_000)
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    iterations: int = Field(default=1, ge=1, le=5)
    max_tokens: int = Field(default=256, ge=1, le=4096)
    local_first: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class BenchmarkRunRecord(BaseModel):
    id: str
    created_at: str
    kind: str
    provider: str | None = None
    model: str | None = None
    prompt: str
    latency_ms: float
    tokens_per_second: float | None = None
    hardware_before: dict[str, Any] = Field(default_factory=dict)
    hardware_after: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    ok: bool = True
    error: str | None = None


class MachineProfileSnapshotRecord(BaseModel):
    id: str
    created_at: str
    source: str
    profile: dict[str, Any]
    autotune: dict[str, Any] = Field(default_factory=dict)


class ActionRecoverability(BaseModel):
    kind: Literal["none", "backup", "snapshot", "dry_run", "patch", "restore_test", "artifact"] = "none"
    reference_id: str | None = None
    route: str | None = None
    description: str = ""
    reversible: bool = False


class ActionLedgerEntry(BaseModel):
    id: str
    occurred_at: str
    system: Literal["mini-hub", "ai-os", "macro-lab", "browser"] = "ai-os"
    source: str
    action_type: str
    summary: str
    status: Literal["succeeded", "failed", "running", "queued", "cancelled", "dry_run", "blocked", "info"]
    risk: Literal["read", "write", "system", "destructive"]
    mode: str | None = None
    changed: list[str] = Field(default_factory=list)
    recoverability: ActionRecoverability = Field(default_factory=ActionRecoverability)
    raw_ref: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ResearchRunRequest(BaseModel):
    mode: ResearchMode = "quick_search"
    goal: str = Field(min_length=1, max_length=50_000)
    seed_urls: list[str] = Field(default_factory=list, max_length=50)
    depth: int = Field(default=1, ge=1, le=5)
    max_pages: int = Field(default=6, ge=1, le=50)
    per_domain_limit: int = Field(default=4, ge=1, le=20)
    time_budget_s: int = Field(default=90, ge=5, le=900)
    date_range_start: str | None = Field(default=None, max_length=40)
    date_range_end: str | None = Field(default=None, max_length=40)
    include_domains: list[str] = Field(default_factory=list, max_length=50)
    exclude_domains: list[str] = Field(default_factory=list, max_length=50)
    use_ai: bool = False
    use_cloud_ai: bool = False
    local_first: bool = True
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    screenshot: bool = False
    save_to_memory: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ResearchSourceRecord(BaseModel):
    id: str
    url: str
    canonical_url: str
    title: str = ""
    author: str | None = None
    published_at: str | None = None
    description: str = ""
    text: str = ""
    text_length: int = 0
    links: list[dict[str, str]] = Field(default_factory=list)
    tables: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    score: float = 0.0
    rank: int = 0
    cached: bool = False
    fetched_at: str


class ResearchCitation(BaseModel):
    id: str
    claim: str
    source_ids: list[str] = Field(default_factory=list)
    quote: str | None = None


class ResearchReport(BaseModel):
    title: str
    tldr: str = ""
    detailed_summary: str = ""
    key_facts: list[str] = Field(default_factory=list)
    disagreements: list[str] = Field(default_factory=list)
    source_table: list[dict[str, Any]] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    next_research_suggestions: list[str] = Field(default_factory=list)
    reliability_notes: list[str] = Field(default_factory=list)
    timeline: list[dict[str, Any]] = Field(default_factory=list)


class ResearchRunRecord(BaseModel):
    id: str
    created_at: str
    updated_at: str
    mode: ResearchMode
    goal: str
    status: ResearchStatus
    query_plan: dict[str, Any] = Field(default_factory=dict)
    sources: list[ResearchSourceRecord] = Field(default_factory=list)
    report: ResearchReport
    citations: list[ResearchCitation] = Field(default_factory=list)
    logs: list[dict[str, Any]] = Field(default_factory=list)
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    total_steps: int = Field(default=0, ge=0)
    completed_steps: int = Field(default=0, ge=0)
    current_step: str = ""
    cancel_requested: bool = False
    memory_document_id: str | None = None
    memory_chunks: int = 0
    provider: str | None = None
    model: str | None = None
    total_tokens: int = 0
    cost_usd: float = 0.0
    runtime_ms: float = 0.0
    cached_pages: int = 0
    error: str | None = None
    options: dict[str, Any] = Field(default_factory=dict)


class MachineProfileSnapshotRequest(BaseModel):
    source: str = Field(default="manual", max_length=80)


class AutotuneRequest(BaseModel):
    mode: str = Field(default="balanced", max_length=40)
    provider: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=160)
    max_tokens: int = Field(default=96, ge=16, le=512)
    persist_snapshot: bool = True
