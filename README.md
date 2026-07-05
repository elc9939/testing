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
| Ollama | `http://127.0.0.1:11434` | Local model server used by AI OS and Macro Lab when available. |

## Local Full Power vs. Private Remote vs. Hosted Light

Mini Hub now treats access mode as a first-class diagnostic, not as guesswork.

| Mode | URL | What it means |
| --- | --- | --- |
| Local Full Power | `http://127.0.0.1:5173` | Best mode. The browser is on the Windows PC that also hosts Hub API, AI OS/Ollama, Macro Lab, telemetry, Google integration callbacks, and local automation. |
| Private Remote | `http://<pc-tailscale-name-or-ip>:5173` | Full-power mode from another device when the PC is awake, the local stack is running in LAN mode, and the browser can reach trusted Hub API, AI OS, and Macro Lab endpoints. Tailscale is the preferred path. |
| Hosted Light | `https://elc9939.github.io/testing/` | Static GitHub Pages shell. It can show browser-local/cached state and setup guidance. It is not the compute host and cannot make `github.io/testing/api/*` become the local backend. |

Settings -> Remote Access / Connection Mode shows the current page origin, detected mode,
detected LAN IPv4 addresses when the Hub API is reachable, service health targets, current
endpoint state, and current-host endpoint suggestions. If you open the hub through a LAN or
Tailscale address, use **Use Current Host URLs**, then **Save Service URLs** and **Check
Services**. If you are on GitHub Pages, enter private remote endpoints manually or open
Local Full Power on the PC.

The standard private remote service URLs are:

```text
Hub UI:        http://<pc-private-host>:5173
Mini Hub API:  http://<pc-private-host>:8787
AI OS API:     http://<pc-private-host>:8791
Macro Lab API: http://<pc-private-host>:8792
Ollama:        http://<pc-private-host>:11434
```

For the current one-command bridge launcher, use:

```powershell
pnpm bridge:status
pnpm bridge:start
pnpm bridge:start:lan
pnpm bridge:restart
pnpm bridge:stop
pnpm bridge:startup:install
pnpm bridge:startup:status
```

`bridge:start` starts/checks the local service bridge for this PC. `bridge:start:lan` also
starts the local Hub UI on the LAN address and writes a ready URL with `apiUrl`, `aiOsUrl`,
`macroLabUrl`, and `ollamaUrl` query parameters to `bridge-link.txt`. The status action shows
Mini Hub API, AI OS, Macro Lab, and Ollama health plus PIDs. `bridge:startup:install`
registers a per-user Windows logon starter named `Mini Hub Bridge` so the local bridge starts
quietly after reboot instead of requiring several terminals. If Windows blocks Scheduled Task
registration from a non-admin shell, the installer falls back to the current user's Startup
folder.

The older Windows LAN helper still works:

```powershell
pnpm stack:start:lan
```

or double-click:

```text
Start Mini Hub Phone Mode.cmd
```

That launcher starts the Hub API, AI OS, Macro Lab, and Svelte hub with trusted private
origins for the detected desktop IP, copies a ready-to-open URL to the clipboard, and writes
it to `phone-link.txt`. For Tailscale, keep the PC awake, connect both devices to the same
tailnet, then use the same ports on the PC's Tailscale name or `100.x` address. Add any
extra private origins to `TRUSTED_ORIGINS`, `AI_OS_TRUSTED_ORIGINS`, and
`MACRO_LAB_TRUSTED_ORIGINS` if you serve the UI from a private hostname that the launcher
did not detect.

For optional bridge hardening, set the same shared secret before starting services:

```powershell
$env:MINI_HUB_BRIDGE_TOKEN='a-long-private-random-string'
pnpm bridge:start:lan
```

Then save that value in Settings -> Desktop Services -> Bridge token. When
`MINI_HUB_BRIDGE_TOKEN` is configured, Hub API, AI OS, and Macro Lab work routes require the
`X-Mini-Hub-Bridge-Token` header sent by the hub. Health endpoints stay readable enough for
diagnostics and report whether the token is required/accepted. Ollama is not sent this
Mini Hub token because the stock Ollama server does not understand it.

Do not expose AI OS or Macro Lab directly to the public internet. Macro Lab can control the
desktop, and AI OS can access local models, files, tools, and browser-like research routes.
Keep remote access private-network only unless you deliberately add a stronger auth/proxy
layer later. Remote-control features remain off or confirmation-gated unless you explicitly
arm them in Macro Lab.

### Hosted Pages vs. Local Services

The hosted GitHub Pages app is only the static web UI. It must not use
`https://elc9939.github.io/testing/api/...` as a backend. Settings now includes a
**Remote Access / Connection Mode** panel and a **Feature Wiring** diagnostic table that
show the current endpoint, required service, last check, state, and fix action for Mini Hub
API, AI OS API, Research Desk, Macro Lab, Google integrations, Passive Tasks, and browser
storage.

If a feature is pointed at the hosted web page instead of a local service, Mini Hub marks it
`Misconfigured` and falls back to the default local service URL where safe. If a service is
not running or the browser blocks the request because of CORS/firewall/mixed-content rules,
the feature should show an actionable offline/setup state instead of raw `Not Found`.
Known provider and telemetry failures are compacted too, so Settings, AI OS, and Passive
Tasks should say what to reconnect or configure instead of leaking raw PowerShell commands,
vendor-tool traces, `fetch failed`, or paid-provider 401 URLs into the UI.

