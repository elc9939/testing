# Mini Hub / Personal AI OS

Mini Hub is no longer just a small static arcade. It is now a private personal command
center with a staged SvelteKit rewrite, local-first data, productivity tools, AI
infrastructure, desktop automation, and the original game arcade preserved as a legacy
route.

The public GitHub Pages app is here:

```text
https://elc9939.github.io/testing/
```

GitHub Pages serves the Svelte Mini Hub. The original vanilla arcade is still available at:

```text
https://elc9939.github.io/testing/legacy/
```

## Current Reality

This repo contains two layers:

- A static SvelteKit web hub that can be deployed to GitHub Pages.
- Local desktop services that unlock private data sync, Google integrations, local AI,
  browser/web scraping tools, and Windows automation.

The website can load without the local services, but the full app experience expects the
local API services to be running on the same machine:

| Service | Default URL | Purpose |
| --- | --- | --- |
| Svelte Hub | `http://127.0.0.1:5173` | Main browser UI and GitHub Pages build. |
| Mini Hub API | `http://127.0.0.1:8787` | Personal data, sync, career/study records, game state, Google integration API. |
| AI OS API | `http://127.0.0.1:8791` | Local/API model routing, tools, RAG, jobs, multimodal generation, backups, health, web/browser access. |
| Macro Lab API | `http://127.0.0.1:8792` | Local Windows macro automation daemon. |

## What The App Does Now

### Hub UI

The Svelte app under `apps/hub` provides these main pages:

- Today dashboard: command-center cockpit with a filtered attention queue derived from
  real calendar, unread action-heavy Gmail, dated career/study work, local sync/service
  signals, capability health, and Machine Mode-aware next actions. It intentionally keeps
  passive notifications, stale leads, cleanup chores, birthdays/holidays, and obvious
  marketing out of the top queue. Gmail items on Today have direct mark-read, mark-important,
  and archive controls.
- Career Desk: job/application tracking, action items, legacy career data import.
- Study Desk: study sessions, daily progress, linked career actions, legacy study data.
- Productivity Hub: Google Calendar and Gmail actions through real API calls.
- Games: new game surfaces plus a link to the legacy arcade.
- Stick Arena Lab: Pixi/Rapier-style game-engine slice and saved run metadata.
- Analytics: local dashboard surface for career/study/game data.
- Research Desk: AI OS-backed web intelligence workbench for quick search, deep research,
  URL scrape, site crawl, source comparison, and topic-monitor shaped runs.
- AI Lab: small browser-side local AI experiments such as classification and code parsing.
- AI OS: capability dashboard for local AI, tools, memory, jobs, agents, media, health,
  backups, telemetry, Machine Profile/Autotune, and web/browser access.
- Macro Lab: UI for defining, editing, running, and inspecting local automation macros.
- Settings: service and machine control, capability health, endpoint configuration, theme,
  sync status, legacy import/export, dark mode.

The product direction is intentionally shifting toward a unified local-first Personal AI OS:
Today should show what needs attention, AI OS should become the intelligence/capability
layer, Macro Lab should be the local action layer, Career and Study should become connected
workflow systems, and the legacy games should remain available as playground/lab surfaces
rather than the main identity of the app.

