from __future__ import annotations

from .models import CapabilityStatus, ProviderStatus


def build_capabilities(
    provider_statuses: list[ProviderStatus],
    extra_adapters: dict[str, dict[str, bool]] | None = None,
) -> list[CapabilityStatus]:
    adapters_by_capability: dict[str, list[str]] = {}
    available_by_capability: dict[str, bool] = {}
    for provider in provider_statuses:
        for capability in provider.capabilities:
            adapters_by_capability.setdefault(capability, []).append(provider.id)
            available_by_capability[capability] = available_by_capability.get(capability, False) or provider.available
    for capability, adapters in (extra_adapters or {}).items():
        for adapter_id, available in adapters.items():
            if adapter_id not in adapters_by_capability.setdefault(capability, []):
                adapters_by_capability[capability].append(adapter_id)
            available_by_capability[capability] = available_by_capability.get(capability, False) or available

    specs = [
        ("text.inference", "Unified inference", "inference", "Route text calls across local, paid, and specialist providers.", "active"),
        ("text.streaming", "Streaming text", "inference", "Emit provider chunks over SSE for live UI calls.", "active"),
        ("jobs.batch", "High-volume jobs", "jobs", "Run map, retry, self-consistency, and chunk-summarize primitives off the UI thread.", "active"),
        ("ambient.triggers", "Ambient triggers", "background", "Register schedule, folder, and app-event workers. Units are off by default.", "ambient"),
        ("agents.plan_act_check", "Agent runtime", "agents", "Run generic plan-act-check-retry loops with registered tools.", "active"),
        ("memory.semantic_search", "Semantic memory", "memory", "Ingest arbitrary text, embed locally when possible, and retrieve semantically.", "active"),
        ("web.search", "Web search", "web", "Search the public internet through a configured read-only search adapter.", "passive"),
        ("web.scrape", "Web scraping", "web", "Fetch pages and extract readable text, metadata, headings, and links.", "passive"),
        ("browser.extract", "Browser extraction", "web", "Use a headless browser for rendered pages, with HTTP extraction fallback.", "passive"),
        ("research.web_intelligence", "Research engine", "web", "Plan, search, crawl, extract, cite, archive, and reopen source-backed research runs.", "passive"),
        ("multimodal.image", "Image generation", "multimodal", "Invoke configured local or paid image generation adapters.", "active"),
        ("multimodal.audio", "Audio generation", "multimodal", "Generate local sound, music, or arbitrary audio through configured command adapters.", "active"),
        ("multimodal.audio_tts", "Text to speech", "multimodal", "Generate speech through configured local or paid adapters.", "active"),
        ("multimodal.audio_stt", "Speech to text", "multimodal", "Transcribe audio through configured local or paid adapters.", "active"),
        ("multimodal.video", "Video generation", "multimodal", "Generate local video through configured command or ComfyUI workflow adapters.", "active"),
        ("multimodal.vision", "Vision", "multimodal", "Send images to vision-capable local or paid models.", "active"),
    ]
    result: list[CapabilityStatus] = []
    for capability_id, label, kind, description, safety in specs:
        adapter_ids = adapters_by_capability.get(capability_id, [])
        available = available_by_capability.get(capability_id, False)
        if capability_id.startswith("jobs.") or capability_id.startswith("ambient.") or capability_id.startswith("agents."):
            available = True
        if capability_id == "memory.semantic_search":
            available = True
        result.append(
            CapabilityStatus(
                id=capability_id,
                label=label,
                kind=kind,
                available=available,
                enabled=not capability_id.startswith("ambient."),
                safety=safety,  # type: ignore[arg-type]
                adapters=adapter_ids,
                description=description,
            )
        )
    return result