Use Settings -> Desktop Services to save LAN or localhost service URLs for this browser.
Use Settings -> Feature Wiring to verify what the hosted page will actually call before
debugging individual features.

The modern hub also retires the old root arcade service worker that used to cache every GET
under the GitHub Pages scope. That legacy worker could replay stale local API responses from
AI OS or Macro Lab, making the site look connected while telemetry/actions were actually
old. The current build unregisters that root worker on hub startup, deletes old `mini-hub-v*`
caches, reloads once when needed, and publishes a neutral root `sw.js` that does not
intercept API calls. The legacy arcade still lives under `/legacy/`.

## What The App Does Now

### Hub UI

The Svelte app under `apps/hub` provides these main pages:

The shared shell keeps primary navigation warm by preloading route code for visible nav
links and only preloading page data on hover. That makes first page switches feel faster
without kicking every local API or desktop service just because the sidebar is visible.

- Today dashboard: unified attention cockpit backed by `/api/attention/snapshot`, with a
  Now/Next calendar strip, priority action queue, Mail Triage, Career/Study Focus,
  System/Service issues, source freshness, capability health, and Machine Mode-aware next
  actions. It aggregates real Calendar, Gmail, Career, Study, AI OS, Macro Lab, Research,
  service-health, and manual-item signals without setup placeholders or fake data. Actions
  such as Read, Important, Archive, Complete, Snooze, Dismiss, Run, Restore, and Open Source
  flow through the shared attention model where supported. The browser keeps a last-good
  cached attention snapshot and bounds refresh/action requests, so a slow local API does not
  leave the cockpit spinning forever; cached attention is shown read-only until the hub
  responds again. Today also shows a compact **Save & Recovery** strip with browser-cache
  row count, last sync status, current save mode, and links to Activity plus the full
  Settings -> Data & Recovery map. Capability Health and Machine Mode recommendations also
  warm-load from the last browser snapshot, then refresh quietly, so switching back to Today
  does not start from a blank service panel.
- Activity: a durable recovery surface for long-running or recently finished work. It
  projects persisted Research runs, AI OS jobs/backups/benchmarks, Passive Task runs, and
  Macro Lab run history plus Mini Hub action-ledger writes into one list with source health,
  progress, errors, and deep links back to the owning feature.
- Career Desk: job/application tracking, manual fit scores, one-click "mark applied"
  status updates that create a 14-day follow-up action, Gmail update matching for submitted
  applications, action items, a visible Career Discovery status panel that separates
  Career Radar (existing jobs/actions/statuses) from Max Scout Career Discovery (new-role
  scouting) and Max Power Search (heavy local-first repeated discovery while local services
  are running), synced Career Discovery profile filters for routine passive role research
  with focused/broad/max intensity, strict May/Summer 2027 graduation/start-date/
  qualification guardrails, high-confidence passive Gmail/completed-action
  application confirmation and career-status updates, a durable Career Scout candidate pool that
  keeps wide-discovery findings separate from the visible application table until promoted,
  local Refine and explicit GPT Rank actions that route through AI OS with a paid fallback
  cost ceiling before writing provider/model/cost evidence back to the candidate,
  a ranked Apply Queue with application-angle guidance and quick open/save/watch/applied
  actions, quick save/watch/not-fit review actions, an automation status panel for Career Radar and
  Discovery runs, active discovery topics/source lanes, last/next run times, pooled/filtered
  counts, one-click Enable/Refresh Max Scout and Max Power Search setup actions,
  a manual Run Discovery Now action,
  a compact Strategy Review panel for pipeline risk, role mix, interviews,
  offers, rejections, and next focus, a synced seen-lead registry for duplicate avoidance
  across manual rows, passive imports, reviews, deletes, and exports, and legacy career data import.
- Study Desk: study sessions, daily progress, linked career actions, legacy study data.
- Productivity Hub: Google Calendar and Gmail actions through real API calls, with a
  browser-side last-good snapshot so calendar/mail views show cached real data while
  the local API refreshes in the background. The cached snapshot preserves the selected
  calendar week and selected Gmail thread so route changes and browser refreshes do not
  jump back to the first row. Calendar has both a visual week board and detailed text
  table; priority mail shows summaries with hover/focus quick actions for read/unread,
  important, and archive. The default header keeps only live data, Google, and saved
  context status visible; API/write/account diagnostics live under Connection details.
- Games: new game surfaces plus a link to the legacy arcade.
- Stick Arena Lab: Pixi/Rapier-style game-engine slice and saved run metadata.
- Analytics: local dashboard surface over the real Mini Hub browser cache for career,
  study, and game data. It shows loading, offline cached, and healthy-empty states instead
  of sample metrics.
- Research Desk: AI OS-backed web intelligence workbench with one query box, Quick/Standard/
  Deep effort presets, a compact scrollable Reports rail for active/finished runs,
  readable Quick Report briefs, export links, source handoff actions, and a Routine Research
  monitor section for recurring manual/daily/weekly runs. Reports are saved by AI OS in
  `apps/ai-os-api/.ai-os-data/ai-os.sqlite3` (`research_runs`) and can be reopened from
  `/research`, `/research?run=<id>`, Activity, or Markdown/JSON/HTML exports. Selecting a
  report reveals the report panel directly under the workbench; long report, monitor, and
  source-library lists scroll internally so they do not bury the selected result. Deep mode
  is a heavy local-first run budget, while Career Discovery/Max Power uses broad compact
  search queries plus strict May/Summer 2027 graduation/start-date/qualification filters
  after source collection. Source Library cards, monitor cards, and report source previews
  stay compact by default; diagnostics and raw extraction details remain recoverable behind
  disclosure controls.