The hub now has a browser-side Capability Registry v1. It normalizes existing service
status from the Mini Hub API, AI OS, Macro Lab, Google connection state, and the local
offline cache into one machine capability snapshot. Today uses that snapshot to show what
is ready, running, needs setup, degraded, blocked, or offline without inventing fake data.
Settings uses the same snapshot as the service control surface, with per-service health
links and routes into the panels that can fix or inspect each capability. Settings also
stores Machine Modes v1: Balanced, Beast, Quiet, Offline, Night Shift, and Maintenance.
These modes are now enforced by AI OS for routed text calls and queued jobs: Offline blocks
paid/cloud providers, Quiet and Night Shift avoid paid providers unless explicitly selected,
and Quiet/Maintenance clamp job concurrency. AI OS also exposes Machine Profile/Autotune v1:
OS, CPU/RAM, GPU/VRAM telemetry when available, provider readiness, loaded models, health,
benchmark history, snapshots, resource pressure, best measured text route, and suggested
job concurrency. The assistant, Settings, Today, and AI OS dashboard pass the current mode
into status/action calls so Beast Mode can prefer measured strong local routes and quiet or
maintenance modes can respect real pressure instead of guessing. Today also turns the current
mode and capability registry into concrete next actions without inventing data. Where the
backend already has a real endpoint, those recommendations can run the action directly:
local compute benchmarks, fresh backup verification/restore-tests, and a small local summary
batch through the AI OS job queue. Today also shows a compact Recent Actions ledger built
from real Mini Hub sync events, AI OS jobs/tools/benchmarks/backups/profile snapshots,
generation/design logs, Macro Lab run history, and browser-side Today recommendation clicks
so actions have visible follow-through, failures, and recoverability notes. Settings exposes
the same ledger as a recovery surface: Mini Hub actions with before-state snapshots can be
restored from the UI with explicit confirmation, AI OS file-writing actions with reversible
pre-action snapshots can be restored, and Macro Lab file recovery artifacts can be replayed
from the same panel.

### Personal Data And Sync

The hub is currently optimized for a private single-user setup:

- The Hono API runs in personal mode by default.
- Postgres is supported as the source of truth when configured.
- Browser/Tauri clients keep a local PGlite cache.
- Offline mode is read-only: cached data stays visible, but saves are disabled.
- Legacy `localStorage` data is imported so old Career Desk, Study Desk, game state,
  theme, high scores, and Stick Arena map data remain accessible.

### Productivity Integrations

The Productivity Hub uses server-side OAuth and provider adapters.

Implemented now:

- Google OAuth flow.
- Multiple Google accounts can be connected by running the OAuth flow again from
  Productivity Hub -> Add Account. Calendar and Gmail resources are scoped to the account
  that produced them, and Today shows connected account counts/labels instead of assuming
  a single Google identity.
- Google Calendar list/view/create/edit/delete/move/reminder support.
- Gmail search/list/read/compose/draft/send/reply/archive/mark read/unread/label actions.
- Mini Hub action ledger endpoint for synced personal data writes/deletes with risk and
  recoverability metadata. Updates and deletes now attach before-state snapshots for
  Career Desk, Study Desk, settings, and game state where possible, and
  `/api/action-ledger/:id/restore` can restore those snapshots with explicit confirmation.
  Restore attempts are first-class Mini Hub actions too: cancelled confirmations are
  recorded as blocked dry-runs, unsupported restores as failures, and successful restores
  link to the follow-up sync event that wrote the restored data.

Partially prepared:

- Google Drive, Docs, and Sheets scopes/config are present for future adapters.
- Brightspace/D2L support depends on institution API access; iCal deadline ingestion is the
  practical fallback when write APIs are unavailable.

More detail: `docs/personal-productivity-hub-setup.md`.

### AI OS

`apps/ai-os-api` is a FastAPI service for local-first AI capability infrastructure.

Current capabilities include:

- Unified inference routing across Ollama, OpenAI-compatible local servers, OpenAI,
  Anthropic, and specialist providers.
- Streaming responses and per-call usage/cost/latency logs.
- Batch jobs: map, self-consistency, chunk summarization, retry loops.
- Local semantic memory/RAG with pluggable ingestion.
- Agent/tool runtime with read/write/destructive safety metadata.
- Multimodal adapters for image, audio, TTS, STT, video, and vision.
- Built-in local starter media renderer plus optional ComfyUI/local command/OpenAI paths.
- Image-to-Desktop tool exposed to the assistant.
- Web tools: `web.search`, `web.scrape`, and `browser.extract` with private-network
  blocking by default.
- Research Engine v1: query planning, DuckDuckGo HTML search adapter, polite page
  fetching through the AI OS web tools, robots-aware crawl checks, source caching,
  extraction, dedupe/ranking, citation mapping, archived reports, Markdown/JSON/HTML
  export, live progress/cancel state, opt-in semantic memory indexing, and action-ledger
  entries.
