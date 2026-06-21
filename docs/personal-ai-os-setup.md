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
AI_OS_REQUIRE_LOOPBACK=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=llama3.1:8b
OLLAMA_EMBEDDING_MODEL=all-minilm
OLLAMA_CONTEXT_TOKENS=8192
AI_OS_LOCAL_PROVIDER_STATUS_TIMEOUT_S=2
```

Optional local OpenAI-compatible providers:

```bash
LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
LM_STUDIO_MODEL=
LM_STUDIO_API_KEY=

LLAMA_CPP_BASE_URL=http://127.0.0.1:8080/v1
LLAMA_CPP_MODEL=
LLAMA_CPP_API_KEY=

VLLM_BASE_URL=http://127.0.0.1:8000/v1
VLLM_MODEL=
VLLM_API_KEY=
```

These are local-first adapters. LM Studio's default local API port is commonly `1234`, vLLM
defaults to `8000`, and llama.cpp server deployments commonly use an OpenAI-compatible `/v1`
base URL. Leave them unset if you only want Ollama; the dashboard will show them as offline
until those servers are running.

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
AI_OS_PROVIDER_COSTS_JSON={"ollama":{"input_per_1m":0,"output_per_1m":0},"lmstudio":{"input_per_1m":0,"output_per_1m":0},"llamacpp":{"input_per_1m":0,"output_per_1m":0},"vllm":{"input_per_1m":0,"output_per_1m":0},"openai":{"input_per_1m":0,"output_per_1m":0},"anthropic":{"input_per_1m":0,"output_per_1m":0}}
```

Those values are your configurable estimates, not authoritative billing records.

Optional app-control endpoints:

```bash
AI_OS_HUB_API_URL=http://127.0.0.1:8787
AI_OS_HUB_WORKSPACE_ID=personal
AI_OS_MACRO_LAB_API_URL=http://127.0.0.1:8792
```

The command bar uses those URLs for real tool calls. Study Desk and Career Desk write tools
mutate the local Hub API in personal mode. Macro execution talks to the local Macro Lab daemon
and still requires confirmation from the command request.

Optional design patch sandbox:

```bash
AI_OS_DESIGN_WORKSPACE_ROOT=../..
AI_OS_DESIGN_PATCHES_DIR=.ai-os-data/design-patches
AI_OS_DESIGN_APPLY_ENABLED=true
AI_OS_DESIGN_ALLOWED_EXTENSIONS=.svelte,.ts,.js,.css,.md,.py,.json,.html,.toml,.yml,.yaml
```

Design patch apply/revert requires `confirm=true` on the API request and uses `git apply`
inside `AI_OS_DESIGN_WORKSPACE_ROOT`. The model proposes a diff; the service stores it and
applies it through git so the change can be inspected and reversed.

Optional local multimodal engines:

```bash
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW_PATH=C:\path\to\workflow.json
COMFYUI_IMAGE_WORKFLOW_PATH=C:\path\to\image-workflow.json
COMFYUI_VIDEO_WORKFLOW_PATH=C:\path\to\video-workflow.json
COMFYUI_TIMEOUT_S=600

AI_OS_LOCAL_IMAGE_COMMAND=
AI_OS_LOCAL_AUDIO_COMMAND=
AI_OS_LOCAL_VIDEO_COMMAND=
AI_OS_LOCAL_IMAGE_EXTENSION=.png
AI_OS_LOCAL_AUDIO_EXTENSION=.wav
AI_OS_LOCAL_VIDEO_EXTENSION=.mp4
AI_OS_LOCAL_MEDIA_TIMEOUT_S=900
AI_OS_LOCAL_MEDIA_WORK_DIR=
AI_OS_BUILTIN_MEDIA_ENABLED=true
AI_OS_BUILTIN_MEDIA_WIDTH=1024
AI_OS_BUILTIN_MEDIA_HEIGHT=576
AI_OS_BUILTIN_AUDIO_DURATION_S=8
AI_OS_BUILTIN_VIDEO_FRAMES=36
AI_OS_DESKTOP_EXPORT_DIR=

PIPER_EXECUTABLE=C:\path\to\piper.exe
PIPER_VOICE_PATH=C:\path\to\voice.onnx
PIPER_TIMEOUT_S=180

WHISPER_EXECUTABLE=whisper
WHISPER_MODEL=base
WHISPER_TIMEOUT_S=600
```