- AI Lab: small browser-side local AI experiments such as classification and code parsing.
  It shows whether the local browser assets are configured, distinguishes loading,
  healthy-empty, and error states, and does not require the AI OS API.
- AI OS: capability dashboard for local AI, tools, memory, jobs, agents, media, health,
  backups, telemetry, Machine Profile/Autotune, and web/browser access. The dashboard
  warm-loads the last browser AI OS status snapshot, then reconnects in the background;
  cached status is readable, but service-backed actions stay disabled until a live
  reconnect succeeds.
- Macro Lab: UI for defining, editing, running, and inspecting local automation macros.
  It warm-loads the last browser Macro Lab snapshot for saved definitions, action catalog,
  and run history; cached state is readable, but desktop-control actions stay disabled
  until the live Macro Lab service reconnects.
- Passive Tasks: durable background watcher dashboard for app health, backups, idle
  compute, research monitor sweeps, career radar, local file intelligence, and project
  drift detection. The page hydrates from a browser snapshot cache first, then refreshes the
  live API snapshot in the background so route changes and browser refreshes feel warmer.
  The default view is status-first; individual watcher toggles and noisier controls live
  behind management/advanced disclosures.
- Settings: service and machine control, capability health, endpoint configuration, theme,
  sync status, Data & Recovery persistence map, passive task preferences, legacy
  import/export, dark mode. Machine Mode now keeps everyday presets visible
  (Auto/Balanced/Beast/Quiet) and moves special modes (Offline/Night/Maintenance) plus
  verbose policy details behind Advanced modes. Auto uses measured machine pressure to
  recommend and enforce lighter passive behavior when the GPU/VRAM/CPU is busy and more
  local-first background work when the PC is idle and available.

The product direction is intentionally shifting toward a unified local-first Personal AI OS:
Today should show what needs attention, AI OS should become the intelligence/capability
layer, Macro Lab should be the local action layer, Career and Study should become connected
workflow systems, and the legacy games should remain available as playground/lab surfaces
rather than the main identity of the app.

The hub now has a Unified Attention & Action Queue v1 in addition to the browser-side
Capability Registry. The Mini Hub API exposes `/api/attention/snapshot`, which normalizes
references plus display/action metadata from Google Calendar, Gmail priority threads,
Career Desk jobs/actions, Study Desk signals, AI OS jobs/health/backups/benchmarks,
Macro Lab status/run history, Research monitors/runs, Passive Task output cards, local
service health, and any manual attention items already stored in personal settings. Source
freshness and source errors are returned alongside the items, and serious passive source-health
issues can become capped inspectable Today items when no passive result card already covers
them, so partial failures are visible instead of silently dropping data. User triage state,
including dismissed, snoozed, manually important, completed, and archived items, is persisted
through synced personal settings under the existing sync path. The hub client caches only the last successful real snapshot
under `miniHub.attention.snapshot.v1`; cached attention is read-only while offline.

The hub also has an Activity / Handoff surface at `/activity`. It is not a separate fake task
database; it is a recovery projection over backend-persisted source records. Research runs
link to `/research?run=<id>`, AI jobs/backups/benchmarks link to AI OS, passive runs link to
Passive Tasks, and Macro Lab runs link to Macro Lab. The Activity page loads a last-good
browser cache first, then refreshes AI OS, Passive Tasks, and Macro Lab independently with
per-source timeouts so one slow or offline service creates a partial-data warning rather than
wiping out or blocking the rest of the list. If all live Activity sources fail but a previous
durable list exists in browser storage, the cached records stay visible as stale partial data.
AI OS reads linked job/activity query parameters and highlights matching jobs, benchmarks,
backups, tool calls, and generation assets when the current snapshot includes them.
Passive Tasks and Macro Lab read the linked `run` query parameter, highlight the matching
recent run when it is in the current service snapshot, and explain when the Activity record is
older than the page's short recent-run list.
If a task seems to disappear after switching pages or refreshing, open Activity first: active
and recent durable work should be recoverable there, while purely visual drafts stay in
browser storage on their owning page. Completed or failed Activity records can be dismissed
from the Activity view, but dismissal is only a local browser filter. It does not delete,
cancel, archive, or mutate the backend record, and active queued/running/paused work stays
visible until the owning service reports a stable state. Cancelling active work from
Activity asks for confirmation before it tells the owning backend to stop the run/job.
Owning pages such as Research, AI OS jobs, and Passive Tasks use the same confirmation
pattern for direct cancel controls.

Settings also includes a Data & Recovery map that explains where each major surface saves
state, what rehydrates after refresh/browser close, what remains browser-local, and which
page to open when work needs to be recovered.

### Will progress save if I close the site?

Use the left-rail save-status pill or Today -> Save & Recovery for the quick answer; both
land directly on Settings -> Data & Recovery for the full map. Browser-local drafts, attention
cache, AI Lab inputs, and service endpoint settings stay in the current browser. Career,
Study, supported games, Passive Tasks, and synced settings save through the Mini Hub API
when it is online; offline mode is intentionally read-only. Research, AI OS, Macro Lab,
backups, benchmarks, and passive/background runs are recovered through Activity because
their real records live in the owning local service. Google Mail/Calendar state remains
authoritative in Google, while Mini Hub keeps a browser-side last-good display cache.
Analytics does not save its own dataset; it rebuilds from cached/synced Career, Study,
and game records. Settings service URLs and diagnostics are browser-local, while any
API-backed preferences only sync when the Mini Hub API is reachable.
The Settings map now starts with three quick rules: switching pages is safe, closing and
reopening is usually safe in the same browser, and another device only gets records backed
by Hub API, Google, AI OS, Macro Lab, or Passive services.
Service/setup links that mention endpoints, local APIs, Google, AI OS, Macro Lab, or
Passive Tasks land directly on Settings -> Feature Wiring so the current target URL,
last check, status, and fix action are visible without hunting through Settings.
Today's Machine Mode and Recent Actions shortcuts also land directly on the Settings
Machine Mode controls and Action Ledger instead of the top of Settings.