- Health, metrics, backup, restore-test, cleanup, dependency/model hygiene surfaces.
- AMD/Windows GPU telemetry where the local machine exposes it.
- Machine Profile + Autotune v1: persisted profile snapshots, safe local text probes,
  recent benchmark summaries, resource-pressure summaries, and measured-route feedback
  into routing and machine-mode recommendations.
- AI OS action ledger endpoint that normalizes tool calls, inference usage, jobs,
  benchmarks, backups, machine-profile snapshots, generation assets, and design patches
  into one audit/recoverability stream. The Mini Hub API also exposes
  `/api/action-ledger/unified`, which federates Mini Hub sync/restore actions with AI OS
  action logs and Macro Lab run history server-side; browser-only cockpit clicks are merged
  by the hub client because they live only in local browser storage.
- AI OS pre-action snapshots for file-writing tools, currently including assistant
  image-to-Desktop exports. Snapshots record whether the target already existed and copy
  previous bytes when there is something to preserve; backup manifests include those files.
- AI OS action snapshot restore endpoint and Settings restore button for reversible file
  snapshots. Restores require explicit confirmation, snapshot the current target first, and
  log the restore attempt back into the ledger.

More detail:

- `docs/personal-ai-os-architecture.md`
- `docs/personal-ai-os-setup.md`
- `docs/personal-ai-os-infrastructure-audit.md`
- `docs/research-engine.md`

### Assistant Popup

The floating assistant in the hub is the friendlier front door for AI OS:

- Opens/navigates app pages.
- Explains AI Lab, AI OS, and hub surfaces.
- Summarizes cached hub data.
- Searches semantic memory.
- Checks AI/provider/hardware status.
- Summarizes the hub Capability Registry so it can explain what is local, paid, ready,
  offline, blocked, or still needs setup.
- Runs AI OS tool-backed commands.
- Sends a compact capability snapshot into AI OS command context so agent plans can prefer
  ready local tools and report unavailable prerequisites instead of guessing.
- Sends the current Machine Mode into AI OS command context so plans can distinguish Beast,
  Quiet, Offline, Night Shift, and Maintenance intent.
- Can search/scrape the web, use browser extraction, generate media files, and call app
  tools when AI OS is running.
- Write/system actions remain confirmation-gated.

### Macro Lab

`apps/macro-lab-api` is a local Windows automation daemon, surfaced in the hub's Macro Lab.

Current scope:

- Macro definitions and run history.
- JSON macro editor in the UI.
- Dry-run and confirmed execution modes.
- Local input/window/file/clipboard/shell-oriented action primitives.
- Folder/time/hotkey-style trigger plumbing.
- Panic/armed safety controls.
- File-action recoverability metadata: real `file.delete`, `file.move`, `file.copy`, and
  `file.batch_rename` runs record snapshots or inverse-operation hints in run history, and
  the unified Action Ledger surfaces those artifacts. Settings can restore reversible file
  recovery artifacts through the Macro Lab restore endpoint with explicit confirmation.

More detail:

- `docs/macro-lab-architecture.md`
- `docs/macro-lab-setup.md`

### Games And Legacy Arcade

The old static arcade still exists and is intentionally retained:

- Legacy route: `/legacy/`
- PWA/offline cache for the legacy static app.
- Games include Stick Arena, Star Drifter, Neon Snake, Brick Blaster, Memory Match,
  Reaction Rush, Tic-Tac-Toe, Neon Pinball, Orbit, 2048, Four in a Row, and Gambit.
- Connect Four AI training/evaluation scripts remain under `ai/` and `scripts/`.
- `logminer/` remains a standalone Java CSV log utility.

## Project Layout

```text
apps/hub/              SvelteKit static hub deployed to GitHub Pages
apps/api/              Hono API for sync, personal data, OAuth integrations, Gmail/Calendar
apps/ai-os-api/        FastAPI AI OS backend for models, tools, RAG, media, health, backups
apps/macro-lab-api/    FastAPI Windows automation daemon
apps/desktop/          Tauri desktop shell scaffold
packages/core/         Shared TypeScript domain types and route constants
packages/db/           Shared schema/local data helpers
packages/ai/           Shared AI/browser-side helpers
packages/game-engine/  Shared game engine experiments
packages/ui/           Shared UI package scaffold
css/, js/, icons/      Legacy static arcade assets copied to /legacy on Pages deploy
ai/                    Legacy/local Connect Four training and evaluation code
logminer/              Standalone Java CSV log summarizer
docs/                  Architecture and setup notes for the larger subsystems
scripts/               Launchers, checks, icon generation, AI/game utilities
```

