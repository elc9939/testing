# Personal AI OS Setup

Date: 2026-06-16

This setup runs the Svelte hub, the existing Hono personal sync API, the new FastAPI AI OS
capability API, and Ollama.

## Services

- Hub UI: `http://127.0.0.1:5173`
- Hono sync/productivity API: `http://127.0.0.1:8787`
- FastAPI AI OS API: `http://127.0.0.1:8791`
- Ollama: `http://127.0.0.1:11434`

## Environment

Copy `.env.example` to `.env` and set only the providers you want enabled.

Required for local-first operation:

```bash
PUBLIC_AI_OS_API_URL=http://127.0.0.1:8791
AI_OS_HOST=127.0.0.1
AI_OS_PORT=8791
AI_OS_DATA_DIR=.ai-os-data
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=llama3.2
OLLAMA_EMBEDDING_MODEL=all-minilm
```

Optional paid providers:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_STT_MODEL=gpt-4o-mini-transcribe

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5
```

Optional cost estimates:

```bash
AI_OS_PROVIDER_COSTS_JSON={"ollama":{"input_per_1m":0,"output_per_1m":0},"openai":{"input_per_1m":0,"output_per_1m":0},"anthropic":{"input_per_1m":0,"output_per_1m":0}}
```

Those values are your configurable estimates, not authoritative billing records.

Optional specialist provider:

```bash
AI_OS_SPECIALIST_PROVIDERS_JSON=[
  {
    "id": "replicate-image",
    "label": "Replicate Image",
    "endpoint": "https://example.invalid/v1/predictions",
    "api_key": "replace-me",
    "model": "default",
    "capabilities": ["multimodal.image"],
    "prompt_field": "prompt",
    "model_field": "model",
    "text_path": "text"
  }
]
```

Keep the JSON on one line in `.env`.

## Ollama Models

Install and start Ollama, then pull models:

```bash
ollama pull llama3.2
ollama pull all-minilm
```

Optional vision/image models depend on your hardware and the current Ollama model catalog:

```bash
ollama pull llava
```

Ollama's API defaults to `http://localhost:11434/api`, and its current docs cover chat,
model listing, embeddings through `/api/embed`, and vision/image-capable generation:
https://docs.ollama.com/api/introduction and https://github.com/ollama/ollama/blob/main/docs/api.md

## Python API

Create a virtual environment and install the service:

```bash
cd apps/ai-os-api
python -m venv .venv
.venv\Scripts\python -m pip install -U pip
.venv\Scripts\python -m pip install -e .[test]
.venv\Scripts\python -m ai_os
```

If you use PowerShell and the execution policy blocks activation, call the venv Python path
directly as shown above.

Run backend tests:

```bash
cd apps/ai-os-api
.venv\Scripts\python -m pytest
```

## Hub

Run the hub and existing API as before:

```bash
pnpm install
pnpm dev:api
pnpm dev:hub
```

Open `http://127.0.0.1:5173/ai-os`.

## GPU And Hardware Notes

- The dashboard reads CPU/RAM via `psutil`.
- NVIDIA GPU telemetry uses `nvidia-smi` when present.
- VRAM is not required for the infrastructure itself. It matters only for the models you pull.
- If `nvidia-smi` is absent or Ollama is offline, the dashboard shows degraded status instead of failing.
- Tokens/sec is derived from recent usage logs when providers report or stream enough timing data.

## API Surfaces

Core status and visibility:

```text
GET  /api/ai/health
GET  /api/ai/status
GET  /api/ai/providers
GET  /api/ai/capabilities
GET  /api/ai/usage
```

Inference:

```text
POST /api/ai/infer
POST /api/ai/infer/stream
```

Jobs:

```text
POST /api/ai/jobs
GET  /api/ai/jobs
GET  /api/ai/jobs/{job_id}
GET  /api/ai/jobs/{job_id}/results
POST /api/ai/jobs/{job_id}/cancel
```

Background, agents, memory, multimodal:

```text
GET  /api/ai/background/units
POST /api/ai/background/units/{unit_id}/toggle
POST /api/ai/background/units/{unit_id}/run
POST /api/ai/agents/run
POST /api/ai/memory/ingest
POST /api/ai/memory/query
POST /api/ai/multimodal/{kind}/invoke
```

## Adding A Provider

1. Create a class implementing `ProviderAdapter` in `apps/ai-os-api/ai_os/providers`.
2. Implement `status()`, `complete()`, and optionally `stream()` and `embed()`.
3. Register it in `build_provider_registry()` in `providers/registry.py`.
4. Add any secrets or model defaults to `config.py` and `.env.example`.

## Adding A Job Primitive

1. Add a handler method to `JobPrimitives`.
2. Register it in `JobPrimitives.register()`.
3. The dashboard can invoke it by sending a new `primitive` value to `POST /api/ai/jobs`.

## Adding An Ambient Unit

1. Register a `BackgroundUnit` in `build_background_registry()`.
2. Keep `enabled=false` for anything continuous or destructive.
3. The unit can trigger a job, call memory, run inference, or call an app-specific tool.

## Adding An Agent Tool

1. Add a `ToolSpec` and async handler in `build_tool_registry()`.
2. Keep destructive app actions out until they have confirmation and permission checks.
3. Pass the tool ID in the agent request's `tools` list.

## Adding An Ingestion Source

1. Convert the source to `{source_type, source_id, text, title, metadata}`.
2. Call `POST /api/ai/memory/ingest`.
3. The embedding provider is optional; Ollama is tried first and deterministic local hash
   embeddings are used only as graceful degradation.

## Current Limits

- The queue is in-process for v1. The interface can later be backed by Redis, SQLite workers,
  or a Tauri desktop worker without changing the dashboard API.
- Local image/TTS/STT adapters are interfaces plus provider hooks. Concrete local engines such
  as Stable Diffusion, Whisper, or Piper can be added behind the same multimodal registry.
- The FastAPI service assumes private localhost/Tauri use. Add an auth middleware before exposing
  it to a public network.

## Source Notes

- OpenAI Responses, Chat Completions, image generation, audio transcription, and speech endpoints
  are documented at https://developers.openai.com/api/reference/overview/
- OpenAI streaming responses use SSE in the current official docs:
  https://developers.openai.com/api/reference/python/
- Anthropic Messages streaming uses SSE:
  https://platform.claude.com/docs/en/build-with-claude/streaming
- FastAPI `StreamingResponse` supports streaming generator output:
  https://fastapi.tiangolo.com/advanced/custom-response/