Mini Hub also has Passive Task Engine v1 under `/api/passive-tasks/*` and the `/passive-tasks`
dashboard. The engine persists first-class `Watcher`, `Trigger`, `Task`, `Run`, `Result`,
and `Notification` state to `passive-tasks.json` in `MINI_HUB_DATA_DIR`, exposes live
`Worker` state in the snapshot, persists the worker's last-known state, logs runs into the
Action Ledger, and exposes a snapshot with per-family freshness/errors. Runtime-only worker
fields such as stale file watcher handles, pending file events, and `running` are cleared
when passive state is loaded after a restart. Explicit Mini Hub action events, including Passive Task
runs, watcher toggles, settings changes, card triage, and restore attempts, persist to the
bounded `action-ledger.json` audit file in `MINI_HUB_DATA_DIR`; obvious secret/token fields
are redacted before that file is written. The worker checks
due tasks on a lightweight interval while the API is running, and on Windows it marks ticks
idle after the configured last-input threshold so idle-only work can run automatically. If
idle state cannot be measured, the worker stays conservative and treats the tick as active.
When the passive engine is disabled, worker ticks skip idle probing and due-task dispatch so
the off switch is quiet rather than just result-less; pending file events are dropped and
active watched-folder handles are closed as the worker refreshes.
The dashboard can also run due tasks, event-triggered startup checks, or idle-only ticks
manually. Direct "Run now" actions are recorded on separate manual triggers, so ad hoc runs
do not rewrite the scheduled trigger's last-fired state. If a running passive task is cancelled, the cancelled state is preserved when the
in-flight run finishes, so the task does not silently resume itself. The API worker emits
`app.startup` when it starts, the browser shell emits throttled `app.startup`/`app.reconnect`
events on open and reconnect, and the shared browser layout emits throttled
`app.user_active`/`app.game_active` events with active idle metadata as you focus the hub or
enter game routes. Auto treats those browser activity signals as short-lived, so stale game
activity ages out and the desktop idle probe can later allow heavier work. Google OAuth
connect/revoke flows emit passive lifecycle events. It also
watches configured local folders with a debounced `file.changed` event while
the API is running. `POST /api/passive-tasks/events/:eventName` also ingests named events
directly, and event-only tasks stay out of ordinary scheduled ticks. V1 task families are
real-data only:

- App Health Watchdog checks the hub data directory, Google connection state, configured
  local service endpoints/ports, AI OS, Macro Lab, Ollama reachability/model inventory, the
  configured Ollama chat model, AI OS jobs, backup freshness, and the AI OS machine-profile
  autotune summary. High measured resource pressure or a failed AI OS storage integrity
  check becomes a source-backed finding, while normal provider/benchmark/concurrency details
  are retained in the App Health run metadata. It runs on a schedule and through built-in
  startup, reconnect, and Google OAuth lifecycle event triggers.
- Backup + Snapshot Watcher writes non-destructive Mini Hub restore snapshots under
  `MINI_HUB_DATA_DIR/passive-snapshots`, read-verifies each new snapshot, records byte count,
  checksum, entity counts, redaction status, Passive Task state, sync events, and a redacted
  Action Ledger copy, and asks AI OS for its own backup when available. The passive snapshot
  now includes first-class `backupHealth` with the newest restore point path, age, checksum,
  entity summary, redaction count, stale/error state, and dry-run cleanup pressure. The
  backup source status carries the same restore-point health, so source-health summaries and
  dashboards degrade when restore points are missing, stale, or unverifiable.
- Idle Compute Queue runs bounded AI OS benchmarks, local-first passive digest summary jobs,
  and non-destructive Mini Hub cleanup dry-runs only when the worker or a manual tick reports
  a real idle window. Summary jobs use existing source-backed passive cards and cleanup cards
  list stale passive snapshots/logs/temp files under Mini Hub-owned data paths; v1 does not
  delete them. It also reads the latest fresh App Health machine-profile/autotune metadata:
  high measured CPU/RAM/GPU/VRAM pressure defers local AI summary/benchmark work while still
  allowing cleanup dry-runs, suggested concurrency is passed to queued AI OS jobs, and Beast
  Mode prefers the best measured local text route when one exists.
