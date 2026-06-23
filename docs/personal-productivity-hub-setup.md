# Personal Productivity Hub Setup

This guide configures the private productivity hub with real Google OAuth and a server-side API.

## Local Services

Run the API and hub from the repo root:

```powershell
pnpm --filter @mini-hub/api dev
pnpm --filter @mini-hub/hub dev
```

Default local URLs:

- Hub: `http://127.0.0.1:5173/productivity`
- API: `http://127.0.0.1:8787`
- Google OAuth callback: `http://127.0.0.1:8787/api/integrations/google/oauth/callback`
- Local hub OAuth callback: `http://127.0.0.1:5173/oauth/google/callback`
- Hosted GitHub Pages callback: `https://elc9939.github.io/testing/oauth/google/callback`

## Environment

Copy `.env.example` to `.env` and fill in:

```dotenv
PUBLIC_API_URL=http://127.0.0.1:8787
PUBLIC_SYNC_MODE=personal
HUB_PUBLIC_URL=http://127.0.0.1:5173

MINI_HUB_TOKEN_ENCRYPTION_KEY=replace-with-at-least-32-random-characters

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/api/integrations/google/oauth/callback

BRIGHTSPACE_BASE_URL=
BRIGHTSPACE_CLIENT_ID=
BRIGHTSPACE_CLIENT_SECRET=
BRIGHTSPACE_ICAL_URL=
```

`MINI_HUB_TOKEN_ENCRYPTION_KEY` encrypts provider OAuth tokens at rest and signs OAuth state.
When you start Google OAuth from the public GitHub Pages app, a local dev URL, or a LAN hub
URL, the hub passes its current Productivity URL as a signed `returnTo` value. If the hub and
API are on different origins, the UI asks Google to return to the hub's own
`/oauth/google/callback` route first. That callback hands the one-time Google code to the local
API, waits for the token to be stored, posts a completion message back to the original hub tab,
and then closes. If there is no opener tab, it redirects to the trusted hub URL that started the
flow instead of leaving the browser on `127.0.0.1`.

The hub UI requests same-site callbacks dynamically, so the local API can keep
`GOOGLE_REDIRECT_URI` pointed at the API callback for direct API-started OAuth URLs. If you want
hosted callback behavior to be the default for direct API-started OAuth URLs too, set:

```dotenv
HUB_PUBLIC_URL=https://elc9939.github.io/testing
GOOGLE_REDIRECT_URI=https://elc9939.github.io/testing/oauth/google/callback
```

The API still performs the token exchange and encrypted token storage. The hosted page only
receives the short-lived OAuth code and signed state, then immediately returns to the hub.

## Google OAuth App

1. Open Google Cloud Console.
2. Create or choose a project.
3. Enable these APIs:
   - Google Calendar API
   - Gmail API
   - Google Drive API
   - Google Docs API
   - Google Sheets API
4. Configure the OAuth consent screen.
   - For a private personal app, keep it in testing and add your Google account as a test user.
   - The requested Gmail/Drive/Docs/Sheets scopes include sensitive or restricted scopes. Public production distribution may require Google verification and possibly security assessment.
5. Create an OAuth client:
   - Application type: Web application
   - Authorized JavaScript origins:
     - `http://127.0.0.1:5173`
     - `http://localhost:5173`
     - `http://127.0.0.1:5174`
     - `http://localhost:5174`
     - `http://127.0.0.1:5175`
     - `http://localhost:5175`
     - `https://elc9939.github.io`
   - Authorized redirect URIs:
     - `http://127.0.0.1:8787/api/integrations/google/oauth/callback`
     - `http://127.0.0.1:5173/oauth/google/callback`
     - `http://localhost:5173/oauth/google/callback`
     - `https://elc9939.github.io/testing/oauth/google/callback`
6. Put the generated client id and client secret in `.env`.

## Requested Google Scopes

The current Google OAuth URL requests:

```text
openid
email
profile
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.compose
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/documents
https://www.googleapis.com/auth/spreadsheets
```

Calendar and Gmail are implemented now. Drive, Docs, and Sheets scopes are included so the same personal OAuth grant can unlock the next adapters without repeatedly reconnecting.

