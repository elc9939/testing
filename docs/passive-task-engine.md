# Passive Task Engine

Mini Hub's Passive Task Engine is the background layer beneath Today. It creates durable,
source-backed result cards from real local signals, then lets the unified attention queue
surface only the cards that need action.

## Surfaces

- API snapshot: `GET /api/passive-tasks/snapshot`
- Run due work: `POST /api/passive-tasks/tick`
- Run matching event work: `POST /api/passive-tasks/events/:eventName`
- Run one task: `POST /api/passive-tasks/tasks/:id/run`
- Pause/resume/cancel: `POST /api/passive-tasks/tasks/:id/pause`, `resume`, `cancel`
- Toggle watcher: `POST /api/passive-tasks/watchers/:id/toggle`
- Triage source card: `POST /api/passive-tasks/cards/:id/triage`
- Settings patch: `PATCH /api/passive-tasks/settings`
- Dashboard: `/passive-tasks`
- Settings shortcut: `/settings`

State persists to `passive-tasks.json` under `MINI_HUB_DATA_DIR`. Mini Hub restore snapshots
created by the Backup + Snapshot Watcher are written under
`MINI_HUB_DATA_DIR/passive-snapshots`.

The resource limit setting is active policy, not a label. `light`, `balanced`, and `heavy`
adjust watched-folder count, per-folder file scans, semantic-memory indexing count, project
TODO scan breadth, research monitor creation count, due-run sweep size, and monitor crawl
budgets.

The API worker emits `app.startup` when it starts. The hub browser shell also emits a
throttled `app.startup` on open and `app.reconnect` after the browser comes back online.
Google OAuth connect/revoke flows emit `google.oauth.connected` and `google.oauth.revoked`.
Those lifecycle events all feed the App Health Watchdog event task.

The API worker also creates non-recursive file watchers for configured watched folders while
the engine and Local File Intelligence family are enabled. File changes are debounced into a
`file.changed` event and routed through the same passive event pipeline as startup/reconnect
events. The event task scans configured folders only and records changed-file context in run
metadata and source-backed cards. Text-like files (`.txt`, `.md`, `.csv`, `.json`) receive
bounded previews and can be indexed into AI OS semantic memory; by default the passive engine
asks AI OS to use Ollama embeddings unless the passive AI preference is `cloud_allowed`.

Scheduled worker ticks also try to detect whether the desktop is idle. On Windows, the API
reads the OS last-input timer and marks a tick idle only after the idle trigger threshold
is met. If the probe is unavailable or errors, the tick is treated as active and idle-only
work stays deferred. Manual dashboard ticks can still explicitly set `idle: true`.

## Model

The shared core model includes:

- `PassiveWatcher`: the family-level switch and description.
- `PassiveTrigger`: schedule, event, idle, or manual trigger metadata. Event triggers run
  only when an explicit event name is ingested, for example `app.startup`.
- `PassiveTask`: runnable unit with priority, status, retry/backoff, idle-only, last/next run,
  machine mode, and source refs.
- `PassiveRun`: durable run record with status, timing, error, changed artifacts, and cards.
- `PassiveResultCard`: source-backed output with title, summary, urgency, confidence,
  source links/files, suggested action, and why it surfaced.
- `PassiveNotification`: digest-level notification derived from notable cards.
- Passive card triage: persisted per-card state for important, reviewed, snoozed, and
  dismissed findings. The digest filters reviewed/dismissed/future-snoozed cards and lets
  important cards remain visible even when they would otherwise be below the digest cutoff.

Runs are logged into the Action Ledger with `source: passive-tasks`.

## V1 Families

- App Health Watchdog: checks Mini Hub data dir, Google connection state, AI OS, Macro Lab,
  Ollama, AI OS jobs, and backup freshness. It has both a scheduled task and a built-in
  event task for `app.startup`, `app.reconnect`, service reconnect, and Google OAuth
  lifecycle checks.
- Backup + Snapshot Watcher: creates a local Mini Hub restore snapshot and requests an AI OS
  backup when AI OS is available.
- Idle Compute Queue: runs bounded AI OS benchmarks and non-destructive Mini Hub cleanup
  dry-runs only when the worker or dashboard tick reports a real idle window. Cleanup cards
  list stale passive snapshots/logs/temp files under Mini Hub-owned data paths; v1 does
  not delete them.
- Background Research Monitor: reads AI OS due monitors, prepares daily AI OS monitor
  templates from configured watched domains, and queues due monitor runs.
- Career Radar: reads Career Desk jobs/actions and surfaces overdue or stale follow-ups.
- Local File Intelligence: scans only configured watched folders for recent document,
  note/data, and image metadata, with a scheduled task and a debounced `file.changed` event
  task. It adds bounded text previews, suggested tags, cleanup hints, and semantic-memory
  artifacts for safe text-like files when AI OS is reachable.
- Project Drift Detector: scans only configured project folders for stale READMEs,
  TODO/FIXME buildup, and missing test/check scripts.

## Safety

- No destructive file changes run from v1 passive tasks.
- Idle cleanup planning is dry-run only. It scans Mini Hub-owned data paths for stale
  passive snapshots, logs, and temp files, then emits source-backed cards without deleting
  anything.
- File and project scans respect the configured folder list; no default broad filesystem scan.
- File event watchers are created only for configured folders, are non-recursive, and close
  when the folder is removed or the file-intelligence watcher is disabled.
- Text previews and indexing are bounded; PDFs, Word documents, and images are not given fake
  content summaries until a real extractor/OCR path is added.
- Resource limits clamp local scan breadth and AI OS research monitor budgets before work is
  queued, so changing the setting affects the next run without editing task definitions.
- Backup snapshots redact encrypted token payloads from Mini Hub connection metadata.
- Idle compute is gated by worker-measured or manually requested idle ticks. Probe failures
  do not allow heavy work to run.
- Event work is gated by explicit event names; scheduled ticks do not accidentally run
  event-only tasks.
- Watched domains are normalized to public hostnames before passive research monitor
  provisioning; localhost and IP-style hosts are ignored.
- Lower-urgency output stays in the Passive Tasks dashboard. Today only receives high-urgency
  cards through the `passive_task` attention source.
- Passive card triage is reversible from the source state: reviewed, dismissed, snoozed,
  important, and clear actions are logged to the Action Ledger and do not alter source files
  or remote services.
- Failures remain visible in passive snapshots, source statuses, digest cards, and the Action
  Ledger instead of being silently dropped.