- Background Research Monitor reads AI OS saved monitor due-state, prepares daily AI OS
  monitor templates from configured watched research entries and active Career Desk
  application URLs, queues due monitor runs through AI OS, and surfaces completed
  `monitor_topic` reports as source-backed passive cards. The watch list accepts plain
  domains plus `page:`, `topic:`, `tool:`, and `company:` lines; pages/domains stay
  domain-constrained, while topic/tool/company watches search by goal text. Already
  surfaced research run ids are skipped on later sweeps so completed monitor reports do
  not repeat endlessly. Broad new-role scouting is explicit: until Career Desk saves a
  Career Discovery/Max Scout profile, the passive research monitor only watches configured
  entries and active saved-job domains, and the Career page explains that no new
  recommendations can appear yet. Career Discovery profile filters can expand role discovery from
  focused to max intensity, creating bounded role/location monitor variants while still
  carrying the B.S. May 2026 / M.S. expected May 2027 profile, May 2027/Summer 2027 start
  window, background/status fit text, and duplicate company exclusions. Max Power Search is
  an explicit Career Desk mode that saves the same profile with a heavy local-first budget,
  a larger bounded monitor set, and a short 15-minute repeated research cadence while the
  local API/AI OS/passive worker are running. Broad/max discovery also creates source-lane monitors for direct
  company/ATS pages, new-grad programs, internships/fellowships, application-deadline and
  recruiting-cycle pages, early-career boards used as source indexes, student-program
  directories, data/analytics searches, data-vendor/startup searches, quant/finance searches,
  finance summer analyst/academy programs, local-AI technical searches, and AI research lab
  searches when those lanes match the saved role/background profile. A saved priority-company watchlist creates company-specific monitors that
  search official career pages, ATS postings, student programs, and new-cycle roles while
  still rejecting exact duplicate company-role matches. The monitor metadata also learns from Career Desk review state:
  saved/watching/applied roles become positive ranking hints, while archived/rejected and
  "not fit" reviews become avoidance hints. Completed Career Discovery monitor reports now
  save source-backed findings into a durable `career_scout_candidate` pool first when a source URL passes
  opportunity, source-quality, timing, profile-fit, seniority, duplicate, feedback, and fit-score checks;
  promoting a candidate is the explicit second step that creates a normal Career Desk `lead` row,
  while rejected candidates remain inspectable for debugging the search;
  job-board mirrors, unclear hosts, and listings whose May/Summer 2027 timing only appears
  in surrounding research context stay filtered until a stronger direct/ATS source is found.
  Listings whose source-local class year, graduation year, start date, or qualification
  requirements conflict with the saved May/Summer 2027 profile are filtered before fit-score
  ranking, with skip reasons such as wrong graduation year, wrong start date, qualification
  mismatch, or weak profile fit.
  Candidate records preserve the source and evidence, plus parseable discovery metadata for source quality, timing
  confidence, deadline confidence, posting date, and duplicate status. The candidate pool can
  fetch the original source page and refine/rank through AI OS: bulk/local work stays on
  Ollama where possible, while the explicit GPT Rank action permits GPT-4o mini fallback up
  to the displayed budget cap and records provider/model/cost/latency on the candidate and
  Mini Hub action ledger. Activity includes Mini Hub action-ledger records, so Career Scout
  refine/promote/reject writes remain recoverable beside AI OS, Passive Tasks, and Macro Lab work.
  When a sweep finds candidates but promotes none, a durable filter
  summary card shows what was rejected, such as duplicate roles or low-fit listings. The
  passive engine also keeps a bounded Career Discovery filter memory in synced settings, so
  repeated low-fit, weak-timing, weak-source, or excluded source fingerprints are skipped as `previously-filtered`
  unless a later sweep scores them strongly enough to reconsider. Career Desk exposes
  Career Radar and Discovery status from the real Passive Tasks snapshot, with
  cached fallback, passive-worker state, configured/unconfigured Max Scout and Max Power
  Search state, active
  discovery topics/source lanes/priority companies, latest run/card summaries, next run times,
  remembered-filter counts, pooled/filtered counts, skipped-reason summaries, and manual run buttons for the
  existing tasks. It also exposes discovered leads and the Career Scout pool as ranked panels where each candidate can
  be moved to `saved`, moved to `watching`, or archived as not fit without opening the full
  table row; rows show source quality, timing confidence, deadline confidence, posting date,
  and review date when the imported discovery metadata is available. A ranked Apply Queue
  promotes the strongest active leads using stored fit score, timing confidence, source
  quality, status, and review-date urgency, then shows an application angle plus quick
  Open, Save, Watch, and Mark Applied controls where allowed. A compact Strategy Review
  panel summarizes the current pipeline from real jobs/actions: next focus, stale or quiet
  records, submitted/high-fit counts, interview/offer/rejection counts, and active role
  family mix. Job writes and passive imports also maintain a synced
  `preferences.careerSeenLeadRegistry` object, so future discovery sweeps can reject
  duplicate URLs or company-role matches even if a row was later archived or deleted; the
  registry travels with normal settings sync, backup, and export/import data.
- Career Radar reads Career Desk jobs/actions and surfaces stale or overdue follow-ups,
  including submitted applications, interviews, and offers that have gone quiet without a
  next action. High-confidence Gmail confirmations and completed linked apply/submit actions
  can auto-promote saved leads to `applied`, add a 14-day follow-up action, write sync events,
  and emit a passive result card explaining the evidence. Career Radar also scans recent Gmail
  interview, offer, and rejection signals: strong interview/offer matches can advance the job
  pipeline and create a prep/review action, while ambiguous or sensitive matches, especially
  lower-confidence rejection evidence, stay review-only. Every automatic status update writes
  a before-snapshot sync event and Action Ledger entry.
- Local File Intelligence scans only configured watched folders for recent document,
  note/data, and image metadata; text-like files get bounded previews, suggested tags,
  cleanup hints, and optional AI OS semantic-memory indexing from debounced folder events
  or scheduled scans. PDFs, Office docs, screenshots, and image downloads get metadata-only
  summaries such as dimensions, approximate PDF page markers, package hints, tags, and
  cleanup hints until a real extractor/OCR path exists. Text-like file ingests record a
  path/mtime/size fingerprint in passive run history so unchanged files are skipped on later
  scans, while edited files can index again.