ComfyUI expects a workflow JSON. If the workflow contains `{{prompt}}` strings they are
replaced; common `CLIPTextEncode.inputs.text` nodes are also set from the prompt. The legacy
`COMFYUI_WORKFLOW_PATH` remains the default image workflow; use `COMFYUI_VIDEO_WORKFLOW_PATH`
for video workflows that save `.mp4`, `.webm`, `.mov`, or `.gif` outputs.

`AI_OS_BUILTIN_MEDIA_ENABLED=true` enables the included local starter media engine. It asks
Ollama for a compact creative plan, then renders a PNG image, WAV audio clip, or animated GIF
locally with Pillow and Python's audio primitives. This is not photorealistic Stable Diffusion
or a music foundation model; it is a zero-extra-server local generation path that proves the
pipeline, gallery, previews, benchmarks, and local-only artifact storage end to end.

The assistant command path can also save generated images directly to your Desktop through
the confirmation-gated `media.generate_image_file` tool. Leave `AI_OS_DESKTOP_EXPORT_DIR`
empty to use the current Windows user's Desktop, or set it to a different folder for testing.
Requests such as "create an AI image of a cat and add it to my desktop" are routed to this
tool instead of the text-only inference tool.

The `AI_OS_LOCAL_*_COMMAND` settings are generic local generators for heavier tools such as
ComfyUI CLI wrappers, Stable Diffusion scripts, MusicGen/AudioCraft wrappers, AnimateDiff
pipelines, or any other local program. They are intentionally env-configured, not UI-configured.
The service runs the command with:

```text
AI_OS_MEDIA_KIND=image|audio|video
AI_OS_MEDIA_PROMPT=<prompt>
AI_OS_MEDIA_TEXT=<text>
AI_OS_MEDIA_PROMPT_FILE=<temp prompt.txt>
AI_OS_MEDIA_TEXT_FILE=<temp text.txt>
AI_OS_MEDIA_OUTPUT=<temp output file path>
AI_OS_MEDIA_TEMP_DIR=<temp directory>
```

Your command should write the generated file to `AI_OS_MEDIA_OUTPUT`, or print JSON containing
`output_path`, `image_base64`, `audio_base64`, or `video_base64`. Outputs are persisted into
the AI OS generation gallery. Piper and Whisper are invoked as local CLI tools when
configured and return base64 audio or transcript text through the same multimodal endpoint
as API providers. On Windows, the service also exposes `windows-tts` and `windows-stt`
through `System.Speech`, so basic local speech works even before Piper/Whisper are installed.

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

Personal-scale infrastructure settings:

```bash
AI_OS_BACKUP_ENABLED=true
AI_OS_BACKUP_DIR=.ai-os-data/backups
AI_OS_BACKUP_INTERVAL_MINUTES=1440
AI_OS_BACKUP_RETENTION_COUNT=14
AI_OS_LOG_DIR=.ai-os-data/logs
AI_OS_LOG_LEVEL=INFO
AI_OS_TEMP_DIR=.ai-os-data/tmp
AI_OS_ASSETS_DIR=.ai-os-data/assets
AI_OS_ACTION_SNAPSHOTS_DIR=.ai-os-data/action-snapshots
AI_OS_MAX_REQUEST_BYTES=52428800
AI_OS_MAX_PROMPT_CHARS=200000
AI_OS_MAX_MEMORY_INGEST_CHARS=2000000
AI_OS_MAX_JOB_ITEMS=500
AI_OS_MAX_ACTIVE_JOBS=20
AI_OS_JOB_TIMEOUT_S=600
AI_OS_CLEANUP_MAX_AGE_DAYS=14
AI_OS_WEB_ACCESS_ENABLED=true
AI_OS_WEB_ALLOW_PRIVATE_HOSTS=false
AI_OS_WEB_TIMEOUT_S=20
AI_OS_WEB_BROWSER_TIMEOUT_S=30
AI_OS_WEB_BROWSER_MAX_WAIT_MS=5000
AI_OS_WEB_MAX_BYTES=2000000
AI_OS_WEB_MAX_TEXT_CHARS=60000
AI_OS_WEB_MAX_LINKS=80
AI_OS_WEB_MAX_REDIRECTS=5
AI_OS_WEB_SEARCH_MAX_RESULTS=8
AI_OS_WEB_USER_AGENT=MiniHubAIOS/0.1 (+https://github.com/elc9939/testing)
AI_OS_WEB_BROWSER_EXECUTABLE_PATH=
```