## Using Google Calendar

1. Open `http://127.0.0.1:5173/productivity`.
2. Select `Connect Google`.
3. Complete Google OAuth.
4. To connect a second account, return to Productivity Hub and select `Add Google Account`.
   Google's account picker is forced during OAuth, so choose the other identity, such as a
   school account, and approve the same grant.
5. Use the Productivity Hub to list events, create events, edit events, delete events, move events between calendars, set reminders, and pass recurrence rules such as `RRULE:FREQ=WEEKLY;COUNT=6`.

The app sends all Google Calendar calls through `apps/api`; the browser never stores the Google refresh token.
Calendar and Gmail resource ids are scoped to the account that produced them, so the UI can
show personal and school calendars/mail together while still sending edits back to the
correct Google account.

## Using Gmail

After the same Google OAuth connection is complete, open `http://127.0.0.1:5173/productivity`.

The Gmail panel supports:

- search with Gmail query syntax. The default query is action-heavy and excludes common
  promotional/newsletter noise; use the search control to broaden it back to something like
  `in:inbox newer_than:30d` when you want a raw inbox sweep.
- optional label filtering
- opening threads and reading normalized full message bodies
- composing and saving a draft
- composing and sending after confirmation
- replying to an existing thread after confirmation
- archiving a thread
- marking a thread read or unread
- marking or unmarking a thread as important
- applying a selected label to a thread

The API builds RFC 2822-style plain-text MIME messages and sends them through Gmail's `raw` base64url message field. Send actions are confirmed in the UI because they have external side effects.

## Brightspace / D2L

Brightspace support depends on institution-controlled API access.

If your institution can register a Valence OAuth app:

```dotenv
BRIGHTSPACE_BASE_URL=https://your-school.brightspace.com
BRIGHTSPACE_CLIENT_ID=...
BRIGHTSPACE_CLIENT_SECRET=...
```

The future Brightspace adapter should request the minimum read scopes needed for courses, grades, dropbox assignments, and calendar/deadline events.

If your institution does not grant API access, use the iCal feed fallback:

```dotenv
BRIGHTSPACE_ICAL_URL=https://your-school.brightspace.com/d2l/le/calendar/feed/user/feed.ics
```

The iCal path is deadline ingestion only. Those records should be marked read-only because iCal cannot edit Brightspace assignments, grades, or due dates.

## Adding Another Connector

1. Add provider schemas to `packages/core/src/index.ts`.
2. Add server persistence to `packages/db/src/schema.ts` when the provider needs stored tokens, cursors, or logs.
3. Implement the adapter under `apps/api/src/integrations`.
4. Expose routes under `apps/api/src/routes/integrations.ts`.
5. Add a hub client helper in `apps/hub/src/lib`.
6. Add UI controls under `apps/hub/src/routes/productivity`.
7. Add tests for missing auth, wrong auth, validation, token-expiry handling, and at least one successful mocked action.

## Troubleshooting

- `401 Unauthorized`: Google is not connected yet, or its refresh token needs reauthorization.
- `Google OAuth is not configured`: `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is missing.
- `redirect_uri_mismatch`: the URI in Google Cloud does not exactly match the callback the flow requested. Register the API callback and each hub callback you actually use, for example the local hub callback and the GitHub Pages callback listed above.
- OAuth returns to the wrong hub page: make sure the page origin is listed in `TRUSTED_ORIGINS`.
  Trusted origins, not full paths, are allowed for signed `returnTo` redirects.
- `Google connection needs reauthorization`: Google did not return or no longer accepts the refresh token. Revoke and reconnect.
- Provider `429`: wait and retry; the API maps rate-limit style errors separately so retry/backoff can be added cleanly.

## References

- Google OAuth web server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Google Calendar API events: https://developers.google.com/workspace/calendar/api/v3/reference/events
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Gmail threads: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads
- Gmail messages send: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
- Gmail drafts: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts
- Google Drive scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Brightspace OAuth 2.0: https://docs.valence.desire2learn.com/basic/oauth2.html
- Brightspace scopes: https://docs.valence.desire2learn.com/http-scopestable.html