- Project Drift Detector scans only configured project folders for stale README files,
  README files that trail newer source/config files, TODO/FIXME buildup, missing
  `test`/`check` scripts, and existing failing health artifacts such as recent test/check
  logs. TODO buildup cards include the top source files, counts, and sample lines. It reports
  those artifacts without running arbitrary project commands in the background.

Passive outputs are source-backed cards with title, summary, urgency, confidence, source
links/files, suggested next action, and why the item surfaced. High-urgency cards flow into
Today through the unified attention source `passive_task`; lower-urgency cards stay in the
Passive Tasks dashboard digest. Passive cards can be marked important, reviewed, snoozed, or
dismissed at the source, and that triage is persisted with the passive engine by card id and
source-backed fingerprint so equivalent recurring findings stay quiet across restarts while
changed findings can resurface. Routine cards age out of Today/passive digest surfaces after
7 days, and urgent cards after 30 days, unless marked important or tied to an unresolved
failed/blocked run; run history and source rows stay inspectable. Settings controls global
enablement, notification style, idle preference, resource limit, local/cloud AI preference,
family enablement, max runs per tick, and watched folders/domains/accounts. The dashboard
keeps notification/resource presets visible and places lower-frequency guardrails, family
switches, and watched scopes under Advanced options. Background work avoids destructive changes; file/project scans
respect configured folders only, resource limits clamp research/page/file/TODO scan budgets,
Machine Modes shape due-work selection, and failures stay visible without creating fake queue
items. Today can run source-backed passive actions where supported, but those actions respect
the same disabled, paused, cancelled, and running task guards as the Passive Tasks dashboard.
Passive source health records schedule state, last-run age, schedule lag, next run, mode
deferral, and idle deferral; enabled scheduled work that misses its run window beyond the
worker grace period becomes a visible source issue, while idle-only work waiting for an
active machine stays quiet with `waiting_for_idle` evidence. Today also receives capped
passive source-health inspect items for uncovered source errors, such as missing restore
points, so safety problems are visible before a full App Health digest card exists.
App Health also actively probes the configured Mini Hub public page and the local Mini Hub
API `/api/health` endpoint, records `serviceChecks` evidence on the run, and raises
source-backed cards when either surface is unavailable.
It now verifies Mini Hub's own local restore snapshot surface too: the newest
`MINI_HUB_DATA_DIR/passive-snapshots` JSON restore point is read back during App Health,
with `miniHubSnapshotHealth` metadata and cards for missing, stale, or invalid snapshots.
The Passive Tasks dashboard also has a Restore Points panel backed by the same snapshot
verification path, so backup freshness and cleanup pressure are visible without opening raw
run metadata. Settings shows the same restore-point summary, and Capability Registry marks
Passive Tasks degraded when restore points are missing, stale, invalid, or under cleanup
pressure.
Watched accounts now scope integration-account health findings: if the list is empty,
App Health reports every broken connection, and if it is set, only matching account labels,
connection ids, `provider:account` tokens, or account domains appear in source-backed cards.
Failed and blocked tasks also keep a bounded per-task error log with attempt, message,
timestamp, and next retry so dashboard state does not depend only on the latest run record.
Repeated non-urgent passive notifications with the same family/title/body are de-duplicated
for a day so recurring findings stay digest-like instead of noisy. Notification style is
enforced when notifications are stored: `digest` keeps notable findings, `urgent_only` keeps
only urgent findings, and `off` keeps none; run history and source cards still record the
work. Notification dismissals are persisted and logged to the Action Ledger, while the
underlying run and source-backed cards remain available for inspection.
The Passive Tasks dashboard exposes the same practical controls for day-to-day use, including
idle-only scheduling, AI preference, family toggles, tick limits, watcher toggles, manual
ticks, source scope edits, first-class trigger/result state, and live worker state such as
last/next tick, idle probe, active file watcher count, pending file events, and worker-level
issues. Its default surface stays compact: engine state, source health, digest cards, and
run evidence stay visible, while watcher toggles and high-detail settings sit behind
management/advanced disclosures.
Idle cleanup planning is dry-run only and scans Mini Hub-owned data paths, not broad user
folders.

The hub also has a browser-side Capability Registry v1. It normalizes existing service
status from the Mini Hub API, AI OS, Macro Lab, Google connection state, and the local
offline cache into one machine capability snapshot. Today uses that snapshot to show what
is ready, running, needs setup, degraded, blocked, or offline without inventing fake data.
Settings uses the same snapshot as the service control surface, with per-service health
links and routes into the panels that can fix or inspect each capability. Settings also
stores Machine Modes v1: Auto, Balanced, Beast, Quiet, Offline, Night Shift, and
Maintenance. These modes are now enforced by AI OS for routed text calls and queued jobs:
Offline blocks paid/cloud providers, Quiet and Night Shift avoid paid providers unless
explicitly selected, and Quiet/Maintenance clamp job concurrency. Auto also uses idle state,
fresh browser active-use signals, recent game-route activity, and measured resource pressure
to defer heavier passive research, indexing, drift, and idle compute work until the machine
is available. AI OS also exposes Machine Profile/Autotune v1:
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
- The local API persists core personal records to `MINI_HUB_DATA_DIR/core-data.json`:
  workspaces, Career jobs/actions, Study sessions, game runs/state, settings, notes,
  achievements, and sync events. This lets same-machine progress survive API restarts
  even before a Postgres source of truth is configured. `/api/health` reports whether
  that snapshot is persistent, memory-only, missing, or unhealthy, and Settings -> Workspace
  shows the same core-data status with record counts.
