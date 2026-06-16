# Personal Productivity Hub Architecture

Status: Google Calendar and Gmail vertical slices implemented; Drive/Docs/Sheets and Brightspace are adapter-ready next integrations.

Date: 2026-06-16

## Goal

Build a private, single-user command center for email, calendar, files, coursework, deadlines, and personal goals. The app must use real provider APIs for view/edit/action workflows, keep OAuth tokens secure on the server, and expose integrations through modular adapters so new services can be added without rewriting the hub.

## Chosen Architecture

The productivity hub extends the staged Mini Hub rewrite:

- `apps/hub`: SvelteKit SPA/static UI. It renders the command center, starts OAuth, and calls the API with the existing private sync key.
- `apps/api`: Hono API. It owns OAuth callbacks, encrypted token storage, provider calls, validation, connector error handling, and all mutation endpoints.
- `packages/core`: shared route names, Zod contracts, connector status/capability types, calendar event shape, and unified timeline item shape.
- `packages/db`: Drizzle schema for server-authoritative Postgres tables, including integration connections and logs.

This keeps browser code free of OAuth client secrets and refresh tokens, keeps the UI deployable as a static app, and gives provider integrations a server-side boundary where rate limits, token refresh, logging, and destructive-action checks can be handled consistently.

## Data Model

Existing personal workspace tables remain the base for local hub data:

- `workspaces`
- `personal_settings`
- `jobs`
- `study_sessions`
- `career_actions`
- `game_runs`
- `game_state`
- `achievements`
- `notes`
- `sync_events`
- `assets`

Productivity integrations add server-side-only records:

- `integration_connections`
  - `id`
  - `workspace_id`
  - `provider`
  - `account_label`
  - `scopes`
  - `encrypted_token_set`
  - `status`
  - `last_sync_at`
  - `error`
  - `created_at`
  - `updated_at`
- `integration_logs`
  - `id`
  - `workspace_id`
  - `provider`
  - `action`
  - `status`
  - `message`
  - `request_id`
  - `created_at`

Provider data is not blindly mirrored yet. Calendar events are fetched live from Google Calendar and normalized to a shared `CalendarEvent` response. Timeline rows are normalized to `TimelineItem` so Gmail nudges, Brightspace deadlines, and manual tasks can land in one surface later.

## Auth Strategy

The app uses two layers:

1. Personal hub gate: existing `MINI_HUB_SYNC_KEY`, sent as `X-Mini-Hub-Sync-Key`. This keeps the private app closed even before provider OAuth begins.
2. Provider OAuth: Google OAuth 2.0 authorization-code flow with offline access. The API creates a signed `state`, exchanges the code server-side, stores encrypted token JSON, refreshes access tokens when needed, and supports revocation.

Secrets are only read from env:

- `MINI_HUB_SYNC_KEY`
- `MINI_HUB_TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `HUB_PUBLIC_URL`

Token encryption uses AES-256-GCM with a key derived from `MINI_HUB_TOKEN_ENCRYPTION_KEY`. OAuth state is signed with HMAC-SHA256 and expires after 10 minutes.

## Connector Model

Every integration should live behind an adapter with a common shape:

- catalog metadata: label, status, auth type, capability map, and limitations
- auth lifecycle: OAuth URL, callback, refresh, revoke
- read methods: list/search/get
- write methods: create/update/delete where the provider permits
- action methods: send/archive/label/move/complete/etc.
- timeline projection: provider-specific records mapped to `TimelineItem`

Current implemented adapters:

- `GoogleCalendarConnector`
- `GoogleGmailConnector`

Next adapters should follow the same directory structure under `apps/api/src/integrations`.

## Integration Capability Map

| Provider | View | Edit | Actions | Current status |
| --- | --- | --- | --- | --- |
| Google Calendar | calendars, events, event detail, recurring-event metadata | create, patch, delete events | move event, set reminders, pass recurrence rules/timezones | Implemented |
| Gmail | threads, search, full messages, labels | create drafts, replies | send, archive, label, mark read/unread | Implemented |
| Google Drive | browse, search, metadata, open file info | create and rename files/folders where API permits | move/update metadata | Planned |
| Google Docs | read document structure/content | batchUpdate document content | create/open via Drive/Docs APIs | Planned |
| Google Sheets | read spreadsheets/ranges | update/append values | create/open via Drive/Sheets APIs | Planned |
| Brightspace/D2L | courses, assignments/dropbox, grades, calendar/deadline events | institution-dependent and usually locked down for student accounts | deadline ingestion; write actions only when Valence scopes allow | Planned, with iCal read-only fallback |
| Manual deadlines/tasks | local timeline items | create/edit/delete | complete/snooze | Planned |

## Brightspace Reality Check

Brightspace uses the D2L Valence API and supports OAuth 2.0, but access depends on the institution registering an application and granting scopes. Student accounts often cannot create or mutate LMS-managed due dates, assignments, or grades because those are course/instructor-owned resources. For v1:

- If `BRIGHTSPACE_BASE_URL`, client id, and client secret are available, implement Valence OAuth and read courses, grades, dropbox assignments, and calendar events using granted scopes.
- If OAuth/API access is unavailable, ingest the user's Brightspace iCal feed as read-only deadlines.
- Mark Brightspace-derived due dates as read-only in the timeline unless a confirmed writable API endpoint and scope is available.

## UI Strategy

The `Productivity Hub` route is a dense command surface rather than a marketing page:

- top-level connection status and connector catalog
- Google Calendar event creation/edit form
- upcoming event table with edit/move/delete controls
- Gmail search, label filtering, full message reading, compose, draft, send, reply, archive, and read/unread controls
- unified timeline table
- explicit disabled state when the private sync key is missing

Destructive actions require browser confirmation before calling the API. Provider failures appear as visible error banners.

## Error Handling And Logging

The API validates every request body with Zod. Integration routes convert known provider states into useful statuses:

- `401`: provider not connected or needs reauth
- `429`: rate-limit style failures
- `502`: upstream provider request failure
- `400`: invalid connector action or provider-specific error

The schema includes `integration_logs` for persisted provider request logs. The first slice returns structured errors; the next persistence pass should write those route/action outcomes to Postgres.

## How To Add A Connector

1. Add shared record schemas or timeline projections to `packages/core/src/index.ts`.
2. Add any server persistence tables to `packages/db/src/schema.ts`.
3. Create `apps/api/src/integrations/<provider>.ts`.
4. Implement catalog metadata, token handling, read/write/action methods, and `timeline()`.
5. Mount provider routes in `apps/api/src/routes/integrations.ts`.
6. Add a small client helper in `apps/hub/src/lib`.
7. Add the UI surface under `apps/hub/src/routes/productivity` or a provider-specific sub-route.
8. Add API tests for auth rejection, validation, provider error mapping, and at least one mocked successful action.

## Source References

- Google OAuth 2.0 web server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Google OAuth scopes and verification: https://developers.google.com/identity/protocols/oauth2/scopes
- Gmail API scopes and methods: https://developers.google.com/workspace/gmail/api/auth/scopes
- Google Calendar events API: https://developers.google.com/workspace/calendar/api/v3/reference/events
- Google Calendar events/timezones concepts: https://developers.google.com/workspace/calendar/api/concepts/events-calendars
- Gmail threads API: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads
- Gmail messages API: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
- Gmail drafts API: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts
- Gmail send guide: https://developers.google.com/workspace/gmail/api/guides/sending
- Google Drive API scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google Drive file search: https://developers.google.com/workspace/drive/api/guides/search-files
- Google Docs batchUpdate: https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate
- Google Sheets values API: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values
- Brightspace OAuth 2.0: https://docs.valence.desire2learn.com/basic/oauth2.html
- Brightspace API reference: https://docs.valence.desire2learn.com/reference.html
- Brightspace scopes table: https://docs.valence.desire2learn.com/http-scopestable.html
