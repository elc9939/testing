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

The dashboard exposes the day-to-day controls directly: engine on/off, watcher toggles,
task pause/resume/cancel, manual due/startup/idle ticks, notification style, resource limit,
idle-only schedule mode, local/cloud AI preference, max runs per tick, and watched
folders/domains/accounts. The Settings page shows the same durable preferences, plus
family-level enable/disable toggles, alongside the broader service and machine controls.
Digest rows, result rows, trigger rows, failure rows, recent runs, and retained task error
logs show compact evidence such as source labels, changed artifact counts, snapshot
checksums, file counts, cleanup candidates, last trigger fire status, and retry times so
background work is inspectable without opening raw JSON.
The dashboard also includes a Source Health panel derived from the passive source statuses.
Each row records schedule state, last-run age, schedule lag, next run, machine-mode deferral,
idle deferral, and explicit task errors. Scheduled work that misses its run window beyond
the worker grace period becomes an `error` source, while idle-only work waiting for an active
machine to become idle stays `ok` with `waiting_for_idle` evidence.
Direct task "Run now" actions create/update separate `manual` triggers, so the dashboard can
distinguish ad hoc runs from schedule/event/idle firings and the scheduled trigger's
last-fired state stays truthful.
The dashboard settings panel also exposes family enable/disable toggles, so broad families
can be quieted from the same surface used to inspect their outputs.
The snapshot and dashboard also expose live worker state: whether the background worker is
started/running, its interval, last and next tick timestamps, last idle probe, active file
watcher count, pending file event state, and the latest worker-level issue.
That worker state is persisted as the last-known runner record, but restart load normalizes
runtime-only fields so stale file watcher handles, pending file events, and an old `running`
flag do not survive as live state.
Watched accounts are matched against integration connection labels/ids. When the list is
empty, App Health reports all broken integration connections; when it is set, only matching
accounts surface as health findings and ignored connection issues are recorded in run
metadata.

State persists to `passive-tasks.json` under `MINI_HUB_DATA_DIR`. Action Ledger events emitted
by passive runs, watcher toggles, settings changes, and card triage persist separately to the
bounded `action-ledger.json` audit file under the same data directory; obvious token/secret
fields are redacted before that file is written. Mini Hub restore snapshots
created by the Backup + Snapshot Watcher are written under
`MINI_HUB_DATA_DIR/passive-snapshots`. Each new Mini Hub snapshot is read back immediately,
checked for required collections and redacted integration token payloads, hashed with SHA-256,
and summarized in the run metadata before the task is considered successful. The snapshot
includes the passive engine's durable state collections, sync events, and a redacted copy of
explicit Mini Hub Action Ledger events so background decisions have a restore/audit artifact
instead of only a count.

The resource limit setting is active policy, not a label. `light`, `balanced`, and `heavy`
adjust watched-folder count, per-folder file scans, semantic-memory indexing count, project
TODO scan breadth, research monitor creation count, due-run sweep size, and monitor crawl
budgets.

Machine Mode is active policy for scheduled work. Quiet Mode defers heavier passive families
such as idle compute, research monitor sweeps, file intelligence, and project drift. Offline
Mode skips web-backed research monitor sweeps. Beast, Night Shift, and Maintenance adjust
priority toward the work those modes are meant for, and any task pinned to a specific
`machineMode` only runs during that mode. Run history and Action Ledger events record the
effective mode that shaped the run.

The API worker emits `app.startup` when it starts. The hub browser shell also emits a
throttled `app.startup` on open and `app.reconnect` after the browser comes back online.
Google OAuth connect/revoke flows emit `google.oauth.connected` and `google.oauth.revoked`.
Those lifecycle events all feed the App Health Watchdog event task.

The API worker also creates non-recursive file watchers for configured watched folders while
the engine and Local File Intelligence family are enabled. File changes are debounced into a
`file.changed` event and routed through the same passive event pipeline as startup/reconnect
events. The event task scans configured folders only and records changed-file context in run
metadata and source-backed cards. Text-like files (`.txt`, `.md`, `.csv`, `.json`) receive
bounded previews and can be indexed into AI OS semantic memory; PDFs, Office docs, screenshots,
and image downloads receive bounded metadata summaries such as type, dimensions, approximate
PDF page markers, package hints, tags, and cleanup hints. By default the passive engine asks
AI OS to use Ollama embeddings unless the passive AI preference is `cloud_allowed`.

Scheduled worker ticks also try to detect whether the desktop is idle. On Windows, the API
reads the OS last-input timer and marks a tick idle only after the idle trigger threshold
is met. If the probe is unavailable or errors, the tick is treated as active and idle-only
work stays deferred. If the passive engine is disabled, worker ticks skip idle probing and
due-task dispatch, while still refreshing watcher state so file watchers close cleanly.
Already-open watched-folder callbacks also drop new events immediately after disablement,
clear pending debounces, and then close stale watcher handles.
Manual dashboard ticks can still explicitly set `idle: true` after the engine is re-enabled.