- Browser/Tauri clients keep a local PGlite cache.
- Offline mode is read-only: cached data stays visible, but saves are disabled.
- Legacy `localStorage` data is imported so old Career Desk, Study Desk, game state,
  theme, high scores, and Stick Arena map data remain accessible.

### Productivity Integrations

The Productivity Hub uses server-side OAuth and provider adapters.

Implemented now:

- Google OAuth flow.
- Multiple Google accounts can be connected by running the OAuth flow again from
  Productivity Hub -> Add Google Account. The Productivity Hub shows a connected-account
  panel with per-account revoke controls. Calendar and Gmail resources are scoped to the
  account that produced them, and Today shows connected account counts/labels instead of
  assuming a single Google identity. Google OAuth now carries a signed trusted `returnTo`
  URL and popup/redirect mode. When the hub and API run on different origins, account
  linking uses the hub's own `/oauth/google/callback` route first, then hands the one-time
  code to the local API for encrypted token storage and returns to the original hub tab.
  The hosted callback keeps same-origin return state as the final fallback, so adding a
  school account from GitHub Pages does not bounce into a localhost hub page just because
  the local API is configured for development.
  If the callback is opened manually without a Google code/state, it now stays on a
  Google OAuth recovery page with an actionable Productivity link instead of instantly
  swapping into the Productivity route.
  Direct API-started OAuth URLs still support the API-hosted callback. The Productivity
  page includes an account setup panel that explains this flow for personal plus school
  accounts.
- Google Calendar list/view/create/edit/delete/move/reminder support.
- Gmail search/list/read/compose/draft/send/reply/archive/mark read/unread/label actions.
- Productivity mutations invalidate the unified attention cache, so Calendar changes and
  Gmail read/archive/important actions are reflected in Today's queue after refresh.
- Productivity page stores only the last successful real Google response in browser
  local storage under `miniHub.productivity.cache.v1`; it is a display cache, not a
  source of invented data, and live API refreshes replace it. The status strip separates
  **Live reads** from **Cached read-only** so it is clear when Calendar/Gmail rows are
  inspectable but refresh/search/edit actions need the local API and Google again. Google
  read calls are bounded so a slow Calendar/Gmail/API source returns an actionable error
  instead of leaving the page in an indefinite loading state; OAuth setup and write actions
  use longer bounded timeouts.
- Productivity confirms real Google sends, event deletes, OAuth revokes, and calendar
  moves before calling the API.
- Mini Hub action ledger endpoint for synced personal data writes/deletes with risk and
  recoverability metadata. Updates and deletes now attach before-state snapshots for
  Career Desk, Study Desk, settings, and game state where possible, and
  `/api/action-ledger/:id/restore` can restore those snapshots with explicit confirmation.
  Career Desk and Study Desk delete buttons ask for browser confirmation before removing
  saved records from the workspace.
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
- Default cheap-power stack: Ollama runs first for private/free local work, and OpenAI
  `gpt-4o-mini` is the configured paid fallback when `OPENAI_API_KEY` is present.
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
  RSS/Atom/sitemap discovery for seeded site/monitor runs, extraction, dedupe/ranking,
  citation mapping, archived reports, Markdown/JSON/HTML export, live
  progress/pause/resume/cancel state, opt-in semantic memory indexing, and action-ledger
  entries. AI OS status includes recent research runs so dashboard activity surfaces can
  show them next to jobs/tools/benchmarks/backups/generations. The Research Desk can reopen
  report artifacts with citations, reliability notes, contradictions, timeline, query plan,
  run logs, raw extracted source cards, and a searchable local Source Library for reusing
  archived pages as follow-up seeds. Screenshot runs use browser extraction and show captured
  thumbnails in raw source cards. It also has durable Topic Monitors that save reusable
  research setups and run them on demand as normal archived reports, plus a due-monitor sweep
  for enabled daily/weekly monitors.
- Health, metrics, backup, restore-test, cleanup, dependency/model hygiene surfaces.
- AMD/Windows GPU telemetry where the local machine exposes it.
- Machine Profile + Autotune v1: persisted profile snapshots, safe local text probes,
  recent benchmark summaries, resource-pressure summaries, and measured-route feedback
  into routing, machine-mode recommendations, and Auto passive-task throttling.
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
- Dry-run and confirmed execution modes; confirmed side-effect runs ask in the browser
  before the hub sends `confirm=true` to the Macro Lab service.
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

For the easiest full-power desktop bridge after reboot:

```powershell
pnpm bridge:start
pnpm bridge:status
```

For a less fiddly setup, install the per-user Windows startup task once:

```powershell
pnpm bridge:startup:install
```

After that, Windows starts the local bridge at login. The task is named `Mini Hub Bridge`;
`pnpm bridge:startup:status` reports whether it is installed as a Scheduled Task or Startup
folder entry.

Use `pnpm bridge:start:lan` when another device on LAN/Tailscale should reach this PC, then
open the URL written to `bridge-link.txt` or save those endpoint values in Settings on the
hosted GitHub Pages app.

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
On Windows/AMD systems, AI OS first tries live GPU performance counters, then falls back to
basic Windows video-controller telemetry, and finally labels any benchmark-derived GPU data
as cached instead of showing a misleading live reading.

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
- Browser JSON calls to Hub API, AI OS, and Macro Lab are centrally bounded. If a service
  is offline, hung, blocked by CORS/mixed-content, or pointed at the hosted static site,
  the page should show an actionable timeout/setup error instead of loading forever.