Routine backups intentionally exclude giant model caches. Put generated files you care about
under `AI_OS_ASSETS_DIR` if you want them included in AI OS backups. Pre-action recovery
snapshots for AI OS file-writing tools live under `AI_OS_ACTION_SNAPSHOTS_DIR` and are
included in backup manifests.

The web settings power the assistant tools `web.search`, `web.scrape`, and
`browser.extract`. The default `AI_OS_WEB_ALLOW_PRIVATE_HOSTS=false` blocks localhost,
private LAN ranges, link-local addresses, and `.local` hosts. Leave that default on for
normal internet browsing; set it to `true` only when you intentionally want the assistant to
read local/private pages. `browser.extract` uses Playwright with Chrome/Edge/Chromium when
available and falls back to the HTTP scraper with `browser_available=false` when a headless
browser is unavailable.

## Ollama Models

Install and start Ollama, then pull models:

```bash
ollama pull llama3.1:8b
ollama pull all-minilm
```

Optional vision/image models depend on your hardware and the current Ollama model catalog:

```bash
ollama pull llava
```

`OLLAMA_CONTEXT_TOKENS=8192` doubles the usual 4k local context while staying conservative
for a desktop GPU. Larger values are allowed, but they use more memory and may push models
partly back to CPU.

Ollama's API defaults to `http://localhost:11434/api`, and its current docs cover chat,
model listing, embeddings through `/api/embed`, context length, and vision/image-capable generation:
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

Maintenance commands:

```bash
cd apps/ai-os-api
.venv\Scripts\python -m ai_os.maintenance_cli backup --reason manual
.venv\Scripts\python -m ai_os.maintenance_cli list
.venv\Scripts\python -m ai_os.maintenance_cli verify <backup-id>
.venv\Scripts\python -m ai_os.maintenance_cli integrity
.venv\Scripts\python -m ai_os.maintenance_cli cleanup
```

Restore is deliberately explicit and writes to the target you provide:

```bash
cd apps/ai-os-api
.venv\Scripts\python -m ai_os.maintenance_cli restore <backup-id> --target C:\path\to\restored-ai-os.sqlite3 --confirm RESTORE
```

To replace the live database, first stop the service, create a fresh backup of the current
database, restore the chosen backup to a temporary target, verify it, then manually move it
into `AI_OS_DATA_DIR`. Do not overwrite the live database while the service is running.

PowerShell wrappers are available from the repo root:

```bash
pnpm ai-os:start
pnpm ai-os:status
pnpm ai-os:backup
pnpm ai-os:stop
```

## Hub

Run the hub and existing API as before:

```bash
pnpm install
pnpm dev:api
pnpm dev:hub
```

Open `http://127.0.0.1:5173/ai-os`.

GitHub Pages publishes the same Svelte hub at:

```text
https://elc9939.github.io/testing/
https://elc9939.github.io/testing/ai-os
```

The previous static arcade is retained at:

```text
https://elc9939.github.io/testing/legacy/
```

When using the Pages site as the UI, keep local services running on `127.0.0.1` if you want
AI OS, Macro Lab, or personal sync actions to work from that browser tab.

The AI OS dashboard includes a Foundation Health panel for database integrity, latest backup,
queue depth, recent failures, manual backup, backup verification, restore-test, and cleanup.

## GPU And Hardware Notes

- The dashboard reads CPU/RAM via `psutil`.
- NVIDIA GPU telemetry uses `nvidia-smi` when present.
- Windows/AMD GPU telemetry uses Windows GPU performance counters. For Radeon cards, total
  VRAM is read from the display driver registry value when available because
  `Win32_VideoController.AdapterRAM` can underreport modern cards.
- Ollama model residency is read from `/api/ps`, including model name, context, VRAM load,
  and inferred CPU/GPU residency.
- GPU temperature is shown when a sensor backend exposes it. Stock Windows/AMD counters do
  not expose RX 6600 temperature, so the dashboard may correctly show `sensor unavailable`.
