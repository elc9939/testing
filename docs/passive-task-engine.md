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
- Settings patch: `PATCH /api/passive-tasks/settings`
- Dashboard: `/passive-tasks`
- Settings shortcut: `/settings`

State persists to `passive-tasks.json` under `MINI_HUB_DATA_DIR`. Mini Hub restore snapshots
created by the Backup + Snapshot Watcher are written under
`MINI_HUB_DATA_DIR/passive-snapshots`.

The API worker emits `app.startup` when it starts. The hub browser shell also emits a
throttled `app.startup` on open and `app.reconnect` after the browser comes back online.
Google OAuth connect/revoke flows emit `google.oauth.connected` and `google.oauth.revoked`.
Those lifecycle events all feed the App Health Watchdog event task.

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

Runs are logged into the Action Ledger with `source: passive-tasks`.

## V1 Families

- App Health Watchdog: checks Mini Hub data dir, Google connection state, AI OS, Macro Lab,
  Ollama, AI OS jobs, and backup freshness. It has both a scheduled task and a built-in
  event task for `app.startup`, `app.reconnect`, service reconnect, and Google OAuth
  lifecycle checks.
- Backup + Snapshot Watcher: creates a local Mini Hub restore snapshot and requests an AI OS
  backup when AI OS is available.
- Idle Compute Queue: runs bounded AI OS benchmarks only when the tick is explicitly marked
  idle.
- Background Research Monitor: reads AI OS due monitors and queues due monitor runs.
- Career Radar: reads Career Desk jobs/actions and surfaces overdue or stale follow-ups.
- Local File Intelligence: scans only configured watched folders for recent document/image
  metadata.
- Project Drift Detector: scans only configured project folders for stale READMEs,
  TODO/FIXME buildup, and missing test/check scripts.

## Safety

- No destructive file changes run from v1 passive tasks.
- File and project scans respect the configured folder list; no default broad filesystem scan.
- Backup snapshots redact encrypted token payloads from Mini Hub connection metadata.
- Idle compute is gated by explicit idle ticks.
- Event work is gated by explicit event names; scheduled ticks do not accidentally run
  event-only tasks.
- Lower-urgency output stays in the Passive Tasks dashboard. Today only receives high-urgency
  cards through the `passive_task` attention source.
- Failures remain visible in passive snapshots, source statuses, digest cards, and the Action
  Ledger instead of being silently dropped.