## Model

The shared core model includes:

- `PassiveWatcher`: the family-level switch and description.
- `PassiveTrigger`: first-class schedule, event, idle, or manual trigger state with owner
  watcher/task links, enabled state, cadence/event metadata, last fired run/status/error, and
  next-run time. Manual triggers are created by direct task runs and do not overwrite the
  schedule trigger's last-fired evidence. Event triggers run only when an explicit event name
  is ingested, for example `app.startup`.
- `PassiveTask`: runnable unit with priority, status, retry/backoff, idle-only, last/next run,
  machine mode, source refs, and a bounded per-task error log that records failed/blocked
  run id, attempt, message, timestamp, and next retry.
- `PassiveWorkerState`: last-known runner state for the API worker, including lifecycle
  timestamps, tick cadence, last idle probe, active watched-folder count, pending file-event
  state, and worker-level errors. Restart load clears stale runtime handles before exposing
  the state again.
- `PassiveRun`: durable run record with status, timing, error, changed artifacts, and cards.
- `PassiveResult`: first-class source-backed output with title, summary, urgency,
  confidence, source links/files, suggested action, and why it surfaced. Runs still embed
  their cards for compatibility, but the top-level result collection is the durable output
  stream used by the digest and dashboard.
- `PassiveNotification`: digest-level notification derived from notable cards.
  Notification style is enforced at write time: `digest` stores notable notifications,
  `urgent_only` stores only urgent ones, and `off` stores none. Repeated non-urgent
  notifications with the same family/title/body are de-duplicated for 24 hours; run history
  and digest cards still record the repeated work. Notification dismissals are persisted and
  audited in the Action Ledger; the source run and cards remain available for inspection.
- Passive card triage: persisted state for important, reviewed, snoozed, and dismissed
  findings. Triage is stored against the concrete card id and a source-backed fingerprint,
  so equivalent recurring cards inherit the same quieting/importance state while changed
  findings can surface again. The digest filters reviewed/dismissed/future-snoozed cards and
  lets important cards remain visible even when they would otherwise be below the digest
  cutoff. Routine cards age out of the digest after 7 days, and very urgent cards after
  30 days, unless you mark them important or they belong to a failed/blocked run. Run history
  and the source result stream are retained for inspection.

Runs are logged into the Action Ledger with `source: passive-tasks`, and those explicit
Mini Hub ledger events survive API restarts when action-ledger persistence is enabled by the
normal API startup.

## V1 Families

- App Health Watchdog: checks Mini Hub data dir, watched Google connection state,
  configured local
  service endpoints/ports, AI OS, Macro Lab, Ollama reachability, Ollama model inventory,
  configured Ollama chat model availability, AI OS jobs, backup freshness, and the AI OS
  machine-profile/autotune summary. High measured CPU/RAM/GPU/VRAM pressure and failed AI OS
  storage integrity checks surface as source-backed cards; healthy provider, benchmark, and
  suggested-concurrency details are kept in run metadata. It has both a scheduled task and a
  built-in event task for `app.startup`, `app.reconnect`, service reconnect, and Google OAuth
  lifecycle checks.
- Backup + Snapshot Watcher: creates a local Mini Hub restore snapshot, read-verifies it,
  records byte count/checksum/entity counts/redaction status, and requests an AI OS backup
  when AI OS is available.
- Idle Compute Queue: runs bounded AI OS benchmarks, local-first AI OS summary jobs over
  existing passive digest cards, and non-destructive Mini Hub cleanup dry-runs only when the
  worker or dashboard tick reports a real idle window. Cleanup cards list stale passive
  snapshots/logs/temp files under Mini Hub-owned data paths; v1 does not delete them. It
  consults the latest fresh App Health AI OS machine-profile/autotune metadata before
  launching local AI work: high measured pressure defers summaries/benchmarks, suggested
  concurrency is passed through to queued AI OS jobs, and Beast Mode prefers the best measured
  local text route when one is available.
- Background Research Monitor: reads AI OS due monitors, prepares daily AI OS monitor
  templates from configured watched domains and active Career Desk application URLs, queues
  due monitor runs, and surfaces completed `monitor_topic` reports as source-backed passive
  cards with research-run and source URL references. Career-derived monitors carry the source
  job ids and labels in metadata so the watcher remains source-backed rather than guessed.
- Career Radar: reads Career Desk jobs/actions and surfaces overdue or stale follow-ups,
  including submitted applications, interviews, and offers that have gone quiet without a
  next action.
- Local File Intelligence: scans only configured watched folders for recent document,
  note/data, and image metadata, with a scheduled task and a debounced `file.changed` event
  task. It adds bounded text previews for text-like files, source-backed metadata summaries
  for PDFs, Office documents, screenshots, and images, suggested tags, cleanup hints, and
  semantic-memory artifacts for safe text-like files when AI OS is reachable. Successful text
  ingests record path/mtime/size fingerprints in passive run metadata so unchanged files are
  skipped on later scans, while modified files can be indexed again.