- VRAM is not required for the infrastructure itself. It matters only for the models you pull.
- If `nvidia-smi` is absent or Ollama is offline, the dashboard shows degraded status instead of failing.
- Tokens/sec is derived from recent usage logs when providers report or stream enough timing data.

## API Surfaces

Core status and visibility:

```text
GET  /api/ai/health
GET  /api/ai/health/full
GET  /api/ai/status
GET  /api/ai/providers
GET  /api/ai/capabilities
GET  /api/ai/usage
GET  /api/ai/metrics
GET  /api/ai/integrity
GET  /api/ai/backups
POST /api/ai/backups
POST /api/ai/backups/{backup_id}/verify
POST /api/ai/backups/{backup_id}/restore-test
POST /api/ai/maintenance/cleanup
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
GET  /api/ai/tools
GET  /api/ai/tool-calls
POST /api/ai/command
POST /api/ai/agents/run
POST /api/ai/memory/ingest
POST /api/ai/memory/query
POST /api/ai/multimodal/{kind}/invoke
GET  /api/ai/generation-assets
GET  /api/ai/design/patches
POST /api/ai/design/patches
POST /api/ai/design/patches/{patch_id}/apply
POST /api/ai/design/patches/{patch_id}/revert
GET  /api/ai/benchmarks
POST /api/ai/benchmarks
```

`{kind}` currently supports `image`, `audio`, `video`, `audio_tts`, `audio_stt`, and
`vision`. The benchmark endpoint supports `text`, `image`, `audio`, and `video`.

Web/browser access is exposed through the tool registry rather than separate public routes:

```text
web.search       {"query":"...", "limit":6}
web.scrape       {"url":"https://...", "include_html":false}
browser.extract  {"url":"https://...", "wait_until":"domcontentloaded", "screenshot":false}
```

Use `POST /api/ai/command` for natural-language requests such as "search the web for local
LLM benchmarks" or "scrape https://example.com". Use `POST /api/ai/agents/run` when you want
to constrain an agent to these exact tool IDs.

## Adding A Provider

1. For a local OpenAI-compatible server, add a new `OpenAICompatibleLocalProvider`
   registration in `providers/registry.py`.
2. For a custom protocol, create a class implementing `ProviderAdapter` in
   `apps/ai-os-api/ai_os/providers`.
3. Implement `status()`, `complete()`, and optionally `stream()` and `embed()`.
4. Register it in `build_provider_registry()` in `providers/registry.py`.
5. Add any secrets or model defaults to `config.py` and `.env.example`.

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
2. Set `safety` to `read`, `write`, or `destructive`.
3. Set `requires_confirmation=true` for anything that writes data, sends input, runs macros,
   touches files, or starts OS-level work.
4. Pass the tool ID in the agent request's `tools` list.

## Adding A Multimodal Adapter

1. Add a provider branch in `MultimodalRegistry.invoke()`.
2. Return a plain JSON result with `provider`, optional `model`, and either `image_base64`,
   `audio_base64`, `video_base64`, `text`, or provider metadata.
3. Let `_record_asset()` persist generated image/audio/video outputs into `AI_OS_ASSETS_DIR`.

## Adding A Benchmark

1. Add a `kind` branch in `run_benchmark()`.
2. Capture `hardware_status()` before and after the run.
3. Store a `BenchmarkRunRecord` so the dashboard can compare runs over time.

## Adding An Ingestion Source

1. Convert the source to `{source_type, source_id, text, title, metadata}`.
2. Call `POST /api/ai/memory/ingest`.
3. The embedding provider is optional; Ollama is tried first and deterministic local hash
   embeddings are used only as graceful degradation.

## Backup And Restore Checks

Backups are created on startup schedule and can be created manually from the dashboard, API,
or CLI. A backup is trustworthy only when verification succeeds:

```bash
pnpm ai-os:backup
powershell -ExecutionPolicy Bypass -File scripts/ai-os.ps1 integrity
```

Use a restore-test before trusting disaster recovery:

```bash
powershell -ExecutionPolicy Bypass -File scripts/ai-os.ps1 verify -BackupId <backup-id>
powershell -ExecutionPolicy Bypass -File scripts/ai-os.ps1 restore-test -BackupId <backup-id>
```

The restore-test restores into a temp database and runs SQLite integrity checks against that
copy. It does not touch the live database.