## What Costs Money

- GitHub Pages hosting for this public static UI is free for the current repo setup.
- Ollama/local models run on your own PC and do not create per-call API charges.
- OpenAI, Anthropic, specialist AI APIs, cloud tunnels, paid Google Workspace features, or
  paid hosting providers can cost money if you configure them.
- Private-network tools such as Tailscale may have free personal options, but pricing and
  plan limits can change; check your current plan before depending on paid/team features.
- Macro Lab and local file automation do not cost money, but they can affect your machine,
  so destructive actions stay confirmation-gated or armed-mode gated.

## Checks

Common local checks:

```powershell
pnpm typecheck
pnpm test:workspaces
pnpm legacy:check
```

Mini Hub usability smoke check:

```powershell
pnpm qa:hub:smoke
pnpm qa:hub:smoke:local
pnpm qa:hub:smoke:hosted
pnpm qa:hub:smoke -- --url http://127.0.0.1:5173
pnpm qa:hub:smoke -- --checklist
pnpm qa:hub:smoke -- --url http://127.0.0.1:5173 --require-hydrated
pnpm qa:hub:usability
pnpm qa:hub:hydrated
$env:HUB_HYDRATED_URL='http://127.0.0.1:5173'; pnpm qa:hub:hydrated
pnpm qa:hub:hydrated:ai
```

The smoke check records each visible hub route's title, main heading, service dependency,
button/disabled-control/form counts, control coverage, expected blocked/setup state,
expected safe-action labels, required state/recovery markers, expected state categories,
visible state-surface refs, and reload persistence expectation. It now fails if a route
loses source markers or user-facing vocabulary for the setup, offline/cache, recovery,
loading, empty, partial-failure, browser-local, or control-gating state that makes the page
understandable, if a listed safe action no longer maps to a visible button/link label or
title, if a route form can fall back to browser-native submission instead of Svelte's guarded
handler, if a visible control has no source-level label/title, or if a disabled source
control lacks a title/ARIA explanation. With `--url` or `HUB_SMOKE_URL` set, it also fetches
the route HTML and records live title, heading, enabled/disabled controls, state/error snippets,
state categories, safe-action availability, raw `Not Found` leakage, and a **Hydration QA**
column. Hosted GitHub Pages usually returns a client-rendered shell, which proves routing
and `Not Found` handling but not hydrated button behavior; use `--checklist` for the
manual/Playwright-style pass, and use `--require-hydrated` or `HUB_SMOKE_REQUIRE_HYDRATED=1`
only when the target can expose hydrated controls to the script.

Use `pnpm qa:hub:usability` for the regular end-to-end usability gate: it runs the source/static route audit, the hosted GitHub Pages route audit, and then the hydrated browser pass with a temporary local hub when no target URL is configured.

For real hydrated DOM evidence without adding Playwright/Puppeteer, run
`pnpm qa:hub:hydrated`. If `HUB_HYDRATED_URL`/`HUB_SMOKE_URL` is not set, the script starts
a temporary local Mini Hub dev server on an open port, then shuts it down after the check.
It launches a temporary headless Chrome/Edge profile through the Chrome DevTools Protocol,
opens every main route, records the hydrated browser title, heading, and control state, checks safe-action visibility,
fills a sample Research goal to verify the offline run guard does not fake a queued task,
starts an embedded mock AI OS Research service to verify run creation, pause, resume, cancel, reload recovery,
Activity recovery for AI OS jobs/tool calls/benchmarks/generations, monitor save/run/toggle/delete,
report export links, source-library search, and source-to-seed draft recovery,
forces AI OS offline to verify command, autotune, design, benchmark, job, and generation controls stay disabled,
fills Career/Study forms to verify service-backed save controls are guarded when the Hub API
is unavailable, then starts an embedded mock Mini Hub API to verify Career save/edit/filter/export
and Study log/edit/filter/progress reload without touching real local data,
seeds cached Google Calendar/Gmail rows to verify Productivity stays inspectable while writes are locked,
forces Macro Lab and Passive Tasks offline to verify side-effect controls stay disabled,
test-fires AI Lab Tree-sitter Parse, verifies the Tree-sitter asset-error copy with an
intentionally bad grammar URL, blocks browser model asset URLs to verify the Classify
asset-error copy without downloading weights, and verifies browser-storage
reload for Activity cache, Productivity Google cache, Research Desk drafts, and AI Lab drafts. Set
`HUB_HYDRATED_BROWSER` if Chrome/Edge is not in a standard location.
The first AI Lab Classify run may download browser model assets, so the default hydrated
smoke checks the readable blocked-asset state instead. Run `pnpm qa:hub:hydrated:ai` or
set `HUB_HYDRATED_AI_LAB_CLASSIFY=1` for the full browser-local Transformers.js Classify check.
Run `pnpm qa:hub:hydrated:writes` when a disposable real Mini Hub API is running and you want
the same Career/Study save, edit, filter, export, and progress evidence against the real backend instead of the embedded
mock. Set `HUB_HYDRATED_API_URL` to that temporary API origin; the script passes it through the
same `apiUrl` endpoint override used by Settings. This mode creates smoke rows named
`Hydrated API Smoke Labs` and `Hydrated API Study`, so
prefer a temporary `MINI_HUB_DATA_DIR`.

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