## Setup

Install Node dependencies from the repo root:

```powershell
pnpm install
```

Create Python virtual environments for local services:

```powershell
cd apps/ai-os-api
python -m venv .venv
.venv\Scripts\python -m pip install -U pip
.venv\Scripts\python -m pip install -e .[test]

cd ..\macro-lab-api
python -m venv .venv
.venv\Scripts\python -m pip install -U pip
.venv\Scripts\python -m pip install -e .[test]
```

Copy `.env.example` to `.env` when configuring OAuth/API keys or non-default service URLs.
Secrets belong in `.env`, never in git.

## Running Locally

For the core web app and data API:

```powershell
pnpm dev:api
pnpm dev:hub
```

For AI OS:

```powershell
pnpm ai-os:start
pnpm ai-os:status
```

For reboot reliability on Windows, install the local AI OS supervisor as a logon task once:

```powershell
pnpm ai-os:autostart:install
pnpm ai-os:autostart:status
```

That task starts the AI OS service after you sign in. The AI OS launcher and supervisor also
try to start `ollama serve` when the Ollama CLI is installed but the Ollama API is asleep.
The supervisor waits for AI OS health, then sends one tiny Ollama warmup prompt so the
configured local model can become resident after boot. `pnpm ai-os:autostart:status`
prints the same service, Ollama, GPU, and model-load readiness that the website depends on.
The website itself cannot start local Windows processes, so GPU telemetry appears only when
this local service is already running; the AI OS and Today pages retry briefly during startup.

For Macro Lab:

```powershell
pnpm macro-lab:start
pnpm macro-lab:status
```

For a phone/LAN development session that starts the hub, API, AI OS, and Macro Lab with
LAN-safe URLs:

```powershell
pnpm stack:start:lan
```

That script writes the generated phone URL to `phone-link.txt` and tries to copy it to the
clipboard.

## GitHub Pages Deployment

`.github/workflows/pages.yml` builds the Svelte hub and publishes it to GitHub Pages. During
deployment it also copies the legacy static arcade to `/legacy/`.

Important distinction:

- GitHub Pages can serve the UI.
- GitHub Pages cannot run your local Hono/FastAPI services.
- Full sync, Google integrations, AI OS tools, and Macro Lab require local services or a
  separately deployed API endpoint configured in Settings.

## Checks

Common local checks:

```powershell
pnpm typecheck
pnpm test:workspaces
pnpm legacy:check
```

Python backend checks:

```powershell
apps\ai-os-api\.venv\Scripts\python.exe -m pytest apps\ai-os-api\tests
apps\macro-lab-api\.venv\Scripts\python.exe -m pytest apps\macro-lab-api\tests
```

Legacy static checks:

```powershell
node scripts/check-all.js
```

The GitHub CI workflow still covers the legacy/static JavaScript, PWA cache, Stick Arena pose
smoke test, and LogMiner smoke test.

## Current Boundaries

- This is a private, single-user system in active development, not a polished public SaaS.
- Offline editing is intentionally out of scope right now; offline means read-only cache.
- Local AI quality depends on your installed Ollama/local models and GPU/CPU resources.
- Heavy image/audio/video generation needs ComfyUI, a local command adapter, or paid API
  keys; the built-in media engine is a local starter renderer.
- Macro Lab is Windows-oriented and should be treated as a powerful local automation tool.
- Browser/web scraping tools are read-only and block private/local hosts by default.
- Google Drive/Docs/Sheets and Brightspace are planned/partially scaffolded, not equivalent
  to the current Gmail/Calendar implementation.

## README Maintenance

When the app's real behavior changes, update this README in the same change whenever the
change affects:

- what the app is for,
- what pages/features exist,
- what services are required,
- how to run or deploy it,
- what integrations/tools are available,
- what limitations users should expect.

Subsystem-specific details should also be kept in the matching file under `docs/` or the
service-level README.