- Project Drift Detector: scans only configured project folders for stale READMEs,
  README files that trail newer source/config files, TODO/FIXME buildup, missing test/check
  scripts, and existing failing health artifacts such as recent test/check logs or
  JUnit-style result files.

## Safety

- No destructive file changes run from v1 passive tasks.
- Idle cleanup planning is dry-run only. It scans Mini Hub-owned data paths for stale
  passive snapshots, logs, and temp files, then emits source-backed cards without deleting
  anything.
- File and project scans respect the configured folder list; no default broad filesystem scan.
- File event watchers are created only for configured folders, are non-recursive, and close
  when the folder is removed or the file-intelligence watcher is disabled.
- Text previews and indexing are bounded. PDFs, Word documents, and images get metadata-only
  summaries unless a real extractor/OCR path is added; the engine does not invent file
  contents.
- Project Drift does not execute arbitrary project scripts in the background. It reads bounded
  existing test/check log artifacts from configured folders and reports source-backed failure
  evidence when those artifacts already exist.
- Resource limits clamp local scan breadth and AI OS research monitor budgets before work is
  queued, so changing the setting affects the next run without editing task definitions.
- Completed AI OS monitor-topic research runs are surfaced only when their reports or source
  list contain real content. The passive engine links back to the research run and source URLs
  rather than inventing change summaries. Once a research run id has been surfaced in passive
  results, later sweeps skip it to avoid repeating the same completed monitor report.
- Backup snapshots redact encrypted token payloads from Mini Hub connection metadata, and the
  snapshot task fails visibly if the newly-written restore point cannot be parsed or if an
  unredacted token payload is detected. Action Ledger token/secret-looking fields are also
  redacted before being embedded in the restore snapshot.
- Idle compute is gated by worker-measured or manually requested idle ticks. Probe failures
  do not allow heavy work to run.
- Disabling the passive engine prevents scheduled/event/idle work and also skips worker idle
  probes. Watched-folder callbacks drop events and close stale watcher handles once the
  disabled state is observed, so the global off switch avoids background polling and event
  churn as well as task dispatch.
- Idle digest summaries are queued through AI OS as bounded `chunk_summarize` jobs over
  existing passive cards. They do not invent findings, and cloud fallback is allowed only
  when the passive AI preference is `cloud_allowed`.
- Event work is gated by explicit event names; scheduled ticks do not accidentally run
  event-only tasks.
- Watched domains are normalized to public hostnames before passive research monitor
  provisioning; localhost and IP-style hosts are ignored.
- Watched accounts scope integration-account health findings. Account labels, connection ids,
  `provider:account` tokens, `@domain` suffixes, and plain email domains can match; unmatched
  broken connections are tracked in metadata but kept out of the digest.
- Lower-urgency output stays in the Passive Tasks dashboard result history. Today only
  receives high-urgency digest cards through the `passive_task` attention source.
- Routine digest cards automatically age out of Today/passive digest surfaces after 7 days,
  and urgent cards after 30 days, unless marked important or tied to unresolved failed/blocked
  runs. The underlying run history and source-backed result rows are retained.
- Passive source statuses include schedule lag and last-run age. A task that is enabled,
  allowed by Machine Mode, not waiting for idle time, and overdue beyond the worker grace
  window is reported as an error so background work cannot silently rot.
- Repeated non-urgent notifications are suppressed for a day so recurring background findings
  behave like a quiet digest; urgent findings can still surface immediately.
- Notification style only controls stored notifications; passive runs, source cards, digest
  cards, errors, and Action Ledger events are still recorded for inspection.
- Notification dismissal is a write action: it is persisted, logged to the Action Ledger, and
  does not delete the original passive run or source-backed cards.
- Passive card triage is reversible from the source state: reviewed, dismissed, snoozed,
  important, and clear actions are logged to the Action Ledger with both the concrete card id
  and stable passive-card key, and do not alter source files or remote services.
- Cancelling a running task is sticky: when the in-flight work returns, the run is recorded as
  cancelled, no follow-up run is scheduled, and the task remains cancelled instead of being
  revived by async completion.
- Manual run requests still bypass schedule timing, but they respect engine, watcher, family,
  paused, cancelled, and running task state. Today passive-card run actions use the same
  guard path as the dashboard instead of force-running paused or disabled tasks. Resume a
  paused task before running it manually.
- Failed and blocked runs append to the task's bounded error log, and failed run records point
  their `nextRunAt` at the retry/backoff time so dashboard state matches the scheduler.
- Failures remain visible in passive snapshots, source statuses, digest cards, and the Action
  Ledger instead of being silently dropped.