## Health, Logs, And Troubleshooting

Useful URLs:

```text
http://127.0.0.1:8791/api/ai/health
http://127.0.0.1:8791/api/ai/health/full
http://127.0.0.1:8791/api/ai/metrics
http://127.0.0.1:8791/api/ai/integrity
http://127.0.0.1:8791/api/ai/backups
```

Logs are JSON lines under `AI_OS_LOG_DIR`, default `.ai-os-data/logs`. They include request
status and latency. Secret-looking keys are redacted before being written to backup config
summaries or log helper output.

If `GET /api/ai/health/full` is `degraded`, check in this order:

1. Database integrity and schema version.
2. Latest backup verification.
3. Ollama/provider reachability.
4. Queue depth and recent job failures.
5. Loopback security status.

## Lifecycle

For day-to-day local use:

```bash
pnpm ai-os:start
pnpm ai-os:status
pnpm ai-os:stop
```

For a simple crash-restart loop on a personal Windows machine:

```bash
powershell -ExecutionPolicy Bypass -File scripts/ai-os-supervisor.ps1
```

Stop the supervisor by creating `apps/ai-os-api/.ai-os-supervisor.stop`, or by closing the
terminal running the supervisor. To start it after reboot, create a Windows Task Scheduler
task that runs the command above at logon. This is intentionally lighter than installing a
service manager.

## Dependency And Model Hygiene

Run the local hygiene check periodically:

```bash
pnpm ai-os:audit
powershell -ExecutionPolicy Bypass -File scripts/ai-os-deps.ps1 outdated
powershell -ExecutionPolicy Bypass -File scripts/ai-os-deps.ps1 models
```

Python dependencies are pinned exactly in `apps/ai-os-api/requirements.txt` and
`apps/ai-os-api/pyproject.toml`. When updating, change pins intentionally, reinstall, then run:

```bash
cd apps/ai-os-api
.venv\Scripts\python -m pip install -e .[test]
.venv\Scripts\python -m pytest
cd ..\..
pnpm typecheck
pnpm test:workspaces
pnpm build
```

Current known dependency hygiene note: `pnpm audit --prod` may report transitive `esbuild`
and `cookie` advisories through current Better Auth / Drizzle Kit / SvelteKit paths. Keep
checking for upstream updates; do not hide the audit failure with a blanket ignore.

## Current Limits

- The queue is in-process for v1. The interface can later be backed by Redis, SQLite workers,
  or a Tauri desktop worker without changing the dashboard API.
- In-process jobs are bounded and observable, but valuable long-running jobs should eventually
  persist checkpoints to SQLite because active tasks do not survive a process crash.
- The built-in local media engine creates stylized procedural image/audio/video artifacts
  directed by Ollama. Use ComfyUI, Stable Diffusion, MusicGen, AnimateDiff, or similar engines
  through the local command/ComfyUI adapters when you want heavier model-native media output.
- ComfyUI/Piper/Whisper are CLI/API adapters, not installers. They degrade cleanly when the
  corresponding executable, workflow, or service URL is missing.
- The FastAPI service is local-first and rejects non-loopback clients by default. Add auth before
  intentionally exposing it beyond the local machine.
- The broader Hono personal sync API still needs its durable Postgres store wired end-to-end
  before data in that subsystem should be treated like disaster-recoverable AI OS data.

## Source Notes

- OpenAI Responses, Chat Completions, image generation, audio transcription, and speech endpoints
  are documented at https://developers.openai.com/api/reference/overview/
- LM Studio exposes local REST, OpenAI-compatible, and Anthropic-compatible endpoints:
  https://lmstudio.ai/docs/developer/core/server and https://lmstudio.ai/docs/developer/openai-compat
- llama.cpp server exposes OpenAI-compatible chat, responses, and embeddings routes:
  https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- vLLM can serve an OpenAI-compatible API server, defaulting to port `8000` in its quickstart:
  https://docs.vllm.ai/en/stable/getting_started/quickstart/
- OpenAI streaming responses use SSE in the current official docs:
  https://developers.openai.com/api/reference/python/
- Anthropic Messages streaming uses SSE:
  https://platform.claude.com/docs/en/build-with-claude/streaming
- FastAPI `StreamingResponse` supports streaming generator output:
  https://fastapi.tiangolo.com/advanced/custom-response/
